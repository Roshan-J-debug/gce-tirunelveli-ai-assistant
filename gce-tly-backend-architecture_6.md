# GCE Tirunelveli AI Assistant — Backend Architecture Document (Version 2)

**Status:** UI/UX Prototype v2, Design System, Conversation Design v2, and Frontend Architecture are approved and final. This document defines only the backend software architecture required to serve them faithfully — the response contract defined in Frontend Architecture §5.2 (`text-delta` / `component` / `follow-up-chips` / `error` / `done` stream chunks) is treated as a fixed interface, not a suggestion. No frontend or conversation decision is revisited here.

**Version 2 note:** this revision applies the mandatory fixes (C1–C4) and important fixes (H1–H5) identified in the pre-development Design Review of Version 1, without changing the underlying system design — same module boundaries, same section numbering, same technology choices (NestJS, PostgreSQL, Redis, Qdrant, SSE streaming). See the **Change Log** at the end of this document for exactly what changed and where.

**Core constraint driving every decision in this document:** the assistant must never answer from a language model's general knowledge. Every factual claim must be traceable to an ingested official document or record, or the system must refuse. This single rule shapes the AI Orchestration layer (§5), the RAG pipeline (§6), and the error contract (§13) more than any technology choice does.

---

## 1. Overall Backend Architecture

### 1.1 Layered overview

```
                        ┌─────────────────────────┐
                        │        Browser           │
                        └────────────┬─────────────┘
                                     │ HTTPS
                        ┌────────────▼─────────────┐
                        │  Frontend (embed/standalone)│   ← Frontend Architecture doc
                        └────────────┬─────────────┘
                                     │ HTTPS (JSON / SSE stream)
                        ┌────────────▼─────────────┐
                        │   API Gateway (NGINX)      │  TLS termination, rate limiting,
                        └────────────┬─────────────┘  request routing, static asset cache
                                     │
                        ┌────────────▼─────────────┐
                        │ Authentication Layer       │  Anonymous session issuance (students),
                        │ (Guards / Interceptors)     │  JWT + refresh (admin), RBAC checks
                        └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │   Chat Service (NestJS)    │  Validates input, manages conversation
                        │                             │  state, streams response to client
                        └────────────┬─────────────┘
                                     │
                        ┌────────────▼─────────────┐
                        │   AI Orchestrator          │  §5 — the system's "brain": decides
                        │                             │  retrieve → ground → generate → cite
                        └──────┬──────────────┬───────┘
                               │              │
                  ┌────────────▼───┐   ┌──────▼─────────┐
                  │ Knowledge Base   │   │  LLM Gateway    │  Provider-agnostic wrapper;
                  │ (Hybrid dense +  │   │ (single primary │  launches with one provider
                  │  sparse vector   │   │  provider, v1)  │  (§2) — additional providers
                  │  search + Postgres)│  │                 │  are a config addition later
                  └────────────┬───┘   └──────┬─────────┘
                               │              │
                        ┌──────▼──────────────▼─────┐
                        │   PostgreSQL (system of      │  Conversations, messages, documents,
                        │   record)                     │  feedback, admin, analytics
                        └────────────┬─────────────┘
                                     │
              ┌──────────────┬──────┴───────┬───────────────┐
   ┌──────────▼──┐  ┌────────▼────┐ ┌───────▼──────┐ ┌──────▼───────┐
   │  Logging      │  │ Analytics   │ │ Monitoring    │ │ Admin         │
   │  (structured) │  │ (aggregate) │ │ (health/metrics)│ │ Dashboard API │
   └───────────────┘  └─────────────┘ └───────────────┘ └───────────────┘
```

### 1.2 Why each layer exists

| Layer | Reason it's a separate layer, not folded into another |
|---|---|
| API Gateway | TLS, rate limiting, and abuse mitigation must sit in front of application code, not inside it — this is the only layer that can stop a flood of requests before they consume a Node.js event loop or a database connection |
| Authentication Layer | Isolated as guards/interceptors, not scattered `if` checks in controllers — every route's identity/permission requirement is declared once and enforced consistently, which matters more here than in a typical app because most traffic is *anonymous* (students) while a smaller privileged surface (admin) needs full RBAC |
| Chat Service | Owns conversation lifecycle and streaming to the client — it does not itself decide *what* the answer is; it's a thin, testable orchestration boundary between the transport (HTTP/SSE) and the reasoning (AI Orchestrator) |
| AI Orchestrator | The single place hallucination-prevention rules live (§5) — kept as its own service, not merged into the Chat Service, so it can be tested, versioned, and reasoned about independently of HTTP concerns |
| Knowledge Base | Hybrid dense + sparse vector search (§5.5, §8) + PostgreSQL (authoritative document metadata/text) are two systems working together, not one — a vector store is *never* the source of truth for content, only for retrieval ranking (§8) |
| LLM Gateway | Abstracts the LLM provider behind one interface — launches with a single primary provider for v1, so a future provider addition or swap is a configuration change behind this interface, not a rewrite (§2) |
| PostgreSQL (system of record) | Everything that must survive, be audited, or be queried relationally lives here — the one layer every other layer ultimately reports into |
| Logging / Analytics / Monitoring / Admin | Four genuinely different consumers of the same underlying events — logs are for engineers debugging one request, analytics is for the college understanding usage patterns, monitoring is for uptime/alerting, admin dashboard is for non-technical staff managing content. Conflating these into one system produces a tool that serves none of the four audiences well |

### 1.3 Request lifecycle — from message sent to answer rendered

1. Browser sends `POST /v1/chat` with the message and `conversationId` (per Frontend Architecture §5.2).
2. NGINX terminates TLS, applies rate limiting (§11), forwards to the Chat Service.
3. Authentication guard validates the anonymous session token (or admin JWT if applicable); rejects with `401` if invalid/expired.
4. Chat Service validates payload shape (length, content type), opens a streaming response channel, and hands the message to the AI Orchestrator.
5. AI Orchestrator fetches recent conversation history (Redis-cached, Postgres-backed) for context and pronoun resolution.
6. Orchestrator issues a **hybrid** retrieval query against the Knowledge Base (§6): dense-embed the query, derive sparse/keyword terms, search both against Qdrant, fuse the two ranked lists via Reciprocal Rank Fusion, then re-rank the fused candidates with a cross-encoder, and pull full chunk text + metadata from PostgreSQL (§5.5).
7. Orchestrator evaluates retrieval confidence (§5.6) — hallucination-prevention **gate one**. Below threshold → skip generation entirely, emit a `type: "error", code: "no-data"` chunk and `done`, and skip to step 13.
8. Above threshold → Orchestrator assembles a grounded prompt (retrieved chunks + conversation history + system instructions) and calls the LLM Gateway, which generates the **complete** answer server-side — not yet visible to the client.
9. Orchestrator runs **runtime groundedness verification** (§5.7) — hallucination-prevention **gate two** — checking the generated answer against the specific chunks it was grounded in. Fails → discard the generated answer, emit the same `no-data` refusal as step 7, skip to step 13. Passes → continue.
10. Orchestrator classifies the *verified* response's shape (plain text vs. structured card, per Frontend Architecture §5.2) and emits the corresponding stream chunk types to the Chat Service. For text answers, this is a server-paced replay of the already-generated, already-verified text — the client still sees text appear progressively (preserving the UX `StreamingText` was designed for), but it is a controlled replay of verified output, never a live pass-through of unverified model tokens.
11. Orchestrator attaches citations (source document + section) as part of any `component` chunk and computes the follow-up chip set (§5.11).
12. Chat Service streams all chunks to the browser over SSE/chunked HTTP; on completion, the full exchange (question, answer, citations, retrieval confidence score, groundedness result, latency) is persisted to PostgreSQL and emitted as a structured log event.
13. Logging/Analytics/Monitoring pipelines consume that event asynchronously — none of them are in the critical path of the user's response time.

---

## 2. Backend Technology Stack

| Technology | Role | Why chosen over the alternative |
|---|---|---|
| **Node.js** | Runtime | Single language (TypeScript) across frontend and backend — the response contract types (§4.2) can be a literally shared package, eliminating an entire class of integration bugs at the frontend/backend boundary |
| **NestJS**, running on the **Fastify** HTTP adapter | Application framework | NestJS provides the structure a multi-module system like this needs — dependency injection, guards, interceptors, module boundaries — which a bare Express/Fastify app would otherwise reinvent ad hoc as the codebase grows. Running it on Fastify (NestJS officially supports this) rather than its default Express adapter keeps the higher request-per-second throughput Fastify is chosen for, without giving up NestJS's structure. This is why both "NestJS" and "Fastify" appear in the brief — they are not competing choices, they're complementary at different levels of the stack |
| **TypeScript** | Language | Compile-time safety across the largest source of production bugs in an AI-integrated system: shape mismatches between what the LLM Gateway returns, what the Orchestrator expects, and what the frontend contract requires |
| **Redis** | Cache, session store, queue backend (via BullMQ) | One piece of infrastructure serving three needs (§11) instead of three separate services — appropriate at this scale; justified further in §11 |
| **PostgreSQL** | System-of-record database | Relational integrity for conversations/documents/admin data actually matters here (foreign keys between messages↔conversations↔documents↔feedback are core to the domain, not incidental) — a document database would make the analytics and admin-dashboard queries (§7) meaningfully harder to write correctly |
| **Qdrant** (recommended) — Pinecone as a documented alternative | Vector database | Qdrant is open-source and self-hostable, which matters for a **government institution**: student query embeddings and official document content can stay within infrastructure the college (or its chosen cloud region) controls, rather than a third-party managed vector service. Qdrant's filtering (metadata + vector search combined) also maps cleanly onto retrieval needs like "search only within the Admissions department's documents." Pinecone remains a valid choice if the college prefers a fully managed service and accepts the data-residency trade-off — documented here as the deliberate alternative, not omitted |
| **OpenAI API** (primary provider for v1) | LLM provider, called through the LLM Gateway (§2) | v1 launches with a single primary provider rather than live dual-provider failover — running two providers in production from day one means testing and maintaining prompt/output-shape compatibility across two model families and monitoring cost/quota across two billing relationships, before there's operational evidence (real outage frequency, real traffic patterns) that the added complexity is justified. The Gateway's provider-agnostic interface is still built from day one specifically so a second provider (Gemini or otherwise) is a configuration addition behind that interface later, not a rewrite — see §5.12 for how a provider failure is handled in v1 without live failover |
| **Cloud Object Storage** (S3-compatible — AWS S3 or a self-hosted MinIO for full data residency) | Raw document storage (PDFs, DOCX) | Object storage, not the database, holds binary files; PostgreSQL holds metadata and extracted text. MinIO is named specifically as a self-hosted option because, again, a government college may have a preference against storing official records in a foreign commercial cloud |
| **Docker** | Containerization | Every service (Chat Service, workers, NGINX) ships as an identical artifact from a developer's machine through staging to production — eliminates "works on my machine" as a category of production incident |
| **NGINX** | Reverse proxy / API Gateway | TLS termination, request buffering, and a first line of rate-limiting defense in front of the Node.js processes — cheaper and more resilient to do here than inside application code |
| **Kubernetes** (future, not initial deployment) | Orchestration at scale | Explicitly deferred — see §17.6. Docker Compose is sufficient for the college's realistic initial concurrency; Kubernetes is the documented upgrade path, not a day-one requirement, because adopting it prematurely adds operational burden a small team doesn't need yet |
| **BullMQ** (Redis-backed) | Background job queue | Document processing, embedding generation, and scheduled crawling (§16) must not block request-handling processes — BullMQ is the natural choice given Redis is already in the stack |

---

## 3. Folder Structure

```
backend/
├── src/
│   ├── main.ts                          # Application bootstrap (Fastify adapter, global pipes)
│   ├── app.module.ts                    # Root module wiring
│   │
│   ├── config/
│   │   ├── env.validation.ts            # Typed, validated environment schema — fails fast on boot if misconfigured
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── vector-db.config.ts
│   │   └── llm.config.ts                # Provider keys, model names, timeout/retry settings
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── controllers/             # /auth/session, /admin/login, /admin/refresh
│   │   │   ├── services/                # Token issuance, validation, RBAC evaluation
│   │   │   ├── guards/                  # AuthGuard, RolesGuard
│   │   │   └── strategies/              # JWT strategy, refresh-token rotation logic
│   │   │
│   │   ├── chat/
│   │   │   ├── controllers/             # POST /v1/chat (streaming), POST /v1/feedback
│   │   │   ├── services/                # ChatService — conversation lifecycle, history fetch
│   │   │   ├── repositories/            # ConversationRepository, MessageRepository
│   │   │   └── dto/                     # Request/response validation schemas (§4.3)
│   │   │
│   │   ├── orchestrator/                # §5 — the "brain," deliberately its own module
│   │   │   ├── services/
│   │   │   │   ├── orchestrator.service.ts       # Top-level coordination
│   │   │   │   ├── retrieval.service.ts          # Calls into knowledge-base module
│   │   │   │   ├── prompt-builder.service.ts     # Assembles grounded prompts
│   │   │   │   ├── confidence.service.ts         # Retrieval-confidence scoring — hallucination-prevention gate one (§5.6)
│   │   │   │   ├── groundedness.service.ts       # Post-generation faithfulness check — hallucination-prevention gate two (§5.7)
│   │   │   │   ├── citation.service.ts           # Maps retrieved chunks → citation objects
│   │   │   │   └── followup-chip.service.ts      # §5.11
│   │   │   └── prompts/                 # Versioned system-prompt templates, not hardcoded strings
│   │   │
│   │   ├── knowledge-base/
│   │   │   ├── vector-db/               # Qdrant client wrapper — dense + sparse collection management, RRF fusion (§8)
│   │   │   ├── embeddings/              # Embedding generation service (calls the embedding model)
│   │   │   ├── documents/               # Document metadata CRUD, versioning (§9)
│   │   │   ├── chunking/                # Chunking strategy implementation
│   │   │   └── faqs/                    # Curated FAQ entries — a fast-path retrieval source alongside documents
│   │   │
│   │   ├── llm/
│   │   │   ├── llm-gateway.service.ts   # Provider-agnostic interface (§2) — v1 registers one provider
│   │   │   ├── providers/
│   │   │   │   └── openai.provider.ts   # v1's sole registered provider; additional providers (e.g. gemini.provider.ts) implement the same interface later without touching the gateway or Orchestrator
│   │   │   └── failover.strategy.ts     # No-op passthrough in v1; becomes meaningful once a second provider is registered
│   │   │
│   │   ├── documents/                   # Admin-facing document management (§9)
│   │   │   ├── controllers/             # POST /admin/upload, GET /admin/documents
│   │   │   ├── parsers/                 # PDF parser, DOCX parser, OCR pipeline
│   │   │   ├── pii-detection/           # Regex + NER scanning, automatic redaction, review-queue state transitions (§9)
│   │   │   └── deduplication/           # Content-hash based duplicate detection
│   │   │
│   │   ├── scraper/                     # Scheduled crawlers for official pages that aren't manually uploaded
│   │   │   ├── crawler/
│   │   │   └── scheduler/               # Cron-driven re-crawl jobs, feeds into documents module
│   │   │
│   │   ├── admin/
│   │   │   ├── controllers/             # Admin dashboard-facing endpoints
│   │   │   ├── services/                # Announcement management, FAQ curation, analytics queries
│   │   │   └── guards/                  # Admin-only RBAC enforcement
│   │   │
│   │   ├── analytics/
│   │   │   ├── services/                # Aggregation queries, unanswered-question tracking
│   │   │   └── controllers/             # GET /admin/analytics
│   │   │
│   │   ├── logger/
│   │   │   ├── logger.module.ts         # Structured logging setup (§14)
│   │   │   └── correlation-id.middleware.ts
│   │   │
│   │   ├── monitoring/
│   │   │   ├── health/                  # GET /health, GET /health/deep (checks DB, Redis, vector DB, LLM reachability)
│   │   │   └── metrics/                 # Prometheus-format metrics endpoint
│   │   │
│   │   └── workers/
│   │       ├── document-processing.worker.ts   # PDF/DOCX parse → chunk → embed → index pipeline
│   │       ├── embedding.worker.ts
│   │       ├── crawler.worker.ts
│   │       └── notification.worker.ts           # Future: email/webhook notifications
│   │
│   ├── common/
│   │   ├── interceptors/                # Response shaping, logging interceptor
│   │   ├── filters/                     # Global exception filter (§13)
│   │   ├── pipes/                       # Validation pipes
│   │   └── decorators/                  # @CurrentSession(), @Roles(), etc.
│   │
│   ├── database/
│   │   ├── migrations/                  # Versioned schema migrations
│   │   ├── entities/                    # TypeORM/Prisma entity definitions (§7)
│   │   └── seeds/                       # Department list, initial admin account, etc.
│   │
│   └── queue/
│       ├── queue.module.ts              # BullMQ setup
│       └── processors/                  # Job processors consumed by the workers module
│
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

**Why this shape:** the `orchestrator/` module is deliberately isolated from `chat/` — the Chat Service knows *how to talk to a browser*, the Orchestrator knows *how to produce a trustworthy answer*. This split means the hallucination-prevention logic (§5) can be unit-tested against mock retrieval results without spinning up HTTP infrastructure at all, and it means a future channel (WhatsApp, voice — §20) reuses the Orchestrator without touching Chat Service code.

---

## 4. API Architecture

### 4.1 Versioning
All routes are prefixed `/v1/` — a deliberate, boring choice. Breaking changes to the request/response contract get `/v2/` rather than in-place changes, since the frontend and backend are versioned and deployed somewhat independently.

### 4.2 Core endpoints

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/v1/session` | `POST` | None (issues one) | Establishes an anonymous session for a first-time visitor; returns a short-lived session token the frontend stores and sends on subsequent requests |
| `/v1/chat` | `POST` | Session token | The core endpoint. Accepts `{ message, conversationId, activeEntity? }`, returns a streamed response matching Frontend Architecture §5.2's chunk contract exactly |
| `/v1/feedback` | `POST` | Session token | Records the `.like-btn` signal (and optionally free-text feedback) against a `messageId` |
| `/v1/documents` | `GET` | Public | Lists publicly citable official documents (transparency — lets anyone see what the assistant is grounded in) |
| `/v1/health` | `GET` | None | Shallow liveness check — process is up |
| `/v1/health/deep` | `GET` | Internal/monitoring only | Checks DB, Redis, vector DB, and LLM provider reachability |
| `/admin/login` | `POST` | None (issues tokens) | Admin credential exchange → access + refresh JWT pair |
| `/admin/refresh` | `POST` | Refresh token | Rotates the access token |
| `/admin/upload` | `POST` | Admin JWT + role check | Uploads a new official document for ingestion (§9) |
| `/admin/documents` | `GET` / `PATCH` / `DELETE` | Admin JWT | Manage ingested documents, trigger re-indexing, archive versions |
| `/admin/announcements` | `POST` / `GET` | Admin JWT | Manage time-sensitive notices surfaced in chat |
| `/admin/analytics` | `GET` | Admin JWT | Usage metrics, top questions, unanswered-question queue (§16) |
| `/admin/faqs` | `POST` / `GET` / `PATCH` | Admin JWT | Curated FAQ entries — a fast-path, human-verified retrieval source that bypasses full RAG for very common questions |

### 4.3 Request/response format

- All requests/responses are JSON except `/v1/chat`, which is a chunked/SSE stream of newline-delimited JSON objects, one per chunk type defined in Frontend Architecture §5.2.
- Every request is validated against a DTO schema (`class-validator` decorators in NestJS) before it reaches a service — malformed input never reaches the Orchestrator or database layer.
- Every response (success or error) follows one envelope shape for non-streaming endpoints:
```
{ success: boolean, data?: <payload>, error?: { code: string, message: string } }
```

### 4.4 Status codes
`200` success · `201` resource created (document upload, admin creation) · `400` validation failure · `401` missing/invalid auth · `403` authenticated but insufficient role · `404` resource not found · `429` rate limit exceeded (§11) · `503` a required upstream (LLM, vector DB) is unavailable and no fallback succeeded — this maps directly to the frontend's `server-busy` error state, never a silent `200` with a fabricated answer.

---

## 5. AI Orchestration Layer

This is the layer where "never hallucinate" is enforced as an architectural property, not a prompt-engineering hope.

### 5.1 Message arrival
The Chat Service hands the Orchestrator a validated `{ message, conversationId, sessionId }`. The Orchestrator does not trust that this message is safe or answerable yet — that determination happens in the steps below, not assumed at entry.

### 5.2 Conversation history retrieval
The Orchestrator fetches the last N turns (configurable, default 6) for `conversationId` from Redis first (hot cache of active conversations), falling back to PostgreSQL if not cached (§11). This history is used for two things only: pronoun/entity resolution (§5.3) and giving the LLM enough context to not repeat itself — it is **never** treated as a source of facts about the college; facts only ever come from retrieval (§5.5), never from what the model previously said.

### 5.3 Entity resolution
A lightweight resolution step (rule-based first, LLM-assisted only if ambiguous) determines what "it"/"its"/"there" refers to, using the most recently mentioned named entity (department, office, document) — mirroring Conversation Design v2 §11's rules exactly, now as a concrete backend step rather than a described behavior.

### 5.4 Retrieval query construction
The resolved message (with pronouns expanded to their actual entity) is embedded and used as the semantic search query — never the raw user message when it contains an unresolved pronoun, since "its fees" embedded alone loses all retrieval signal.

### 5.5 Retrieval — how official documents are searched (hybrid)
Pure dense-vector search is deliberately not used alone. Semantic embeddings are strong at conceptual matches ("hostel regulations" ≈ "rules for students living on campus") but weak at exact-match content — fee amounts, phone numbers, dates, course codes, regulation numbers — which is a large share of what students actually ask. Retrieval is therefore hybrid by design:

1. **Dense embedding:** the resolved query is embedded via the same model used at ingestion time (§6.5) — model consistency between ingestion and query is non-negotiable, since mismatched embedding spaces silently degrade retrieval quality without any visible error.
2. **Sparse keyword search (BM25):** the same resolved query is simultaneously scored against a sparse/BM25 index of the same chunks, stored as sparse vectors alongside the dense embeddings (§8) — this is what catches exact tokens (a fee figure, a form number, a phone number, a regulation code) that a dense embedding can smooth over into "close enough."
3. **Hybrid search:** both searches run against Qdrant, optionally pre-filtered by metadata (e.g., department, document type) when the query strongly implies a category, narrowing the space before either search runs.
4. **Reciprocal Rank Fusion (RRF):** the two independently-ranked candidate lists (dense top-K, sparse top-K) are merged into one ranked list using RRF. RRF is chosen specifically because it fuses on *rank position*, not raw score — cosine similarity and BM25 scores are not on comparable scales, so a fusion method that never has to compare them directly avoids the tuning fragility of trying to weight two incompatible scoring systems against each other.
5. **Cross-encoder re-ranking** (§5.8): the RRF-fused top candidates are re-scored by a cross-encoder re-ranker against the actual resolved query text, and the top-N (default N=3–4) survive into the prompt. RRF produces a good candidate *set* by combining two complementary retrieval signals; re-ranking is still what decides final relevance and ordering within that set.

This hybrid-then-rerank pipeline is what lets the system answer "what's the EEE tuition fee" and "what's the placement cell's phone number" as reliably as more conceptual questions — the class of query pure dense retrieval historically handles worst, and precisely the class where a wrong-but-plausible answer is most consequential.

### 5.6 Confidence scoring — the retrieval gate (hallucination prevention, gate one)
A confidence score is computed from the re-ranker's top result score after hybrid fusion (§5.5), not the LLM's own self-reported confidence (LLMs are unreliable judges of their own certainty — this is precisely the failure mode this system exists to prevent).

- **Above threshold:** proceed to generation (§5.9), grounded strictly in the retrieved chunks.
- **Below threshold:** generation is **not attempted at all**. The Orchestrator emits `{ type: "error", code: "no-data" }` directly — this is the exact mechanism behind Conversation Design v2's "No official information found" `.state-card.warn`. The LLM is never given the chance to "try anyway," because a model asked to answer without sufficient context will often produce a plausible-sounding but ungrounded answer regardless of instructions.
- This gate stops most ungrounded answers before generation is ever attempted. It does **not**, by itself, guarantee that an answer generated from good context stays faithful to that context — that is a distinct failure mode, and it is what §5.7 exists to catch.

### 5.7 Post-generation groundedness verification — the generation gate (hallucination prevention, gate two)
Retrieval confidence (§5.6) only guarantees that relevant context was found — it does not guarantee the generated answer actually stayed faithful to that context. An LLM given good context can still embellish a detail, misstate a figure, or blend in adjacent knowledge from its own training that was never in the retrieved chunks. This is a distinct failure mode from a retrieval miss, and the document previously had no mechanism to catch it; it now does, as a second, independent gate.

This check runs **at request time, on every generated answer, in production** — it is a runtime control, not only an offline evaluation metric. (§19's AI tests validate this gate's behavior in CI against a golden dataset; the check itself additionally executes live, on every real answer, every time.)

**Mechanism:** after the LLM Gateway (§5.9) returns a complete generated answer, the Orchestrator runs a lightweight faithfulness check — an NLI (natural language inference) style model, or a narrowly-constrained LLM-as-judge pass — against the specific chunks that answer was grounded in (only those chunks, not the whole knowledge base). The check covers, specifically:
- **Claim entailment:** every material sentence in the generated answer must be entailed by the retrieved context, not merely plausible alongside it.
- **Numerical verification:** any figure the answer states as fact (a fee amount, a date, a cutoff rank, a phone number) is checked token-for-token against the source chunk it's attributed to — this is the same class of exact-match content §5.5's hybrid retrieval was built to find, and it would defeat the point of finding it accurately if a correctly-retrieved number could still be transcribed incorrectly at generation time.
- **Citation verification:** each citation attached to the answer (§5.10) is checked to confirm the cited chunk actually supports the specific claim it's attached to, not just that the cited document was somewhere in the retrieved set.

This pattern — retrieve, generate, then independently verify the generation against its own retrieved evidence before ever showing it to a user — reflects current production RAG practice (the same faithfulness/groundedness principle behind evaluation frameworks like RAGAS, applied here at runtime rather than only in offline evaluation) rather than a bespoke mechanism invented for this system.

- **Pass:** the answer proceeds to citation attachment and streaming (§5.10, §5.11).
- **Fail** (an unsupported or contradicted claim is detected): the Orchestrator discards the generated answer entirely and returns the same `no-data` refusal path as a retrieval-confidence failure. From the client's perspective, a failed groundedness check and a failed retrieval-confidence check render identically — Conversation Design v2's "No official information found" state. The user is never shown a partially-trusted or "best effort" answer; there is no middle tier between "verified" and "refused."

Together, §5.6 and §5.7 are deliberate defense-in-depth against two different points of failure: good context not being found, and good context not being honored. Neither gate alone is sufficient — retrieval confidence cannot detect generation-time drift, and a groundedness check has nothing to verify against if retrieval already failed silently.

### 5.8 Cross-encoder re-ranking detail and degradation behavior
Re-ranking uses the actual resolved query text against each candidate chunk's full text (not just its embedding) — this catches cases where two chunks are hybrid-ranked closely but only one actually answers the specific question asked (e.g., "EEE fees" vs. "EEE admission" chunks can sit close together in a fused ranking but are not interchangeable answers).

**Degradation behavior (re-ranker unavailable or times out):** the request is never failed solely because the re-ranking step is down. The Orchestrator falls back to the RRF-fused hybrid ranking from §5.5 as-is (skipping the cross-encoder step), but lowers the confidence ceiling applied in §5.6 accordingly — since the document already treats cross-encoder re-ranking as materially more precise than fusion ranking alone, a degraded ranking should never be trusted at the same confidence level a fully-ranked one would be. This keeps the system available during a re-ranker outage without quietly pretending the degraded ranking is as reliable as normal; see also §13's error table, which documents this as an explicit, named degradation state rather than a generic failure.

### 5.9 Prompt assembly & generation
The final prompt sent to the LLM Gateway is assembled from four parts, always in this order: (1) a fixed system instruction (persona, tone, and the explicit "only answer from provided context, decline otherwise" rule, aligned to Conversation Design v2 §2's voice), (2) the resolved conversation history, (3) the top-N re-ranked chunks with their source metadata inline, (4) the current resolved question. The model generates its complete answer server-side before anything is sent to the client — this is what makes the §5.7 groundedness check possible, since there must be a complete generated answer to verify before any of it is exposed. The model is instructed to produce output in a structured format the Orchestrator can parse into the frontend's chunk contract (plain sentence vs. a card-worthy structured answer), not free-form prose it has to guess at classifying afterward.

### 5.10 Citation attachment
Every chunk used in the final, *verified* answer carries its source document ID and section metadata from the Knowledge Base (§8). The Orchestrator maps these into the citation fields of the `component` chunk (feeding `.verified-badge` / `.source-line` per Conversation Design v2 §6.1) — citations are **structural output of retrieval**, never generated or guessed by the LLM itself, and are only ever attached after the answer has already passed both §5.6 and §5.7.

### 5.11 Follow-up chip generation
A rule-first, LLM-assisted-fallback approach: each document/FAQ category carries a curated set of likely follow-up topics (matching the static sets already defined in Conversation Design v2 §12); the Orchestrator selects from this curated set based on which document category answered the question. Only when no curated set exists for a novel topic does it fall back to asking the LLM to suggest 3–5 short related questions, constrained to the same domain — this keeps follow-ups fast, predictable, and cheap for the common case, with a fallback for genuinely novel questions.

### 5.12 Provider failure behavior (v1: single provider, no live failover)
v1 launches with a single primary LLM provider (§2) behind the LLM Gateway's provider-agnostic interface. If that provider fails (timeout, 5xx, rate-limited), the Orchestrator does **not** attempt a live failover to a second provider in v1 — there isn't a second one registered. The failure is instead classified through the standard error path (§13: `503` / `server-busy`), identical in shape to a database or vector-DB outage from the client's perspective. The Gateway abstraction's value is realized when a second provider is added post-launch (§20): at that point, failover becomes a configuration and routing addition inside the existing Gateway interface, not a change to the Orchestrator's grounding, confidence-gating, or groundedness-verification logic, none of which has ever depended on which provider produced an answer.

### 5.13 Latency budget (SLOs)
Every pipeline stage above has a stated target so that §15's monitoring and alerting are checked against real numbers rather than an abstract "feels slow":

| Stage | Target (p95) |
|---|---|
| Vector/hybrid retrieval (§5.5, dense + sparse + RRF) | < 150 ms |
| Cross-encoder re-ranking (§5.8) | < 300 ms |
| Groundedness verification (§5.7) | < 400 ms |
| Time-to-first-token, end to end (user sends → first visible content) | < 2.5 s |
| Full response completion — plain text answers | < 8 s |
| Full response completion — card/skeleton-path answers (Frontend Architecture §3) | < 12 s |

These targets are deliberately generous relative to what a well-tuned pipeline should achieve — they are the thresholds at which §15's alerting fires, not aspirational numbers, and they exist specifically so a regression in any one stage (e.g., the groundedness check silently getting slower as its model is upgraded) is caught at that stage rather than surfacing only as an undifferentiated "the bot feels slow" complaint.

---

## 6. Retrieval-Augmented Generation (RAG) Pipeline

| Stage | Detail |
|---|---|
| **1. Ingestion** | Documents enter via admin upload (§9) or scheduled crawl (§16). Each ingested item gets a stable `documentId` and version number. |
| **2. Cleaning** | Extracted text is normalized: whitespace/OCR artifact cleanup, boilerplate (headers/footers repeated on every page) stripped, encoding normalized. Cleaning is logged with before/after samples for the first ingestion of a new document type, so a bad cleaning rule is caught by a human before it silently corrupts retrieval quality at scale. |
| **2a. PII detection, redaction & review** | Runs on the cleaned text, before chunking — full detail in §9's ingestion pipeline, which this stage defers to rather than duplicating. No document reaches chunking/embedding while in a `FlaggedForReview` state. |
| **3. Chunking** | Semantic chunking (paragraph/section-aware, not fixed-character-count) with overlap (~10–15%) between adjacent chunks so an answer spanning a chunk boundary isn't lost. Target chunk size tuned to the embedding model's effective context, not maximized for fewer chunks. |
| **4. Metadata tagging** | Each chunk carries: source `documentId`, document title, department/category, publish/update date, page/section reference, and a document-type tag (policy, fee structure, circular, FAQ, etc.) — this metadata is what powers filtered retrieval (§5.5) and what becomes the citation shown to the user. |
| **5. Embedding generation** | Each chunk is embedded using a single, versioned embedding model. The model identifier is stored alongside the embedding so that a future model upgrade can be detected and trigger re-embedding rather than silently mixing incompatible vector spaces. |
| **6. Vector database storage** | Embeddings + metadata stored in Qdrant, organized by collection (§8). |
| **7. Hybrid search** | At query time, dense embedding and sparse/BM25 search both run, fused via Reciprocal Rank Fusion (§5.5). |
| **8. Re-ranking** | Cross-encoder re-ranking narrows the fused candidates to the N most genuinely relevant (§5.8); degrades gracefully to fusion-only ranking if the re-ranker is unavailable (§5.8, §13). |
| **9. Context assembly** | Retrieved chunks are deduplicated (if two chunks from the same document/section both surface, merge) and ordered by relevance before insertion into the prompt. |
| **10. Final prompt creation** | Per §5.9. |
| **11. Response generation** | Per §5.9 — the model produces its complete answer server-side before anything reaches the client. |
| **12. Citation generation** | Per §5.10 — structural, not generative. |
| **13. Source verification** | Before a citation is shown to the user, the Orchestrator confirms the cited `documentId` is still marked "Published" (not archived/superseded) in PostgreSQL — a chunk in the vector index that's stale relative to a newer document version must never be cited as current (§9 covers how versioning prevents this at the source). |
| **14. Confidence scoring** | Per §5.6 — computed pre-generation, gating whether generation happens at all. |
| **15. Groundedness verification** | Per §5.7 — computed post-generation, gating whether the answer is ever streamed to the user. Listed here as the pipeline's final gate, though it executes chronologically right after stage 11 and before stage 12. |

---

## 7. Database Architecture (PostgreSQL)

| Table | Key columns (representative, not exhaustive) | Relationships |
|---|---|---|
| **Sessions** | id, sessionToken (hashed), createdAt, expiresAt, ipHash | Referenced by Conversations |
| **Conversations** | id, sessionId, startedAt, lastActivityAt, isArchived | Has many Messages; belongs to a Session |
| **Messages** | id, conversationId, role (user/assistant), content, componentType, retrievalConfidenceScore, groundednessResult (pass/fail — always "pass" for any message actually delivered, retained for audit trail even though a "fail" is never shown to the user), latencyMs, createdAt | Belongs to Conversation; cited documents are recorded via `MessageCitations`, not an inline array (see below) |
| **MessageCitations** | id, messageId, documentId, documentVersionId, chunkId, relevanceScore, createdAt | Belongs to Message; references Documents and DocumentVersions — one row per citation, so a message with three citations has three rows, each individually queryable and constrained by real foreign keys |
| **Feedback** | id, messageId, isHelpful, freeText, createdAt | Belongs to Message |
| **Documents** | id, title, department, documentType, storageUrl, currentVersionId, isActive, uploadedBy, createdAt | Has many DocumentVersions; referenced by MessageCitations |
| **DocumentVersions** | id, documentId, versionNumber, extractedText, contentHash, status (`Draft` → `FlaggedForReview` → `Approved` → `Published`, with `Superseded` as the terminal state once a newer version is Published), piiReviewedBy, indexedAt | Belongs to Document |
| **FAQs** | id, question, answer, category, isActive, curatedBy | Independent fast-path retrieval source |
| **Departments** | id, name, code, hodName, contactEmail | Referenced by Documents, FAQs (as category filters) |
| **Announcements** | id, title, body, publishAt, expiresAt, isActive, priority | Independent time-sensitive content, injected into retrieval when active |
| **Logs** | id, correlationId, level, message, metadata (JSONB), createdAt | Append-only, partitioned by date (§14) |
| **AnalyticsEvents** | id, eventType, conversationId, metadata (JSONB), createdAt | Feeds the Analytics module (§4.2, §16) — kept separate from operational Logs so analytics queries never compete with debug-log volume |
| **Admins** | id, email, passwordHash, roleId, mfaEnabled, mfaSecret (encrypted at rest), isActive, lastLoginAt | Belongs to Role |
| **Roles** | id, name (e.g., SuperAdmin, ContentEditor, Viewer) | Has many Permissions |
| **Permissions** | id, roleId, resource, action | Belongs to Role |
| **RefreshTokens** | id, adminId, tokenHash, expiresAt, revokedAt | Belongs to Admin — supports rotation and revocation |

**Key relational rules worth stating explicitly:**
- Citations live in `MessageCitations`, a proper join table, specifically because an inline array column would lose foreign-key integrity (no enforcement on individual elements), require non-standard indexing (GIN) for a common query pattern ("which messages cite document X"), and couldn't represent per-citation detail (which chunk, which document *version*, what relevance score) that the system actually needs — `MessageCitations.documentVersionId` is what lets a historical answer remain auditable even after a document is later updated, resolving to whichever version was current *at generation time*.
- `AnalyticsEvents` and `Logs` are deliberately separate tables with different retention policies (§14, §15) — analytics data is kept indefinitely in aggregate, raw logs are rotated/archived on a much shorter cycle.
- `DocumentVersions.status` is a single state machine (`Draft` → `FlaggedForReview` → `Approved` → `Published` → `Superseded`) rather than the separate `isSuperseded` boolean used in an earlier revision of this schema — one column now represents the full lifecycle (§9), including the PII-review checkpoint, instead of two overlapping flags. This single `status` column is also what satisfies the review's request for a `flaggedForReview`/`reviewStatus` signal: `status = 'FlaggedForReview'` **is** that signal — adding a second, separate boolean or status field alongside it would recreate exactly the kind of redundant, driftable dual-flag problem the `isSuperseded` consolidation above was meant to eliminate.

---

## 8. Vector Database Design (Qdrant)

| Aspect | Design |
|---|---|
| **Collections** | One primary collection (`official_documents`) holding all chunk embeddings; a second, smaller collection (`faqs`) for curated FAQ embeddings, queried first as a fast-path before falling back to the full document collection — a matched FAQ is cheaper and more reliably phrased than a freshly generated RAG answer for very common questions |
| **Embeddings** | Each chunk carries **both** a dense embedding (semantic similarity) and a sparse vector (BM25-weighted term representation) — stored together on the same point, not in separate collections, so a single query touches both representations without a second round-trip. Dense embedding dimensionality and sparse vocabulary are both fixed per the chosen models; the model version is stored as point metadata so a future model migration can be detected and the collection re-indexed rather than mixed |
| **Sparse vectors** | The keyword-search half of hybrid retrieval (§5.5) — generated at ingestion time from the same cleaned, chunked text as the dense embedding, so the two representations are always in sync with each other and with the source document |
| **Metadata (payload)** | `documentId`, `documentVersionId`, `department`, `documentType`, `publishedDate`, `isActive` — stored as Qdrant payload fields to enable filtered search (§5.5) |
| **Similarity search** | Cosine similarity for the dense vector; BM25-style term-weighting for the sparse vector — run as two parallel queries against the same collection, not two separate collections |
| **Hybrid indexing & fusion** | Qdrant's native support for combined dense + sparse vectors on one point is what makes hybrid search practical without standing up a second search system; the two ranked result lists it returns are fused via **Reciprocal Rank Fusion (RRF)** outside Qdrant, in the Orchestrator (§5.5) — RRF combines the lists by rank position rather than raw score, which avoids having to normalize or weight cosine-similarity scores against BM25 scores, two numbers that were never on a comparable scale to begin with |
| **Filtering** | Payload-based pre-filtering (e.g., `department = "EIE"`) applied *before* either search when the resolved query strongly implies a category, narrowing the search space and improving both speed and precision for both the dense and sparse legs |
| **Ranking** | Hybrid search (dense + sparse + RRF) provides the fused candidate set; cross-encoder re-ranking (§5.8) is a separate step outside Qdrant, since Qdrant's native scoring — on either vector type — is a coarse relevance signal, not a final relevance judgment |
| **Update strategy** | New document version → new points inserted (both dense and sparse vectors) with the new `documentVersionId`; old version's points get `isActive: false` set on their payload rather than being immediately deleted, preserving the ability to audit what a past answer was grounded in |
| **Versioning** | Handled at the payload level (`documentVersionId`), not via separate collections per version — keeps the collection count stable and searches simple |
| **Deletion** | Hard deletion only on explicit admin action (e.g., a document was uploaded in error, or content was redacted for PII reasons post-publication per §9) — routine supersession is a soft `isActive: false` flip, not a delete, for auditability |

**Why hybrid retrieval specifically improves exact-match queries:** dense embeddings represent meaning as a continuous vector, which is precisely what makes them bad at distinguishing "₹45,000" from "₹54,000," or one course code from a similar-looking one — both pairs can sit close together in embedding space because they're semantically similar contexts, even though they are factually not interchangeable. A sparse/BM25 signal scores on literal term overlap, so it surfaces the chunk that actually contains the specific figure, code, or number being asked about, independent of how "semantically similar" it is to the query. Fusing the two (rather than picking one) means the system doesn't have to guess in advance whether a given question is the conceptual kind dense search handles well or the exact-match kind sparse search handles well — both signals are always considered, and RRF lets whichever one actually found the right chunk win on rank.

---

## 9. Document Management System

1. **Upload:** admin uploads via `/admin/upload` (multipart) — file lands in object storage first, a `Documents`/`DocumentVersions` row is created in `Draft` state.
2. **Parsing:** a background worker (§16) picks up the pending document. PDFs are parsed via a text-extraction library first; if extracted text is empty or below a length threshold (a strong signal the PDF is a scanned image), it's routed to an OCR pipeline instead. Word documents (DOCX) are parsed via a dedicated DOCX-text-extraction step, kept separate from the PDF path since the two formats fail in different ways.
3. **OCR:** scanned/image-based PDFs go through OCR (e.g., Tesseract or a cloud OCR API), producing extracted text that is then cleaned identically to natively-extracted text — from cleaning onward, both paths converge into one pipeline.
4. **Cleaning:** whitespace/OCR-artifact normalization and boilerplate stripping, per §6 stage 2.
5. **PII detection:** the cleaned text is scanned for personal data before it goes anywhere near chunking or embedding — regex-based detection for structured PII (phone-number-shaped, ID/Aadhaar-shaped, and similar patterns), plus a Named Entity Recognition pass for personal names appearing outside an expected official-contact context. This step exists because official college documents can incidentally contain personal data — admission lists, scanned forms with an applicant's personal phone number — and once embedded, that content becomes *retrievable and quotable to any anonymous student who asks the right question*, a materially different exposure than the file simply existing on a server. This is treated as a compliance-relevant step given India's Digital Personal Data Protection Act (DPDP Act, 2023) and the fact that this is a government institution's data.
6. **Automatic redaction:** high-confidence structured PII matches (clearly phone-number-shaped or ID-number-shaped patterns) are redacted automatically in the extracted text, before that text is ever chunked or embedded — never embedded even transiently, then redacted after the fact.
7. **Manual review (if required):** lower-confidence or ambiguous detections (e.g., a name-shaped NER match with unclear context) do not auto-redact. The `DocumentVersion.status` transitions to `FlaggedForReview` and the pipeline halts there — it is never chunked or embedded in this state — until an admin confirms or edits the redaction via the admin dashboard and advances it to `Approved`.
8. **Duplicate detection:** a content hash (of the cleaned, post-redaction extracted text, not the raw file bytes, so a re-saved PDF with identical content but different file metadata is still caught) is computed and checked against existing `DocumentVersions`. An exact match is rejected with a clear admin-facing message rather than silently re-indexing identical content; a near-duplicate (high but not exact similarity) is flagged for admin review rather than auto-rejected, since it may be a genuine update.
9. **Versioning & archiving:** a new `Published` version of an existing document supersedes the prior one (`status` transitions to `Superseded` on the old `DocumentVersion`, `isActive: false` on its vector points per §8) — the old version's row and file remain in storage/DB for audit purposes, they are not deleted.
10. **Indexing:** only ever runs on a `DocumentVersion` in `Approved` or `Published` state — a `Draft` or `FlaggedForReview` version is never chunked or embedded, since gating embedding is the entire purpose of steps 5–7. Once chunking/embedding (§6) succeeds, the version transitions to `Published` and becomes retrievable. This entire pipeline is asynchronous — an admin uploading a large PDF does not block on a synchronous request; the admin dashboard polls or receives a status update, including a visible `FlaggedForReview` queue distinct from normal processing.

---

## 10. Authentication & Authorization

| Concern | Design |
|---|---|
| **Anonymous student sessions** | No login required to chat (matches the approved conversation design — students are not asked to authenticate to ask a question). `/v1/session` issues a short-lived, rotate-on-use session token, delivered as an **httpOnly, Secure, `SameSite=Lax` cookie** — never `localStorage` — so the token itself is inaccessible to JavaScript and therefore not exposed by an XSS vulnerability in either the widget or the host page it's embedded in (Frontend Architecture §5.8's "no-op today, additive later" auth injection point is unaffected by this choice — it's additive on top of it) |
| **JWT (admin)** | Short-lived access token (e.g., 15 min) + longer-lived refresh token (e.g., 7 days), both delivered as httpOnly, Secure, `SameSite=Lax` cookies, not returned in a JSON body for client-side storage — access tokens are never long-lived enough to matter much if leaked, and neither token is ever reachable by JavaScript |
| **Refresh tokens** | Stored hashed in `RefreshTokens`, one row per issued token. **Rotation is mandatory on every use**: exchanging a refresh token immediately invalidates it server-side and issues a new one — a stolen, already-used refresh token is worthless, and reuse of an invalidated token is treated as a security event (§14) and can trigger revocation of the entire token family for that admin |
| **Admin login** | `Email → Password → Password verification → TOTP MFA → JWT issuance → Dashboard`. Password is hashed with a modern algorithm (bcrypt/argon2); **MFA is mandatory for every administrator, with no opt-out for any role tier** — a password-verified login without a valid TOTP code never reaches JWT issuance. Failed attempts (password or MFA) are rate-limited and logged as a security event (§14) |
| **Multi-factor authentication** | TOTP-based (standard authenticator app), enforced at `/admin/login` for all roles without exception — `Admins.mfaEnabled` and `Admins.mfaSecret` (§7) back this; `mfaSecret` is encrypted at rest, never logged, and never returned in any API response |
| **Role-Based Access Control** | `Roles` → `Permissions` (resource + action pairs, e.g., `documents:write`, `analytics:read`) — a `RolesGuard` on admin routes checks the required permission against the authenticated admin's role, declared per-route via a decorator, not scattered conditional logic |
| **Permission system** | Deliberately resource+action shaped (not a flat list of role names hardcoded into route checks) so adding a new role (e.g., "Department Editor" who can only manage their own department's documents) is a data change, not a code change |
| **Session management** | Student sessions are stateless-ish (Redis-cached, Postgres-backed, expiring) — no admin-grade session complexity is applied to anonymous traffic, since that would be needless overhead at the scale this system must support |
| **CSRF protection** | Because both student session tokens and admin JWTs are now cookie-delivered (above), CSRF is a live concern, not a dismissed one — protected via the **double-submit cookie pattern**: a separate, readable (non-httpOnly) CSRF token is issued alongside the session/auth cookie, and every state-changing request (`POST`/`PATCH`/`DELETE`) must echo it back in a request header, which a cross-site request cannot forge without already being able to read the page's own cookies |
| **Security flow** | All auth endpoints behind stricter rate limits than general traffic (§11); all admin auth events (login, failed login, MFA failure, token refresh, revocation) are audit-logged (§14) |
| **Future student login** | The `Sessions` table already models a session as a first-class entity separate from `Conversations` specifically so that "upgrading" an anonymous session to an authenticated student identity later is a matter of associating a new `studentId` foreign key, not restructuring how conversations are stored |

---

## 11. Caching Strategy (Redis)

| Use | TTL | Invalidation |
|---|---|---|
| **Session cache** | Matches session token expiry | Explicit delete on logout/expiry; passive expiry otherwise |
| **Conversation history cache** | Sliding window, refreshed on each new message (e.g., 30 min idle TTL) | Invalidated on new message write (cache updated, not just expired) — keeps §5.2's history fetch fast without ever serving genuinely stale context |
| **Popular answers cache** | Hours, not minutes — for FAQ-matched or very-high-confidence repeated questions, the fully assembled response (including citations) can be cached by a normalized query key, skipping the LLM call entirely for the most common questions | Invalidated whenever the source document/FAQ it depends on is updated (tracked via a reverse index of cache-key → source documentId) — a cached answer must never outlive the document it cites |
| **Rate limiting counters** | Sliding window per session/IP (§11 below ties into §12) | Natural TTL expiry |
| **Token/embedding cache** | Query embeddings for identical recent queries cached briefly (minutes) to avoid redundant embedding-API calls during rapid back-and-forth on the same topic | Short TTL, no explicit invalidation needed given the short window |

**Why Redis for all of these rather than separate systems:** at this system's realistic scale (a single college, thousands of concurrent users during peak admission season, not millions), one well-understood piece of infrastructure serving multiple caching needs is a simpler, more reliable operational story than standing up dedicated systems (a separate rate-limiter service, a separate session store) that each need their own monitoring and failure handling.

---

## 12. Security Architecture

| Concern | Approach |
|---|---|
| **Prompt injection protection** | User input is never concatenated directly into the system prompt as an instruction — it is always inserted into a clearly delimited "user question" slot the system prompt explicitly instructs the model to treat as data, not instructions. Retrieved document chunks are similarly delimited as "reference context," not commands. This is a mitigation, not a guarantee (no LLM-based system can be made 100% immune to prompt injection) — defense-in-depth here means the retrieval-confidence gate (§5.6) and the post-generation groundedness gate (§5.7) also limit the blast radius: even a successful injection can't make the system cite a document that was never actually retrieved, and a manipulated-but-ungrounded answer still fails the groundedness check before it's ever streamed |
| **SQL injection** | Parameterized queries exclusively via the ORM (TypeORM/Prisma) — no raw string-concatenated SQL anywhere in the codebase, enforced via lint rule, not just convention |
| **XSS** | Mirrors the Frontend Architecture's §13 stance: the backend never returns raw HTML in any response field; all text is plain string or well-defined structured JSON the frontend renders through its own sanitized Markdown pipeline |
| **CSRF** | Now a live, addressed concern rather than a dismissed one, since §10 moved both student session tokens and admin JWTs to httpOnly cookies (better XSS protection, but cookies are sent automatically by the browser on cross-site requests unless mitigated). Protected via the **double-submit cookie pattern** detailed in §10: a readable CSRF token cookie plus a required matching header on every state-changing request |
| **CORS policy** | Explicit origin allow-list, not a wildcard — required because the approved Frontend Architecture's embed model (its §1.1) means the browser calls this API cross-origin from the college's existing site. Allowed origins: `https://gcetly.ac.in`, `https://www.gcetly.ac.in`, `https://staging.gcetly.ac.in` (staging only reachable from the staging build). Wildcard (`*`) origins are prohibited outright, including during development — a local-dev origin is added explicitly to the allow-list for local work instead. `credentials: true` is set (required for the cookie-based auth in §10 to function cross-origin), and preflight (`OPTIONS`) requests are handled explicitly for all state-changing methods |
| **Rate limiting** | Tiered: a generous per-session limit on `/v1/chat` (protects against a single runaway client), a stricter per-IP limit across all endpoints (protects against distributed abuse from one source), and a much stricter limit on `/admin/login` specifically (protects against credential-stuffing) — implemented at both NGINX (coarse, cheap) and application level (Redis-backed, precise, aware of session identity) |
| **DDoS protection** | NGINX-level connection limits and request buffering as the first line; for production deployment, a CDN/edge proxy in front of NGINX (e.g., Cloudflare) is the recommended additional layer — documented as a deployment recommendation (§18) rather than application code, since this is fundamentally an infrastructure concern |
| **File upload security** | Uploaded documents (§9) are restricted by MIME type and size at the gateway before ever reaching the parsing pipeline; files are scanned (antivirus/malware scanning service) before being moved from a quarantine bucket into the active document storage bucket — the parsing pipeline never touches an unscanned file |
| **Secrets management** | API keys (LLM providers, storage credentials, DB credentials) live in a secrets manager (cloud provider's native secrets service, or a self-hosted equivalent like Vault for full data-residency control) — never in `.env` files committed to version control, and never logged, including in error logs (§13/§14 explicitly scrub known secret-shaped values) |
| **Environment variables** | Validated at boot (§3's `env.validation.ts`) — the application refuses to start with a missing/malformed required variable rather than failing unpredictably at first use |
| **Encryption** | TLS in transit everywhere (enforced at NGINX); sensitive columns (password hashes, token hashes) already stored hashed, not encrypted-and-reversible, since they never need to be read back in plaintext; object storage uses provider-level encryption at rest |
| **HTTPS** | Enforced end-to-end; HTTP requests redirected, never proxied in plaintext |
| **Audit logging** | Every admin action that changes state (document upload/delete, role change, announcement published) is written to an append-only audit trail distinct from general application logs (§14) — this is what lets the college answer "who changed what, when" months later |

---

## 13. Error Handling

A single global exception filter (NestJS) normalizes every possible failure into the response contract's `error` shape — no unhandled exception ever reaches the client as a raw stack trace.

| Failure | Normalized code | Behavior |
|---|---|---|
| Validation error (bad request shape) | `400` / `validation-error` | Rejected before touching any service — cheapest possible failure |
| Timeout (LLM or retrieval taking too long) | `503` / `server-busy` | Matches Frontend Architecture §5.3's mapping exactly — the frontend already knows how to render this |
| AI/LLM provider failure | `503` / `server-busy` | v1 has a single provider (§5.12) — a provider failure is classified the same as any other upstream failure; the frontend does not need to distinguish "LLM failed" from "database was slow," both are "the system is temporarily unable to answer" |
| Re-ranker degraded (timeout/unavailable) | Not a failure — request continues | Falls back to RRF-fused hybrid ranking without cross-encoder re-ranking (§5.8); the retrieval-confidence gate (§5.6) applies a lowered ceiling to reflect the weaker signal. The request is **never** failed solely because re-ranking is unavailable |
| Groundedness verification failure | `200` (within the stream) / `no-data` | Not a transport error — the generated answer is discarded and never streamed; the user receives the identical "No official information found" experience as a retrieval-confidence failure (§5.7) |
| Database failure | `503` / `server-busy` | Circuit-breaker pattern: after repeated DB failures within a short window, the health check (§15) flips to unhealthy and the load balancer stops routing new traffic to that instance, rather than every request individually timing out against a dead connection |
| Vector DB failure | `503` / `server-busy` (retrieval-specific) — **never** silently skip retrieval and let the LLM answer ungrounded | This is the one failure mode where "fail open" would be actively dangerous (it would mean answering without grounding) — the system always fails *closed* here, refusing rather than risking a hallucinated answer |
| Redis failure | Degraded, not failed — conversation history falls back to a direct (slower) PostgreSQL read; rate limiting falls back to a conservative in-memory-per-instance limit | Redis is a performance layer, not a correctness dependency, by design — its failure should never take down the ability to answer, only slow it down |
| Unexpected/unclassified exception | `500` / `unexpected` | Logged with full context server-side (§14); client sees only the generic "something went wrong" message, never internal detail |

**Graceful fallback principle stated once, applied everywhere:** every failure mode above resolves to one of exactly the categories Frontend Architecture §5.3 already defined. The backend's error handling job is to correctly *classify* failures into that existing small set, not to invent new client-facing error states.

---

## 14. Logging

- **Structured logging** (JSON, not free-text) throughout — every log line is machine-parseable from day one, which matters once log volume makes manual reading impractical.
- **Correlation IDs**: a unique ID generated at the API Gateway/middleware level for every incoming request, threaded through every downstream service call and into every log line and analytics event produced while handling it — this is what makes it possible to reconstruct the full lifecycle of one user's question across Chat Service, Orchestrator, LLM Gateway, and database writes.
- **Log levels**: `debug` (verbose, disabled in production by default), `info` (normal operation events — request received, response sent), `warn` (recoverable issues — retrieval confidence borderline, re-ranker degradation triggered), `error` (failures requiring attention).
- **Audit logs**: separate stream/table from operational logs (§12) — admin actions specifically, retained longer than routine debug logs.
- **Admin logs**: login/logout, permission changes, content changes — a subset of audit logs specifically surfaced in the admin dashboard for transparency.
- **Security logs**: failed auth attempts, rate-limit triggers, detected prompt-injection-shaped input — routed to a higher-priority alerting path (§15) than routine warnings.
- **AI logs**: every generated answer logged with its retrieval confidence score, groundedness verification result (§5.7), cited documents, latency, and which provider served it — this is the primary dataset for auditing whether the "never hallucinate" constraint is holding in production, and for the unanswered-question review queue (§16) the college uses to identify gaps in official documentation.

---

## 15. Monitoring

| Area | Approach |
|---|---|
| **Health checks** | `/v1/health` (liveness — is the process running) and `/v1/health/deep` (readiness — are DB, Redis, vector DB, and at least one LLM provider reachable) exposed separately, since a load balancer's routing decision and an on-call engineer's diagnosis need different granularity |
| **Metrics** | Exposed in Prometheus format: request rate, error rate, and latency percentiles (p50/p95/p99) per endpoint, tracked against the explicit targets in §5.13; retrieval confidence and groundedness-verification score distributions; hybrid retrieval stage timing (dense, sparse, RRF fusion, re-rank) broken out individually |
| **Latency** | End-to-end (user sends → first token received) tracked separately from AI-specific latency (retrieval time, re-ranking time, generation time, groundedness-check time) so a slowdown can be attributed to the actual bottleneck rather than treated as one undifferentiated "the bot is slow" signal — each stage is checked against its own §5.13 target, not just the end-to-end number |
| **AI response time** | Tracked per pipeline stage (hybrid retrieval → re-rank → generation → groundedness verification) specifically because this is the part of the system most likely to be the actual bottleneck at scale, and the stage breakdown is what makes that bottleneck actionable rather than mysterious |
| **CPU / memory** | Standard container-level metrics (via the container runtime/orchestrator's built-in exporters) — not reinvented, just wired into the same alerting pipeline as application metrics |
| **Alerts** | Threshold-based alerts on: any pipeline stage in §5.13 breaching its p95 target, overall error rate spike, health check failures, unusual spike in `no-data` responses (which could indicate either a genuine documentation gap trending in real time or a retrieval-layer regression — either way, worth a human looking), and an elevated groundedness-verification failure rate specifically (a sustained increase there is a strong signal of a prompt or retrieval regression, not just noise) |
| **Dashboards** | A small number of purpose-built dashboards rather than one sprawling one: system health (uptime/latency/errors against §5.13's SLOs), AI quality (retrieval confidence distribution, groundedness pass/fail rate, no-data rate), and usage (tied into §16's analytics, but presented operationally here for the engineering team, distinct from the admin-facing business dashboard) |

---

## 16. Background Workers

| Worker | Trigger | Responsibility |
|---|---|---|
| **Document processing** | New/updated document uploaded | Runs the full parse → clean → chunk → embed → index pipeline (§9) asynchronously |
| **Embedding generation** | Enqueued by document processing, or by an embedding-model migration | Isolated as its own worker/queue specifically so embedding-API rate limits are managed independently of the parsing pipeline's throughput |
| **Scheduled crawlers** | Cron schedule (e.g., nightly) | Re-fetches designated official web pages (e.g., an admissions page not manually re-uploaded each time it changes) and diffs against the last known content; a genuine change triggers the same ingestion pipeline as a manual upload |
| **Announcement sync** | Cron / on-demand | Publishes/expires time-sensitive `Announcements` rows automatically based on their `publishAt`/`expiresAt` fields, so time-sensitive content doesn't require manual admin intervention to appear or disappear on schedule |
| **Email notifications** (future) | Event-driven | Stubbed as a queue processor now, unimplemented — placeholder for §20's future expansion, kept as a separate worker so adding it doesn't touch existing job types |
| **Queue processing** | Continuous | BullMQ workers consume the above job types from Redis-backed queues, with retry-with-backoff on transient failures (e.g., a temporary OCR service outage) and dead-letter handling for jobs that exhaust retries, surfaced to the admin dashboard rather than silently dropped |

Workers run as separate processes/containers from the request-handling API instances — a burst of document-processing load during a bulk admin upload must never compete with request-handling capacity for CPU.

---

## 17. Performance & Scalability

1. **Horizontal scaling:** Chat Service instances are stateless (all conversation state lives in Redis/Postgres, never in-process memory) — this is what makes it possible to run N identical instances behind a load balancer with no sticky-session requirement.
2. **Load balancer:** NGINX (or a cloud load balancer in front of it) distributes traffic across instances; health checks (§15) remove an unhealthy instance from rotation automatically.
3. **Stateless services:** reiterated as a hard rule, not just Chat Service — the Orchestrator, LLM Gateway, and Knowledge Base access layer hold no per-request state beyond the lifetime of that request, for the same horizontal-scaling reason.
4. **Connection pooling:** PostgreSQL connections pooled (via PgBouncer or the ORM's built-in pooling) — critical once instance count grows, since Postgres has a hard ceiling on concurrent connections that naive per-instance connection counts would exhaust quickly.
5. **Caching:** per §11 — the single biggest performance lever available for a Q&A system like this, since a meaningful fraction of real traffic is repeated/similar questions.
6. **Streaming:** the chat response is streamed to the client as a server-paced, progressive reveal once the answer has passed groundedness verification (§5.7/§1.3 step 10) — not buffered and dumped whole, and not a live pass-through of unverified model tokens either. This is what makes the frontend's `StreamingText` component (Frontend Architecture §3) actually meaningful rather than cosmetic: the user still sees text appear progressively, but only ever verified text, which is the deliberate trade of a small, bounded verification delay (§5.13's target: < 400 ms) for the guarantee that nothing ungrounded is ever visible, even transiently.
7. **Async processing:** anything not required to produce the immediate answer (logging, analytics event writes, document indexing) happens off the request's critical path via the queue (§16) — the user's response time is never held hostage by bookkeeping.
8. **Future Kubernetes deployment:** Docker Compose is sufficient for the college's realistic initial load; Kubernetes becomes the right choice specifically when auto-scaling based on real traffic patterns (e.g., admission-season spikes) becomes worth the added operational complexity — the containerized, stateless design (points 1–3 above) means this migration is a deployment-tooling change, not an application rewrite, when that day comes.

---

## 18. Deployment Architecture

| Environment | Purpose |
|---|---|
| **Development** | Local Docker Compose stack (all services + Postgres + Redis + Qdrant), seeded with sample documents so a new engineer can run the full RAG pipeline against realistic (non-production) data on day one |
| **Testing** | Ephemeral environment spun up per CI run (§19), torn down after — never shares data with staging/production |
| **Staging** | Mirrors production configuration at smaller scale; where new document ingestion pipelines and prompt/model changes are validated against real (or realistic anonymized) traffic patterns before release |
| **Production** | Multi-instance Chat Service behind NGINX/load balancer, managed Postgres (with read replica once read load justifies it), managed or self-hosted Redis, self-hosted or managed Qdrant per the college's data-residency decision (§2) |

- **Docker:** every service (API, workers, and their dependencies) built as versioned images; the same image is promoted staging → production, never rebuilt per environment, so what's tested is exactly what ships.
- **NGINX:** TLS termination, reverse proxy, first-line rate limiting (§12), and static asset caching for anything the backend serves directly (unlikely at scale, mostly a frontend concern, but the capability exists).
- **CI/CD:** automated pipeline — lint → typecheck → unit/integration tests (§19) → build images → deploy to staging automatically on merge to main → production deploy gated on a manual approval step, given this is a government institution's public-facing system where an unreviewed bad deploy has real reputational cost.
- **Cloud deployment:** cloud-agnostic by design (Docker + standard Postgres/Redis/S3-compatible interfaces) — the specific provider is a cost/data-residency decision for the college, not an architectural lock-in.
- **Backup strategy:** automated daily PostgreSQL backups with point-in-time recovery enabled; object storage (documents) versioned at the bucket level; vector DB collections backed up on a schedule tied to ingestion frequency (no need to back up more often than content actually changes) — with periodic **restore drills**, not just backup jobs that are never tested.
- **Disaster recovery:** documented RTO/RPO targets appropriate to a college assistant (not a financial system) — target measured in hours, not seconds; a secondary-region cold-standby is a reasonable target for a future phase, not a day-one requirement given realistic risk tolerance at this scale.

---

## 19. Testing Strategy

| Layer | Tool (representative) | Coverage |
|---|---|---|
| **Unit tests** | Jest | Pure logic: confidence-score calculation, chunk deduplication, RBAC permission evaluation, DTO validation rules |
| **Integration tests** | Jest + a real (test-scoped) Postgres/Redis via Docker | Service-to-repository interactions, queue job processing end-to-end within one service boundary |
| **API tests** | Supertest (against a running NestJS test instance) | Every endpoint in §4.2 — correct status codes, correct envelope shape, auth/RBAC enforcement |
| **AI tests** | A curated golden-question set with known-correct expected citations, run against a test document corpus | Regression testing specifically for both hallucination-prevention gates: asserts that questions with no grounding correctly produce `no-data` at the retrieval-confidence gate (§5.6), and — separately — that a deliberately-corrupted generation (a claim not actually present in the retrieved context) is correctly caught and refused by the groundedness gate (§5.7), not just that clear-grounding questions correctly cite the right document. This is the test suite that matters most for the system's core promise |
| **Security tests** | OWASP ZAP or equivalent automated scan in CI, plus targeted prompt-injection test cases fed through the real Orchestrator against a test knowledge base | Validates §12's protections aren't just documented but actually hold |
| **Load tests** | k6 or Artillery | Simulated concurrent-user spikes (modeling admission-season traffic specifically, since that's the realistic peak-load scenario for this system) against staging, validating §17's scaling assumptions before they're needed for real |
| **End-to-end tests** | Playwright, against a full staging deployment (frontend + backend together) | The complete user journey from Frontend Architecture §14's E2E suite, now validated against the real backend rather than mocks — the single test layer that actually proves frontend and backend integrate correctly |

---

## 20. Future Expansion — architectural readiness

| Future capability | Why this architecture already supports it |
|---|---|
| **Voice assistant** | The Orchestrator's input is already just resolved text regardless of source — a speech-to-text step ahead of it and a text-to-speech step after its output are additive integrations at the transport edge, not a change to retrieval/generation/citation logic |
| **Tamil support** | The RAG pipeline is largely language-agnostic if a multilingual embedding model is used (or a translation step is added before embedding/retrieval) — the Orchestrator's grounding logic doesn't change; only the embedding model choice and system prompt language need updating, consistent with Frontend Architecture §16's parallel readiness note |
| **WhatsApp integration** | A new thin controller (WhatsApp Business API webhook → same `ChatService`/`Orchestrator` call) — the core answer-generation pipeline is channel-agnostic by construction (§3's module boundary between `chat/` transport concerns and `orchestrator/` reasoning concerns exists specifically to make this cheap) |
| **Mobile app** | Consumes the exact same `/v1/chat` API — no backend change required, purely a frontend/client concern |
| **Faculty / Student / Parent portals** | Extensions of the RBAC system already in place (§10) — new roles and permission sets, not new authentication architecture |
| **Analytics dashboard** (richer than §16's baseline) | `AnalyticsEvents` is already a distinct, purpose-built table (§7) precisely so richer aggregation/visualization can be built on top of existing data without a schema migration |
| **Fine-tuned model** | The LLM Gateway's provider-agnostic interface (§2, §5.12) means both a second off-the-shelf provider and a future fine-tuned/self-hosted model are additional "provider" implementations behind the same interface — the Orchestrator's grounding, confidence-gating, and groundedness-verification logic is unaffected, since none of it has ever depended on any specific provider's behavior |
| **Multi-campus support** | `Departments` already exists as a distinct entity or, and metadata filtering (§8) already supports category-scoped retrieval — adding a `Campus` dimension follows the identical pattern already established for `Department`-scoped filtering, rather than requiring a new retrieval mechanism |

---

## Summary of constraints honored

- No frontend component, route, or interaction was altered — the backend was designed entirely around Frontend Architecture §5.2's existing streamed-response contract.
- No conversation behavior was reinterpreted — §5 and §6 implement Conversation Design v2's rules (grounding, refusal-over-guessing, citation format, follow-up chip sourcing) as concrete backend mechanisms, not new decisions.
- No code was generated — every section specifies structure, schema, and responsibility, not implementation.
- The "never hallucinate" requirement is treated as an architectural property enforced by two independent gates — retrieval confidence, pre-generation (§5.6), and groundedness verification, post-generation (§5.7) — not a single point of failure resting on prompt wording alone.

---

## Change Log — Version 1 → Version 2

Applied against the pre-development Design Review. No item below changed the underlying system design, module boundaries, or section numbering beyond what was strictly required to integrate the fix.

| ID | Finding | Fixed in | Summary of change |
|---|---|---|---|
| **C1** | No hybrid retrieval — pure dense-vector search misses exact-match content (fees, phone numbers, dates, codes) | §5.5, §6 (stages 7–8), §8 | Retrieval is now dense embedding + sparse/BM25 search, fused via Reciprocal Rank Fusion, then cross-encoder re-ranked. Qdrant stores both dense and sparse vectors on the same point — no second vector database introduced. |
| **C2** | No post-generation faithfulness check — the confidence gate only verified retrieval, not the generated answer | §1.3, §5.6, §5.7 (new), §5.9 | Added a second, independent gate: after generation, the Orchestrator verifies claim entailment, numerical values, and citation accuracy against the specific retrieved chunks. Failure returns the existing "No official information found" refusal — the answer is never streamed. |
| **C3** | No PII detection in document ingestion | §7 (`DocumentVersions.status`), §9 | Ingestion now runs PII detection (regex + NER) after cleaning and before chunking/embedding. Structured PII (phone numbers, Aadhaar-like numbers, emails) is auto-redacted; ambiguous cases (names in unexpected contexts, personal addresses, student identifiers) enter an admin review queue via the `FlaggedForReview` state — see the note in §7 on why this is one consolidated `status` field rather than separate `flaggedForReview`/`reviewStatus` columns. |
| **C4** | No admin MFA | §7 (`Admins` table), §10 | TOTP-based MFA is now mandatory for every admin role, no opt-out. Login sequence is Email → Password → TOTP → JWT. `mfaEnabled`/`mfaSecret` added to `Admins`. |
| **H1** | Session token storage was unstated; CSRF dismissal rested on that gap | §10, §12 | Both student session tokens and admin JWT/refresh tokens are now explicitly httpOnly, Secure, `SameSite=Lax` cookies — never `localStorage` — with mandatory refresh-token rotation. CSRF is now actively protected via the double-submit cookie pattern rather than dismissed. |
| **H2** | `Messages.citedDocumentIds[]` was a denormalized array with no FK integrity | §7 | Replaced with a `MessageCitations` join table (`id`, `messageId`, `documentId`, `documentVersionId`, `chunkId`, `relevanceScore`, `createdAt`), giving each citation its own enforced, queryable row. |
| **H3** | No CORS policy, despite the approved embed-widget model requiring cross-origin requests | §12 | Added an explicit origin allow-list (production domain + approved staging domain only), wildcard origins prohibited, `credentials: true` to support the cookie-based auth from H1, preflight handled explicitly. |
| **H4** | No documented re-ranker failure/degrade path | §5.8, §13 | Re-ranker failure now falls back to Reciprocal-Rank-Fusion-only ranking with a lowered confidence ceiling; the request is never failed solely because re-ranking is unavailable — documented as a named degradation state, not a generic error. |
| **H5** | No stated latency SLO anywhere in the document | §5.13 (new), §15 | Added explicit p95 targets (TTFT < 2.5s, full text response < 8s, plus per-stage targets for retrieval, re-ranking, and groundedness verification) that §15's monitoring and alerting now reference directly. |

**Not changed, by design:** H6 (dual-provider failover) was addressed in the prior revision already incorporated here — v1 launches with a single primary provider behind the still-provider-agnostic LLM Gateway (§2, §5.12); this is preserved as-is. Medium and Low findings from the review (pagination, DB indexing detail, distributed tracing, IaC, connection draining, etc.) were intentionally left out of this pass — the brief for this revision scoped it to Critical and High findings only, and pulling in additional improvements beyond that would have gone against the "targeted changes only" instruction this revision was given.

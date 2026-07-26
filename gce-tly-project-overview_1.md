# GCE Tirunelveli AI Assistant — Project Overview / Master Architecture Document

**Role of this document:** the entry point to the complete project documentation set. It summarizes and connects seven already-finalized documents — Requirements Specification, Conversation Design v2, Frontend Architecture, Backend Architecture, API Specification, Database Design, and Deployment & DevOps Architecture — without redesigning, contradicting, or duplicating their detailed content. A reader should leave this document knowing *what* the system is and *where* to look for any specific detail, not knowing every detail itself.

---

## 1. Executive Summary

| Item | Summary |
|---|---|
| Project | GCE Tirunelveli AI Assistant |
| Type | AI-powered Retrieval-Augmented Generation (RAG) chatbot |
| Institution | Government College of Engineering, Tirunelveli |
| Core promise | Grounded, hallucination-resistant answers from official college information only |
| Primary users | Students, parents, faculty, alumni, visitors (anonymous); administrative staff (authenticated, MFA-protected) |
| Deployment model | Embedded widget on the existing college website, plus a standalone page |
| Governing constraint | Never answer without a verifiable official source; refuse rather than guess |

## 2. Project Overview
The GCE Tirunelveli AI Assistant is a conversational interface that answers questions about admissions, courses, hostel, placements, fees, and other institutional matters, grounded exclusively in official documents ingested and verified through a two-gate hallucination-prevention pipeline (Backend Architecture §5.6/§5.7). It is built on a finalized, fully documented architecture spanning conversation design, frontend, backend, API, database, and deployment — each captured in its own authoritative document, summarized and cross-referenced here.

## 3. Vision Statement
A trustworthy, always-available conversational entry point to GCE Tirunelveli's official information — answering plainly, citing its source, and declining rather than fabricating, for every student, parent, faculty member, alumnus, and visitor who asks.

## 4. Mission Statement
`[NEW — assumption]` No prior document stated a mission distinct from the vision (§3); the mission below operationalizes that vision as an ongoing institutional commitment, necessary because a master overview document conventionally distinguishes the two: **to continuously maintain a verified, current knowledge base and a reliable conversational interface that reduces the effort required for anyone to get an accurate answer about GCE Tirunelveli, without ever trading accuracy for speed.**

## 5. Business Objectives

| ID | Objective |
|---|---|
| BO-001 | Provide instant, 24/7 access to official college information |
| BO-002 | Reduce routine-inquiry load on administrative offices |
| BO-003 | Ensure every answer is verifiable against a real, published source |
| BO-004 | Maintain institutional trust by refusing rather than guessing when uncertain |

## 6. Problem Statement
Information about GCE Tirunelveli is currently obtained through a static website, phone calls, and in-person office visits — none of which provide an instant, source-verified answer to a specific question at the moment it is asked.

## 7. Proposed Solution
A Retrieval-Augmented Generation AI assistant, embedded on the official website, answering exclusively from ingested and verified official documents, with two independent hallucination-prevention gates and a complete admin workflow for keeping the knowledge base current — detailed fully across the six architecture documents this one summarizes.

## 8. Project Scope
Web-based AI chat assistant (embed and standalone), RAG over official documents, admin document management/review/publishing workflow, anonymous visitor access with MFA-protected admin access, and full production deployment, monitoring, backup, and disaster recovery.

## 9. Out of Scope
Voice input/output, Tamil language support, WhatsApp integration, a dedicated mobile application, authenticated student/faculty/parent portals, a fine-tuned model, and multi-campus support — see §35.

## 10. Stakeholders

| Stakeholder | Interest |
|---|---|
| College leadership | Institutional trust, accurate public information |
| Registrar / Admissions office | Reduced inquiry volume, accurate admissions data |
| Content editors (admin) | Safe, usable tools to keep information current |
| Students, parents, faculty, alumni, visitors | Fast, accurate, trustworthy answers |
| Engineering / DevOps team | An implementable, operable system matching the finalized architecture |

## 11. Target Users
Prospective and current students, parents/guardians, faculty, alumni, and campus visitors (anonymous); college administrative staff acting as Content Editors, Reviewers, and Publishers (authenticated, role-based).

## 12. User Personas

| Persona | Goal |
|---|---|
| Prospective student | Understand admission eligibility, cutoff, process |
| Parent | Understand fees, hostel, safety, contact information, in plain language |
| Current student | Quick answers to department, exam, library, bus-route questions |
| Content editor (admin) | Keep official documents current, safely and auditably |

## 13. High-Level Features

| Feature | Description |
|---|---|
| Conversational Q&A | Grounded answers with citations, streamed progressively |
| Refusal on uncertainty | Explicit "no official information found" rather than a guess |
| Follow-up suggestions | Context-relevant next questions after every answer |
| Document transparency | Public browsing of the documents the assistant is grounded in |
| Admin document workflow | Upload, PII review, approval, and publishing |
| Announcements & FAQs | Curated, time-sensitive and fast-path content |
| Usage analytics | Top questions, unanswered questions, feedback sentiment |

## 14. High-Level System Architecture

```
                     ┌───────────────────────────┐
                     │  gcetly.ac.in (existing)     │
                     │  ┌─────────────────────┐    │
                     │  │  Embedded AI Widget    │    │
                     │  └──────────┬─────────┘    │
                     └─────────────┼──────────────┘
                                   │ HTTPS
                     ┌─────────────▼──────────────┐
                     │   NestJS Backend + AI          │
                     │   Orchestrator (RAG pipeline)    │
                     └─────────────┬──────────────┘
                                   │
              ┌─────────────────────┼─────────────────────┐
              │                    │                    │
     ┌────────▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐
     │ PostgreSQL         │  │ Qdrant            │  │ Redis             │
     │ (system of record) │  │ (retrieval index) │  │ (cache/session)   │
     └────────────────────┘  └────────────────────┘  └────────────────────┘
```

## 15. AI Overview
Answers are generated only after retrieval succeeds with sufficient confidence and the generated answer independently passes a post-generation groundedness check — two distinct, independent gates (Backend Architecture §5.6/§5.7), not one. A single primary LLM provider (OpenAI) is used at launch, behind a provider-agnostic gateway that allows a second provider to be added later without touching the grounding logic (Backend Architecture §5.12).

## 16. RAG Pipeline Overview

```
User Question
   ↓
Dense Embedding  +  Sparse (BM25) Search
   ↓
Reciprocal Rank Fusion
   ↓
Cross-Encoder Re-ranking
   ↓
Retrieval Confidence Gate ──fail──► Refusal ("No official information found")
   ↓ pass
LLM Generation
   ↓
Groundedness Verification ──fail──► Refusal (same outcome as above)
   ↓ pass
Citations Attached  →  Streamed to User
```

## 17. System Components Overview

| Component | Role |
|---|---|
| Next.js frontend (embed + standalone) | User-facing chat widget and standalone page |
| NestJS backend | API layer, orchestration, business logic |
| Python AI Service (internal only) | Embedding generation, cross-encoder re-ranking, groundedness verification |
| PostgreSQL + pgvector | System of record; also powers FAQ/analytics similarity matching |
| Qdrant | Hybrid dense + sparse retrieval index |
| Redis | Session cache, conversation cache, rate limiting, job queue |
| NGINX | Edge gateway, TLS termination, reverse proxy |

## 18. Technology Stack Summary

| Layer | Technology |
|---|---|
| Frontend | Next.js, React, Tailwind CSS |
| Backend | NestJS |
| AI | OpenAI, RAG, Embeddings, Hybrid Search, Cross-Encoder Re-ranking, Groundedness Verification |
| Database | PostgreSQL, pgvector, Redis, Qdrant |
| Streaming | Server-Sent Events |
| Authentication | Cookie-based, JWT, Admin MFA |
| Infrastructure | Docker, Docker Compose, NGINX, Ubuntu Linux LTS |

## 19. Architecture Principles

| Principle | Applied as |
|---|---|
| Fail closed, not open | Never answer ungrounded; refuse instead (Backend Architecture §13) |
| Statelessness at the application tier | Horizontal scaling without redesign (Backend Architecture §17) |
| Single source of truth per fact | Every citation resolves to one PostgreSQL row (Database Design §1.4) |
| Additive-first change | Expand/contract migrations, versioned APIs (Database Design §19.2, API Specification §10) |
| Defense in depth | Two independent hallucination gates; layered security controls | 

## 20. Security Overview
Mandatory admin MFA with no opt-out, cookie-based authentication (httpOnly, Secure, SameSite=Lax), CSRF double-submit protection, an explicit CORS allow-list, and role-based access control — detailed fully in Backend Architecture §10/§12 and API Specification §2/§8.

## 21. Scalability Overview
Stateless NestJS and Python AI Service instances scale horizontally without code change; PostgreSQL scales via read replica before sharding is considered; Kubernetes adoption is deliberately deferred until real traffic data justifies it (Backend Architecture §17).

## 22. Performance Goals
Time-to-first-token p95 < 2.5s; full text-answer response p95 < 8s; card/skeleton-path response p95 < 12s; non-chat JSON endpoints p95 < 500ms (API Specification §9.8).

## 23. Reliability Goals
A vector database or LLM failure results in refusal, never an ungrounded answer; a cache failure degrades performance only, never correctness (Backend Architecture §13).

## 24. Availability Goals
99.5% monthly uptime target for chat and session endpoints, with separate liveness and readiness health checks (Database Design §13.11; API Specification §4.1.7/§4.3.1).

## 25. Deployment Overview

```
Push to main → CI (lint/test/build) → Staging (auto) → Manual approval
   → Database migration → Rolling deploy to production → Health check
```
Docker-containerized services on Ubuntu Linux LTS, orchestrated via Docker Compose, fronted by NGINX — full detail in Deployment & DevOps Architecture.

## 26. Data Flow Overview

```
Student types question
   → Frontend sends POST /v1/chat
   → Backend resolves conversation context
   → Orchestrator retrieves + verifies (see §16)
   → Verified answer + citations persisted to PostgreSQL
   → Streamed to frontend via SSE
```

## 27. High-Level API Overview
A versioned REST/SSE API (`/v1/`) covering anonymous chat, session, feedback, and document browsing, plus an MFA-protected admin API for document management, review, publishing, announcements, FAQs, analytics, and configuration — full endpoint-level detail in API Specification.

## 28. High-Level Database Overview
PostgreSQL is the system of record for conversations, messages, citations, documents and their versions, admin/RBAC data, and audit logs; Qdrant holds the retrieval index; Redis holds cache, session, and queue state — full schema detail in Database Design.

## 29. Document Structure

```
Project Overview (this document)
        │
        ├── Requirements Specification
        ├── Conversation Design v2
        ├── Frontend Architecture
        ├── Backend Architecture
        ├── API Specification
        ├── Database Design
        └── Deployment & DevOps Architecture
```

## 30. Traceability to Other Documents

| Document | Covers |
|---|---|
| Requirements Specification | Business/functional requirements, success criteria |
| Conversation Design v2 | Tone, personality, response templates, conversational rules |
| Frontend Architecture | Component structure, state management, theming, embed model |
| Backend Architecture | RAG pipeline, hallucination-prevention gates, module structure |
| API Specification | Every endpoint, streaming contract, error codes |
| Database Design | Schema, indexes, state machines, retention |
| Deployment & DevOps Architecture | Infrastructure, CI/CD, monitoring, disaster recovery |

**Document dependency chain** (build order, not reading order):

```
Requirements
   ↓
Conversation Design
   ↓
Frontend Architecture
   ↓
Backend Architecture
   ↓
API Specification
   ↓
Database Design
   ↓
Deployment & DevOps Architecture
   ↓
Project Overview  (this document — synthesizes all preceding documents)
```
This document was produced last, after every other document, specifically so it could summarize a finalized set rather than a moving target — but it is intended to be *read* first by a new stakeholder or engineer.

## 31. Risks

| Risk | Mitigation |
|---|---|
| Single-provider LLM outage | Provider-agnostic gateway; second provider addable later |
| PII detection edge case missed | Human review queue as a safety net |
| Admission-season traffic spike underestimated | Horizontal scaling design; load testing recommended |

## 32. Assumptions
Every `[NEW — assumption]` marked across all seven prior documents, plus the mission statement (§4) added in this one — none hidden.

## 33. Constraints
Fixed technology stack (§18); no architecture, API, schema, or authentication change permitted by this or any prior document without a formal revision.

## 34. Success Metrics

| Metric | Target |
|---|---|
| System availability | ≥ 99.5% monthly |
| TTFT p95 | < 2.5 s |
| Groundedness-verification failure rate | Trending down over time |
| Citation coverage on factual answers | 100% |

## 35. Future Roadmap (out of scope)
Voice input/output, Tamil language support, WhatsApp integration, a dedicated mobile application, authenticated student/faculty/parent portals, a fine-tuned model, and multi-campus support — all explicitly deferred, none designed against beyond documented extensibility (Backend Architecture §20).

## 36. Glossary
RAG, PII, RBAC, MFA, SSE, SLO, DPDP Act — defined identically to API Specification §13.13; not redefined here to avoid divergent definitions across the document set.

## 37. References
Requirements Specification; Conversation Design v2; Frontend Architecture; Backend Architecture; API Specification; Database Design; Deployment & DevOps Architecture.

## 38. Appendix

### System Context Diagram
```
        ┌───────────┐        ┌────────────────┐        ┌──────────────┐
        │  Visitor    │──────►│  AI Assistant    │◄──────│  Admin         │
        │ (anonymous) │        │  (this system)   │        │ (authenticated) │
        └───────────┘        └───────┬────────┘        └──────────────┘
                                     │
                            ┌────────▼────────┐
                            │  Official College   │
                            │  Documents          │
                            └────────────────────┘
```

### Component Relationship Diagram
```
Frontend ──HTTPS──► Backend ──► Orchestrator ──► Knowledge Base (Postgres + Qdrant)
                                     │
                                     └──► LLM Gateway ──► OpenAI
Backend ──► Redis (cache/session/queue)
```

### User Interaction Diagram
```
Visitor ──ask question──► Chat Widget ──► Backend ──► Answer + Citation
Admin ───upload doc─────► Admin Console ─► Backend ──► Review Queue / Published
```

### Documentation Hierarchy Diagram
```
Project Overview
   ├── Requirements Specification
   ├── Conversation Design v2
   ├── Frontend Architecture
   ├── Backend Architecture
   │        ├── API Specification
   │        └── Database Design
   └── Deployment & DevOps Architecture
```

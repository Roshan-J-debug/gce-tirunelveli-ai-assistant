# GCE Tirunelveli AI Assistant — Deployment & DevOps Architecture Document

**Derived strictly from:** Requirements Specification, Conversation Design v2, Frontend Architecture, Backend Architecture, API Specification, and Database Design — all finalized. This document describes exclusively how the already-approved system is deployed, secured, monitored, and operated in production. No API, database schema, conversation flow, frontend architecture, or backend architecture is modified, redesigned, or reinterpreted here. Every assumption required to make deployment concrete but not explicitly stated upstream is marked `[NEW — assumption]` with a one-sentence justification.

**Finalized technology stack (reproduced, not redecided):** Next.js/React/Tailwind CSS (frontend); NestJS (backend); OpenAI, RAG, embeddings, cross-encoder re-ranking, groundedness verification (AI — the internal Python AI Service hosting the embedding/re-ranking/groundedness models was already fixed in API Specification §3 and is preserved here unchanged); PostgreSQL + pgvector, Redis, Qdrant (data); Server-Sent Events (streaming); cookie-based authentication, JWT, mandatory admin MFA (auth); Docker, Docker Compose, NGINX (infrastructure); Ubuntu Linux LTS (operating system).

---

## 1. Introduction

This document is the operational counterpart to six already-approved architecture documents. Where those documents answer "what does the system do and how is it built," this document answers only "how does it run, where does it run, and how is it kept running." A DevOps engineer should be able to provision every environment, wire every pipeline, and operate every failure scenario described here directly from this text, without opening any of the six upstream documents except for cross-reference.

Nothing in this document introduces a new technology, replaces a finalized one, or changes an interface. Every section either operationalizes a decision already made upstream or fills a genuine deployment-level gap those documents were never meant to cover, marked explicitly.

## 2. Deployment Objectives

| Objective | Upstream source |
|---|---|
| Serve thousands of concurrent students during admission-season peaks without application redesign | Backend Architecture §17 (stateless services) |
| Meet fixed latency SLOs under real production load: TTFT p95 < 2.5s, full text response p95 < 8s, card/skeleton-path response p95 < 12s, non-chat JSON endpoints p95 < 500ms | API Specification §9.8 |
| Never serve an answer that bypassed either hallucination-prevention gate, even under infrastructure stress | Backend Architecture §5.6/§5.7, §13 |
| Preserve data residency and audit posture appropriate to a government institution | Backend Architecture §2, §9; Database Design §12, §13 |
| Zero-downtime rolling deploys, given long-lived SSE connections must never be hard-cut mid-answer | Backend Architecture §17 |
| Cloud-agnostic infrastructure — no provider lock-in | Backend Architecture §18 |

## 3. Deployment Principles

1. **Immutable, content-addressed artifacts.** Every deployable image is tagged by git commit SHA, never `latest` — what was tested in staging is bit-for-bit what runs in production.
2. **Stateless application tier, stateful data tier.** NestJS, the Python AI Service, and both Next.js builds hold no durable state in-process — every fact that must survive a restart lives in PostgreSQL, Qdrant, or Redis, exactly as Backend Architecture §17 already establishes.
3. **Fail closed, not open, at every infrastructure layer, not just the application layer.** Backend Architecture §13's "never silently skip retrieval and let the LLM answer ungrounded" principle extends to this document: a monitoring gap, a missing health check, or an unencrypted secret is treated with the same severity as a missing retrieval-confidence gate.
4. **Additive-first change.** Infrastructure changes prefer expand/contract sequencing (Database Design §19.2) over destructive, one-shot changes — true of schema migrations and equally true of NGINX config, environment variables, and DNS records in this document.
5. **One environment definition, many environments.** Development, staging, and production differ only in scale and data, never in topology or configuration mechanism (§13, §37, §38).

---

## 4. Production Architecture

```
                              ┌───────────────────────────────┐
                              │     DNS  +  CDN (embed assets) │
                              └───────────────┬───────────────┘
                                              │  HTTPS (443)
                              ┌───────────────▼───────────────┐
                              │      NGINX (edge / gateway)     │
                              │  TLS termination, CORS,          │
                              │  coarse rate limiting             │
                              └───────┬───────────────┬─────────┘
                                      │               │
                     ┌────────────────▼───┐   ┌───────▼────────────┐
                     │ Next.js (standalone) │   │ NestJS Backend (×N)│
                     │  /assistant route     │   │  Fastify adapter   │
                     └───────────────────────┘   └───────┬────────────┘
                                                          │
                        ┌─────────────────────────────────┼──────────────────────┐
                        │                                 │                      │
              ┌─────────▼─────────┐             ┌─────────▼─────────┐  ┌─────────▼─────────┐
              │ Python AI Service   │             │ Redis               │  │ Qdrant             │
              │ (internal only —    │             │ session/cache/queue │  │ hybrid vector index │
              │ embeddings, re-rank,│             └─────────────────────┘  └────────────────────┘
              │ groundedness)       │
              └─────────┬───────────┘
                        │
              ┌─────────▼───────────────────┐
              │ PostgreSQL 16 + pgvector      │
              │ primary + streaming replica   │
              └────────────────────────────────┘
```

Every box above corresponds to a component already named in Backend Architecture §1/§3 and Database Design §2 — this diagram adds only the deployment-time detail (edge gateway, replica, CDN) those documents deliberately left to this one.

## 5. Infrastructure Architecture

| Layer | Component | Deployment unit | Scale |
|---|---|---|---|
| Edge | NGINX | Container | 1–2, active/passive or load-balanced |
| Application | NestJS backend | Container, N replicas | Horizontal, stateless |
| Application | Next.js standalone | Container | Horizontal, stateless |
| Application | Next.js embed bundle | Static assets | CDN-distributed, not a server process |
| AI | Python AI Service | Container, N replicas | Horizontal, internal-only |
| Data | PostgreSQL 16 + pgvector | VM or managed service | Primary + 1 read replica |
| Data | Redis | Container or managed service | Single instance (Database Design §16.4) |
| Data | Qdrant | Container or VM | Single node (Database Design §16.3) |
| Storage | Object storage | Managed S3 or self-hosted MinIO | Bucket-versioned |

`[NEW — assumption]` Concrete instance counts (e.g., "N=3 NestJS replicas") are not fixed here — no upstream document specified a target concurrency number precisely enough to derive one; §28 gives the scaling *trigger*, not a static count, which is the architecturally consistent way to leave this open without contradicting anything.

## 6. Server Architecture

All servers run **Ubuntu 22.04 LTS** as the host operating system, per the finalized stack. Container base images are chosen to be Debian/Ubuntu-family (not Alpine) specifically so native dependencies in the Python AI Service (BLAS/LAPACK-linked ML libraries) and the NestJS backend behave identically to the host OS's `glibc`, avoiding the class of subtle native-module bugs that Alpine's `musl libc` can introduce for ML workloads — this is the one deliberate departure from a prior draft of this document that used Alpine, made here specifically because this prompt fixes Ubuntu LTS as the operating system.

| Server role | Base image | Host OS |
|---|---|---|
| NGINX | `nginx:1.27` (Debian-based) | Ubuntu 22.04 LTS |
| NestJS backend | `node:20-bookworm-slim` | Ubuntu 22.04 LTS |
| Next.js (standalone) | `node:20-bookworm-slim` | Ubuntu 22.04 LTS |
| Python AI Service | `python:3.11-slim-bookworm` | Ubuntu 22.04 LTS |
| PostgreSQL | `postgres:16` (Debian-based) | Ubuntu 22.04 LTS |
| Redis | `redis:7-bookworm` | Ubuntu 22.04 LTS |
| Qdrant | `qdrant/qdrant:latest` (Debian-based) | Ubuntu 22.04 LTS |

---

## 7. Docker Architecture

Each service is built independently (Backend Architecture §3's module boundaries), so a change to one service never forces a rebuild of another.

```dockerfile
# NestJS backend — multi-stage, Ubuntu-family base
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
USER app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
```

```dockerfile
# Python AI Service — internal only, never exposes a public port in production
FROM python:3.11-slim-bookworm AS build
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim-bookworm AS runtime
WORKDIR /app
RUN groupadd -r ai && useradd -r -g ai ai
COPY --from=build /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY . .
USER ai
EXPOSE 8001
CMD ["python", "server.py"]
```

A non-root `USER` directive is used in every runtime stage — a container compromise never yields root inside the container, which matters most for the Python AI Service and NestJS backend, the two services that ever touch untrusted input (student chat messages, uploaded documents).

## 8. Docker Compose Design

Two compose files, not one — development uses all services on one Docker network; staging/production use the same service definitions but reference external managed data services where applicable (§13).

```yaml
# docker-compose.dev.yml
services:
  nginx:
    build: ./infra/nginx
    ports: ["80:80", "443:443"]
    depends_on: [backend, frontend-standalone]

  frontend-standalone:
    build: ./apps/frontend
    environment:
      - NODE_ENV=development

  backend:
    build: ./apps/backend
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://app:app@postgres:5432/gcetly
      - REDIS_URL=redis://redis:6379
      - QDRANT_URL=http://qdrant:6333
      - AI_SERVICE_URL=http://ai-service:8001
    depends_on: [postgres, redis, qdrant, ai-service]

  ai-service:
    build: ./apps/ai-service
    # no published port — internal network only, matching production's isolation

  postgres:
    image: postgres:16
    environment:
      - POSTGRES_DB=gcetly
      - POSTGRES_USER=app
      - POSTGRES_PASSWORD=app
    volumes: ["pgdata:/var/lib/postgresql/data"]
    command: ["postgres", "-c", "shared_preload_libraries=pgvector"]

  redis:
    image: redis:7-bookworm

  qdrant:
    image: qdrant/qdrant:latest
    volumes: ["qdrantdata:/qdrant/storage"]

volumes:
  pgdata:
  qdrantdata:
```

`[NEW — assumption]` `shared_preload_libraries=pgvector` is the standard, documented way to enable the `pgvector` extension named in Database Design §1's stack — stated explicitly since Database Design specified the extension but not the runtime flag needed to load it.

## 9. Container Networking

A single internal Docker bridge network (`gcetly_internal`) hosts every service except NGINX's public-facing listener. No service other than NGINX binds a port to the host in staging/production. Service-to-service resolution uses Docker's internal DNS (service name as hostname) — `backend` reaches `postgres`, `redis`, `qdrant`, and `ai-service` by name, never by IP.

```
Internet
   │  443
┌──▼───────────┐
│    nginx      │  ←── only container with a published port
└──┬───────────┘
   │  (internal bridge network: gcetly_internal)
┌──▼──────────────────────────────────────────────────────┐
│  backend  frontend-standalone  ai-service  postgres      │
│  redis    qdrant                                          │
└────────────────────────────────────────────────────────────┘
```

## 10. Reverse Proxy Architecture (NGINX)

```nginx
upstream backend_upstream {
    least_conn;
    server backend_1:3000;
    server backend_2:3000;
}

server {
    listen 443 ssl http2;
    server_name api.gcetly.ac.in;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location /v1/chat {
        proxy_pass http://backend_upstream;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;        # required for SSE — never buffer a stream (Backend Architecture §5)
        proxy_read_timeout 120s;
    }

    location / {
        proxy_pass http://backend_upstream;
        proxy_set_header X-Correlation-Id $request_id;
    }
}
```

`proxy_buffering off` on the `/v1/chat` location is the single most important NGINX directive in this document — SSE's entire benefit (Backend Architecture §5, API Specification §5) is defeated if NGINX buffers the response before forwarding it.

## 11. SSL/TLS Configuration
TLS 1.2 minimum, TLS 1.3 preferred, terminated at NGINX. Certificates issued via an automated ACME client (e.g., Certbot), auto-renewed on a 60-day cycle with a 30-day safety margin before the standard 90-day certificate expiry. No plaintext HTTP is ever proxied to an application container — HTTP requests are redirected to HTTPS at the NGINX layer, never accepted downstream.

## 12. Domain Strategy

| Domain | Purpose | CORS status |
|---|---|---|
| `gcetly.ac.in`, `www.gcetly.ac.in` | Existing college site; embed `<script>` loads from here | Allowed origin (API Specification §8.3) |
| `assets.gcetly.ac.in` `[NEW — assumption]` | CDN host for the embed bundle's static assets | N/A — not a CORS-relevant origin, a static asset host |
| `api.gcetly.ac.in` | Backend API, matches API Specification §1.6 exactly | N/A (server) |
| `staging.gcetly.ac.in` | Staging environment | Allowed origin, staging only (API Specification §8.3) |

No wildcard subdomain is ever added to the CORS allow-list — every new origin is an explicit, reviewed addition, per API Specification §8.3's "wildcard origins prohibited" rule, restated here as it governs DNS/domain provisioning, not just application config.

## 13. Environment Configuration
One configuration *mechanism* (environment variables, validated at boot per Backend Architecture §3) across all environments — only the *values* differ. No environment-specific code path exists in the application; an environment is entirely defined by its `.env` file (or secrets-manager-injected equivalent, §14) and its DNS/CORS entries (§12).

## 14. Secrets Management
LLM provider API key, database credentials, `mfaSecret` encryption key, session cookie signing secret, and object storage credentials are stored in a secrets manager (cloud-native KMS/Secrets Manager, or self-hosted HashiCorp Vault for full data-residency control per Backend Architecture §2's government-institution posture) — injected into containers at runtime, never baked into an image layer, never committed to source control, never logged (Backend Architecture §12; Database Design §13.7).

---

## 15. CI/CD Pipeline (GitHub Actions)

```
Push to main / PR opened
        │
        ▼
Lint + Typecheck (all services)
        │
        ▼
Unit + Integration Tests
        │
        ▼
Build Docker Images (tagged by git SHA)
        │
        ▼
Push to Container Registry
        │
        ▼
Deploy to Staging (automatic)
        │
        ▼
Smoke Test Staging
        │
        ▼
Manual Approval Gate  ─── required for a government-facing production system
        │
        ▼
Database Migration (§ Database Design §19.4 — before app deploy)
        │
        ▼
Rolling Deploy to Production
        │
        ▼
Post-Deploy Health Check (§22)
```

## 16. Build Pipeline

```yaml
jobs:
  build:
    strategy:
      matrix:
        service: [backend, frontend, ai-service]
    steps:
      - uses: actions/checkout@v4
      - run: docker build -t ${{ matrix.service }}:${{ github.sha }} ./apps/${{ matrix.service }}
      - run: docker push registry.internal/${{ matrix.service }}:${{ github.sha }}
```
Matrix-based build — each service's image builds independently and in parallel, so a slow Python dependency install never blocks the NestJS build finishing first.

## 17. Deployment Pipeline

```yaml
jobs:
  deploy-staging:
    if: github.ref == 'refs/heads/main'
    steps:
      - run: ./scripts/migrate.sh staging
      - run: ./scripts/deploy.sh staging ${{ github.sha }}
      - run: ./scripts/smoke-test.sh staging

  deploy-production:
    needs: deploy-staging
    environment:
      name: production   # GitHub Environments manual-approval gate
    steps:
      - run: ./scripts/migrate.sh production
      - run: ./scripts/deploy.sh production ${{ github.sha }}
      - run: ./scripts/health-check.sh production
```

## 18. Rollback Strategy

```
Bad deploy detected (health check fails / alert fires)
        │
        ▼
Redeploy prior image tag (last known-good git SHA) — rolling, same mechanism as §19
        │
        ▼
If the incident involved a migration: apply the paired down-migration
(Database Design §19.2 — every non-additive migration ships with one)
        │
        ▼
Post-rollback health check
        │
        ▼
Incident logged (§47) with correlation IDs from the affected window
```
No rollback ever targets `latest` — the exact prior SHA is redeployed, guaranteeing the rollback target is a state that was itself previously health-checked in production.

## 19. Blue-Green / Rolling Deployment Strategy — and why rolling is chosen

**Chosen: rolling deployment**, not blue-green, for the application tier. Justification:
- NestJS and the Python AI Service are stateless (Backend Architecture §17) — a rolling deploy (new instances health-checked and added to rotation, old instances drained and removed) achieves zero-downtime without the doubled infrastructure cost of a full blue-green environment.
- The one requirement blue-green is usually chosen to satisfy — instant, atomic cutover — is not needed here, since a rolling deploy's brief window of mixed old/new instances is safe: both versions serve the identical, already-migrated database schema (§17 runs migrations before the app deploy), and neither version has any in-process state a peer instance needs to be aware of.
- **Blue-green is reserved for one specific case:** a database migration significant enough that running old and new application code against the same schema simultaneously is unsafe even briefly. This is rare given the expand/contract discipline already fixed in Database Design §19.2, which is designed specifically to avoid ever needing it.

```
Rolling deploy:
[v1][v1][v1]  →  [v2][v1][v1]  →  [v2][v2][v1]  →  [v2][v2][v2]
                     ↑ each v1 instance drains in-flight SSE streams
                       (Backend Architecture §17) before terminating
```

---

## 20. Monitoring Architecture

```
NestJS instances ──┐
Python AI Service ──┼──→ Prometheus (scrape /metrics, API Specification §4.3.2) ──→ Grafana
PostgreSQL exporter ┘                                                    │
                                                                          ▼
                                                                    Alertmanager (§24)
```
Three purpose-built Grafana dashboards, per Backend Architecture §15 — not reinvented here, only wired to concrete scrape targets:
1. **System health** — request rate, error rate, latency percentiles against API Specification §9.8's targets.
2. **AI quality** — retrieval confidence distribution, groundedness pass/fail rate, `no-data` rate.
3. **Usage** — conversations/day, feedback sentiment, top/unanswered questions (feeding from `SystemMetricsSnapshot`, Database Design §3.21).

## 21. Logging Architecture
Centralized structured JSON log aggregation (e.g., Loki or an equivalent shipper) collecting from every container's stdout — no service writes to a local log file that could be lost on container replacement. Every log line carries the `correlationId` generated at the NGINX/middleware layer (API Specification §7.2, §13.6), enabling one query to reconstruct a single request's path across NestJS, the Python AI Service, and the database layer.

## 22. Health Checks
`GET /v1/health` (liveness, always `200` if the process is running — API Specification §4.1.7) drives container restart policy; `GET /v1/health/deep` (readiness, internal-only, checks Postgres/Redis/Qdrant/LLM reachability — API Specification §4.3.1) drives load-balancer rotation — a readiness failure removes an instance from rotation without restarting it, since the instance itself may be healthy while a dependency is not.

## 23. Metrics Collection
`GET /metrics`, Prometheus text-exposition format, internal-network-only (API Specification §4.3.2) — request rate, error rate, latency percentiles per stage (embedding, hybrid retrieval, re-ranking, generation, groundedness verification), matching every number already fixed in API Specification §9.8/Backend Architecture §5.13.

## 24. Alerting Strategy

| Condition | Threshold | Source |
|---|---|---|
| Error rate | > 1% over 5 min | API Specification §7 |
| TTFT p95 | > 2.5s over 10 min | API Specification §9.8 |
| `no-data` rate | Sudden spike vs. 7-day baseline | Backend Architecture §15 |
| Groundedness failure rate | Sudden spike vs. 7-day baseline | Backend Architecture §15 — treated as high-severity given this system's core promise |
| Replica lag | > 5s | Database Design §17.5 |
| Disk usage | > 80% | Database Design §17.6 |

---

## 25. Backup Strategy
Daily full PostgreSQL backup plus continuous WAL archiving, 35-day retention (Database Design §14.1/§14.3). Object storage bucket-versioned. Qdrant collection snapshots scheduled at ingestion frequency, not more often than content actually changes.

```
Daily (00:00 UTC) ──→ pg_dump full backup ──→ encrypted at rest ──→ object storage (35-day lifecycle)
Continuous        ──→ WAL archiving       ──→ encrypted at rest ──→ object storage (35-day lifecycle)
Weekly            ──→ Qdrant snapshot     ──→ encrypted at rest ──→ object storage
```

## 26. Disaster Recovery Plan

```
Primary region/zone failure detected
        │
        ▼
Promote PostgreSQL read replica (Database Design §16.2) to primary
        │
        ▼
Repoint backend DATABASE_URL to new primary (via secrets manager, §14 — no code change)
        │
        ▼
Restore Qdrant from most recent snapshot (§25) if the node itself was lost
        │
        ▼
Redeploy application containers against the recovered data tier
        │
        ▼
Full health check (§22) before restoring public traffic
```
RTO/RPO targets: hours, not seconds — appropriate to a single-institution assistant, not a financial system (Database Design §14.4). Quarterly restore drill validates this procedure against a real backup, not just on paper (Database Design §14.6).

## 27. High Availability Considerations
NestJS/Python AI Service: N ≥ 2 instances at all times so a single instance failure never causes a full outage. PostgreSQL: streaming replica doubles as both read-scaling (Database Design §16.2) and DR standby (§26). NGINX: active/passive pair or load-balanced pair, never a single point of failure at the edge in a mature production deployment — `[NEW — assumption]` a single NGINX instance is acceptable for initial launch given this system's realistic scale, with a second instance added once real traffic data justifies it, consistent with the same deferred-until-justified posture already applied to Redis clustering and Qdrant sharding (Database Design §16.3/§16.4).

## 28. Scalability Strategy
Horizontal, triggered by CPU utilization and request-queue depth on NestJS/Python AI Service instances (Backend Architecture §17) — no vertical scaling path is designed as primary, since the stateless design makes horizontal scaling strictly simpler to reason about and operate. PostgreSQL scales via read replica before any sharding consideration (Database Design §16.5); Qdrant and Redis scale only once real load data justifies the added operational complexity (Database Design §16.3/§16.4) — deferred deliberately, not overlooked.

---

## 29. Security Hardening
Helmet-set security headers (API Specification §8.5), TLS 1.2+ only (§11), non-root container users (§7), CORS allow-list with no wildcard (§12), CSRF double-submit cookie (API Specification §2.6), mandatory admin MFA with no opt-out (API Specification §2.2), least-privilege database roles (Database Design §13.5) — every item here operationalizes a decision already fixed upstream, none newly introduced.

## 30. Firewall Configuration

| Rule | Source | Destination | Port | Action |
|---|---|---|---|---|
| Public HTTPS | Internet | NGINX | 443 | Allow |
| Public HTTP (redirect only) | Internet | NGINX | 80 | Allow (redirect to 443) |
| Internal app traffic | NGINX | Backend, Frontend | 3000 | Allow (internal network only) |
| Internal AI traffic | Backend | Python AI Service | 8001 | Allow (internal network only) |
| Internal data traffic | Backend, AI Service | Postgres, Redis, Qdrant | 5432, 6379, 6333 | Allow (internal network only) |
| Everything else | Internet | Any internal service | Any | Deny |

## 31. Network Security
Internal bridge network (§9) isolates every non-edge service from direct internet reachability at the network layer, not merely by omitting a published port — a defense-in-depth measure so a NGINX misconfiguration alone cannot expose the data tier. Inter-service traffic on the internal network is unencrypted by default in the development compose file (§8) but TLS-wrapped in staging/production for Postgres/Redis connections where the hosting provider's network fabric isn't itself trusted (`[NEW — assumption]`: not specified upstream, added since "government institution" data-sensitivity context (Backend Architecture §2) reasonably implies encrypting data-tier traffic even on a private network, not only at the public edge).

## 32. DDoS Protection
NGINX-level connection limits and request buffering as the first line (§10); a CDN/edge proxy in front of NGINX is the recommended additional layer for production (Backend Architecture §12) — the same CDN already serving the embed bundle's static assets (§12) is the natural candidate, since it's already in the request path for a meaningful share of traffic.

## 33. Container Security
Non-root `USER` in every runtime image (§7); base images pinned to specific tags (`node:20-bookworm-slim`, not `node:latest`) so a base-image update is a deliberate, tested change, not an unreviewed surprise on next build; the Python AI Service's container has no published port in any environment, reachable only from the internal network (§9), consistent with API Specification §3's "never exposed as a public route" requirement.

## 34. Dependency Management
Lockfiles (`package-lock.json`, `requirements.txt` pinned to exact versions) committed to source control; automated dependency vulnerability scanning as a CI job (§16), separate from the lint/typecheck/test job so a dependency alert doesn't block an unrelated code change from being reviewed on its own merits.

## 35. Image Versioning
Every image tagged by git commit SHA (§3, principle 1) — never `latest` in any environment past local development. A rollback (§18) always names an exact, previously-deployed SHA.

---

## 36. Production Configuration
CORS restricted to `gcetly.ac.in`/`www.gcetly.ac.in` only (§12); N ≥ 2 instances per stateless service (§27); manual-approval deploy gate active (§15); full monitoring/alerting stack live (§20, §24) before the first real student traffic is routed.

## 37. Staging Environment
Same topology as production at smaller instance counts; `staging.gcetly.ac.in` the sole permitted CORS origin (§12); realistic, anonymized data, never real student PII (Database Design §9's PII-handling posture extends to how staging data is sourced).

## 38. Development Environment
Single Docker Compose stack (§8), all services on one machine, seeded sample documents — matches Backend Architecture §18 exactly.

## 39. Infrastructure Folder Structure

```
infra/
├── docker/
│   ├── backend/Dockerfile
│   ├── frontend/Dockerfile
│   └── ai-service/Dockerfile
├── nginx/
│   ├── nginx.conf
│   └── conf.d/
│       ├── api.conf
│       └── assistant.conf
├── compose/
│   ├── docker-compose.dev.yml
│   ├── docker-compose.staging.yml
│   └── docker-compose.prod.yml
├── scripts/
│   ├── deploy.sh
│   ├── migrate.sh
│   ├── smoke-test.sh
│   └── health-check.sh
└── ci/
    └── github-actions/
        ├── build.yml
        ├── test.yml
        └── deploy.yml
```

## 40. Environment Variables

| Variable | Consumed by | Sensitive | Source |
|---|---|---|---|
| `DATABASE_URL` | Backend | Yes | Secrets manager (§14) |
| `REDIS_URL` | Backend | Yes | Secrets manager |
| `QDRANT_URL` | Backend | No | Environment config (§13) |
| `AI_SERVICE_URL` | Backend | No | Environment config — internal DNS name |
| `LLM_PROVIDER_API_KEY` | AI Service / LLM Gateway | Yes | Secrets manager |
| `SESSION_COOKIE_SECRET` | Backend | Yes | Secrets manager |
| `CSRF_TOKEN_SECRET` | Backend | Yes | Secrets manager |
| `MFA_ENCRYPTION_KEY` | Backend | Yes | Secrets manager |
| `CORS_ALLOWED_ORIGINS` | Backend | No | Environment config, per-environment (§12) |

All required variables validated at process boot; the application refuses to start rather than run with a missing value (Backend Architecture §3).

## 41. Deployment Sequence

```
1. CI green on main (§15)
2. Build + push images, tagged by SHA (§16)
3. Deploy to staging (§17)
4. Smoke test staging
5. Manual approval (§15)
6. Run database migrations against production (§17; Database Design §19.4 — before step 7)
7. Rolling deploy to production (§19)
8. Post-deploy health check (§22)
9. Monitor error/latency dashboards closely for the first 30 minutes (§20)
```

---

## 42. Infrastructure Diagrams (ASCII)
See §4 (production topology) and §9 (container networking).

## 43. Container Communication Flow

```
Student Browser
   │ HTTPS
   ▼
NGINX ──────────────► Next.js (standalone, non-chat pages)
   │
   │ /v1/*, /admin/*
   ▼
NestJS Backend
   │             │
   │ SQL         │ HTTP (internal)
   ▼             ▼
PostgreSQL    Python AI Service ──► Qdrant (hybrid search)
   ▲                │
   │                ▼
   └──────────  LLM Gateway (OpenAI)
   │
   ▼
Redis (cache, session, queue — read/write at every stage above)
```

## 44. Startup Sequence

```
1. PostgreSQL container starts, becomes ready (healthcheck: pg_isready)
2. Redis container starts, becomes ready (healthcheck: PING)
3. Qdrant container starts, becomes ready (healthcheck: /healthz)
4. Migrations run against PostgreSQL (§17, one-shot job, not a long-running container)
5. Python AI Service starts, loads models, becomes ready (healthcheck: internal /ready)
6. NestJS backend starts — depends_on: postgres, redis, qdrant, ai-service all healthy
7. NestJS backend passes its own readiness check (GET /v1/health/deep)
8. Next.js standalone starts
9. NGINX starts last, begins routing traffic only once upstreams report healthy
```
This ordering is enforced via Docker Compose `depends_on` with `condition: service_healthy` (not a bare `depends_on`, which only waits for container start, not readiness) — a documented gap in naive Compose usage that this document closes explicitly.

## 45. Failure Recovery Flow

```
Dependency failure detected (Postgres / Redis / Qdrant / LLM provider)
        │
        ▼
Classified per Backend Architecture §13's error table:
   - Postgres/Qdrant/LLM down  → fail closed → 503 server-busy (never an ungrounded answer)
   - Redis down                → degrade, not fail → direct Postgres read, in-memory rate limit
        │
        ▼
Health check (§22) reflects the failure — GET /v1/health/deep returns the specific failing dependency
        │
        ▼
Load balancer stops routing new traffic to affected instance (if failure is instance-local)
        │
        ▼
Alert fires (§24) → on-call engages incident response (§47)
        │
        ▼
Dependency recovers → health check passes → instance rejoins rotation automatically, no manual restart required
```

## 46. Performance Targets
Reproduced from API Specification §9.8/Backend Architecture §5.13 — this document introduces no new numbers, only the infrastructure required to meet them:

| Stage | Target (p95) |
|---|---|
| Vector/hybrid retrieval | < 150 ms |
| Cross-encoder re-ranking | < 300 ms |
| Groundedness verification | < 400 ms |
| Time-to-first-token | < 2.5 s |
| Full response — text answers | < 8 s |
| Full response — card/skeleton-path answers | < 12 s |
| Non-chat JSON endpoints | < 500 ms |

## 47. Operational Runbook

| Scenario | First action | Escalation |
|---|---|---|
| Error rate alert fires | Check `GET /v1/health/deep` on all instances; check Grafana system-health dashboard | Page on-call if error rate persists > 15 min |
| Groundedness-failure-rate spike | Check AI-quality dashboard; review recent prompt/model changes in deploy history | Treat as high-severity — this is the system's core hallucination-prevention promise |
| Database primary unreachable | Confirm via `GET /v1/health/deep`; initiate §26's DR sequence | Page on-call immediately, no wait threshold |
| Suspected credential leak | Rotate the specific secret in the secrets manager (§14) immediately; audit `Logs` for the affected `correlationId` window (Database Design §12) | Notify institution's designated security contact |
| Rollback needed | Follow §18 exactly | Confirm with a second engineer before triggering a production rollback outside a declared incident |

## 48. Maintenance Strategy
Scheduled windows for non-additive migrations and dependency upgrades, announced via the existing `Announcements` mechanism (Database Design §3.16) where user-facing impact is expected — no ad hoc production changes outside the CI/CD pipeline (§15), including "quick fixes," which go through the same pipeline as any other change.

## 49. Deployment Checklist

- [ ] All environments (§36–§38) provisioned, CORS configured per §12's exact allow-list
- [ ] TLS certificates issued, auto-renewal verified (§11)
- [ ] Secrets populated in the secrets manager, none present in source control (§14)
- [ ] CI/CD pipeline green on `main`, manual approval gate active (§15, §17)
- [ ] Database migrated, restore drill completed at least once (§25, Database Design §14.6)
- [ ] Monitoring/alerting live and tested against a deliberately triggered test alert (§20, §24)
- [ ] Firewall rules applied, internal services confirmed unreachable from the public internet (§30)
- [ ] Rollback procedure rehearsed in staging at least once (§18)
- [ ] Startup sequence's health-check dependencies verified (§44) — no service starts accepting traffic before its dependencies report healthy
- [ ] Runbook (§47) reviewed by the on-call team before go-live

## 50. Future Cloud Migration Strategy
Cloud-agnostic by construction (Docker + standard Postgres/Redis/S3-compatible interfaces, Backend Architecture §18) — a future migration to a managed Kubernetes service is a deployment-tooling change, not an application rewrite, precisely because the stateless application tier and containerized services (§3, §7) were designed for this from the outset. Not adopted today because Docker Compose is sufficient for this system's realistic initial scale (Backend Architecture §17.6) — the trigger for revisiting this is the same one already fixed upstream: real traffic data showing the current topology is the actual bottleneck, not a calendar date.

## 51. Appendix
Cross-references: API Specification §13 (naming/timestamp/correlation-ID conventions), Database Design §21 (schema appendix), Backend Architecture §15 (dashboard definitions) — not reproduced a second time here, per this document's own principle of not duplicating previously finalized content.

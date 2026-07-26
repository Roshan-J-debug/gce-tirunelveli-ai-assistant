# GCE Tirunelveli AI Assistant — Requirements Specification Document

**Source of truth:** Conversation Design v2, Frontend Architecture, Backend Architecture, API Specification, Database Design, Deployment & DevOps Architecture — all finalized. This document describes what the already-approved system must do, why it exists, and who uses it. No architecture decision, API, database schema, authentication mechanism, or conversation flow is altered here.

---

## 1. Introduction
This Requirements Specification Document (RSD) states the business and functional requirements the GCE Tirunelveli AI Assistant satisfies, expressed independently of implementation detail but fully traceable to the six finalized architecture documents that already implement it.

## 2. Purpose
To provide a single, authoritative statement of *what* the system must achieve — usable by non-technical stakeholders for institutional evaluation, and by the engineering team as a traceability reference against the finalized architecture.

## 3. Scope

```
┌───────────────────────────── In Scope ─────────────────────────────┐
│  Web-based AI chat assistant (embed + standalone)                    │
│  Retrieval-Augmented Generation over official college documents       │
│  Admin document management, review, and publishing workflow            │
│  Anonymous student/visitor access; MFA-protected admin access          │
│  Production deployment, monitoring, backup, and disaster recovery       │
└───────────────────────────────────────────────────────────────────────┘
┌────────────────────────── Out of Scope (this version) ──────────────┐
│  Voice input/output · Tamil language · WhatsApp · Mobile app            │
│  Authenticated student/faculty/parent portals · Fine-tuned model         │
│  Multi-campus support                                                    │
│  (see §42 — Future Enhancements)                                          │
└───────────────────────────────────────────────────────────────────────┘
```

## 4. Business Objectives

| ID | Objective | Measured by |
|---|---|---|
| BO-001 | Provide instant, 24/7 access to official college information | System availability (AVAIL-001) |
| BO-002 | Reduce routine-inquiry load on administrative offices | `[NEW — assumption]` No baseline was recorded upstream; established post-launch |
| BO-003 | Ensure every answer is verifiable against a real, published source | Citation presence on every factual answer (FR-002) |
| BO-004 | Maintain institutional trust by refusing rather than guessing when uncertain | Groundedness-verification failure rate trend (Backend Architecture §5.7) |

## 5. Project Vision
A trustworthy, always-available conversational entry point to GCE Tirunelveli's official information — answering plainly, citing its source, and declining rather than fabricating, for every student, parent, faculty member, alumnus, and visitor who asks.

## 6. Stakeholders

| Stakeholder | Interest |
|---|---|
| College leadership | Institutional trust, accurate public information |
| Registrar / Admissions office | Reduced inquiry volume, accurate admissions data |
| Content editors (admin) | Safe, usable tools to keep information current |
| Students, parents, faculty, alumni, visitors | Fast, accurate, trustworthy answers |
| Engineering / DevOps team | An implementable, operable system matching this specification |

## 7. User Roles

| Role | Access level | Source |
|---|---|---|
| Anonymous visitor | Chat, document browsing, feedback — no login | Conversation Design v2; API Specification §2.1 |
| Content Editor (admin) | Document upload/edit, FAQ/announcement management | API Specification §2, §4.2 (`documents:write`, `faqs:write`, etc.) |
| Reviewer (admin) | Resolves PII review queue | API Specification §4.2.9 (`documents:review`) |
| Publisher (admin) | Publishes approved document versions | API Specification §4.2.10 (`documents:publish`) |
| Super Admin | Full permission set, including config and role management | Backend Architecture §10 |

## 8. Target Users
Prospective and current students, parents/guardians, faculty, alumni, and campus visitors (all as anonymous visitors, §7); college administrative staff acting as Content Editors, Reviewers, and Publishers.

## 9. Problem Statement
Information about GCE Tirunelveli is currently obtained through a static website, phone calls, and in-person office visits — none of which provide an instant, source-verified answer to a specific question at the moment it's asked.

## 10. Existing Problems

| Problem | Consequence |
|---|---|
| No instant answer channel | Students/parents wait for office hours or a callback |
| Inconsistent answers across staff | Erodes trust in official information |
| No record of what information gaps exist | Outdated or missing documentation persists undetected |

## 11. Proposed Solution
A Retrieval-Augmented Generation AI assistant, embedded on the official website, answering exclusively from ingested and verified official documents, with two independent hallucination-prevention gates (Backend Architecture §5.6/§5.7) and a complete admin workflow for keeping the knowledge base current.

## 12. System Overview

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

---

## 13. Functional Requirements

| ID | Description | Priority | Acceptance Criteria |
|---|---|---|---|
| FR-001 | Any visitor shall start a chat without an account | Must | `POST /v1/session` requires no credentials |
| FR-002 | The system shall answer only from official ingested documents, with a citation | Must | Every factual reply cites a `Published` document version |
| FR-003 | The system shall refuse to answer when no confident official source exists | Must | Low-confidence retrieval yields a `no-data` refusal, never a guess |
| FR-004 | Responses shall stream progressively | Should | SSE chunk delivery per API Specification §5 |
| FR-005 | A user shall be able to resume a prior conversation | Should | `GET /v1/conversations/{id}/messages` |
| FR-006 | A user shall be able to submit helpful/not-helpful feedback | Could | `POST /v1/feedback` |
| FR-007 | The system shall suggest follow-up questions after each answer | Should | `follow-up-chips` stream chunk rendered |
| FR-008 | An admin shall be able to upload, review, and publish official documents | Must | Full state machine per Backend Architecture §9 |
| FR-009 | An admin shall be able to manage announcements and FAQs | Should | API Specification §4.2.12/§4.2.13 |
| FR-010 | An admin shall be able to view usage analytics and unanswered questions | Must | API Specification §4.2.14 |

## 14. Non-Functional Requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-001 | Time-to-first-token | p95 < 2.5 s |
| NFR-002 | Full response completion | p95 < 8 s (text), < 12 s (card) |
| NFR-003 | System availability | ≥ 99.5% monthly |
| NFR-004 | Unexpected error rate | < 0.5% |

## 15. AI Requirements

| ID | Requirement | Priority |
|---|---|---|
| AI-001 | Retrieval shall combine dense and sparse search via Reciprocal Rank Fusion | Must |
| AI-002 | Candidates shall be cross-encoder re-ranked before use | Must |
| AI-003 | Generation shall be gated by pre-generation retrieval confidence | Must |
| AI-004 | Every answer shall pass post-generation groundedness verification before being shown | Must |
| AI-005 | A failed gate shall always result in refusal, never a partial answer | Must |
| AI-006 | The system shall use one primary LLM provider at launch, behind a provider-agnostic gateway | Must |

## 16. Security Requirements

| ID | Requirement | Priority |
|---|---|---|
| SEC-001 | Admin login shall require mandatory TOTP MFA, no opt-out | Must |
| SEC-002 | Session/admin credentials shall be httpOnly, Secure, SameSite=Lax cookies | Must |
| SEC-003 | State-changing requests shall be CSRF-protected via double-submit cookie | Must |
| SEC-004 | Cross-origin access shall be restricted to an explicit allow-list; no wildcards | Must |

## 17. Authentication & Authorization Requirements

| ID | Requirement | Priority |
|---|---|---|
| AUTH-001 | Visitors shall not require authentication to chat | Must |
| AUTH-002 | Admin permissions shall be role-based (resource + action) | Must |
| AUTH-003 | Refresh tokens shall rotate on every use; reuse triggers family-wide revocation | Must |

## 18. Data Requirements

| ID | Requirement | Priority |
|---|---|---|
| DATA-001 | Every citation shall resolve to the specific document version current at generation time | Must |
| DATA-002 | Conversations shall retain no longer than 24 months from last activity | Must |
| DATA-003 | Superseded document versions shall be retained indefinitely for audit | Must |

## 19. Search & Retrieval Requirements

| ID | Requirement | Priority |
|---|---|---|
| SEARCH-001 | Retrieval shall use hybrid dense + sparse vectors stored together in Qdrant | Must |
| SEARCH-002 | The embedding model version at query time shall match the version used at ingestion | Must |
| SEARCH-003 | A re-ranker failure shall degrade ranking quality, never fail the request | Must |

## 20. Performance Requirements

| ID | Requirement | Target |
|---|---|---|
| PERF-001 | Vector/hybrid retrieval latency | p95 < 150 ms |
| PERF-002 | Cross-encoder re-ranking latency | p95 < 300 ms |
| PERF-003 | Groundedness verification latency | p95 < 400 ms |
| PERF-004 | Non-chat JSON endpoint latency | p95 < 500 ms |

## 21. Reliability Requirements

| ID | Requirement | Priority |
|---|---|---|
| REL-001 | A vector DB or LLM failure shall cause refusal, never an ungrounded answer | Must |
| REL-002 | A cache failure shall degrade performance only, never correctness | Must |

## 22. Availability Requirements

| ID | Requirement | Priority |
|---|---|---|
| AVAIL-001 | Monthly uptime target for chat/session endpoints | ≥ 99.5% |
| AVAIL-002 | Liveness and readiness health checks shall be exposed separately | Must |

## 23. Scalability Requirements

| ID | Requirement | Priority |
|---|---|---|
| SCALE-001 | Application services shall scale horizontally without code change | Must |
| SCALE-002 | Kubernetes adoption is deferred until real traffic data justifies it | Should |

## 24. Usability Requirements

| ID | Requirement | Priority |
|---|---|---|
| USE-001 | Responses shall default to concise answers, expanding only on request | Must |
| USE-002 | Language shall remain plain and jargon-free for users with limited English proficiency or unfamiliarity with technology | Must |
| USE-003 | Suggested question chips shall reduce the need to type for common queries | Should |

## 25. Accessibility Requirements

| ID | Requirement | Priority |
|---|---|---|
| ACC-001 | Full keyboard operability | Must |
| ACC-002 | Screen reader support, including live-region announcements | Must |
| ACC-003 | WCAG 2.2 AA compliance | Must |
| ACC-004 | Respect for reduced-motion preference | Must |

## 26. Compatibility Requirements

| ID | Requirement | Priority |
|---|---|---|
| COMPAT-001 | The embedded widget shall not alter or break the existing host page's styling or scripts | Must |
| COMPAT-002 | The interface shall be fully responsive across mobile, tablet, and desktop breakpoints | Must |

## 27. Browser & Device Support

`[NEW — assumption]` No prior document specified a browser support matrix; the following is the smallest reasonable baseline for a modern embeddable web widget, necessary because a deployment specification cannot be complete without one.

| Browser | Minimum supported |
|---|---|
| Chrome / Edge (Chromium) | Last 2 major versions |
| Firefox | Last 2 major versions |
| Safari (macOS/iOS) | Last 2 major versions |

Devices: desktop, tablet, and mobile (portrait and landscape), per Frontend Architecture §7.

## 28. Privacy Requirements

| ID | Requirement | Priority |
|---|---|---|
| PRIV-001 | Uploaded documents shall be scanned for PII before indexing | Must |
| PRIV-002 | Ambiguous PII detections shall require human review before publication | Must |
| PRIV-003 | No personal information about identifiable individuals shall be disclosed beyond published official contacts | Must |

## 29. Compliance Requirements

| ID | Requirement | Priority |
|---|---|---|
| COMP-001 | Data handling shall have regard to India's DPDP Act, 2023 | Must |
| COMP-002 | The system shall meet WCAG 2.2 AA accessibility standards | Must |

## 30. Logging Requirements

| ID | Requirement | Priority |
|---|---|---|
| LOG-001 | Every request shall carry a correlation ID through logs and error responses | Must |

## 31. Audit Requirements

| ID | Requirement | Priority |
|---|---|---|
| AUDIT-001 | Every admin action changing institutional data shall be logged append-only | Must |
| AUDIT-002 | Audit-classified logs shall be retained 7 years | Must |

## 32. Error Handling Requirements

| ID | Requirement | Priority |
|---|---|---|
| ERR-001 | Errors shall classify into a finite, documented set of codes | Must |
| ERR-002 | A refusal to answer shall never be presented as a system error | Must |

## 33. Backup & Recovery Requirements

| ID | Requirement | Priority |
|---|---|---|
| BKP-001 | Daily full database backup with continuous point-in-time recovery | Must |
| BKP-002 | Backups retained 35 days, encrypted at rest, restore-tested quarterly | Must |

## 34. Maintainability Requirements

| ID | Requirement | Priority |
|---|---|---|
| MAINT-001 | Every request/response shape shall be backed by exactly one documented DTO | Must |
| MAINT-002 | API changes shall be additive within a version; breaking changes require a new version | Must |

## 35. Deployment Requirements

| ID | Requirement | Priority |
|---|---|---|
| DEP-001 | Production deployment shall require manual approval | Must |
| DEP-002 | Deployments shall be zero-downtime for the application tier | Must |

## 36. Operational Requirements

| ID | Requirement | Priority |
|---|---|---|
| OPS-001 | All production changes shall pass through the CI/CD pipeline | Must |
| OPS-002 | An operational runbook shall exist for high-severity failure scenarios | Must |

---

## 37. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Single-provider LLM outage | Medium | High | Provider-agnostic gateway; second provider addable later |
| PII detection edge case missed | Low–Medium | High | Review queue as safety net |
| Admission-season traffic spike underestimated | Medium | Medium | Horizontal scaling; load testing recommended |

## 38. Assumptions
Every `[NEW — assumption]` marked in this document and its six predecessors — none hidden. Most consequential: the internal Python AI Service boundary, DPDP-Act-informed retention periods, and the 99.5% availability target — none dictated explicitly by a business stakeholder in the visible record.

## 39. Constraints
Fixed technology stack (Next.js/React/Tailwind, NestJS, OpenAI, PostgreSQL+pgvector/Redis/Qdrant, SSE, cookie/JWT/MFA auth, Docker/Compose/NGINX, Ubuntu LTS) — no substitution. No architecture, API, schema, or authentication change permitted by this document.

## 40. Success Criteria
System availability ≥ 99.5%; TTFT p95 < 2.5s; groundedness-failure rate trending down; every factual answer citation-backed.

## 41. Acceptance Criteria (representative)
- Given a question with a clear official source, when submitted, then the answer includes a citation to a `Published` document.
- Given a question with no matching source, when submitted, then the system refuses rather than fabricates.
- Given an admin without completed MFA, when accessing any admin resource, then access is denied.

## 42. Future Enhancements (out of scope)
Voice input/output, Tamil language support, WhatsApp integration, a dedicated mobile application, authenticated student/faculty/parent portals, a fine-tuned model, multi-campus support — all explicitly out of scope for this version, per Backend Architecture §20; none designed against beyond documented extensibility.

## 43. Glossary
RAG, PII, RBAC, MFA, SSE, SLO, DPDP Act — as defined identically in API Specification §13.13; not redefined here to avoid divergent definitions across documents.

## 44. References
Conversation Design v2; Frontend Architecture; Backend Architecture; API Specification; Database Design; Deployment & DevOps Architecture — the six finalized documents this RSD traces to throughout.

## 45. Appendix

### Requirement Hierarchy Diagram
```
Business Objectives (BO)
   └── Functional Requirements (FR)
          └── AI Requirements (AI) ── Search & Retrieval (SEARCH)
          └── Security (SEC) ── Authentication & Authorization (AUTH)
          └── Non-Functional (NFR) ── Performance (PERF), Reliability (REL),
                                        Availability (AVAIL), Scalability (SCALE)
          └── Data (DATA) ── Privacy (PRIV) ── Compliance (COMP)
          └── Operational — Logging (LOG), Audit (AUDIT), Backup (BKP),
                              Deployment (DEP), Operational (OPS)
```

### User Interaction Diagram
```
Visitor ──ask question──► Chat Widget ──► Backend ──► Answer + Citation
Visitor ──feedback──────► Chat Widget ──► Backend ──► Feedback recorded
Admin ───upload doc─────► Admin Console ─► Backend ──► Review Queue / Published
```

### Requirement Traceability Matrix

| Requirement ID range | Frontend Architecture | Backend Architecture | API Specification | Database Design | Deployment & DevOps |
|---|---|---|---|---|---|
| FR-001–FR-010 | §3, §4 | §1.3, §9, §16 | §4 | §3 | — |
| AI-001–AI-006 | — | §5, §6, §8 | §5 | §6 | — |
| SEC-001–SEC-004, AUTH-001–AUTH-003 | — | §10 | §2, §8 | §13 | §29 |
| PERF-001–PERF-004, NFR-001–NFR-004 | — | §5.13, §17 | §9.8 | §13.11 | §46 |
| PRIV-001–PRIV-003, COMP-001–COMP-002 | — | §9 | §4.2.18 | §9, §18 | — |
| ACC-001–ACC-004, COMPAT-001–COMPAT-002 | §9, §10, §1.1 | — | — | — | — |
| BKP-001–BKP-002, DEP-001–DEP-002 | — | §18 | — | §14 | §15–§26 |

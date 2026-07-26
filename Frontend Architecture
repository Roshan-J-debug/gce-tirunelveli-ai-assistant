# GCE Tirunelveli AI Assistant — Frontend Architecture Document

**Status:** UI/UX (prototype v2), Design System, and Conversation Design v2 are approved and final. This document defines only the software architecture that implements them — no visual or conversational decisions are made or altered here. Every component named below refers back to the canonical inventory in *Conversation Design v2* §1.

**Stack:** Next.js (App Router) · React · TypeScript · Tailwind CSS · Framer Motion · Lucide React · Zustand · TanStack Query · React Hook Form · React Markdown.

---

## 1. Overall Frontend Architecture

### 1.1 The core architectural decision this project needs, up front

The assistant is not a normal page in an app — it is **a widget that must live on top of the college's existing official website**, which is very unlikely to be a Next.js application itself (most Indian government college sites are static HTML/PHP/WordPress). This changes the architecture from "build a Next.js site" to **"build a Next.js-developed, framework-agnostic embeddable widget, with Next.js also hosting a standalone version."**

Two deployment targets, one codebase:

```
┌─────────────────────────────────────────────────────────┐
│                     shared component &                   │
│                     state/logic layer                    │
│        (features/chat, store, services, components/ui)   │
└───────────────┬───────────────────────┬──────────────────┘
                │                       │
   ┌────────────▼───────────┐  ┌────────▼─────────────────┐
   │  EMBED BUILD            │  │  STANDALONE BUILD          │
   │  Vite lib-mode bundle   │  │  Next.js App Router app    │
   │  → single <script>      │  │  → gcetly.ac.in/assistant  │
   │  → mounts a Shadow DOM  │  │  → SSR shell for SEO/perf  │
   │    root on the legacy   │  │  → useful once/if the      │
   │    gcetly.ac.in pages   │  │    college migrates to     │
   │                          │  │    Next.js fully            │
   └──────────────────────────┘  └───────────────────────────┘
```

This is the single most important architecture call in the document, so it's stated first: **build the chat widget as a self-contained, style-isolated module from day one** (Shadow DOM or CSS-scoped), even though the primary dev/prototype environment is Next.js. Everything else in this document (state, components, styling, folder layout) is designed to support both targets without a rewrite.

### 1.2 Rendering strategy

| Surface | Strategy | Why |
|---|---|---|
| Embed build (legacy site) | 100% Client-Side Rendering, no SSR available | It's injected into a non-Next.js page; there is no server to render it |
| Standalone build (`/assistant` route, future) | Server Component shell (static layout, header, SEO meta) + Client Component boundary at the chat widget itself | Fast first paint for the page frame; the conversational surface is inherently client-only (local state, streaming, animation) |
| Rest of a possible future full site rebuild | Not in scope of this document | Out of scope — this document covers the assistant only |

Rule of thumb used throughout: **anything that touches `.chat-window`, `.chat-scroll`, Zustand, or TanStack Query is a Client Component.** Only the outer page chrome in the standalone build is ever a Server Component.

### 1.3 Component communication

- **Local UI state** (is a specific dropdown open, input field value) stays in the component via `useState`/React Hook Form — never promoted to global state.
- **Cross-cutting state** (chat history, theme, streaming status, network status) lives in Zustand stores (§4), read via selector hooks so components only re-render on the slice they subscribe to.
- **Server/async state** (the actual AI response call) is owned by TanStack Query, never duplicated into Zustand — Zustand holds the *rendered conversation*, TanStack Query owns the *in-flight request lifecycle*. A thin adapter (`features/chat/hooks/useSendMessage.ts`) bridges the two: it fires the mutation, and on each streamed chunk/completion, pushes into the Zustand chat store.
- **Parent → child**: props, typed, no prop-drilling past two levels — anything needed deeper goes through a selector hook instead.
- **Child → parent**: callback props for simple cases (`onChipClick`), store actions for anything that affects shared state (`sendMessage(text)`).

### 1.4 Scalability approach

- **Feature-based, not type-based, organization** at the top level (§2) — a new response-card type or a new error state is added inside `features/chat/`, touching a small, predictable set of files.
- **Component composition over configuration** — `ResponseCard` is a shell that composes smaller pieces (`CardArtPanel`, `CardBody`, `CardActions`) rather than one component with dozens of boolean props.
- **Headless logic hooks separated from presentation** — e.g., `useChatScroll()` (scroll-to-latest logic) is independent of the `ScrollToLatestButton` component, so the same logic can back a different visual treatment later without touching state logic.
- **Widget is a mount-point, not a global singleton** — supports the (future) possibility of two assistant instances on one page (e.g., an admissions-specific instance embedded on the admissions page) without architectural change.

---

## 2. Folder Structure

```
src/
├── app/                                # Next.js App Router (standalone build only)
│   ├── layout.tsx                      # Root layout: fonts, ThemeProvider, QueryProvider
│   ├── page.tsx                        # Marketing/demo shell hosting <ChatWidget />
│   ├── assistant/
│   │   └── page.tsx                    # Full-page assistant route (future)
│   └── api/                            # Next.js route handlers, PROXY ONLY — no business logic
│       └── chat/route.ts               # Forwards to backend AI service; adds auth headers later
│
├── widget-entry/                       # EMBED build entry point (Vite lib mode, separate from app/)
│   ├── mount.ts                        # createRoot() into a Shadow DOM host, exposes window.GCETLYAssistant.mount()
│   └── embed.config.ts                 # Bundle-specific config (CDN asset base path, version pin)
│
├── components/                         # Design-system-level, feature-agnostic components
│   ├── ui/                             # Pure presentational primitives (button, pill, icon-button)
│   │   ├── Button.tsx                  # Backs .btn-primary / .btn-ghost / .mini-btn variants via `variant` prop
│   │   ├── IconButton.tsx              # Backs .icon-btn / .input-icon-btn
│   │   ├── Chip.tsx                    # Single component, `variant: "topic" | "follow"` → .chip / .chip.follow
│   │   ├── Badge.tsx                   # Backs .verified-badge
│   │   └── SourceLine.tsx              # Backs .source-line
│   ├── layout/
│   │   ├── Fab.tsx                     # .fab / .fab-wrap / .fab-hint / .badge (unread count)
│   │   └── MinimizedPill.tsx           # .chat-minimized
│   └── feedback/
│       ├── Toast.tsx                   # Notification toast (new — system-level, not conversation-level)
│       └── SkeletonLine.tsx            # .sk-line primitive, reused by any skeleton card
│
├── features/
│   └── chat/                           # Everything conversation-specific lives here
│       ├── components/
│       │   ├── ChatWidget.tsx          # Top-level mount: owns Fab ↔ WelcomePopup ↔ ChatWindow ↔ MinimizedPill switch
│       │   ├── WelcomePopup.tsx        # .welcome-pop
│       │   ├── ChatWindow.tsx          # .chat-window shell (header + scroll region + input area)
│       │   ├── ChatHeader.tsx          # .chat-header, .ai-avatar (+ thinking ring), .win-actions
│       │   ├── ChatScroll.tsx          # .chat-scroll — virtualized message list (§11.5) + .scroll-fab
│       │   ├── DayDivider.tsx          # .day-divider
│       │   ├── message/
│       │   │   ├── MessageRow.tsx      # .msg-row.ai / .msg-row.user — layout + avatar
│       │   │   ├── Bubble.tsx          # .bubble
│       │   │   ├── MessageActions.tsx  # .msg-actions (.copy-btn, .like-btn)
│       │   │   ├── MarkdownRenderer.tsx# wraps react-markdown — used inside Bubble for lists/tables
│       │   │   ├── StreamingText.tsx   # word-by-word reveal + .stream-cursor (§3 rule engine lives here)
│       │   │   └── TypingIndicator.tsx # .typing-bubble
│       │   ├── cards/
│       │   │   ├── ResponseCard.tsx    # .resp-card shell
│       │   │   ├── CardArtPanel.tsx    # .art-panel, .icon-mark, .cap
│       │   │   ├── CardBody.tsx        # .head-row, h5, .updated-tag, p
│       │   │   ├── CardActions.tsx     # .btn-row, .mini-btn / .mini-btn.gold
│       │   │   ├── ImageGallery.tsx    # .img-gallery, .g-tile, .more
│       │   │   ├── PdfChip.tsx         # .pdf-chip
│       │   │   └── SkeletonCard.tsx    # .skeleton-card
│       │   ├── chips/
│       │   │   ├── TopicChips.tsx      # .chips-label + .chips-row of .chip (cold start)
│       │   │   └── FollowUpChips.tsx   # .chips-row of .chip.follow (post-answer)
│       │   ├── states/
│       │   │   ├── ErrorStateCard.tsx  # .state-card.err
│       │   │   └── WarningStateCard.tsx# .state-card.warn
│       │   └── input/
│       │       ├── ChatInputArea.tsx   # .chat-input-area, .input-row, .input-footnote
│       │       └── InputIcons.tsx      # attach / voice ("coming soon"), send button
│       ├── hooks/
│       │   ├── useSendMessage.ts       # Bridges TanStack Query mutation → Zustand chat store
│       │   ├── useStreamingReply.ts    # Consumes server-sent chunks, drives StreamingText
│       │   ├── useChatScroll.ts        # Auto-scroll + scroll-fab visibility logic
│       │   ├── useFollowUpChips.ts     # Resolves which follow-up set to show per reply type
│       │   └── usePronounResolution.ts # Client-side hint only — actual resolution happens server-side (§5); this hook just tracks "active entity" for UI affordances (e.g., highlighting)
│       ├── services/
│       │   └── chatApi.ts              # fetch/streaming client for the chat endpoint (§5)
│       ├── store/
│       │   └── chatStore.ts            # Zustand slice — see §4
│       └── types/
│           ├── message.ts              # Message, MessageRole, ResponseComponentType unions
│           └── responseSchema.ts       # Discriminated union matching §6 of Conversation Design v2
│
├── hooks/                              # App-wide hooks not specific to chat
│   ├── useMediaQuery.ts
│   ├── useReducedMotion.ts
│   └── useOnlineStatus.ts              # Feeds the "no internet" error state (§12)
│
├── store/                              # App-wide Zustand stores (not chat-specific)
│   ├── themeStore.ts                   # §8
│   ├── uiStore.ts                      # widget open/closed/minimized — see §4
│   └── notificationStore.ts            # unread badge count, toast queue
│
├── services/
│   ├── apiClient.ts                    # Base fetch wrapper: timeout, retry, error normalization (§5)
│   └── queryClient.ts                  # TanStack Query client instance + default options
│
├── lib/                                # Pure utility functions, framework-agnostic
│   ├── formatDate.ts
│   ├── classNames.ts
│   └── sanitize.ts                     # Output sanitization before markdown render (§13)
│
├── config/
│   ├── env.ts                          # Typed, validated environment variables
│   └── constants.ts                    # Chip label sets, category → icon map, etc.
│
├── animations/
│   ├── variants.ts                     # Framer Motion variant objects (§9) — one source of truth
│   └── transitions.ts                  # Shared easing/duration tokens, mirroring the prototype's --ease-spring / --ease-out
│
├── styles/
│   ├── globals.css                     # Tailwind directives + CSS custom properties (design tokens, light/dark)
│   └── tailwind.config.ts
│
├── providers/
│   ├── ThemeProvider.tsx               # Wraps themeStore, applies data-theme attribute
│   ├── QueryProvider.tsx               # TanStack Query provider
│   └── MotionConfigProvider.tsx        # Framer Motion's <MotionConfig reducedMotion="user">
│
├── types/                              # Global/shared TypeScript types not owned by a feature
│   └── api.ts
│
└── assets/
    └── icons/                          # Any custom SVGs not covered by lucide-react
```

**Why this shape, specifically:**
- `features/chat/` is deliberately the only "feature" folder at launch — everything conversation-related nests under it so the eventual addition of `features/admin/` or `features/auth/` (§16) doesn't require reorganizing existing code.
- `components/ui/` only contains components with **zero** knowledge of chat/conversation concepts — a `Chip` doesn't know what a follow-up question is, it just renders a variant. This is what makes the embed bundle (§1.1) able to tree-shake cleanly.
- `widget-entry/` is physically separate from `app/` so the embed bundle's build config never accidentally pulls in Next.js-only code (route handlers, server components).
- `store/` (app-wide) vs `features/chat/store/` (chat-specific) split mirrors §4's UI-state-vs-chat-state separation directly in the folder structure.

---

## 3. Component Architecture

Every component below maps 1:1 to a class in the approved prototype (cited) and a behavior in Conversation Design v2.

| Component | Prototype class | Responsibility |
|---|---|---|
| `ChatWidget` | — (orchestrator) | Owns which of Fab / WelcomePopup / ChatWindow / MinimizedPill is mounted, per `uiStore` |
| `Fab` | `.fab` | Entry point; shows unread `badge`; opens `WelcomePopup` or `ChatWindow` depending on visit state |
| `WelcomePopup` | `.welcome-pop` | First-visit intro; "Start Chat" → opens `ChatWindow` at idle state |
| `ChatWindow` | `.chat-window` | Composes `ChatHeader`, `ChatScroll`, `ChatInputArea` |
| `ChatHeader` | `.chat-header` | Avatar (+ thinking-ring state), name, online status, minimize/close/theme controls |
| `ChatScroll` | `.chat-scroll` | Virtualized message list; hosts `ScrollToLatestButton` |
| `MessageRow` | `.msg-row.ai` / `.msg-row.user` | Avatar + body layout for one turn |
| `Bubble` | `.bubble` | Renders plain text or `MarkdownRenderer` output (lists/tables) |
| `StreamingText` | `.stream-cursor` | Word-by-word reveal for short answers (§3 of Conversation Design v2) |
| `TypingIndicator` | `.typing-bubble` | Shown between send and first content |
| `SkeletonCard` | `.skeleton-card` | Shown while a card/table answer assembles |
| `ResponseCard` | `.resp-card` | Structured single-topic answer; composes `CardArtPanel` + `CardBody` + `CardActions` |
| `ImageGallery` | `.img-gallery` | Always a child of `ResponseCard`, never standalone |
| `PdfChip` | `.pdf-chip` | Document-sourced answer |
| `VerifiedBadge` | `.verified-badge` | Card-anchored / multi-fact claims |
| `SourceLine` | `.source-line` | Single-fact answers |
| `TopicChips` | `.chips-row` + `.chip` | Cold-start suggestions |
| `FollowUpChips` | `.chip.follow` | Post-answer suggestions |
| `ErrorStateCard` | `.state-card.err` | Network/server failures |
| `WarningStateCard` | `.state-card.warn` | No official info found |
| `ChatInputArea` | `.chat-input-area` | Textarea (React Hook Form-controlled), attach/voice (disabled), send |
| `ThemeToggle` | `.theme-toggle` | Sun/moon icon swap, drives `themeStore` |
| `Toast` | *(new, not conversational)* | System-level notices (e.g., "You're back online") — separate from `.state-card`, which is conversation-embedded |
| `MinimizedPill` | `.chat-minimized` | Background state with `.pulse-dot` |

**Composition example** — `ResponseCard` is never one monolithic component:
```
<ResponseCard>
  <CardArtPanel icon={...} caption="..." />
  <CardBody title="..." updatedLabel="..." body="..." />
  <CardActions primary={{ label: "Visit Hostel Page" }} gold={{ label: "Download Fee Structure" }} />
  {images && <ImageGallery images={images} />}
  {pdf && <PdfChip file={pdf} />}
</ResponseCard>
```
This mirrors §6 of Conversation Design v2 exactly — the card decides which optional children to render based on the response payload shape (§5.2), not the other way around.

---

## 4. State Management (Zustand)

Four separate stores, split by *rate of change* and *scope*, not arbitrarily:

| Store | Contains | Scope | Why separate |
|---|---|---|---|
| `uiStore` | `widgetState: "closed" \| "welcome" \| "open" \| "minimized"`, `isMobileSheet` | Global, rarely changes | Changes on user action only (open/close/minimize) — isolating it means opening the widget doesn't re-render the message list |
| `chatStore` (in `features/chat/store`) | `messages: Message[]`, `activeEntity` (for pronoun UI hints), `isTyping`, `isStreaming` | Global but feature-scoped | Changes frequently (every token during streaming) — kept out of `uiStore` so header/fab don't re-render on every streamed word |
| `themeStore` | `mode: "light" \| "dark" \| "system"`, `resolvedTheme` | Global, rarely changes | Persisted independently (§8); many components read it, almost none write it |
| `notificationStore` | `unreadCount`, `toastQueue` | Global, low-frequency | Drives `Fab`'s `.badge` and `Toast` — deliberately separate from chat content so notification logic doesn't need to know about message internals |

**What stays local (never promoted to Zustand):**
- Textarea draft value (React Hook Form)
- Whether a specific dropdown/tooltip is open
- Hover states (CSS/Framer Motion, not React state at all where possible)

**What is explicitly NOT in Zustand:** the in-flight network request state (loading/error/data for the *current* API call) — that's TanStack Query's job (§5). Zustand holds committed conversation history; TanStack Query holds the transient request. `useSendMessage` is the only place these two systems touch.

---

## 5. API Communication Layer

### 5.1 Client
`services/apiClient.ts` — a thin wrapper around `fetch`, not a heavy SDK:
- Base URL from `config/env.ts` (validated at build time, fails fast if missing)
- Every request gets a request ID (for correlating retries/logs)
- Streaming responses (Server-Sent Events or chunked `fetch` body) supported for the chat endpoint specifically; everything else is standard JSON request/response

### 5.2 Request/response contract (frontend-facing shape only — backend is out of scope)
```
POST /api/chat
{ message: string, conversationId: string, activeEntity?: string }

→ streamed response, each chunk one of:
{ type: "text-delta", text: string }
{ type: "component",  component: "resp-card" | "img-gallery" | "pdf-chip" | "source-line" | "verified-badge", payload: {...} }
{ type: "follow-up-chips", chips: string[] }
{ type: "error", code: "no-data" | "server-busy" | "timeout" }
{ type: "done" }
```
This shape is what lets `chatStore` decide, chunk by chunk, whether to render `StreamingText` or hand off straight to `SkeletonCard` → `ResponseCard` (§3 of Conversation Design v2) — the **type of the first non-text chunk determines the render path**, which is why this contract is specified here rather than left to the backend team to improvise.

### 5.3 Error handling
Every request is normalized into one of exactly the categories Conversation Design v2 §7 already defines — the API layer's job is to **map transport-level failures onto conversational states**, not invent new ones:

| Transport condition | Normalized as | Renders |
|---|---|---|
| `fetch` throws (offline) | `connection-lost` | `ErrorStateCard` |
| HTTP 5xx / timeout | `server-busy` | `ErrorStateCard` |
| HTTP 200 with `{type: "error", code: "no-data"}` | `no-official-data` | `WarningStateCard` |
| Unexpected/unparseable response | `unexpected` | `ErrorStateCard` (generic "Something went wrong" copy) |

### 5.4 Retry strategy
- TanStack Query default: **1 automatic retry** with a short fixed delay (700ms) for transient network errors only — not for `no-data` (that's a legitimate answer, not a failure) and not for HTTP 4xx (retrying won't help).
- Manual retry (the `.mini-btn` "Try again"/"Retry" inside `ErrorStateCard`) always available regardless of automatic retry outcome.
- No exponential backoff needed at this scale — this is a single-request chat interface, not a batch job; a fixed short delay keeps perceived latency low.

### 5.5 Timeout strategy
- 15s timeout for the initial response chunk (covers "thinking" time). If exceeded → `server-busy` state.
- No timeout on the overall stream once started (a long answer streaming slowly is not a failure) — only a stall timeout (10s of silence mid-stream) triggers a reconnect attempt.

### 5.6 Loading strategy
Directly implements §3 of Conversation Design v2: `TypingIndicator` while awaiting the first chunk, then either `StreamingText` (text-first response) or `SkeletonCard` (component-first response), decided by the first chunk's `type`.

### 5.7 Caching strategy
- TanStack Query caching is **not** used for chat messages themselves (conversation is sequential and stateful, not cacheable "GET" data).
- It **is** used for supporting reference data that doesn't change per-message — e.g., a prefetched category list for `TopicChips`, department directory lookups if the UI ever needs autocomplete. `staleTime` measured in hours for this kind of near-static reference data.

### 5.8 Future authentication support
The client is built auth-ready without implementing auth now:
- `apiClient.ts` has a single injection point for an `Authorization` header, currently a no-op.
- `conversationId` is already a first-class field in the request contract (§5.2) so that authenticated, persisted, cross-session history (§16) is additive, not a breaking change to the request shape.

---

## 6. Routing Strategy

**Routing is minimal by design**, because the assistant is a widget, not a multi-page app:

- **Embed build:** no routing at all — it's a mounted widget on whatever page the college's existing site puts it on.
- **Standalone build:** exactly one meaningful route, `/assistant`, plus the marketing/demo shell at `/`. No nested routing under `/assistant` — the conversation itself is not URL-addressable state (a chat isn't a page you navigate *within*).
- **Explicitly rejected:** deep-linking individual messages or turning each response type into its own route. This would fight the widget model and gain nothing — the whole point of the design is a persistent, page-independent assistant, not a page-based one.
- If a future requirement needs shareable/bookmarkable answers (e.g., "share this hostel info page"), that's a distinct, separate feature (a real content page rendered from the same data, not a chat "route") — noted in §16 as an option, not built now.

---

## 7. Responsive Design Strategy

Mobile-first Tailwind breakpoints, matching the prototype's existing mobile behavior exactly (`@media (max-width: 480px)` bottom-sheet takeover already defined in the design system):

| Breakpoint | Width | Chat window behavior |
|---|---|---|
| Mobile (portrait) | < 480px | `.chat-window` becomes a full-screen sheet (`100vw` × `100dvh`), `.welcome-pop` narrows to `calc(100vw - 20px)`, `env(safe-area-inset-bottom)` respected for the input bar and FAB |
| Mobile (landscape) | < 480px, landscape orientation | Same full-screen sheet; input area height capped so the keyboard doesn't push the send button off-screen (`max-height` on textarea already defined) |
| Tablet | 481px – 1024px | Chat window keeps its floating card treatment (fixed width/height, bottom-right), not full-screen — same as desktop, just confirm touch target sizes (§10) hold at this size |
| Laptop / Desktop | 1025px – 1440px | Default floating widget as prototyped: 404px × 660px |
| Large screens | > 1440px | No layout change to the widget itself; only the (future) standalone `/assistant` page's outer page chrome gets extra max-width constraints — the chat window does not grow indefinitely with viewport width, since a wider bubble/card doesn't improve readability |

All breakpoint values live in `tailwind.config.ts` as named tokens (`mobile`, `tablet`, `laptop`, `desktop`, `wide`) — no magic numbers in component code.

---

## 8. Theme Architecture

Directly implements the prototype's existing `data-theme="light"|"dark"` attribute and CSS custom property system — no new token system introduced.

- **Detection:** on first load (no stored preference), read `window.matchMedia('(prefers-color-scheme: dark)')` once, set as initial `themeStore.mode = "system"`.
- **Manual override:** `ThemeToggle` sets `mode` to `"light"` or `"dark"` explicitly, which takes precedence over system from then on.
- **Persistence:** `mode` persisted via Zustand's `persist` middleware to `localStorage` (embed build) — **not** to any storage requiring backend/cookies, since the embed target has no session concept yet. Falls back gracefully (no crash) in the rare case `localStorage` is blocked (e.g., strict privacy mode) — defaults to `"system"` for that session only.
- **System change listener:** a `matchMedia` change listener updates `resolvedTheme` live only when `mode === "system"` — doesn't override an explicit manual choice.
- **Application:** `ThemeProvider` sets `data-theme` on the widget's root node (the Shadow DOM host in embed mode, `<html>` in standalone mode) — matches the prototype's existing selector strategy (`html[data-theme="dark"]`) exactly.
- **Smooth transitions:** the prototype's existing `transition: background .35s var(--ease-out), color .35s var(--ease-out)` on `body` carries over unchanged; no new transition logic needed, just confirmed it applies at the new root node.

---

## 9. Animation Architecture

All animation timing/easing tokens are lifted directly from the prototype's existing CSS custom properties (`--ease-spring`, `--ease-out`) into `animations/transitions.ts` as the single source of truth — Framer Motion variants reference these, they don't redefine new curves.

| Interaction | Prototype reference | Framer Motion treatment |
|---|---|---|
| Widget opening (`WelcomePopup`, `ChatWindow`) | `pop-in` keyframe (scale + translateY) | `variants.popIn` — `initial/animate/exit` with `ease-spring` |
| Widget closing | reverse of pop-in | `exit` variant on `AnimatePresence` |
| FAB idle "breathe" | `fab-breathe` keyframe | CSS animation retained as-is (pure decorative loop — no benefit to moving to Framer Motion) |
| Message appearing | `msg-in` keyframe | `variants.messageIn`, applied per `MessageRow` on mount |
| Chip stagger-in | `chip-in` + `animation-delay` inline | Framer Motion `staggerChildren` on the chip container — replaces manual `animation-delay` math with declarative stagger |
| Streaming cursor blink | `blink` keyframe | Kept as pure CSS — no interaction logic needed, purely decorative |
| Typing indicator dots | `typing-bounce` keyframe | Kept as pure CSS |
| Skeleton shimmer | `sk-shimmer` keyframe | Kept as pure CSS |
| Card hover lift | `.resp-card:hover` box-shadow | Kept as CSS `:hover`, no JS needed |
| Button/chip press | `:active { transform: scale(.97) }` | Kept as CSS `:active` |
| Theme icon swap (sun/moon) | existing rotate/opacity cross-fade | Kept as CSS transition, driven by the `data-theme` attribute change |
| Scroll-to-latest FAB | opacity/transform toggle on `.show` class | Framer Motion `AnimatePresence` for enter/exit, since it's conditionally mounted rather than just class-toggled |

**Principle:** if the prototype already implements an animation in pure CSS and it has no complex enter/exit lifecycle to coordinate with React state, **it stays CSS** — Framer Motion is reserved for animations that need to coordinate with component mount/unmount (popups, message rows, chip lists, error cards appearing), not decorative loops.

**Performance:** all animations restricted to `transform` and `opacity` (already true of the prototype's keyframes) — no animating `width`/`height`/`top`/`left`, to stay off the main thread.

**Accessibility:** `MotionConfigProvider` wraps the app with `<MotionConfig reducedMotion="user">`, which makes Framer Motion respect `prefers-reduced-motion` automatically; the CSS-only animations already have the prototype's existing global `@media (prefers-reduced-motion: reduce)` override, so both animation systems honor the same user preference through one setting.

---

## 10. Accessibility Architecture (WCAG 2.2 AA)

| Area | Implementation |
|---|---|
| Keyboard navigation | Full tab order through Fab → Welcome actions → Chat header controls → message actions (only when focused, not just hovered) → chips → input → send. `Escape` closes `ChatWindow`/`WelcomePopup`. Arrow keys not required (no custom widgets needing roving tabindex, other than optionally the chip row) |
| Screen readers | `ChatScroll` is an `aria-live="polite"` region so new AI messages are announced without stealing focus; `TypingIndicator` gets `aria-label="Assistant is typing"`; `.copy-btn`/`.like-btn` get real `aria-label`s (identified as a gap in Conversation Design v2 §9 — fixed here) |
| ARIA attributes | `ChatWidget` root: `role="dialog"` `aria-label="GCE Tirunelveli Assistant"` when open; `Fab`: `aria-label="Open AI Assistant chat"` (already present in prototype markup — carried over); state cards: `role="alert"` for `ErrorStateCard`, `role="status"` for `WarningStateCard` (error is more urgent than "not found") |
| Focus management | On `ChatWindow` open, focus moves to the textarea; on close, focus returns to the `Fab`; on `WelcomePopup` open, focus moves to "Start Chat" |
| Reduced motion | Covered in §9 — one setting, both animation systems |
| High contrast | Design tokens already meet AA contrast in both themes per the design system; component library never hardcodes a color outside the token set, so a future high-contrast theme variant is a token change, not a component rewrite |
| Large touch targets | All interactive elements ≥ 44×44px on mobile breakpoint, matching the prototype's existing sizing (`.icon-btn`, `.send-btn` etc. already meet this) — enforced via a shared `minTouchTarget` Tailwind utility class rather than per-component sizing |
| Accessible forms | `ChatInputArea` textarea has a real `aria-label` (already present: "Message the assistant"); React Hook Form validation errors (future: structured input forms) always paired with `aria-describedby`, never color-only |
| Testing | See §14 |

---

## 11. Performance Optimization

1. **Lazy loading:** `WelcomePopup`, `ChatWindow`, and all `features/chat/components/cards/*` are dynamically imported (`next/dynamic` in standalone build, plain `React.lazy` in embed build) — the `Fab` alone is in the initial bundle; the rest loads on first interaction.
2. **Code splitting:** the embed bundle and standalone bundle are genuinely separate build outputs (§1.1) — the embed bundle specifically excludes any Next.js runtime code via a dedicated Vite config, keeping it as light as possible for injection into a legacy site.
3. **Image optimization:** `next/image` for the standalone build; for the embed build (no Next.js image server available on a static host), images are pre-optimized at build time (WebP/AVIF with fallback) and served from a CDN with explicit width/height to avoid layout shift in `ImageGallery`/`CardArtPanel`.
4. **Memoization:** `MessageRow` is wrapped in `React.memo` keyed on message ID — critical once a conversation is long, so re-renders from streaming the *latest* message don't re-render every prior row. Selectors from `chatStore` use Zustand's shallow-equality comparator to avoid this needing manual `useMemo` everywhere.
5. **Virtual rendering:** `ChatScroll` uses a windowing library (e.g., `@tanstack/react-virtual`, consistent with the rest of the TanStack usage) once a conversation exceeds ~50 messages — not from message 1, since virtualizing a short list adds overhead for no benefit; the threshold is configurable in `config/constants.ts`.
6. **Bundle optimization:** `lucide-react` icons imported individually (already tree-shakeable by design) rather than via a barrel import; Tailwind's JIT + content-path purging keeps CSS output scoped to actually-used classes.
7. **Caching:** TanStack Query caches reference/static data (§5.7); static assets (icons, fonts) served with long cache headers + content-hashed filenames.
8. **Prefetching:** on `Fab` hover/focus (a strong intent signal), prefetch the `WelcomePopup`/`ChatWindow` chunk before the click even happens, so opening feels instant.

---

## 12. Error Handling Architecture

This layer is the frontend implementation of Conversation Design v2 §7 — it does not introduce new error categories, it *catches* and *routes* into the existing ones.

| Layer | Responsibility |
|---|---|
| `apiClient.ts` | Normalizes all transport failures into the categories from §5.3 |
| `useSendMessage` hook | Catches normalized errors, updates `chatStore` with an error-type message entry instead of a normal reply |
| `MessageRow` | Renders `ErrorStateCard` or `WarningStateCard` when a message entry's type is an error/warning, instead of `Bubble` |
| `useOnlineStatus` hook | Listens to `navigator.onLine` + `online`/`offline` events; proactively shows a `Toast` ("You're back online") and does **not** auto-retry a failed message silently — the user explicitly retries via the state card's button, per Conversation Design v2's rule that retries are user-initiated, not silent |
| Global error boundary | A single React Error Boundary wraps `ChatWidget` — catches genuinely unexpected render exceptions (a malformed card payload, etc.) and falls back to a minimal "Something went wrong, please refresh" state *inside the widget only*, never crashing the host page it's embedded on. This is critical for the embed build specifically: a crash in the widget must never take down the college's actual website around it. |
| Offline mode | No offline-first data (there's nothing meaningful to show without a network) — `useOnlineStatus` simply pre-empts a doomed request with the `connection-lost` state immediately, rather than waiting for a timeout to discover the network is down |

---

## 13. Security Considerations (frontend-only scope)

| Concern | Approach |
|---|---|
| Input validation | React Hook Form schema validation (max length, no empty submit) before a message ever reaches `apiClient` — this is UX, not a security boundary; real validation must also happen server-side (noted as an assumption, out of this document's scope) |
| Output sanitization | All AI-generated text renders through `MarkdownRenderer` (`react-markdown`), which does **not** render raw HTML by default — this is the primary XSS defense for AI-generated content specifically, since the assistant's output is a form of untrusted content even though it's "our own" AI |
| XSS prevention | No `dangerouslySetInnerHTML` anywhere in `features/chat/`; any future rich-text need goes through a strict allow-list sanitizer (`lib/sanitize.ts`) rather than trusting the source |
| CSRF awareness | The chat endpoint is a same-origin API route (or a token-authenticated cross-origin call once auth ships, §5.8) — no cookie-based session exists yet, so classic CSRF doesn't apply today; documented here so it's revisited the moment cookie-based auth is added |
| Secure API communication | HTTPS-only enforced at the deployment level (out of frontend scope to configure, but the client never falls back to `http://`); no secrets/API keys are ever present in frontend bundle code — the embed bundle in particular must never ship a backend credential, since its source is fully inspectable by anyone viewing the college site |
| Safe handling of uploaded files (future) | When the disabled "attach file" button (already in the prototype as a "coming soon" affordance) is enabled: client-side file-type/size validation is a UX nicety only; the actual security boundary (virus scanning, type sniffing, size limits) must be server-side — frontend responsibility is limited to not previewing/rendering an uploaded file's raw content unsanitized |
| Prompt injection via the UI | The frontend does not attempt to "detect" prompt injection (that's a model/backend concern) — but it does enforce that **user input is always rendered as plain text**, never as markdown/HTML, in `MessageRow` for `.msg-row.user` bubbles. This closes one specific frontend-side injection vector: a user pasting something that looks like a UI instruction or fake system message can never be rendered as if it were a real formatted assistant message, because the two message types use different, non-interchangeable rendering paths (`Bubble` + `MarkdownRenderer` only ever renders `role: "assistant"` content) |

---

## 14. Testing Strategy

| Layer | Tool | What it covers |
|---|---|---|
| Unit testing | Vitest | Pure functions (`lib/`), store logic (`chatStore` reducers/actions in isolation), API response normalization (§5.3 mapping table) |
| Component testing | React Testing Library (with Vitest) | Individual components render correctly per props — e.g., `ResponseCard` shows `ImageGallery` only when images are passed, `Chip` renders the `follow` visual variant correctly |
| Integration testing | React Testing Library + MSW (Mock Service Worker) | Full `useSendMessage` flow: user types → mocked streamed response → correct sequence of `TypingIndicator` → `StreamingText`/`SkeletonCard` → final card, matching §3 of Conversation Design v2 exactly |
| End-to-end testing | Playwright | Real browser flows: open widget → welcome popup → start chat → ask a question → see a rich card → click a follow-up chip → theme toggle persists on reload; run against both the embed build (injected into a static test HTML page) and the standalone build |
| Accessibility testing | `axe-core` (via `@axe-core/playwright` or `jest-axe`) run in CI on key states (idle, rich card, error state, welcome popup) | Automated WCAG rule coverage as a baseline; manual screen-reader pass (VoiceOver/NVDA) before major releases is still required and not replaced by automation |
| Visual regression testing | Playwright's built-in screenshot comparison (or Chromatic if Storybook is adopted) | Catches unintended drift from the approved design system — critical given this document's constraint that nothing may silently redesign the approved prototype |

**Storybook** (recommended, not mandatory) is worth adding early specifically because so many components (`ResponseCard`, `ErrorStateCard`, `Chip` variants) have a fixed, enumerable set of states defined by the design system — a story per state doubles as living documentation of the mapping in §3.

---

## 15. Frontend Development Roadmap

| Milestone | Scope |
|---|---|
| 1 — Project setup | Next.js + TS + Tailwind scaffold; separate embed build pipeline stubbed out early (§1.1) so it's never a late retrofit; CI pipeline (lint, typecheck, test) from commit one |
| 2 — Design system in code | Tailwind config with design tokens from the approved system; `components/ui/` primitives (`Button`, `Chip`, `Badge`, `SourceLine`, `IconButton`) built and Storybook-documented before any feature work starts |
| 3 — Core layout & providers | `ThemeProvider`, `QueryProvider`, `MotionConfigProvider`; `Fab`, `WelcomePopup`, `MinimizedPill` wired to `uiStore` |
| 4 — Chat widget shell | `ChatWindow`, `ChatHeader`, `ChatScroll`, `ChatInputArea` — static, no real API yet, seeded with mock messages |
| 5 — Message rendering | `MessageRow`, `Bubble`, `MarkdownRenderer`, `TypingIndicator`, `StreamingText` against a mocked streaming endpoint (MSW) |
| 6 — Rich response components | `ResponseCard` + subcomponents, `ImageGallery`, `PdfChip`, `VerifiedBadge`, `SourceLine`, `SkeletonCard` — all driven by the response schema (§5.2) against mock payloads |
| 7 — Chips & follow-up logic | `TopicChips`, `FollowUpChips`, `useFollowUpChips` — wired to Conversation Design v2's chip mapping rules |
| 8 — Error/warning states | `ErrorStateCard`, `WarningStateCard`, `useOnlineStatus`, error boundary, retry flows |
| 9 — Theme system | Full light/dark implementation (§8), persistence, system detection, smooth transitions |
| 10 — Accessibility pass | Full keyboard/screen-reader/focus-management audit against §10, automated `axe` in CI from here on |
| 11 — Real API integration | Swap MSW mocks for the live chat endpoint; finalize retry/timeout tuning against real latency |
| 12 — Performance & production hardening | Lazy-loading audit, bundle size budget enforcement, virtualization threshold tuning, embed-build size check against a hard KB budget (since it loads on top of someone else's page) |
| 13 — Cross-target QA | Full test pass (§14) on both embed and standalone builds; visual regression baseline locked |
| 14 — Launch | Embed script deployed to a CDN, integration snippet handed to the college's site maintainers with the "no redesign, no framework required" one-line install |

---

## 16. Future Expansion — architectural readiness, not implementation

| Future capability | Why this architecture already supports it without a rewrite |
|---|---|
| Voice input | `InputIcons` already has a disabled "voice" affordance in the approved prototype; wiring it is adding a new hook (`useVoiceInput`) that writes into the same textarea state React Hook Form already owns — no new state architecture needed |
| Voice output | A new rendering mode for `Bubble`/`StreamingText` (audio playback alongside text) — additive to the existing message type union (`types/message.ts`), not a schema break |
| Tamil language | The response schema (§5.2) carries only structured data + plain strings — localizing is a string-table swap at the point strings are generated (backend or a thin i18n layer), not a frontend architecture change; `config/constants.ts` chip labels already isolated from component logic for exactly this reason |
| Notifications | `notificationStore` already exists (§4) as a separate concern from chat content — a future push/web-notification integration attaches here, not into `chatStore` |
| Authentication | `apiClient`'s auth header injection point (§5.8) and `conversationId` already being a first-class field (§5.2) mean login is additive: a new `authStore`, a login form using the same React Hook Form pattern, and the existing request contract gains a token — no restructuring of chat state |
| Student login / Faculty login | Both are the same underlying auth capability with different role claims — the frontend doesn't need to know the difference beyond what UI a role unlocks, handled by conditional rendering, not architecture |
| Admin dashboard | A genuinely separate `features/admin/` folder and likely a separate route group — deliberately not shoehorned into `features/chat/`; the shared `components/ui/` primitives are reused, keeping visual consistency without coupling the two features' logic |
| Analytics | A single `lib/analytics.ts` event-emitter, called from existing action points (`sendMessage`, chip clicks, retry clicks) — because state changes already flow through defined store actions rather than scattered inline handlers, instrumenting them is a wrapper, not a rewrite |
| Mobile app reuse | Because `features/chat/` logic (hooks, store, service layer) is kept free of DOM-specific code where possible, a React Native shell could reuse `chatStore`, `useSendMessage`, and the response-schema types directly, re-implementing only the presentational component layer (`components/ui/`, `features/chat/components/`) — this is the main reason state/logic and presentation are so strictly separated throughout this document |

---

## Summary of constraints honored

- No visual component was redesigned, renamed, or restructured — §3's table is a 1:1 mapping to the approved prototype's existing classes.
- No conversational behavior was changed — §5, §11, and §12 implement Conversation Design v2's rules exactly, they don't reinterpret them.
- No code was generated — this document specifies structure, contracts, and responsibilities only.
- Every major decision (§1.1 embed-vs-standalone, §4's store split, §5.2's response contract) is justified against a concrete constraint from the brief (thousands of concurrent users on a legacy college site, not a green-field app) rather than asserted as a default best practice.

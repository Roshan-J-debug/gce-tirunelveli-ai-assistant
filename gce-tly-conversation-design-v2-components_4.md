# GCE Tirunelveli AI Assistant — Conversation Design v2
### (Component-Integrated — built directly on `rosh_claude_1.html` / Design System v2)

**What changed from v1:** the conversation logic is now wired to the *exact* components that already exist in the completed prototype. Nothing here introduces a new visual pattern — every behavior below cites a real class from the prototype. Where v1 described a template loosely (e.g., "rich response card"), this version pins it to the literal markup (`.resp-card`, `.art-panel`, `.mini-btn`, etc.) so engineering can wire conversation logic straight to existing components with no interface changes.

Personality, tone-of-voice table, emoji rules, trust & safety rules, and multi-language architecture from v1 are **unchanged** and not repeated in full here — this document only touches what's new: mapping behavior → component.

---

## 1. Component Inventory (canonical names — reference this table, not v1's generic names)

| Component (spec name) | Prototype class(es) | Purpose |
|---|---|---|
| Launcher | `.fab` + `.fab-hint` + `.badge` | Entry point, hover hint, unread count |
| Welcome Popup | `.welcome-pop` (`.banner`, `.avatar`, `.fact-pill`, `.btn-primary`, `.btn-ghost`, `.footnote`) | First-visit introduction |
| Chat Window | `.chat-window` | Main conversational surface |
| Chat Header | `.chat-header` (`.ai-avatar`, `.dot-online`, `.win-actions`, `.theme-toggle`) | Identity, status, window controls |
| Thinking Ring | `.ai-avatar.thinking` | Processing indicator on the header avatar |
| Message Row | `.msg-row.ai` / `.msg-row.user` | One turn in the conversation |
| Bubble | `.bubble` | Direct-answer text |
| Message Actions | `.msg-actions` (`.copy-btn`, `.like-btn`) | Post-reply utility, appears on hover |
| **Verified Source Badge** | `.verified-badge` | Standalone pill marking a card-anchored or multi-fact claim as officially sourced |
| **Source Line** | `.source-line` | Lightweight inline citation + link, for single-fact answers that don't warrant a full badge |
| Popular Topic Chips | `.chips-label` + `.chips-row` + `.chip` | Cold-start category suggestions |
| **Follow-up Chips** | `.chip.follow` | Post-answer contextual suggestions (visually distinct: gold-line border, smaller) |
| **Typing Indicator** | `.typing-bubble` | Waiting for a response, no content yet |
| Streaming Cursor | `.stream-cursor` | Answer being written word-by-word |
| **Skeleton Loading** | `.skeleton-card` (`.sk-line`) | Waiting for a data-heavy card/report to assemble |
| **Rich Response Card** | `.resp-card` (`.art-panel`, `.icon-mark`, `.cap`, `.head-row`, `h5`, `.updated-tag`, `.btn-row`, `.mini-btn`, `.mini-btn.gold`) | Structured factual answer with an action |
| **Image Gallery** | `.img-gallery` (`.g-tile`, `.more`) | Multiple campus/facility visuals |
| PDF Attachment Card | `.pdf-chip` | Document-sourced answer with download |
| **Error State** | `.state-card.err` | Connection/server failure |
| **Warning State** | `.state-card.warn` | No official information found / needs rephrasing |
| Scroll-to-Latest | `.scroll-fab` | Appears once user scrolls up in a long thread |
| Input Bar | `.chat-input-area` (`.input-row`, `.input-icon-btn`, `.send-btn`) | Composing a message |
| Input Footnote | `.input-footnote` | Standing disclaimer under the input |
| Minimized Pill | `.chat-minimized` (`.pulse-dot`) | Background/away state |
| Day Divider | `.day-divider` | Separates turns across calendar days in a resumed session |

If a behavior described below seems to need something not on this list, **it doesn't** — reread §6 first; almost everything maps onto `.resp-card`, `.bubble`, `.verified-badge`, `.source-line`, `.chip.follow`, `.img-gallery`, or `.pdf-chip` in combination.

---

## 2. Master Assembly Rule (component order, every AI turn)

An AI turn is always one `.msg-row.ai`, containing, in this order:

```
.msg-avatar.ai
.msg-body
 ├─ .bubble                      (always — the direct answer, 1–2 sentences minimum)
 ├─ .verified-badge  OR  .source-line   (whichever fits — see §6.1 rule)
 ├─ [ONE optional structured block]:
 │     .resp-card   — structured single-topic answer with an action
 │     .img-gallery — only ever directly under a .resp-card, never standalone
 │     .pdf-chip     — only when the answer is sourced from a document
 ├─ .msg-time + .msg-actions (.copy-btn, .like-btn)   (always, on every AI bubble)
 └─ .chips-row of .chip.follow   (after the reply is fully rendered — 3–5 chips)
```

Nothing renders outside this order. A reply never opens with a card and no bubble — the bubble sentence always comes first, even when a card follows.

---

## 3. Loading / Thinking Sequence (maps to the prototype's `runStreamDemo()` pattern)

| Step | Component |
|---|---|
| 1. User sends | `.msg-row.user` renders instantly |
| 2. Processing starts | `.ai-avatar.thinking` (conic spin) activates on the header avatar |
| 3. Waiting for first content | `.typing-bubble` appears in `.chat-scroll` |
| 4a. **Short conversational answer** | `.typing-bubble` removed → `.bubble` fills word-by-word with `.stream-cursor` at the caret → cursor removed on completion → thinking ring stops |
| 4b. **Data-heavy answer** (table, report, multi-fact card) | `.typing-bubble` removed → `.skeleton-card` (3–4 `.sk-line`) shown in its place → swapped whole for the completed `.resp-card` (never streamed line-by-line) |

**Rule for engineers:** the choice between 4a and 4b is determined by answer *type*, not randomized. Plain-sentence facts stream as text. Anything that resolves to a card, table, or gallery skeleton-loads and appears complete — a card should never "type itself" character by character.

---

## 4. Greeting Flow → Components

| Moment | Component sequence |
|---|---|
| First-time visitor lands on page | `.fab-wrap` visible; `.fab-hint` shows on hover |
| User clicks `.fab` | `.welcome-pop` opens: banner + avatar + three `.fact-pill`s + `.btn-primary` "Start Chat" + `.btn-ghost` "Later" + `.footnote` (checkmark + "Answers verified against official GCE Tirunelveli sources") |
| User clicks "Start Chat" | `.welcome-pop` closes → `.chat-window` opens directly into the idle state: `.bubble` greeting + `.chips-label` "Popular topics" + `.chips-row` of plain `.chip` (never `.chip.follow` — that class is reserved for post-answer only) |
| User clicks "Later" | `.welcome-pop` closes, `.fab` remains, no chat window opens |
| Returning visitor reopens the widget in the same session | Skip `.welcome-pop` entirely → `.chat-window` opens directly to idle state, or resumes existing `.chat-scroll` content with a `.day-divider` if time has passed |
| Widget is backgrounded with a new message | `.chat-minimized` pill shown with `.pulse-dot`; clicking it reopens `.chat-window` at the resumed scroll position |

Time-of-day and festival greeting *text* from v1 (§5) is unchanged — it simply fills the first `.bubble` in the idle template instead of introducing a new greeting component.

---

## 5. Popular Topic Chips vs. Follow-up Chips — do not conflate these

The prototype already has two distinct chip treatments; conversation logic must route to the correct one and never invent a third:

| | Component | When it appears | Content |
|---|---|---|---|
| Cold-start chips | `.chip` inside `.chips-row`, under `.chips-label` | Only in the idle/greeting state | The full v1 §6 category list (Admissions, Hostel, Courses…) |
| Follow-up chips | `.chip.follow` | After every substantive AI reply | 3–5 chips specific to the answer just given (v1 §12 logic — text unchanged, render target is now explicit) |

---

## 6. Response Content → Component Mapping

### 6.1 Badge vs. source-line — the actual rule
Use `.verified-badge` when the reply is anchored to a `.resp-card`, `.img-gallery`, or `.pdf-chip`, or states more than one fact. Use the lighter `.source-line` when the whole answer is a single one-line fact with nothing else attached. Never use both on the same reply.

### 6.2 Short factual answer
`.bubble` + `.source-line`
> "The library is open 8:00 AM – 8:00 PM, Monday to Saturday."
> `.source-line`: Source: Library Office

### 6.3 Structured single-topic answer (the prototype's own worked example — hostel facilities)
`.bubble` (lead sentence) → `.verified-badge` → `.resp-card`:
- `.art-panel` with `.icon-mark` + `.cap` caption (e.g., "📍 Hostel Block — campus map")
- `.head-row` / `h5` title
- `.updated-tag` ("Updated for AY 2026–27")
- body `p`
- `.btn-row`: one `.mini-btn` (primary navigation action, e.g., "Visit Hostel Page") + optionally one `.mini-btn.gold` (document/download action, e.g., "Download Fee Structure")

### 6.4 Multi-image topics (hostel, campus, labs, sports)
Append `.img-gallery` directly under the `.resp-card` — never standalone, never replacing the card. First tile large (per existing grid), overflow beyond 2 extra images shown via `.more` ("+N") on the third tile.

### 6.5 Document-sourced answer
`.pdf-chip` placed after the card (or directly after the bubble+badge if there's no card): filename, file size, "Official document" tag — mirrors the existing `Hostel_Prospectus_2026.pdf` pattern exactly.

### 6.6 Lists and tables
Render natively *inside* `.bubble` (markdown list/table). No new component — this was already true in v1 and stays true.

### 6.7 Announcements / notices
`.bubble` + `.verified-badge`. Add a `.resp-card` only if the notice has a linked action (e.g., "View Full Notice" as a `.mini-btn`); otherwise text alone is enough.

### 6.8 Faculty / department / contact info
`.resp-card` using `.icon-mark` only (no photo), `.btn-row` with `.mini-btn` actions for contact methods (call, email) instead of navigation links.

### 6.9 Map response
`.resp-card` with `.art-panel` using a location-pin `.icon-mark` and `.cap` caption; `.mini-btn` "Open in Maps" in `.btn-row`.

### 6.10 Streamed vs. skeleton — cross-reference
See §3 — this decision is answer-type driven, not per-category. A one-line hostel fee streams as text; the full hostel facilities answer above skeleton-loads because it resolves to a card.

---

## 7. Error & Edge States → Components

| Situation | Component | Content pattern (from the prototype's existing `error` template) |
|---|---|---|
| No official information found | `.state-card.warn` | icon-wrap, `h6` "No official information found", `p` redirect copy, `.mini-btn` "Rephrase my question" |
| Connection lost / no internet | `.state-card.err` | `h6` "Connection lost", `p` "your question has been saved", `.mini-btn` "Retry" |
| Server busy | `.state-card.err` | `h6` "Server busy — a lot of students are asking right now", `p`, `.mini-btn` "Try again" |
| Temporary AI issue | `.state-card.err` | Same pattern as server busy, with copy adjusted; `.mini-btn` "Retry" |

**Stacking rule:** show **one** `.state-card` for the actual failure that occurred. The prototype's demo view stacks warn+err+err together for review purposes only — that is a showcase artifact, not real runtime behavior. In production, only the state that actually happened renders.

**Not a `.state-card` case:** unrelated, offensive, or unsafe questions are conversational redirects, not system failures — they render as a plain `.bubble` (per v1 §10 wording), never a `.state-card`. Reserve `.state-card` strictly for things that are actually broken (network, server, missing data).

---

## 8. Memory, Session & Edge Cases — component note

No new component is needed for memory/pronoun resolution (v1 §11 logic is unchanged) — resolved answers render through the same §6 mapping as any other reply. `.day-divider` is used only when a widget session is resumed across a real calendar-day gap, not within one sitting.

Edge cases from v1 §18 keep their text; render target: "Hi" / one-word / emoji-only inputs all route to the same idle-state chip block described in §4, not a special component.

---

## 9. Accessibility — implementation notes tied to what already exists

- `:focus-visible` (gold outline) is already defined globally in the prototype for buttons, chips, and the textarea — dynamically injected content (`.chip.follow`, `.state-card` buttons, `.resp-card` buttons) inherits this automatically since it reuses the same classes. No extra work, just don't override it with inline styles when generating cards.
- `prefers-reduced-motion` is already handled globally (`.typing-bubble`, `.skeleton-card`, `.fab` breathe animation, etc. all respect it) — conversation logic doesn't need a parallel check, just avoid introducing motion outside these existing animated components.
- `.copy-btn` / `.like-btn` currently have `title` attributes only ("Copy", "Helpful") — recommend adding matching `aria-label`s, since `title` isn't reliably announced by all screen readers. This is the one real gap found while mapping conversation behavior onto the existing markup.

---

## 10. Sample Conversations — Storyboarded with Components

Format: each AI turn lists the exact component sequence it renders, per §2.

**1. First-time greeting**
> U clicks `.fab` → `.welcome-pop` → clicks "Start Chat" → `.chat-window` opens:
> `.bubble` ("Vanakkam! I'm the GCE Tirunelveli Assistant...") + `.chips-label` "Popular topics" + `.chips-row` (`.chip` ×8)

**2. Short fact**
> U: "Library timings?" → `.msg-row.user`
> A: `.typing-bubble` (0.8s) → `.bubble` streams "8:00 AM – 8:00 PM, Monday to Saturday." + `.source-line` (Library Office) → `.chips-row` of `.chip.follow` (Book Renewal, Reading Room, Membership)

**3. Rich card + gallery + PDF (hostel — matches prototype's own `rich` template)**
> U: "Tell me about hostel facilities" → `.msg-row.user`
> A: `.ai-avatar.thinking` → `.typing-bubble` → `.skeleton-card` (card is data-heavy) → replaced by:
> `.bubble` (lead sentence) + `.verified-badge` + `.resp-card` (art-panel, head-row, updated-tag, body, btn-row with `.mini-btn` + `.mini-btn.gold`) + `.img-gallery` (3 tiles, third shows `+6`) + `.pdf-chip` (Hostel_Prospectus_2026.pdf) → `.msg-actions` → `.chips-row` `.chip.follow` (Hostel Rules, Mess Menu, How to Apply)

**4. Server busy**
> U: "What's the canteen menu today?" → `.msg-row.user`
> A: `.ai-avatar.thinking` → `.typing-bubble` (timeout) → `.state-card.err` ("Server busy…", `.mini-btn` "Try again")

**5. No official information found**
> U: "Does GCE TLY have a swimming pool?" → `.msg-row.user`
> A: `.typing-bubble` → `.state-card.warn` ("No official information found", `.mini-btn` "Rephrase my question")

**6. Connection lost**
> Network drops mid-session → `.state-card.err` ("Connection lost — your question has been saved", `.mini-btn` "Retry") appears in place of the pending reply

**7. Memory / pronoun resolution**
> U: "Tell me about ECE." → A: `.bubble` + `.source-line`, `.chip.follow` set for ECE
> U: "What's its placement record?" → resolves "its" → ECE → A: `.bubble` + `.verified-badge` + `.resp-card` (placement stats) → new `.chip.follow` set

**8. Emoji-only input**
> U: "🎓" → `.msg-row.user`
> A: `.bubble` ("Looks like you're interested in academics! Want to know about admissions, courses, or departments?") + `.chips-row` `.chip` (not `.follow` — this is a re-entry into topic selection, same treatment as idle chips)

**9. Returning to a minimized chat**
> New message arrives while minimized → `.chat-minimized` shows `.pulse-dot` → user clicks it → `.chat-window` reopens at the existing `.chat-scroll` position, no `.welcome-pop`, no reset

**10. Multi-question in one message**
> U: "What's the hostel fee and when do exams start?" → `.msg-row.user`
> A: single `.msg-row.ai` containing two `.bubble`-level statements in sequence inside one `.msg-body` (hostel fee + `.source-line`, then exam date + `.source-line`), followed by one combined `.chips-row` `.chip.follow` set — not two separate message rows.

*(Full 55-conversation set from v1 §19 keeps its text; apply the same component pattern shown in examples 1–10 above when implementing the rest — most fall into pattern 2 (short fact) or pattern 3 (rich card) with the appropriate error patterns from 4–6 for the "I don't have that on file" cases.)*

---

## 11. What this document deliberately does NOT do

- Does not introduce a "map card" beyond the existing `.resp-card` + `.art-panel` combination (§6.9) — no new map component.
- Does not introduce a separate "PDF summary card" — `.pdf-chip` plus a normal `.bubble` summary above it covers this (§6.5).
- Does not introduce a distinct "announcement" component — reuses `.bubble` + `.verified-badge` (+ optional `.resp-card`), §6.7.
- Does not add new chip variants beyond the two that already exist (`.chip` and `.chip.follow`), §5.
- Does not add new state-card variants beyond `.err` and `.warn` that already exist, §7.

If a future content type genuinely can't be expressed with the components in §1, that's a UI decision for the design system owner — not something conversation design should route around by inventing markup.

# dummy-rag — design

Date: 2026-10-27
Repo: `~/git-repos/dummy-rag` (new, own history)

## Goals

- Feature parity with Lattice (inventory below), re-themed to the fintech domain.
- Two themes: **Quiet Paper** (light) and **Midnight Glass** (dark), as approved in the prototype.
- Calm, deliberate motion (spec below) that makes the UI feel cleaner, not busier.
- Mock data and a mock retrieval engine realistic enough that a showcase of Neo4j Graph-RAG is convincing, including for questions the seeded examples don't cover.
- A typed client contract (`POST /chat`) so a real backend can be dropped in later.

## Non-goals

- No real backend, database, LLM or embedding calls. Nothing leaves the browser.
- No features beyond Lattice's. "Keep feature and functionalities same for now."
- No auth or multi-user features.

## Anti-goals (would count as failure even if it technically works)

- Canned answers: only the suggested questions working, and anything else returning nonsense.
- Motion that feels busy, bouncy or slow, or that gets in the way of reading.
- Fake-looking data, such as "Company A" or lorem ipsum, or Cypher that wouldn't run against the described schema.
- Copying Lattice's code, text or assets. Lattice informs *what* the features are; the implementation, copy and data are new.

## Stack (user chose React; the rest is my call)

- React + TypeScript + Vite; React Router (hash routing, so it works on GitHub Pages like the original).
- Motion (`motion/react`) for transitions; D3 (`d3-force`, `d3-hierarchy`) for the 2D graphs; three.js for the WebGL 3D view.
- A markdown renderer with sanitisation (Lattice uses marked + DOMPurify).
- Icons: lucide-react (Lattice uses lucide).
- Deploy target: GitHub Pages, as a static build. My call, matching the original.

## Feature inventory (from REA analysis of the Lattice bundle → dummy-rag)

### App shell and routes
- Routes: `/` (chat), `/architecture`, `/guide`, plus a catch-all redirect.
- **Sidebar:** home/brand link, **New conversation**, **Search conversations**, and a conversation list grouped **Today / Yesterday / Previous 7 days / Older**. Each conversation has a menu with **Rename** and **Delete** (inline "Delete? Yes" confirm). Footer: **Guide** link ("Every feature explained"), **Architecture** link, **theme toggle**. On narrow screens the sidebar collapses behind an "Open conversations" button.
- Escape closes any open menu or popover.

### Chat
- Empty state: a headline ("What do you want to know about leave?" → a fintech equivalent), a disclaimer line ("only answers from the graph and cites every claim; figures are illustrative"), and **suggested question** chips.
- Each assistant message has:
  - Streamed markdown answer with inline citation markers.
  - **Grounding confidence** indicator.
  - **Question after context resolution:** shows the rewritten question when a follow-up was resolved against earlier turns.
  - A per-turn stats line (settings used, timings).
  - **Suggested follow-ups** chips.
  - Actions: **Copy answer** (as markdown), **Regenerate** (with the current settings), **Good answer / Poor answer** ratings (local only).
- A pending state while the answer is generated, describing the work: "<mode> retrieval · querying Neo4j…" or "reading the snapshot…".
- Conversation menu: **Export conversation** (JSON with evidence) and **Clear conversation** (keeps the thread, removes its messages).

### Composer (all settings visible; no hidden settings)
- **Data source:** *Live Neo4j* ("Bolt connection, Cypher per request") or *Offline snapshot* ("exported from the graph"). Both are simulated; they differ in labels and latency profile.
- **Retrieval mode:** *Lexical* (full-text index on names and aliases), *Vector* (embedding similarity), *Hybrid* (lexical + vector fused with RRF), *Graph* (3-hop traversal from the fused seeds).
- **Context** toggle: use conversation context to resolve follow-ups.
- **LLM** toggle: generate an answer, or when off, return an extractive answer made of the grounding facts verbatim.
- Enter sends; Shift+Enter inserts a newline.

### Evidence panel (per assistant turn)
Tabs: **Subgraph · Facts · Sources · Cypher · Trace**. Each tab has a "What is this tab?" help popover.
- **Subgraph:** a graph-view switcher with 5 views:
  - *Force*: d3-force; nodes used in the answer get a ring.
  - *Radial*: hierarchy/tree layout. Lattice's is World → country → rule; dummy-rag's is jurisdiction → entity type → entity (my call).
  - *Orbit*: a dependency-free canvas pseudo-3D view with depth and glow.
  - *3D*: three.js WebGL force graph, with particles flowing along the grounding path.
  - *Replay*: the retrieval steps animated on the graph.

  The panel also has a **Legend** and a **"Dim everything the answer did not use"** toggle. Clicking a node opens its source. Scroll zooms; in Force, nodes can be dragged. The chosen view persists.
- **Facts:** a table with columns subject / relation / object / confidence. It has a filter (empty result: "No facts match.") and an "Only facts used in the answer" toggle.
- **Sources:** the cited passages (the document section each fact was extracted from).
- **Cypher:** the exact queries this turn "ran", each annotated by stage.
- **Trace:** the pipeline stages with timings and per-stage detail, e.g. "No pronouns or ellipsis to resolve."

### Pipeline stages (shown in Trace and Replay)
1. Resolve conversation context
2. Lexical match (full-text index)
3. Vector match (embedding index)
4. Fuse (RRF)
5. Seed selection for traversal
6. Graph expand (APOC path walk, scoped to jurisdiction)
7. Rank facts by confidence × seed proximity
8. Fetch cited passages
9. Generate grounded answer (LLM), or Extractive answer (LLM off)

Which stages run depends on the retrieval mode. Lexical-only mode, for example, skips vector and fuse.

### Architecture page
A static explainer of the hybrid Graph-RAG pipeline, rewritten for the fintech domain: why hybrid, why graph; how entities and relations are extracted from documents with provenance; the request pipeline; the evidence panel; settings per request; offline mode; the single `POST /chat` endpoint.

### Guide page
"Every feature explained": a walkthrough of each control above. Includes a section explaining each Cypher query, plus keyboard and mouse shortcuts (Enter, Escape, scroll on a graph, drag a node in Force, click a node to open its source) and a theme note.

### Persistence (localStorage, all wrapped in try/catch)
Conversations, composer settings, theme and preferred graph view. Keys are namespaced `dummy-rag.*`, e.g. `dummy-rag.theme` and `dummy-rag.graph-variant`.

## Domain: financial-crime investigation

### Fictional world (my call on specifics; must look realistic)
About 150–300 entities across 2–3 jurisdictions (US, UK, EU, and an offshore registry), with plausible names, registration numbers, IBAN-style account IDs and dates. Everything is fictional, and the app says so.

- **Node labels:** `Person`, `Company`, `Account`, `Transaction`, `Address`, `Device`, `SanctionsEntry`, `Jurisdiction`, `Regulation`, `Case`, `Document`, `Section`.
- **Relationships:** `OWNS {pct}`, `DIRECTOR_OF`, `CONTROLS`, `HOLDS` (person/company → account), `SENT` / `RECEIVED` (account ↔ transaction), `REGISTERED_AT`, `USED_DEVICE`, `MATCHES {score}` (entity → sanctions entry), `INCORPORATED_IN`, `GOVERNED_BY`, `SUBJECT_OF` (entity → case), `CITED_IN` (fact → section).
- **Provenance (my call):** every extracted relationship carries `confidence` and `section_id` properties. `Section` is a real node, `(:Document)-[:HAS_SECTION]->(:Section)`, and Cypher joins to it with `MATCH (s:Section {id: r.section_id})`. Neo4j relationships can't point at nodes, so this replaces a literal `CITED_IN` edge. The Facts, Sources and Cypher tabs all derive from this one model.
- **Alerts (my call):** transaction-monitoring alerts are `Alert` nodes, `(:Alert)-[:FLAGS]->(:Transaction)`, with `rule`, `reason` and `threshold` properties. "Why was X flagged" is then a graph lookup, not inference.
- **Source documents:** company-registry filings, KYC onboarding files, analyst case notes, SAR narratives, sanctions-list entries, and short regulation excerpts (FinCEN CDD rule, EU AMLD, UK MLRs). Paraphrased and fictional where needed.

### Seeded scenarios (so there are stories to find)
1. **Layered ownership:** an operating company owned through 3 shell companies across jurisdictions, ending at a beneficial owner.
2. **Sanctions-evasion front:** a trading company whose director fuzzy-matches a sanctions entry and shares an address with a listed party.
3. **Money-mule ring:** several retail accounts sharing devices and addresses, receiving structured deposits just under reporting thresholds and fanning out to one collector account.
4. **Benign look-alikes:** entities that look suspicious on the surface but resolve as clean, so answers can say "no".

### Suggested questions (examples)
- "Who ultimately owns Meridian Trade LLC?"
- "Is account GB29 … connected to a sanctioned party?"
- "Why was the 14 March wire flagged?"
- Follow-ups: "Who else shares that address?", "Show the money trail", "Which regulation requires reporting this?"

Jurisdiction scoping replaces Lattice's country scoping: a question naming the UK should not pull in US rules.

### Question kinds that must get a real answer for any entity in the graph (my call)
1. **Ownership and control:** direct owners, ultimate beneficial owner (walk `OWNS` and multiply percentages along the path), directors, controllers.
2. **Shared attributes:** who else shares an address, device or director with X.
3. **Sanctions exposure:** is X within k hops of a `SanctionsEntry`. Report the path and the `MATCHES` score.
4. **Money trail:** transactions out of or into an account, and the path between two accounts within a date window.
5. **Why flagged:** the alerts on a transaction or account, with their rule, reason and threshold.
6. **Regulation:** which regulation applies to a situation in a jurisdiction (via `GOVERNED_BY` and regulation sections).
7. **Entity profile:** "tell me about X", a summary of its neighbourhood.

A reasonable question about an entity in the graph that fits none of these gets the best-ranked facts as an extractive answer, not "no match". "No matching facts in the graph" is reserved for questions that match no entities.

## Data and backend seam

- **`ChatClient` interface:** `chat(request) → stream of events`, mirroring `POST /chat`.
  - The request carries the question, the conversation history (for context resolution) and the settings (source, mode, context, llm).
  - The stream emits trace stage events, answer tokens, and a final payload: answer markdown, citations, facts, sources, cypher[], subgraph {nodes, edges, used flags}, confidence, resolved question and timings.
- **The in-browser engine is permanent (user's decision).** It is the lasting **Offline** mode, so the static GitHub Pages demo keeps working with no server, even after the real backend exists. Build it to production quality, not as throwaway scaffolding.
  - `SnapshotChatClient` runs the engine over the bundled dataset.
  - `HttpChatClient` (later) talks to the real `POST /chat`.
  - The composer's **Data source** setting picks the client per request: *Offline snapshot* → `SnapshotChatClient`; *Live Neo4j* → `HttpChatClient` when a backend URL is configured.
  - Until a backend exists, *Live Neo4j* is also served by the snapshot engine, using the slower "live" latency profile, and the UI labels it as simulated.
  - Both clients emit the same event stream, defined here. It's a new format, not Lattice's wire format.
- **The mock engine actually computes results.** It does not look answers up by question.
  - Lexical: token and alias matching over names.
  - Vector: precomputed similarity vectors, or a cheap deterministic stand-in.
  - Fusion: RRF.
  - Expansion: a bounded k-hop walk over the in-memory graph along allowed relationship types, scoped to jurisdiction.
  - Ranking: confidence × proximity.
  - Answers come from templated synthesis over the ranked facts, with citations. The extractive mode returns the facts verbatim.
  - Questions outside the data get an honest "No matching facts in the graph."
- **Cypher shown per stage** must be valid against the schema above, so it can seed the future backend.
- Timings: per-stage simulated latency. Live is slower and more variable than Offline. Answers stream token by token.
- **Dataset format:** the dataset ships as JSON (nodes, relationships, documents/sections) in a shape that a later script could load straight into Neo4j. My call; the builder chooses the exact files.

## Visual system (approved in prototype)

The approved prototype is `docs/design/theme-prototype.html` (an HTML fragment from the brainstorming companion; its styles and script are self-contained). It covers only the tokens, the sidebar/chat/evidence layout and the motion; component-level design (confidence indicator, narrow layouts, menus) is the builder's, within these tokens.

- **Light — Quiet Paper:** warm off-white `#f7f5f0`, sidebar `#efece5`, panels white, hairline borders `#e3ded3`, ink `#2b2925`, one rust accent `#b5522d`. Serif (Georgia-class) headlines, Inter body.
- **Dark — Midnight Glass:** deep navy radial gradient (`#1b2140` → `#0b0d17`), translucent frosted panels (white at 3–5% with backdrop blur), borders white at 8%, ink `#e6e8f2`, periwinkle accent `#9aa6ff` with a soft glow on the focused composer. Inter throughout.
- Defined as CSS custom-property tokens, switched by a theme attribute, with the system preference as the default.
- Layout unchanged from Lattice: sidebar | chat | evidence panel, collapsing responsively.
- The prototype values are starting points, not final pixel values.

## Motion spec (approved in prototype)

- **Theme switch:** about 500 ms colour cross-fade across the app; the sun/moon icon rotates.
- **New message:** rises about 8 px and fades in; follow-up chips arrive about 250 ms later.
- **Evidence tabs:** the active underline slides between tabs; the tab content cross-fades.
- **Graphs:** edges draw in, nodes pop in staggered. In dark mode only, nodes drift slowly; this is the only ambient motion.
- **Hover:** sidebar items nudge 2 px; chips take an accent tint and border. No bounce anywhere; easing is ease-out (`cubic-bezier(.2,.8,.2,1)`), 200–600 ms.
- `prefers-reduced-motion` turns all of the above off: instant changes, no drift.

## Verification

- **Behaviour reference:** the deployed Lattice site and its extracted bundle (`~/Work/lattice-extract/deployed`) may be used while building, to settle behaviours the inventory leaves open: where the evidence panel sits and how a turn is selected, what clicking a node opens, regenerate semantics, and so on. Match Lattice unless it conflicts with the visual spec.
- Feature parity is checked against the inventory above. After the build, and only then, compare against Lattice's public upstream source (`~/Work/lattice-extract/source`) for any missed feature. This matches the user's "bundle only, verify after" choice.
- Unit tests for the mock retrieval engine (fusion, scoping, k-hop expansion, "no match" path). An end-to-end smoke test that asks a seeded question and sees every evidence tab populate.
- Visual check of both themes and reduced motion.

## Left to the builder

Component structure; state management approach; exact dataset size and entity names; the vector stand-in technique; file layout; test tooling; exact timing and colour values within the spec.

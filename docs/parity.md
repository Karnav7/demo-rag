# Parity with Lattice

Checked on 2026-10-27 against Lattice's upstream source (MIT, Angular), user-facing features only. Lattice answers
questions about leave policy across three countries; dummy-rag answers questions about a fictional
financial-crime graph. Where a feature exists in both but takes a domain- or layout-specific shape here, it is
marked **adapted**.

Status key:

- **present**: dummy-rag has the feature with the same behaviour.
- **adapted**: the feature is there, reshaped for the fintech domain or for dummy-rag's three-column layout.
- **fixed**: it was missing, and this parity pass added it (one commit and one test each).
- **missing (deferred)**: not built, with the reason given.

## Summary

| Status | Count |
| --- | --- |
| present | 51 |
| adapted | 14 |
| fixed in this pass | 10 |
| missing (deferred) | 4 |
| **total** | **79** |

## App shell and routes

| Lattice feature | Status | dummy-rag |
| --- | --- | --- |
| Routes `/`, `/architecture`, `/guide`, catch-all redirect to `/` | present | `src/App.tsx` (hash routing for GitHub Pages) |
| Explainer pages load on demand | present | `src/App.tsx` (`React.lazy`) |
| Brand link home | present | `src/ui/shell/Sidebar.tsx` |
| New conversation | present | `src/ui/shell/Sidebar.tsx` |
| Search conversations, by title and message text | present | `src/ui/shell/Sidebar.tsx`, `src/store/store.ts` (`search`) |
| Empty list and no-match messages | present | `src/ui/shell/Sidebar.tsx` |
| Groups Today / Yesterday / Previous 7 days / Older | present | `src/store/store.ts` (`grouped`) |
| Rename, with Enter to save, Escape to cancel, blur to save | present | `src/ui/shell/ConversationItem.tsx` |
| Delete with inline "Delete? Yes / No" | present | `src/ui/shell/ConversationItem.tsx` |
| Footer Guide link ("Every feature explained") and Architecture link | present | `src/ui/shell/Sidebar.tsx` |
| Architecture link tooltip with the graph's node and relationship counts | fixed | `src/ui/shell/Sidebar.tsx` |
| Theme toggle, persisted | present | `src/ui/theme/ThemeToggle.tsx` (`dummy-rag.theme`) |
| Narrow screens: sidebar behind "Open conversations" | present | `src/ui/shell/Shell.tsx`, `src/ui/shell/useDrawer.ts` |
| Escape closes menus and popovers | present | `src/ui/chat/usePopover.ts`, `src/ui/shell/useDrawer.ts` |

## Chat

| Lattice feature | Status | dummy-rag |
| --- | --- | --- |
| Top bar with the conversation title | present | `src/ui/chat/ChatView.tsx` (`ChatHeader`) |
| Top-bar data-source status chip ("Neo4j live" / snapshot file) | adapted | The composer's Data source control shows the active source, and each answer's stats line names the source it used: `src/ui/chat/Composer.tsx`, `src/ui/chat/MessageView.tsx` |
| Conversation menu: Export conversation (JSON with evidence) | present | `src/ui/chat/ChatView.tsx`, `src/store/store.ts` (`exportConversation`) |
| Conversation menu: Clear conversation (keeps the thread) | present | `src/ui/chat/ChatView.tsx` |
| Empty state headline, scope line, guide link, suggested questions | adapted | Fintech headline and disclaimer, four scenario questions: `src/ui/chat/EmptyState.tsx` |
| Time-of-day greeting above the headline ("Good morning,") | missing (deferred) | Not in the spec's feature inventory; the approved prototype's empty state has no greeting. |
| Avatar, name and time on each message | missing (deferred) | Not in the spec's feature inventory; the approved prototype marks turns by style and position instead. |
| Disclaimer under the composer | adapted | "Fictional data for demonstration. Not financial or legal advice.": `src/ui/chat/ChatView.tsx`, `src/ui/chat/EmptyState.tsx` |
| Streamed markdown answer with inline citations | present | `src/ui/chat/Markdown.tsx`, `src/ui/chat/MessageView.tsx` |
| Citation click opens Sources at the cited passage | present | `src/ui/chat/MessageView.tsx`, `src/ui/chat/ChatView.tsx`, `src/ui/evidence/SourcesList.tsx` |
| Citation hover text naming the passage and its document | fixed | `src/ui/chat/Markdown.tsx` |
| Grounding confidence indicator | adapted | A 0–1 meter instead of a high/medium/low badge: `src/ui/chat/MessageView.tsx` (`Meter`) |
| "Resolved" question after context resolution | present | `src/ui/chat/MessageView.tsx` |
| Per-turn stats line | adapted | Mode, source and total time. Fact and passage counts are on the evidence tabs instead: `src/ui/chat/MessageView.tsx` |
| Pending line "<mode> retrieval · querying Neo4j…" / reading the snapshot | present | `src/ui/chat/MessageView.tsx` (`StageLine`) |
| Suggested follow-ups | adapted | Shown under the answer they follow from, not above the composer: `src/ui/chat/MessageView.tsx` |
| Copy answer (markdown), with "Copied" feedback | present | `src/ui/chat/MessageView.tsx` |
| Regenerate with current settings | present | `src/ui/chat/MessageView.tsx`, `src/store/store.ts` |
| Good / Poor answer ratings, toggle off on second click | present | `src/ui/chat/MessageView.tsx` |
| Per-message "Evidence" disclosure with node and used-fact counts | adapted | Evidence lives in its own column (or drawer below 1100 px) for the selected turn; "Show evidence" on each turn and counts on the tabs: `src/ui/chat/ChatView.tsx`, `src/ui/evidence/EvidencePanel.tsx` |
| Errors shown in the turn | present | `src/store/store.ts` ("Something went wrong: …") |

## Composer

| Lattice feature | Status | dummy-rag |
| --- | --- | --- |
| Data source menu: Live Neo4j / Offline snapshot, with hints | present | `src/ui/chat/Composer.tsx`. Live is simulated until `VITE_CHAT_URL` is set. |
| Retrieval mode menu: Lexical / Vector / Hybrid / Graph, with hints | present | `src/ui/chat/Composer.tsx`, `src/ui/chat/labels.ts` |
| Context toggle | present | `src/ui/chat/Composer.tsx` |
| LLM answer toggle (off = extractive) | present | `src/ui/chat/Composer.tsx`, `src/engine/answer.ts` |
| Enter sends, Shift+Enter newline | present | `src/ui/chat/Composer.tsx` |
| Inline "↵ send · ⇧↵ newline" hint | adapted | Documented in the Guide's keyboard section rather than in the composer, which keeps the phone layout to two rows: `src/ui/pages/Guide.tsx` |
| Settings persisted | present | `src/store/store.ts` (`dummy-rag.settings`) |

## Evidence panel

| Lattice feature | Status | dummy-rag |
| --- | --- | --- |
| Tabs Subgraph · Facts · Sources · Cypher · Trace | present | `src/ui/evidence/EvidencePanel.tsx` |
| Item counts on the Subgraph, Facts and Sources tabs | fixed | `src/ui/evidence/EvidencePanel.tsx` |
| "What is this tab?" help popover | present | `src/ui/evidence/HelpPopover.tsx` |
| Help popover links to the full guide | fixed | `src/ui/evidence/HelpPopover.tsx` |
| Graph view switcher, persisted | present | `src/ui/graph/GraphViews.tsx` (`dummy-rag.graph-variant`) |
| Focus / "Dim everything the answer did not use" | present | `src/ui/graph/GraphViews.tsx` |
| Legend by node type, with used-in-answer and seed keys | present | `src/ui/graph/Legend.tsx` |
| Legend counts per node type | fixed | `src/ui/graph/Legend.tsx`, `src/ui/graph/GraphViews.tsx` |
| Click a node to open its source | present | `src/ui/evidence/EvidencePanel.tsx`, `src/ui/graph/graphStyle.ts` (`firstCitedSection`) |
| Force: d3-force, used nodes ringed, seeds marked | present | `src/ui/graph/Force.tsx` |
| Force: drag a node, scroll to zoom | present | `src/ui/graph/Force.tsx` |
| Force: dropped node stays pinned, double-click releases it | fixed | `src/ui/graph/Force.tsx` |
| Force: hover shows node details and edge labels | present | `<title>` on nodes and edges: `src/ui/graph/Force.tsx` |
| Radial tree | adapted | Graph → jurisdiction → entity type → entity, instead of World → country → rule: `src/ui/graph/Radial.tsx` |
| Radial: dashed cross-links for the graph's own edges | fixed | `src/ui/graph/Radial.tsx` |
| Orbit: dependency-free canvas pseudo-3D with depth and glow, drag to rotate | present | `src/ui/graph/Orbit.tsx`, `src/ui/graph/space.tsx` |
| 3D: three.js force graph with particles along the grounding path | present | `src/ui/graph/Three.tsx` |
| 3D: clicking a node flies the camera to it | adapted | Clicking a node opens its source, the same as every other view (spec: "Clicking a node opens its source"); drag orbits, scroll zooms: `src/ui/graph/Three.tsx` |
| Replay: retrieval steps animated on the graph, play/pause, jump to a step | adapted | Steps by previous / next rather than clicking a step, plus play-pause and restart: `src/ui/graph/Replay.tsx` |
| Facts: subject / relation / object / confidence table | present | `src/ui/evidence/FactsTable.tsx` |
| Facts: "Only facts used in the answer" | present | `src/ui/evidence/FactsTable.tsx` |
| Facts: sort by any column | fixed | `src/ui/evidence/FactsTable.tsx` (previously confidence only) |
| Facts: "n of m" row count | fixed | `src/ui/evidence/FactsTable.tsx` |
| Facts: confidence bar inside the cell | missing (deferred) | Cosmetic; the two-decimal value carries the same information and the spec lists the column, not a bar. |
| Facts: text filter with "No facts match." | present | `src/ui/evidence/FactsTable.tsx` |
| Sources: cited passages with reference, document and breadcrumb | adapted | Grouped by document with kind badge and date: `src/ui/evidence/SourcesList.tsx` |
| Sources: cited passage highlighted and scrolled into view | present | `src/ui/evidence/SourcesList.tsx` |
| Cypher: the queries this turn ran, one per stage | present | `src/ui/evidence/CypherView.tsx` |
| Cypher: syntax highlighting | missing (deferred) | Plain monospace. A highlighter is new dependency weight or a hand-written tokenizer, for no change in what the tab tells you. |
| Cypher: copy all queries | fixed | `src/ui/evidence/CypherView.tsx` (per-query copy was already there) |
| Trace: stages with timings, detail and bars, total | present | `src/ui/evidence/TraceSteps.tsx` |
| Trace: "n nodes touched" per stage | adapted | Replay shows the nodes each stage touched on the graph itself: `src/ui/graph/Replay.tsx` |
| Pipeline stages 1–9, skipped by mode | present | `src/engine/pipeline.ts` |

## Pages and persistence

| Lattice feature | Status | dummy-rag |
| --- | --- | --- |
| Architecture: three tiers (front end, API, graph database) | adapted | Rewritten around the in-browser engine plus the `POST /chat` seam: `src/ui/pages/Architecture.tsx` |
| Architecture: request pipeline, graph schema, why hybrid, API contract | present | `src/ui/pages/Architecture.tsx` |
| Guide: asking, reading an answer, evidence, Cypher queries explained, conversations, keyboard | present | `src/ui/pages/Guide.tsx` |
| Conversations, settings, theme and graph view persisted with guarded storage | present | `src/store/storage.ts`, keys `dummy-rag.*` |

## Deferred, in short

1. Time-of-day greeting in the empty state: outside the spec inventory; the approved prototype leaves it out.
2. Avatars, names and timestamps on messages: outside the spec inventory; the approved prototype leaves them out.
3. Confidence bar in the Facts table: cosmetic; the number is shown.
4. Cypher syntax highlighting: dependency or tokenizer cost for no new information.

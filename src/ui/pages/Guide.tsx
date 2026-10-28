import { useMemo } from 'react'
import { loadWorld } from '../../data/load'
import { MERIDIAN_NAME } from '../../data/scenarios'
import { runPipeline } from '../../engine/pipeline'
import { CodeBlock, Page, Sec, type TocItem } from './PageKit'

const TOC: TocItem[] = [
  { id: 'sidebar', title: 'Sidebar and conversations' },
  { id: 'composer', title: 'Composer and settings' },
  { id: 'messages', title: 'Message actions' },
  { id: 'evidence', title: 'Evidence tabs' },
  { id: 'graph-views', title: 'Graph views' },
  { id: 'legend', title: 'Legend and dimming' },
  { id: 'source', title: 'Data source' },
  { id: 'cypher', title: 'The Cypher queries' },
  { id: 'keys', title: 'Keyboard and mouse' },
  { id: 'storage', title: 'Storage' },
  { id: 'theme', title: 'Theme' },
]

/** A real run, so the queries shown are exactly the ones the engine emits. Graph mode exercises every stage. */
function sampleCypher() {
  const { response } = runPipeline(loadWorld(), {
    question: `Who ultimately owns ${MERIDIAN_NAME}?`,
    history: [],
    settings: { source: 'offline', mode: 'graph', useContext: true, generateAnswer: true },
  })
  return response.cypher
}

const WHY: Record<string, string> = {
  lexical: 'Finds entities whose name or aliases match the words in the question. This is how an exact company name or account number is caught.',
  vector: 'Finds entities by meaning, which rescues questions that do not use the registered name.',
  fuse: 'Combines the two ranked lists into one. An entity ranked well by either retriever rises.',
  seeds: 'Picks the fused hits worth walking from. Looking up the chosen ids keeps the walk anchored to real nodes.',
  expand: 'The graph step. It walks out from the seeds along the relationship types this kind of question needs; for ownership questions a second pattern is added to read the control chain directly.',
  rank: 'Orders the collected facts so the most certain, closest ones come first. This is the order in the Facts tab.',
  passages: 'Looks up the passage behind each fact. These are the Sources and the numbers in the answer\'s citations.',
}

export function Guide() {
  const steps = useMemo(sampleCypher, [])
  return (
    <Page
      title="Every feature explained"
      lede="A walk through each control in dummy-rag, what it does, and how to read what comes back."
      toc={TOC}
    >
      <Sec id="sidebar" title="Sidebar and conversations">
        <p>
          Each question thread is a conversation, listed newest first. Use <strong>New chat</strong> to start a thread and the search box to
          filter by title. Open a conversation's menu to <strong>rename</strong> it or <strong>delete</strong> it; deleting asks you to
          confirm. The Guide and Architecture links and the theme switch sit at the bottom. Below 760 px the sidebar is a drawer opened from
          the menu button.
        </p>
      </Sec>

      <Sec id="composer" title="Composer and settings">
        <p>Type a question and press Enter. The four controls beneath the box apply to that question and the ones after it.</p>
        <ul>
          <li><strong>Data source</strong>: Offline snapshot or Live Neo4j (see Data source below).</li>
          <li><strong>Retrieval mode</strong>: Lexical, Vector, Hybrid or Graph. Try the same ownership question in Hybrid and Graph to see why the walk matters.</li>
          <li><strong>Context</strong>: on lets "who else shares that address?" refer to the previous answer. The resolved question is shown on the answer.</li>
          <li><strong>LLM</strong>: off gives the extractive answer, a plain list of the facts found.</li>
        </ul>
        <p>
          While an answer is on its way, a slow light circles the composer, each retrieval stage ticks by above the
          answer, and Send becomes <strong>Stop</strong>. Stopping keeps what arrived and marks it <em>Stopped</em>.
          If you scroll up mid-answer, <strong>Jump to latest</strong> brings you back down.
        </p>
      </Sec>

      <Sec id="messages" title="Message actions">
        <p>Under each answer:</p>
        <ul>
          <li><strong>Show evidence</strong> opens the evidence column or drawer for that answer. Clicking the answer itself selects it too.</li>
          <li><strong>Copy answer</strong> puts the text on your clipboard.</li>
          <li><strong>Regenerate</strong> re-runs the question with the current settings.</li>
          <li><strong>Good answer / Poor answer</strong> mark it for yourself; the mark is saved with the conversation.</li>
        </ul>
        <p>
          Suggested follow-ups appear beneath the answer, and a grounding-confidence badge summarises how well-supported it is.
          Colour carries meaning: confidence runs from amber (weak) to periwinkle (strong) on the badge, the citation chips, the
          Facts table and the graph's used edges; sanctions entries and alerts glow on a red risk scale; Trace bars run cool to warm
          by how long each stage took. Hover or focus a citation chip to preview the passage it points to.
        </p>
      </Sec>

      <Sec id="evidence" title="Evidence tabs">
        <ul>
          <li><strong>Subgraph</strong>: the graph slice behind the answer. See Graph views.</li>
          <li><strong>Facts</strong>: each relationship with its confidence and source section. Filter by text, sort by confidence, or show only the facts the answer used.</li>
          <li><strong>Sources</strong>: cited passages by document. Clicking a [n] in the answer scrolls to its passage.</li>
          <li><strong>Cypher</strong>: the query for each stage, explained and copyable.</li>
          <li><strong>Trace</strong>: how long each stage took.</li>
        </ul>
        <p>The help icon in the evidence header explains the current tab in a sentence.</p>
              <p>
          <strong>Tab style</strong>, at the top of the panel, changes how the tabs are laid out: <em>Line</em> (underlined
          tabs with counts), <em>Segmented</em> (one pill control), <em>Stat cards</em> (each tab leads with its number),
          <em>Icon rail</em> (a vertical strip of icons, leaving the content full width) or <em>Bottom dock</em> (a floating
          bar at the foot of the panel). Your choice is remembered in this browser.
        </p>
      </Sec>

      <Sec id="graph-views" title="Graph views">
        <p>The Subgraph tab can draw the same data five ways. Your choice is remembered.</p>
        <dl>
          <dt>Force</dt>
          <dd>A physics layout where connected nodes pull together. Drag a node to pin it where you drop it, double-click to release it; click a node to open its source.</dd>
          <dt>Radial</dt>
          <dd>A tree fanned out from the centre, grouped by jurisdiction and then by node type, which makes it easy to see where the entities sit. Dashed curves across the tree are the relationships between them.</dd>
          <dt>Orbit</dt>
          <dd>Nodes placed on a sphere with depth cues. Drag to turn it, which helps separate chains that overlap in the flat views.</dd>
          <dt>3D</dt>
          <dd>A full three-dimensional layout rendered with WebGL. If WebGL is unavailable it shows a note and the other views keep working.</dd>
          <dt>Replay</dt>
          <dd>Plays the pipeline back stage by stage, showing which nodes each step found.</dd>
        </dl>
      </Sec>

      <Sec id="legend" title="Legend and dimming">
        <p>
          The legend lists the node types present in the current subgraph, each with its colour. The <strong>dim</strong> toggle fades
          everything the answer did not use, leaving the evidence chain in focus; turn it off to see the surrounding context the walk also
          collected.
        </p>
      </Sec>

      <Sec id="source" title="Data source">
        <p>
          <strong>Offline snapshot</strong> runs entirely in this page. <strong>Live Neo4j</strong> is simulated here: it is labelled and
          remembered like a real connection, but answers still come from the snapshot until a service is configured with{' '}
          <code>VITE_CHAT_URL</code>. The Architecture page describes the contract that service must follow.
        </p>
      </Sec>

      <Sec id="cypher" title="The Cypher queries">
        <p>
          These are the queries the engine produced for <em>"Who ultimately owns {MERIDIAN_NAME}?"</em> in Graph mode, generated from the
          same code that fills the Cypher tab. Lines starting with <code>// $name</code> show the parameter values used. Long lists are
          trimmed with "… more".
        </p>
        {steps.map((s) => (
          <div key={s.stage} className="cy">
            <h3>{s.stage}</h3>
            <p>{WHY[s.stage] ?? s.explain}</p>
            <p className="cy__ex">{s.explain}</p>
            <CodeBlock label={`${s.stage} Cypher`}>{s.query}</CodeBlock>
          </div>
        ))}
      </Sec>

      <Sec id="keys" title="Keyboard and mouse">
        <dl className="keys">
          <dt><kbd>Enter</kbd></dt><dd>Send the question.</dd>
          <dt><kbd>Shift</kbd> + <kbd>Enter</kbd></dt><dd>New line in the question.</dd>
          <dt><kbd>/</kbd></dt><dd>Jump to the question box from anywhere in the chat.</dd>
          <dt><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>K</kbd></dt><dd>Start a new conversation, from any page.</dd>
          <dt><kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>.</kbd></dt><dd>Open or close the evidence drawer on narrow screens; on wide screens, move focus to the evidence tabs.</dd>
          <dt><kbd>Esc</kbd></dt><dd>Stop an answer that is still arriving (the partial text is kept and marked <em>Stopped</em>). Otherwise close an open menu, popover or drawer, or cancel a rename, and return focus where it was.</dd>
          <dt><kbd>←</kbd> <kbd>→</kbd> <kbd>Home</kbd> <kbd>End</kbd></dt><dd>Move between evidence tabs and between graph views.</dd>
          <dt>Scroll on a graph</dt><dd>Zoom in and out; drag the background to pan.</dd>
          <dt>Drag a node in Force</dt><dd>Reposition it and pin it there; the rest of the graph reacts. Double-click a pinned node to release it.</dd>
          <dt>Click a node</dt><dd>Open its source passage.</dd>
        </dl>
      </Sec>

      <Sec id="storage" title="Storage">
        <p>
          Conversations, settings, theme and graph view are stored in this browser; nothing leaves the page. They live in local storage under
          keys beginning <code>dummy-rag.</code>, so clearing site data resets the app. If storage is blocked the app still works for the
          session.
        </p>
      </Sec>

      <Sec id="theme" title="Theme">
        <p>
          The theme switch at the foot of the sidebar toggles between <strong>Quiet Paper</strong>, a warm light theme, and{' '}
          <strong>Midnight Glass</strong>, a dark one with soft translucent panels. The two cross-fade, and the choice is remembered. If you
          prefer reduced motion, transitions and ambient movement are switched off.
        </p>
      </Sec>
    </Page>
  )
}

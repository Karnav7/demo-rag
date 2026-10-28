import { STAGE_TITLES } from '../../engine/pipeline'
import type { StageId } from '../../domain/types'
import { CHAT_EVENT_SOURCE, CHAT_REQUEST_SOURCE } from './contract'
import { CodeBlock, Page, Sec, type TocItem } from './PageKit'

const TOC: TocItem[] = [
  { id: 'why', title: 'Why hybrid, why graph' },
  { id: 'graph', title: 'The graph' },
  { id: 'pipeline', title: 'The request pipeline' },
  { id: 'evidence', title: 'The evidence column' },
  { id: 'settings', title: 'Settings per request' },
  { id: 'source', title: 'Offline snapshot vs Live' },
  { id: 'contract', title: 'The POST /chat contract' },
]

const STAGES: [StageId, string][] = [
  ['context', 'Rewrites a follow-up such as "who else shares that address?" into a standalone question using the earlier turns.'],
  ['lexical', 'Matches the question against entity names and aliases with a full-text index, so exact names and account numbers score highest.'],
  ['vector', 'Embeds the question and finds entities and passages that mean the same thing even when the wording differs.'],
  ['fuse', 'Merges the two ranked lists with reciprocal rank fusion, so an entity near the top of either list survives.'],
  ['seeds', 'Keeps the fused hits that are strong in at least one retriever as the starting points for the walk.'],
  ['expand', 'Walks outward from the seeds along the relationship types the question calls for, never entering Section or Document nodes.'],
  ['rank', 'Scores every collected fact by confidence divided by one plus its distance from the nearest seed.'],
  ['passages', 'Follows each fact\'s section_id to the exact passage it was extracted from, so every claim can be cited.'],
  ['generate', 'Writes the answer from those facts and passages only, with a numbered citation after each claim.'],
  ['extractive', 'The fallback when generation is off: the top facts, listed plainly with the same citations and no prose.'],
]

export function Architecture() {
  return (
    <Page
      title="Hybrid Graph-RAG, end to end"
      lede="How a plain-language question becomes a cited answer you can audit, and what you can see at each step."
      toc={TOC}
    >
      <Sec id="why" title="Why hybrid, why graph">
        <p>
          Ask <em>"Who ultimately owns Meridian Trade LLC?"</em> and a flat retriever finds the passages that mention Meridian. Each one
          states only a single link: Meridian is held by one holding company, that company is held by a second, the second by a third, and a
          registry filing in another jurisdiction names the person at the end. No single passage says who that
          person is, and none of them states the effective stake. The answer exists only in the chain.
        </p>
        <p>
          A graph stores each link as an edge, so the chain can be walked and the percentages multiplied along every path. That is the
          graph half. The hybrid half is how you get into the graph: a lexical index catches exact names, aliases and account numbers, a
          vector index catches paraphrases, and the two are fused so a question like "the Cyprus shell behind that wire" still lands on the
          right company before the walk begins.
        </p>
        <p>
          The model never answers from memory. It is handed the facts the walk collected and the passages they came from, and it is
          held to those. If the graph holds nothing relevant, the answer says so.
        </p>
      </Sec>

      <Sec id="graph" title="The graph">
        <p>
          Thirteen node labels hold the world. Entities: <code>Person</code>, <code>Company</code>, <code>Account</code>,{' '}
          <code>Transaction</code>, <code>Address</code>, <code>Device</code>. Risk and rules: <code>SanctionsEntry</code>,{' '}
          <code>Jurisdiction</code>, <code>Regulation</code>, <code>Case</code>, <code>Alert</code>. Evidence: <code>Document</code> and{' '}
          <code>Section</code>.
        </p>
        <p>
          Relationships carry the story: <code>OWNS</code> (with a percentage), <code>DIRECTOR_OF</code>, <code>CONTROLS</code>,{' '}
          <code>HOLDS</code> (owner to account), <code>SENT</code> and <code>RECEIVED</code> (account and transaction),{' '}
          <code>REGISTERED_AT</code>, <code>USED_DEVICE</code>, <code>MATCHES</code> (entity to sanctions entry, with a score),{' '}
          <code>INCORPORATED_IN</code>, <code>GOVERNED_BY</code>, <code>SUBJECT_OF</code>, <code>FLAGS</code> (alert to transaction) and{' '}
          <code>HAS_SECTION</code> (document to passage).
        </p>
        <h3>Provenance on every edge</h3>
        <p>
          Every extracted relationship stores two properties. <code>confidence</code> is how sure the extraction was, from 0 to 1.{' '}
          <code>section_id</code> names the passage the fact was read from. A <code>Section</code> is a real node, so a query can join from
          a fact to its source with <code>MATCH (s:Section {'{'}id: r.section_id{'}'})</code>. The Facts, Sources and Cypher tabs all rest
          on that one model: every cited claim can be traced back to a sentence in a document.
        </p>
      </Sec>

      <Sec id="pipeline" title="The request pipeline">
        <p>Every question runs these stages in order. Stages that do not apply to your settings are skipped and do not appear in the trace.</p>
        <ol className="stages">
          {STAGES.map(([id, text]) => (
            <li key={id}>
              <strong>{STAGE_TITLES[id]}</strong>
              <span>{text}</span>
            </li>
          ))}
        </ol>
        <p>
          The question is also classified into one of seven kinds: ownership, shared attributes, sanctions exposure, transaction trail,
          flagged activity, regulation, or a general profile. The kind decides which relationship types the walk follows and how many hops
          it takes.
        </p>
      </Sec>

      <Sec id="evidence" title="The evidence column">
        <p>
          The column to the right of the chat shows the evidence for the <em>selected</em> answer. It follows the latest answer until you
          click an earlier one. Five tabs cover the same answer from different angles.
        </p>
        <ul>
          <li><strong>Subgraph</strong> draws the slice of the graph the walk covered, with the nodes and edges the answer used highlighted.</li>
          <li><strong>Facts</strong> lists each relationship with its confidence and section, filterable to the ones the answer relied on.</li>
          <li><strong>Sources</strong> shows the cited passages grouped by document, and a citation in the answer jumps to its passage.</li>
          <li><strong>Cypher</strong> holds the query each retrieval stage ran, with a one-line explanation, ready to copy and rerun.</li>
          <li><strong>Trace</strong> times each stage so you can see where a slow answer spent its time.</li>
        </ul>
        <p>Below 1100 px the column becomes a drawer that you open from the message actions.</p>
      </Sec>

      <Sec id="settings" title="Settings per request">
        <p>Four controls under the composer travel with every question, so you can compare approaches on the same wording.</p>
        <dl>
          <dt>Data source</dt>
          <dd>Where the graph is read from: the offline snapshot or a live Neo4j.</dd>
          <dt>Retrieval mode</dt>
          <dd>
            Lexical only, vector only, hybrid (both, fused), or graph (hybrid seeds plus a three-hop traversal). The first three look one
            hop out; graph mode is the one that can follow a UBO chain.
          </dd>
          <dt>Context</dt>
          <dd>Whether earlier turns are used to resolve a follow-up. Off treats every question as stand-alone.</dd>
          <dt>LLM</dt>
          <dd>On writes a cited prose answer. Off returns the extractive list of facts, which is quicker and easiest to check.</dd>
        </dl>
      </Sec>

      <Sec id="source" title="Offline snapshot vs Live">
        <p>
          <strong>Offline snapshot</strong> is an export of the fictional graph that ships inside this page. The whole pipeline runs in
          your browser; nothing is sent anywhere. It is deterministic, so the same question gives the same answer.
        </p>
        <p>
          <strong>Live Neo4j</strong> is the same pipeline against a database over Bolt, with the Cypher in the Cypher tab executed per
          request. In this demo it is <strong>simulated until a backend exists</strong>: the choice is honoured and labelled, but the answer
          still comes from the snapshot. Setting <code>VITE_CHAT_URL</code> at build time points the app at a real service that speaks the
          contract below.
        </p>
      </Sec>

      <Sec id="contract" title="The POST /chat contract">
        <p>
          The browser sends one <code>ChatRequest</code> and receives a stream of <code>ChatEvent</code>s: a <code>stage</code> event as
          each pipeline step finishes, <code>token</code> events as the answer is written, and finally either <code>done</code> with the
          full response or <code>error</code>. A backend that emits these can replace the in-browser engine without UI changes.
        </p>
        <h3>Request</h3>
        <CodeBlock label="ChatRequest">{CHAT_REQUEST_SOURCE}</CodeBlock>
        <h3>Events</h3>
        <CodeBlock label="ChatEvent">{CHAT_EVENT_SOURCE}</CodeBlock>
        <p>
          <code>done</code> carries everything the evidence column needs: the answer with <code>[n]</code> citations, facts, sources,
          Cypher, trace, the subgraph, an overall confidence and suggested follow-ups.
        </p>
      </Sec>
    </Page>
  )
}

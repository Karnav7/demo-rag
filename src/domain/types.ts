// src/domain/types.ts
export type NodeLabel = 'Person'|'Company'|'Account'|'Transaction'|'Address'|'Device'|'SanctionsEntry'|'Jurisdiction'|'Regulation'|'Case'|'Alert'|'Document'|'Section';
export type RelType = 'OWNS'|'DIRECTOR_OF'|'CONTROLS'|'HOLDS'|'SENT'|'RECEIVED'|'REGISTERED_AT'|'USED_DEVICE'|'MATCHES'|'INCORPORATED_IN'|'GOVERNED_BY'|'SUBJECT_OF'|'FLAGS'|'HAS_SECTION';
export interface GNode { id: string; label: NodeLabel; name: string; aliases?: string[]; jurisdiction?: string; props: Record<string, string|number|boolean>; }
export interface GRel  { id: string; type: RelType; from: string; to: string; confidence: number; section_id: string|null; props: Record<string, string|number>; }
export interface Section { id: string; document_id: string; title: string; text: string; }
export interface DocumentMeta { id: string; kind: 'registry'|'kyc'|'case-note'|'sar'|'sanctions'|'regulation'; title: string; date: string; }
export interface World { nodes: GNode[]; rels: GRel[]; documents: DocumentMeta[]; sections: Section[]; }

export type Source = 'live'|'offline';
export type Mode = 'lexical'|'vector'|'hybrid'|'graph';
export interface Settings { source: Source; mode: Mode; useContext: boolean; generateAnswer: boolean; }
export type StageId = 'context'|'lexical'|'vector'|'fuse'|'seeds'|'expand'|'rank'|'passages'|'generate'|'extractive';
export interface TraceStage { id: StageId; title: string; ms: number; detail: string; }
export interface Fact { rel_id: string; subject: string; relation: RelType; object: string; confidence: number; section_id: string|null; used: boolean; }
export interface CypherStep { stage: StageId; query: string; explain: string; }
export interface Subgraph { nodes: (GNode & { used: boolean; seed: boolean })[]; edges: (GRel & { used: boolean })[]; }
export interface ChatResponse {
  answer: string;              // markdown, citations as [n]
  citations: { n: number; section_id: string }[];
  facts: Fact[]; sources: Section[]; cypher: CypherStep[]; trace: TraceStage[];
  subgraph: Subgraph; confidence: number; resolvedQuestion: string|null;
  followUps: string[]; stats: { totalMs: number; settings: Settings };
}
export interface ChatRequest { question: string; history: { role: 'user'|'assistant'; text: string }[]; settings: Settings; }
export type ChatEvent =
  | { type: 'stage'; stage: TraceStage }
  | { type: 'token'; text: string }
  | { type: 'done'; response: ChatResponse }
  | { type: 'error'; message: string };

export type Hit = { id: string; score: number }

/** Reciprocal rank fusion: score(id) = sum over lists of 1 / (k + rank), rank starting at 1. */
export function rrf(lists: Hit[][], k = 60): Hit[] {
  const score = new Map<string, number>()
  for (const list of lists) {
    list.forEach((h, i) => score.set(h.id, (score.get(h.id) ?? 0) + 1 / (k + i + 1)))
  }
  return [...score]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
}

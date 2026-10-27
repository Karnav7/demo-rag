/** localStorage wrapper: every read and write is guarded; bad data yields the fallback. */
export const storage = {
  get<T>(key: string, fallback: T, validate: (v: unknown) => v is T): T {
    try {
      const raw = localStorage.getItem(key)
      if (raw === null) return fallback
      const parsed: unknown = JSON.parse(raw)
      return validate(parsed) ? parsed : fallback
    } catch {
      return fallback
    }
  },
  set(key: string, value: unknown): void {
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* quota, privacy mode, etc: persistence is best-effort */
    }
  },
}

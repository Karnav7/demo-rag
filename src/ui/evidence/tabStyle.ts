import { useCallback, useState } from 'react'

/** The evidence tab bar's layout, chosen by the reader in the panel and remembered in this browser. */
export type TabStyle = 'line' | 'segmented' | 'cards' | 'rail' | 'dock'

export const TAB_STYLES: { id: TabStyle; label: string; hint: string }[] = [
  { id: 'line', label: 'Line', hint: 'Icons and counts with a sliding underline' },
  { id: 'segmented', label: 'Segmented', hint: 'A pill control; the selection slides as a filled capsule' },
  { id: 'cards', label: 'Stat cards', hint: 'Each tab is a small card leading with its number' },
  { id: 'rail', label: 'Icon rail', hint: 'A vertical icon strip on the left; content gets the full width' },
  { id: 'dock', label: 'Bottom dock', hint: 'A floating glass tab bar at the foot of the panel' },
]

export const TAB_STYLE_KEY = 'dummy-rag.tab-style'
const isStyle = (v: unknown): v is TabStyle => TAB_STYLES.some((s) => s.id === v)

export function useTabStyle(): [TabStyle, (s: TabStyle) => void] {
  const [style, setStyle] = useState<TabStyle>(() => {
    try {
      const v = localStorage.getItem(TAB_STYLE_KEY)
      return isStyle(v) ? v : 'line'
    } catch {
      return 'line'
    }
  })
  const set = useCallback((s: TabStyle) => {
    setStyle(s)
    try {
      localStorage.setItem(TAB_STYLE_KEY, s)
    } catch {
      /* storage blocked: the choice lasts for this session */
    }
  }, [])
  return [style, set]
}

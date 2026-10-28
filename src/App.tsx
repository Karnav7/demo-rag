import { lazy } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './ui/shell/Shell'
import { ChatView } from './ui/chat/ChatView'
import { LazyView } from './ui/shell/Boundary'

// The explainer pages are read once in a while; they load on first visit, out of the main chunk.
const Architecture = lazy(() => import('./ui/pages/Architecture').then((m) => ({ default: m.Architecture })))
const Guide = lazy(() => import('./ui/pages/Guide').then((m) => ({ default: m.Guide })))
// Keyed by path: each route gets its own boundary, so a failed page never sticks to the next one.
const page = (path: string, el: React.ReactNode) => (
  <LazyView key={path} label="Loading page…">
    {el}
  </LazyView>
)

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<ChatView />} />
          <Route path="/architecture" element={page('/architecture', <Architecture />)} />
          <Route path="/guide" element={page('/guide', <Guide />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

import { lazy, Suspense } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './ui/shell/Shell'
import { ChatView } from './ui/chat/ChatView'

// The explainer pages are read once in a while; they load on first visit, out of the main chunk.
const Architecture = lazy(() => import('./ui/pages/Architecture').then((m) => ({ default: m.Architecture })))
const Guide = lazy(() => import('./ui/pages/Guide').then((m) => ({ default: m.Guide })))
const page = (el: React.ReactNode) => <Suspense fallback={null}>{el}</Suspense>

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<ChatView />} />
          <Route path="/architecture" element={page(<Architecture />)} />
          <Route path="/guide" element={page(<Guide />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

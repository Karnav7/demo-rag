import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './ui/shell/Shell'
import { Architecture } from './ui/pages/Architecture'
import { Guide } from './ui/pages/Guide'
import { ChatView } from './ui/chat/ChatView'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<ChatView />} />
          <Route path="/architecture" element={<Architecture />} />
          <Route path="/guide" element={<Guide />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './ui/shell/Shell'
import { Placeholder } from './ui/pages/Placeholder'
import { ChatView } from './ui/chat/ChatView'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<ChatView />} />
          <Route path="/architecture" element={<Placeholder title="Architecture" />} />
          <Route path="/guide" element={<Placeholder title="Guide" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Shell } from './ui/shell/Shell'
import { Placeholder } from './ui/pages/Placeholder'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/" element={<Placeholder title="Chat" />} />
          <Route path="/architecture" element={<Placeholder title="Architecture" />} />
          <Route path="/guide" element={<Placeholder title="Guide" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}

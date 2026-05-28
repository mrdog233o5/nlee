import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import Flowchart from './pages/Flowchart'
import TraceTable from './pages/TraceTable'
import TruthTable from './pages/TruthTable'

const tabs = [
  { path: '/flowchart', label: 'Flowchart' },
  { path: '/trace-table', label: 'Trace Table' },
  { path: '/truth-table', label: 'Truth Table' },
]

export default function App() {
  return (
    <div className="app">
      <nav className="tabs">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tab.path}
            className={({ isActive }) => `tab${isActive ? ' active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <main className="content">
        <Routes>
          <Route path="/flowchart" element={<Flowchart />} />
          <Route path="/trace-table" element={<TraceTable />} />
          <Route path="/truth-table" element={<TruthTable />} />
          <Route path="*" element={<Navigate to="/flowchart" replace />} />
        </Routes>
      </main>
    </div>
  )
}

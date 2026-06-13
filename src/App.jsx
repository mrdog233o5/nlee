import { useState, useRef, useEffect, useCallback } from 'react'
import { NavLink, Routes, Route, Navigate } from 'react-router-dom'
import Flowchart from './pages/Flowchart'
import TraceTable from './pages/TraceTable'
import TruthTable from './pages/TruthTable'

const SAMPLE_CODE = `public class Example {
  public static void main(String[] args) {
    int x = 5;
    if (x > 3) {
      System.out.println("Big");
    }
    System.out.println("Done");
  }
}`

const tabs = [
  { path: '/flowchart', label: 'Flowchart' },
  { path: '/trace-table', label: 'Trace Table' },
  { path: '/truth-table', label: 'Truth Table' },
]

export default function App() {
  const [code, setCode] = useState(SAMPLE_CODE)

  const [splitPos, setSplitPos] = useState(45)
  const isDragging = useRef(false)
  const dividerRef = useRef(null)

  const handleDividerDown = useCallback(() => {
    isDragging.current = true
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [])

  useEffect(() => {
    const onMove = (e) => {
      if (!isDragging.current) return
      const container = dividerRef.current?.parentElement
      if (!container) return
      const rect = container.getBoundingClientRect()
      const pct = ((e.clientX - rect.left) / rect.width) * 100
      setSplitPos(Math.max(20, Math.min(80, pct)))
    }
    const onUp = () => {
      if (isDragging.current) {
        isDragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [])

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
      <div className="split-pane">
        <div className="split-left" style={{ width: `${splitPos}%` }}>
          <textarea
            className="fc-textarea code-editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="split-divider" ref={dividerRef} onMouseDown={handleDividerDown} />
        <div className="split-right" style={{ width: `${100 - splitPos}%` }}>
          <main className="content">
            <Routes>
              <Route path="/flowchart" element={<Flowchart code={code} />} />
              <Route path="/trace-table" element={<TraceTable code={code} />} />
              <Route path="/truth-table" element={<TruthTable />} />
              <Route path="*" element={<Navigate to="/flowchart" replace />} />
            </Routes>
          </main>
        </div>
      </div>
    </div>
  )
}

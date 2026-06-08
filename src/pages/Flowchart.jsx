import { useState, useMemo } from 'react';
import { parseJavaCode, flattenTree } from '../utils/flowchartParser';

const DECISION_H = 42;
const MERGE_SIZE = 10;
const START_END_W = 80;
const COL_GAP = 160;
const ROW_GAP = 16;
const PAD_X = 24;
const PAD_Y = 16;
const COL_REF_W = 140;
const MIN_W = 60;
const NODE_MIN_H = 32;

const SAMPLE_CODE = `public class Example {
  public static void main(String[] args) {
    int x = 5;
    if (x > 3) {
      System.out.println("Big");
    }
    System.out.println("Done");
  }
}`;

function wordWrap(text, maxChars) {
  const lines = [];
  for (const para of text.split('\n')) {
    if (para.length === 0) { lines.push(''); continue; }
    const words = para.split(' ');
    let cur = '';
    for (let w of words) {
      const cand = cur ? cur + ' ' + w : w;
      if (cand.length <= maxChars) {
        cur = cand;
      } else {
        if (cur) lines.push(cur);
        while (w.length > maxChars) { lines.push(w.slice(0, maxChars)); w = w.slice(maxChars); }
        cur = w || '';
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function computeNodeDims(node, flipped) {
  if (node.type === 'merge') return { w: MERGE_SIZE, h: MERGE_SIZE };

  const text = node.text || '';
  const charW = 7;
  const lineH = 15;
  const flipExtra = flipped ? 2 : 0;
  const padX = (node.type === 'start' || node.type === 'end') ? 20 : 12 + flipExtra;
  const padY = 8;
  const maxChars = (node.type === 'decision' || node.type === 'loop' || node.type === 'forloop') ? 14 : 17;

  const wrapped = wordWrap(text, maxChars);
  const totalLines = wrapped.length || 1;
  const maxLinePx = Math.ceil(wrapped.reduce((m, l) => Math.max(m, l.length * charW), 0));

  let w, h;
  if (node.type === 'start' || node.type === 'end') {
    w = Math.max(START_END_W, Math.ceil(maxLinePx + padX));
    h = Math.max(NODE_MIN_H, Math.ceil(totalLines * lineH + padY));
  } else if (node.type === 'decision' || node.type === 'loop' || node.type === 'forloop') {
    w = Math.max(120, Math.ceil(maxLinePx + padX));
    h = Math.max(DECISION_H, Math.ceil(totalLines * lineH + padY));
  } else {
    w = Math.max(MIN_W, Math.ceil(maxLinePx + padX));
    h = Math.max(NODE_MIN_H, Math.ceil(totalLines * lineH + padY));
  }
  return { w, h };
}

function layoutFlowchart(flatNodes, flatEdges, flippedNodes) {
  const nodeMap = {};
  flatNodes.forEach((n) => { nodeMap[n.id] = n; });

  // Per-node dimensions
  const nodeDims = {};
  flatNodes.forEach((n) => { nodeDims[n.id] = computeNodeDims(n, flippedNodes[n.id]); });

  // Parent lookup for y-constraints
  const nodeParents = {};
  const exitRightTargets = new Set();
  flatEdges.forEach((e) => {
    if (!nodeParents[e.to]) nodeParents[e.to] = [];
    nodeParents[e.to].push(e.from);
    if (e.exitRight) exitRightTargets.add(e.to);
  });

  const positions = {};
  const colBottom = {};

  flatNodes.forEach((n) => {
    const dims = nodeDims[n.id];

    // Must be below all parent nodes (using their actual bottoms)
    const minY = (nodeParents[n.id] || [])
      .map((pid) => {
        const pp = positions[pid];
        return pp ? pp.y + pp.h + ROW_GAP : PAD_Y;
      })
      .reduce((max, y) => Math.max(max, y), PAD_Y);

    // Also below the previous node in this column
    colBottom[n.depth] = colBottom[n.depth] || PAD_Y;

    // Extra gap when exiting a for/while loop (parent is a loop diamond)
    const exitsForloop = (nodeParents[n.id] || []).some((pid) => {
      const pn = nodeMap[pid];
      return pn && (pn.type === 'forloop' || pn.type === 'loop');
    });
    const effectiveColBottom = exitsForloop ? colBottom[n.depth] + ROW_GAP : colBottom[n.depth];

    // Extra gap when a horizontal wrap-around arrow targets this node
    const exitArrowGap = exitRightTargets.has(n.id) ? 8 : 0;

    const y = Math.max(effectiveColBottom, minY) + exitArrowGap;

    const colCenter = PAD_X + n.depth * COL_GAP + COL_REF_W / 2;
    const x = colCenter - dims.w / 2;

    positions[n.id] = { x, y, w: dims.w, h: dims.h };
    colBottom[n.depth] = y + dims.h;
  });

  // Compute max right edge per column (for F-branch bypass offset)
  const colMaxRight = {};
  Object.entries(positions).forEach(([id, pos]) => {
    const nd = nodeMap[id];
    const r = pos.x + pos.w;
    if (!colMaxRight[nd.depth] || r > colMaxRight[nd.depth]) {
      colMaxRight[nd.depth] = r;
    }
  });

  // Compute edge endpoints
  const renderedEdges = [];
  flatEdges.forEach((e) => {
    const fromPos = positions[e.from];
    const toPos = positions[e.to];
    if (!fromPos || !toPos) return;

    const fromNode = nodeMap[e.from];
    const toNode = nodeMap[e.to];
    const isFromDiamond = fromNode && (fromNode.type === 'decision' || fromNode.type === 'loop' || fromNode.type === 'forloop');
    const isToDiamond = toNode && (toNode.type === 'decision' || toNode.type === 'loop' || toNode.type === 'forloop');

    let x1, y1, sideExit = false;
    if (isFromDiamond) {
      const fromCX = fromPos.x + fromPos.w / 2;
      const fromCY = fromPos.y + fromPos.h / 2;
      const toCX = toPos.x + toPos.w / 2;

      if (e.exitRight) {
        x1 = fromPos.x + fromPos.w;
        y1 = fromCY;
        sideExit = true;
      } else if (toCX < fromCX - 5) {
        x1 = fromPos.x;
        y1 = fromCY;
        sideExit = true;
      } else if (toCX > fromCX + 5) {
        x1 = fromPos.x + fromPos.w;
        y1 = fromCY;
        sideExit = true;
      } else {
        x1 = fromCX;
        y1 = fromPos.y + fromPos.h;
      }
    } else if (e.loopBack) {
      x1 = fromPos.x;
      y1 = fromPos.y + fromPos.h / 2;
    } else {
      x1 = fromPos.x + fromPos.w / 2;
      y1 = fromPos.y + fromPos.h;
    }

    let x2 = toPos.x + toPos.w / 2;
    let y2 = toPos.y;
    let sideEnter = false;

    if (e.loopBack && isToDiamond) {
      x2 = toPos.x;
      y2 = toPos.y + toPos.h / 2;
      sideEnter = true;
    }

    let rightX = null;
    if (sideExit && e.exitRight && fromNode) {
      const fromRight = fromPos.x + fromPos.w;
      const colMaxR = colMaxRight[fromNode.depth] || fromRight;
      // Loop (while/for) exit arrows go wider to avoid overlapping inner exits
      const loopOffset = (fromNode.type === 'loop' || fromNode.type === 'forloop') ? 30 : 0;
      rightX = Math.max(fromRight + 80, colMaxR + 20) + loopOffset;
    }

    renderedEdges.push({
      from: e.from,
      to: e.to,
      label: e.label || '',
      x1,
      y1,
      x2,
      y2,
      sideExit,
      sideEnter,
      rightX,
    });
  });

  return { positions, edges: renderedEdges, nodeMap };
}

export default function Flowchart() {
  const [code, setCode] = useState(SAMPLE_CODE);
  const [error, setError] = useState('');
  const [flippedNodes, setFlippedNodes] = useState({});

  const toggleShape = (nodeId) => {
    setFlippedNodes((prev) => ({ ...prev, [nodeId]: !prev[nodeId] }));
  };

  const exportSVG = () => {
    const svgEl = document.querySelector('.fc-svg');
    if (!svgEl) return;

    const clone = svgEl.cloneNode(true);
    const svgStyles = `
      .fc-node-text{width:100%;height:100%;display:flex;align-items:center;justify-content:center;text-align:center;font-size:0.7rem;font-family:'SF Mono','Fira Code','Cascadia Code',monospace;line-height:1.3;overflow:hidden;overflow-wrap:break-word}
      .fc-rect{stroke:#a1a1aa;stroke-width:1.5}
      .fc-start-end-shape{fill:#f0fdf4;stroke:#86efac}
      .fc-process-shape{fill:#eff6ff;stroke:#93c5fd}
      .fc-diamond{stroke-width:1.5}
      .fc-decision-shape{fill:#fef9c3;stroke:#fde047}
      .fc-merge-circle{fill:#e4e4e7;stroke:#a1a1aa;stroke-width:1}
      .fc-edge{stroke:#a1a1aa;stroke-width:1.5;fill:none}
      .fc-arrowhead{fill:#71717a}
      .fc-edge-label{fill:#71717a;font-size:11px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
    `;
    const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    styleEl.textContent = svgStyles;
    clone.insertBefore(styleEl, clone.firstChild);

    const svgString = new XMLSerializer().serializeToString(clone);
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n', svgString],
      { type: 'image/svg+xml' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flowchart.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const tree = useMemo(() => {
    try {
      setError('');
      return parseJavaCode(code);
    } catch (e) {
      setError(e.message);
      return [];
    }
  }, [code]);

  const { nodes: flatNodes, edges: flatEdges } = useMemo(
    () => flattenTree(tree),
    [tree],
  );

  const layout = useMemo(
    () => layoutFlowchart(flatNodes, flatEdges, flippedNodes),
    [flatNodes, flatEdges, flippedNodes],
  );

  const svgWidth = Math.max(
    600,
    ...Object.values(layout.positions).map((p) => p.x + p.w),
  ) + PAD_X;
  const svgHeight = Math.max(
    400,
    ...Object.values(layout.positions).map((p) => p.y + p.h),
  ) + PAD_Y;

  const renderNode = (node) => {
    const pos = layout.positions[node.id];
    if (!pos) return null;

    const { x, y, w, h } = pos;
    const cx = x + w / 2;
    const cy = y + h / 2;

    if (node.type === 'decision' || node.type === 'loop' || node.type === 'forloop') {
      const points = `${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`;
      const cls = 'fc-diamond fc-decision-shape';
      return (
        <g key={node.id}>
          <polygon points={points} className={cls} />
          <foreignObject x={x + 8} y={y + 6} width={w - 16} height={h - 12}>
            <div xmlns="http://www.w3.org/1999/xhtml" className="fc-node-text">
              {node.text}
            </div>
          </foreignObject>
        </g>
      );
    }

    if (node.type === 'merge') {
      return (
        <circle
          key={node.id}
          cx={cx}
          cy={cy}
          r={MERGE_SIZE / 2}
          className="fc-merge-circle"
        />
      );
    }

    if (node.type === 'input' || node.type === 'output') {
      const flipped = flippedNodes[node.id];
      if (flipped) {
        return (
          <g key={node.id} className="fc-clickable" onClick={() => toggleShape(node.id)}>
            <rect x={x} y={y} width={w} height={h} rx={0} ry={0} className="fc-rect fc-process-shape" />
            <foreignObject x={x + 4} y={y + 3} width={w - 8} height={h - 6}>
              <div xmlns="http://www.w3.org/1999/xhtml" className="fc-node-text">
                {node.text}
              </div>
            </foreignObject>
          </g>
        );
      }
      const slant = 12;
      const points = `${x + slant},${y} ${x + w},${y} ${x + w - slant},${y + h} ${x},${y + h}`;
      return (
        <g key={node.id} className="fc-clickable" onClick={() => toggleShape(node.id)}>
          <polygon points={points} className="fc-rect fc-process-shape" />
          <foreignObject x={x + 6} y={y + 3} width={w - 10} height={h - 6}>
            <div xmlns="http://www.w3.org/1999/xhtml" className="fc-node-text">
              {node.text}
            </div>
          </foreignObject>
        </g>
      );
    }

    const flipped = flippedNodes[node.id];
    if (flipped) {
      const slant = 12;
      const pts = `${x + slant},${y} ${x + w},${y} ${x + w - slant},${y + h} ${x},${y + h}`;
      return (
        <g key={node.id} className="fc-clickable" onClick={() => toggleShape(node.id)}>
          <polygon points={pts} className="fc-rect fc-process-shape" />
          <foreignObject x={x + 6} y={y + 3} width={w - 10} height={h - 6}>
            <div xmlns="http://www.w3.org/1999/xhtml" className="fc-node-text">
              {node.text}
            </div>
          </foreignObject>
        </g>
      );
    }

    const rx = node.type === 'start' || node.type === 'end' ? 16 : 0;
    const cls =
      node.type === 'start' || node.type === 'end'
        ? 'fc-rect fc-start-end-shape'
        : 'fc-rect fc-process-shape';

    const isToggleable = node.type === 'process';
    return (
      <g key={node.id} className={isToggleable ? 'fc-clickable' : ''} onClick={isToggleable ? () => toggleShape(node.id) : undefined}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={rx}
          ry={rx}
          className={cls}
        />
        <foreignObject x={x + 4} y={y + 3} width={w - 8} height={h - 6}>
          <div xmlns="http://www.w3.org/1999/xhtml" className="fc-node-text">
            {node.text}
          </div>
        </foreignObject>
      </g>
    );
  };

  const renderEdges = () =>
    layout.edges.map((e, idx) => {
      const midY = (e.y1 + e.y2) / 2;

      let path = '';
      if (e.sideEnter) {
        const leftOff = Math.max(8, e.x1 - 60);
        path = `M ${e.x1} ${e.y1} L ${leftOff} ${e.y1} L ${leftOff} ${e.y2} L ${e.x2} ${e.y2}`;
      } else if (e.sideExit) {
        if (e.x2 < e.x1) {
          const rightX = e.rightX || (e.x1 + 80);
          const turnY = e.y2 - 12;
          path = `M ${e.x1} ${e.y1} L ${rightX} ${e.y1} L ${rightX} ${turnY} L ${e.x2} ${turnY} L ${e.x2} ${e.y2}`;
        } else {
          path = `M ${e.x1} ${e.y1} L ${e.x2} ${e.y1} L ${e.x2} ${e.y2}`;
        }
      } else if (Math.abs(e.x1 - e.x2) < 5) {
        path = `M ${e.x1} ${e.y1} L ${e.x2} ${e.y2}`;
      } else {
        path = `M ${e.x1} ${e.y1} L ${e.x1} ${midY} L ${e.x2} ${midY} L ${e.x2} ${e.y2}`;
      }

      const arrowPoints = e.sideEnter
        ? `${e.x2},${e.y2} ${e.x2 - 8},${e.y2 - 5} ${e.x2 - 8},${e.y2 + 5}`
        : `${e.x2},${e.y2} ${e.x2 - 5},${e.y2 - 8} ${e.x2 + 5},${e.y2 - 8}`;

      return (
        <g key={idx}>
          <path d={path} className="fc-edge" />
          <polygon points={arrowPoints} className="fc-arrowhead" />
          {e.label && (
            <text
              x={e.sideEnter ? e.x1 + (e.x2 - e.x1) * 0.4
                : e.sideExit ? e.x1 + 40
                : Math.abs(e.x1 - e.x2) < 5 ? e.x1 - 14
                : e.x1 + (e.x2 - e.x1) * 0.6}
              y={e.sideEnter ? midY - 6
                : e.sideExit ? e.y1 - 6
                : Math.abs(e.x1 - e.x2) < 5 ? midY + 2
                : midY - 6}
              className="fc-edge-label"
              textAnchor={Math.abs(e.x1 - e.x2) < 5 && !e.sideExit && !e.sideEnter ? 'end' : 'middle'}
            >
              {e.label}
            </text>
          )}
        </g>
      );
    });

  return (
    <div>
      <h2>Flowchart</h2>
      <p className="fc-subtitle">
        Paste Java code below to generate a flowchart.
      </p>

      <textarea
        className="fc-textarea"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        rows={14}
        spellCheck={false}
      />

      {error && <div className="fc-error">Error: {error}</div>}

      {flatNodes.length > 0 && (
        <div className="fc-toolbar">
          <button className="fc-export-btn" onClick={exportSVG}>
            Export SVG
          </button>
        </div>
      )}

      <div className="fc-chart-wrapper">
        {flatNodes.length > 0 ? (
          <svg
            width={svgWidth}
            height={svgHeight}
            className="fc-svg"
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          >
            <defs>
              <marker
                id="arrowhead"
                markerWidth="8"
                markerHeight="6"
                refX="8"
                refY="3"
                orient="auto"
              >
                <polygon points="0 0, 8 3, 0 6" fill="#71717a" />
              </marker>
            </defs>
            {renderEdges()}
            {flatNodes.map(renderNode)}
          </svg>
        ) : (
          <div className="fc-empty">No flowchart to display. Paste some Java code above.</div>
        )}
      </div>
    </div>
  );
}

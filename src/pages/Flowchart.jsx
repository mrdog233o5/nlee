import { useState, useMemo } from 'react';
import { parseJavaCode, flattenTree } from '../utils/flowchartParser';

const DECISION_H = 56;
const MERGE_SIZE = 12;
const START_END_W = 100;
const COL_GAP = 260;
const ROW_GAP = 30;
const PAD_X = 40;
const PAD_Y = 30;
const COL_REF_W = 180;
const MIN_W = 80;
const NODE_MIN_H = 44;

const SAMPLE_CODE = `public class Example {
  public static void main(String[] args) {
    int x = 5;
    if (x > 3) {
      System.out.println("Big");
    } else {
      System.out.println("Small");
    }
    for (int i = 0; i < x; i++) {
      System.out.println(i);
    }
    System.out.println("Done");
  }
}`;

function computeNodeDims(node) {
  if (node.type === 'merge') return { w: MERGE_SIZE, h: MERGE_SIZE };

  const text = node.text || '';
  const charW = 8;
  const lineH = 17;
  const padX = (node.type === 'start' || node.type === 'end') ? 28 : 16;
  const padY = 10;
  const maxContentW = (node.type === 'decision' || node.type === 'loop' || node.type === 'forloop') ? 220 : 260;
  const charsPerLine = Math.max(1, Math.floor(maxContentW / charW));

  let totalLines = 0;
  let maxLinePx = 0;
  text.split('\n').forEach((line) => {
    const wrapped = Math.max(1, Math.ceil(line.length / charsPerLine));
    totalLines += wrapped;
    maxLinePx = Math.max(maxLinePx, Math.min(line.length, charsPerLine) * charW);
  });

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

function layoutFlowchart(flatNodes, flatEdges) {
  const nodeMap = {};
  flatNodes.forEach((n) => { nodeMap[n.id] = n; });

  // Per-node dimensions
  const nodeDims = {};
  flatNodes.forEach((n) => { nodeDims[n.id] = computeNodeDims(n); });

  // Parent lookup for y-constraints
  const nodeParents = {};
  flatEdges.forEach((e) => {
    if (!nodeParents[e.to]) nodeParents[e.to] = [];
    nodeParents[e.to].push(e.from);
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

    // Extra gap when exiting a forloop (parent is a forloop diamond)
    const exitsForloop = (nodeParents[n.id] || []).some((pid) => {
      const pn = nodeMap[pid];
      return pn && pn.type === 'forloop';
    });
    const effectiveColBottom = exitsForloop ? colBottom[n.depth] + ROW_GAP : colBottom[n.depth];

    const y = Math.max(effectiveColBottom, minY);

    const colCenter = PAD_X + n.depth * COL_GAP + COL_REF_W / 2;
    const x = colCenter - dims.w / 2;

    positions[n.id] = { x, y, w: dims.w, h: dims.h };
    colBottom[n.depth] = y + dims.h;
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
    });
  });

  return { positions, edges: renderedEdges, nodeMap };
}

export default function Flowchart() {
  const [code, setCode] = useState(SAMPLE_CODE);
  const [error, setError] = useState('');

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
    () => layoutFlowchart(flatNodes, flatEdges),
    [flatNodes, flatEdges],
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
          <foreignObject x={x + 10} y={y + 8} width={w - 20} height={h - 16}>
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

    const rx = node.type === 'start' || node.type === 'end' ? 22 : 6;
    const cls =
      node.type === 'start' || node.type === 'end'
        ? 'fc-rect fc-start-end-shape'
        : 'fc-rect fc-process-shape';

    return (
      <g key={node.id}>
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={rx}
          ry={rx}
          className={cls}
        />
        <foreignObject x={x + 6} y={y + 4} width={w - 12} height={h - 8}>
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
          const rightX = e.x1 + 40;
          const turnY = e.y2 - 15;
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
                : e.sideExit ? (e.x1 + e.x2) / 2
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

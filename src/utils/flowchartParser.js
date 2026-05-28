/**
 * flowchartParser.js
 * Parses Java code into a flowchart tree structure.
 */

function classifyLine(line) {
  if (/^if\s*\(/.test(line)) return 'if';
  if (/^else\s+if\s*\(/.test(line)) return 'elseif';
  if (/^else\b/.test(line)) return 'else';
  if (/^for\s*\(/.test(line)) return 'for';
  if (/^while\s*\(/.test(line)) return 'while';
  if (/^do\s*\{?\s*$/.test(line)) return 'do';
  return 'process';
}

function extractCondition(line, keyword) {
  const re = new RegExp('^' + keyword + '\\s*\\(?');
  let cond = line.replace(re, '').trim();
  cond = cond.replace(/\)\s*\{?\s*$/, '').trim();
  cond = cond.replace(/\)\s*$/, '').trim();
  return cond;
}

function extractForParts(line) {
  const inner = line.replace(/^for\s*\(/, '').replace(/\)\s*\{?\s*$/, '').trim();
  const parts = inner.split(';');
  return {
    init: (parts[0] || '').trim(),
    condition: (parts[1] || '').trim(),
    update: (parts[2] || '').trim(),
  };
}

/**
 * Build a flowchart tree.
 */
function buildTree(lines) {
  const root = [];
  const stack = [{ nodes: root, type: 'root' }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const ctx = stack[stack.length - 1];

    if (line === '{') continue;

    if (line === '}') {
      if (stack.length > 1) {
        const popped = stack.pop();
        if (popped.type === 'do-body') {
          const nextLine = lines[i + 1];
          if (nextLine && /^while\s*\(/.test(nextLine)) {
            popped.parentNode.condition =
              'do { ... } while (' + extractCondition(nextLine, 'while') + ')';
            i++;
          }
        }
      }
      continue;
    }

    const kind = classifyLine(line);

    switch (kind) {
      case 'if': {
        const condition = extractCondition(line, 'if');
        const node = {
          type: 'decision',
          condition: 'if (' + condition + ')',
          trueBranch: [],
          falseBranch: null,
        };
        ctx.nodes.push(node);
        stack.push({ nodes: node.trueBranch, type: 'if-body', parentNode: node });
        break;
      }

      case 'elseif': {
        // The if-body was already popped by '}'. Find the last decision node
        // in the parent context and attach this elseif as its false branch.
        const lastNode = ctx.nodes[ctx.nodes.length - 1];
        if (lastNode && lastNode.type === 'decision') {
          const condition = extractCondition(line, 'else\\s+if');
          const node = {
            type: 'decision',
            condition: 'else if (' + condition + ')',
            trueBranch: [],
            falseBranch: null,
          };
          lastNode.falseBranch = [node];
          stack.push({ nodes: node.trueBranch, type: 'if-body', parentNode: node });
        } else {
          ctx.nodes.push({ type: 'process', text: line });
        }
        break;
      }

      case 'else': {
        // The if-body was already popped by '}'. Find the last decision node
        // in the parent context.
        const lastNode = ctx.nodes[ctx.nodes.length - 1];
        if (lastNode && lastNode.type === 'decision') {
          lastNode.falseBranch = [];
          stack.push({
            nodes: lastNode.falseBranch,
            type: 'else-body',
            parentNode: lastNode,
          });
        } else {
          ctx.nodes.push({ type: 'process', text: line });
        }
        break;
      }

      case 'for': {
        const parts = extractForParts(line);
        const display = parts.init
          ? 'for (' + parts.init + '; ' + parts.condition + '; ' + parts.update + ')'
          : 'for (' + parts.condition + ')';
        const node = { type: 'loop', condition: display, body: [] };
        ctx.nodes.push(node);
        stack.push({ nodes: node.body, type: 'for-body', parentNode: node });
        break;
      }

      case 'while': {
        const condition = extractCondition(line, 'while');
        const node = {
          type: 'loop',
          condition: 'while (' + condition + ')',
          body: [],
        };
        ctx.nodes.push(node);
        stack.push({ nodes: node.body, type: 'while-body', parentNode: node });
        break;
      }

      case 'do': {
        const node = {
          type: 'loop',
          condition: 'do { ... } while (...)',
          body: [],
        };
        ctx.nodes.push(node);
        stack.push({ nodes: node.body, type: 'do-body', parentNode: node });
        break;
      }

      default:
        ctx.nodes.push({ type: 'process', text: line });
        break;
    }
  }

  return root;
}

function splitCompoundLine(line) {
  const result = [];
  let remaining = line;
  while (remaining.startsWith('}')) {
    result.push('}');
    remaining = remaining.slice(1).trim();
  }
  if (remaining.length > 0) {
    result.push(remaining);
  }
  return result;
}

function cleanLines(code) {
  let lines = code.split('\n');

  lines = lines
    .map((l) => {
      const commentIdx = l.indexOf('//');
      if (commentIdx >= 0) l = l.slice(0, commentIdx);
      return l.trim();
    })
    .filter((l) => l.length > 0);

  lines = lines.filter(
    (l) => !l.startsWith('package ') && !l.startsWith('import '),
  );

  lines = lines.filter((l) => {
    if (/^(public\s+)?(class|interface|enum)\s+\w+/.test(l)) return false;
    if (/^(public|private|protected)\s+/.test(l) && /\(.*\)\s*\{?\s*$/.test(l))
      return false;
    if (/^@\w+/.test(l)) return false;
    return true;
  });

  lines = lines.flatMap(splitCompoundLine);
  return lines;
}

export function parseJavaCode(code) {
  const lines = cleanLines(code);
  if (lines.length === 0) return [];
  return buildTree(lines);
}

export function flattenTree(tree) {
  const nodes = [];
  const edges = [];
  const startId = 'start';
  const endId = 'end';
  let idCounter = 0;

  function nextId() {
    return 'n' + idCounter++;
  }

  function processBlock(block, depth) {
    if (block.length === 0) return { first: null, last: null };

    let prev = null;
    let blockFirst = null;
    let blockLast = null;

    for (const item of block) {
      if (item.type === 'process') {
        const id = nextId();
        nodes.push({ id, type: 'process', text: item.text, depth });
        if (prev) edges.push({ from: prev, to: id, label: '' });
        else blockFirst = id;
        prev = id;
        blockLast = id;
      } else if (item.type === 'decision') {
        const decId = nextId();
        nodes.push({ id: decId, type: 'decision', text: item.condition, depth });
        if (prev) edges.push({ from: prev, to: decId, label: '' });
        else blockFirst = decId;

        const trueResult = processBlock(item.trueBranch, depth + 1);
        if (trueResult.first) {
          edges.push({ from: decId, to: trueResult.first, label: 'T' });
        }

        let falseLast = null;
        if (item.falseBranch && item.falseBranch.length > 0) {
          const falseResult = processBlock(item.falseBranch, depth + 1);
          if (falseResult.first) {
            edges.push({ from: decId, to: falseResult.first, label: 'F' });
            falseLast = falseResult.last;
          }
        }

        const mergeId = nextId();
        nodes.push({ id: mergeId, type: 'merge', text: '', depth });
        if (trueResult.last)
          edges.push({ from: trueResult.last, to: mergeId, label: '' });
        if (falseLast)
          edges.push({ from: falseLast, to: mergeId, label: '' });
        else
          edges.push({ from: decId, to: mergeId, label: 'F' });

        prev = mergeId;
        blockLast = mergeId;
      } else if (item.type === 'loop') {
        const loopId = nextId();
        nodes.push({ id: loopId, type: 'loop', text: item.condition, depth });
        if (prev) edges.push({ from: prev, to: loopId, label: '' });
        else blockFirst = loopId;

        const bodyResult = processBlock(item.body, depth + 1);
        if (bodyResult.first) {
          edges.push({ from: loopId, to: bodyResult.first, label: 'T' });
        }

        const loopEnd = bodyResult.last || loopId;
        edges.push({ from: loopEnd, to: loopId, label: 'loop' });

        const exitId = nextId();
        nodes.push({ id: exitId, type: 'merge', text: '', depth });
        edges.push({ from: loopId, to: exitId, label: 'F' });

        prev = exitId;
        blockLast = exitId;
      }
    }

    return { first: blockFirst, last: blockLast };
  }

  nodes.push({ id: startId, type: 'start', text: 'Start', depth: 0 });

  if (tree.length > 0) {
    const result = processBlock(tree, 0);
    if (result.first) {
      edges.push({ from: startId, to: result.first, label: '' });
    }
    if (result.last) {
      nodes.push({ id: endId, type: 'end', text: 'End', depth: 0 });
      edges.push({ from: result.last, to: endId, label: '' });
    }
  } else {
    nodes.push({ id: endId, type: 'end', text: 'End', depth: 0 });
    edges.push({ from: startId, to: endId, label: '' });
  }

  return { nodes, edges };
}

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

/**
 * Build a flowchart tree.
 */
function parseForHeader(line) {
  let inner = line.replace(/^for\s*\(\s*/, '');
  inner = inner.replace(/\s*\)\s*\{?\s*$/, '');
  const parts = inner.split(';');
  let condition = '';
  let update = '';
  if (parts.length >= 3) {
    condition = parts[1].trim();
    update = parts.slice(2).join(';').trim();
  } else if (parts.length === 2) {
    condition = parts[0].trim();
    update = parts[1].trim();
  } else {
    condition = parts[0] ? parts[0].trim() : '';
  }
  return { condition, update };
}

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
          condition: condition,
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

      case 'for': {
        const { condition, update } = parseForHeader(line);
        const node = {
          type: 'forloop',
          condition: condition,
          update: update || undefined,
          body: [],
        };
        ctx.nodes.push(node);
        stack.push({ nodes: node.body, type: 'for-body', parentNode: node });
        break;
      }

      default:
        ctx.nodes.push({ type: 'process', text: line });
        break;
    }
  }

  return root;
}

function isBraced(lines, i) {
  return lines[i].endsWith('{') || (i + 1 < lines.length && lines[i + 1] === '{');
}

function copyBracedBlock(lines, i, result) {
  let depth = 0;
  while (i < lines.length) {
    const line = lines[i];
    result.push(line);
    if (line.endsWith('{') || line === '{') depth++;
    if (line === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

// Copy exactly one statement starting at lines[i], recursively expanding
// braceless inner constructs. Returns the index after the statement.
function copyStatement(lines, i, result) {
  if (i >= lines.length) return i;

  const line = lines[i];
  const kind = classifyLine(line);

  if (kind === 'if') {
    if (isBraced(lines, i)) return copyBracedBlock(lines, i, result);
    result.push(line);
    result.push('{');
    i = copyStatement(lines, i + 1, result);
    result.push('}');
    while (i < lines.length && classifyLine(lines[i]) === 'elseif') {
      const elIfLine = lines[i];
      result.push(elIfLine);
      result.push('{');
      i = copyStatement(lines, i + 1, result);
      result.push('}');
    }
    if (i < lines.length && classifyLine(lines[i]) === 'else') {
      result.push(lines[i]);
      result.push('{');
      i = copyStatement(lines, i + 1, result);
      result.push('}');
    }
    return i;
  }

  if (kind === 'for' || kind === 'while') {
    if (isBraced(lines, i)) return copyBracedBlock(lines, i, result);
    result.push(line);
    result.push('{');
    i = copyStatement(lines, i + 1, result);
    result.push('}');
    return i;
  }

  if (kind === 'do') {
    if (isBraced(lines, i)) return copyBracedBlock(lines, i, result);
    result.push(line);
    result.push('{');
    i = copyStatement(lines, i + 1, result);
    result.push('}');
    if (i < lines.length && /^while\s*\(/.test(lines[i])) {
      result.push(lines[i]);
      i++;
    }
    return i;
  }

  result.push(line);
  return i + 1;
}

// Inject virtual { } around braceless control-flow bodies so the
// existing buildTree can process them without changes.
function expandBraceless(lines) {
  const result = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i];
    const kind = classifyLine(line);

    if ((kind === 'if' || kind === 'elseif' || kind === 'else' ||
         kind === 'for' || kind === 'while' || kind === 'do') && !isBraced(lines, i)) {
      result.push(line);
      result.push('{');
      i = copyStatement(lines, i + 1, result);
      result.push('}');
      if (kind === 'do' && i < lines.length && /^while\s*\(/.test(lines[i])) {
        result.push(lines[i]);
        i++;
      }
    } else {
      result.push(line);
      i++;
    }
  }
  return result;
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
  // 移除多行注释 /* ... */
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');

  let lines = code.split('\n');

  lines = lines
    .map((l) => {
      const commentIdx = l.indexOf('//');
      if (commentIdx >= 0) l = l.slice(0, commentIdx);
      return l.trim().replace(/;$/, '');
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
  const expanded = expandBraceless(lines);
  return buildTree(expanded);
}

export function flattenTree(tree) {
  const nodes = [];
  const edges = [];
  const startId = 'start';
  const endId = 'end';
  let idCounter = 0;
  let minDepth = 0;

  function nextId() {
    return 'n' + idCounter++;
  }

  function processBlock(block, depth) {
    minDepth = Math.min(minDepth, depth);
    if (block.length === 0) return { first: null, last: null };

    let prev = null;
    let prevForloopExit = false;
    let blockFirst = null;
    let blockLast = null;

    function connectPrev(id) {
      if (!prev) return;
      if (prev.type === 'multi') {
        prev.exits.forEach(({ exitId, label: exitLabel, exitRight }) => {
          const edge = { from: exitId, to: id, label: exitLabel };
          if (exitRight) edge.exitRight = true;
          edges.push(edge);
        });
        prevForloopExit = false;
      } else if (prevForloopExit) {
        edges.push({ from: prev, to: id, label: 'F', exitRight: true });
        prevForloopExit = false;
      } else {
        edges.push({ from: prev, to: id, label: '' });
      }
    }

    for (const item of block) {
      if (item.type === 'process') {
        const id = nextId();
        nodes.push({ id, type: 'process', text: item.text, depth });
        connectPrev(id);
        if (!blockFirst) blockFirst = id;
        prev = id;
        blockLast = id;
      } else if (item.type === 'decision') {
        const decId = nextId();
        nodes.push({ id: decId, type: 'decision', text: item.condition, depth });
        connectPrev(decId);
        if (!blockFirst) blockFirst = decId;

        const trueResult = processBlock(item.trueBranch, depth);
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

        const exits = [];
        if (trueResult.last) exits.push({ exitId: trueResult.last, label: '' });
        if (falseLast) exits.push({ exitId: falseLast, label: '' });
        else exits.push({ exitId: decId, label: 'F', exitRight: true });

        if (exits.length === 1) {
          prev = exits[0].exitId;
          blockLast = exits[0].exitId;
        } else {
          prev = { type: 'multi', exits };
          blockLast = trueResult.last || decId;
        }
      } else if (item.type === 'forloop') {
        if (item.update) {
          item.body.push({ type: 'process', text: item.update });
        }

        const loopId = nextId();
        nodes.push({ id: loopId, type: 'forloop', text: item.condition, depth });
        connectPrev(loopId);
        if (!blockFirst) blockFirst = loopId;

        const bodyResult = processBlock(item.body, depth);
        if (bodyResult.first) {
          edges.push({ from: loopId, to: bodyResult.first, label: 'T' });
        }

        const loopEnd = bodyResult.last || loopId;
        edges.push({ from: loopEnd, to: loopId, label: '', loopBack: true });

        prev = loopId;
        prevForloopExit = true;
        blockLast = loopId;
      } else if (item.type === 'loop') {
        if (item.update) {
          item.body.push({ type: 'process', text: item.update });
        }

        const loopId = nextId();
        nodes.push({ id: loopId, type: 'loop', text: item.condition, depth });
        connectPrev(loopId);
        if (!blockFirst) blockFirst = loopId;

        const bodyResult = processBlock(item.body, depth);
        if (bodyResult.first) {
          edges.push({ from: loopId, to: bodyResult.first, label: 'T' });
        }

        const loopEnd = bodyResult.last || loopId;
        edges.push({ from: loopEnd, to: loopId, label: '', loopBack: true });

        const exitId = nextId();
        nodes.push({ id: exitId, type: 'merge', text: '', depth: depth + 1 });
        edges.push({ from: loopId, to: exitId, label: 'F', exitRight: true });

        prev = exitId;
        blockLast = exitId;
      }
    }

    return { first: blockFirst, last: blockLast };
  }

  const BASE = 1;
  nodes.push({ id: startId, type: 'start', text: 'Start', depth: BASE });

  if (tree.length > 0) {
    const result = processBlock(tree, BASE);
    if (result.first) {
      edges.push({ from: startId, to: result.first, label: '' });
    }
    if (result.last) {
      nodes.push({ id: endId, type: 'end', text: 'End', depth: BASE });
      edges.push({ from: result.last, to: endId, label: '' });
    }
  } else {
    nodes.push({ id: endId, type: 'end', text: 'End', depth: BASE });
    edges.push({ from: startId, to: endId, label: '' });
  }

  if (minDepth < 0) {
    const shift = -minDepth;
    nodes.forEach((n) => { n.depth += shift; });
  }

  return { nodes, edges };
}

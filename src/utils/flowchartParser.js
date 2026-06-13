/**
 * flowchartParser.js
 * Parses Java code into a flowchart tree structure.
 */

function simplifyText(text) {
  const m = text.match(/^System\.out\.print(?:ln|f)?\s*\((.+)\)\s*;?\s*$/);
  if (m) return 'output ' + m[1];
  return text;
}

function classifyIO(line) {
  if (/^System\.out\.print(?:ln|f)?\s*\(/.test(line)) return 'output';
  if (/^(?:Scanner|BufferedReader|readLine|read\s*\()/.test(line)) return 'input';
  if (/\.next(?:Int|Line|Double|Float|Boolean|Long|Short|Byte)?\s*\(/.test(line)) return 'input';
  return 'process';
}

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
  let init = '';
  let condition = '';
  let update = '';
  if (parts.length >= 3) {
    init = parts[0].trim();
    condition = parts[1].trim();
    update = parts.slice(2).join(';').trim();
  } else if (parts.length === 2) {
    init = parts[0].trim();
    condition = parts[1].trim();
    update = '';
  } else {
    init = parts[0] ? parts[0].trim() : '';
    condition = parts[0] ? parts[0].trim() : '';
  }
  return { init, condition, update };
}

/**
 * Scan raw Java code for an Input section delimited by comment markers:
 *   // Input  (or // Inputs)
 *     ... variable declarations ...
 *   // Processing section  (or // Processings section)
 *
 * Returns a Set of variable names declared in that section.
 */
export function findInputSectionVars(code) {
  const inputVars = new Set();
  let inInputSection = false;

  const lines = code.split('\n');
  for (const raw of lines) {
    const trimmed = raw.trim();

    if (/^\/\/\s*Inputs?\s*$/i.test(trimmed)) {
      inInputSection = true;
      continue;
    }
    if (/^\/\/\s*Processings?\s+section\s*$/i.test(trimmed)) {
      inInputSection = false;
      continue;
    }

    if (!inInputSection) continue;

    // Strip inline comments from potential declaration line
    const codePart = trimmed.replace(/\/\/.*$/, '').trim();
    const declMatch = codePart.match(
      /^(int|double|float|long|short|byte|boolean|char|String)\s+(\w+)\s*(=|$)/
    );
    if (declMatch) inputVars.add(declMatch[2]);
  }

  return inputVars;
}

function buildTree(lines, inputVars) {
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
        // Walk the falseBranch chain to find the last decision node,
        // so stacked elseifs don't overwrite each other.
        const firstNode = ctx.nodes[ctx.nodes.length - 1];
        let lastDecision = firstNode;
        while (
          lastDecision &&
          lastDecision.type === 'decision' &&
          lastDecision.falseBranch &&
          lastDecision.falseBranch.length > 0 &&
          lastDecision.falseBranch[0].type === 'decision'
        ) {
          lastDecision = lastDecision.falseBranch[0];
        }
        if (lastDecision && lastDecision.type === 'decision') {
          const condition = extractCondition(line, 'else\\s+if');
          const node = {
            type: 'decision',
            condition: condition,
            trueBranch: [],
            falseBranch: null,
          };
          lastDecision.falseBranch = [node];
          stack.push({ nodes: node.trueBranch, type: 'if-body', parentNode: node });
        } else {
          ctx.nodes.push({ type: classifyIO(line), text: simplifyText(line) });
        }
        break;
      }

      case 'else': {
        // Walk the falseBranch chain to find the last decision node,
        // so a stacked else doesn't overwrite preceding elseifs.
        const firstNode = ctx.nodes[ctx.nodes.length - 1];
        let lastDecision = firstNode;
        while (
          lastDecision &&
          lastDecision.type === 'decision' &&
          lastDecision.falseBranch &&
          lastDecision.falseBranch.length > 0 &&
          lastDecision.falseBranch[0].type === 'decision'
        ) {
          lastDecision = lastDecision.falseBranch[0];
        }
        if (lastDecision && lastDecision.type === 'decision') {
          lastDecision.falseBranch = [];
          stack.push({
            nodes: lastDecision.falseBranch,
            type: 'else-body',
            parentNode: lastDecision,
          });
        } else {
          ctx.nodes.push({ type: classifyIO(line), text: simplifyText(line) });
        }
        break;
      }

      case 'while': {
        const condition = extractCondition(line, 'while');
        const node = {
          type: 'loop',
          condition: condition,
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
        const { init, condition, update } = parseForHeader(line);
        const node = {
          type: 'forloop',
          condition: condition,
          init: init || undefined,
          update: update || undefined,
          body: [],
        };
        ctx.nodes.push(node);
        stack.push({ nodes: node.body, type: 'for-body', parentNode: node });
        break;
      }

      default: {
        let nodeType = classifyIO(line);
        if (nodeType === 'process' && inputVars && inputVars.size > 0) {
          const declMatch = line.match(
            /^(int|double|float|long|short|byte|boolean|char|String)\s+(\w+)/
          );
          if (declMatch && inputVars.has(declMatch[2])) {
            nodeType = 'input';
          }
        }
        ctx.nodes.push({ type: nodeType, text: simplifyText(line) });
        break;
      }
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
  const inputVars = findInputSectionVars(code);
  const expanded = expandBraceless(lines);
  return buildTree(expanded, inputVars);
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
    if (block.length === 0) return { first: null, last: null, prev: null, pfExit: false };

    let prev = null;
    let prevForloopExit = false;
    let blockFirst = null;

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
        edges.push({ from: prev, to: id, label: 'false', exitRight: true });
        prevForloopExit = false;
      } else {
        edges.push({ from: prev, to: id, label: '' });
      }
    }

    // Expand prev/prevForloopExit into an array of exit descriptors.
    function collectExits(p, pf) {
      if (!p) return [];
      if (typeof p === 'string') {
        if (pf) return [{ exitId: p, label: 'false', exitRight: true }];
        return [{ exitId: p, label: '' }];
      }
      // multi
      return p.exits.map((e) => ({ exitId: e.exitId, label: e.label || '', exitRight: e.exitRight || false }));
    }

    for (const item of block) {
      if (item.type === 'process' || item.type === 'input' || item.type === 'output') {
        const id = nextId();
        nodes.push({ id, type: item.type, text: item.text, depth });
        connectPrev(id);
        if (!blockFirst) blockFirst = id;
        prev = id;
        prevForloopExit = false;
      } else if (item.type === 'decision') {
        const decId = nextId();
        nodes.push({ id: decId, type: 'decision', text: item.condition, depth });
        connectPrev(decId);
        if (!blockFirst) blockFirst = decId;

        const trueResult = processBlock(item.trueBranch, depth);
        if (trueResult.first) {
          edges.push({ from: decId, to: trueResult.first, label: 'true' });
        }

        let falseResult = null;
        if (item.falseBranch && item.falseBranch.length > 0) {
          falseResult = processBlock(item.falseBranch, depth + 1);
          if (falseResult.first) {
            edges.push({ from: decId, to: falseResult.first, label: 'false' });
          }
        }

        const exits = [];
        // Use collectExits to capture ALL exits from each branch, including multi-exits
        if (trueResult.last) {
          exits.push(...collectExits(trueResult.prev, trueResult.pfExit));
        }
        if (falseResult && falseResult.last) {
          exits.push(...collectExits(falseResult.prev, falseResult.pfExit));
        } else if (!item.falseBranch || item.falseBranch.length === 0) {
          // No false branch → the decision itself carries the F exit
          exits.push({ exitId: decId, label: 'false', exitRight: true });
        }

        if (exits.length === 1) {
          prev = exits[0].exitId;
          prevForloopExit = exits[0].exitRight || false;
        } else {
          prev = { type: 'multi', exits };
          prevForloopExit = false;
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
          edges.push({ from: loopId, to: bodyResult.first, label: 'true' });
        }

        const loopEnd = bodyResult.last || loopId;
        edges.push({ from: loopEnd, to: loopId, label: '', loopBack: true });

        prev = loopId;
        prevForloopExit = true;
      } else if (item.type === 'loop') {
        const loopId = nextId();
        nodes.push({ id: loopId, type: 'loop', text: item.condition, depth });
        connectPrev(loopId);
        if (!blockFirst) blockFirst = loopId;

        const bodyResult = processBlock(item.body, depth);
        if (bodyResult.first) {
          edges.push({ from: loopId, to: bodyResult.first, label: 'true' });
        }

        const loopEnd = bodyResult.last || loopId;
        edges.push({ from: loopEnd, to: loopId, label: '', loopBack: true });

        prev = loopId;
        prevForloopExit = true;
      }
    }

    const blockLast = prev && typeof prev === 'string' ? prev : (prev && prev.type === 'multi' ? prev.exits[0]?.exitId : null);
    return { first: blockFirst, last: blockLast, prev, pfExit: prevForloopExit };
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
      // Connect ALL exits (including multi-exits) to End
      const exits = [];
      if (result.prev && typeof result.prev !== 'string' && result.prev.type === 'multi') {
        exits.push(...result.prev.exits);
      } else if (result.prev && typeof result.prev === 'string') {
        const label = result.pfExit ? 'false' : '';
        const exitRight = result.pfExit || false;
        exits.push({ exitId: result.prev, label, exitRight });
      } else {
        exits.push({ exitId: result.last, label: '' });
      }
      exits.forEach(({ exitId, label, exitRight }) => {
        const edge = { from: exitId, to: endId, label: label };
        if (exitRight) edge.exitRight = true;
        edges.push(edge);
      });
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

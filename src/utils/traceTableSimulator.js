/** traceTableSimulator.js --- Java code simulator for trace table generation */

import { parseJavaCode } from './flowchartParser.js';

// ═══════════════════════════════════════════
// Layer 1: Expression Tokenizer
// ═══════════════════════════════════════════

const OPERATORS_2 = new Set([
  '==', '!=', '<=', '>=', '&&', '||',
  '+=', '-=', '*=', '/=', '%=', '++', '--',
]);
const OPERATORS_1 = new Set('+-*/%()<>=!&|');
const CHARS = '+-*/%()<>=!&|';

function tokenize(expr) {
  const tokens = [];
  let i = 0;
  while (i < expr.length) {
    if (expr[i] === ' ' || expr[i] === '\t') { i++; continue; }

    // string literal
    if (expr[i] === '"') {
      let str = '';
      i++;
      while (i < expr.length && expr[i] !== '"') {
        if (expr[i] === '\\') { i++; if (i < expr.length) str += expr[i++]; }
        else str += expr[i++];
      }
      i++;
      tokens.push({ type: 'STRING', value: str });
      continue;
    }

    // 2-char operator
    if (i + 1 < expr.length && OPERATORS_2.has(expr.slice(i, i + 2))) {
      tokens.push({ type: 'OPERATOR', value: expr.slice(i, i + 2) });
      i += 2;
      continue;
    }

    // 1-char operator / punctuation
    if (CHARS.includes(expr[i])) {
      tokens.push({ type: 'OPERATOR', value: expr[i] });
      i++;
      continue;
    }

    // number
    if (/\d/.test(expr[i])) {
      let num = '';
      while (i < expr.length && /\d/.test(expr[i])) num += expr[i++];
      if (expr[i] === '.') {
        num += '.';
        i++;
        while (i < expr.length && /\d/.test(expr[i])) num += expr[i++];
      }
      tokens.push({ type: 'NUMBER', value: num.includes('.') ? parseFloat(num) : parseInt(num, 10) });
      continue;
    }

    // identifier | keyword
    if (/[a-zA-Z_]/.test(expr[i])) {
      let id = '';
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) id += expr[i++];
      if (id === 'true') tokens.push({ type: 'BOOLEAN', value: true });
      else if (id === 'false') tokens.push({ type: 'BOOLEAN', value: false });
      else if (id === 'null') tokens.push({ type: 'NULL', value: null });
      else tokens.push({ type: 'IDENTIFIER', value: id });
      continue;
    }

    i++; // skip unknown
  }
  return tokens;
}

// ═══════════════════════════════════════════
// Layer 2: Expression Evaluator
// ═══════════════════════════════════════════
// Recursive-descent, left-recursion flattening.

class EvalError extends Error {
  constructor(msg) { super(msg); this.name = 'EvalError'; }
}

class Parser {
  constructor(tokens, scope) {
    this.tokens = tokens;
    this.pos = 0;
    this.scope = scope;
  }
  peek() { return this.tokens[this.pos] || null; }
  consume() { return this.tokens[this.pos++] || null; }
  match(type, value) {
    const t = this.peek();
    if (!t) return false;
    if (type !== undefined && t.type !== type) return false;
    if (value !== undefined && t.value !== value) return false;
    this.pos++;
    return t;
  }
  expect(type, value) {
    const t = this.peek();
    if (!t || (type !== undefined && t.type !== type) || (value !== undefined && t.value !== value)) {
      const got = t ? `${t.type}(${t.value})` : 'EOF';
      throw new EvalError(`Expected ${value || type}, got ${got}`);
    }
    return this.consume();
  }

  parse() { return this.logicalOr(); }

  // --- precedence climbing helpers ---
  binary(nextFn, ops) {
    let left = nextFn.call(this);
    while (this.peek() && this.peek().type === 'OPERATOR' && ops.has(this.peek().value)) {
      const op = this.consume().value;
      const right = nextFn.call(this);
      left = applyOp(op, left, right, this.scope);
    }
    return left;
  }

  logicalOr() { return this.binary(this.logicalAnd.bind(this), new Set(['||'])); }
  logicalAnd() { return this.binary(this.equality.bind(this), new Set(['&&'])); }
  equality() { return this.binary(this.comparison.bind(this), new Set(['==', '!='])); }
  comparison() { return this.binary(this.addition.bind(this), new Set(['>', '<', '>=', '<='])); }

  addition() {
    let left = this.term();
    while (this.peek() && this.peek().type === 'OPERATOR' && (this.peek().value === '+' || this.peek().value === '-')) {
      const op = this.consume().value;
      const right = this.term();
      left = applyOp(op, left, right, this.scope);
    }
    return left;
  }

  term() {
    let left = this.unary();
    while (this.peek() && this.peek().type === 'OPERATOR' && (this.peek().value === '*' || this.peek().value === '/' || this.peek().value === '%')) {
      const op = this.consume().value;
      const right = this.unary();
      left = applyOp(op, left, right, this.scope);
    }
    return left;
  }

  unary() {
    if (this.match('OPERATOR', '!')) {
      const right = this.unary();
      return !toBool(right);
    }
    if (this.match('OPERATOR', '-')) {
      const right = this.unary();
      return -toNum(right);
    }
    return this.primary();
  }

  primary() {
    if (this.match('NUMBER')) return this.tokens[this.pos - 1].value;
    if (this.match('BOOLEAN')) return this.tokens[this.pos - 1].value;
    if (this.match('STRING')) return this.tokens[this.pos - 1].value;
    if (this.match('NULL')) return null;
    if (this.match('IDENTIFIER')) {
      const name = this.tokens[this.pos - 1].value;
      const val = this.scope.get(name);
      if (val === undefined) throw new EvalError(`Variable "${name}" is not defined`);
      return val;
    }
    if (this.match('OPERATOR', '(')) {
      const expr = this.parse();
      this.expect('OPERATOR', ')');
      return expr;
    }
    throw new EvalError(`Unexpected token: ${this.peek() ? this.peek().value : 'EOF'}`);
  }
}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (v === null || v === undefined) return false;
  return true;
}

function applyOp(op, a, b, scope) {
  const na = toNum(a), nb = toNum(b);
  switch (op) {
    case '+': {
      // string concat if either side is string
      if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b);
      return na + nb;
    }
    case '-': return na - nb;
    case '*': return na * nb;
    case '/':
      if (nb === 0) throw new EvalError('Division by zero');
      // integer division for int types — but we don't know types here
      // In Java, int / int = int. Our scope tracks type hints.
      return Math.trunc(na / nb);
    case '%': return na % nb;
    case '>': return na > nb;
    case '<': return na < nb;
    case '>=': return na >= nb;
    case '<=': return na <= nb;
    case '==': return a === b;
    case '!=': return a !== b;
    case '&&': return toBool(a) && toBool(b);
    case '||': return toBool(a) || toBool(b);
    case '!': return !toBool(a);
    default: throw new EvalError(`Unknown operator: ${op}`);
  }
}

function evaluate(expr, scope) {
  const tokens = tokenize(expr);
  if (tokens.length === 0) return undefined;
  const parser = new Parser(tokens, scope);
  return parser.parse();
}

// ═══════════════════════════════════════════
// Layer 3: VariableScope
// ═══════════════════════════════════════════

class VariableScope {
  constructor() {
    this._vars = new Map();     // name → { value, type }
    this._order = [];           // declaration order
    this._conditions = new Map(); // expr text → { value }
    this._condOrder = [];
  }

  /** Declare a variable with optional initial value.
   *  If already declared (e.g. re-declaration inside a loop body), still update the value. */
  declare(name, type, initialValue) {
    const val = initialValue !== undefined ? initialValue : defaultValue(type);
    if (!this._vars.has(name)) {
      this._vars.set(name, { value: val, type });
      this._order.push(name);
    } else {
      this._vars.get(name).value = val;
    }
    return this;
  }

  /** Set an existing variable's value (or auto-declare if not seen) */
  set(name, value) {
    if (!this._vars.has(name)) {
      // auto-declare as int (best guess)
      this._vars.set(name, { value, type: typeof value === 'number' ? 'int' : typeof value });
      this._order.push(name);
    } else {
      this._vars.get(name).value = value;
    }
    return this;
  }

  get(name) {
    const entry = this._vars.get(name);
    return entry ? entry.value : undefined;
  }

  has(name) { return this._vars.has(name); }

  /** Record a condition evaluation (creates a condition column) */
  recordCondition(expr, result) {
    if (!this._conditions.has(expr)) {
      this._conditions.set(expr, { value: result });
      this._condOrder.push(expr);
    } else {
      this._conditions.get(expr).value = result;
    }
  }

  /** Get ordered list of all variable names */
  getOrderedNames() {
    return [...this._order];
  }

  /** Get ordered list of condition expression texts */
  getConditionNames() {
    return [...this._condOrder];
  }

  /** Full snapshot: { name: value_string } for variables only (not conditions) */
  getSnapshot() {
    const snap = {};
    for (const name of this._order) {
      const v = this._vars.get(name).value;
      snap[name] = formatValue(v);
    }
    return snap;
  }

  /** Get ALL condition names and their current values */
  getConditionValues() {
    const conds = {};
    for (const expr of this._condOrder) {
      const v = this._conditions.get(expr).value;
      conds[expr] = v ? 'TRUE' : 'FALSE';
    }
    return conds;
  }
}

function defaultValue(type) {
  switch (type) {
    case 'int': case 'byte': case 'short': case 'long': return 0;
    case 'double': case 'float': return 0.0;
    case 'boolean': return false;
    case 'char': return '\0';
    default: return null;
  }
}

function formatValue(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'string') return v;
  return String(v);
}

// ═══════════════════════════════════════════
// Layer 4: Statement & Assignment Parsing
// ═══════════════════════════════════════════

const TYPE_KEYWORDS = new Set(['int', 'double', 'float', 'long', 'short', 'byte', 'boolean', 'char', 'String']);

/**
 * Parse and execute a single process statement.
 * Returns { changed: boolean } — whether any variable was modified.
 */
function execStatement(text, scope) {
  text = text.trim();

  // Variable declaration: `int x = 5` or `int x`
  const declMatch = text.match(/^(int|double|float|long|short|byte|boolean|char|String)\s+(\w+)\s*(=\s*(.*))?$/);
  if (declMatch) {
    const type = declMatch[1];
    const name = declMatch[2];
    if (declMatch[3]) {
      const rhs = declMatch[4].trim();
      const value = evaluate(rhs, scope);
      scope.declare(name, type, value);
    } else {
      scope.declare(name, type);
    }
    return true;
  }

  // Increment/decrement: `x++` or `x--`
  const incMatch = text.match(/^(\w+)(\+\+|--)$/);
  if (incMatch) {
    const name = incMatch[1];
    const op = incMatch[2];
    const cur = toNum(scope.get(name) || 0);
    const newVal = op === '++' ? cur + 1 : cur - 1;
    scope.set(name, newVal);
    return true;
  }

  // Compound assignment: `x += 5`, `x /= 10`, etc.
  const cmpMatch = text.match(/^(\w+)\s*(\+=|-=|\*=|\/=|%=)\s*(.+)$/);
  if (cmpMatch) {
    const name = cmpMatch[1];
    const op = cmpMatch[2];
    const rhsText = cmpMatch[3].trim();
    const rhs = evaluate(rhsText, scope);
    const cur = toNum(scope.get(name) || 0);
    let newVal;
    switch (op) {
      case '+=': newVal = cur + toNum(rhs); break;
      case '-=': newVal = cur - toNum(rhs); break;
      case '*=': newVal = cur * toNum(rhs); break;
      case '/=': {
        const nRhs = toNum(rhs);
        if (nRhs === 0) throw new EvalError('Division by zero');
        newVal = Math.trunc(cur / nRhs);
        break;
      }
      case '%=': newVal = cur % toNum(rhs); break;
    }
    scope.set(name, newVal);
    return true;
  }

  // Regular assignment: `x = expr`
  const asMatch = text.match(/^(\w+)\s*=\s*(.+)$/);
  if (asMatch) {
    const name = asMatch[1];
    const rhsText = asMatch[2].trim();
    const value = evaluate(rhsText, scope);
    scope.set(name, value);
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════
// Layer 5: Tree-walking Simulator
// ═══════════════════════════════════════════

/**
 * Extract the actual condition from a do-while wrapper string.
 * e.g. 'do { ... } while (x > 0)' -> 'x > 0'
 */
function extractDoCondition(expr) {
  const m = expr.match(/do\s*\{[^}]*\}\s*while\s*\((.+)\)\s*;?\s*$/);
  return m ? m[1] : expr;
}

/**
 * Simulate execution by walking the flowchart AST tree and
 * recording variable/condition changes at each step.
 */
function simulateTree(tree) {
  const scope = new VariableScope();
  const steps = [];
  let output = '';
  let pendingConditions = {};  // conditions evaluated between steps

  function recordStep() {
    const snap = scope.getSnapshot();
    const conds = { ...pendingConditions };
    pendingConditions = {};
    // Only create a step if something meaningful happened
    if (Object.keys(snap).length > 0 || Object.keys(conds).length > 0) {
      steps.push({ vars: snap, conditions: conds });
    }
  }

  function evaluateAndRecordCondition(expr) {
    const result = evaluate(expr, scope);
    const boolResult = !!result;
    scope.recordCondition(expr, boolResult);
    pendingConditions[expr] = boolResult ? 'TRUE' : 'FALSE';
    return boolResult;
  }

  function walkBlock(block) {
    for (const node of block) {
      if (node.type === 'process' || node.type === 'input') {
        execStatement(node.text, scope);
        recordStep();
      } else if (node.type === 'output') {
        const exprText = node.text.replace(/^output\s+/, '').trim();
        try {
          const result = evaluate(exprText, scope);
          output += String(result);
        } catch (e) {
          output += `<error: ${e.message}>`;
        }
        recordStep();
      } else if (node.type === 'decision') {
        const condResult = evaluateAndRecordCondition(node.condition);
        recordStep();

        if (condResult) {
          if (node.trueBranch) walkBlock(node.trueBranch);
        } else {
          if (node.falseBranch && node.falseBranch.length > 0) {
            walkBlock(node.falseBranch);
          }
        }
      } else if (node.type === 'while' || (node.type === 'loop' && !node.condition?.startsWith('do {'))) {
        // while loop
        const maxIter = 1000;
        let iter = 0;
        while (iter < maxIter) {
          const condResult = evaluateAndRecordCondition(node.condition);
          recordStep();
          if (!condResult) break;
          walkBlock(node.body);
          iter++;
        }
      } else if (node.type === 'forloop') {
        // Execute init statement
        if (node.init) {
          execStatement(node.init, scope);
          recordStep();
        }
        const maxIter = 1000;
        let iter = 0;
        while (iter < maxIter) {
          const condResult = evaluateAndRecordCondition(node.condition);
          recordStep();
          if (!condResult) break;
          walkBlock(node.body);
          if (node.update) {
            execStatement(node.update, scope);
            recordStep();
          }
          iter++;
        }
      } else if (node.type === 'loop' && node.condition && node.condition.startsWith('do {')) {
        const maxIter = 1000;
        let iter = 0;
        do {
          walkBlock(node.body);
          iter++;
          if (iter >= maxIter) break;
        } while (evaluateAndRecordCondition(extractDoCondition(node.condition)));
        recordStep();
      }
    }
  }

  try {
    walkBlock(tree);
  } catch (e) {
    return { error: `Simulation error: ${e.message}`, columns: [], steps, output };
  }

  const columns = [];
  for (const name of scope.getOrderedNames()) {
    columns.push({ name, group: 'processing' });
  }
  for (const expr of scope.getConditionNames()) {
    columns.push({ name: expr, group: 'processing', isCondition: true });
  }
  if (output) {
    columns.push({ name: 'Output', group: 'output' });
  }

  return { columns, steps, output, error: null };
}

// ═══════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════

/**
 * Simulate Java code and produce a trace table result.
 * @param {string} code - Raw Java source code
 * @returns {{ columns: Array<{name:string, group:string}>, steps: Array<{vars:object}>, output: string, error: string|null }}
 */
export function simulateJavaCode(code) {
  try {
    const tree = parseJavaCode(code);
    if (!tree || tree.length === 0) {
      return { columns: [], steps: [], output: '', error: 'No code to simulate' };
    }
    return simulateTree(tree);
  } catch (e) {
    return { columns: [], steps: [], output: '', error: `Parse error: ${e.message}` };
  }
}

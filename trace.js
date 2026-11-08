export class TraceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TraceError';
  }
}

const TOKEN = /\d+|[A-Za-z_$][\w$]*|\+\+|--|\+=|-=|<=|>=|==|!=|[{}();=+\-*/%<>.]/y;
const COMPARISONS = new Set(['<', '<=', '>', '>=', '==', '!=']);

function lex(source) {
  const tokens = [];
  let i = 0;
  while (i < source.length) {
    if (/\s/.test(source[i])) { i++; continue; }
    if (source.startsWith('//', i)) {
      i = source.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw new TraceError('多行注释没有结束。');
      i = end + 2;
      continue;
    }
    TOKEN.lastIndex = i;
    const match = TOKEN.exec(source);
    if (!match) throw new TraceError(`暂不支持第 ${i + 1} 个字符附近的写法：${source.slice(i, i + 12)}`);
    tokens.push({ value: match[0], start: i, end: TOKEN.lastIndex });
    i = TOKEN.lastIndex;
  }
  return tokens;
}

class Parser {
  constructor(source) {
    this.source = source;
    this.tokens = lex(source);
    this.pos = 0;
  }

  peek() { return this.tokens[this.pos]?.value; }
  eat(value) { if (this.peek() === value) { this.pos++; return true; } return false; }
  expect(value) {
    if (!this.eat(value)) throw new TraceError(`这里应为“${value}”，实际看到“${this.peek() ?? '代码结束'}”。`);
  }
  identifier() {
    const value = this.peek();
    if (!value || !/^[A-Za-z_$][\w$]*$/.test(value) || ['int', 'for'].includes(value)) {
      throw new TraceError(`这里需要变量名，实际看到“${value ?? '代码结束'}”。`);
    }
    this.pos++;
    return value;
  }
  text(from) {
    const first = this.tokens[from];
    const last = this.tokens[this.pos - 1];
    return first && last ? this.source.slice(first.start, last.end).trim() : '';
  }

  primary() {
    if (this.eat('(')) {
      const node = this.expression();
      this.expect(')');
      return node;
    }
    const value = this.peek();
    if (/^\d+$/.test(value ?? '')) {
      this.pos++;
      return { kind: 'number', value: Number(value) };
    }
    if (/^[A-Za-z_$][\w$]*$/.test(value ?? '') && !['int', 'for'].includes(value)) {
      this.pos++;
      return { kind: 'variable', name: value };
    }
    throw new TraceError(`这里需要数字、变量或括号，实际看到“${value ?? '代码结束'}”。`);
  }
  unary() {
    if (this.eat('-')) return { kind: 'unary', op: '-', value: this.unary() };
    if (this.eat('+')) return this.unary();
    return this.primary();
  }
  multiplicative() {
    let left = this.unary();
    while (['*', '/', '%'].includes(this.peek())) {
      const op = this.peek(); this.pos++;
      left = { kind: 'binary', op, left, right: this.unary() };
    }
    return left;
  }
  expression() {
    let left = this.multiplicative();
    while (['+', '-'].includes(this.peek())) {
      const op = this.peek(); this.pos++;
      left = { kind: 'binary', op, left, right: this.multiplicative() };
    }
    return left;
  }
  condition() {
    const start = this.pos;
    const left = this.expression();
    const op = this.peek();
    if (!COMPARISONS.has(op)) throw new TraceError('循环条件需使用 <、<=、>、>=、== 或 != 比较两个整数表达式。');
    this.pos++;
    const right = this.expression();
    return { left, op, right, source: this.text(start) };
  }
  action({ allowDeclaration = false } = {}) {
    const start = this.pos;
    const declare = this.eat('int');
    if (declare && !allowDeclaration) throw new TraceError('首版暂不支持在循环体或更新语句中声明新变量。');
    const name = this.identifier();
    const op = this.peek();
    if (!['=', '+=', '-=', '++', '--'].includes(op)) throw new TraceError(`变量 ${name} 后只支持 =、+=、-=、++ 或 --。`);
    this.pos++;
    if (declare && op !== '=') throw new TraceError('声明变量时请写成 int 变量名 = 整数表达式。');
    const expr = ['++', '--'].includes(op) ? null : this.expression();
    return { kind: 'action', name, op, expr, declare, source: this.text(start) };
  }
  statement() {
    if (this.peek() === 'System') {
      const start = this.pos;
      this.expect('System'); this.expect('.'); this.expect('out'); this.expect('.');
      this.expect('println'); this.expect('(');
      const expr = this.expression();
      this.expect(')'); this.expect(';');
      return { kind: 'print', expr, source: this.text(start) };
    }
    const result = this.action();
    this.expect(';');
    return result;
  }
  program() {
    const setup = [];
    while (this.peek() === 'int') {
      setup.push(this.action({ allowDeclaration: true }));
      this.expect(';');
    }
    this.expect('for'); this.expect('(');
    const init = this.action({ allowDeclaration: true }); this.expect(';');
    const condition = this.condition(); this.expect(';');
    const update = this.action(); this.expect(')');
    this.expect('{');
    const body = [];
    while (this.peek() !== '}' && this.peek() !== undefined) body.push(this.statement());
    this.expect('}');
    if (this.peek() !== undefined) throw new TraceError('首版只支持一段初始化代码和一个 for 循环。');
    if (update.name !== init.name) throw new TraceError('首版要求更新语句修改 for 初始化的同一个变量。');
    return { setup, init, condition, update, body };
  }
}

function checked(value) {
  if (!Number.isSafeInteger(value) || value < -2147483648 || value > 2147483647) {
    throw new TraceError('计算结果超出首版支持的 Java int 范围。');
  }
  return value;
}

function evaluate(node, env) {
  if (node.kind === 'number') return checked(node.value);
  if (node.kind === 'variable') {
    if (!(node.name in env)) throw new TraceError(`变量 ${node.name} 尚未声明或超出首版支持范围。`);
    return env[node.name];
  }
  if (node.kind === 'unary') return checked(-evaluate(node.value, env));
  const left = evaluate(node.left, env), right = evaluate(node.right, env);
  switch (node.op) {
    case '+': return checked(left + right);
    case '-': return checked(left - right);
    case '*': return checked(left * right);
    case '/':
      if (right === 0) throw new TraceError('出现除以 0，已停止追踪。');
      return checked(Math.trunc(left / right));
    case '%':
      if (right === 0) throw new TraceError('出现模 0，已停止追踪。');
      return checked(left % right);
    default: throw new TraceError(`不支持运算符 ${node.op}。`);
  }
}

function judge(condition, env) {
  const left = evaluate(condition.left, env), right = evaluate(condition.right, env);
  const match = {
    '<': left < right, '<=': left <= right, '>': left > right,
    '>=': left >= right, '==': left === right, '!=': left !== right,
  }[condition.op];
  return { result: match, left, right };
}

function apply(action, env) {
  if (action.declare && action.name in env) throw new TraceError(`变量 ${action.name} 重复声明。`);
  if (!action.declare && !(action.name in env)) throw new TraceError(`变量 ${action.name} 尚未声明。`);
  const before = env[action.name];
  const value = action.expr ? evaluate(action.expr, env) : undefined;
  let after;
  switch (action.op) {
    case '=': after = value; break;
    case '+=': after = checked(before + value); break;
    case '-=': after = checked(before - value); break;
    case '++': after = checked(before + 1); break;
    case '--': after = checked(before - 1); break;
  }
  env[action.name] = after;
  return action.declare ? `${action.source}，${action.name} 初值为 ${after}` : `${action.source}，${action.name} 从 ${before} 变为 ${after}`;
}

export function traceJavaFor(source) {
  if (typeof source !== 'string' || !source.trim()) throw new TraceError('请先输入一段 Java for 循环代码。');
  if (source.length > 5000) throw new TraceError('代码过长，请只粘贴一个简短的 for 循环。');
  const plan = new Parser(source).program();
  const env = Object.create(null);
  for (const action of plan.setup) apply(action, env);
  apply(plan.init, env);
  const variables = Object.keys(env);
  if (variables.length > 4) throw new TraceError('首版最多追踪 4 个整数变量。');
  const rows = [];
  let finalCondition;
  while (true) {
    const condition = judge(plan.condition, env);
    finalCondition = `${condition.left} ${plan.condition.op} ${condition.right} → ${condition.result ? '真' : '假'}`;
    if (!condition.result) break;
    if (rows.length >= 50) throw new TraceError('已超过 50 轮，可能是无限循环；请缩小范围或检查更新语句。');
    const before = { ...env };
    const actions = [], output = [];
    for (const statement of plan.body) {
      if (statement.kind === 'print') {
        const value = evaluate(statement.expr, env);
        output.push(value);
        actions.push(`${statement.source}，输出 ${value}`);
      } else actions.push(apply(statement, env));
    }
    const afterBody = { ...env };
    const update = apply(plan.update, env);
    const afterUpdate = { ...env };
    const values = variables.map(name => `${name}=${before[name]}`).join('、');
    const explanation = `第 ${rows.length + 1} 轮：进入时 ${values}；判断 ${condition.left} ${plan.condition.op} ${condition.right} 为真；${actions.length ? actions.join('；') + '；' : '循环体没有操作；'}${update}。`;
    rows.push({ round: rows.length + 1, condition: `${condition.left} ${plan.condition.op} ${condition.right}`, before, afterBody, afterUpdate, output, actions, update, explanation });
  }
  return { variables, loopVar: plan.init.name, rows, final: { values: { ...env }, condition: finalCondition }, source: source.trim() };
}

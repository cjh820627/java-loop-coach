import { traceJavaFor, TraceError } from './trace.js';

const examples = {
  sum: `int sum = 0;\nfor (int i = 1; i <= 5; i++) {\n    sum += i;\n}`,
  step: `int count = 0;\nfor (int i = 0; i < 6; i += 2) {\n    count += 1;\n    System.out.println(i);\n}`,
  down: `for (int i = 3; i >= 1; i--) {\n    System.out.println(i);\n}`,
};

const $ = id => document.getElementById(id);
const SVG_NS = 'http://www.w3.org/2000/svg';
let trace = null;
let selected = 0;
let aiEnabled = false;

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}

function values(env, names) { return names.map(name => `${name} = ${env[name]}`).join(' · '); }

function svg(tag, attrs = {}, content) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  if (content !== undefined) node.textContent = String(content);
  return node;
}

function setupChart() {
  const picker = $('chart-variable');
  picker.replaceChildren();
  $('chart-card').hidden = trace.rows.length === 0;
  if (!trace.rows.length) return;
  for (const name of trace.variables) picker.append(el('option', name));
  picker.value = trace.variables.find(name => name !== trace.loopVar) || trace.loopVar;
}

function renderChart() {
  if (!trace?.rows.length) return;
  const name = $('chart-variable').value;
  const chart = $('variable-chart');
  chart.replaceChildren();
  const compact = window.matchMedia('(max-width: 720px)').matches;
  chart.setAttribute('viewBox', compact ? '0 0 360 235' : '0 0 800 270');
  chart.setAttribute('aria-label', `${name} 在每轮循环体执行后的变化图`);
  const values = trace.rows.map(row => row.afterBody[name]);
  let min = Math.min(0, ...values), max = Math.max(0, ...values);
  if (min === max) { min -= 1; max += 1; }
  const left = compact ? 43 : 70, right = compact ? 335 : 760;
  const top = compact ? 30 : 34, bottom = compact ? 179 : 218;
  const x = index => values.length === 1 ? (left + right) / 2 : left + index * (right - left) / (values.length - 1);
  const y = value => bottom - (value - min) * (bottom - top) / (max - min);
  for (const tick of [...new Set([min, 0, max])].sort((a, b) => a - b)) {
    const yy = y(tick);
    chart.append(svg('line', { x1: left, y1: yy, x2: right, y2: yy, class: 'chart-grid' }));
    chart.append(svg('text', { x: left - 12, y: yy + 4, 'text-anchor': 'end' }, tick));
  }
  chart.append(svg('line', { x1: left, y1: top, x2: left, y2: bottom, class: 'chart-axis' }));
  chart.append(svg('line', { x1: left, y1: bottom, x2: right, y2: bottom, class: 'chart-axis' }));
  const tickIndexes = [...new Set([0, Math.floor((values.length - 1) / 2), values.length - 1])];
  for (const index of tickIndexes) chart.append(svg('text', { x: x(index), y: bottom + 24, 'text-anchor': 'middle' }, index + 1));
  chart.append(svg('text', { x: right, y: bottom + 43, 'text-anchor': 'end' }, '轮次'));
  if (values.length > 1) chart.append(svg('polyline', { points: values.map((value, index) => `${x(index)},${y(value)}`).join(' '), class: 'chart-line' }));
  values.forEach((value, index) => {
    const dot = svg('circle', { cx: x(index), cy: y(value), r: index === selected ? (compact ? 9 : 7) : (compact ? 8 : 6), class: `chart-dot${index === selected ? ' active' : ''}`, tabindex: 0, role: 'button', 'aria-label': `第 ${index + 1} 轮，${name} 为 ${value}` });
    dot.addEventListener('click', () => chooseRow(index));
    dot.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseRow(index); } });
    chart.append(dot);
  });
  chart.append(svg('text', { x: Math.max(left + 20, Math.min(right - 20, x(selected))), y: Math.max(20, y(values[selected]) - 16), class: 'chart-point-label', 'text-anchor': 'middle' }, `${name}=${values[selected]}`));
  $('chart-caption').textContent = `第 ${selected + 1} 轮循环体执行后：${name} = ${values[selected]}。`;
}

function showError(message) {
  $('error-message').textContent = message;
  $('error-message').hidden = !message;
}

function buildTable() {
  const head = $('trace-table').querySelector('thead');
  const body = $('trace-table').querySelector('tbody');
  head.replaceChildren(); body.replaceChildren();
  const header = el('tr');
  for (const name of ['轮次', '条件', ...trace.variables.flatMap(v => [`${v} 进入`, `${v} 体后`, `${v} 更新后`]), '输出']) header.append(el('th', name));
  head.append(header);
  trace.rows.forEach((row, index) => {
    const tr = el('tr');
    tr.tabIndex = 0;
    tr.setAttribute('aria-label', `查看第 ${row.round} 轮`);
    tr.addEventListener('click', () => chooseRow(index));
    tr.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseRow(index); } });
    tr.append(el('td', row.round));
    tr.append(el('td', `${row.condition} ✓`, 'condition-true'));
    for (const name of trace.variables) {
      tr.append(el('td', row.before[name]));
      tr.append(el('td', row.afterBody[name], row.afterBody[name] !== row.before[name] ? 'changed' : ''));
      tr.append(el('td', row.afterUpdate[name], row.afterUpdate[name] !== row.afterBody[name] ? 'changed' : ''));
    }
    tr.append(el('td', row.output.length ? row.output.join('、') : '—'));
    body.append(tr);
  });
  $('round-count').textContent = `${trace.rows.length} 轮`;
  $('stop-note').textContent = `结束：再次判断 ${trace.final.condition}，循环停止。`;
}

function stage(title, description) {
  const node = el('div', undefined, 'stage');
  node.append(el('strong', title), el('p', description));
  return node;
}

function chooseRow(index) {
  selected = index;
  const row = trace.rows[index];
  [...$('trace-table').querySelectorAll('tbody tr')].forEach((tr, i) => tr.classList.toggle('selected', i === index));
  $('detail-title').textContent = `第 ${row.round} 轮`;
  $('detail-stages').replaceChildren(
    stage('01 判断条件', `${row.condition} → 真`),
    stage('02 进入与执行', `${values(row.before, trace.variables)} → ${values(row.afterBody, trace.variables)}`),
    stage('03 更新后', values(row.afterUpdate, trace.variables)),
  );
  $('plain-explanation').textContent = row.explanation;
  $('prev-round').disabled = index === 0;
  $('next-round').disabled = index === trace.rows.length - 1;
  $('ai-explanation').textContent = '';
  renderChart();
}

function setupQuiz() {
  if (!trace.rows.length) {
    $('quiz-question').textContent = '循环一次也没有执行。试试调整条件，观察为什么。';
    $('quiz-form').hidden = true;
    return;
  }
  $('quiz-form').hidden = false;
  const index = trace.rows.length >= 2 ? 1 : 0;
  const other = trace.variables.find(v => v !== trace.loopVar && trace.rows[index].afterBody[v] !== trace.rows[index].before[v]);
  const target = other || trace.loopVar;
  const phase = other ? '循环体执行后' : '更新语句执行后';
  $('quiz-question').textContent = `第 ${index + 1} 轮${phase}，${target} 是多少？先自己算一遍。`;
  $('quiz-form').dataset.expected = String(other ? trace.rows[index].afterBody[target] : trace.rows[index].afterUpdate[target]);
  $('quiz-answer').value = '';
  $('quiz-feedback').textContent = '';
  $('quiz-feedback').className = 'quiz-feedback';
}

function run() {
  try {
    trace = traceJavaFor($('code-input').value);
    showError('');
    $('empty-state').hidden = true;
    $('results').hidden = false;
    buildTable();
    setupChart();
    if (trace.rows.length) chooseRow(0);
    else {
      $('detail-title').textContent = '循环未执行';
      $('detail-stages').replaceChildren(stage('首次判断', trace.final.condition));
      $('plain-explanation').textContent = '循环条件第一次就是假，因此没有进入循环体，也没有执行更新语句。';
      $('prev-round').disabled = true; $('next-round').disabled = true;
      $('ai-explanation').textContent = '';
    }
    $('ai-button').disabled = !aiEnabled || !trace.rows.length;
    setupQuiz();
  } catch (error) {
    trace = null;
    $('results').hidden = true;
    $('empty-state').hidden = false;
    showError(error instanceof TraceError ? error.message : '解析失败，请检查输入。');
  }
}

async function explainWithAi() {
  if (!trace || !aiEnabled || !trace.rows.length) return;
  const button = $('ai-button');
  const index = selected;
  button.disabled = true;
  $('ai-explanation').textContent = '正在生成讲解…';
  try {
    const response = await fetch('/api/explain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: trace.source, rowIndex: index }) });
    const data = await response.json();
    if (selected === index) $('ai-explanation').textContent = response.ok ? data.explanation : data.error || 'AI 讲解暂不可用。';
  } catch {
    if (selected === index) $('ai-explanation').textContent = '网络连接失败，请稍后重试。';
  } finally { button.disabled = false; }
}

document.querySelectorAll('[data-example]').forEach(button => button.addEventListener('click', () => {
  $('code-input').value = examples[button.dataset.example];
  run();
}));
$('run-button').addEventListener('click', run);
$('prev-round').addEventListener('click', () => { if (selected > 0) chooseRow(selected - 1); });
$('next-round').addEventListener('click', () => { if (trace && selected < trace.rows.length - 1) chooseRow(selected + 1); });
$('ai-button').addEventListener('click', explainWithAi);
$('chart-variable').addEventListener('change', renderChart);
window.matchMedia('(max-width: 720px)').addEventListener('change', renderChart);
$('quiz-form').addEventListener('submit', event => {
  event.preventDefault();
  const answer = Number($('quiz-answer').value);
  const expected = Number($('quiz-form').dataset.expected);
  const correct = Number.isSafeInteger(answer) && answer === expected;
  $('quiz-feedback').textContent = correct ? '答案正确。试着再说明变量为什么变成这个值。' : `再对照表格看看：这一格的正确值是 ${expected}。`;
  $('quiz-feedback').className = `quiz-feedback ${correct ? 'correct' : 'wrong'}`;
});

if (!document.body.hasAttribute('data-static')) {
  fetch('/api/status').then(r => r.json()).then(data => {
    aiEnabled = Boolean(data.aiEnabled);
    $('ai-status').textContent = aiEnabled ? '已接入 DeepSeek' : '未配置 API，其他功能可用';
    $('ai-button').disabled = !aiEnabled || !trace?.rows.length;
  }).catch(() => { $('ai-status').textContent = '本地服务未连接'; });
}
run();

import { traceJavaFor, TraceError } from './trace.js';

const examples = {
  sum: `int sum = 0;\nfor (int i = 1; i <= 5; i++) {\n    sum += i;\n}`,
  step: `int count = 0;\nfor (int i = 0; i < 6; i += 2) {\n    count += 1;\n    System.out.println(i);\n}`,
  down: `for (int i = 3; i >= 1; i--) {\n    System.out.println(i);\n}`,
};

const $ = id => document.getElementById(id);
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

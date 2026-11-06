(() => {
'use strict';

const cfg = window.APP_CONFIG || {};
const app = document.getElementById('app');
const topbar = document.getElementById('topbar');
const dlg = document.getElementById('qdlg');

let sb = null, session = null;
let tab = 'overview';
let units = [];
let qs = { unit: '', search: '', page: 0, total: 0, rows: [] };
let students = [];
let importRows = null;
const PAGE = 25;

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unitTitle = id => (units.find(u => u.id === id) || {}).title || ('Unit ' + id);
const fmtDate = d => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const loading = (m = 'Loading…') => { app.innerHTML = `<div class="center muted">${esc(m)}</div>`; };
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 4500);
}
const errMsg = e => (e && e.message) || String(e);

/* ---------- top bar ---------- */
function renderTopbar() {
  const tabs = [['overview', 'Overview'], ['questions', 'Questions'], ['import', 'Import'], ['units', 'Units'], ['students', 'Students']];
  topbar.innerHTML = `
    <div class="brand"><span class="dot sa">सं</span>Admin</div>
    ${tabs.map(([k, l]) => `<button class="btn sm ${tab === k ? 'primary' : 'ghost'}" data-act="tab" data-t="${k}">${l}</button>`).join('')}
    <span style="margin-left:auto"></span>
    <a class="btn sm" href="./">Student site</a>
    <button class="btn sm" data-act="logout">Log out</button>`;
}

function message(title, text, withLink = true) {
  topbar.innerHTML = `<div class="brand"><span class="dot sa">सं</span>Admin</div>`;
  app.innerHTML = `<div class="card auth"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p>
    ${withLink ? '<a class="btn primary" href="./">Go to the student site</a>' : ''}</div>`;
}

/* ---------- overview ---------- */
async function showOverview() {
  loading();
  const { data, error } = await sb.rpc('admin_stats');
  if (error) return message('Error', errMsg(error), false);
  units = data.units;
  const low = data.units.filter(u => u.n < 10);
  app.innerHTML = `
    <h1>Overview</h1>
    <div class="stats">
      <div class="stat big"><b>${data.students}</b><span>Students</span></div>
      <div class="stat"><b>${data.attempts}</b><span>Tests taken</span></div>
      <div class="stat"><b>${data.attempts_7d}</b><span>Tests in last 7 days</span></div>
      <div class="stat"><b>${data.questions}</b><span>Questions in bank</span></div>
    </div>
    ${low.length ? `<div class="banner"><div><b>Question bank needs more questions</b><br>
      <span class="muted small">Full mocks take 10 questions from every unit. Units with fewer than 10: ${low.map(u => esc(u.title) + ' (' + u.n + ')').join(', ')}</span></div>
      <button class="btn primary" data-act="tab" data-t="import">Import questions</button></div>` : ''}
    <h2 class="section-title">Questions per unit</h2>
    <div class="card"><div class="tablewrap"><table><thead><tr><th>#</th><th>Unit</th><th>Questions</th></tr></thead><tbody>
      ${data.units.map(u => `<tr><td>${u.id}</td><td>${esc(u.title)}</td><td>${u.n}${u.n < 10 ? ' <span class="muted small">(low)</span>' : ''}</td></tr>`).join('')}
    </tbody></table></div></div>
    <h2 class="section-title">Latest attempts</h2>
    <div class="card">${data.recent.length ? `<div class="tablewrap"><table><thead><tr><th>Student</th><th>Test</th><th>Score</th><th>When</th></tr></thead><tbody>
      ${data.recent.map(r => `<tr><td>${esc(r.name)}</td><td>${r.unit == null ? 'Full mock' : esc(unitTitle(r.unit))}</td><td>${r.score} / ${r.total * 2}</td><td class="small muted">${fmtDate(r.created_at)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted" style="margin:0">No attempts yet.</p>'}</div>`;
}

/* ---------- questions ---------- */
async function showQuestions(keepScroll = false) {
  if (!units.length) { const u = await sb.rpc('admin_stats'); if (u.data) units = u.data.units; }
  const { data, error } = await sb.rpc('admin_list_questions', {
    p_unit: qs.unit === '' ? null : Number(qs.unit), p_search: qs.search || null, p_limit: PAGE, p_offset: qs.page * PAGE });
  if (error) return message('Error', errMsg(error), false);
  qs.total = Number(data.total); qs.rows = data.rows;
  const pages = Math.max(1, Math.ceil(qs.total / PAGE));
  app.innerHTML = `
    <div class="test-head"><h1 style="margin:0">Questions <span class="muted small">(${qs.total})</span></h1>
      <span style="margin-left:auto"></span>
      <button class="btn primary" data-act="addq">+ Add question</button></div>
    <div class="card" style="margin-top:14px">
      <div class="toolbar">
        <select id="f-unit" aria-label="Filter by unit"><option value="">All units</option>
          ${units.map(u => `<option value="${u.id}" ${String(qs.unit) === String(u.id) ? 'selected' : ''}>${esc(u.title)}</option>`).join('')}</select>
        <input id="f-search" type="text" placeholder="Search question text…" value="${esc(qs.search)}">
        <button class="btn" data-act="search">Search</button>
      </div>
      ${qs.rows.length ? `<div class="tablewrap"><table><thead><tr><th>ID</th><th>Unit</th><th>Question</th><th>Ans</th><th></th></tr></thead><tbody>
        ${qs.rows.map(r => `<tr>
          <td class="muted small">${r.id}</td><td class="small">${esc(unitTitle(r.unit))}</td>
          <td class="sa qcell">${esc(r.question)}</td><td><b>${esc(r.correct)}</b></td>
          <td style="white-space:nowrap"><button class="btn sm" data-act="editq" data-id="${r.id}">Edit</button>
            <button class="btn sm" data-act="delq" data-id="${r.id}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>
      <div class="actions"><button class="btn sm" data-act="qprev" ${qs.page === 0 ? 'disabled' : ''}>Previous</button>
        <span class="muted small" style="align-self:center">Page ${qs.page + 1} of ${pages}</span>
        <button class="btn sm" data-act="qnext" ${qs.page + 1 >= pages ? 'disabled' : ''}>Next</button></div>`
      : '<p class="muted center">No questions found. Add one, or use the Import tab.</p>'}
    </div>`;
}

function openQuestionDialog(q) {
  const v = q || { unit: qs.unit || 1, question: '', option_a: '', option_b: '', option_c: '', option_d: '', correct: 'A', explanation: '' };
  dlg.innerHTML = `
    <form id="qform" method="dialog">
      <h2>${q ? 'Edit question #' + q.id : 'Add question'}</h2>
      <input type="hidden" name="id" value="${q ? q.id : ''}">
      <label class="f">Unit</label>
      <select name="unit">${units.map(u => `<option value="${u.id}" ${Number(v.unit) === u.id ? 'selected' : ''}>${esc(u.title)}</option>`).join('')}</select>
      <label class="f">Question</label>
      <textarea name="question" rows="3" required class="sa">${esc(v.question)}</textarea>
      ${['a', 'b', 'c', 'd'].map(k => `<label class="f">Option ${k.toUpperCase()}</label>
        <input type="text" name="option_${k}" value="${esc(v['option_' + k])}" required class="sa">`).join('')}
      <label class="f">Correct answer</label>
      <select name="correct">${['A', 'B', 'C', 'D'].map(k => `<option ${v.correct === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <label class="f">Explanation (optional)</label>
      <textarea name="explanation" rows="2" class="sa">${esc(v.explanation || '')}</textarea>
      <div id="qerr" class="err" role="alert"></div>
      <div class="actions"><button class="btn primary" type="submit">Save</button>
        <button class="btn" type="button" data-act="closedlg">Cancel</button></div>
    </form>`;
  dlg.showModal();
}

async function saveQuestion(form) {
  const f = new FormData(form);
  const btn = form.querySelector('button[type=submit]'); btn.disabled = true;
  const { error } = await sb.rpc('admin_save_question', {
    p_id: f.get('id') ? Number(f.get('id')) : null, p_unit: Number(f.get('unit')),
    p_question: f.get('question'), p_a: f.get('option_a'), p_b: f.get('option_b'),
    p_c: f.get('option_c'), p_d: f.get('option_d'), p_correct: f.get('correct'), p_expl: f.get('explanation') });
  btn.disabled = false;
  if (error) { document.getElementById('qerr').textContent = errMsg(error); return; }
  dlg.close(); toast('Question saved'); showQuestions();
}

/* ---------- import ---------- */
function parseCSV(text, delim) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], cur = '', inQ = false;
  const push = () => { row.push(cur); cur = ''; };
  const endRow = () => { push(); if (row.some(x => x.trim() !== '')) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) push();
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; endRow(); }
    else cur += c;
  }
  if (cur !== '' || row.length) endRow();
  return rows;
}

function showImport() {
  importRows = null;
  app.innerHTML = `
    <h1>Import questions</h1>
    <div class="card">
      <p>Upload a <b>CSV file (UTF-8)</b> with these column headings in the first row:</p>
      <p><code>unit, question, option_a, option_b, option_c, option_d, correct, explanation</code></p>
      <p class="muted small">unit is the number 1 to 10. correct is A, B, C or D. explanation is optional.
        In Excel use <i>Save As → CSV UTF-8</i> so Sanskrit text is kept correctly.</p>
      <div class="actions" style="margin-top:0">
        <button class="btn" data-act="template">Download template</button>
        <input id="csvfile" type="file" accept=".csv,text/csv">
      </div>
      <div id="importbox"></div>
    </div>`;
}

function handleFile(file) {
  const box = document.getElementById('importbox');
  const reader = new FileReader();
  reader.onload = () => {
    let text = String(reader.result);
    const head = text.split(/\r?\n/, 1)[0];
    const delim = head.includes(',') ? ',' : (head.includes(';') ? ';' : (head.includes('\t') ? '\t' : ','));
    const rows = parseCSV(text, delim);
    if (rows.length < 2) { box.innerHTML = '<div class="err">The file has no data rows.</div>'; return; }
    const header = rows[0].map(h => h.trim().toLowerCase());
    const need = ['unit', 'question', 'option_a', 'option_b', 'option_c', 'option_d', 'correct'];
    const missing = need.filter(n => !header.includes(n));
    if (missing.length) { box.innerHTML = `<div class="err">Missing column(s): ${esc(missing.join(', '))}</div>`; return; }
    importRows = rows.slice(1).map(r => {
      const o = {}; header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); }); return o;
    });
    box.innerHTML = `
      <p style="margin-top:16px"><b>${importRows.length}</b> question${importRows.length === 1 ? '' : 's'} found. Preview of the first 3:</p>
      <div class="tablewrap"><table><thead><tr><th>Unit</th><th>Question</th><th>Ans</th></tr></thead><tbody>
        ${importRows.slice(0, 3).map(r => `<tr><td>${esc(r.unit)}</td><td class="sa qcell">${esc(r.question)}</td><td>${esc(r.correct)}</td></tr>`).join('')}
      </tbody></table></div>
      <div class="actions"><button class="btn primary" data-act="doimport">Import ${importRows.length} questions</button></div>`;
  };
  reader.readAsText(file, 'utf-8');
}

async function doImport(btn) {
  if (!importRows) return;
  const box = document.getElementById('importbox');
  btn.disabled = true;
  let inserted = 0; const errors = [];
  const CHUNK = 200;
  for (let i = 0; i < importRows.length; i += CHUNK) {
    box.querySelector('.actions').innerHTML = `<span class="muted">Importing… ${Math.min(i + CHUNK, importRows.length)} / ${importRows.length}</span>`;
    const part = importRows.slice(i, i + CHUNK);
    const { data, error } = await sb.rpc('admin_import_questions', { p_rows: part });
    if (error) { errors.push({ row: i + 1, error: errMsg(error) }); break; }
    inserted += data.inserted;
    data.errors.forEach(e => errors.push({ row: i + e.row, error: e.error }));
  }
  importRows = null;
  box.innerHTML = `
    <p style="margin-top:16px"><b style="color:var(--ok)">${inserted} imported.</b>
      ${errors.length ? `<b style="color:var(--bad)"> ${errors.length} skipped.</b>` : ''}</p>
    ${errors.length ? `<div class="tablewrap"><table><thead><tr><th>Data row</th><th>Problem</th></tr></thead><tbody>
      ${errors.slice(0, 50).map(e => `<tr><td>${e.row}</td><td>${esc(e.error)}</td></tr>`).join('')}</tbody></table></div>
      <p class="muted small">Row numbers count the first question as row 1. Fix those rows in your file and import only them again.</p>` : ''}
    <div class="actions"><button class="btn primary" data-act="tab" data-t="questions">View questions</button>
      <button class="btn" data-act="tab" data-t="import">Import another file</button></div>`;
}

function downloadTemplate() {
  const csv = '﻿unit,question,option_a,option_b,option_c,option_d,correct,explanation\n' +
    '1,"Sample question text?",Option A,Option B,Option C,Option D,B,"Why B is correct"\n';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'questions_template.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- units ---------- */
async function showUnits() {
  loading();
  const { data, error } = await sb.rpc('admin_stats');
  if (error) return message('Error', errMsg(error), false);
  units = data.units;
  app.innerHTML = `
    <h1>Unit names</h1>
    <p class="muted">These names appear on the student dashboard, tests and leaderboard.</p>
    <div class="card">${units.map(u => `
      <div class="toolbar" data-unitrow="${u.id}">
        <b style="width:28px">${u.id}</b>
        <input type="text" class="sa" maxlength="80" value="${esc(u.title)}" aria-label="Name of unit ${u.id}">
        <button class="btn sm" data-act="saveunit" data-id="${u.id}">Save</button>
      </div>`).join('')}</div>`;
}

async function saveUnit(btn) {
  const id = Number(btn.dataset.id);
  const val = btn.closest('[data-unitrow]').querySelector('input').value;
  btn.disabled = true;
  const { error } = await sb.rpc('admin_rename_unit', { p_id: id, p_title: val });
  btn.disabled = false;
  if (error) return toast(errMsg(error));
  const u = units.find(x => x.id === id); if (u) u.title = val.trim();
  toast('Unit ' + id + ' renamed');
}

/* ---------- students ---------- */
async function showStudents() {
  loading();
  const { data, error } = await sb.rpc('admin_list_students');
  if (error) return message('Error', errMsg(error), false);
  students = data;
  app.innerHTML = `
    <div class="test-head"><h1 style="margin:0">Students <span class="muted small">(${students.length})</span></h1>
      <input id="s-search" type="text" placeholder="Search name or email…" style="max-width:280px;margin-left:auto"></div>
    <div class="card" style="margin-top:14px"><div class="tablewrap"><table><thead><tr>
      <th>Name</th><th>Email</th><th>Joined</th><th>Tests</th><th>Best %</th><th>Last active</th></tr></thead>
      <tbody id="stbody"></tbody></table></div></div>`;
  renderStudentRows('');
}
function renderStudentRows(q) {
  q = q.trim().toLowerCase();
  const list = students.filter(s => !q || (s.name || '').toLowerCase().includes(q) || (s.email || '').toLowerCase().includes(q));
  document.getElementById('stbody').innerHTML = list.length ? list.map(s => `<tr>
    <td>${esc(s.name)}</td><td class="small">${esc(s.email)}</td><td class="small muted">${fmtDate(s.joined)}</td>
    <td>${s.attempts}</td><td>${s.best_pct ?? '—'}</td><td class="small muted">${fmtDate(s.last_active)}</td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">No students found.</td></tr>';
}

/* ---------- navigation & events ---------- */
function go(t) {
  tab = t; renderTopbar();
  if (t === 'overview') showOverview();
  else if (t === 'questions') { qs.page = 0; showQuestions(); }
  else if (t === 'import') showImport();
  else if (t === 'units') showUnits();
  else if (t === 'students') showStudents();
}

const actions = {
  tab: el => go(el.dataset.t),
  logout: async () => { await sb.auth.signOut(); location.href = './'; },
  addq: () => openQuestionDialog(null),
  editq: el => openQuestionDialog(qs.rows.find(r => r.id === Number(el.dataset.id))),
  delq: async el => {
    if (!confirm('Delete this question permanently?\n\nPast student attempts will no longer show it in their review.')) return;
    const { error } = await sb.rpc('admin_delete_question', { p_id: Number(el.dataset.id) });
    if (error) return toast(errMsg(error));
    toast('Question deleted'); showQuestions();
  },
  closedlg: () => dlg.close(),
  search: () => {
    qs.unit = document.getElementById('f-unit').value;
    qs.search = document.getElementById('f-search').value; qs.page = 0; showQuestions();
  },
  qprev: () => { if (qs.page > 0) { qs.page--; showQuestions(); } },
  qnext: () => { qs.page++; showQuestions(); },
  template: downloadTemplate,
  doimport: el => doImport(el),
  saveunit: el => saveUnit(el)
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const f = actions[el.dataset.act];
  if (f) { e.preventDefault(); f(el); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'csvfile' && e.target.files[0]) handleFile(e.target.files[0]);
  if (e.target.id === 'f-unit') actions.search();
});
document.addEventListener('input', e => { if (e.target.id === 's-search') renderStudentRows(e.target.value); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'f-search') actions.search(); });
document.addEventListener('submit', e => { if (e.target.id === 'qform') { e.preventDefault(); saveQuestion(e.target); } });

/* ---------- start-up ---------- */
async function init() {
  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.startsWith('YOUR_')) {
    return message('Not configured', 'Supabase settings are missing in config.js.', false);
  }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  session = data.session;
  if (!session) return message('Please log in', 'Log in on the student site with your admin account, then open this page again.');
  const { data: ok, error } = await sb.rpc('is_admin');
  if (error || !ok) return message('Not authorised', 'This account is not an admin.');
  go('overview');
}
init();
})();

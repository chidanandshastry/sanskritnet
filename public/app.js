(() => {
'use strict';

const cfg = window.APP_CONFIG || {};
const app = document.getElementById('app');
const topbar = document.getElementById('topbar');

let sb = null;
let session = null;
let units = [];
let test = null;          // test in progress
let timer = null;
let authMode = 'login';
let lastResult = null;
let reviewFilter = 'all';

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unitTitle = id => (units.find(u => u.id === id) || {}).title || ('Unit ' + id);
const testName = unit => unit == null ? 'Full Mock Test' : unitTitle(unit);
const fmtTime = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(2, '0') + ':' + String(x).padStart(2, '0');
};
const fmtDur = sec => Math.floor(sec / 60) + ' min ' + (sec % 60) + ' s';
const loading = (msg = 'Loading…') => { app.innerHTML = `<div class="center muted">${esc(msg)}</div>`; };

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 4000);
}

const saveKey = () => 'sanskrit_mock_' + session.user.id;
function persist() { try { localStorage.setItem(saveKey(), JSON.stringify(test)); } catch (e) {} }
function clearSaved() { try { localStorage.removeItem(saveKey()); } catch (e) {} }
function loadSaved() {
  try { return JSON.parse(localStorage.getItem(saveKey()) || 'null'); } catch (e) { return null; }
}
function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }

function showError(msg) {
  app.innerHTML = `<div class="card auth"><h2>Something went wrong</h2><p class="muted">${esc(msg)}</p>
    <button class="btn primary" data-act="home">Back to dashboard</button></div>`;
}

/* ---------- top bar ---------- */
function renderTopbar() {
  if (!session) {
    topbar.innerHTML = `<div class="brand" data-act="home"><span class="dot sa">सं</span>UGC NET Sanskrit Mock Tests</div>`;
    return;
  }
  const meta = session.user.user_metadata || {};
  const name = meta.name || (session.user.email || '').split('@')[0];
  topbar.innerHTML = `
    <div class="brand" data-act="home"><span class="dot sa">सं</span>UGC NET Sanskrit Mock Tests</div>
    <button class="btn ghost sm" data-act="home">Dashboard</button>
    <button class="btn ghost sm" data-act="lb">Leaderboard</button>
    <span class="who">${esc(name)}</span>
    <button class="btn sm" data-act="logout">Log out</button>`;
}

/* ---------- auth ---------- */
function renderAuth() {
  stopTimer();
  const su = authMode === 'signup';
  app.innerHTML = `
  <div class="card auth">
    <h1>${su ? 'Create your free account' : 'Welcome back'}</h1>
    <p class="muted">UGC NET Sanskrit (Code 25): full mocks, unit-wise tests and a leaderboard.</p>
    <div class="tabs">
      <button class="btn tab ${su ? '' : 'on'}" data-act="mode" data-m="login" type="button">Log in</button>
      <button class="btn tab ${su ? 'on' : ''}" data-act="mode" data-m="signup" type="button">Sign up</button>
    </div>
    <form id="authform" autocomplete="on">
      ${su ? `<label class="f" for="name">Your name (shown on leaderboard)</label>
      <input id="name" name="name" type="text" maxlength="40" required autocomplete="name">` : ''}
      <label class="f" for="email">Email</label>
      <input id="email" name="email" type="email" required autocomplete="email">
      <label class="f" for="password">Password ${su ? '(min 6 characters)' : ''}</label>
      <input id="password" name="password" type="password" minlength="6" required autocomplete="${su ? 'new-password' : 'current-password'}">
      <div id="autherr" class="err" role="alert"></div>
      <button class="btn primary block" type="submit" style="margin-top:8px">${su ? 'Sign up' : 'Log in'}</button>
    </form>
  </div>`;
}

async function doAuth(form) {
  const fd = new FormData(form);
  const email = String(fd.get('email') || '').trim();
  const password = String(fd.get('password') || '');
  const name = String(fd.get('name') || '').trim();
  const errEl = document.getElementById('autherr');
  const btn = form.querySelector('button[type=submit]');
  errEl.classList.remove('okmsg'); errEl.textContent = '';
  btn.disabled = true;
  let res;
  if (authMode === 'signup') {
    res = await sb.auth.signUp({ email, password, options: { data: { name } } });
    if (!res.error && !res.data.session) {
      errEl.classList.add('okmsg');
      errEl.textContent = 'Account created. Please check your email to confirm, then log in.';
    }
  } else {
    res = await sb.auth.signInWithPassword({ email, password });
  }
  if (res.error) errEl.textContent = res.error.message;
  btn.disabled = false;
}

/* ---------- dashboard ---------- */
async function renderDashboard() {
  stopTimer();
  loading();
  const [u, h] = await Promise.all([
    sb.rpc('unit_counts'),
    sb.from('attempts').select('id,unit,total,correct,score,late,created_at')
      .order('created_at', { ascending: false }).limit(10)
  ]);
  if (u.error) return showError(u.error.message);
  units = u.data || [];
  const totalQ = units.reduce((a, x) => a + Number(x.n), 0);
  const saved = loadSaved();
  const perTest = cfg.QUESTIONS_PER_TEST || 100;

  const unitCards = units.map(x => `
    <div class="card unit">
      <h3>${esc(x.title)}</h3>
      <div class="n">${x.n} question${Number(x.n) === 1 ? '' : 's'} in bank</div>
      <button class="btn primary block" data-act="start" data-unit="${x.id}" ${Number(x.n) === 0 ? 'disabled' : ''}>
        ${Number(x.n) === 0 ? 'Coming soon' : 'Start unit test'}</button>
    </div>`).join('');

  const hist = (h.data || []).map(a => `
    <tr>
      <td>${esc(testName(a.unit))}</td>
      <td>${a.score} / ${a.total * 2}${a.late ? ' <span class="muted small">(overtime)</span>' : ''}</td>
      <td>${a.correct} / ${a.total}</td>
      <td class="small muted">${new Date(a.created_at).toLocaleString('en-IN')}</td>
      <td><button class="btn sm" data-act="review" data-id="${a.id}">Review</button></td>
    </tr>`).join('');

  app.innerHTML = `
    ${saved ? `<div class="banner"><div><b>You have a test in progress</b><br>
      <span class="muted small">${esc(testName(saved.unit))} · ${Object.keys(saved.answers || {}).length} / ${saved.qs.length} answered</span></div>
      <div><button class="btn primary" data-act="resume">Resume</button>
      <button class="btn" data-act="discard">Discard</button></div></div>` : ''}
    <div class="card hero">
      <div>
        <h1>Full Mock Test</h1>
        <p class="muted" style="margin:0">${perTest} questions mixed from all units · 2 marks each · no negative marking ·
          ${Math.round(perTest * (cfg.MINUTES_PER_QUESTION || 1.2))} minutes</p>
      </div>
      <button class="btn primary" data-act="start" data-unit="" ${totalQ === 0 ? 'disabled' : ''}>Start full mock</button>
    </div>
    <h2 class="section-title">Unit-wise tests</h2>
    <div class="grid units">${unitCards}</div>
    <h2 class="section-title">Your recent attempts</h2>
    <div class="card">${hist
      ? `<div class="tablewrap"><table><thead><tr><th>Test</th><th>Score</th><th>Correct</th><th>When</th><th></th></tr></thead><tbody>${hist}</tbody></table></div>`
      : '<p class="muted" style="margin:0">No attempts yet. Start a test above!</p>'}</div>`;
}

/* ---------- running a test ---------- */
async function startTest(unit) {
  loading('Preparing your test…');
  const { data, error } = await sb.rpc('start_test', { p_unit: unit, p_count: cfg.QUESTIONS_PER_TEST || 100 });
  if (error) { toast(error.message); return renderDashboard(); }
  const dur = Math.round(data.questions.length * (cfg.MINUTES_PER_QUESTION || 1.2) * 60000);
  test = { sessionId: data.session_id, unit, qs: data.questions, answers: {}, marked: {}, idx: 0, endAt: Date.now() + dur };
  persist();
  renderTest();
}

function renderTest() {
  const t = test, q = t.qs[t.idx];
  const keys = ['a', 'b', 'c', 'd'];
  const opts = keys.map(k => {
    const K = k.toUpperCase(), on = t.answers[q.id] === K;
    return `<label class="opt ${on ? 'sel' : ''}"><input type="radio" name="opt" value="${K}" ${on ? 'checked' : ''}>
      <span class="ol">${K}</span><span class="ot sa">${esc(q[k])}</span></label>`;
  }).join('');
  const pal = t.qs.map((x, i) => {
    const cls = [t.marked[x.id] ? 'mark' : (t.answers[x.id] ? 'ans' : ''), i === t.idx ? 'cur' : ''].join(' ').trim();
    return `<button class="${cls}" data-act="goto" data-i="${i}" aria-label="Question ${i + 1}">${i + 1}</button>`;
  }).join('');
  const answered = Object.keys(t.answers).length;

  app.innerHTML = `
  <div class="test">
    <section class="card">
      <div class="test-head">
        <span class="badge">Question ${t.idx + 1} of ${t.qs.length}</span>
        <span class="badge soft">${esc(unitTitle(q.unit))}</span>
        <span id="timer" class="timer"></span>
      </div>
      <div class="qtext sa">${esc(q.question)}</div>
      <div class="opts">${opts}</div>
      <div class="actions">
        <button class="btn" data-act="prev" ${t.idx === 0 ? 'disabled' : ''}>Previous</button>
        <button class="btn" data-act="clear">Clear</button>
        <button class="btn" data-act="mark">${t.marked[q.id] ? 'Unmark review' : 'Mark for review'}</button>
        <span class="spacer"></span>
        <button class="btn primary" data-act="next" ${t.idx === t.qs.length - 1 ? 'disabled' : ''}>Next</button>
      </div>
    </section>
    <aside class="card palette">
      <b>${answered} / ${t.qs.length} answered</b>
      <div class="pal">${pal}</div>
      <div class="legend"><span><i style="background:var(--ok)"></i>Answered</span>
        <span><i style="background:var(--mark)"></i>Review</span><span><i></i>Not answered</span></div>
      <button class="btn primary block" data-act="submit">Submit test</button>
    </aside>
  </div>`;
  tick();
  if (!timer) timer = setInterval(tick, 1000);
}

function tick() {
  if (!test) return stopTimer();
  const left = test.endAt - Date.now();
  const el = document.getElementById('timer');
  if (el) { el.textContent = '⏱ ' + fmtTime(left); el.classList.toggle('low', left < 300000); }
  if (left <= 0) { stopTimer(); submitTest(true); }
}

function choose(val) {
  const q = test.qs[test.idx];
  test.answers[q.id] = val;
  persist(); renderTest();
}

let submitting = false;
async function submitTest(auto = false) {
  if (!test || submitting) return;
  const n = test.qs.length, a = Object.keys(test.answers).length;
  if (!auto && !confirm(`Submit now?\n\nAnswered: ${a} of ${n}\nUnanswered: ${n - a}`)) return;
  submitting = true; stopTimer();
  loading(auto ? 'Time is up! Submitting your answers…' : 'Submitting…');
  const { data, error } = await sb.rpc('submit_attempt', { p_session: test.sessionId, p_answers: test.answers });
  submitting = false;
  if (error) {
    if (/already submitted|not found/i.test(error.message)) { clearSaved(); test = null; toast(error.message); return renderDashboard(); }
    toast('Could not submit: ' + error.message + ' (your answers are saved, try again)');
    renderTest(); return;
  }
  clearSaved(); test = null;
  renderResult(data);
}

/* ---------- result & review ---------- */
function renderResult(r) {
  stopTimer();
  lastResult = r; reviewFilter = 'all';
  const pct = r.max_score ? (100 * r.score / r.max_score).toFixed(1) : '0.0';
  app.innerHTML = `
    <div class="card">
      <h1>${esc(testName(r.unit))} · Result</h1>
      <div class="stats">
        <div class="stat big"><b>${r.score} / ${r.max_score}</b><span>Score (${pct}%)</span></div>
        <div class="stat"><b style="color:var(--ok)">${r.correct}</b><span>Correct</span></div>
        <div class="stat"><b style="color:var(--bad)">${r.wrong}</b><span>Wrong</span></div>
        <div class="stat"><b>${r.unattempted}</b><span>Unattempted</span></div>
        <div class="stat"><b style="font-size:1.1rem">${fmtDur(r.duration_sec)}</b><span>Time taken</span></div>
      </div>
      ${r.late ? '<p class="muted small">This attempt went over the time limit, so it is not counted on the leaderboard.</p>' : ''}
      <div class="actions">
        <button class="btn primary" data-act="home">Back to dashboard</button>
        <button class="btn" data-act="lb">View leaderboard</button>
      </div>
    </div>
    <div class="chips">
      ${[['all', 'All'], ['wrong', 'Wrong'], ['unattempted', 'Unattempted'], ['right', 'Correct']]
        .map(([k, l]) => `<button class="btn sm chip ${k === 'all' ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`).join('')}
    </div>
    <div id="reviewlist"></div>`;
  renderReviewList();
  window.scrollTo(0, 0);
}

function renderReviewList() {
  const r = lastResult;
  const status = x => !x.chosen ? 'unattempted' : (x.chosen === x.correct ? 'right' : 'wrong');
  const list = r.review.map((x, i) => ({ x, i, s: status(x) }))
    .filter(o => reviewFilter === 'all' || o.s === reviewFilter);
  document.getElementById('reviewlist').innerHTML = list.length ? list.map(({ x, i, s }) => {
    const opts = ['a', 'b', 'c', 'd'].map(k => {
      const K = k.toUpperCase();
      const cls = K === x.correct ? 'right' : (K === x.chosen ? 'wrong' : '');
      return `<div class="opt ${cls}"><span class="ol">${K}</span><span class="ot sa">${esc(x[k])}</span></div>`;
    }).join('');
    const label = s === 'right' ? ['r', 'Correct'] : s === 'wrong' ? ['w', 'Wrong'] : ['u', 'Not attempted'];
    return `<div class="card rv">
      <div class="test-head"><span class="badge">Q${i + 1}</span><span class="badge soft">${esc(unitTitle(x.unit))}</span>
        <span class="verdict ${label[0]}" style="margin-left:auto">${label[1]}</span></div>
      <div class="qtext sa">${esc(x.question)}</div>
      <div class="opts">${opts}</div>
      ${x.explanation ? `<div class="expl sa"><b>Explanation:</b> ${esc(x.explanation)}</div>` : ''}
    </div>`;
  }).join('') : '<p class="muted center">Nothing in this filter.</p>';
}

async function openReview(id) {
  loading('Loading review…');
  const { data, error } = await sb.rpc('get_attempt_review', { p_attempt_id: Number(id) });
  if (error) return showError(error.message);
  if (!units.length) { const u = await sb.rpc('unit_counts'); units = u.data || []; }
  renderResult(data);
}

/* ---------- leaderboard ---------- */
async function renderLeaderboard(unit = null) {
  stopTimer();
  loading('Loading leaderboard…');
  if (!units.length) { const u = await sb.rpc('unit_counts'); units = u.data || []; }
  const { data, error } = await sb.rpc('get_leaderboard', { p_unit: unit });
  if (error) return showError(error.message);
  const opts = `<option value="">Full Mock Test</option>` +
    units.map(u => `<option value="${u.id}" ${unit === u.id ? 'selected' : ''}>${esc(u.title)}</option>`).join('');
  const rows = (data || []).map(r => `
    <tr><td class="rank">${r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td>
    <td>${esc(r.name)}</td><td>${r.best_score}</td><td>${r.best_pct}%</td><td>${r.attempts}</td></tr>`).join('');
  app.innerHTML = `
    <div class="card">
      <div class="test-head"><h1 style="margin:0">Leaderboard</h1>
        <select id="lbunit" style="max-width:260px;margin-left:auto" aria-label="Choose test">${opts}</select></div>
      <p class="muted small">Ranked by each student's best attempt (completed within the time limit).</p>
      ${rows ? `<div class="tablewrap"><table><thead><tr><th>Rank</th><th>Name</th><th>Best score</th><th>Best %</th><th>Attempts</th></tr></thead><tbody>${rows}</tbody></table></div>`
             : '<p class="muted center">No scores yet. Be the first!</p>'}
    </div>`;
}

/* ---------- actions & events ---------- */
const actions = {
  home: () => renderDashboard(),
  lb: () => renderLeaderboard(null),
  logout: async () => { stopTimer(); test = null; await sb.auth.signOut(); },
  mode: el => { authMode = el.dataset.m; renderAuth(); },
  start: el => startTest(el.dataset.unit === '' ? null : Number(el.dataset.unit)),
  resume: () => { test = loadSaved(); if (test) renderTest(); else renderDashboard(); },
  discard: () => { if (confirm('Discard the unfinished test?')) { clearSaved(); renderDashboard(); } },
  goto: el => { test.idx = Number(el.dataset.i); persist(); renderTest(); },
  prev: () => { if (test.idx > 0) { test.idx--; persist(); renderTest(); } },
  next: () => { if (test.idx < test.qs.length - 1) { test.idx++; persist(); renderTest(); } },
  clear: () => { delete test.answers[test.qs[test.idx].id]; persist(); renderTest(); },
  mark: () => { const id = test.qs[test.idx].id; test.marked[id] = !test.marked[id]; if (!test.marked[id]) delete test.marked[id]; persist(); renderTest(); },
  submit: () => submitTest(false),
  review: el => openReview(el.dataset.id),
  filter: el => {
    reviewFilter = el.dataset.f;
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === el));
    renderReviewList();
  }
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || !session) { if (el && el.dataset.act === 'mode') actions.mode(el); return; }
  const f = actions[el.dataset.act];
  if (f) { e.preventDefault(); f(el); }
});
document.addEventListener('change', e => {
  if (e.target.name === 'opt' && test) choose(e.target.value);
  if (e.target.id === 'lbunit') renderLeaderboard(e.target.value === '' ? null : Number(e.target.value));
});
document.addEventListener('submit', e => {
  if (e.target.id === 'authform') { e.preventDefault(); doAuth(e.target); }
});

/* ---------- start-up ---------- */
function route() {
  renderTopbar();
  if (!session) return renderAuth();
  renderDashboard();
}

async function init() {
  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.startsWith('YOUR_') || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.startsWith('YOUR_')) {
    app.innerHTML = `<div class="card auth"><h2>Almost ready</h2>
      <p class="muted">Add your Supabase URL and key in <code>config.js</code> to switch the site on.</p></div>`;
    return;
  }
  if (!window.supabase) { app.innerHTML = '<div class="center muted">Could not load the app. Check your internet connection.</div>'; return; }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_event, s) => {
    const changed = (s && s.user && s.user.id) !== (session && session.user && session.user.id);
    session = s;
    if (changed) { test = null; route(); }
  });
  route();
}

init();
})();

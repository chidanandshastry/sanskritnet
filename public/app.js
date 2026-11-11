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
let bookmarks = new Set();                         // question ids this student has saved
let recovery = /type=recovery/.test(location.hash); // arrived from a password-reset email
let qscale = 1;                                     // question text size multiplier

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const unitTitle = id => (units.find(u => u.id === id) || {}).title || ('Unit ' + id);
const testName = (unit, kind) =>
  kind === 'mistakes' ? 'Practice: my mistakes' :
  kind === 'saved' ? 'Practice: saved questions' :
  kind === 'daily' ? 'Test of the day' :
  (kind === 'full' || (kind == null && unit == null)) ? 'Full Mock Test' : unitTitle(unit);
const REASONS = [['wrong_answer', 'The marked answer is wrong'], ['unclear', 'The question is unclear'],
  ['typo', 'Spelling or typing error'], ['other', 'Something else']];
function setScale(v) {
  qscale = Math.max(0.85, Math.min(1.5, Math.round(v * 100) / 100));
  document.documentElement.style.setProperty('--qs', qscale);
  try { localStorage.setItem('qscale', String(qscale)); } catch (e) {}
}
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
    topbar.innerHTML = `<div class="brand" data-act="home"><span class="dot sa">सं</span>UGC NET Sanskrit</div>`;
    return;
  }
  const meta = session.user.user_metadata || {};
  const name = meta.name || (session.user.email || '').split('@')[0];
  topbar.innerHTML = `
    <div class="brand" data-act="home"><span class="dot sa">सं</span>UGC NET Sanskrit</div>
    <button class="btn ghost sm" data-act="home">Dashboard</button>
    <button class="btn ghost sm" data-act="lb">Leaderboard</button>
    <span class="who">${esc(name)}</span>
    <button class="btn sm" data-act="logout">Log out</button>`;
  // Show an Admin link only to admins
  sb.rpc('is_admin').then(({ data }) => {
    if (data === true && session) {
      const a = document.createElement('a');
      a.className = 'btn ghost sm'; a.href = 'admin.html'; a.textContent = 'Admin';
      const lb = topbar.querySelector('[data-act=lb]');
      if (lb) lb.after(a);
    }
  });
}

/* ---------- auth ---------- */
function renderAuth() {
  stopTimer();
  const su = authMode === 'signup';
  app.innerHTML = `
  <div class="auth-wrap">
  <div class="auth-art">
    <p class="verse" lang="sa">विद्या ददाति विनयम्</p>
    <p class="gloss">Learning gives humility.</p>
    <p class="src">Hitopadeśa</p>
    <p class="lede">Practise UGC NET Sanskrit (code 25) under exam conditions. Take full 100-question mocks or work through one unit at a time, and see where you rank.</p>
  </div>
  <div class="card auth">
    <h1>${su ? 'Create your free account' : 'Welcome back'}</h1>
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
    ${su ? '' : '<button class="btn ghost block" type="button" data-act="forgot" style="margin-top:6px">Forgot password?</button>'}
  </div>
  </div>`;
}

function renderForgot() {
  app.innerHTML = `
  <div class="card auth"><h1>Reset your password</h1>
    <p class="muted">Enter your email and we will send you a link to choose a new password.</p>
    <form id="forgotform">
      <label class="f" for="femail">Email</label>
      <input id="femail" name="email" type="email" required autocomplete="email">
      <div id="ferr" class="err" role="alert"></div>
      <button class="btn primary block" type="submit" style="margin-top:8px">Send reset link</button>
    </form>
    <button class="btn ghost block" type="button" data-act="backlogin" style="margin-top:6px">Back to log in</button>
  </div>`;
}

async function doForgot(form) {
  const email = String(new FormData(form).get('email') || '').trim();
  const el = document.getElementById('ferr');
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true; el.classList.remove('okmsg'); el.textContent = '';
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' });
  btn.disabled = false;
  if (error) { el.textContent = error.message; return; }
  el.classList.add('okmsg');
  el.textContent = 'If an account exists for that email, a reset link is on its way. Check your inbox and spam folder.';
}

function renderRecovery() {
  stopTimer();
  app.innerHTML = `
  <div class="card auth"><h1>Choose a new password</h1>
    <form id="recform">
      <label class="f" for="np">New password (min 6 characters)</label>
      <input id="np" name="password" type="password" minlength="6" required autocomplete="new-password">
      <label class="f" for="np2">Type it again</label>
      <input id="np2" name="password2" type="password" minlength="6" required autocomplete="new-password">
      <div id="rcerr" class="err" role="alert"></div>
      <button class="btn primary block" type="submit" style="margin-top:8px">Save new password</button>
    </form>
  </div>`;
}

async function doRecovery(form) {
  const fd = new FormData(form);
  const p = String(fd.get('password') || ''), p2 = String(fd.get('password2') || '');
  const el = document.getElementById('rcerr');
  const btn = form.querySelector('button[type=submit]');
  el.textContent = '';
  if (p !== p2) { el.textContent = 'The two passwords do not match.'; return; }
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ password: p });
  if (error) { el.textContent = error.message; btn.disabled = false; return; }
  recovery = false;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
  toast('Password updated. You are logged in.');
  renderDashboard();
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

/* ---------- dashboard helpers ---------- */
const accOf = x => (x && x.answered) ? Math.round(100 * x.correct / x.answered) : null;
const toDev = n => String(n).replace(/\d/g, d => '०१२३४५६७८९'[d]);   // 1 -> १

function unitAccuracy(x) {
  const a = accOf(x);
  if (a === null) return '<div class="meter"><i style="width:0"></i></div><div class="small muted">Not attempted yet</div>';
  return `<div class="meter ${a < 50 ? 'low' : a >= 75 ? 'high' : ''}"><i style="width:${a}%"></i></div>
    <div class="small muted">${a}% accuracy, ${x.correct} of ${x.answered} correct</div>`;
}

function sparkline(trend) {
  if (!trend || trend.length < 2) return '';
  const w = 640, h = 84, p = 8;
  const pts = trend.map((t, i) => [p + i * (w - 2 * p) / (trend.length - 1),
    h - p - (Math.min(100, Number(t.pct) || 0) / 100) * (h - 2 * p)]);
  return `<div class="spark-wrap"><div class="small muted">Score trend (last ${trend.length} tests)</div>
    <svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="Score trend over your last ${trend.length} attempts">
      <polyline points="${pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ')}" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${pts.map(q => `<circle cx="${q[0].toFixed(1)}" cy="${q[1].toFixed(1)}" r="3" fill="var(--brand)"/>`).join('')}
    </svg></div>`;
}

function progressHTML(st) {
  if (!st || !st.attempts) {
    return `<div class="card" style="margin-top:20px"><h2 style="margin-bottom:.3em">Welcome!</h2>
      <p class="muted" style="margin:0">Take your first test to see your progress, accuracy by unit and your rank here.</p></div>`;
  }
  const overall = st.answered ? Math.round(100 * st.correct / st.answered) : 0;
  const weak = st.units.filter(x => x.answered >= 5)
    .map(x => ({ unit: x.unit, a: accOf(x) })).filter(x => x.a < 75)
    .sort((a, b) => a.a - b.a).slice(0, 2);
  return `<h2 class="section-title">Your progress</h2>
    <div class="card">
      <div class="stats" style="margin-top:0">
        <div class="stat big"><b>${st.attempts}</b><span>Tests taken</span></div>
        <div class="stat"><b>${st.avg_pct ?? 0}%</b><span>Average score</span></div>
        <div class="stat"><b>${st.best_pct ?? 0}%</b><span>Best score</span></div>
        <div class="stat"><b>${overall}%</b><span>Answer accuracy</span></div>
        <div class="stat"><b>${st.streak}</b><span>Day streak</span></div>
        <div class="stat"><b>${st.rank ? '#' + st.rank + '<small> of ' + st.players + '</small>' : '—'}</b><span>Full-mock rank</span></div>
      </div>
      ${sparkline(st.trend)}
      ${weak.length ? `<div class="weak"><b>Needs practice</b>
        ${weak.map(w => `<div class="toolbar" style="margin:8px 0 0"><span>${esc(unitTitle(w.unit))} <span class="muted small">(${w.a}% accuracy)</span></span>
          <button class="btn sm primary" style="margin-left:auto" data-act="start" data-kind="unit" data-unit="${w.unit}">Practise</button></div>`).join('')}</div>` : ''}
    </div>`;
}

/* ---------- dashboard ---------- */
async function renderDashboard() {
  stopTimer();
  loading();
  const [u, h, s, pcr, dly] = await Promise.all([
    sb.rpc('unit_counts'),
    sb.from('attempts').select('id,unit,kind,total,correct,score,late,created_at')
      .order('created_at', { ascending: false }).limit(10),
    sb.rpc('my_stats'),
    sb.rpc('practice_counts'),
    sb.rpc('daily_status')
  ]);
  if (u.error) return showError(u.error.message);
  units = u.data || [];
  const dd = (!dly.error && dly.data && Number(dly.data.count) > 0) ? dly.data : null;   // hidden if the bank is empty
  const pc = (!pcr.error && pcr.data) ? pcr.data : { mistakes: 0, saved: 0 };
  const st = (!s.error && s.data) ? s.data : null;   // progress is optional: never block the dashboard
  const byUnit = {};
  if (st) st.units.forEach(x => { byUnit[x.unit] = x; });
  const totalQ = units.reduce((a, x) => a + Number(x.n), 0);
  const saved = loadSaved();
  const perTest = cfg.QUESTIONS_PER_TEST || 100;

  const unitCards = units.map(x => `
    <div class="urow">
      <span class="unum" aria-hidden="true">${toDev(x.id)}</span>
      <div class="uinfo">
        <h3>${esc(x.title)}</h3>
        <div class="small muted">${x.n} question${Number(x.n) === 1 ? '' : 's'}</div>
      </div>
      <div class="uacc">${unitAccuracy(byUnit[x.id])}</div>
      <button class="btn ${Number(x.n) === 0 ? '' : 'primary'}" data-act="start" data-kind="unit" data-unit="${x.id}" ${Number(x.n) === 0 ? 'disabled' : ''}>
        ${Number(x.n) === 0 ? 'No questions' : 'Start test'}</button>
    </div>`).join('');

  const practiceRows = [
    ['mistakes', 'My mistakes', 'Questions you got wrong or skipped the last time you saw them.', Number(pc.mistakes) || 0, 'to review'],
    ['saved', 'Saved questions', 'Questions you starred while reviewing a test.', Number(pc.saved) || 0, 'saved']
  ].map(([kind, title, desc, n, word]) => `
    <div class="urow two">
      <div class="uinfo"><h3>${title}</h3>
        <div class="small muted">${desc}${n ? ` ${n} ${word}.` : ''}</div></div>
      <button class="btn ${n ? 'primary' : ''}" data-act="start" data-kind="${kind}" ${n ? '' : 'disabled'}>${n ? 'Start practice' : 'None yet'}</button>
    </div>`).join('');

  const hist = (h.data || []).map(a => `
    <tr>
      <td>${esc(testName(a.unit, a.kind))}</td>
      <td>${a.score} / ${a.total * 2}${a.late ? ' <span class="muted small">(overtime)</span>' : ''}</td>
      <td>${a.correct} / ${a.total}</td>
      <td class="small muted">${new Date(a.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
      <td><button class="btn sm" data-act="review" data-id="${a.id}">Review</button></td>
    </tr>`).join('');

  let dailyCard = '';
  if (dd) {
    const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
    const mins = Math.round(dd.count * (cfg.MINUTES_PER_QUESTION || 1.2));
    const body = dd.done
      ? (dd.late
          ? `<p class="muted">You finished today's test over the time limit, so it is not ranked. A new test opens at midnight.</p>`
          : `<p class="muted">You scored <b>${dd.score} of ${dd.total * 2}</b> and rank <b>#${dd.rank}</b> of ${dd.players} so far today. A new test opens at midnight.</p>`)
      : `<p class="muted">${dd.count} questions, the same for every student, ${mins} minutes. You get one attempt, so it counts.</p>`;
    const btns = dd.done
      ? `<button class="btn primary" data-act="review" data-id="${dd.attempt_id}">Review answers</button>
         <button class="btn" data-act="dailylb">Today's leaderboard</button>`
      : `<button class="btn primary" data-act="start" data-kind="daily">${dd.in_progress ? 'Continue today\'s test' : 'Start today\'s test'}</button>
         <button class="btn" data-act="dailylb">Today's leaderboard</button>`;
    dailyCard = `<div class="card hero daily">
      <div><h1>Test of the day</h1>
        <div class="small muted" style="margin-bottom:.5em">${esc(today)}</div>${body}</div>
      <div class="hero-actions">${btns}</div></div>`;
  }

  app.innerHTML = `
    ${saved ? `<div class="banner"><div><b>You have a test in progress</b><br>
      <span class="muted small">${esc(testName(saved.unit, saved.kind))}, ${Object.keys(saved.answers || {}).length} of ${saved.qs.length} answered</span></div>
      <div><button class="btn primary" data-act="resume">Resume</button>
      ${saved.kind === 'daily' ? '' : '<button class="btn" data-act="discard">Discard</button>'}</div></div>` : ''}
    ${dailyCard}
    <div class="card hero" style="margin-top:14px">
      <div>
        <h1>Full Mock Test</h1>
        <p class="muted">${perTest} questions drawn from all ten units, two marks each, no negative marking.
          You get ${Math.round(perTest * (cfg.MINUTES_PER_QUESTION || 1.2))} minutes.</p>
      </div>
      <button class="btn primary" data-act="start" data-kind="full" ${totalQ === 0 ? 'disabled' : ''}>Start full mock</button>
    </div>
    ${progressHTML(st)}
    <h2 class="section-title">Practice</h2>
    <div class="ledger">${practiceRows}</div>
    <h2 class="section-title">Unit-wise tests</h2>
    <div class="ledger">${unitCards}</div>
    <h2 class="section-title">Your recent attempts</h2>
    <div class="card">${hist
      ? `<div class="tablewrap"><table><thead><tr><th>Test</th><th>Score</th><th>Correct</th><th>When</th><th></th></tr></thead><tbody>${hist}</tbody></table></div>`
      : '<p class="muted" style="margin:0">No attempts yet. Start a test above!</p>'}</div>`;
}

/* ---------- running a test ---------- */
async function startTest(kind, unit) {
  loading('Preparing your test…');
  const { data, error } = await sb.rpc('start_test', { p_unit: unit, p_count: cfg.QUESTIONS_PER_TEST || 100, p_kind: kind });
  if (error) { toast(error.message); return renderDashboard(); }
  const dur = Math.round(data.questions.length * (cfg.MINUTES_PER_QUESTION || 1.2) * 60000);
  test = { sessionId: data.session_id, kind: data.kind, unit: data.unit, qs: data.questions, answers: {}, marked: {}, idx: 0,
    endAt: Date.now() + dur - (Number(data.elapsed_sec) || 0) * 1000 };   // reopened daily test keeps its original clock
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
      <div class="progress" aria-hidden="true"><i style="width:${Math.round(100 * (t.idx + 1) / t.qs.length)}%"></i></div>
      <div class="test-head">
        <span class="badge">Question ${t.idx + 1} of ${t.qs.length}</span>
        <span class="badge soft">${esc(unitTitle(q.unit))}</span>
        <span class="sizer"><button class="btn sm" data-act="smaller" aria-label="Smaller text">A−</button><button class="btn sm" data-act="larger" aria-label="Larger text">A+</button></span>
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
      <p class="hint small muted">Keys: A to D choose an answer, left and right arrows move between questions, M marks for review.</p>
    </section>
    <aside class="card palette">
      <b>${answered} / ${t.qs.length} answered</b>
      <div class="pal">${pal}</div>
      <div class="legend"><span><i style="background:var(--brand)"></i>Answered</span>
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
  if (el) { el.textContent = fmtTime(left); el.classList.toggle('low', left < 300000); }
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
    <div class="card rule">
      <h1>${esc(testName(r.unit, r.kind))} result</h1>
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
  loadBookmarks(r);
}

async function loadBookmarks(r) {
  const { data } = await sb.rpc('get_bookmark_ids');
  bookmarks = new Set(data || []);
  if (lastResult === r && document.getElementById('reviewlist')) renderReviewList();
}

function openReport(id) {
  const x = lastResult && lastResult.review.find(q => q.id === id);
  if (!x) return;
  const dlg = document.getElementById('rdlg');
  dlg.innerHTML = `
    <form id="rform" method="dialog">
      <h2>Report this question</h2>
      <p class="muted small sa">${esc(x.question.length > 140 ? x.question.slice(0, 140) + '…' : x.question)}</p>
      <input type="hidden" name="id" value="${id}">
      <label class="f" for="rreason">What is wrong?</label>
      <select id="rreason" name="reason">${REASONS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
      <label class="f" for="rnote">Details (optional)</label>
      <textarea id="rnote" name="note" rows="3" maxlength="500"></textarea>
      <div id="rerr" class="err" role="alert"></div>
      <div class="actions"><button class="btn primary" type="submit">Send report</button>
        <button class="btn" type="button" data-act="closereport">Cancel</button></div>
    </form>`;
  dlg.showModal();
}

async function sendReport(form) {
  const fd = new FormData(form);
  const btn = form.querySelector('button[type=submit]');
  btn.disabled = true;
  const { error } = await sb.rpc('report_question', {
    p_question_id: Number(fd.get('id')), p_reason: fd.get('reason'), p_note: fd.get('note') });
  btn.disabled = false;
  if (error) { document.getElementById('rerr').textContent = error.message; return; }
  document.getElementById('rdlg').close();
  toast('Thanks. The admins will check this question.');
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
        <span class="verdict ${label[0]}" style="margin-left:auto">${label[1]}</span>
        <button class="btn sm ghost" data-act="bookmark" data-id="${x.id}" aria-pressed="${bookmarks.has(x.id)}">${bookmarks.has(x.id) ? '★ Saved' : '☆ Save'}</button>
        <button class="btn sm ghost" data-act="report" data-id="${x.id}">Report</button></div>
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
async function renderLeaderboard(unit = null) {   // null = full mock, number = unit, 'daily' = test of the day
  stopTimer();
  loading('Loading leaderboard…');
  if (!units.length) { const u = await sb.rpc('unit_counts'); units = u.data || []; }
  const daily = unit === 'daily';
  const { data, error } = daily ? await sb.rpc('get_daily_leaderboard', { p_day: null })
                                : await sb.rpc('get_leaderboard', { p_unit: unit });
  if (error) return showError(error.message);
  const opts = `<option value="daily" ${daily ? 'selected' : ''}>Test of the day (today)</option>` +
    `<option value="" ${unit === null ? 'selected' : ''}>Full Mock Test</option>` +
    units.map(u => `<option value="${u.id}" ${unit === u.id ? 'selected' : ''}>${esc(u.title)}</option>`).join('');
  const mmss = sec => Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  const rows = (data || []).map(r => daily
    ? `<tr class="${r.rank <= 3 ? 'top' : ''}"><td class="rank">${r.rank}</td>
       <td>${esc(r.name)}</td><td>${r.score}</td><td>${r.pct}%</td><td>${mmss(r.duration_sec)}</td></tr>`
    : `<tr class="${r.rank <= 3 ? 'top' : ''}"><td class="rank">${r.rank}</td>
       <td>${esc(r.name)}</td><td>${r.best_score}</td><td>${r.best_pct}%</td><td>${r.attempts}</td></tr>`).join('');
  const head = daily ? '<th>Rank</th><th>Name</th><th>Score</th><th>Score %</th><th>Time taken</th>'
                     : '<th>Rank</th><th>Name</th><th>Best score</th><th>Best %</th><th>Attempts</th>';
  app.innerHTML = `
    <div class="card">
      <div class="test-head"><h1 style="margin:0">Leaderboard</h1>
        <select id="lbunit" style="max-width:260px;margin-left:auto" aria-label="Choose test">${opts}</select></div>
      <p class="muted small">${daily ? "Today's test only. Higher score ranks first; equal scores are ranked by who finished faster." : "Ranked by each student's best attempt (completed within the time limit)."}</p>
      ${rows ? `<div class="tablewrap"><table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
             : `<p class="muted center">${daily ? "Nobody has finished today's test yet. Be the first!" : 'No scores yet. Be the first!'}</p>`}
    </div>`;
}

/* ---------- actions & events ---------- */
const actions = {
  home: () => renderDashboard(),
  lb: () => renderLeaderboard(null),
  dailylb: () => renderLeaderboard('daily'),
  logout: async () => { stopTimer(); test = null; await sb.auth.signOut(); },
  mode: el => { authMode = el.dataset.m; renderAuth(); },
  start: el => startTest(el.dataset.kind || 'unit', el.dataset.unit ? Number(el.dataset.unit) : null),
  forgot: () => renderForgot(),
  backlogin: () => { authMode = 'login'; renderAuth(); },
  smaller: () => setScale(qscale - 0.1),
  larger: () => setScale(qscale + 0.1),
  bookmark: async el => {
    const id = Number(el.dataset.id);
    const { data, error } = await sb.rpc('toggle_bookmark', { p_question_id: id });
    if (error) return toast(error.message);
    if (data) bookmarks.add(id); else bookmarks.delete(id);
    renderReviewList();
    toast(data ? 'Saved. Practise it from the Practice section on your dashboard.' : 'Removed from saved questions.');
  },
  report: el => openReport(Number(el.dataset.id)),
  closereport: () => document.getElementById('rdlg').close(),
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

const PRE_LOGIN = ['mode', 'forgot', 'backlogin'];   // actions that work before logging in
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (!session && !PRE_LOGIN.includes(el.dataset.act)) return;
  const f = actions[el.dataset.act];
  if (f) { e.preventDefault(); f(el); }
});

// Keyboard shortcuts during a test
document.addEventListener('keydown', e => {
  if (!test || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'radio'))) return;
  if (document.querySelector('dialog[open]')) return;
  const k = e.key.toLowerCase();
  if (k.length === 1 && 'abcd'.includes(k)) choose(k.toUpperCase());
  else if (k.length === 1 && '1234'.includes(k)) choose('ABCD'[Number(k) - 1]);
  else if (k === 'arrowright' || k === 'n') actions.next();
  else if (k === 'arrowleft' || k === 'p') actions.prev();
  else if (k === 'm') actions.mark();
  else return;
  e.preventDefault();
});
document.addEventListener('change', e => {
  if (e.target.name === 'opt' && test) choose(e.target.value);
  if (e.target.id === 'lbunit') {
    const v = e.target.value;
    renderLeaderboard(v === '' ? null : v === 'daily' ? 'daily' : Number(v));
  }
});
document.addEventListener('submit', e => {
  const id = e.target.id;
  if (id === 'authform') { e.preventDefault(); doAuth(e.target); }
  else if (id === 'forgotform') { e.preventDefault(); doForgot(e.target); }
  else if (id === 'recform') { e.preventDefault(); doRecovery(e.target); }
  else if (id === 'rform') { e.preventDefault(); sendReport(e.target); }
});

/* ---------- start-up ---------- */
function route() {
  renderTopbar();
  if (!session) return renderAuth();
  if (recovery) return renderRecovery();
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
  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'PASSWORD_RECOVERY') recovery = true;
    const changed = (s && s.user && s.user.id) !== (session && session.user && session.user.id);
    session = s;
    if (changed || event === 'PASSWORD_RECOVERY') { test = null; route(); }
  });
  try { const v = parseFloat(localStorage.getItem('qscale')); if (v) setScale(v); } catch (e) {}
  route();
}

init();
})();

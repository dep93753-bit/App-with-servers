/* AdminHub app.js — teacher UI, student UI, AI quiz maker, game launcher.
   NOTE: the 3 game builders (buildBattleshipHTML / buildBubbleHTML / buildAsteroidsHTML)
   are still in this file for now. Next step: move them into /games/. */

window.addEventListener('error', function (e) {
  var el = document.getElementById('__errbar');
  if (!el) {
    el = document.createElement('div');
    el.id = '__errbar';
    el.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#DB504A;color:#fff;padding:10px 14px;font:13px ui-monospace,monospace;z-index:999999;white-space:pre-wrap';
    document.body.appendChild(el);
  }
  el.textContent = 'Error: ' + (e.message || 'unknown') + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : '');
});

let nav = 'classes';
const VIEWS = ['classes', 'ai', 'questions'];

/* ===================== Identity / mode ===================== */
let studentIdentity = null;
try { studentIdentity = JSON.parse(localStorage.getItem('adminhub_student_identity_v1') || 'null'); } catch (e) {}
if (!studentIdentity || !studentIdentity.id) {
  studentIdentity = { id: 'stu_' + Math.random().toString(36).slice(2, 10), name: '' };
  try { localStorage.setItem('adminhub_student_identity_v1', JSON.stringify(studentIdentity)); } catch (e) {}
}
function saveStudentIdentity() {
  try { localStorage.setItem('adminhub_student_identity_v1', JSON.stringify(studentIdentity)); } catch (e) {}
}

let uiMode = 'teacher';
try {
  const m = localStorage.getItem('adminhub_ui_mode_v1');
  if (m === 'student' || m === 'teacher') uiMode = m;
} catch (e) {}
function saveUiMode() { try { localStorage.setItem('adminhub_ui_mode_v1', uiMode); } catch (e) {} }

let studentSession = null;
try {
  const s = localStorage.getItem('adminhub_student_join_v1');
  if (s) studentSession = JSON.parse(s);
} catch (e) {}
function saveStudentSession() {
  try {
    if (studentSession) localStorage.setItem('adminhub_student_join_v1', JSON.stringify(studentSession));
    else localStorage.removeItem('adminhub_student_join_v1');
  } catch (e) {}
}
let studentTab = 'home';

/* ===================== Storage ===================== */
const KEY = 'adminhub_classes_v1';
let railOpen = true, classes = [], activeId = null, tab = 'activity', memStore = null, ownOpen = true;
try { railOpen = localStorage.getItem('adminhub_rail_open') !== '0'; } catch (e) {}
try { ownOpen = localStorage.getItem('adminhub_owned_open') !== '0'; } catch (e) {}
function load() { try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch (e) {} return memStore || []; }
function save() { memStore = classes; try { localStorage.setItem(KEY, JSON.stringify(classes)); } catch (e) {} }
classes = load();
if (classes.length) activeId = classes[0].id;

const SCORE_KEY = 'adminhub_student_scores_v1';
function getStudentScores(classId, studentId) {
  try {
    const all = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
    const cm = all[classId];
    if (!cm) return [];
    if (Array.isArray(cm)) return cm;
    return cm[studentId] || [];
  } catch (e) { return []; }
}
function getAllClassScores(classId) {
  try {
    const all = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
    const cm = all[classId];
    if (!cm) return [];
    if (Array.isArray(cm)) return cm;
    let flat = [];
    Object.values(cm).forEach(a => { if (Array.isArray(a)) flat = flat.concat(a); });
    return flat;
  } catch (e) { return []; }
}
function recordScore(classId, game, quizId, won, score, answers) {
  try {
    const all = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
    let cm = all[classId];
    if (!cm || Array.isArray(cm)) cm = { __legacy: Array.isArray(cm) ? cm : [] };
    const sid = (studentIdentity && studentIdentity.id) || '__anon';
    if (!cm[sid]) cm[sid] = [];
    cm[sid].unshift({ game, quizId: quizId || 'preset', won: !!won, score: Number(score) || 0, answers: Array.isArray(answers) ? answers : [], time: Date.now() });
    if (cm[sid].length > 200) cm[sid] = cm[sid].slice(0, 200);
    all[classId] = cm;
    localStorage.setItem(SCORE_KEY, JSON.stringify(all));
  } catch (e) {}
  if (uiMode === 'student' && studentSession && studentSession.classId === classId && studentTab === 'scores') renderStudentClass();
}

function classMastery(c) {
  const all = getAllClassScores(c.id);
  let total = 0, correct = 0;
  all.forEach(s => (s.answers || []).forEach(a => { total++; if (a.correct) correct++; }));
  return { total, correct, pct: total ? Math.round(correct / total * 100) : 0 };
}

/* ===================== Helpers ===================== */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cur = () => classes.find(c => c.id === activeId);
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 1800); }
const fmt = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  let code;
  do { code = Array.from(buf, n => chars[n % chars.length]).join(''); crypto.getRandomValues(buf); }
  while (classes.some(c => c.code === code));
  return code;
}
function openModal(html) { $('#modal').innerHTML = html; $('#scrim').classList.add('show'); const i = $('#modal input[type=text]'); if (i) i.focus(); }
function closeModal() { $('#scrim').classList.remove('show'); }
$('#scrim').addEventListener('click', e => { if (e.target.id === 'scrim') closeModal(); });
function ask(title, sub, label, cb, initial = '') {
  openModal(`<h3>${title}</h3><p class="sub">${sub}</p><input type="text" id="ask" value="${esc(initial)}" maxlength="120" placeholder="${label}">
  <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div>`);
  const go = () => { const v = $('#ask').value.trim(); if (!v) return; closeModal(); cb(v); };
  $('#modal [data-x]').onclick = closeModal; $('#modal [data-ok]').onclick = go;
  $('#ask').onkeydown = e => { if (e.key === 'Enter') go(); };
}

/* ===================== Teacher: class mgmt ===================== */
function createClass() {
  ask('Create class', 'Give your class a name. It gets its own join code.', 'Class name', name => {
    const c = { id: Date.now().toString(36), name, code: makeCode(), created: Date.now(),
      settings: { studentsCanPost: true, wallVisible: true }, opened: Date.now(),
      posts: [], shared: [], assignments: [], students: [], setupDone: false };
    classes.push(c); activeId = c.id; tab = 'activity'; save(); render();
  });
}
function showCode() {
  const c = cur(); c.codeShared = true; save();
  openModal(`<h3>Join class</h3><p class="sub">Students enter this code to join <b>${esc(c.name)}</b>.</p>
  <div class="code">${c.code}</div>
  <div class="foot"><button class="btn ghost" data-x>Close</button><button class="btn" data-copy>Copy code</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal [data-copy]').onclick = () => {
    (navigator.clipboard ? navigator.clipboard.writeText(c.code) : Promise.reject()).then(() => toast('Code copied'), () => toast('Select and copy'));
  };
}
function showSettings() {
  const c = cur(), s = c.settings;
  openModal(`<h3>Teacher settings</h3><p class="sub">${esc(c.name)}</p>
  <div class="set"><div>Allow students to post<small>Students can write on the wall</small></div><label class="sw"><input type="checkbox" id="s1" ${s.studentsCanPost ? 'checked' : ''}><span></span></label></div>
  <div class="set"><div>Show posts wall<small>Students can see the wall</small></div><label class="sw"><input type="checkbox" id="s2" ${s.wallVisible ? 'checked' : ''}><span></span></label></div>
  <div class="set"><div>Join code<small>${c.code}</small></div><button class="btn ghost" id="sc">Show</button></div>
  <div class="foot" style="margin-top:20px"><button class="btn danger" id="dc">Delete class</button><button class="btn" id="sv">Done</button></div>`);
  $('#s1').onchange = e => { s.studentsCanPost = e.target.checked; save(); render(); };
  $('#s2').onchange = e => { s.wallVisible = e.target.checked; save(); render(); };
  $('#sc').onclick = showCode;
  $('#sv').onclick = closeModal;
  $('#dc').onclick = () => { if (confirm('Delete "' + c.name + '"? This cannot be undone.')) {
    classes = classes.filter(x => x.id !== c.id); activeId = classes.length ? classes[0].id : null; save(); closeModal(); render(); } };
}
function addPost(text) { const c = cur(); if (!text.trim()) return; c.posts.unshift({ id: Date.now(), by: 'Teacher', text: text.trim(), time: Date.now() }); save(); render(); }
function addAssignment() { ask('New assignment', 'Students see it under Assignments.', 'Assignment title', t => { cur().assignments.unshift({ id: Date.now(), text: t, time: Date.now() }); cur().setupDone = true; tab = 'assignments'; save(); render(); }); }
function focusPost() { tab = 'activity'; render(); const t = $('#postBox'); if (t) t.focus(); }

function listHtml(items, key, empty, opts = {}) {
  if (!items.length) return `<div class="card"><div class="empty">${empty}</div></div>`;
  return `<div class="card">${items.map(i => {
    let extra = '';
    if (i.kind === 'quiz' && i.quizId) {
      extra = `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="playbtn battleship" data-play-quiz="${i.quizId}" data-game="battleship"><i class='bx bxs-ship'></i> Battleship</button>
        <button class="playbtn bubble" data-play-quiz="${i.quizId}" data-game="bubble"><i class='bx bxs-circle'></i> Bubble</button>
        <button class="playbtn asteroids" data-play-quiz="${i.quizId}" data-game="asteroids"><i class='bx bxs-planet'></i> Asteroids</button>
        ${opts.showStats ? `<button class="iconbtn-sm" data-stats-for="${i.id}" title="View stats" style="margin-left:auto;background:#E6EEFB;color:#2F65C8"><i class='bx bxs-bar-chart-alt-2'></i></button>` : ''}
      </div>`;
    }
    return `<div class="post"><div class="meta"><div class="avatar"><i class='bx bxs-user'></i></div><div><b>Teacher</b><small>${fmt(i.time)}${i.kind === 'quiz' ? ' · quiz' : ''}</small></div>
      <button class="del" data-del="${key}:${i.id}" aria-label="Delete"><i class='bx bx-trash'></i></button></div><p>${esc(i.text)}</p>${extra}</div>`;
  }).join('')}</div>`;
}

/* ===================== Teacher: dashboard ===================== */
function dashHtml(c) {
  const mastery = classMastery(c);
  const students = c.students || [];
  const allScores = getAllClassScores(c.id);
  const gamesPlayed = allScores.length;
  const pct = mastery.pct;
  const ringColor = pct >= 80 ? '#26890c' : pct >= 60 ? '#d89e00' : pct >= 40 ? '#f97316' : pct > 0 ? '#DB504A' : '#ccc';
  const heading = pct >= 80 ? 'Excellent mastery!' : pct >= 60 ? 'Good progress' : pct > 0 ? 'Still learning' : 'No data yet';
  const sub = mastery.total
    ? mastery.correct + ' of ' + mastery.total + ' quiz answers correct'
    : 'Students haven\'t played any quizzes yet.';
  const R = 44, C = 2 * Math.PI * R;
  const list = (items, empty) => items.length ? items.slice(0, 3).map(i => `<div class="li"><span>${esc(i.text)}</span><span>${fmt(i.time)}</span></div>`).join('') : `<div class="none">${empty}</div>`;
  const qsList = qsets.length ? qsets.slice(0, 3).map(q => `<div class="li"><span>${esc(q.title)}</span><span>${q.questions.length} Q</span></div>`).join('') : '<div class="none">No question sets yet. Make one in AI Quiz.</div>';
  const rosterList = students.length
    ? students.slice(0, 3).map(s => {
        const sc = getStudentScores(c.id, s.id);
        let tot = 0, cor = 0;
        sc.forEach(x => (x.answers || []).forEach(a => { tot++; if (a.correct) cor++; }));
        const m = tot ? Math.round(cor / tot * 100) : 0;
        return `<div class="li"><span><i class='bx bxs-user' style="margin-right:6px;color:var(--blue)"></i>${esc(s.name)}</span><span>${m}%</span></div>`;
      }).join('')
    : '<div class="none">No students yet. Share the join code.</div>';

  return `<div class="dmeta"><span>Class report</span><span>Created ${fmt(c.created)}</span></div>
  <div class="sumrow">
    <div class="sum ringbox">
      <div class="ring">
        <svg width="108" height="108">
          <circle cx="54" cy="54" r="${R}" fill="none" stroke="var(--grey)" stroke-width="9"/>
          <circle cx="54" cy="54" r="${R}" fill="none" stroke="${ringColor}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct / 100)}"/>
        </svg>
        <b>${pct}%<small>mastery</small></b>
      </div>
      <div><h3>${heading}</h3><p>${sub}</p><button class="btn" data-act="post">Create post</button></div>
    </div>
    <div class="sum">
      <div class="stat"><span><i class='bx bxs-user'></i>Students</span><b>${students.length}</b></div>
      <div class="stat"><span><i class='bx bxs-joystick'></i>Games played</span><b>${gamesPlayed}</b></div>
      <div class="stat"><span><i class='bx bxs-task'></i>Assignments</span><b>${c.assignments.length}</b></div>
    </div>
    <div class="sum promo"><small>Join code</small><div class="pc">${c.code}</div><button data-act="code">Join class</button></div>
  </div>
  <div class="sec">Class reports</div>
  <div class="reports">
    <div class="rep"><h4>Assignments (${c.assignments.length})</h4>${list(c.assignments, 'No assignments yet.')}<button class="seeall" data-tab="assignments">See all</button></div>
    <div class="rep"><h4>Posts (${c.posts.length})</h4>${list(c.posts, 'No posts yet.')}<button class="seeall" data-tab="activity">See all</button></div>
    <div class="rep"><h4><i class='bx bx-list-check' style="color:var(--blue);margin-right:6px"></i>Questions (${qsets.length})</h4>${qsList}<button class="seeall" data-goto-qs>See all</button></div>
    <div class="rep"><h4><i class='bx bxs-user' style="color:var(--blue);margin-right:6px"></i>Students (${students.length})</h4>${rosterList}${students.length ? `<button class="seeall" data-show-roster>See all</button>` : ''}</div>
  </div>`;
}

/* ===================== Teacher: roster modal ===================== */
function showRoster() {
  const c = cur(); if (!c) return;
  const students = c.students || [];
  if (!students.length) return toast('No students yet');
  const rows = students.map(s => {
    const scores = getStudentScores(c.id, s.id);
    let total = 0, correct = 0;
    scores.forEach(sc => (sc.answers || []).forEach(a => { total++; if (a.correct) correct++; }));
    return { s, games: scores.length, mastery: total ? Math.round(correct / total * 100) : 0 };
  });
  openModal(`<h3>Students in ${esc(c.name)}</h3><p class="sub">${rows.length} student${rows.length === 1 ? '' : 's'} · sorted by join date</p>
    <div style="max-height:52vh;overflow-y:auto;margin-bottom:14px">
      ${rows.map(r => `
        <div style="padding:12px 0;border-bottom:1px solid var(--grey);display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:50%;background:var(--light-blue);color:var(--blue);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex:none">${esc((r.s.name.match(/\d+/) || ['?'])[0])}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600;color:var(--dark)">${esc(r.s.name)}</div>
            <div style="font-size:12px;color:var(--dark-grey)">${r.games} game${r.games === 1 ? '' : 's'} · Joined ${fmt(r.s.joinedAt)}</div>
          </div>
          <div style="text-align:right"><div style="font-size:18px;font-weight:700;color:var(--blue)">${r.mastery}%</div><div style="font-size:11px;color:var(--dark-grey);text-transform:uppercase;letter-spacing:.04em">mastery</div></div>
        </div>`).join('')}
    </div>
    <div class="foot"><button class="btn ghost" data-x>Close</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
}

/* ===================== Teacher: assignment stats ===================== */
function showAssignmentStats(a) {
  const c = cur(); if (!c || !a || a.kind !== 'quiz' || !a.quizId) return toast('No stats for this assignment');
  const quizId = a.quizId;
  const qset = qsets.find(q => q.id === quizId);
  const questions = qset ? qset.questions : [];
  const students = c.students || [];

  const perStudent = students.map(s => {
    const scores = getStudentScores(c.id, s.id).filter(x => x.quizId === quizId);
    let total = 0, correct = 0;
    scores.forEach(sc => (sc.answers || []).forEach(ans => { total++; if (ans.correct) correct++; }));
    return { s, plays: scores.length, total, correct, scores };
  }).filter(p => p.plays > 0);

  const totalAnswers = perStudent.reduce((s, p) => s + p.total, 0);
  const totalCorrect = perStudent.reduce((s, p) => s + p.correct, 0);
  const pct = totalAnswers ? Math.round(totalCorrect / totalAnswers * 100) : 0;

  const qTotals = {}, qWrongs = {}, qMissedBy = {};
  perStudent.forEach(p => p.scores.forEach(sc => (sc.answers || []).forEach(ans => {
    qTotals[ans.qIdx] = (qTotals[ans.qIdx] || 0) + 1;
    if (!ans.correct) {
      qWrongs[ans.qIdx] = (qWrongs[ans.qIdx] || 0) + 1;
      if (!qMissedBy[ans.qIdx]) qMissedBy[ans.qIdx] = new Set();
      qMissedBy[ans.qIdx].add(p.s.name);
    }
  })));

  let worstQ = null, worstPct = 0;
  Object.keys(qTotals).forEach(qi => {
    const total = qTotals[qi], wrong = qWrongs[qi] || 0;
    const p = total ? wrong / total : 0;
    if (p > worstPct) { worstPct = p; worstQ = parseInt(qi, 10); }
  });

  let worstStudent = null, worstStudentWrong = 0;
  perStudent.forEach(p => {
    const wrong = p.total - p.correct;
    if (wrong > worstStudentWrong) { worstStudentWrong = wrong; worstStudent = p; }
  });

  const playedNames = perStudent.map(p => p.s.name).join(', ') || 'No one has played yet';

  let worstQBlock = '';
  if (worstQ !== null && worstPct > 0 && questions[worstQ]) {
    const missedNames = Array.from(qMissedBy[worstQ] || []).join(', ');
    worstQBlock = `<div style="margin-top:16px;padding:14px;background:#fff6d6;border-radius:10px;border-left:4px solid #d89e00">
      <div style="font-weight:700;font-size:13px;color:#8a6b00;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Most missed question</div>
      <div style="font-size:15px;color:var(--dark);margin-bottom:8px">${esc(questions[worstQ].question)}</div>
      <div style="font-size:13px;color:var(--dark)"><b>${Math.round(worstPct * 100)}%</b> missed (${qWrongs[worstQ] || 0} of ${qTotals[worstQ]} attempts)</div>
      <div style="font-size:12px;color:var(--dark-grey);margin-top:6px">Missed by: ${esc(missedNames)}</div>
    </div>`;
  }

  let worstStudentBlock = '';
  if (worstStudent && worstStudentWrong > 0) {
    worstStudentBlock = `<div style="margin-top:12px;padding:14px;background:#fde8e6;border-radius:10px;border-left:4px solid #8a2721">
      <div style="font-weight:700;font-size:13px;color:#8a2721;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em">Most misses</div>
      <div style="font-size:15px;color:var(--dark)"><b>${esc(worstStudent.s.name)}</b> — ${worstStudentWrong} incorrect answer${worstStudentWrong === 1 ? '' : 's'}</div>
    </div>`;
  }

  openModal(`<h3>Assignment stats</h3><p class="sub">${esc(a.text)}</p>
    <div style="padding:16px;background:var(--light-blue);border-radius:10px;margin-bottom:16px">
      <div style="font-size:12px;color:var(--dark-grey);text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Played by</div>
      <div style="font-size:15px;color:var(--dark);font-weight:600">${perStudent.length} student${perStudent.length === 1 ? '' : 's'}</div>
      <div style="font-size:13px;color:var(--dark-grey);margin-top:6px">${esc(playedNames)}</div>
    </div>
    <div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--dark-grey);margin-bottom:6px"><span>Questions answered correctly</span><span><b style="color:var(--blue);font-size:15px">${pct}%</b></span></div>
      <div style="height:14px;background:var(--grey);border-radius:8px;overflow:hidden"><div style="height:100%;background:linear-gradient(90deg,#26890c,#4ab54b);width:${pct}%;transition:width .3s"></div></div>
      <div style="font-size:12px;color:var(--dark-grey);margin-top:4px">${totalCorrect} of ${totalAnswers} correct</div>
    </div>
    ${worstQBlock}
    ${worstStudentBlock}
    <div class="foot" style="margin-top:20px"><button class="btn ghost" data-x>Close</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
}

/* ===================== Teacher: main render ===================== */
function render() {
  $('#classes').classList.toggle('railclosed', !railOpen);
  const btn = c => `<button class="cls ${c.id === activeId ? 'on' : ''}" data-id="${c.id}">${esc(c.name)}</button>`;
  $('#ownedList').innerHTML = classes.length ? classes.map(btn).join('') : '<div class="hint">No classes yet</div>';
  $('#ownedList').classList.toggle('closed', !ownOpen);
  $('#ownBtn').classList.toggle('closed', !ownOpen);
  $('#ownBtn').setAttribute('aria-expanded', ownOpen);
  $('#ownCount').textContent = '(' + classes.length + ')';
  const recent = classes.filter(c => c.opened).sort((a, b) => b.opened - a.opened).slice(0, 3);
  $('#classList').innerHTML = recent.length ? recent.map(btn).join('') : '<div class="hint" style="padding-left:10px">Classes you open show up here</div>';
  const v = $('#classView'), c = cur();
  if (!c) {
    v.innerHTML = `<div class="nothing"><i class='bx bxs-graduation' style="font-size:64px"></i><h2 style="margin:8px 0">No classes yet</h2><p style="margin-bottom:20px">Create your first class to get a join code for your students.</p><button class="btn" id="firstClass">Create class</button></div>`;
    $('#firstClass').onclick = createClass;
  } else {
    let body = '';
    if (tab === 'activity') {
      body = `<div class="card"><div class="composer"><div class="avatar"><i class='bx bxs-user'></i></div><textarea id="postBox" placeholder="Post something"></textarea></div>
        <div class="actions"><button data-act="post"><i class='bx bx-message-rounded'></i>Create post</button><button data-act="share"><i class='bx bx-share-alt'></i>Share</button><button data-act="assign"><i class='bx bx-task'></i>Assign</button></div></div>`;
      if (!(c.posts.length && c.assignments.length)) body += `<div class="card setup"><div class="hd"><span>Set up your class</span></div>
        <div class="cards"><button data-act="code"><i class='bx bx-user-plus'></i>Invite members</button><button data-act="assign"><i class='bx bx-task'></i>Assign</button><button data-act="post"><i class='bx bx-news'></i>Create post</button></div></div>`;
      body += `<h3 style="margin:8px 0 12px">Posts wall<span class="badge">${c.settings.studentsCanPost ? 'Students can post' : 'Only you can post'}</span></h3>`;
      if (!c.settings.wallVisible) body += `<div class="card"><div class="wall-off">The wall is hidden from students. Only you can see it.</div></div>`;
      body += listHtml(c.posts, 'posts', 'No posts yet. Write the first one above.');
    } else if (tab === 'dashboard') {
      body = dashHtml(c);
    } else {
      body = `<div class="assign-panel">
        <div class="ap-icon"><i class='bx bx-task'></i></div>
        <div class="ap-info"><b>Assign a quiz</b><small>${qsets.length ? qsets.length + ' question set' + (qsets.length === 1 ? '' : 's') + ' available.' : 'No question sets yet — make one in AI Quiz.'}</small></div>
        <div class="ap-actions">
          <button class="btn" id="assignQuizBtn"><i class='bx bx-plus'></i> Assign quiz</button>
          <button class="btn ghost" id="assignTextBtn"><i class='bx bx-text'></i> Text assignment</button>
        </div>
      </div>`;
      body += listHtml(c.assignments, 'assignments', 'No assignments yet. Use "Assign quiz" above to add one.', { showStats: true });
    }
    v.innerHTML = `<div class="ctop"><h1>${esc(c.name)}</h1><div class="tools"><i class='bx bx-list-check' id="qsShortcut" title="Question sets" tabindex="0" style="cursor:pointer"></i><div class="avatar" style="background:#aaa;width:48px;height:48px"><i class='bx bxs-user'></i></div><i class='bx bx-cog' id="gear" title="Teacher settings" tabindex="0"></i></div></div>
      <div class="row"><div class="tabs">${['activity','dashboard','assignments'].map(t => `<button data-tab="${t}" class="${tab === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>
      <button class="btn" id="joinBtn">Join class</button></div>${body}`;
  }
  route();
}

function pick(e) { const b = e.target.closest('[data-id]'); if (!b) return; activeId = b.dataset.id; cur().opened = Date.now(); save(); tab = 'activity'; render(); }
$('#classList').addEventListener('click', pick);
$('#ownedList').addEventListener('click', pick);
function setRail(v) { railOpen = v; try { localStorage.setItem('adminhub_rail_open', v ? '1' : '0'); } catch (e) {} render(); }
$('#railClose').onclick = () => setRail(false);
$('#railOpen').onclick = () => setRail(true);
$('#ownBtn').onclick = () => { ownOpen = !ownOpen; try { localStorage.setItem('adminhub_owned_open', ownOpen ? '1' : '0'); } catch (e) {} render(); };
$('#createClass').onclick = createClass;

$('#classView').addEventListener('click', e => {
  if (e.target.closest('[data-show-roster]')) { showRoster(); return; }
  if (e.target.closest('[data-goto-qs]')) { nav = 'questions'; renderQuestionSets(); route(); return; }
  if (e.target.closest('#qsShortcut')) { nav = 'questions'; renderQuestionSets(); route(); return; }
  if (e.target.closest('#assignQuizBtn')) return pickAndAssignQuiz();
  if (e.target.closest('#assignTextBtn')) return addAssignment();
  const sb = e.target.closest('[data-stats-for]');
  if (sb) { const a = cur().assignments.find(x => String(x.id) === sb.dataset.statsFor); if (a) showAssignmentStats(a); return; }
  const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; render(); return; }
  if (e.target.closest('#joinBtn')) return showCode();
  if (e.target.closest('#gear')) return showSettings();
  const pq = e.target.closest('[data-play-quiz]'); if (pq) { const qs = getQuestionSets().find(x => x.id === pq.dataset.playQuiz); openGame(pq.dataset.game || 'battleship', qs || null); return; }
  const d = e.target.closest('[data-del]'); if (d) { const [k, id] = d.dataset.del.split(':'); const c = cur(); c[k] = c[k].filter(x => String(x.id) !== id); save(); return render(); }
  const a = e.target.closest('[data-act]'); if (!a) return;
  ({ post: focusPost, share: showCode, assign: addAssignment, code: showCode })[a.dataset.act]();
});
$('#classView').addEventListener('keydown', e => { if (e.target.id === 'postBox' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addPost(e.target.value); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeAuthPopup(); } });

const sidebar = $('#sidebar');
$('#content nav .bx-menu').onclick = () => sidebar.classList.toggle('hide');
function adjust() { sidebar.classList.toggle('hide', window.innerWidth <= 576); }
addEventListener('load', adjust); addEventListener('resize', adjust);
$('#notificationIcon').onclick = e => { e.preventDefault(); $('#notificationMenu').classList.toggle('show'); $('#profileMenu').classList.remove('show'); };
$('#profileIcon').onclick = e => { e.preventDefault(); $('#profileMenu').classList.toggle('show'); $('#notificationMenu').classList.remove('show'); };
addEventListener('click', e => { if (!e.target.closest('.notification') && !e.target.closest('.profile')) document.querySelectorAll('.dd').forEach(d => d.classList.remove('show')); });

document.getElementById('modeToggle').addEventListener('click', e => {
  const btn = e.target.closest('[data-mode]'); if (!btn) return;
  const mode = btn.dataset.mode; if (mode === uiMode) return;
  uiMode = mode; saveUiMode();
  document.querySelectorAll('#modeToggle button').forEach(b => b.classList.toggle('on', b.dataset.mode === uiMode));
  route(); updateStudentSidebarExtras();
});

/* ===================== Router ===================== */
function route() {
  const tm = document.querySelector('.side-menu.teacher-menu'), sm = document.querySelector('.side-menu.student-menu');
  if (tm) tm.style.display = uiMode === 'teacher' ? '' : 'none';
  if (sm) sm.style.display = uiMode === 'student' ? '' : 'none';
  if (uiMode === 'student') {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
    if (studentSession) { const sv = document.getElementById('studentClassView'); if (sv) sv.classList.add('on'); renderStudentClass(); }
    else { const jv = document.getElementById('studentJoinView'); if (jv) jv.classList.add('on'); renderStudentJoin(); }
    updateStudentSidebarExtras();
    return;
  }
  const sj = document.getElementById('studentJoinView'), sc = document.getElementById('studentClassView');
  if (sj) sj.classList.remove('on');
  if (sc) sc.classList.remove('on');
  VIEWS.forEach(v => { const el = document.querySelector('.view[data-view="' + v + '"]'); if (el) el.classList.toggle('on', nav === v); });
  document.querySelectorAll('#sidebar .teacher-menu li').forEach(li => li.classList.toggle('active', (li.dataset.view || '') === nav));
  updateStudentSidebarExtras();
}
document.querySelectorAll('#sidebar .teacher-menu li').forEach(li => {
  const a = li.querySelector('a'); if (!a) return;
  a.addEventListener('click', e => {
    e.preventDefault();
    const v = li.dataset.view; if (!v) return;
    nav = v;
    if (v === 'ai') { renderChat(); ensureAuth().then(() => { updateAuthBadge(); updateLogoutVisibility(); }).catch(() => {}); }
    if (v === 'questions') renderQuestionSets();
    route();
  });
});

/* ===================== Student side ===================== */
function updateStudentSidebarExtras() {
  const lb = document.getElementById('studentLeaveBtn');
  if (lb) lb.style.display = (uiMode === 'student' && studentSession) ? '' : 'none';
}

function registerStudentInClass(c) {
  if (!c.students) c.students = [];
  let existing = c.students.find(s => s.id === studentIdentity.id);
  if (existing) {
    existing.lastSeen = Date.now();
    if (!studentIdentity.name) { studentIdentity.name = existing.name; saveStudentIdentity(); }
    return existing.name;
  }
  const takenNames = new Set(c.students.map(s => s.name));
  let name = studentIdentity.name;
  if (!name || takenNames.has(name)) {
    let n = 1; while (takenNames.has('Student ' + n)) n++;
    name = 'Student ' + n;
  }
  studentIdentity.name = name; saveStudentIdentity();
  c.students.push({ id: studentIdentity.id, name, joinedAt: Date.now(), lastSeen: Date.now() });
  save();
  return name;
}

function renderStudentJoin() {
  const input = document.getElementById('joinCodeInput'), btn = document.getElementById('joinCodeBtn'), err = document.getElementById('joinCodeError');
  if (!input || !btn) return;
  input.value = '';
  if (err) { err.style.display = 'none'; err.textContent = ''; }
  const submit = () => {
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    const c = classes.find(x => x.code === code);
    if (!c) { if (err) { err.textContent = 'No class found with that code. Check with your teacher.'; err.style.display = 'block'; } return; }
    if (err) err.style.display = 'none';
    studentSession = { classId: c.id, joinedAt: Date.now(), studentId: studentIdentity.id };
    saveStudentSession();
    registerStudentInClass(c);
    c.opened = Date.now(); save();
    studentTab = 'home';
    toast('Joined ' + c.name);
    route(); updateStudentSidebarExtras();
  };
  btn.onclick = submit;
  input.onkeydown = e => { if (e.key === 'Enter') submit(); };
  setTimeout(() => input.focus(), 100);
}

function leaveStudentClass() {
  if (!studentSession) return;
  const c = classes.find(x => x.id === studentSession.classId);
  if (!c) { studentSession = null; saveStudentSession(); route(); updateStudentSidebarExtras(); return; }
  openModal(`<h3>Leave ${esc(c.name)}?</h3>
    <p class="sub" style="margin-bottom:16px">You'll need the class code your teacher gave you to rejoin.</p>
    <div style="padding:12px 14px;background:#fff6d6;border-radius:8px;border-left:3px solid #d89e00;font-size:13px;color:#5a4100;margin-bottom:16px">
      <b>Before you leave,</b> make sure your teacher knows. Leaving by mistake means asking them for the code again.
    </div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn danger" data-confirm>Yes, continue</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal [data-confirm]').onclick = () => {
    openModal(`<h3>Are you absolutely sure?</h3>
      <p class="sub" style="margin-bottom:16px">Ask your teacher to confirm. Only click leave if they know you're leaving this class.</p>
      <div style="padding:12px 14px;background:#fde8e6;border-radius:8px;border-left:3px solid #8a2721;font-size:13px;color:#5a1a16;margin-bottom:16px">
        Your scores and progress will stay with the class for your teacher, but you won't see the class until you rejoin.
      </div>
      <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn danger" data-final>I'm sure, leave class</button></div>`);
    $('#modal [data-x]').onclick = closeModal;
    $('#modal [data-final]').onclick = () => {
      studentSession = null; saveStudentSession(); closeModal(); toast('Left class');
      route(); updateStudentSidebarExtras();
    };
  };
}
document.getElementById('studentLeaveBtn').addEventListener('click', e => { e.preventDefault(); leaveStudentClass(); });

window.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object' || d.type !== 'gameEnd') return;
  if (uiMode !== 'student' || !studentSession) return;
  recordScore(studentSession.classId, d.game || 'unknown', d.quizId || 'preset', !!d.won, d.score, d.answers || []);
});

function renderStudentClass() {
  const inner = document.getElementById('studentClassInner');
  if (!inner) return;
  if (!studentSession) { route(); return; }
  const c = classes.find(x => x.id === studentSession.classId);
  if (!c) {
    inner.innerHTML = `<div class="student-join-wrap"><div class="student-join-card">
      <div class="sj-icon" style="background:#fde8e6;color:#8a2721"><i class='bx bx-error-circle'></i></div>
      <h1>Class unavailable</h1><p>Your teacher's class is no longer available. You can join a different class with a new code.</p>
      <button class="btn" id="studentResetBtn">Join a different class</button>
    </div></div>`;
    const b = document.getElementById('studentResetBtn');
    if (b) b.onclick = () => { studentSession = null; saveStudentSession(); route(); updateStudentSidebarExtras(); };
    return;
  }
  const scores = getStudentScores(c.id, studentIdentity.id);
  const tabs = [
    { id: 'home', label: 'Home', icon: 'bxs-graduation' },
    { id: 'posts', label: 'Posts', icon: 'bxs-message-rounded' },
    { id: 'assignments', label: 'Assignments', icon: 'bxs-task' },
    { id: 'practice', label: 'Practice', icon: 'bxs-book' },
    { id: 'scores', label: 'My scores', icon: 'bxs-bar-chart-alt-2' }
  ];
  const activeTab = tabs.find(t => t.id === studentTab) ? studentTab : 'home';

  inner.innerHTML = `
    <div class="student-class-hd">
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="cls-meta"><span class="student-name-pill"><i class='bx bxs-user'></i> ${esc(studentIdentity.name || 'Student')}</span> &nbsp; <span class="student-badge"><i class='bx bxs-graduation'></i> Class code ${esc(c.code)}</span></div>
      </div>
    </div>
    <div class="row"><div class="tabs">
      ${tabs.map(t => `<button data-student-tab="${t.id}" class="${activeTab === t.id ? 'on' : ''}"><i class='bx ${t.icon}'></i>${t.label}</button>`).join('')}
    </div></div>
    <div id="studentTabBody"></div>`;

  inner.querySelectorAll('[data-student-tab]').forEach(b => { b.onclick = () => { studentTab = b.dataset.studentTab; renderStudentClass(); }; });
  const body = document.getElementById('studentTabBody');
  if (activeTab === 'home') renderStudentHome(c, scores);
  else if (activeTab === 'posts') renderStudentPosts(c);
  else if (activeTab === 'assignments') renderStudentAssignments(c);
  else if (activeTab === 'practice') renderStudentPractice(c);
  else if (activeTab === 'scores') renderStudentScores(c, scores);
}

function renderStudentHome(c, scores) {
  const body = document.getElementById('studentTabBody');
  const wins = scores.filter(s => s.won).length;
  const showWall = c.settings && c.settings.wallVisible !== false;
  const nextAssign = c.assignments[0] || null;
  const recentPosts = showWall ? c.posts.slice(0, 3) : [];
  const practiceSets = qsets.filter(q => q.practiceAllowed !== false);

  let nextAssignBlock = '';
  if (nextAssign) {
    nextAssignBlock = `<div class="shsection">
      <h3><i class='bx bxs-task'></i> Latest assignment</h3>
      <div class="shline">
        <div class="shl-icon"><i class='bx bxs-task'></i></div>
        <div class="shl-info"><b>${esc(nextAssign.text)}</b><small>${fmt(nextAssign.time)}${nextAssign.kind === 'quiz' ? ' · quiz' : ''}</small></div>
        ${nextAssign.kind === 'quiz' && nextAssign.quizId ? `<div class="shl-actions"><button class="playbtn battleship" data-student-play="${nextAssign.quizId}" data-game="battleship"><i class='bx bxs-ship'></i> Play</button></div>` : ''}
      </div>
      <button class="seeall" data-student-tab-link="assignments">See all assignments</button>
    </div>`;
  }

  let postsBlock = '';
  if (recentPosts.length) {
    postsBlock = `<div class="shsection">
      <h3><i class='bx bxs-message-rounded'></i> Recent posts</h3>
      ${recentPosts.map(p => `<div class="shline"><div class="shl-icon"><i class='bx bxs-user'></i></div><div class="shl-info"><b>${esc(p.text.length > 80 ? p.text.slice(0, 80) + '…' : p.text)}</b><small>${fmt(p.time)}</small></div></div>`).join('')}
      <button class="seeall" data-student-tab-link="posts">See posts wall</button>
    </div>`;
  } else if (!showWall) {
    postsBlock = `<div class="shsection"><h3><i class='bx bxs-message-rounded'></i> Recent posts</h3><div class="student-empty">Your teacher has hidden the posts wall for now.</div></div>`;
  }

  body.innerHTML = `
    <div class="shwelcome"><h1>Hi ${esc(studentIdentity.name || 'there')}, welcome to ${esc(c.name)}!</h1><p>Everything your teacher posts and assigns will show up here.</p></div>
    <div class="shgrid">
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-message-rounded'></i></div><b>${showWall ? c.posts.length : '—'}</b><small>Posts</small></div>
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-task'></i></div><b>${c.assignments.length}</b><small>Assignments</small></div>
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-trophy'></i></div><b>${wins}</b><small>Wins</small></div>
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-joystick'></i></div><b>${scores.length}</b><small>Games played</small></div>
    </div>
    ${nextAssignBlock}
    ${postsBlock}
    <div class="shsection">
      <h3><i class='bx bxs-book'></i> Quick practice</h3>
      <p style="color:var(--dark-grey);font-size:14px;margin-bottom:12px">Play a game with any question set your teacher opened for practice.</p>
      <div class="shquick">
        ${practiceSets.length ? practiceSets.slice(0, 3).map(q => `<button class="playbtn battleship" data-student-play="${q.id}" data-game="battleship"><i class='bx bxs-ship'></i> ${esc(q.title)}</button>`).join('') : '<div class="student-empty" style="padding:12px">No practice sets available yet.</div>'}
      </div>
    </div>`;
  wireStudentBodyHandlers();
}

function renderStudentPosts(c) {
  const body = document.getElementById('studentTabBody');
  if (!(c.settings && c.settings.wallVisible !== false)) { body.innerHTML = `<div class="card"><div class="student-empty">Your teacher has hidden the posts wall for now.</div></div>`; return; }
  if (!c.posts.length) { body.innerHTML = `<div class="card"><div class="student-empty">No posts yet.</div></div>`; return; }
  body.innerHTML = `<div class="card">${c.posts.map(p => `<div class="student-post"><div class="meta"><div class="avatar"><i class='bx bxs-user'></i></div><div><b>${esc(p.by || 'Teacher')}</b><small>${fmt(p.time)}</small></div></div><p>${esc(p.text)}</p></div>`).join('')}</div>`;
}

function renderStudentAssignments(c) {
  const body = document.getElementById('studentTabBody');
  if (!c.assignments.length) { body.innerHTML = `<div class="card"><div class="student-empty">No assignments yet. Check back soon!</div></div>`; return; }
  body.innerHTML = `<div class="card">${c.assignments.map(a => `<div class="student-post">
    <div class="meta"><div class="avatar" style="background:#2F65C8"><i class='bx bxs-task'></i></div><div><b>Assignment</b><small>${fmt(a.time)}${a.kind === 'quiz' ? ' · quiz' : ''}</small></div></div>
    <p>${esc(a.text)}</p>
    ${a.kind === 'quiz' && a.quizId ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="playbtn battleship" data-student-play="${a.quizId}" data-game="battleship"><i class='bx bxs-ship'></i> Battleship</button>
      <button class="playbtn bubble" data-student-play="${a.quizId}" data-game="bubble"><i class='bx bxs-circle'></i> Bubble</button>
      <button class="playbtn asteroids" data-student-play="${a.quizId}" data-game="asteroids"><i class='bx bxs-planet'></i> Asteroids</button>
    </div>` : ''}
  </div>`).join('')}</div>`;
  wireStudentBodyHandlers();
}

function renderStudentPractice(c) {
  const body = document.getElementById('studentTabBody');
  const available = qsets.filter(q => q.practiceAllowed !== false);
  if (!available.length) { body.innerHTML = `<div class="qb-empty"><i class='bx bxs-book'></i><h3>No practice sets yet</h3><p style="margin:8px 0 16px">Your teacher hasn't opened any question sets for practice.</p></div>`; return; }
  body.innerHTML = available.map(qs => `<div class="qset">
    <div class="top"><div class="info"><b>${esc(qs.title)}</b><small>${qs.questions.length} questions${qs.grade ? ' · ' + esc(qs.grade) : ''}${qs.difficulty ? ' · ' + esc(qs.difficulty) : ''}</small></div></div>
    <div class="playrow">
      <button class="playbtn battleship" data-student-play="${qs.id}" data-game="battleship"><i class='bx bxs-ship'></i> Battleship</button>
      <button class="playbtn bubble" data-student-play="${qs.id}" data-game="bubble"><i class='bx bxs-circle'></i> Bubble Shooter</button>
      <button class="playbtn asteroids" data-student-play="${qs.id}" data-game="asteroids"><i class='bx bxs-planet'></i> Asteroids</button>
    </div>
  </div>`).join('');
  wireStudentBodyHandlers();
}

function renderStudentScores(c, scores) {
  const body = document.getElementById('studentTabBody');
  if (!scores.length) { body.innerHTML = `<div class="card"><div class="student-empty"><i class='bx bxs-bar-chart-alt-2' style="font-size:42px;color:var(--blue);display:block;margin-bottom:12px"></i>No games played yet. Try one from Practice!</div></div>`; return; }
  const wins = scores.filter(s => s.won).length;
  let total = 0, correct = 0;
  scores.forEach(s => (s.answers || []).forEach(a => { total++; if (a.correct) correct++; }));
  const mastery = total ? Math.round(correct / total * 100) : 0;
  const gameNames = { battleship: 'Battleship', bubble: 'Bubble Shooter', asteroids: 'Asteroids' };
  body.innerHTML = `
    <div class="shgrid" style="margin-bottom:16px">
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-trophy'></i></div><b>${wins}</b><small>Wins</small></div>
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-joystick'></i></div><b>${scores.length}</b><small>Games</small></div>
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-star'></i></div><b>${mastery}%</b><small>Question mastery</small></div>
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-bar-chart-alt-2'></i></div><b>${scores.length ? Math.round(wins / scores.length * 100) : 0}%</b><small>Win rate</small></div>
    </div>
    <div class="card" style="padding:0 20px">
      ${scores.map(s => `<div class="score-row">
        <div class="sr-badge ${s.won ? 'win' : 'lose'}"><i class='bx ${s.won ? 'bxs-check' : 'bx-x'}'></i></div>
        <div class="sr-info"><b>${esc(gameNames[s.game] || s.game)}</b><small>${s.won ? 'Won' : 'Lost'} · ${fmt(s.time)}</small></div>
        <div class="sr-score">${s.score || 0}</div>
      </div>`).join('')}
    </div>`;
}

function wireStudentBodyHandlers() {
  const inner = document.getElementById('studentClassInner'); if (!inner) return;
  inner.querySelectorAll('[data-student-tab-link]').forEach(b => { b.onclick = () => { studentTab = b.dataset.studentTabLink; renderStudentClass(); }; });
  inner.querySelectorAll('[data-student-play]').forEach(b => { b.onclick = () => { const qs = qsets.find(x => x.id === b.dataset.studentPlay); openGame(b.dataset.game, qs || null); }; });
}

/* ===================== Questions storage ===================== */
const QKEY = 'adminhub_questions_v2';
let qsets = [];
try { const r = localStorage.getItem(QKEY); if (r) qsets = JSON.parse(r); } catch (e) {}
function saveQSets() { try { localStorage.setItem(QKEY, JSON.stringify(qsets)); } catch (e) {} }
function getQuestionSets() { return qsets; }
function addQuestionSet(set) {
  set.id = set.id || 'qs_' + Date.now().toString(36);
  set.created = set.created || Date.now();
  qsets.unshift(set); saveQSets();
  toast('Saved "' + set.title + '" · ' + set.questions.length + ' questions');
  if (nav === 'questions') renderQuestionSets();
}

const PRESET_QUESTIONS = [
  { question: "Which planet is known as the Red Planet?", options: ["Venus","Mars","Jupiter","Mercury"], correct: 1, timeLimit: 20, explanation: "Iron oxide on Mars gives it a red color." },
  { question: "What is the largest ocean on Earth?", options: ["Atlantic","Indian","Arctic","Pacific"], correct: 3, timeLimit: 20, explanation: "The Pacific covers about a third of the planet." },
  { question: "How many continents are there?", options: ["5","6","7","8"], correct: 2, timeLimit: 15, explanation: "Africa, Antarctica, Asia, Australia, Europe, N. America, S. America." },
  { question: "Who wrote Romeo and Juliet?", options: ["Charles Dickens","William Shakespeare","Jane Austen","Mark Twain"], correct: 1, timeLimit: 20, explanation: "Shakespeare wrote it around 1595." },
  { question: "What gas do plants absorb from the air?", options: ["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"], correct: 2, timeLimit: 20, explanation: "Plants take in CO2 for photosynthesis." },
  { question: "What is the capital of France?", options: ["Lyon","Marseille","Paris","Nice"], correct: 2, timeLimit: 15, explanation: "Paris has been the capital since the 10th century." },
  { question: "Which is the longest river in the world?", options: ["Amazon","Nile","Yangtze","Mississippi"], correct: 1, timeLimit: 25, explanation: "The Nile is traditionally measured as the longest." },
  { question: "What is 7 × 8?", options: ["54","56","58","64"], correct: 1, timeLimit: 10, explanation: "7 × 8 = 56." },
  { question: "Which animal is the largest mammal?", options: ["Elephant","Blue whale","Giraffe","Hippopotamus"], correct: 1, timeLimit: 15, explanation: "Blue whales can reach 30 meters." },
  { question: "In which year did WWII end?", options: ["1943","1944","1945","1946"], correct: 2, timeLimit: 20, explanation: "WWII ended in 1945." }
];

/* ===================== Questions view (teacher) ===================== */
function renderQuestionSets() {
  const list = $('#qsList');
  if (!qsets.length) {
    list.innerHTML = `<div class="qb-empty"><i class='bx bx-list-check'></i><h3>No question sets yet</h3><p style="margin:8px 0 16px">Head to the AI Quiz tab and make one — it'll appear here.</p><button class="btn" id="qsEmptyGo">Open AI Quiz</button></div>`;
    const b = $('#qsEmptyGo'); if (b) b.onclick = () => { nav = 'ai'; renderChat(); ensureAuth().then(updateAuthBadge).catch(()=>{}); route(); };
    return;
  }
  list.innerHTML = qsets.map(qs => {
    const practiceOn = qs.practiceAllowed !== false;
    return `<div class="qset">
      <div class="top">
        <div class="info"><b>${esc(qs.title)}</b><small>${qs.questions.length} questions · ${fmt(qs.created)}${qs.assignedTo ? ' · assigned to ' + qs.assignedTo.length : ''}${practiceOn ? '' : ' · practice hidden'}</small></div>
        <div class="acts">
          <button class="iconbtn-sm ${practiceOn ? '' : 'hidden-practice'}" data-toggle-practice="${qs.id}" title="${practiceOn ? 'Hide from student practice' : 'Show in student practice'}"><i class='bx ${practiceOn ? 'bxs-show' : 'bx-hide'}'></i></button>
          <button class="iconbtn-sm" data-assign="${qs.id}" title="Assign to a class"><i class='bx bx-task'></i></button>
          <button class="iconbtn-sm" data-edit="${qs.id}" title="Edit questions"><i class='bx bx-edit'></i></button>
          <button class="iconbtn-sm danger" data-delqs="${qs.id}" title="Delete set"><i class='bx bx-trash'></i></button>
        </div>
      </div>
      <div class="playrow">
        <button class="playbtn battleship" data-play="${qs.id}" data-game="battleship"><i class='bx bxs-ship'></i> Battleship</button>
        <button class="playbtn bubble" data-play="${qs.id}" data-game="bubble"><i class='bx bxs-circle'></i> Bubble Shooter</button>
        <button class="playbtn asteroids" data-play="${qs.id}" data-game="asteroids"><i class='bx bxs-planet'></i> Asteroids</button>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('[data-play]').forEach(b => b.onclick = () => { const qs = qsets.find(x => x.id === b.dataset.play); openGame(b.dataset.game, qs); });
  list.querySelectorAll('[data-toggle-practice]').forEach(b => b.onclick = () => {
    const qs = qsets.find(x => x.id === b.dataset.togglePractice); if (!qs) return;
    qs.practiceAllowed = qs.practiceAllowed === false; saveQSets(); renderQuestionSets();
    toast('Practice ' + (qs.practiceAllowed === false ? 'hidden' : 'shown'));
  });
  list.querySelectorAll('[data-assign]').forEach(b => b.onclick = () => assignQuiz(b.dataset.assign));
  list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editQuiz(b.dataset.edit));
  list.querySelectorAll('[data-delqs]').forEach(b => b.onclick = () => { if (!confirm('Delete this question set?')) return; qsets = qsets.filter(x => x.id !== b.dataset.delqs); saveQSets(); renderQuestionSets(); });
}
$('#qsToAI').onclick = () => { nav = 'ai'; renderChat(); ensureAuth().then(updateAuthBadge).catch(()=>{}); route(); };

function assignQuiz(qsId) {
  const qs = qsets.find(x => x.id === qsId); if (!qs) return;
  if (!classes.length) return toast('Create a class first');
  openModal(`<h3>Assign quiz</h3><p class="sub">Pick a class to attach "${esc(qs.title)}" to.</p>
    <div class="assign-list" id="assignList">${classes.map(c => `<button type="button" data-cid="${c.id}"><b>${esc(c.name)}</b><br><small style="color:var(--dark-grey)">Code ${c.code}</small></button>`).join('')}</div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#assignList').addEventListener('click', e => {
    const b = e.target.closest('[data-cid]'); if (!b) return;
    const c = classes.find(x => x.id === b.dataset.cid); if (!c) return;
    addAssignmentForClass(c, qs); closeModal();
    toast('Assigned to ' + c.name);
    if (cur() && cur().id === c.id) { tab = 'assignments'; render(); }
    renderQuestionSets();
  });
}
function addAssignmentForClass(c, qs) {
  c.assignments.unshift({ id: Date.now(), text: 'Quiz: ' + qs.title + ' (' + qs.questions.length + ' questions)', time: Date.now(), kind: 'quiz', quizId: qs.id });
  c.setupDone = true;
  qs.assignedTo = qs.assignedTo || [];
  if (!qs.assignedTo.includes(c.id)) qs.assignedTo.push(c.id);
  save(); saveQSets();
}
function pickAndAssignQuiz() {
  if (!qsets.length) return toast('No question sets yet');
  const c = cur();
  openModal(`<h3>Assign a quiz</h3><p class="sub">Pick a question set for <b>${esc(c.name)}</b>.</p>
    <div class="qs-pick" id="qsPick">${qsets.map(q => `<button type="button" data-qsid="${q.id}"><span class="qsi"><i class='bx bx-list-check'></i></span><span class="qst"><b>${esc(q.title)}</b><small>${q.questions.length} questions${q.grade ? ' · ' + esc(q.grade) : ''}${q.difficulty ? ' · ' + esc(q.difficulty) : ''}</small></span></button>`).join('')}</div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#qsPick').addEventListener('click', e => {
    const b = e.target.closest('[data-qsid]'); if (!b) return;
    const qs = qsets.find(x => x.id === b.dataset.qsid); if (!qs) return;
    addAssignmentForClass(c, qs); closeModal(); toast('Assigned "' + qs.title + '"'); render();
  });
}
function editQuiz(qsId) {
  const qs = qsets.find(x => x.id === qsId); if (!qs) return;
  openModal(`<h3>Edit "${esc(qs.title)}"</h3><p class="sub">Change any question. Radio = correct answer.</p>
    <div id="qlist" style="max-height:56vh;overflow-y:auto;margin-bottom:14px"></div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-save>Save</button></div>`);
  const qlist = $('#qlist');
  qlist.innerHTML = qs.questions.map((q, qi) => `<div class="q-edit" data-q="${qi}">
    <label>Question ${qi + 1}</label><textarea data-field="question" rows="2">${esc(q.question)}</textarea>
    <label style="margin-top:8px">Options · pick the correct one</label>
    ${q.options.map((o, oi) => `<div class="optrow"><input type="radio" name="correct-${qi}" value="${oi}" ${q.correct === oi ? 'checked' : ''}><input type="text" data-opt="${oi}" value="${esc(o)}"></div>`).join('')}
    <div class="row" style="margin-top:10px"><div><label>Time limit (s)</label><input type="text" data-field="timeLimit" value="${q.timeLimit || 20}"></div><div><label>Explanation</label><input type="text" data-field="explanation" value="${esc(q.explanation || '')}"></div></div>
  </div>`).join('');
  $('#modal [data-x]').onclick = closeModal;
  $('#modal [data-save]').onclick = () => {
    qlist.querySelectorAll('.q-edit').forEach(el => {
      const qi = parseInt(el.dataset.q, 10);
      const q = qs.questions[qi];
      q.question = el.querySelector('[data-field="question"]').value.trim() || q.question;
      q.options = [0,1,2,3].map(i => el.querySelector('[data-opt="' + i + '"]').value.trim() || q.options[i]);
      const picked = el.querySelector('input[type=radio]:checked');
      q.correct = picked ? parseInt(picked.value, 10) : q.correct;
      const tl = parseInt(el.querySelector('[data-field="timeLimit"]').value, 10);
      q.timeLimit = Number.isFinite(tl) ? tl : (q.timeLimit || 20);
      q.explanation = el.querySelector('[data-field="explanation"]').value.trim();
    });
    saveQSets(); closeModal(); renderQuestionSets(); toast('Saved');
  };
}

/* ===================== Game launcher ===================== */
function openGame(type, qs) {
  const frame = $('#battleFrame');
  const qs_ = (qs && Array.isArray(qs.questions) && qs.questions.length) ? qs : { id: 'preset', title: 'Preset Quiz', questions: PRESET_QUESTIONS };
  let html;
  if (type === 'bubble') html = buildBubbleHTML(qs_.questions, qs_.title, qs_.id);
  else if (type === 'asteroids') html = buildAsteroidsHTML(qs_.questions, qs_.title, qs_.id);
  else html = buildBattleshipHTML(qs_.questions, qs_.title, qs_.id);
  frame.srcdoc = html;
  $('#battleWrap').classList.add('show');
  document.body.style.overflow = 'hidden';
}
$('#battleClose').onclick = () => { $('#battleWrap').classList.remove('show'); $('#battleFrame').srcdoc = ''; document.body.style.overflow = ''; };

/* ===================== Game builders ===================== */
const GAME_QUIZ_HELPERS = `
function escHtml(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function makeQuizModal(opts) {
  var SHAPES=['<svg viewBox="0 0 24 24"><polygon points="12,2 22,20 2,20" fill="#fff"/></svg>','<svg viewBox="0 0 24 24"><polygon points="12,2 22,12 12,22 2,12" fill="#fff"/></svg>','<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#fff"/></svg>','<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" fill="#fff"/></svg>'];
  return function openQuiz(onDone) {
    if (opts.isOpen()) return;
    if (!QUESTIONS || !QUESTIONS.length) { opts.setAmmo(opts.getAmmo() + opts.gainCorrect); opts.onUpdate(); if (typeof onDone === 'function') onDone(); return; }
    opts.setOpen(true);
    var idx = opts.getIdx(); var q = QUESTIONS[idx % QUESTIONS.length]; var qIdx = idx % QUESTIONS.length; opts.setIdx(idx + 1);
    var ov = document.createElement('div'); ov.className = 'quiz-overlay'; ov.id = 'quizOverlay';
    var box = document.createElement('div'); box.className = 'quiz-box';
    var letters = ['A','B','C','D']; var optHtml = '';
    for (var i = 0; i < 4; i++) optHtml += '<button type="button" class="opt" data-opt="' + i + '"><span class="shape">' + SHAPES[i] + '</span><span class="opttext">' + letters[i] + '. ' + escHtml(q.options[i] || '') + '</span></button>';
    box.innerHTML = '<h3>Out of ammo — reload!</h3><p class="sub">Correct = <b>+' + opts.gainCorrect + '</b> ammo &nbsp;·&nbsp; Wrong = +' + opts.gainWrong + '</p><div class="qtext">' + escHtml(q.question) + '</div><div class="opts">' + optHtml + '</div><div class="quiz-foot"><span id="qFeedback"></span><span id="qNextWrap"></span></div>';
    var optsEl = box.querySelector('.opts');
    Array.prototype.forEach.call(optsEl.children, function(b, i) {
      b.addEventListener('click', function() {
        if (b.disabled) return;
        var correct = q.correct; var ok = i === correct;
        if (ok) b.classList.add('correct'); else { b.classList.add('wrong'); optsEl.children[correct].classList.add('correct'); }
        Array.prototype.forEach.call(optsEl.children, function(x) { x.disabled = true; });
        var gain = ok ? opts.gainCorrect : opts.gainWrong; opts.setAmmo(opts.getAmmo() + gain); opts.onUpdate();
        if (typeof opts.onAnswer === 'function') opts.onAnswer(qIdx, ok);
        document.getElementById('qFeedback').innerHTML = (ok ? '<b style="color:#7dd87d">✓ Correct!</b> ' : '<b style="color:#ff8a8a">✗ Nope.</b> ') + '<b style="color:#f0c14b">+' + gain + ' ammo</b>' + (q.explanation ? ' <span style="opacity:.8">· ' + escHtml(q.explanation) + '</span>' : '');
        var nw = document.getElementById('qNextWrap');
        var nb = document.createElement('button'); nb.type = 'button'; nb.className = 'btn'; nb.textContent = 'Continue';
        nb.addEventListener('click', function() { ov.remove(); opts.setOpen(false); if (typeof onDone === 'function') onDone(); });
        nw.appendChild(nb);
      });
    });
    ov.appendChild(box); document.body.appendChild(ov);
  };
}
`;

const GAME_QUIZ_CSS = `
.quiz-overlay{position:fixed;inset:0;background:rgba(0,0,0,.85);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
.quiz-box{background:#1a1a2e;border:3px solid #fff;border-radius:16px;padding:24px;max-width:640px;width:100%;color:#fff;font-family:"Outfit",sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.6);max-height:92vh;overflow-y:auto}
.quiz-box h3{margin:0 0 6px;font-size:1.3rem;text-align:center;font-weight:800}
.quiz-box .sub{opacity:.85;font-size:.9rem;margin-bottom:16px;text-align:center}
.quiz-box .sub b{color:#f0c14b}
.quiz-box .qtext{font-size:1.25rem;font-weight:800;margin-bottom:20px;line-height:1.35;text-align:center;padding:18px;background:#fff;color:#1a1a2e;border-radius:12px;word-break:break-word}
.quiz-box .opts{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px}
.quiz-box .opt{display:flex;align-items:center;gap:12px;padding:16px 18px;border-radius:10px;border:none;color:#fff;font-family:inherit;text-align:left;font-size:1rem;font-weight:700;cursor:pointer;box-shadow:0 4px 0 rgba(0,0,0,.35);transition:transform .08s;min-height:64px}
.quiz-box .opt:hover:not(:disabled){transform:translateY(-2px);box-shadow:0 6px 0 rgba(0,0,0,.35)}
.quiz-box .opt .shape{width:28px;height:28px;flex:none;display:flex;align-items:center;justify-content:center}
.quiz-box .opt .shape svg{width:100%;height:100%;display:block}
.quiz-box .opt .opttext{flex:1;line-height:1.3}
.quiz-box .opt[data-opt="0"]{background:#e21b3c}
.quiz-box .opt[data-opt="1"]{background:#1368ce}
.quiz-box .opt[data-opt="2"]{background:#d89e00}
.quiz-box .opt[data-opt="3"]{background:#26890c}
.quiz-box .opt.correct{outline:4px solid #fff;outline-offset:3px}
.quiz-box .opt.wrong{opacity:.4}
.quiz-box .quiz-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:.9rem;padding-top:10px;flex-wrap:wrap}
.quiz-box .quiz-foot>span:first-child{flex:1;min-width:180px}
.quiz-box .btn{padding:10px 22px;border:none;border-radius:8px;background:#fff;color:#1a1a2e;font-family:inherit;font-weight:800;cursor:pointer;font-size:.95rem}
@media(max-width:560px){.quiz-box .opts{grid-template-columns:1fr}.quiz-box .qtext{font-size:1.05rem}.quiz-box{padding:18px}}
.ammo-badge{padding:6px 12px;border-radius:20px;background:rgba(240,193,75,.18);border:1px solid rgba(240,193,75,.5);color:#f0c14b;font-size:.9rem;font-weight:700}
.ammo-badge.low{background:rgba(214,69,69,.18);border-color:rgba(214,69,69,.6);color:#ff8a8a}
`;

function buildBattleshipHTML(questions, title, quizId) {
  const Q = JSON.stringify(questions).replace(/</g, '\\u003c');
  const QID = JSON.stringify(quizId || 'preset');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Battleship</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
:root{--bg:#061824;--bg2:#0a3a4d;--sea:#0d4f66;--sea-light:#14708f;--cell:#0e5a72;--cell-hover:#1a7a96;--text:#e8f4f8;--accent:#f0c14b;--hit:#d64545;--miss:#7eb8c9;--ship-placed:#5c8a9e;--sunk:#8b2e2e;--fog:#0a2f3d;--valid:rgba(80,200,140,.45);--invalid:rgba(214,69,69,.45)}
*{box-sizing:border-box}body{margin:0;font-family:"Outfit",sans-serif;background:radial-gradient(ellipse at 20% 10%,rgba(20,112,143,.35),transparent 50%),linear-gradient(165deg,#031018,var(--bg) 40%,var(--bg2));min-height:100vh;color:var(--text)}
.wrapper{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:12px}
.hidden{display:none!important}
.level-screen{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:80vh;text-align:center}
.level-header h1{margin:0 0 8px;font-size:clamp(1.4rem,4vw,2rem)}
.level-screen>p{margin:0 0 24px;opacity:.9}
.level-buttons{display:flex;flex-direction:column;gap:12px;width:100%;max-width:320px}
.level-btn{padding:16px 20px;border:2px solid rgba(255,255,255,.3);border-radius:12px;background:rgba(255,255,255,.08);color:inherit;font-family:inherit;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px}
.level-name{font-weight:700}.level-desc{font-size:.85rem;opacity:.85}
.game-screen{width:100%;max-width:920px;flex:1;display:flex;flex-direction:column}
.header{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px}
.header h1{margin:0;font-size:clamp(1.4rem,4vw,2rem)}
.level-badge{padding:4px 10px;border-radius:20px;background:rgba(255,255,255,.2);font-size:.8rem;font-weight:600}
.header-actions{display:flex;flex-wrap:wrap;gap:8px;margin-left:auto;align-items:center}
.hud{font-weight:600;font-size:.9rem}
.btn{padding:10px 14px;border:none;border-radius:8px;background:rgba(255,255,255,.25);color:inherit;font-family:inherit;font-weight:600;cursor:pointer}
.btn-ghost{background:transparent;border:1px solid rgba(255,255,255,.4)}
.placement-bar{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-bottom:14px;padding:10px 12px;background:rgba(0,0,0,.25);border-radius:10px}
.placement-bar.hidden-bar{display:none}
.ship-tray{display:flex;flex-wrap:wrap;gap:8px;flex:1}
.ship-chip{display:flex;flex-direction:column;gap:4px;padding:8px 10px;border:2px solid rgba(255,255,255,.25);border-radius:8px;background:rgba(255,255,255,.06);color:inherit;font-family:inherit;cursor:pointer}
.ship-chip.selected{border-color:var(--accent)}
.ship-chip.placed{opacity:.45;cursor:default}
.ship-chip-name{font-weight:700;font-size:.8rem}
.ship-chip-cells{display:flex;gap:2px}
.ship-chip-cell{width:10px;height:10px;border-radius:2px;background:var(--ship-placed)}
.placement-controls{display:flex;gap:8px}
.boards{display:flex;flex-wrap:wrap;gap:20px;justify-content:center}
.board-panel{flex:1 1 300px;max-width:420px}
.board-title{margin:0 0 8px;font-size:1rem;text-align:center;opacity:.95}
.board{display:grid;grid-template-columns:repeat(10,1fr);gap:2px;aspect-ratio:1;width:100%;background:var(--sea);padding:4px;border-radius:8px;user-select:none}
.cell{aspect-ratio:1;border-radius:3px;background:var(--cell);border:none;padding:0;cursor:default;position:relative}
.cell.fog{background:var(--fog)}.cell.ship{background:var(--ship-placed)}
.cell.preview-valid{background:var(--valid)}.cell.preview-invalid{background:var(--invalid)}
.cell.miss{background:var(--sea-light)}.cell.miss::after{content:"";position:absolute;inset:28%;border-radius:50%;background:var(--miss)}
.cell.hit{background:var(--hit)}.cell.hit::after{content:"";position:absolute;inset:22%;background:var(--accent);clip-path:polygon(10% 0,50% 35%,90% 0,100% 10%,65% 50%,100% 90%,90% 100%,50% 65%,10% 100%,0 90%,35% 50%,0 10%)}
.cell.sunk{background:var(--sunk)}.cell.sunk::after{content:"";position:absolute;inset:18%;background:rgba(0,0,0,.45);border:2px solid var(--accent);border-radius:2px}
.board.combat-target .cell:not(.miss):not(.hit):not(.sunk){cursor:pointer}
.board.combat-target .cell:not(.miss):not(.hit):not(.sunk):hover{background:var(--cell-hover)}
.board.placing .cell{cursor:pointer}
.result-overlay{position:fixed;inset:0;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;z-index:100;padding:16px}
.result-box{background:linear-gradient(160deg,#0a3040,#0d4a5c);border-radius:14px;padding:24px;max-width:420px;width:100%;text-align:center}
.result-actions{display:flex;flex-direction:column;gap:10px;margin-top:16px}
${GAME_QUIZ_CSS}
@media(max-width:720px){.boards{flex-direction:column}.board-panel{max-width:none}.placement-bar{flex-direction:column;align-items:stretch}}
</style></head><body>
<div class="wrapper">
  <div id="levelScreen" class="level-screen">
    <div class="level-header"><h1>Battleship</h1></div>
    <p>Start with <b>5 ammo</b>. Every shot costs 1. Correct answers reload.</p>
    <div class="level-buttons">
      <button type="button" data-level="easy" class="level-btn"><span class="level-name">Easy</span><span class="level-desc">Random fire</span></button>
      <button type="button" data-level="medium" class="level-btn"><span class="level-name">Medium</span><span class="level-desc">Hunt after hit</span></button>
      <button type="button" data-level="hard" class="level-btn"><span class="level-name">Hard</span><span class="level-desc">Hunt + adjacency</span></button>
    </div>
  </div>
  <div id="gameScreen" class="game-screen hidden">
    <header class="header">
      <h1>Battleship</h1>
      <span class="level-badge" id="levelBadge">Easy</span>
      <span class="ammo-badge" id="ammoBadge">Ammo: 5</span>
      <div class="header-actions">
        <span id="hud" class="hud">Place fleet</span>
        <button type="button" id="changeLevelBtn" class="btn btn-ghost">Change Level</button>
        <button type="button" id="newGameBtn" class="btn">New Game</button>
      </div>
    </header>
    <div id="placementBar" class="placement-bar"><div id="shipTray" class="ship-tray"></div><div class="placement-controls"><button type="button" id="rotateBtn" class="btn">Rotate</button><button type="button" id="readyBtn" class="btn" disabled>Ready</button></div></div>
    <main class="boards"><section class="board-panel"><h2 class="board-title">Your Fleet</h2><div id="playerBoard" class="board"></div></section><section class="board-panel"><h2 class="board-title">Enemy Waters</h2><div id="enemyBoard" class="board"></div></section></main>
    <div id="resultOverlay" class="result-overlay hidden"><div class="result-box"><h2 id="resultTitle"></h2><p id="resultMsg"></p><div class="result-actions"><button type="button" id="playAgainBtn" class="btn">Play Again</button><button type="button" id="changeLevelFromResultBtn" class="btn btn-ghost">Change Level</button></div></div></div>
  </div>
</div>
<script>
(function(){
"use strict";
var QUESTIONS = ${Q}; var QUIZ_ID = ${QID};
var SIZE=10;
var FLEET=[{id:"carrier",name:"Carrier",length:5},{id:"battleship",name:"Battleship",length:4},{id:"cruiser",name:"Cruiser",length:3},{id:"submarine",name:"Submarine",length:3},{id:"destroyer",name:"Destroyer",length:2}];
var LEVEL_LABELS={easy:"Easy",medium:"Medium",hard:"Hard"};
var levelScreen=document.getElementById("levelScreen"),gameScreen=document.getElementById("gameScreen"),levelBadge=document.getElementById("levelBadge"),ammoBadge=document.getElementById("ammoBadge"),hud=document.getElementById("hud"),placementBar=document.getElementById("placementBar"),shipTray=document.getElementById("shipTray"),rotateBtn=document.getElementById("rotateBtn"),readyBtn=document.getElementById("readyBtn"),playerBoardEl=document.getElementById("playerBoard"),enemyBoardEl=document.getElementById("enemyBoard"),resultOverlay=document.getElementById("resultOverlay"),resultTitle=document.getElementById("resultTitle"),resultMsg=document.getElementById("resultMsg");
var level="easy",phase="level",horizontal=true,selectedShipId=null,playerTurn=true,aiThinking=false,hoverCell=null;
var playerGrid=createEmptyGrid(),enemyGrid=createEmptyGrid(),playerShips=[],enemyShips=[],playerShots=createShotMap(),enemyShots=createShotMap();
var aiHuntQueue=[],aiHitCells=[],aiParity=0;
var AMMO_START=5,AMMO_PER_CORRECT=3,AMMO_PER_WRONG=1;
var ammo=AMMO_START,quizIdx=0,quizOpen=false,quizAnswers=[];
function updateAmmoUI(){ammoBadge.textContent="Ammo: "+ammo;ammoBadge.classList.toggle("low",ammo<=1);}
${GAME_QUIZ_HELPERS}
var openQuiz = makeQuizModal({isOpen:function(){return quizOpen;},setOpen:function(v){quizOpen=v;},getAmmo:function(){return ammo;},setAmmo:function(v){ammo=v;},getIdx:function(){return quizIdx;},setIdx:function(v){quizIdx=v;},gainCorrect:AMMO_PER_CORRECT,gainWrong:AMMO_PER_WRONG,onUpdate:updateAmmoUI,onAnswer:function(qIdx,correct){quizAnswers.push({qIdx:qIdx,correct:correct});}});
function createEmptyGrid(){return Array.from({length:SIZE},function(){return Array(SIZE).fill(null);});}
function createShotMap(){return Array.from({length:SIZE},function(){return Array(SIZE).fill(null);});}
function key(r,c){return r+","+c;}
function inBounds(r,c){return r>=0&&r<SIZE&&c>=0&&c<SIZE;}
function shuffle(a){var s=a.slice();for(var i=s.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=s[i];s[i]=s[j];s[j]=t;}return s;}
function shipCells(r,c,length,isH){var cells=[];for(var i=0;i<length;i++)cells.push({r:isH?r:r+i,c:isH?c+i:c});return cells;}
function canPlace(g,r,c,length,isH){var cells=shipCells(r,c,length,isH);for(var i=0;i<cells.length;i++){var cell=cells[i];if(!inBounds(cell.r,cell.c))return false;if(g[cell.r][cell.c]!==null)return false;}return true;}
function placeShipOnGrid(g,ships,def,r,c,isH){if(!canPlace(g,r,c,def.length,isH))return false;var cells=shipCells(r,c,def.length,isH);var ship={id:def.id,name:def.name,length:def.length,cells:cells.map(function(x){return{r:x.r,c:x.c};}),hits:0,sunk:false};cells.forEach(function(x){g[x.r][x.c]=def.id;});ships.push(ship);return true;}
function autoPlaceFleet(g,ships){for(var i=0;i<SIZE;i++)for(var j=0;j<SIZE;j++)g[i][j]=null;ships.length=0;for(var k=0;k<FLEET.length;k++){var def=FLEET[k];var placed=false;for(var a=0;a<400&&!placed;a++){var isH=Math.random()<0.5;var r=Math.floor(Math.random()*SIZE);var c=Math.floor(Math.random()*SIZE);placed=placeShipOnGrid(g,ships,def,r,c,isH);}if(!placed)return false;}return true;}
function findShip(ships,id){return ships.find(function(s){return s.id===id;});}
function allPlaced(){return playerShips.length===FLEET.length;}
function fleetSunk(ships){return ships.length>0&&ships.every(function(s){return s.sunk;});}
function applyShot(g,ships,shots,r,c){if(shots[r][c]!==null)return null;var shipId=g[r][c];if(!shipId){shots[r][c]="miss";return{result:"miss",ship:null};}shots[r][c]="hit";var ship=findShip(ships,shipId);ship.hits+=1;if(ship.hits>=ship.length){ship.sunk=true;ship.cells.forEach(function(x){shots[x.r][x.c]="sunk";});return{result:"sunk",ship:ship};}return{result:"hit",ship:ship};}
function resetAiMemory(){aiHuntQueue=[];aiHitCells=[];aiParity=Math.random()<0.5?0:1;}
function neighbors(r,c){return[{r:r-1,c:c},{r:r+1,c:c},{r:r,c:c-1},{r:r,c:c+1}].filter(function(n){return inBounds(n.r,n.c);});}
function unshotCells(){var cells=[];for(var r=0;r<SIZE;r++)for(var c=0;c<SIZE;c++)if(enemyShots[r][c]===null)cells.push({r:r,c:c});return cells;}
function enqueueHuntAround(r,c){var around=shuffle(neighbors(r,c));around.forEach(function(n){if(enemyShots[n.r][n.c]!==null)return;if(!aiHuntQueue.some(function(q){return q.r===n.r&&q.c===n.c;}))aiHuntQueue.push(n);});}
function pruneHuntQueue(){aiHuntQueue=aiHuntQueue.filter(function(n){return enemyShots[n.r][n.c]===null;});}
function alignedContinuation(){if(aiHitCells.length<2)return null;var rows=aiHitCells.map(function(h){return h.r;});var cols=aiHitCells.map(function(h){return h.c;});var sameRow=rows.every(function(r){return r===rows[0];});var sameCol=cols.every(function(c){return c===cols[0];});if(!sameRow&&!sameCol)return null;var cands=[];if(sameRow){var row=rows[0];var s=cols.slice().sort(function(a,b){return a-b;});var l=s[0]-1,r2=s[s.length-1]+1;if(inBounds(row,l)&&enemyShots[row][l]===null)cands.push({r:row,c:l});if(inBounds(row,r2)&&enemyShots[row][r2]===null)cands.push({r:row,c:r2});}else{var col=cols[0];var s2=rows.slice().sort(function(a,b){return a-b;});var up=s2[0]-1,dn=s2[s2.length-1]+1;if(inBounds(up,col)&&enemyShots[up][col]===null)cands.push({r:up,c:col});if(inBounds(dn,col)&&enemyShots[dn][col]===null)cands.push({r:dn,c:col});}if(!cands.length)return null;return cands[Math.floor(Math.random()*cands.length)];}
function pickParityCell(){var open=unshotCells();var par=open.filter(function(cell){return (cell.r+cell.c)%2===aiParity;});var pool=par.length?par:open;if(!pool.length)return null;return pool[Math.floor(Math.random()*pool.length)];}
function pickRandomUnshot(){var open=unshotCells();if(!open.length)return null;return open[Math.floor(Math.random()*open.length)];}
function chooseAiShot(){if(level==="easy")return pickRandomUnshot();pruneHuntQueue();if(level==="hard"){var cont=alignedContinuation();if(cont)return cont;}while(aiHuntQueue.length){var nx=aiHuntQueue.shift();if(enemyShots[nx.r][nx.c]===null)return nx;}if(level==="hard")return pickParityCell();return pickRandomUnshot();}
function onAiShotResult(r,c,outcome){if(level==="easy")return;if(outcome.result==="hit"){aiHitCells.push({r:r,c:c});enqueueHuntAround(r,c);}else if(outcome.result==="sunk"){aiHitCells=[];aiHuntQueue=[];}else if(outcome.result==="miss"){pruneHuntQueue();}}
function buildBoards(){playerBoardEl.innerHTML="";enemyBoardEl.innerHTML="";for(var r=0;r<SIZE;r++)for(var c=0;c<SIZE;c++){var p=document.createElement("button");p.type="button";p.className="cell";p.dataset.r=r;p.dataset.c=c;playerBoardEl.appendChild(p);var e=document.createElement("button");e.type="button";e.className="cell fog";e.dataset.r=r;e.dataset.c=c;enemyBoardEl.appendChild(e);}}
function renderShipTray(){shipTray.innerHTML="";FLEET.forEach(function(def){var placed=!!findShip(playerShips,def.id);var btn=document.createElement("button");btn.type="button";btn.className="ship-chip"+(placed?" placed":"")+(selectedShipId===def.id?" selected":"");btn.disabled=placed;var n=document.createElement("span");n.className="ship-chip-name";n.textContent=def.name+" ("+def.length+")";btn.appendChild(n);var cells=document.createElement("span");cells.className="ship-chip-cells";for(var i=0;i<def.length;i++){var dot=document.createElement("span");dot.className="ship-chip-cell";cells.appendChild(dot);}btn.appendChild(cells);if(!placed){btn.addEventListener("click",function(){selectedShipId=def.id;renderShipTray();renderBoards();setHud("Place "+def.name);});}shipTray.appendChild(btn);});readyBtn.disabled=!allPlaced();}
function getPreviewCells(){if(phase!=="placement"||!selectedShipId||!hoverCell)return null;var def=FLEET.find(function(s){return s.id===selectedShipId;});if(!def)return null;var cells=shipCells(hoverCell.r,hoverCell.c,def.length,horizontal);var valid=canPlace(playerGrid,hoverCell.r,hoverCell.c,def.length,horizontal);return{cells:cells,valid:valid};}
function renderBoards(){var pv=getPreviewCells();var ps=new Set();if(pv){pv.cells.forEach(function(cl){if(inBounds(cl.r,cl.c))ps.add(key(cl.r,cl.c));});}playerBoardEl.querySelectorAll(".cell").forEach(function(el){var r=Number(el.dataset.r),c=Number(el.dataset.c);el.className="cell";var shot=enemyShots[r][c];var occ=playerGrid[r][c];if(shot==="sunk")el.classList.add("sunk");else if(shot==="hit")el.classList.add("hit");else if(shot==="miss")el.classList.add("miss");else if(occ)el.classList.add("ship");if(pv&&ps.has(key(r,c)))el.classList.add(pv.valid?"preview-valid":"preview-invalid");});enemyBoardEl.querySelectorAll(".cell").forEach(function(el){var r=Number(el.dataset.r),c=Number(el.dataset.c);el.className="cell";var shot=playerShots[r][c];if(shot==="sunk")el.classList.add("sunk");else if(shot==="hit")el.classList.add("hit");else if(shot==="miss")el.classList.add("miss");else el.classList.add("fog");});playerBoardEl.classList.toggle("placing",phase==="placement");enemyBoardEl.classList.toggle("combat-target",phase==="combat"&&playerTurn&&!aiThinking&&!quizOpen);}
function setHud(t){hud.textContent=t;}
function showResult(won){phase="result";resultOverlay.classList.remove("hidden");resultTitle.textContent=won?"Victory!":"Defeat";resultMsg.textContent=won?"You sank the enemy fleet.":"Your fleet has been destroyed.";playerTurn=false;aiThinking=false;renderBoards();try{window.parent.postMessage({type:'gameEnd',game:'battleship',quizId:QUIZ_ID,won:won,score:won?100:0,answers:quizAnswers},'*');}catch(e){}}
function startPlacement(){phase="placement";horizontal=true;selectedShipId=FLEET[0].id;playerTurn=true;aiThinking=false;hoverCell=null;quizAnswers=[];playerGrid=createEmptyGrid();enemyGrid=createEmptyGrid();playerShips=[];enemyShips=[];playerShots=createShotMap();enemyShots=createShotMap();resetAiMemory();resultOverlay.classList.add("hidden");placementBar.classList.remove("hidden-bar");levelBadge.textContent=LEVEL_LABELS[level];ammo=AMMO_START;updateAmmoUI();setHud("Place your fleet");renderShipTray();renderBoards();}
function startCombat(){var ok=false;for(var i=0;i<50&&!ok;i++)ok=autoPlaceFleet(enemyGrid,enemyShips);if(!ok){setHud("Placement failed");return;}phase="combat";playerTurn=true;aiThinking=false;selectedShipId=null;hoverCell=null;placementBar.classList.add("hidden-bar");setHud("Your turn");renderBoards();}
function endIfOver(){if(fleetSunk(enemyShips)){showResult(true);return true;}if(fleetSunk(playerShips)){showResult(false);return true;}return false;}
function handlePlayerFire(r,c){if(phase!=="combat"||!playerTurn||aiThinking||quizOpen)return;if(playerShots[r][c]!==null)return;if(ammo<=0){openQuiz(function(){setHud("Your turn");renderBoards();});return;}ammo--;updateAmmoUI();var outcome=applyShot(enemyGrid,enemyShips,playerShots,r,c);if(!outcome)return;if(outcome.result==="miss")setHud("Miss");else if(outcome.result==="hit")setHud("Hit!");else setHud("Sank enemy "+outcome.ship.name+"!");renderBoards();if(endIfOver())return;playerTurn=false;scheduleAiTurn();}
function scheduleAiTurn(){aiThinking=true;setHud("Enemy targeting…");renderBoards();setTimeout(function(){if(phase!=="combat")return;var t=chooseAiShot();if(!t){aiThinking=false;playerTurn=true;setHud("Your turn");renderBoards();return;}var o=applyShot(playerGrid,playerShips,enemyShots,t.r,t.c);onAiShotResult(t.r,t.c,o);if(o.result==="miss")setHud("Enemy missed");else if(o.result==="hit")setHud("Enemy hit your "+o.ship.name+"!");else setHud("Enemy sank your "+o.ship.name+"!");renderBoards();aiThinking=false;if(endIfOver())return;playerTurn=true;setHud("Your turn");renderBoards();},2000);}
function tryPlaceAt(r,c){if(phase!=="placement"||!selectedShipId)return;var def=FLEET.find(function(s){return s.id===selectedShipId;});if(!def)return;if(findShip(playerShips,def.id))return;if(!canPlace(playerGrid,r,c,def.length,horizontal)){setHud("Invalid placement");return;}placeShipOnGrid(playerGrid,playerShips,def,r,c,horizontal);var nx=FLEET.find(function(s){return !findShip(playerShips,s.id);});selectedShipId=nx?nx.id:null;hoverCell=null;renderShipTray();renderBoards();if(allPlaced())setHud("Fleet ready — press Ready");}
function openLevelScreen(){phase="level";gameScreen.classList.add("hidden");levelScreen.classList.remove("hidden");resultOverlay.classList.add("hidden");}
function beginLevel(l){level=l;levelScreen.classList.add("hidden");gameScreen.classList.remove("hidden");startPlacement();}
document.querySelectorAll(".level-btn").forEach(function(b){b.addEventListener("click",function(){beginLevel(b.dataset.level);});});
rotateBtn.addEventListener("click",function(){if(phase!=="placement")return;horizontal=!horizontal;renderBoards();});
readyBtn.addEventListener("click",function(){if(allPlaced())startCombat();});
document.getElementById("newGameBtn").addEventListener("click",startPlacement);
document.getElementById("changeLevelBtn").addEventListener("click",openLevelScreen);
document.getElementById("playAgainBtn").addEventListener("click",startPlacement);
document.getElementById("changeLevelFromResultBtn").addEventListener("click",openLevelScreen);
playerBoardEl.addEventListener("click",function(e){var cell=e.target.closest(".cell");if(cell)tryPlaceAt(Number(cell.dataset.r),Number(cell.dataset.c));});
playerBoardEl.addEventListener("mousemove",function(e){if(phase!=="placement"||!selectedShipId)return;var cell=e.target.closest(".cell");if(!cell)return;var r=Number(cell.dataset.r),c=Number(cell.dataset.c);if(!hoverCell||hoverCell.r!==r||hoverCell.c!==c){hoverCell={r:r,c:c};renderBoards();}});
playerBoardEl.addEventListener("mouseleave",function(){if(phase==="placement"&&hoverCell){hoverCell=null;renderBoards();}});
enemyBoardEl.addEventListener("click",function(e){var cell=e.target.closest(".cell");if(cell)handlePlayerFire(Number(cell.dataset.r),Number(cell.dataset.c));});
updateAmmoUI();buildBoards();openLevelScreen();
})();
<\/script></body></html>`;
}

function buildBubbleHTML(questions, title, quizId) {
  const Q = JSON.stringify(questions).replace(/</g, '\\u003c');
  const QID = JSON.stringify(quizId || 'preset');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Bubble Shooter</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
:root{--bg:#0f172a;--panel:#1e293b;--text:#f1f5f9;--accent:#38bdf8}
*{box-sizing:border-box}body{margin:0;font-family:"Outfit",sans-serif;background:linear-gradient(160deg,#020617,var(--bg));min-height:100vh;color:var(--text)}
.wrapper{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:12px}
.hidden{display:none!important}
.game-screen{width:100%;max-width:440px;display:flex;flex-direction:column;align-items:center}
.header{display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;margin-bottom:10px}
.header h1{margin:0;font-size:clamp(1.35rem,4vw,2rem)}
.header-actions{display:flex;gap:8px;margin-left:auto;align-items:center}
.score{font-weight:700;color:var(--accent)}
.btn{padding:10px 14px;border:none;border-radius:8px;background:rgba(255,255,255,.25);color:inherit;font-family:inherit;font-weight:600;cursor:pointer}
.canvas-wrap{width:100%;max-width:400px;display:flex;flex-direction:column}
#gameCanvas{width:100%;height:auto;display:block;background:var(--panel);border-radius:12px;touch-action:none}
.fire-btn{width:100%;margin-top:10px;background:var(--accent);color:#0f172a}
.result-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px}
.result-box{background:var(--panel);border-radius:16px;padding:28px;max-width:400px;width:100%;text-align:center}
.result-box h2{color:var(--accent);margin:0 0 8px}
.result-actions{display:flex;flex-direction:column;gap:10px;margin-top:16px}
${GAME_QUIZ_CSS}
</style></head><body>
<div class="wrapper"><div id="gameScreen" class="game-screen">
  <header class="header"><h1>Bubble Shooter</h1><span class="ammo-badge" id="ammoBadge">Ammo: 5</span><div class="header-actions"><span id="scoreDisplay" class="score">Score: 0</span><button type="button" id="newGameBtn" class="btn">New Game</button></div></header>
  <div class="canvas-wrap"><canvas id="gameCanvas" width="400" height="560"></canvas><button type="button" id="fireBtn" class="btn fire-btn">Fire</button></div>
  <div id="resultOverlay" class="result-overlay hidden"><div class="result-box"><h2 id="resultTitle"></h2><p id="resultMsg"></p><div class="result-actions"><button type="button" id="playAgainBtn" class="btn">Play Again</button></div></div></div>
</div></div>
<script>
(function(){
"use strict";
var QUESTIONS = ${Q}; var QUIZ_ID = ${QID};
var COLORS=["#ef4444","#3b82f6","#22c55e","#eab308","#a855f7","#f97316"];
var CFG={colors:5,rows:5,speed:8};
var COLS=8,R=18,ROW_H=R*1.75;
var canvas=document.getElementById("gameCanvas"),ctx=canvas.getContext("2d");
var state={grid:[],score:0,aimAngle:-Math.PI/2,current:0,next:0,flying:null,running:false,gameOver:false};
var AMMO_START=5,AMMO_PER_CORRECT=5,AMMO_PER_WRONG=1;
var ammo=AMMO_START,quizIdx=0,quizOpen=false,quizAnswers=[];
var ammoBadge=document.getElementById("ammoBadge");
function updateAmmoUI(){ammoBadge.textContent="Ammo: "+ammo;ammoBadge.classList.toggle("low",ammo<=1);}
${GAME_QUIZ_HELPERS}
var openQuiz = makeQuizModal({isOpen:function(){return quizOpen;},setOpen:function(v){quizOpen=v;},getAmmo:function(){return ammo;},setAmmo:function(v){ammo=v;},getIdx:function(){return quizIdx;},setIdx:function(v){quizIdx=v;},gainCorrect:AMMO_PER_CORRECT,gainWrong:AMMO_PER_WRONG,onUpdate:updateAmmoUI,onAnswer:function(qIdx,correct){quizAnswers.push({qIdx:qIdx,correct:correct});}});
function colsInRow(r){return r%2===0?COLS:COLS-1;}
function cellCenter(r,c){var odd=r%2===1;return{x:R+c*(R*2)+(odd?R:0)+8,y:R+r*ROW_H+8};}
function randomColor(){return Math.floor(Math.random()*CFG.colors);}
function initGrid(){state.grid=[];for(var r=0;r<CFG.rows;r++){var row=[];var n=colsInRow(r);for(var c=0;c<n;c++)row.push(randomColor());state.grid.push(row);}}
function neighbors(row,col){var odd=row%2===1;var deltas=odd?[[0,-1],[0,1],[-1,0],[-1,1],[1,0],[1,1]]:[[0,-1],[0,1],[-1,-1],[-1,0],[1,-1],[1,0]];var out=[];for(var i=0;i<deltas.length;i++){var rr=row+deltas[i][0],cc=col+deltas[i][1];if(rr>=0&&rr<state.grid.length&&cc>=0&&cc<state.grid[rr].length&&state.grid[rr][cc]!==null)out.push([rr,cc]);}return out;}
function findCluster(row,col){var color=state.grid[row][col];if(color===null)return[];var visited=new Set();var stack=[[row,col]];var cluster=[];while(stack.length){var p=stack.pop();var r=p[0],c=p[1];var k=r+","+c;if(visited.has(k))continue;visited.add(k);if(state.grid[r][c]!==color)continue;cluster.push([r,c]);neighbors(r,c).forEach(function(n){stack.push(n);});}return cluster;}
function connectedToCeiling(){var visited=new Set();var stack=[];if(!state.grid.length)return visited;for(var c=0;c<state.grid[0].length;c++)if(state.grid[0][c]!==null)stack.push([0,c]);while(stack.length){var p=stack.pop();var r=p[0],cc=p[1];var k=r+","+cc;if(visited.has(k))continue;visited.add(k);neighbors(r,cc).forEach(function(n){stack.push(n);});}return visited;}
function dropOrphans(){var connected=connectedToCeiling();var dropped=0;for(var r=0;r<state.grid.length;r++)for(var c=0;c<state.grid[r].length;c++)if(state.grid[r][c]!==null&&!connected.has(r+","+c)){state.grid[r][c]=null;dropped++;}while(state.grid.length&&state.grid[state.grid.length-1].every(function(v){return v===null;}))state.grid.pop();return dropped;}
function snapBubble(x,y,color){var best=null,bestDist=Infinity;var maxRows=Math.max(state.grid.length+1,CFG.rows+2);for(var r=0;r<maxRows;r++){var n=colsInRow(r);if(!state.grid[r])state.grid[r]=Array(n).fill(null);while(state.grid[r].length<n)state.grid[r].push(null);for(var c=0;c<n;c++){if(state.grid[r][c]!==null)continue;var p=cellCenter(r,c);var d=Math.hypot(p.x-x,p.y-y);if(d<bestDist){bestDist=d;best={r:r,c:c};}}}if(!best)return;var nn=colsInRow(best.r);if(!state.grid[best.r])state.grid[best.r]=Array(nn).fill(null);state.grid[best.r][best.c]=color;var cl=findCluster(best.r,best.c);if(cl.length>=3){cl.forEach(function(p){state.grid[p[0]][p[1]]=null;});state.score+=cl.length*10;var dr=dropOrphans();state.score+=dr*15;}document.getElementById("scoreDisplay").textContent="Score: "+state.score;checkEnd();}
function checkEnd(){var any=false,tooLow=false;var dangerY=canvas.height-80;for(var r=0;r<state.grid.length;r++)for(var c=0;c<state.grid[r].length;c++)if(state.grid[r][c]!==null){any=true;if(cellCenter(r,c).y+R>dangerY)tooLow=true;}if(!any)endGame(true);else if(tooLow)endGame(false);}
function endGame(won){state.gameOver=true;state.running=false;state.flying=null;document.getElementById("resultTitle").textContent=won?"You cleared it!":"Game Over";document.getElementById("resultMsg").textContent="Score: "+state.score;document.getElementById("resultOverlay").classList.remove("hidden");try{window.parent.postMessage({type:'gameEnd',game:'bubble',quizId:QUIZ_ID,won:won,score:state.score,answers:quizAnswers},'*');}catch(e){}}
function shoot(){if(!state.running||state.flying||state.gameOver)return;if(ammo<=0){openQuiz(function(){});return;}ammo--;updateAmmoUI();var speed=CFG.speed;state.flying={x:canvas.width/2,y:canvas.height-40,vx:Math.cos(state.aimAngle)*speed,vy:Math.sin(state.aimAngle)*speed,color:state.current};state.current=state.next;state.next=randomColor();}
function update(){if(!state.flying)return;var b=state.flying;b.x+=b.vx;b.y+=b.vy;if(b.x-R<0){b.x=R;b.vx*=-1;}if(b.x+R>canvas.width){b.x=canvas.width-R;b.vx*=-1;}if(b.y-R<=0){snapBubble(b.x,R,b.color);state.flying=null;return;}for(var r=0;r<state.grid.length;r++)for(var c=0;c<state.grid[r].length;c++){if(state.grid[r][c]===null)continue;var p=cellCenter(r,c);if(Math.hypot(p.x-b.x,p.y-b.y)<R*1.85){snapBubble(b.x,b.y,b.color);state.flying=null;return;}}}
function drawBubble(x,y,colorIndex){ctx.beginPath();ctx.arc(x,y,R-1,0,Math.PI*2);ctx.fillStyle=COLORS[colorIndex];ctx.fill();ctx.strokeStyle="rgba(255,255,255,0.35)";ctx.lineWidth=2;ctx.stroke();}
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#1e293b";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.strokeStyle="rgba(239,68,68,0.5)";ctx.setLineDash([6,6]);ctx.beginPath();ctx.moveTo(0,canvas.height-80);ctx.lineTo(canvas.width,canvas.height-80);ctx.stroke();ctx.setLineDash([]);for(var r=0;r<state.grid.length;r++)for(var c=0;c<state.grid[r].length;c++){if(state.grid[r][c]===null)continue;var p=cellCenter(r,c);drawBubble(p.x,p.y,state.grid[r][c]);}if(!state.flying&&state.running){var sx=canvas.width/2,sy=canvas.height-40;ctx.strokeStyle="rgba(255,255,255,0.35)";ctx.beginPath();ctx.moveTo(sx,sy);var ax=sx,ay=sy,vx=Math.cos(state.aimAngle),vy=Math.sin(state.aimAngle);for(var i=0;i<80;i++){ax+=vx*8;ay+=vy*8;if(ax<R||ax>canvas.width-R)vx*=-1;if(ay<0)break;ctx.lineTo(ax,ay);}ctx.stroke();}if(state.flying)drawBubble(state.flying.x,state.flying.y,state.flying.color);else if(state.running)drawBubble(canvas.width/2,canvas.height-40,state.current);ctx.fillStyle="#94a3b8";ctx.font="12px Outfit, sans-serif";ctx.fillText("Next",12,canvas.height-12);drawBubble(50,canvas.height-28,state.next);}
function loop(){if(!state.running)return;update();draw();requestAnimationFrame(loop);}
function setAimFromEvent(e){var rect=canvas.getBoundingClientRect();var sx=rect.width/canvas.width;var clientX=e.touches?e.touches[0].clientX:e.clientX;var clientY=e.touches?e.touches[0].clientY:e.clientY;var x=(clientX-rect.left)/sx;var y=(clientY-rect.top)/sx;var ax=canvas.width/2,ay=canvas.height-40;var angle=Math.atan2(y-ay,x-ax);if(angle>0)angle=-0.2;state.aimAngle=Math.max(-Math.PI+0.2,Math.min(-0.2,angle));}
function startNewGame(){initGrid();state.score=0;state.current=randomColor();state.next=randomColor();state.flying=null;state.gameOver=false;state.running=true;state.aimAngle=-Math.PI/2;ammo=AMMO_START;quizAnswers=[];updateAmmoUI();document.getElementById("scoreDisplay").textContent="Score: 0";document.getElementById("resultOverlay").classList.add("hidden");draw();requestAnimationFrame(loop);}
document.getElementById("newGameBtn").addEventListener("click",startNewGame);
document.getElementById("playAgainBtn").addEventListener("click",startNewGame);
document.getElementById("fireBtn").addEventListener("click",shoot);
canvas.addEventListener("mousemove",setAimFromEvent);
canvas.addEventListener("touchmove",function(e){e.preventDefault();setAimFromEvent(e);},{passive:false});
canvas.addEventListener("click",shoot);
canvas.addEventListener("touchend",function(e){e.preventDefault();shoot();});
updateAmmoUI();startNewGame();
})();
<\/script></body></html>`;
}

function buildAsteroidsHTML(questions, title, quizId) {
  const Q = JSON.stringify(questions).replace(/</g, '\\u003c');
  const QID = JSON.stringify(quizId || 'preset');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>Asteroids</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet" />
<style>
:root{--bg:#050816;--panel:#0b1224;--text:#e2e8f0;--accent:#38bdf8;--danger:#ef4444;--ok:#22c55e}
*{box-sizing:border-box}body{margin:0;font-family:"Outfit",sans-serif;background:radial-gradient(ellipse at 20% 0%,rgba(56,189,248,.12),transparent 45%),radial-gradient(ellipse at top,#111827,var(--bg));min-height:100vh;color:var(--text)}
.wrapper{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:12px}
.hidden{display:none!important}
.game-screen{width:100%;max-width:520px;display:flex;flex-direction:column;align-items:center}
.header{display:flex;flex-wrap:wrap;align-items:center;gap:10px;width:100%;margin-bottom:10px}
.header h1{margin:0;font-size:clamp(1.3rem,4vw,2rem)}
.header-actions{display:flex;gap:8px;margin-left:auto;align-items:center}
.hud{font-weight:700;color:var(--accent);font-size:.85rem}
.btn{padding:10px 14px;border:none;border-radius:8px;background:rgba(255,255,255,.25);color:inherit;font-family:inherit;font-weight:600;cursor:pointer}
#gameCanvas{width:100%;max-width:480px;height:auto;background:radial-gradient(circle at 30% 20%,rgba(255,255,255,.06) 0 1px,transparent 2px),var(--panel);border-radius:12px;display:block}
.touch-controls{display:flex;gap:8px;width:100%;max-width:480px;margin-top:10px}
.ctrl-btn{flex:1;min-height:52px;border:none;border-radius:10px;background:rgba(255,255,255,.15);color:inherit;font-size:1.1rem;font-weight:700;cursor:pointer}
.ctrl-btn.fire{background:var(--accent);color:#0b1224}
.result-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;z-index:200;padding:20px}
.result-box{background:var(--panel);border-radius:16px;padding:28px;max-width:400px;width:100%;text-align:center}
.result-box h2{color:var(--ok);margin:0 0 8px}
.result-box h2.lose{color:var(--danger)}
.result-actions{display:flex;flex-direction:column;gap:10px;margin-top:16px}
${GAME_QUIZ_CSS}
</style></head><body>
<div class="wrapper"><div id="gameScreen" class="game-screen">
  <header class="header"><h1>Asteroids</h1><span class="ammo-badge" id="ammoBadge">Ammo: 10</span><div class="header-actions"><span id="hud" class="hud">Score: 0 · Lives: 3 · Wave: 1</span><button type="button" id="newGameBtn" class="btn">New Game</button></div></header>
  <canvas id="gameCanvas" width="480" height="560"></canvas>
  <div class="touch-controls"><button type="button" id="rotLeftBtn" class="ctrl-btn">↺</button><button type="button" id="rotRightBtn" class="ctrl-btn">↻</button><button type="button" id="thrustBtn" class="ctrl-btn">▲</button><button type="button" id="fireBtn" class="ctrl-btn fire">Fire</button></div>
  <div id="resultOverlay" class="result-overlay hidden"><div class="result-box"><h2 id="resultTitle"></h2><p id="resultMsg"></p><div class="result-actions"><button type="button" id="playAgainBtn" class="btn">Play Again</button></div></div></div>
</div></div>
<script>
(function(){
"use strict";
var QUESTIONS = ${Q}; var QUIZ_ID = ${QID};
var ROCK_RADII={large:40,medium:24,small:12};
var ROCK_SCORES={large:20,medium:50,small:100};
var BULLET_LIFE=1.15,BULLET_SPEED=420,SHIP_RADIUS=12,INVULN_MS=2000,ROT_SPEED=3.6,THRUST=260,DRAG=0.985,MAX_SPEED=320;
var canvas=document.getElementById("gameCanvas"),ctx=canvas.getContext("2d");
var lastTime=0;
var state={score:0,lives:3,wave:1,running:false,gameOver:false,won:false,ship:null,rocks:[],bullets:[],ufo:null,ufoBullets:[],fireCooldown:0,keys:{left:false,right:false,thrust:false,fire:false}};
var CFG={lives:3,startRocks:4,wavesToWin:5,speed:1.0,fireCd:180,ufoFromWave:3,ufoFireMs:1100};
var AMMO_START=10,AMMO_PER_CORRECT=10,AMMO_PER_WRONG=2;
var ammo=AMMO_START,quizIdx=0,quizOpen=false,quizAnswers=[];
var ammoBadge=document.getElementById("ammoBadge");
function updateAmmoUI(){ammoBadge.textContent="Ammo: "+ammo;ammoBadge.classList.toggle("low",ammo<=2);}
${GAME_QUIZ_HELPERS}
var openQuiz = makeQuizModal({isOpen:function(){return quizOpen;},setOpen:function(v){quizOpen=v;},getAmmo:function(){return ammo;},setAmmo:function(v){ammo=v;},getIdx:function(){return quizIdx;},setIdx:function(v){quizIdx=v;},gainCorrect:AMMO_PER_CORRECT,gainWrong:AMMO_PER_WRONG,onUpdate:updateAmmoUI,onAnswer:function(qIdx,correct){quizAnswers.push({qIdx:qIdx,correct:correct});}});
function wrap(v,max){if(v<0)return v+max;if(v>=max)return v-max;return v;}
function dist(ax,ay,bx,by){var dx=ax-bx,dy=ay-by;return Math.sqrt(dx*dx+dy*dy);}
function circleHit(ax,ay,ar,bx,by,br){return dist(ax,ay,bx,by)<ar+br;}
function makeShip(){return{x:canvas.width/2,y:canvas.height/2,vx:0,vy:0,angle:-Math.PI/2,invulnUntil:performance.now()+INVULN_MS,alive:true};}
function rockVerts(radius){var verts=[],n=8+Math.floor(Math.random()*4);for(var i=0;i<n;i++){var a=(i/n)*Math.PI*2;var j=radius*(0.75+Math.random()*0.35);verts.push({x:Math.cos(a)*j,y:Math.sin(a)*j});}return verts;}
function makeRock(size,x,y,speedMul){var radius=ROCK_RADII[size];var angle=Math.random()*Math.PI*2;var speed=(20+Math.random()*50)*speedMul;return{size:size,x:x,y:y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,radius:radius,rot:Math.random()*Math.PI*2,rotSpeed:(Math.random()-0.5)*1.5,verts:rockVerts(radius)};}
function spawnRocks(count){var rocks=[];var speedMul=CFG.speed*(1+(state.wave-1)*0.08);var ship=state.ship;var attempts=0;while(rocks.length<count&&attempts<count*40){attempts++;var x=Math.random()*canvas.width,y=Math.random()*canvas.height;if(ship&&dist(x,y,ship.x,ship.y)<120)continue;rocks.push(makeRock("large",x,y,speedMul));}while(rocks.length<count){var edge=Math.floor(Math.random()*4);var x2,y2;if(edge===0){x2=Math.random()*canvas.width;y2=20;}else if(edge===1){x2=canvas.width-20;y2=Math.random()*canvas.height;}else if(edge===2){x2=Math.random()*canvas.width;y2=canvas.height-20;}else{x2=20;y2=Math.random()*canvas.height;}rocks.push(makeRock("large",x2,y2,speedMul));}return rocks;}
function splitRock(rock){var next=rock.size==="large"?"medium":rock.size==="medium"?"small":null;if(!next)return[];var speedMul=CFG.speed*(1+(state.wave-1)*0.08);return[makeRock(next,rock.x,rock.y,speedMul*1.15),makeRock(next,rock.x,rock.y,speedMul*1.15)];}
function updateHud(){document.getElementById("hud").textContent="Score: "+state.score+" · Lives: "+state.lives+" · Wave: "+state.wave;}
function resetGame(){state.score=0;state.lives=CFG.lives;state.wave=1;state.gameOver=false;state.won=false;state.ship=makeShip();state.rocks=spawnRocks(CFG.startRocks);state.bullets=[];state.ufo=null;state.ufoBullets=[];state.fireCooldown=0;state.running=true;ammo=AMMO_START;quizAnswers=[];updateAmmoUI();updateHud();document.getElementById("resultOverlay").classList.add("hidden");document.getElementById("resultTitle").classList.remove("lose");lastTime=performance.now();}
function startNextWave(){state.wave++;var count=CFG.startRocks+(state.wave-1);state.rocks=spawnRocks(count);state.bullets=[];state.ufoBullets=[];state.ufo=null;state.ship.invulnUntil=performance.now()+INVULN_MS;updateHud();}
function endGame(won){state.running=false;state.gameOver=true;state.won=won;var t=document.getElementById("resultTitle");t.textContent=won?"You Win!":"Game Over";t.classList.toggle("lose",!won);document.getElementById("resultMsg").textContent="Score: "+state.score;document.getElementById("resultOverlay").classList.remove("hidden");try{window.parent.postMessage({type:'gameEnd',game:'asteroids',quizId:QUIZ_ID,won:won,score:state.score,answers:quizAnswers},'*');}catch(e){}}
function fireBullet(){if(!state.running||!state.ship||!state.ship.alive)return;if(state.fireCooldown>0)return;if(ammo<=0){openQuiz(function(){});return;}ammo--;updateAmmoUI();var s=state.ship;state.bullets.push({x:s.x+Math.cos(s.angle)*16,y:s.y+Math.sin(s.angle)*16,vx:Math.cos(s.angle)*BULLET_SPEED+s.vx*0.2,vy:Math.sin(s.angle)*BULLET_SPEED+s.vy*0.2,life:BULLET_LIFE});state.fireCooldown=CFG.fireCd/1000;}
function spawnUfoIfNeeded(){if(!CFG.ufoFromWave||state.wave<CFG.ufoFromWave)return;if(state.ufo)return;if(Math.random()>0.008)return;var fromLeft=Math.random()<0.5;state.ufo={x:fromLeft?-20:canvas.width+20,y:60+Math.random()*(canvas.height*0.5),vx:(fromLeft?1:-1)*(70+Math.random()*40)*CFG.speed,vy:(Math.random()-0.5)*30,r:14,fireTimer:0.6};}
function killShip(){var now=performance.now();if(now<state.ship.invulnUntil)return;state.lives--;updateHud();state.bullets=[];state.ufoBullets=[];if(state.lives<=0){endGame(false);return;}state.ship=makeShip();}
function update(dt){if(!state.running)return;var ship=state.ship,speedScale=CFG.speed;if(state.fireCooldown>0)state.fireCooldown-=dt;if(state.keys.fire)fireBullet();if(ship&&ship.alive){if(state.keys.left)ship.angle-=ROT_SPEED*dt;if(state.keys.right)ship.angle+=ROT_SPEED*dt;if(state.keys.thrust){ship.vx+=Math.cos(ship.angle)*THRUST*speedScale*dt;ship.vy+=Math.sin(ship.angle)*THRUST*speedScale*dt;}var sp=Math.sqrt(ship.vx*ship.vx+ship.vy*ship.vy);var maxSp=MAX_SPEED*speedScale;if(sp>maxSp){ship.vx=(ship.vx/sp)*maxSp;ship.vy=(ship.vy/sp)*maxSp;}var drag=Math.pow(DRAG,dt*60);ship.vx*=drag;ship.vy*=drag;ship.x=wrap(ship.x+ship.vx*dt,canvas.width);ship.y=wrap(ship.y+ship.vy*dt,canvas.height);}for(var i=state.bullets.length-1;i>=0;i--){var b=state.bullets[i];b.life-=dt;b.x=wrap(b.x+b.vx*dt,canvas.width);b.y=wrap(b.y+b.vy*dt,canvas.height);if(b.life<=0)state.bullets.splice(i,1);}for(var r=0;r<state.rocks.length;r++){var rk=state.rocks[r];rk.x=wrap(rk.x+rk.vx*dt,canvas.width);rk.y=wrap(rk.y+rk.vy*dt,canvas.height);rk.rot+=rk.rotSpeed*dt;}spawnUfoIfNeeded();if(state.ufo){var u=state.ufo;u.x+=u.vx*dt;u.y+=u.vy*dt;if(u.y<40||u.y>canvas.height*0.7)u.vy*=-1;u.fireTimer-=dt;if(u.fireTimer<=0&&ship){var ang=Math.atan2(ship.y-u.y,ship.x-u.x);var spd=180*speedScale;state.ufoBullets.push({x:u.x,y:u.y,vx:Math.cos(ang)*spd,vy:Math.sin(ang)*spd,life:2.2});u.fireTimer=CFG.ufoFireMs/1000;}if(u.x<-40||u.x>canvas.width+40)state.ufo=null;}for(var j=state.ufoBullets.length-1;j>=0;j--){var ub=state.ufoBullets[j];ub.life-=dt;ub.x+=ub.vx*dt;ub.y+=ub.vy*dt;if(ub.life<=0||ub.x<-20||ub.x>canvas.width+20||ub.y<-20||ub.y>canvas.height+20)state.ufoBullets.splice(j,1);}for(var bi=state.bullets.length-1;bi>=0;bi--){var b2=state.bullets[bi];var hit=false;for(var ri=state.rocks.length-1;ri>=0;ri--){var rr=state.rocks[ri];if(circleHit(b2.x,b2.y,2,rr.x,rr.y,rr.radius)){state.score+=ROCK_SCORES[rr.size];var pieces=splitRock(rr);state.rocks.splice(ri,1);for(var p=0;p<pieces.length;p++)state.rocks.push(pieces[p]);state.bullets.splice(bi,1);hit=true;updateHud();break;}}if(hit)continue;if(state.ufo&&circleHit(b2.x,b2.y,2,state.ufo.x,state.ufo.y,state.ufo.r)){state.score+=200;state.ufo=null;state.bullets.splice(bi,1);updateHud();}}if(ship&&ship.alive){for(var r2=0;r2<state.rocks.length;r2++){var rk2=state.rocks[r2];if(circleHit(ship.x,ship.y,SHIP_RADIUS,rk2.x,rk2.y,rk2.radius)){killShip();break;}}if(state.running&&state.ufo&&circleHit(ship.x,ship.y,SHIP_RADIUS,state.ufo.x,state.ufo.y,state.ufo.r))killShip();if(state.running)for(var k=0;k<state.ufoBullets.length;k++){var ub2=state.ufoBullets[k];if(circleHit(ship.x,ship.y,SHIP_RADIUS,ub2.x,ub2.y,3)){killShip();break;}}}if(state.running&&state.rocks.length===0){if(state.wave>=CFG.wavesToWin)endGame(true);else startNextWave();}}
function drawShip(ship,now){var blinking=now<ship.invulnUntil;if(blinking&&Math.floor(now/100)%2===0)return;ctx.save();ctx.translate(ship.x,ship.y);ctx.rotate(ship.angle);ctx.strokeStyle="#f8fafc";ctx.fillStyle="rgba(56,189,248,0.25)";ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(16,0);ctx.lineTo(-12,10);ctx.lineTo(-8,0);ctx.lineTo(-12,-10);ctx.closePath();ctx.fill();ctx.stroke();ctx.restore();}
function drawRock(rock){ctx.save();ctx.translate(rock.x,rock.y);ctx.rotate(rock.rot);ctx.strokeStyle="#cbd5e1";ctx.lineWidth=2;ctx.beginPath();for(var i=0;i<rock.verts.length;i++){var v=rock.verts[i];if(i===0)ctx.moveTo(v.x,v.y);else ctx.lineTo(v.x,v.y);}ctx.closePath();ctx.stroke();ctx.restore();}
function draw(){ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#0b1224";ctx.fillRect(0,0,canvas.width,canvas.height);var now=performance.now();for(var r=0;r<state.rocks.length;r++)drawRock(state.rocks[r]);ctx.fillStyle="#f8fafc";for(var b=0;b<state.bullets.length;b++){var bl=state.bullets[b];ctx.beginPath();ctx.arc(bl.x,bl.y,2.2,0,Math.PI*2);ctx.fill();}ctx.fillStyle="#ef4444";for(var ub=0;ub<state.ufoBullets.length;ub++){var ubl=state.ufoBullets[ub];ctx.beginPath();ctx.arc(ubl.x,ubl.y,3,0,Math.PI*2);ctx.fill();}if(state.ufo){var u=state.ufo;ctx.save();ctx.translate(u.x,u.y);ctx.fillStyle="#a78bfa";ctx.beginPath();ctx.ellipse(0,0,18,8,0,0,Math.PI*2);ctx.fill();ctx.restore();}if(state.ship&&state.ship.alive)drawShip(state.ship,now);}
function loop(ts){if(!state.running)return;if(!lastTime)lastTime=ts;var dt=(ts-lastTime)/1000;lastTime=ts;if(dt>0.05)dt=0.05;update(dt);draw();if(state.running)requestAnimationFrame(loop);}
function bindHold(el,key){var on=function(e){e.preventDefault();state.keys[key]=true;};var off=function(){state.keys[key]=false;};el.addEventListener("touchstart",on,{passive:false});el.addEventListener("touchend",off);el.addEventListener("mousedown",on);el.addEventListener("mouseup",off);el.addEventListener("mouseleave",off);}
document.getElementById("newGameBtn").addEventListener("click",function(){resetGame();requestAnimationFrame(loop);});
document.getElementById("playAgainBtn").addEventListener("click",function(){resetGame();requestAnimationFrame(loop);});
window.addEventListener("keydown",function(e){if(e.key==="ArrowLeft"||e.key==="a")state.keys.left=true;if(e.key==="ArrowRight"||e.key==="d")state.keys.right=true;if(e.key==="ArrowUp"||e.key==="w"){e.preventDefault();state.keys.thrust=true;}if(e.key===" "){e.preventDefault();state.keys.fire=true;fireBullet();}});
window.addEventListener("keyup",function(e){if(e.key==="ArrowLeft"||e.key==="a")state.keys.left=false;if(e.key==="ArrowRight"||e.key==="d")state.keys.right=false;if(e.key==="ArrowUp"||e.key==="w")state.keys.thrust=false;if(e.key===" ")state.keys.fire=false;});
bindHold(document.getElementById("rotLeftBtn"),"left");bindHold(document.getElementById("rotRightBtn"),"right");bindHold(document.getElementById("thrustBtn"),"thrust");
document.getElementById("fireBtn").addEventListener("click",fireBullet);
updateAmmoUI();resetGame();requestAnimationFrame(loop);
})();
<\/script></body></html>`;
}

/* ===================== AI / Auth (unchanged) ===================== */
const AI_MODEL = 'gpt-4o-mini', AI_FALLBACK = 'gpt-4o';
let aiErrors = [];
function logAIError(label, err, context) {
  const detail = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err);
  aiErrors.unshift({ time: new Date().toLocaleTimeString(), label, detail, context: context || '' });
  renderAIErrors(); console.error('[AI]', label, err, context || '');
}
function renderAIErrors() {
  const panel = document.getElementById('aiErrors'), list = document.getElementById('aiErrorList'), cnt = document.getElementById('aiErrCount'), tot = document.getElementById('aiErrTotal');
  if (!panel || !list) return;
  cnt.textContent = aiErrors.length; tot.textContent = aiErrors.length;
  panel.hidden = aiErrors.length === 0;
  list.innerHTML = aiErrors.map(e => `<li><b>${esc(e.label)} <span style="opacity:.6;font-weight:400">· ${esc(e.time)}</span></b>${esc(e.detail)}${e.context ? '<br><span style="opacity:.7">' + esc(e.context) + '</span>' : ''}</li>`).join('');
}
document.getElementById('aiErrorsToggle').onclick = () => { const p = document.getElementById('aiErrors'); p.hidden = !p.hidden; };
document.getElementById('aiErrorsClear').onclick = () => { aiErrors = []; renderAIErrors(); };

let authState = 'unknown', authLastReason = '', authInFlight = null, authPopupShown = false;
function isCreditsError(e) { if (!e) return false; const m = String(e.message || e.error || e || '').toLowerCase(); return m.includes('not enough credits') || m.includes('upgrade your plan'); }
function isAuthError(e) { return e && (e.error === 'must_login_or_signup' || e.status === 401 || e.status === 403); }
function describeAuthError(e) {
  if (!e) return 'Unknown error.';
  const code = e.error || e.code || '';
  const map = { 'auth_window_closed': 'The sign-in window was closed.', 'popup_blocked': 'Your browser blocked the Puter popup.', 'auth_cancelled': 'Sign-in was cancelled.', 'network_error': 'Network error talking to Puter.', 'server_error': 'Puter returned a server error.' };
  if (map[code]) return map[code];
  if (e.message) return e.message;
  if (code) return 'Puter returned code: ' + code;
  return 'Unknown error.';
}
function showAuthPopup({ title, body, tone, actions }) {
  const scrim = document.getElementById('authScrim'), modal = document.getElementById('authModal'); if (!scrim || !modal) return;
  const toneStyles = { ok: 'background:#e6f5e9;color:#26890c;border-color:#26890c', warn: 'background:#fff6d6;color:#8a6b00;border-color:#d89e00', bad: 'background:#fde8e6;color:#8a2721;border-color:#8a2721' };
  const ts = toneStyles[tone] || toneStyles.warn;
  modal.innerHTML = '<h3 style="margin:0 0 8px">' + esc(title) + '</h3><div style="display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:700;border:1px solid;margin-bottom:14px;' + ts + '">' + (tone === 'ok' ? '✓ Success' : tone === 'bad' ? '✗ Failed' : '⚠ Notice') + '</div><div style="font-size:14px;line-height:1.5;color:var(--dark-grey);white-space:pre-wrap">' + esc(body) + '</div><div class="foot" style="margin-top:18px;flex-wrap:wrap">' + (actions || []).map((a, i) => '<button class="btn ' + (a.kind === 'ghost' ? 'ghost' : '') + '" data-auth-action="' + i + '">' + esc(a.label) + '</button>').join('') + '</div>';
  scrim.classList.add('show');
  modal.querySelectorAll('[data-auth-action]').forEach((btn, i) => { btn.onclick = () => { const act = (actions || [])[i]; scrim.classList.remove('show'); if (act && typeof act.onClick === 'function') act.onClick(); }; });
}
function closeAuthPopup() { const s = document.getElementById('authScrim'); if (s) s.classList.remove('show'); }
document.getElementById('authScrim').addEventListener('click', e => { if (e.target.id === 'authScrim') closeAuthPopup(); });

async function ensureAuth(opts = {}) {
  const forceReal = !!opts.forceRealSignIn, silent = !!opts.silent;
  if (authInFlight && !forceReal) return authInFlight;
  authInFlight = (async () => {
    if (!window.puter || !puter.auth) { authState = 'failed'; authLastReason = 'Puter.js not loaded.'; logAIError('Puter auth missing', new Error(authLastReason)); return false; }
    try {
      const si = await puter.auth.isSignedIn();
      if (si) {
        const user = await puter.auth.getUser().catch(() => null);
        const isTemp = user && !user.email;
        if (!(forceReal && isTemp)) { authState = isTemp ? 'temp' : 'signed'; authLastReason = ''; if (!forceReal) return true; }
      }
    } catch (e) {}
    if (authState === 'exhausted' || forceReal) {
      try { await puter.auth.signIn(); authState = 'signed'; authLastReason = ''; try { localStorage.removeItem('adminhub_auth_exhausted'); } catch (e) {} if (!silent) toast('Signed in'); return true; }
      catch (e2) { authState = 'failed'; authLastReason = describeAuthError(e2); logAIError('Real sign-in failed', e2); return false; }
    }
    try { await puter.auth.signIn({ attempt_temp_user_creation: true }); authState = 'temp'; authLastReason = ''; return true; }
    catch (e) { authLastReason = describeAuthError(e); logAIError('Temp user creation failed', e); }
    try { await puter.auth.signIn(); authState = 'signed'; authLastReason = ''; return true; }
    catch (e2) { authState = 'failed'; authLastReason = describeAuthError(e2); logAIError('Sign-in failed', e2); return false; }
  })();
  try { return await authInFlight; } finally { authInFlight = null; updateAuthBadge(); updateLogoutVisibility(); }
}
async function puterLogout() {
  if (authState !== 'signed') { toast('Logout only works for a full Puter account.'); return; }
  try {
    await puter.auth.signOut();
    authState = 'unknown'; authLastReason = '';
    try { localStorage.removeItem('adminhub_auth_exhausted'); } catch (e) {}
    updateAuthBadge(); updateLogoutVisibility(); toast('Signed out of Puter.');
  } catch (e) { logAIError('Sign-out failed', e); toast('Could not sign out.'); }
}
function updateLogoutVisibility() { const b = document.getElementById('puterLogout'); if (b) b.style.display = authState === 'signed' ? '' : 'none'; }
function updateAuthBadge() {
  const badge = document.getElementById('authBadge'), icon = document.getElementById('authIcon'), text = document.getElementById('authText');
  if (!badge || !icon || !text) return;
  badge.classList.remove('temp', 'signed', 'failed', 'exhausted', 'clickable'); badge.onclick = null;
  if (authState === 'temp') { badge.classList.add('temp'); icon.className = 'bx bx-user-check'; text.textContent = 'Guest session'; }
  else if (authState === 'signed') { badge.classList.add('signed'); icon.className = 'bx bx-check-circle'; text.textContent = 'Signed in'; }
  else if (authState === 'exhausted') { badge.classList.add('exhausted', 'clickable'); icon.className = 'bx bx-error'; text.textContent = 'Out of credits'; badge.onclick = async () => { authState = 'unknown'; updateAuthBadge(); const ok = await ensureAuth({ forceRealSignIn: true }); if (ok) toast('Signed in.'); }; }
  else if (authState === 'failed') { badge.classList.add('failed'); icon.className = 'bx bx-error-circle'; text.textContent = 'Auth failed'; }
  else { icon.className = 'bx bx-loader-alt spin'; text.textContent = 'Checking…'; }
}

const AI_PROMPT = (n, topic, notes) => `You are a quiz generator. Return ONLY valid JSON. No prose, no markdown.
Shape: {"title":"...","questions":[{"question":"...","options":["A","B","C","D"],"correct":0,"timeLimit":20,"explanation":"..."}]}
Make EXACTLY ${n} questions. Topic: ${topic}. Notes: ${notes || '(none)'}.`;
const FLOW_ORDER = ['topic', 'grade', 'count', 'difficulty'];
const FLOW_QUESTIONS = { topic: 'What is your set topic?', grade: 'What grade level?', count: 'How many questions? (1–100)', difficulty: 'Difficulty? Easy, Medium, or Hard.' };
const FLOW_RETRIES = { topic: 'Try something like "dinosaur questions" or "photosynthesis".', grade: 'Just a grade — "3rd grade", "7th", "high school".', count: 'A number between 1 and 100.', difficulty: 'Pick one: Easy, Medium, or Hard.' };
const FLOW_PARSERS = {
  topic: v => { const t = v.trim(); if (t.length < 3 || /^(idk|no|nope)$/i.test(t)) return null; return t; },
  grade: v => v.trim() ? v.trim().slice(0, 60) : null,
  count: v => { const m = String(v).match(/\d{1,3}/); if (!m) return null; const n = parseInt(m[0], 10); return n >= 1 && n <= 100 ? n : null; },
  difficulty: v => { const t = v.toLowerCase(); if (/easy|simple/.test(t)) return 'easy'; if (/medium|normal|med/.test(t)) return 'medium'; if (/hard|difficult|challenging/.test(t)) return 'hard'; return null; }
};
let chatFlow = null;
function newChat() { chatFlow = { step: 'topic', notes: '', topic: '', grade: '', count: 5, difficulty: 'medium' }; $('#chatLog').innerHTML = ''; botSay('Let\'s build a quiz. ' + FLOW_QUESTIONS.topic); updateChips(); }
function renderChat() { if (!chatFlow) newChat(); }
function updateChips() {
  const el = document.getElementById('chatChips'); if (!el) return;
  const sets = { topic: ['Dinosaur questions', 'The water cycle', 'World War II', 'Parts of a cell'], grade: ['3rd grade', '5th grade', 'Middle school', 'High school'], count: ['5', '10', '15', '20'], difficulty: ['Easy', 'Medium', 'Hard'], done: [] };
  el.innerHTML = (sets[chatFlow && chatFlow.step] || []).map(c => `<button class="chip" data-chip="${esc(c)}">${esc(c)}</button>`).join('');
}
function botSay(t) { addMsg('bot', t); }
function userSay(t) { addMsg('user', t); }
function sysSay(t) { addMsg('sys', t); }
function addMsg(kind, text) { const log = $('#chatLog'); const el = document.createElement('div'); el.className = 'msg ' + kind; el.textContent = text; log.appendChild(el); log.scrollTop = log.scrollHeight; }
function setWaiting(w) { if (!chatFlow) chatFlow = {}; chatFlow.waiting = w; $('#aiSend').innerHTML = w ? "<i class='bx bx-loader-alt spin'></i>" : "<i class='bx bx-send'></i>"; $('#aiSend').disabled = w; }
$('#chatChips').addEventListener('click', e => { const c = e.target.closest('[data-chip]'); if (!c) return; $('#aiInput').value = c.dataset.chip; $('#aiSend').click(); });
$('#aiAttach').onclick = () => $('#aiFile').click();
$('#aiFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; $('#aiFile').value = '';
  if (!chatFlow) newChat(); userSay('📎 ' + f.name); sysSay('Reading…');
  try {
    let text = '';
    if (/\.pdf$/i.test(f.name)) { if (!window.pdfjsLib) { botSay('PDF support failed.'); return; } const buf = await f.arrayBuffer(); const pdf = await pdfjsLib.getDocument({ data: buf }).promise; const parts = []; for (let i = 1; i <= pdf.numPages; i++) { const pg = await pdf.getPage(i); const ct = await pg.getTextContent(); parts.push(ct.items.map(x => x.str).join(' ')); } text = parts.join('\n\n'); }
    else text = await f.text();
    text = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    const words = text.split(/\s+/).length;
    if (words < 20) { botSay('No selectable text.'); return; }
    chatFlow.notes = (chatFlow.notes ? chatFlow.notes + '\n\n' : '') + text;
    sysSay('Added ~' + words + ' words.');
    if (chatFlow.step === 'topic') { chatFlow.topic = 'the attached ' + f.name; chatFlow.step = 'grade'; botSay('Got notes. ' + FLOW_QUESTIONS.grade); updateChips(); }
  } catch (err) { logAIError('File read failed', err); botSay("Couldn't read that file."); }
};
$('#aiSend').onclick = async () => {
  if (!chatFlow) newChat(); const v = $('#aiInput').value.trim(); if (!v || chatFlow.waiting) return;
  $('#aiInput').value = ''; userSay(v); await handleFlowAnswer(v);
};
$('#aiInput').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#aiSend').click(); } });
$('#aiReset').onclick = () => { newChat(); };
async function handleFlowAnswer(text) {
  if (!chatFlow) newChat();
  if (chatFlow.step === 'topic' && text.length > 400) { chatFlow.notes = (chatFlow.notes ? chatFlow.notes + '\n\n' : '') + text; chatFlow.topic = 'pasted notes'; chatFlow.step = 'grade'; botSay('Got notes. ' + FLOW_QUESTIONS.grade); updateChips(); return; }
  const step = chatFlow.step; const parsed = FLOW_PARSERS[step] ? FLOW_PARSERS[step](text) : null;
  if (parsed == null) { botSay(FLOW_RETRIES[step]); return; }
  chatFlow[step] = parsed;
  const idx = FLOW_ORDER.indexOf(step);
  if (idx < FLOW_ORDER.length - 1) { chatFlow.step = FLOW_ORDER[idx + 1]; botSay(FLOW_QUESTIONS[chatFlow.step]); updateChips(); return; }
  chatFlow.step = 'done'; updateChips(); await generateFromFlow();
}
async function generateFromFlow() {
  setWaiting(true); sysSay('Generating ' + chatFlow.count + ' ' + chatFlow.difficulty + ' questions…');
  const prompt = AI_PROMPT(chatFlow.count, chatFlow.topic + ' · grade ' + chatFlow.grade + ' · ' + chatFlow.difficulty, chatFlow.notes);
  let raw = '';
  try { raw = await aiChat(prompt); } catch (e) { logAIError('AI request failed', e); botSay('AI request failed. See Errors panel.'); setWaiting(false); chatFlow.step = 'difficulty'; updateChips(); return; }
  let data = null; try { data = parseQuizJSON(raw); } catch (e) {}
  if (!data || !data.questions.length) { logAIError('Bad JSON', new Error('No questions'), raw.slice(0, 400)); botSay('Invalid JSON. Try again.'); setWaiting(false); chatFlow.step = 'difficulty'; updateChips(); return; }
  data.title = data.title || chatFlow.topic || 'Quiz';
  addQuestionSet({ title: data.title, questions: data.questions, grade: chatFlow.grade, difficulty: chatFlow.difficulty });
  botSay('Saved "' + data.title + '". Head to Questions tab.');
  setWaiting(false); chatFlow.step = 'done'; updateChips();
}
async function aiChat(prompt) {
  const ok = await ensureAuth(); if (!ok) { const e = new Error('Auth failed'); logAIError('AI blocked: no auth', e); throw e; }
  async function attempt(model) { const res = await puter.ai.chat(prompt, { model }); return normalizePuter(res); }
  try { return await attempt(AI_MODEL); }
  catch (e) {
    if (isCreditsError(e) && authState === 'temp') { authState = 'exhausted'; updateAuthBadge(); botSay("Guest accounts have no AI credits. Sign in to generate."); throw e; }
    if (isCreditsError(e)) { botSay("Out of credits. Top up at puter.com/#billing."); throw e; }
    if (isAuthError(e)) { authState = 'unknown'; if (await ensureAuth()) { try { return await attempt(AI_MODEL); } catch (e2) {} } }
    logAIError('Primary failed', e);
  }
  return await attempt(AI_FALLBACK);
}
function normalizePuter(res) {
  if (typeof res === 'string') { if (!res.trim()) throw new Error('Empty response'); return res; }
  if (res && res.message && typeof res.message.content === 'string') return res.message.content;
  if (res && typeof res.text === 'string') return res.text;
  if (res && res.error) throw new Error('Puter error: ' + (res.error.message || JSON.stringify(res.error)));
  throw new Error('Unknown shape: ' + JSON.stringify(res).slice(0, 300));
}
function parseQuizJSON(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const f = s.indexOf('{'), l = s.lastIndexOf('}'); if (f === -1 || l === -1) return null;
  let obj; try { obj = JSON.parse(s.slice(f, l + 1)); } catch (e) { return null; }
  if (!obj || !Array.isArray(obj.questions)) return null;
  obj.questions = obj.questions.filter(q => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => typeof o === 'string' && o.length) && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4).map(q => ({ question: q.question, options: q.options.slice(0, 4), correct: q.correct, timeLimit: Number.isFinite(q.timeLimit) ? q.timeLimit : 20, explanation: typeof q.explanation === 'string' ? q.explanation : '' }));
  return obj;
}

/* ===================== Boot ===================== */
document.querySelectorAll('#sidebar .side-menu.top li a').forEach(a => a.addEventListener('click', e => e.preventDefault()));
(function ensurePreset() {
  if (!qsets.some(q => q.id === 'qs_preset')) { qsets.push({ id: 'qs_preset', title: 'Preset Quiz', created: Date.now(), questions: PRESET_QUESTIONS, source: 'preset' }); saveQSets(); }
})();
document.getElementById('puterLogout').addEventListener('click', e => { e.preventDefault(); puterLogout(); });

async function bootSession() {
  const exh = (() => { try { return localStorage.getItem('adminhub_auth_exhausted') === '1'; } catch (e) { return false; } })();
  if (exh) { authState = 'exhausted'; updateAuthBadge(); updateLogoutVisibility(); return; }
  authState = 'unknown'; updateAuthBadge();
  const ok = await ensureAuth();
  if (ok && authState === 'temp' && !authPopupShown) {
    authPopupShown = true;
    showAuthPopup({ title: 'Guest session ready', body: 'Everything works except the AI quiz generator. Sign in with a real Puter account for AI.', tone: 'warn', actions: [{ label: 'Continue as guest', onClick: closeAuthPopup }, { label: 'Sign in for AI', kind: 'ghost', onClick: async () => { authState = 'unknown'; updateAuthBadge(); await ensureAuth({ forceRealSignIn: true }); } }] });
  } else if (ok && authState === 'signed' && !authPopupShown) {
    authPopupShown = true;
    showAuthPopup({ title: 'Signed in', body: 'AI quiz generation is enabled.', tone: 'ok', actions: [{ label: 'Got it', onClick: closeAuthPopup }] });
  }
  updateAuthBadge(); updateLogoutVisibility();
}

document.querySelectorAll('#modeToggle button').forEach(b => b.classList.toggle('on', b.dataset.mode === uiMode));
render();
route();
renderAIErrors();
updateAuthBadge();
updateLogoutVisibility();
updateStudentSidebarExtras();
bootSession();

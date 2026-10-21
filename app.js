/* AdminHub app.js — teacher UI, student UI, AI quiz maker, game launcher.
   Games live in /games/ — see the GAMES list below (and games/_template.html) to add one. */

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

let uiMode = (Cloud.profile && Cloud.profile.role === 'student') ? 'student' : 'teacher';   // fixed by the account's role
function saveUiMode() {}
if (Cloud.profile && Cloud.uid) { studentIdentity.id = Cloud.uid; studentIdentity.name = Cloud.profile.displayName || studentIdentity.name; saveStudentIdentity(); }

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
const RKEY = 'adminhub_remote_v1';      // classes a student loaded from the cloud (kept apart from a teacher's own)
let cloudScores = {};                    // classId -> score docs from Firestore (teacher side)
let publishTimer = null, refreshTimer = null, studentWatchCode = null;   // cloud-sync state (declared early: save() can run at startup)
const cloudWatched = new Set();
let railOpen = true, classes = [], activeId = null, tab = 'activity', memStore = null, ownOpen = true;
try { railOpen = localStorage.getItem('adminhub_rail_open') !== '0'; } catch (e) {}
try { ownOpen = localStorage.getItem('adminhub_owned_open') !== '0'; } catch (e) {}
function load() { try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch (e) {} return memStore || []; }
function save() { memStore = classes; try { localStorage.setItem(KEY, JSON.stringify(classes.filter(c => !c.remote))); } catch (e) {} saveRemote(); cloudPublishSoon(); }
classes = load();
if (classes.length) activeId = classes[0].id;

const SCORE_KEY = 'adminhub_student_scores_v1';
function scoresMap(classId) {            // { studentId: [scores, newest first] } from this device + the cloud, no duplicates
  const out = {};
  const add = (sid, e) => { const l = out[sid] || (out[sid] = []); if (!l.some(x => x.time === e.time)) l.push(e); };
  try {
    const cm = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}')[classId];
    if (Array.isArray(cm)) cm.forEach(e => add('__legacy', e));
    else if (cm) Object.keys(cm).forEach(sid => (cm[sid] || []).forEach(e => add(sid, e)));
  } catch (e) {}
  (cloudScores[classId] || []).forEach(d => add(d.sid, { game: d.game, quizId: d.quizId, won: d.won, score: d.score, answers: d.answers || [], time: d.time }));
  Object.values(out).forEach(l => l.sort((x, y) => y.time - x.time));
  return out;
}
function getStudentScores(classId, studentId) { return scoresMap(classId)[studentId] || []; }
function getAllClassScores(classId) { return [].concat(...Object.values(scoresMap(classId))); }
function recordScore(classId, game, quizId, won, score, answers) {
  const now = Date.now();
  try {
    const all = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
    let cm = all[classId];
    if (!cm || Array.isArray(cm)) cm = { __legacy: Array.isArray(cm) ? cm : [] };
    const sid = (studentIdentity && studentIdentity.id) || '__anon';
    if (!cm[sid]) cm[sid] = [];
    cm[sid].unshift({ game, quizId: quizId || 'preset', won: !!won, score: Number(score) || 0, answers: Array.isArray(answers) ? answers : [], time: now });
    if (cm[sid].length > 200) cm[sid] = cm[sid].slice(0, 200);
    all[classId] = cm;
    localStorage.setItem(SCORE_KEY, JSON.stringify(all));
  } catch (e) {}
  const cc = classes.find(x => x.id === classId);
  if (cc) Cloud.submitScore(cc.code, { sid: (studentIdentity && studentIdentity.id) || '__anon', name: (studentIdentity && studentIdentity.name) || '', game: game || 'unknown', quizId: quizId || 'preset', won: !!won, score: Number(score) || 0, answers: Array.isArray(answers) ? answers : [], time: now }).catch(e => console.warn('Score upload failed', e));
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
    if (!c.remote) Cloud.deleteClass(c.code).catch(() => {});
    classes = classes.filter(x => x.id !== c.id); activeId = classes.length ? classes[0].id : null; save(); closeModal(); render(); } };
}
function addPost(text) { const c = cur(); if (!text.trim()) return; c.posts.unshift({ id: Date.now(), by: (Cloud.profile && Cloud.profile.displayName) || 'Teacher', text: text.trim(), time: Date.now() }); save(); render(); }
function addAssignment() { ask('New assignment', 'Students see it under Assignments.', 'Assignment title', t => { cur().assignments.unshift({ id: Date.now(), text: t, time: Date.now() }); cur().setupDone = true; tab = 'assignments'; save(); render(); }); }
function focusPost() { tab = 'activity'; render(); const t = $('#postBox'); if (t) t.focus(); }

function listHtml(items, key, empty, opts = {}) {
  if (!items.length) return `<div class="card"><div class="empty">${empty}</div></div>`;
  return `<div class="card">${items.map(i => {
    let extra = '';
    if (i.kind === 'quiz' && i.quizId) {
      extra = `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${gameBtns('data-play-quiz', i.quizId)}
        ${opts.showStats ? `<button class="iconbtn-sm" data-stats-for="${i.id}" title="View stats" style="margin-left:auto;background:#E6EEFB;color:#2F65C8"><i class='bx bxs-bar-chart-alt-2'></i></button>` : ''}
      </div>`;
    }
    return `<div class="post"><div class="meta">${tAv(teacherOf(cur()), i.kind === 'quiz' ? 'bxs-task' : 'bxs-user')}<div><b>${esc(teacherOf(cur()).name)}</b><small>${fmt(i.time)}${i.kind === 'quiz' ? ' · quiz' : ''}</small></div>
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
      body = `<div class="card"><div class="composer">${tAv(teacherOf(cur()))}<textarea id="postBox" placeholder="Post something"></textarea></div>
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
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeAuthPopup(); closeQuestionEditor(); } });

const sidebar = $('#sidebar');
$('#content nav .bx-menu').onclick = () => sidebar.classList.toggle('hide');
function adjust() { sidebar.classList.toggle('hide', window.innerWidth <= 576); }
addEventListener('load', adjust); addEventListener('resize', adjust);
$('#notificationIcon').onclick = e => { e.preventDefault(); $('#notificationMenu').classList.toggle('show'); $('#profileMenu').classList.remove('show'); };
$('#profileIcon').onclick = e => { e.preventDefault(); $('#profileMenu').classList.toggle('show'); $('#notificationMenu').classList.remove('show'); };
addEventListener('click', e => { if (!e.target.closest('.notification') && !e.target.closest('.profile')) document.querySelectorAll('.dd').forEach(d => d.classList.remove('show')); });

/* ===================== Account / profile ===================== */
// Who posted: the teacher's own profile on their device; the teacher info saved in the class for students.
function teacherOf(c) {
  if (c && !c.remote && Cloud.profile && Cloud.profile.role === 'teacher') return { name: Cloud.profile.displayName || 'Teacher', photo: Cloud.profile.photo || '' };
  return (c && c.teacher) || { name: 'Teacher', photo: '' };
}
const tAv = (t, icon, bg) => t.photo ? `<div class="avatar"><img src="${t.photo}" alt=""></div>` : `<div class="avatar"${bg ? ` style="background:${bg}"` : ''}><i class='bx ${icon || 'bxs-user'}'></i></div>`;
function paintAvatar() {
  const p = Cloud.profile || {};
  $('#profileIcon img').src = p.photo || ('data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72"><rect width="72" height="72" fill="#2F65C8"/><text x="36" y="49" font-size="34" font-family="Arial" font-weight="700" text-anchor="middle" fill="#fff">' + esc(((p.displayName || '?').trim().charAt(0) || '?').toUpperCase()) + '</text></svg>'));
}
function openProfile() {
  const p = Cloud.profile || {}; let photo = p.photo || '';
  openModal(`<h3>My profile</h3><p class="sub">${esc((Cloud.user && Cloud.user.email) || '')} · ${p.role === 'student' ? 'Student' : 'Teacher'}</p>
  <div class="pf-row"><img id="pfImg" alt=""><div><button class="btn ghost" id="pfPick">Change photo</button> <button class="btn ghost" id="pfClear">Remove</button><input type="file" id="pfFile" accept="image/*" hidden></div></div>
  <label class="pf-l">Display name</label><input type="text" id="pfName" maxlength="30" value="${esc(p.displayName || '')}">
  <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="pfSave">Save</button></div>`);
  const show = () => { $('#pfImg').src = photo || $('#profileIcon img').src; };
  show();
  $('#pfPick').onclick = () => $('#pfFile').click();
  $('#pfFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { photo = await Gate.resize(f); show(); } catch (er) { toast(er.message); } };
  $('#pfClear').onclick = () => { photo = ''; $('#pfImg').src = ''; $('#pfImg').removeAttribute('src'); };
  $('#modal [data-x]').onclick = closeModal;
  $('#pfSave').onclick = async () => {
    const name = $('#pfName').value.trim(); if (!name) return toast('Enter a display name');
    try {
      await Cloud.saveProfile({ displayName: name, photo });
      studentIdentity.name = name; saveStudentIdentity(); paintAvatar(); cloudPublishSoon(); if (uiMode === 'teacher') render(); closeModal(); toast('Profile saved');
    } catch (er) { toast('Could not save: ' + (er.code || er.message)); }
  };
}
$('#pmProfile').onclick = openProfile;
$('#pmOut').onclick = () => Cloud.signOut();
$('#appLogout').onclick = e => { e.preventDefault(); Cloud.signOut(); };

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
  if (c.remote && !name) name = 'Student ' + (100 + Math.floor(Math.random() * 900));
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
  const submit = async () => {
    const code = input.value.trim().toUpperCase();
    if (!code) return;
    let c = classes.find(x => x.code === code), joinFail = '';
    if (!c) {
      btn.disabled = true; btn.textContent = 'Joining…';
      try { c = await importRemoteClass(code); } catch (e) { console.warn('Join lookup failed', e); joinFail = e.code || e.message || 'unknown error'; }
      btn.disabled = false; btn.textContent = 'Join class';
    }
    if (!c) { if (err) { err.textContent = joinFail ? 'Could not reach the class (' + joinFail + ').' : 'No class found with that code. Check with your teacher.'; err.style.display = 'block'; } return; }
    if (err) err.style.display = 'none';
    studentSession = { classId: c.id, joinedAt: Date.now(), studentId: studentIdentity.id };
    saveStudentSession();
    registerStudentInClass(c);
    const me = c.students.find(s => s.id === studentIdentity.id);
    Cloud.joinClass(c.code, { sid: studentIdentity.id, name: studentIdentity.name, joinedAt: me ? me.joinedAt : Date.now() }).catch(() => {});
    cloudWatchStudent();
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
      ${recentPosts.map(p => `<div class="shline"><div class="shl-icon">${teacherOf(c).photo ? `<img src="${teacherOf(c).photo}" alt="" style="width:100%;height:100%;border-radius:8px;object-fit:cover">` : "<i class='bx bxs-user'></i>"}</div><div class="shl-info"><b>${esc(p.text.length > 80 ? p.text.slice(0, 80) + '…' : p.text)}</b><small>${fmt(p.time)}</small></div></div>`).join('')}
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
  body.innerHTML = `<div class="card">${c.posts.map(p => `<div class="student-post"><div class="meta">${tAv(teacherOf(c))}<div><b>${esc(teacherOf(c).name)}</b><small>${fmt(p.time)}</small></div></div><p>${esc(p.text)}</p></div>`).join('')}</div>`;
}

function renderStudentAssignments(c) {
  const body = document.getElementById('studentTabBody');
  if (!c.assignments.length) { body.innerHTML = `<div class="card"><div class="student-empty">No assignments yet. Check back soon!</div></div>`; return; }
  body.innerHTML = `<div class="card">${c.assignments.map(a => `<div class="student-post">
    <div class="meta">${tAv(teacherOf(c), 'bxs-task', '#2F65C8')}<div><b>${esc(teacherOf(c).name)}</b><small>Assignment · ${fmt(a.time)}${a.kind === 'quiz' ? ' · quiz' : ''}</small></div></div>
    <p>${esc(a.text)}</p>
    ${a.kind === 'quiz' && a.quizId ? `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
      ${gameBtns('data-student-play', a.quizId)}
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
      ${gameBtns('data-student-play', qs.id)}
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
  const gameNames = Object.fromEntries(GAMES.map(g => [g.id, g.name]));
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
function saveQSets() { try { localStorage.setItem(QKEY, JSON.stringify(qsets.filter(q => !q._remote))); } catch (e) {} saveRemote(); cloudPublishSoon(); }
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
        ${gameBtns('data-play', qs.id)}
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

/* ===================== Kahoot-style question editor ===================== */
const OPT_SHAPES = ['shape-a', 'shape-b', 'shape-c', 'shape-d'];
const OPT_LETTERS = ['A', 'B', 'C', 'D'];
const OPT_ICONS = ['bxs-square', 'bxs-circle', 'bxs-triangle', 'bxs-diamond'];
let qeState = null;   // { qs, mode: 'edit'|'preview' }

function ensureQEShell() {
  let scrim = document.getElementById('qeScrim');
  if (scrim) return scrim;
  scrim = document.createElement('div');
  scrim.id = 'qeScrim';
  scrim.className = 'qe-scrim';
  scrim.innerHTML = `<div class="qe-shell">
    <div class="qe-head">
      <div class="qe-titlewrap">
        <div class="qe-ic"><i class='bx bx-list-check'></i></div>
        <input type="text" id="qeTitle" maxlength="80" placeholder="Set title">
      </div>
      <button class="qe-close" id="qeClose" title="Close"><i class='bx bx-x'></i></button>
    </div>
    <div class="qe-meta">
      <div class="qe-tabswitch">
        <button id="qeTabEdit" class="on"><i class='bx bx-edit'></i> Edit</button>
        <button id="qeTabPreview"><i class='bx bxs-show'></i> Preview</button>
      </div>
      <span id="qeCount">0 questions</span>
      <span id="qeGradeInfo" style="margin-left:auto"></span>
    </div>
    <div class="qe-body" id="qeBodyEdit"></div>
    <div class="qe-body" id="qeBodyPreview" hidden></div>
    <div class="qe-foot">
      <div class="qe-footleft"><span id="qeDirtyHint"></span></div>
      <div class="qe-footright">
        <button class="btn ghost" id="qeCancelBtn">Cancel</button>
        <button class="btn" id="qeSaveBtn"><i class='bx bx-check'></i> Save</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(scrim);
  scrim.addEventListener('click', e => { if (e.target.id === 'qeScrim') closeQuestionEditor(); });
  document.getElementById('qeClose').onclick = closeQuestionEditor;
  document.getElementById('qeCancelBtn').onclick = closeQuestionEditor;
  document.getElementById('qeSaveBtn').onclick = saveQuestionEditor;
  document.getElementById('qeTabEdit').onclick = () => setQEMode('edit');
  document.getElementById('qeTabPreview').onclick = () => setQEMode('preview');
  document.getElementById('qeTitle').addEventListener('input', e => { if (qeState) { qeState.qs.title = e.target.value; markQEDirty(); } });
  return scrim;
}

function markQEDirty() {
  const el = document.getElementById('qeDirtyHint'); if (!el) return;
  el.textContent = 'Unsaved changes';
}
function clearQEDirty() {
  const el = document.getElementById('qeDirtyHint'); if (!el) return;
  el.textContent = '';
}

function editQuiz(qsId) {
  const qs = qsets.find(x => x.id === qsId); if (!qs) return;
  // Deep clone so edits don't commit until Save
  qeState = { qs: JSON.parse(JSON.stringify(qs)), originalId: qs.id, mode: 'edit' };
  ensureQEShell();
  document.getElementById('qeTitle').value = qeState.qs.title || '';
  const gi = document.getElementById('qeGradeInfo');
  gi.textContent = [qeState.qs.grade, qeState.qs.difficulty].filter(Boolean).join(' · ');
  clearQEDirty();
  setQEMode('edit');
  document.getElementById('qeScrim').classList.add('show');
  document.body.style.overflow = 'hidden';
}

function setQEMode(mode) {
  if (!qeState) return;
  qeState.mode = mode;
  document.getElementById('qeTabEdit').classList.toggle('on', mode === 'edit');
  document.getElementById('qeTabPreview').classList.toggle('on', mode === 'preview');
  document.getElementById('qeBodyEdit').hidden = mode !== 'edit';
  document.getElementById('qeBodyPreview').hidden = mode !== 'preview';
  if (mode === 'edit') renderQEEdit(); else renderQEPreview();
}

function updateQECount() {
  const el = document.getElementById('qeCount'); if (!el || !qeState) return;
  const n = qeState.qs.questions.length;
  el.textContent = n + ' question' + (n === 1 ? '' : 's');
}

function renderQEEdit() {
  if (!qeState) return;
  const body = document.getElementById('qeBodyEdit');
  const qs = qeState.qs;
  updateQECount();
  if (!qs.questions.length) {
    body.innerHTML = `<div class="qe-list"><button class="qe-addq" id="qeAddFirst"><i class='bx bx-plus'></i> Add the first question</button></div>`;
    document.getElementById('qeAddFirst').onclick = () => { qs.questions.push(blankQuestion()); renderQEEdit(); markQEDirty(); };
    return;
  }
  body.innerHTML = `<div class="qe-list">${qs.questions.map((q, qi) => qeQCardHtml(q, qi)).join('')}</div>
    <button class="qe-addq" id="qeAddQ"><i class='bx bx-plus'></i> Add question</button>`;
  wireQEEditCards();
  document.getElementById('qeAddQ').onclick = () => { qs.questions.push(blankQuestion()); renderQEEdit(); markQEDirty(); };
}

function blankQuestion() {
  return { question: '', options: ['', '', '', ''], correct: 0, timeLimit: 20, explanation: '' };
}

function qeQCardHtml(q, qi) {
  return `<div class="qe-qcard" data-q="${qi}">
    <div class="qe-qhd">
      <div class="qe-qnum">${qi + 1}</div>
      <div class="qe-qtext">${esc(q.question || '(empty question)')}</div>
      <div class="qe-qtools">
        <button class="up" data-up="${qi}" title="Move up"><i class='bx bx-chevron-up'></i></button>
        <button class="down" data-down="${qi}" title="Move down"><i class='bx bx-chevron-down'></i></button>
        <button class="del" data-delq="${qi}" title="Delete question"><i class='bx bx-trash'></i></button>
      </div>
    </div>
    <textarea class="qe-qinput" data-field="question" rows="2" placeholder="Type the question...">${esc(q.question)}</textarea>
    <div class="qe-opts">
      ${q.options.map((o, oi) => `<div class="qe-opt ${OPT_SHAPES[oi]} ${q.correct === oi ? 'is-correct' : ''}" data-opt="${oi}">
        <div class="qe-mark"><i class='bx ${q.correct === oi ? 'bxs-check-circle' : 'bx-circle'}'></i></div>
        <input type="text" data-optval="${oi}" value="${esc(o)}" placeholder="Option ${OPT_LETTERS[oi]}">
      </div>`).join('')}
    </div>
    <div class="qe-qextra">
      <div><label>Time limit (seconds)</label><input type="text" data-field="timeLimit" value="${q.timeLimit || 20}"></div>
      <div style="flex:2"><label>Explanation (shown after answer)</label><textarea data-field="explanation" rows="2" placeholder="Why is the answer correct?">${esc(q.explanation || '')}</textarea></div>
    </div>
  </div>`;
}

function wireQEEditCards() {
  const body = document.getElementById('qeBodyEdit'); if (!body || !qeState) return;
  const qs = qeState.qs;

  body.querySelectorAll('.qe-qcard').forEach(card => {
    const qi = parseInt(card.dataset.q, 10);
    const q = qs.questions[qi];

    const txt = card.querySelector('[data-field="question"]');
    txt.addEventListener('input', () => { q.question = txt.value; markQEDirty(); card.querySelector('.qe-qtext').textContent = q.question || '(empty question)'; });

    card.querySelectorAll('.qe-opt').forEach(opt => {
      const oi = parseInt(opt.dataset.opt, 10);
      const inp = opt.querySelector('[data-optval]');
      inp.addEventListener('input', () => { q.options[oi] = inp.value; markQEDirty(); });
      opt.addEventListener('click', e => {
        if (e.target === inp) return; // don't toggle when typing in the field
        q.correct = oi; markQEDirty();
        card.querySelectorAll('.qe-opt').forEach(o => {
          const i = parseInt(o.dataset.opt, 10);
          o.classList.toggle('is-correct', i === oi);
          o.querySelector('.qe-mark').innerHTML = `<i class='bx ${i === oi ? 'bxs-check-circle' : 'bx-circle'}'></i>`;
        });
      });
    });

    const tl = card.querySelector('[data-field="timeLimit"]');
    tl.addEventListener('input', () => { const n = parseInt(tl.value, 10); q.timeLimit = Number.isFinite(n) ? n : 20; markQEDirty(); });
    const ex = card.querySelector('[data-field="explanation"]');
    ex.addEventListener('input', () => { q.explanation = ex.value; markQEDirty(); });
  });

  body.querySelectorAll('[data-up]').forEach(b => b.onclick = () => {
    const qi = parseInt(b.dataset.up, 10); if (qi <= 0) return;
    const arr = qeState.qs.questions;
    [arr[qi - 1], arr[qi]] = [arr[qi], arr[qi - 1]];
    renderQEEdit(); markQEDirty();
  });
  body.querySelectorAll('[data-down]').forEach(b => b.onclick = () => {
    const qi = parseInt(b.dataset.down, 10); if (qi >= qeState.qs.questions.length - 1) return;
    const arr = qeState.qs.questions;
    [arr[qi + 1], arr[qi]] = [arr[qi], arr[qi + 1]];
    renderQEEdit(); markQEDirty();
  });
  body.querySelectorAll('[data-delq]').forEach(b => b.onclick = () => {
    const qi = parseInt(b.dataset.delq, 10);
    if (!confirm('Delete question ' + (qi + 1) + '?')) return;
    qeState.qs.questions.splice(qi, 1);
    renderQEEdit(); markQEDirty();
  });
}

function renderQEPreview() {
  if (!qeState) return;
  const body = document.getElementById('qeBodyPreview');
  const qs = qeState.qs;
  updateQECount();
  if (!qs.questions.length) {
    body.innerHTML = `<div class="qb-empty"><i class='bx bxs-show'></i><h3>Nothing to preview</h3><p style="margin:8px 0 16px">Add a question in the Edit tab first.</p></div>`;
    return;
  }
  body.innerHTML = `<div class="qe-preview">${qs.questions.map((q, qi) => qePreviewCardHtml(q, qi)).join('')}</div>`;
}

function qePreviewCardHtml(q, qi) {
  const ansClasses = ['a', 'b', 'c', 'd'];
  const letters = ['A', 'B', 'C', 'D'];
  const hasExpl = q.explanation && q.explanation.trim();
  return `<div class="qe-pvcard">
    <div class="qe-pvtop">
      <div class="qe-pvqnum">Question ${qi + 1} of ${qeState.qs.questions.length}</div>
      <div class="qe-pvqtext">${esc(q.question || '(empty question)')}</div>
    </div>
    <div class="qe-pvanswers">
      ${q.options.map((o, oi) => `<div class="qe-pvans ${ansClasses[oi]} ${q.correct === oi ? 'correct' : ''}">
        <span class="qe-pvshape"><i class='bx ${OPT_ICONS[oi]}'></i></span>
        <span>${esc(o || '(empty)')}</span>
      </div>`).join('')}
    </div>
    <div class="qe-pvbar">
      <span class="qe-pvtimer"><i class='bx bx-stopwatch'></i> ${q.timeLimit || 20}s</span>
      <span class="qe-pvcorrect-tag"><i class='bx bxs-check-circle'></i> Correct: ${esc(q.options[q.correct] || '(empty)')}</span>
    </div>
    ${hasExpl ? `<div class="qe-pvexplain"><b>Explanation:</b> ${esc(q.explanation)}</div>` : ''}
  </div>`;
}

function saveQuestionEditor() {
  if (!qeState) return;
  const qs = qeState.qs;
  if (!qs.title || !qs.title.trim()) return toast('Give the set a title');
  // Validate questions
  for (let i = 0; i < qs.questions.length; i++) {
    const q = qs.questions[i];
    if (!q.question || !q.question.trim()) return toast('Question ' + (i + 1) + ' is empty');
    if (q.options.some(o => !o || !o.trim())) return toast('Question ' + (i + 1) + ' has an empty option');
  }
  // Commit to the real qsets array
  const real = qsets.find(x => x.id === qeState.originalId);
  if (real) {
    real.title = qs.title.trim();
    real.questions = qs.questions;
    real.grade = qs.grade; real.difficulty = qs.difficulty;
  } else {
    qs.id = qeState.originalId || ('qs_' + Date.now().toString(36));
    qsets.unshift(qs);
  }
  saveQSets();
  closeQuestionEditor();
  renderQuestionSets();
  toast('Saved "' + qs.title + '"');
}

function closeQuestionEditor() {
  const scrim = document.getElementById('qeScrim'); if (!scrim) return;
  scrim.classList.remove('show');
  document.body.style.overflow = '';
  qeState = null;
}

/* ===================== Game launcher ===================== */
/* ---- THE GAMES LIST: to add a game, copy games/_template.html and add ONE line here ---- */
const GAMES = [
  { id: 'battleship', name: 'Battleship',     icon: 'bxs-ship',   color: '#2F65C8', file: 'games/battleship.html' },
  { id: 'bubble',     name: 'Bubble Shooter', icon: 'bxs-circle', color: '#7c3aed', file: 'games/bubble.html' },
  { id: 'asteroids',  name: 'Asteroids',      icon: 'bxs-planet', color: '#0d9488', file: 'games/asteroids.html' },
  { id: 'tetris',     name: 'Tetris',         icon: 'bxs-extension', color: '#e11d48', file: 'games/tetris.html' },
  { id: 'blockblast', name: 'Block Blast',    icon: 'bxs-cube',   color: '#ea580c', file: 'games/blockblast.html' },
  { id: 'match3',     name: 'Match 3',        icon: 'bxs-diamond', color: '#db2777', file: 'games/match3.html' },
];
const GAME_DESC = { battleship: 'Sink the enemy fleet', bubble: 'Match and pop bubbles', asteroids: 'Blast the space rocks', tetris: 'Stack blocks, clear lines', blockblast: 'Pop same-color groups', match3: 'Swap tiles to match 3' };
const gameBtns = (attr, id) => `<button class="playbtn browse" data-browse="${id}"><i class='bx bxs-joystick'></i> Browse games</button>`;
function openGamePicker(quizId) {
  openModal(`<h3>Pick a game</h3><p class="sub">Every game uses the same questions.</p>
    <div class="gpick">${GAMES.map(g => `<button class="gcard" data-g="${g.id}"><span class="gic" style="background:${g.color}"><i class='bx ${g.icon}'></i></span><b>${g.name}</b><small>${GAME_DESC[g.id] || ''}</small></button>`).join('')}</div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal').querySelectorAll('[data-g]').forEach(b => b.onclick = () => { closeModal(); openGame(b.dataset.g, qsets.find(x => x.id === quizId) || null); });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-browse]'); if (b) openGamePicker(b.dataset.browse); });

function openGame(type, qs) {
  const frame = $('#battleFrame');
  const qs_ = (qs && Array.isArray(qs.questions) && qs.questions.length) ? qs : { id: 'preset', title: 'Preset Quiz', questions: PRESET_QUESTIONS };
  frame.onload = () => {
    // hand the questions to the game once its page has loaded
    frame.contentWindow.postMessage({ type: 'loadQuiz', questions: qs_.questions, quizId: qs_.id }, '*');
  };
  frame.src = (GAMES.find(g => g.id === type) || GAMES[0]).file;
  $('#battleWrap').classList.add('show');
  document.body.style.overflow = 'hidden';
}
$('#battleClose').onclick = () => { $('#battleWrap').classList.remove('show'); $('#battleFrame').onload = null; $('#battleFrame').src = 'about:blank'; document.body.style.overflow = ''; };


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

/* ===================== Cloud sync (Firebase, via data.js) ===================== */
function saveRemote() {
  try { localStorage.setItem(RKEY, JSON.stringify({ classes: classes.filter(c => c.remote), qsets: qsets.filter(q => q._remote) })); } catch (e) {}
}
function loadRemote() {
  try {
    const r = JSON.parse(localStorage.getItem(RKEY) || 'null'); if (!r) return;
    (r.classes || []).forEach(rc => { if (!classes.find(c => c.id === rc.id)) classes.push(rc); });
    (r.qsets || []).forEach(q => { if (!qsets.find(x => x.id === q.id)) qsets.push(q); });
  } catch (e) {}
}
// Teacher: question sets students may see for a class (assigned to it, or open for practice)
const qsetsFor = c => qsets.filter(q => !q._remote && (q.practiceAllowed !== false || (q.assignedTo || []).includes(c.id)));
function cloudPublishSoon() { clearTimeout(publishTimer); publishTimer = setTimeout(cloudPublishAll, 1500); }
async function cloudPublishAll() {
  if (!(await Cloud.ready)) return;
  classes.filter(c => !c.remote).forEach(c => Cloud.publishClass(c, qsetsFor(c)).catch(e => console.warn('Publish failed', e)));
  if (uiMode === 'teacher') Cloud.saveQsets(qsets.filter(q => !q._remote)).catch(e => console.warn('Question backup failed', e));
  cloudWatchTeacher();
}
function cloudRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (uiMode === 'teacher') render(); }, 600); }
function cloudWatchTeacher() {            // pull students + scores from students' devices into the teacher's screens
  classes.filter(c => !c.remote).forEach(c => {
    if (cloudWatched.has(c.id)) return; cloudWatched.add(c.id);
    Cloud.watchStudents(c.code, list => {
      c.students = c.students || []; let changed = false;
      list.forEach(st => {
        const ex = c.students.find(x => x.id === st.sid);
        if (!ex) { c.students.push({ id: st.sid, name: st.name, joinedAt: st.joinedAt, lastSeen: st.lastSeen }); changed = true; }
        else if (ex.name !== st.name || ex.lastSeen !== st.lastSeen) { ex.name = st.name; ex.lastSeen = st.lastSeen; changed = true; }
      });
      if (changed) { save(); cloudRefresh(); }
    });
    Cloud.watchScores(c.code, list => { cloudScores[c.id] = list; cloudRefresh(); });
  });
}
// Student: load a class (and its question sets) that lives in the cloud
async function importRemoteClass(code) { const d = await Cloud.fetchClass(code); return d ? applyRemoteClass(d) : null; }
function applyRemoteClass(d) {
  let c = classes.find(x => x.id === d.id);
  if (c && !c.remote) return c;           // this device is the teacher's own — keep its copy
  if (!c) { c = { students: [], opened: Date.now() }; classes.push(c); }
  Object.assign(c, { id: d.id, name: d.name, code: d.code, created: d.created, settings: d.settings || {}, posts: d.posts || [], shared: d.shared || [], assignments: d.assignments || [], teacher: d.teacher || null, remote: true });
  const ids = new Set((d.qsets || []).map(q => q.id));
  qsets = qsets.filter(q => q._remote !== d.code || ids.has(q.id));
  (d.qsets || []).forEach(q => { const i = qsets.findIndex(x => x.id === q.id); const nq = { ...q, _remote: d.code }; if (i < 0) qsets.push(nq); else if (qsets[i]._remote) qsets[i] = nq; });
  saveRemote(); return c;
}
// Small status badge (bottom-left) so problems are visible, e.g. on an iPad with no console
(function () {
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:600 11px Poppins,sans-serif;padding:4px 10px;border-radius:20px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);max-width:70vw';
  const paint = () => {
    const m = { ok: ['#1a8a3c', '☁️ Cloud connected'], connecting: ['#b8860b', '☁️ Connecting…'], error: ['#DB504A', '☁️ Cloud error: ' + Cloud.lastError], offline: ['#777', '☁️ Cloud offline'] }[Cloud.status] || ['#777', '☁️ ?'];
    b.style.color = m[0]; b.textContent = m[1];
  };
  window.addEventListener('cloudstatus', paint); paint();
  document.body.appendChild(b);
})();
function cloudWatchStudent() {            // keep a student's posts / assignments / question sets live
  if (!studentSession) return;
  const c = classes.find(x => x.id === studentSession.classId);
  if (!c || !c.remote || studentWatchCode === c.code) return;
  studentWatchCode = c.code;
  Cloud.watchClass(c.code, d => { if (!d) return; applyRemoteClass(d); if (uiMode === 'student' && studentSession) renderStudentClass(); });
}

loadRemote();
document.querySelectorAll('#modeToggle button').forEach(b => b.classList.toggle('on', b.dataset.mode === uiMode));
render();
route();
renderAIErrors();
updateAuthBadge();
updateLogoutVisibility();
updateStudentSidebarExtras();
paintAvatar();
bootSession();
cloudPublishSoon();
cloudWatchStudent();

/* QuizSpill app.js — teacher UI, student UI, AI quiz maker, game launcher.
   Games live in /games/ — see the GAMES list below (and games/_template.html) to add one. */

// Something broke: show a friendly note (details go to the browser console for debugging).
window.addEventListener('error', function (e) {
  console.error('[QuizSpill]', e.message, e.filename ? e.filename + ':' + e.lineno : '', e.error || '');
  if (!e.filename || /ResizeObserver|^Script error/.test(e.message || '')) return;   // harmless / outside scripts
  if (document.getElementById('__errbar')) return;
  var el = document.createElement('div'); el.id = '__errbar';
  el.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:999999;background:#fff;color:#342E37;border-left:4px solid #DB504A;box-shadow:0 6px 24px rgba(0,0,0,.18);border-radius:10px;padding:10px 12px 10px 14px;font:14px Poppins,sans-serif;display:flex;gap:10px;align-items:center;max-width:92vw';
  el.innerHTML = '<span>Something went wrong. If things stop working, reload the page.</span><button style="border:none;background:#2F65C8;color:#fff;border-radius:6px;padding:6px 12px;font:inherit;font-weight:600;cursor:pointer">Reload</button><button aria-label="Close" style="border:none;background:none;font-size:20px;cursor:pointer;color:#999">&times;</button>';
  el.children[1].onclick = function () { location.reload(); };
  el.children[2].onclick = function () { el.remove(); };
  document.body.appendChild(el);
});

let nav = 'classes';
let devOpen = false;                       // developer page showing (developer account only)
const VIEWS = ['classes', 'ai', 'questions', 'analytics'];

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
// Every class a student has joined gets its own tab; studentSession is the tab that's open.
const JKEY = 'adminhub_student_classes_v1';
let joinedIds = [], studentJoinOpen = false;          // studentJoinOpen = the "+ Join class" tab is showing
try { joinedIds = JSON.parse(localStorage.getItem(JKEY) || '[]'); } catch (e) {}
if (studentSession && !joinedIds.includes(studentSession.classId)) joinedIds.push(studentSession.classId);   // saved before tabs existed
function saveJoined() { try { localStorage.setItem(JKEY, JSON.stringify(joinedIds)); } catch (e) {} }
function openStudentClass(id) { studentSession = { classId: id, joinedAt: Clock.now(), studentId: studentIdentity.id }; saveStudentSession(); studentJoinOpen = false; studentTab = 'home'; }

/* ===================== Storage ===================== */
const KEY = 'adminhub_classes_v1';
const RKEY = 'adminhub_remote_v1';      // classes a student loaded from the cloud (kept apart from a teacher's own)
let cloudScores = {};                    // classId -> score docs from Firestore (teacher side)
let publishTimer = null, refreshTimer = null;   // cloud-sync state (declared early: save() can run at startup)
const cloudWatched = new Set();
let railOpen = true, classes = [], activeId = null, tab = 'activity', memStore = null, ownOpen = true;
try { railOpen = localStorage.getItem('adminhub_rail_open') !== '0'; } catch (e) {}
try { ownOpen = localStorage.getItem('adminhub_owned_open') !== '0'; } catch (e) {}
function load() { try { const r = localStorage.getItem(KEY); if (r) return JSON.parse(r); } catch (e) {} return memStore || []; }
function stampTeacher() {               // the teacher's name + photo live on each of their classes
  if (uiMode !== 'teacher' || !Cloud.profile) return;
  const t = { name: Cloud.profile.displayName || 'Teacher', photo: Cloud.profile.photo || '' };
  classes.forEach(c => { if (!c.remote) c.teacher = t; });
}
function save() { stampTeacher(); memStore = classes; try { localStorage.setItem(KEY, JSON.stringify(classes.filter(c => !c.remote))); } catch (e) {} saveRemote(); cloudPublishSoon(); }
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
  (cloudScores[classId] || []).forEach(d => add(d.sid, { game: d.game, quizId: d.quizId, won: d.won, quit: !!d.quit, score: d.score, answers: d.answers || [], time: d.time }));
  Object.values(out).forEach(l => l.sort((x, y) => y.time - x.time));
  return out;
}
function getStudentScores(classId, studentId) { return scoresMap(classId)[studentId] || []; }
function getAllClassScores(classId) { return [].concat(...Object.values(scoresMap(classId))); }
function recordScore(classId, game, quizId, won, score, answers, quit) {
  const now = Clock.now();
  try {
    const all = JSON.parse(localStorage.getItem(SCORE_KEY) || '{}');
    let cm = all[classId];
    if (!cm || Array.isArray(cm)) cm = { __legacy: Array.isArray(cm) ? cm : [] };
    const sid = (studentIdentity && studentIdentity.id) || '__anon';
    if (!cm[sid]) cm[sid] = [];
    cm[sid].unshift({ game, quizId: quizId || 'preset', won: !!won, quit: !!quit, score: Number(score) || 0, answers: Array.isArray(answers) ? answers : [], time: now });
    if (cm[sid].length > 200) cm[sid] = cm[sid].slice(0, 200);
    all[classId] = cm;
    localStorage.setItem(SCORE_KEY, JSON.stringify(all));
  } catch (e) {}
  const cc = classes.find(x => x.id === classId);
  if (cc) Cloud.submitScore(cc.code, { sid: (studentIdentity && studentIdentity.id) || '__anon', name: (studentIdentity && studentIdentity.name) || '', game: game || 'unknown', quizId: quizId || 'preset', won: !!won, quit: !!quit, score: Number(score) || 0, answers: Array.isArray(answers) ? answers : [], time: now }).catch(e => console.warn('Score upload failed', e));
  if (uiMode === 'student' && studentSession && studentSession.classId === classId && studentTab === 'scores') renderStudentClass();
}

function classMastery(c) {
  const all = getAllClassScores(c.id);
  let total = 0, correct = 0;
  all.forEach(s => (s.answers || []).forEach(a => { total++; if (a.correct) correct++; }));
  return { total, correct, pct: total ? Math.round(correct / total * 100) : 0 };
}

// A teacher can rename students (c.renames) or remove them (c.removed: sid -> when); everything uses these.
const studentName = (c, s) => ((c.renames || {})[s.id]) || s.name;
const isRemoved = (c, sid) => !!(c.removed && c.removed[sid]);
// Every game result in a class, newest first: {sid, name, game, quizId, time, correct, total, won, answers}
function classActivity(c) {
  const names = Object.fromEntries((c.students || []).map(s => [s.id, studentName(c, s)])), map = scoresMap(c.id), out = [];
  Object.keys(map).forEach(sid => !isRemoved(c, sid) && map[sid].forEach(s => {
    const ans = s.answers || [];
    out.push({ sid, name: names[sid] || (sid === '__legacy' ? 'Earlier player' : 'Student'), game: s.game, quizId: s.quizId, time: s.time,
      correct: ans.filter(a => a.correct).length, total: ans.length, won: s.won, answers: ans });
  }));
  return out.sort((a, b) => b.time - a.time);
}
const gameName = id => (GAMES.find(g => g.id === id) || { name: id || 'a game' }).name;
const activityLine = a => `<div class="li"><span><b>${esc(a.name)}</b> played ${esc(gameName(a.game))}${a.total ? ` · ${a.correct}/${a.total} correct` : ''}</span><span>${fmt(a.time)}</span></div>`;
// Class leaderboard, best first: [{sid, name, correct, answered}]. The teacher's device works it out from the
// scores and publishes it with the class (only while the setting is on); students read that published copy.
function leaderboardFor(c) {
  if (c.remote) return Array.isArray(c.leaderboard) ? c.leaderboard : [];
  const map = scoresMap(c.id), rows = {};
  (c.students || []).forEach(s => { if (!isRemoved(c, s.id)) rows[s.id] = { sid: s.id, name: studentName(c, s), correct: 0, answered: 0 }; });
  Object.keys(map).forEach(sid => {
    if (sid === '__legacy' || sid === '__anon' || isRemoved(c, sid)) return;
    const r = rows[sid] || (rows[sid] = { sid, name: 'Student', correct: 0, answered: 0 });
    map[sid].forEach(s => (s.answers || []).forEach(a => { r.answered++; if (a.correct) r.correct++; }));
  });
  return Object.values(rows).sort((a, b) => b.correct - a.correct || a.name.localeCompare(b.name));
}

/* ===================== Helpers ===================== */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// The teacher screens only ever open classes this account owns -- never a class it joined as a student
// (those belong to another teacher; they're shown only in student mode).
const cur = () => classes.find(c => c.id === activeId && !c.remote);
/* Motion animations. If the library didn't load, or the device has "reduce motion" on, nothing animates. */
const FX = (() => {
  const M = () => (!window.Motion || matchMedia('(prefers-reduced-motion: reduce)').matches) ? null : window.Motion;
  const EASE = [0.23, 1, 0.32, 1];                     // ease-out: fast start, gentle stop
  const run = (el, kf, opt) => { const m = M(); if (!m || !el) return; try { m.animate(el, kf, opt); } catch (e) {} };
  const listItems = '.tstat, .shcard, .lb-row, .qset, .post, .student-post, .an-grid > *, .roster-row';
  return {
    // pop-ups spring in with a little bounce, the dark backdrop fades with them
    pop(el, backdrop) { run(el, { opacity: [0, 1], y: [10, 0], scale: [0.96, 1] }, { type: 'spring', duration: 0.32, bounce: 0.2 }); run(backdrop, { opacity: [0, 1] }, { duration: 0.2, ease: EASE }); },
    // menus drop down from the top
    drop(el) { run(el, { opacity: [0, 1], y: [-6, 0], scale: [0.98, 1] }, { duration: 0.16, ease: EASE }); },
    // a small thing (like a Done tick) pops
    tick(el) { run(el, { scale: [0.6, 1], opacity: [0, 1] }, { type: 'spring', duration: 0.35, bounce: 0.35 }); },
    // a new tab or page: content slides up a touch, cards appear one after another, numbers count up
    enter(el) {
      const m = M(); if (!m || !el) return;
      run(el, { opacity: [0, 1], y: [6, 0] }, { duration: 0.22, ease: EASE });
      const items = [...el.querySelectorAll(listItems)].slice(0, 12);
      if (items.length) run(items, { opacity: [0, 1], y: [8, 0] }, { duration: 0.25, ease: EASE, delay: m.stagger(0.035) });
      el.querySelectorAll('.tstat b, .shcard b').forEach(b => {
        const hit = /^(\d+)(%?)$/.exec(b.textContent.trim()); if (!hit || +hit[1] < 2) return;
        const end = +hit[1], suffix = hit[2];
        try { m.animate(0, end, { duration: 0.6, ease: EASE, onUpdate: v => { b.textContent = Math.round(v) + suffix; }, onComplete: () => { b.textContent = end + suffix; } }); } catch (e) {}
      });
    }
  };
})();
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
function openModal(html) { const was = $('#scrim').classList.contains('show'); $('#modal').innerHTML = html; $('#scrim').classList.add('show'); if (!was) FX.pop($('#modal'), $('#scrim')); const i = $('#modal input[type=text]'); if (i) i.focus(); }
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
    const c = { id: Clock.now().toString(36), name, code: makeCode(), created: Clock.now(),
      settings: { studentsCanPost: true, wallVisible: true }, opened: Clock.now(),
      posts: [], shared: [], assignments: [], students: [], setupDone: false };
    classes.push(c); activeId = c.id; tab = 'activity'; save(); render();
  });
}
function showCode() {
  const c = cur(); c.codeShared = true; save();
  openModal(`<h3>Join code</h3><p class="sub">Students enter this code to join <b>${esc(c.name)}</b>.</p>
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
  <div class="set"><div>Class leaderboard<small>Students see the whole class ranked by correct answers and can compete</small></div><label class="sw"><input type="checkbox" id="s3" ${s.leaderboard ? 'checked' : ''}><span></span></label></div>
  <div class="set"><div>Students<small>${(c.students || []).length} in this class — rename or remove</small></div><button class="btn ghost" id="sr">Manage</button></div>
  <div class="set"><div>Join code<small>${c.code}</small></div><button class="btn ghost" id="sc">Show</button></div>
  <div class="foot" style="margin-top:20px"><button class="btn danger" id="dc">Delete class</button><button class="btn" id="sv">Done</button></div>`);
  $('#s1').onchange = e => { s.studentsCanPost = e.target.checked; save(); render(); };
  $('#s2').onchange = e => { s.wallVisible = e.target.checked; save(); render(); };
  $('#s3').onchange = e => { s.leaderboard = e.target.checked; save(); render(); toast(s.leaderboard ? 'Leaderboard on for students' : 'Leaderboard hidden'); };
  $('#sc').onclick = showCode;
  $('#sr').onclick = () => { if ((c.students || []).length || (c.blocked || []).length) showRoster(); else toast('No students yet — share the join code'); };
  $('#sv').onclick = closeModal;
  $('#dc').onclick = () => { if (confirm('Delete "' + c.name + '"? This cannot be undone.')) {
    if (!c.remote) Cloud.deleteClass(c.code).catch(() => {});
    classes = classes.filter(x => x.id !== c.id); activeId = classes.length ? classes[0].id : null; save(); closeModal(); render(); } };
}
function addPost(text) { const c = cur(); if (!text.trim()) return; c.posts.unshift({ id: Clock.now(), by: (Cloud.profile && Cloud.profile.displayName) || 'Teacher', text: text.trim(), time: Clock.now() }); save(); render(); }
// Due dates are stored as the end of the chosen day (local time); empty = no due date.
const dueFromInput = v => v ? new Date(v + 'T23:59:59').getTime() : null;
const dueField = () => `<label class="pf-l">Due date <small>(optional)</small></label><input type="date" id="dueIn" class="due-in">`;
function dueLabel(a, done) {                 // "Due Fri, Oct 30" / "Due today" / "Overdue"
  if (!a.due) return '';
  const d = new Date(a.due), today = new Date(Clock.now()); today.setHours(23, 59, 59, 0);
  const days = Math.round((d - today) / 864e5);
  const txt = days === 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : 'Due ' + d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  return `<span class="due ${!done && a.due < Clock.now() ? 'late' : days <= 1 && !done ? 'soon' : ''}">${!done && a.due < Clock.now() ? 'Overdue · ' : ''}${txt}</span>`;
}
// Has this student finished this assignment? Quizzes: a finished game with that quiz since it was assigned.
// Text assignments: the student ticks them off on their own device.
function assignmentDone(c, a, sid) {
  if (a.kind === 'quiz' && a.quizId) return getStudentScores(c.id, sid).some(x => x.quizId === a.quizId && !x.quit && x.time >= a.time);
  if (uiMode !== 'student') return ((c.students || []).find(s => s.id === sid) || {}).done?.includes(a.id) || false;   // teacher: from the roster
  return myDoneList(c).includes(a.id);
}
function myDoneList(c) { try { return JSON.parse(localStorage.getItem('adminhub_done_' + c.id) || '[]'); } catch (e) { return []; } }
function addAssignment() {
  openModal(`<h3>New assignment</h3><p class="sub">Students see it under Assignments.</p>
    <input type="text" id="ask" maxlength="120" placeholder="Assignment title, e.g. Read chapter 4">${dueField()}
    <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" data-ok>Save</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal [data-ok]').onclick = () => {
    const t = $('#ask').value.trim(); if (!t) return;
    closeModal(); cur().assignments.unshift({ id: Clock.now(), text: t, time: Clock.now(), due: dueFromInput($('#dueIn').value) });
    cur().setupDone = true; tab = 'assignments'; save(); render();
  };
}
function focusPost() { tab = 'activity'; render(); const t = $('#postBox'); if (t) t.focus(); }

function listHtml(items, key, empty, opts = {}) {
  if (!items.length) return `<div class="card"><div class="empty">${empty}</div></div>`;
  return `<div class="card">${items.map(i => {
    let extra = '';
    if (i.kind === 'quiz' && i.quizId) {
      extra = `<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${assignPlayBtn(i)}
        ${opts.showStats ? `<button class="iconbtn-sm" data-stats-for="${i.id}" title="View stats" aria-label="View stats" style="margin-left:auto;background:#E6EEFB;color:#2F65C8"><i class='bx bxs-bar-chart-alt-2'></i></button>` : ''}
      </div>`;
    }
    const c = cur(), roster = (c.students || []).filter(s => !isRemoved(c, s.id));
    const progress = key === 'assignments' && roster.length ? ` · <b>${roster.filter(s => assignmentDone(c, i, s.id)).length}/${roster.length} done</b>` : '';
    return `<div class="post"><div class="meta">${tAv(teacherOf(cur()), i.kind === 'quiz' ? 'bx-task' : 'bxs-user')}<div><b>${esc(teacherOf(cur()).name)}</b><small>${fmt(i.time)}${i.kind === 'quiz' ? ' · quiz' : ''}${progress} ${dueLabel(i, false)}</small></div>
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
        return `<div class="li"><span><i class='bx bxs-user' style="margin-right:6px;color:var(--blue)"></i>${esc(studentName(c, s))}</span><span>${m}%</span></div>`;
      }).join('')
    : '<div class="none">No students yet. Share the join code.</div>';

  const acts = classActivity(c), today = acts.filter(a => a.time >= Clock.now() - 864e5);
  let tTot = 0, tCor = 0; today.forEach(a => { tTot += a.total; tCor += a.correct; });
  const todayHtml = `<div class="sec">Last 24 hours</div>
  <div class="today">
    <div class="tstat"><b>${today.length}</b><small>games played</small></div>
    <div class="tstat"><b>${new Set(today.map(a => a.sid)).size}</b><small>students active</small></div>
    <div class="tstat"><b>${tTot ? Math.round(tCor / tTot * 100) + '%' : '—'}</b><small>answers correct</small></div>
    <div class="tstat"><b>${c.assignments.length}</b><small>assignments posted</small></div>
  </div>
  <div class="rep feed"><h4>Latest activity</h4>${acts.length ? acts.slice(0, 5).map(activityLine).join('') : '<div class="none">No games played yet. Activity shows up here as students play.</div>'}</div>`;

  return `${todayHtml}<div class="dmeta"><span>Class report</span><span>Created ${fmt(c.created)}</span></div>
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
      <div class="stat"><span><i class='bx bx-task'></i>Assignments</span><b>${c.assignments.length}</b></div>
    </div>
    <div class="sum promo"><small>Join code</small><div class="pc">${c.code}</div><button data-act="code">Show code</button></div>
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
  const students = c.students || [], blocked = c.blocked || [];
  if (!students.length && !blocked.length) return toast('No students yet');
  const rows = students.map(s => {
    const scores = getStudentScores(c.id, s.id);
    let total = 0, correct = 0;
    scores.forEach(sc => (sc.answers || []).forEach(a => { total++; if (a.correct) correct++; }));
    return { s, name: studentName(c, s), games: scores.length, mastery: total ? Math.round(correct / total * 100) : 0 };
  });
  openModal(`<h3>Students in ${esc(c.name)}</h3><p class="sub">${rows.length} student${rows.length === 1 ? '' : 's'} · rename or remove anyone</p>
    <div style="max-height:52vh;overflow-y:auto;margin-bottom:14px">
      ${rows.map(r => `
        <div class="roster-row">
          <div class="roster-av">${esc((r.name.trim()[0] || '?').toUpperCase())}</div>
          <div style="flex:1;min-width:0">
            <div class="roster-name">${esc(r.name)}${r.name !== r.s.name ? ` <small>(signed up as ${esc(r.s.name)})</small>` : ''}</div>
            <div class="roster-meta">${r.games} game${r.games === 1 ? '' : 's'} · ${r.mastery}% correct${r.s.joinedAt ? " · joined " + fmt(r.s.joinedAt) : ""}</div>
          </div>
          <button class="iconbtn-sm" data-rn="${esc(r.s.id)}" title="Rename" aria-label="Rename"><i class='bx bx-edit'></i></button>
          <button class="iconbtn-sm danger" data-rm="${esc(r.s.id)}" title="Remove from class" aria-label="Remove from class"><i class='bx bx-user-x'></i></button>
        </div>`).join('')}
    </div>
    ${blocked.length ? `<div class="sec">Blocked (${blocked.length})</div><p class="sub" style="margin:0 0 6px">They can’t rejoin with the code or send scores.</p>
      ${blocked.map(uid => `<div class="roster-row"><div class="roster-av"><i class='bx bx-block'></i></div><div style="flex:1;min-width:0"><div class="roster-name">${esc((c.blockedNames || {})[uid] || 'Removed student')}</div></div>
        <button class="btn ghost" data-unblock="${esc(uid)}">Let back in</button></div>`).join('')}` : ''}
    <div class="foot"><button class="btn ghost" data-x>Close</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal').querySelectorAll('[data-unblock]').forEach(b => b.onclick = () => {
    const uid = b.dataset.unblock, name = (c.blockedNames || {})[uid] || 'that student';
    c.blocked = (c.blocked || []).filter(x => x !== uid); if (c.blockedNames) delete c.blockedNames[uid];
    save(); showRoster(); toast(name + ' can join again with the class code');
  });
  $('#modal').querySelectorAll('[data-rn]').forEach(b => b.onclick = () => {
    const s = students.find(x => x.id === b.dataset.rn); if (!s) return;
    ask('Rename student', 'This is the name you, the leaderboard and reports will show.', 'Student name', name => {
      c.renames = c.renames || {}; c.renames[s.id] = name.slice(0, 30); save(); render(); showRoster(); toast('Renamed to ' + name);
    }, studentName(c, s));
  });
  $('#modal').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const s = students.find(x => x.id === b.dataset.rm); if (!s) return;
    if (!confirm('Remove ' + studentName(c, s) + ' from ' + c.name + '? Their results are hidden from your reports and the leaderboard' + (s.uid ? ', and they can’t rejoin with the class code (you can let them back in from this list).' : '.'))) return;
    c.removed = c.removed || {}; c.removed[s.id] = Clock.now();
    if (s.uid) { c.blocked = [...new Set([...(c.blocked || []), s.uid])]; c.blockedNames = { ...(c.blockedNames || {}), [s.uid]: studentName(c, s) }; }
    c.students = c.students.filter(x => x.id !== s.id);
    if (!c.remote) Cloud.removeStudent(c.code, s.id).catch(e => console.warn('Remove failed', e));
    save(); render(); toast('Removed ' + studentName(c, s));
    if ((c.students || []).length || (c.blocked || []).length) showRoster(); else closeModal();
  });
}

/* ===================== Teacher: assignment stats ===================== */
function showAssignmentStats(a) {
  const c = cur(); if (!c || !a || a.kind !== 'quiz' || !a.quizId) return toast('No stats for this assignment');
  const quizId = a.quizId;
  const qset = qsets.find(q => q.id === quizId);
  const questions = qset ? qset.questions : [];
  const students = c.students || [];

  const perStudent = students.map(s => ({ ...s, name: studentName(c, s) })).map(s => {
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
  const notDone = students.filter(s => !isRemoved(c, s.id) && !assignmentDone(c, a, s.id)).map(s => studentName(c, s));

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
    <div style="margin-top:12px;padding:14px;background:${notDone.length ? '#fff6d6' : '#e6f5e9'};border-radius:10px">
      <div style="font-weight:700;font-size:13px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.04em">${notDone.length ? 'Not done yet (' + notDone.length + ')' : 'Everyone is done'}</div>
      <div style="font-size:13px">${notDone.length ? esc(notDone.join(', ')) : 'Every student has finished a game with this quiz.'}${a.due ? ' · ' + dueLabel(a, !notDone.length) : ''}</div>
    </div>
    ${worstQBlock}
    ${worstStudentBlock}
    <div class="foot" style="margin-top:20px"><button class="btn ghost" data-x>Close</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
}

/* ===================== Teacher: main render ===================== */
function render() {
  $('#classes').classList.toggle('railclosed', !railOpen);
  const own = classes.filter(x => !x.remote);
  if (!cur() && own.length) activeId = own.slice().sort((a, b) => (b.opened || 0) - (a.opened || 0))[0].id;   // never land on a joined class
  const btn = c => `<button class="cls ${c.id === activeId ? 'on' : ''}" data-id="${c.id}">${esc(c.name)}</button>`;
  $('#ownedList').innerHTML = own.length ? own.map(btn).join('') : '<div class="hint">No classes yet</div>';
  $('#ownedList').classList.toggle('closed', !ownOpen);
  $('#ownBtn').classList.toggle('closed', !ownOpen);
  $('#ownBtn').setAttribute('aria-expanded', ownOpen);
  $('#ownCount').textContent = '(' + own.length + ')';
  const recent = own.filter(c => c.opened).sort((a, b) => b.opened - a.opened).slice(0, 3);
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
      body += wallHtml(c, 'teacher');
    } else if (tab === 'dashboard') {
      body = `<div class="dash-tools"><button class="btn ghost" id="exportGrades"><i class='bx bx-download'></i> Export grades</button></div>` + dashHtml(c);
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
    const picker = `<div class="classpick"><select id="classPick" aria-label="Switch class">${own.map(x => `<option value="${x.id}" ${x.id === activeId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="__new">+ Create class</option></select></div>`;
    v.innerHTML = `${picker}<div class="ctop"><h1>${esc(c.name)}</h1><div class="tools"><button class="codechip" id="joinBtn" title="Show and copy the join code"><small>Join code</small><b>${esc(c.code)}</b><i class='bx bx-copy'></i></button><i class='bx bx-list-check' id="qsShortcut" title="Question sets" tabindex="0" style="cursor:pointer"></i><i class='bx bx-cog' id="gear" title="Teacher settings" tabindex="0"></i></div></div>
      <div class="row"><div class="tabs">${['activity','dashboard','assignments'].map(t => `<button data-tab="${t}" class="${tab === t ? 'on' : ''}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div><div class="tabbody">${body}</div>`;
  }
  paintNotifs();
  route();
}

function pick(e) { const b = e.target.closest('[data-id]'); if (!b) return; activeId = b.dataset.id; cur().opened = Clock.now(); save(); tab = 'activity'; render(); FX.enter($('#classView')); }
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
  if (e.target.closest('#exportGrades')) return exportGrades(cur());
  const sb = e.target.closest('[data-stats-for]');
  if (sb) { const a = cur().assignments.find(x => String(x.id) === sb.dataset.statsFor); if (a) showAssignmentStats(a); return; }
  const t = e.target.closest('[data-tab]'); if (t) { const changed = tab !== t.dataset.tab; tab = t.dataset.tab; render(); if (changed) FX.enter($('#classView .tabbody')); return; }
  if (e.target.closest('#joinBtn')) return showCode();
  if (e.target.closest('#gear')) return showSettings();
  const pq = e.target.closest('[data-play-quiz]'); if (pq) { const qs = getQuestionSets().find(x => x.id === pq.dataset.playQuiz); openGame(pq.dataset.game || 'battleship', qs || null); return; }
  const dw = e.target.closest('[data-delwall]'); if (dw) return deleteWallPost(cur(), dw.dataset.delwall);
  const d = e.target.closest('[data-del]'); if (d) { const [k, id] = d.dataset.del.split(':'); const c = cur(); c[k] = c[k].filter(x => String(x.id) !== id); save(); return render(); }
  const a = e.target.closest('[data-act]'); if (!a) return;
  ({ post: focusPost, share: showCode, assign: addAssignment, code: showCode })[a.dataset.act]();
});
$('#classView').addEventListener('change', e => {
  if (e.target.id !== 'classPick') return;
  if (e.target.value === '__new') { e.target.value = activeId; return createClass(); }
  activeId = e.target.value; cur().opened = Clock.now(); save(); tab = 'activity'; render();
});
$('#classView').addEventListener('keydown', e => { if (e.target.id === 'postBox' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addPost(e.target.value); } });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (tour && !document.querySelector('.scrim.show')) return endTour(); closeModal(); closeAuthPopup(); closeQuestionEditor(); } });

const sidebar = $('#sidebar');
$('#menuBtn').onclick = () => sidebar.classList.toggle('hide');
function adjust() { sidebar.classList.toggle('hide', window.innerWidth <= 576); }
addEventListener('load', adjust); addEventListener('resize', adjust);
const NKEY = 'adminhub_notif_seen_v1';
function teacherActivity() { return [].concat(...classes.filter(c => !c.remote).map(c => classActivity(c).map(a => ({ ...a, cls: c.name })))).sort((a, b) => b.time - a.time); }
function paintNotifs() {              // the bell lists students' latest games (teachers only)
  const bell = $('#notificationIcon'); if (!bell) return;
  bell.style.display = uiMode === 'teacher' ? '' : 'none';
  if (uiMode !== 'teacher') return;
  let seen = 0; try { seen = +localStorage.getItem(NKEY) || 0; } catch (e) {}
  const items = teacherActivity(), fresh = items.filter(a => a.time > seen).length, num = $('#notifNum');
  num.hidden = !fresh; num.textContent = fresh > 9 ? '9+' : fresh;
  $('#notifList').innerHTML = items.length
    ? items.slice(0, 8).map(a => `<li><b>${esc(a.name)}</b> played ${esc(gameName(a.game))} in ${esc(a.cls)}${a.total ? ` — ${a.correct}/${a.total} correct` : ''}<small>${fmt(a.time)}</small></li>`).join('')
    : '<li class="none">No student activity yet. When students play, it shows up here.</li>';
}
$('#notificationIcon').onclick = e => {
  e.preventDefault(); paintNotifs();
  $('#notificationMenu').classList.toggle('show'); $('#profileMenu').classList.remove('show');
  if ($('#notificationMenu').classList.contains('show')) FX.drop($('#notificationMenu'));
  try { localStorage.setItem(NKEY, Clock.now()); } catch (er) {}
  $('#notifNum').hidden = true;
};
$('#profileIcon').onclick = e => { e.preventDefault(); $('#profileMenu').classList.toggle('show'); $('#notificationMenu').classList.remove('show'); if ($('#profileMenu').classList.contains('show')) FX.drop($('#profileMenu')); };
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
// Install as an app: Chrome/Edge/Android give us a prompt; iPhone needs Share > Add to Home Screen.
let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
addEventListener('appinstalled', () => { installPrompt = null; toast('QuizSpill is installed'); });
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installApp() {
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // School devices often block installed web apps (they open to a white screen) but allow a home-screen shortcut
  // that opens QuizSpill in a normal browser tab, so each set of steps ends with the school-device way.
  openModal(`<h3>Install QuizSpill</h3><p class="sub">Add it to your home screen so it opens like an app.</p>
    ${installPrompt ? `<button type="button" class="btn" id="instNow" style="width:100%;margin-bottom:12px"><i class='bx bx-download'></i> Install now</button>` : ''}
    <ol class="inst">${ios
      ? `<li>Tap the <b>Share</b> button <i class='bx bx-share' aria-hidden="true"></i> in Safari.</li><li>Scroll down and tap <b>Add to Home Screen</b>.</li><li>Tap <b>Add</b>.</li>`
      : `<li>Open your browser's menu (<b>⋮</b> or <b>…</b>).</li><li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li><li>Confirm, then open QuizSpill from your home screen.</li>`}</ol>
    <p class="sub" style="margin-top:12px"><b>On a school ${ios ? 'iPad' : 'Chromebook'}?</b> If the app opens to a white screen, your school blocks installed apps. Remove it and use a shortcut instead: ${ios
      ? `do the same steps, but turn <b>off</b> the <b>Open as Web App</b> switch before tapping <b>Add</b>. It will open in Safari.`
      : `in Chrome's menu <b>⋮</b> choose <b>Cast, save, and share</b> &gt; <b>Create shortcut</b>, and leave <b>Open as window</b> unchecked. It will open in a normal tab.`}</p>
    <div class="foot"><button class="btn" data-x>Got it</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  if ($('#instNow')) $('#instNow').onclick = () => { const p = installPrompt; installPrompt = null; closeModal(); if (p) p.prompt(); };
}
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker', e));

/* ===================== Exports: grades spreadsheet, questions for Kahoot / Blooket ===================== */
function downloadFile(name, data, type) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileSafe = s => String(s || 'export').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'export';
// Spreadsheet cell: quote it, and stop a cell starting with = + - @ from running as a formula in Excel/Sheets.
const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
const toCSV = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');   // ﻿: Excel reads it as UTF-8

// One row per student: overall numbers, then each quiz assignment (best % since it was assigned, or "Not done").
function exportGrades(c) {
  if (!c) return;
  const students = (c.students || []).filter(s => !isRemoved(c, s.id));
  if (!students.length) return toast('No students yet — nothing to export');
  const quizzes = c.assignments.filter(a => a.kind === 'quiz' && a.quizId).slice().reverse();   // oldest first
  const head = ['Student', 'Games played', 'Questions answered', 'Correct', '% correct', 'Last played']
    .concat(quizzes.map(a => (a.text || 'Quiz').replace(/^Quiz: /, '') + (a.due ? ' (due ' + new Date(a.due).toLocaleDateString() + ')' : '')));
  const rows = students.map(s => {
    const sc = getStudentScores(c.id, s.id); let tot = 0, cor = 0;
    sc.forEach(g => (g.answers || []).forEach(a => { tot++; if (a.correct) cor++; }));
    const last = sc.reduce((m, g) => Math.max(m, g.time || 0), 0);
    return [studentName(c, s), sc.length, tot, cor, tot ? Math.round(cor / tot * 100) + '%' : '', last ? new Date(last).toLocaleString() : '']
      .concat(quizzes.map(a => {
        const tries = sc.filter(g => g.quizId === a.quizId && !g.quit && g.time >= a.time && (g.answers || []).length);
        if (!tries.length) return 'Not done';
        return Math.max(...tries.map(g => Math.round(g.answers.filter(x => x.correct).length / g.answers.length * 100))) + '%';
      }));
  });
  downloadFile(fileSafe(c.name) + '-grades-' + new Date(Clock.now()).toISOString().slice(0, 10) + '.csv', toCSV([head].concat(rows)), 'text/csv;charset=utf-8');
  toast('Downloaded grades for ' + students.length + ' student' + (students.length === 1 ? '' : 's'));
}

// Kahoot's importer wants an .xlsx file. This builds a small one right here (no extra library):
// an .xlsx is a zip of a few XML files, stored without compression.
const CRC_TABLE = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = bytes => { let c = 0xFFFFFFFF; for (const b of bytes) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files) {                     // files: [{name, text}] -> Uint8Array
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  files.forEach(f => {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data);
    const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array([...u32(0x04034b50), ...common, ...name]);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name]));
    parts.push(local, data); offset += local.length + data.length;
  });
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const out = new Uint8Array(offset + cdSize + end.length); let p = 0;
  [...parts, ...central, end].forEach(x => { out.set(x, p); p += x.length; });
  return out;
}
function makeXlsx(rows) {                      // rows: array of arrays (strings / numbers) -> Blob
  const x = v => String(v).replace(/[^\x09\x0A\x0D\x20-퟿-�\u{10000}-\u{10FFFF}]/gu, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = i => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : '') + String.fromCharCode(65 + (i % 26));
  const sheet = rows.map((r, ri) => `<row r="${ri + 1}">` + r.map((v, ci) => {
    if (v === '' || v == null) return '';
    const ref = col(ci) + (ri + 1);
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  }).join('') + '</row>').join('');
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return new Blob([zipStore([
    { name: '[Content_Types].xml', text: xml + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>' },
    { name: '_rels/.rels', text: xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: xml + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', text: xml + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/worksheets/sheet1.xml', text: xml + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>` }
  ])], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const KAHOOT_TIMES = [5, 10, 20, 30, 60, 90, 120, 240];
const nearest = (list, t) => list.reduce((b, x) => Math.abs(x - t) < Math.abs(b - t) ? x : b, list[0]);
function exportQuestions(id) {
  const qs = qsets.find(x => x.id === id); if (!qs) return;
  openModal(`<h3>Export "${esc(qs.title)}"</h3><p class="sub">Download the questions, then upload the file in Kahoot or Blooket.</p>
    <div class="exp-pick">
      <button class="gcard" data-exp="kahoot"><b>Kahoot</b><small>.xlsx file — in Kahoot: create a kahoot → <i>Add question</i> → <i>Import spreadsheet</i></small></button>
      <button class="gcard" data-exp="blooket"><b>Blooket</b><small>.csv file — in Blooket: create a set → <i>CSV Import</i> / <i>Spreadsheet Import</i></small></button>
    </div>
    <div class="foot"><button class="btn ghost" data-x>Close</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal [data-exp="blooket"]').onclick = () => { exportBlooket(qs); closeModal(); };
  $('#modal [data-exp="kahoot"]').onclick = () => { exportKahoot(qs); closeModal(); };
}
function exportBlooket(qs) {
  // Blooket's import template: a title row, a header row, then one question per row (answers by number).
  const rows = [['Blooket\nImport Template'], ['Question #', 'Question Text', 'Answer 1', 'Answer 2', 'Answer 3\n(Optional)', 'Answer 4\n(Optional)', 'Time Limit (sec)\n(Max: 300 seconds)', 'Correct Answer(s)\n(Only include Answer #)']];
  qs.questions.forEach((q, i) => rows.push([i + 1, q.question, q.options[0] || '', q.options[1] || '', q.options[2] || '', q.options[3] || '',
    Math.min(300, Math.max(5, Number(q.timeLimit) || 20)), (q.correct || 0) + 1]));
  downloadFile(fileSafe(qs.title) + '-blooket.csv', toCSV(rows), 'text/csv;charset=utf-8');
  toast('Downloaded ' + qs.questions.length + ' questions for Blooket');
}
function exportKahoot(qs) {
  let cut = 0; const clip = (s, n) => { s = String(s || ''); if (s.length > n) { cut++; return s.slice(0, n - 1) + '…'; } return s; };
  // Same layout as Kahoot's own template: notes at the top, headers on row 8, questions from row 9 (column B on).
  const aoa = [['Quiz template'], ['Exported from QuizSpill: ' + qs.title], [], [], [], [], [],
    ['', 'Question - max 120 characters', 'Answer 1 - max 75 characters', 'Answer 2 - max 75 characters', 'Answer 3 - max 75 characters', 'Answer 4 - max 75 characters', 'Time limit (sec) – 5, 10, 20, 30, 60, 90, 120, or 240 secs', 'Correct answer(s) - choose at least one']];
  qs.questions.forEach((q, i) => aoa.push([i + 1, clip(q.question, 120), clip(q.options[0], 75), clip(q.options[1], 75), clip(q.options[2], 75), clip(q.options[3], 75),
    nearest(KAHOOT_TIMES, Number(q.timeLimit) || 20), (q.correct || 0) + 1]));
  downloadFile(fileSafe(qs.title) + '-kahoot.xlsx', makeXlsx(aoa));
  toast(cut ? 'Downloaded for Kahoot — ' + cut + ' long bit' + (cut === 1 ? ' was' : 's were') + ' shortened to fit Kahoot’s limits' : 'Downloaded ' + qs.questions.length + ' questions for Kahoot');
}

/* ===================== Developer page (only the developer's account; tap the seesaw logo) ===================== */
function setDev(on) {
  devOpen = on; document.body.classList.toggle('dev-on', on);
  document.querySelectorAll('.seesaw').forEach(s => { s.classList.remove('rock'); void s.offsetWidth; s.classList.add('rock'); });   // restart the tip-over
  route(); if (on) { scrollTo(0, 0); renderDev(); }
}
document.querySelectorAll('[data-devtoggle]').forEach(el => el.addEventListener('click', e => {
  if (!Cloud.isDev()) return;                  // everyone else: the logo does nothing, like before
  e.preventDefault(); e.stopPropagation(); setDev(!devOpen);
}));
const utcDay = (t = Clock.now()) => new Date(t).toISOString().slice(0, 10);
function devBars(rows, fmtLabel) {             // rows: [{label, value}] -> simple bar chart
  const max = Math.max(1, ...rows.map(r => r.value));
  return `<div class="dev-bars">${rows.map(r => `<div class="dev-bar" title="${esc(r.label)}: ${r.value}"><span style="height:${Math.round(r.value / max * 100)}%"></span><b>${r.value || ''}</b><small>${esc(fmtLabel(r.label))}</small></div>`).join('')}</div>`;
}
async function renderDev() {
  const box = $('#devBody');
  const head = `<div class="pagehead"><div><h1>Developer</h1><p>Numbers from every signed-in account. Counts only — no names or emails.</p></div>
    <button class="btn ghost" id="devRefresh"><i class='bx bx-refresh'></i> Refresh</button></div>`;
  box.innerHTML = head + `<div class="card"><div class="none">Loading…</div></div>`;
  $('#devRefresh').onclick = renderDev;
  let list;
  try { list = await Cloud.devStats(); }
  catch (e) {
    box.innerHTML = head + `<div class="card"><div class="none">Firebase didn’t allow this (${esc(e.code || e.message)}).<br>Publish the latest <b>firestore.rules</b> in the Firebase console, and sign in with Google as hatfieldnathan@oacsd.org.</div></div>`;
    $('#devRefresh').onclick = renderDev; return;
  }
  if (!devOpen) return;
  const now = Clock.now(), today = utcDay(), sum = f => list.reduce((n, u) => n + (Number(f(u)) || 0), 0);
  const last = n => Array.from({ length: n }, (_, i) => utcDay(now - (n - 1 - i) * 864e5));
  const teachers = list.filter(u => u.role === 'teacher').length, students = list.filter(u => u.role === 'student').length;
  const active = d => list.filter(u => (u.lastSeen || 0) >= now - d * 864e5).length;
  const days14 = last(14), days7 = last(7);
  const games = {}; list.forEach(u => Object.entries(u.games || {}).forEach(([g, n]) => { games[g] = (games[g] || 0) + (Number(n) || 0); }));
  const topGames = Object.entries(games).sort((a, b) => b[1] - a[1]);
  const phones = list.filter(u => u.device === 'phone').length, installed = list.filter(u => u.installed).length;
  const card = (n, label) => `<div class="tstat"><b>${n}</b><small>${label}</small></div>`;
  const dayLabel = k => new Date(k + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' });
  const pct = (a, b) => b ? (a / b * 100 < 1 && a ? '<1' : Math.round(a / b * 100)) + '%' : '—';
  const reads = k => sum(u => (u.reads || {})[k]), writes = k => sum(u => (u.writes || {})[k]);
  const fmtN = n => Number(n).toLocaleString();
  box.innerHTML = head + `
    <div class="sec">Users</div>
    <div class="today">${card(list.length, 'unique accounts')}${card(active(1), 'active today')}${card(active(7), 'active this week')}${card(active(30), 'active this month')}</div>
    <div class="today">${card(teachers, 'teachers')}${card(students, 'students')}${card(list.filter(u => (u.firstSeen || 0) >= now - 7 * 864e5).length, 'new this week')}${card(pct(active(7), list.length), 'came back this week')}</div>
    <div class="card"><h4 class="dev-h">New accounts per day</h4>${devBars(days14.map(k => ({ label: k, value: list.filter(u => u.firstSeen && utcDay(u.firstSeen) === k).length })), dayLabel)}</div>
    <div class="card"><h4 class="dev-h">Active accounts per day</h4>${devBars(days14.map(k => ({ label: k, value: list.filter(u => u.days && k in u.days).length })), dayLabel)}</div>
    <div class="sec">Games</div>
    <div class="today">${card(sum(u => u.plays), 'games played')}${card(sum(u => (u.days || {})[today]), 'played today')}${card(sum(u => days7.reduce((n, k) => n + (Number((u.days || {})[k]) || 0), 0)), 'played this week')}${card(list.length ? (sum(u => u.plays) / list.length).toFixed(1) : '—', 'games per account')}</div>
    <div class="card"><h4 class="dev-h">Plays per day</h4>${devBars(days14.map(k => ({ label: k, value: sum(u => (u.days || {})[k]) })), dayLabel)}</div>
    <div class="card"><h4 class="dev-h">Most played games</h4>${topGames.length ? topGames.map(([g, n], i) => `<div class="dev-row"><span>${i + 1}. ${esc(gameName(g))}</span><div class="an-bar"><span style="width:${Math.round(n / topGames[0][1] * 100)}%"></span></div><b>${n}</b></div>`).join('') : '<div class="none">No games played yet</div>'}</div>
    <div class="sec">Classes & quizzes</div>
    <div class="today">${card(sum(u => u.classes), 'classes')}${card(sum(u => u.sets), 'question sets')}${card(sum(u => u.aiQuizzes), 'AI quizzes made')}${card(teachers ? (sum(u => u.classes) / teachers).toFixed(1) : '—', 'classes per teacher')}</div>
    <div class="sec">Devices</div>
    <div class="today">${card(phones, 'on phones / tablets')}${card(list.length - phones, 'on computers')}${card(installed, 'installed the app')}${card(pct(installed, list.length), 'install rate')}</div>
    <div class="sec">Server (Firebase) reads & writes</div>
    <div class="today">${card(fmtN(reads(today)), 'reads today')}${card(pct(reads(today), 50000), 'of free daily reads')}${card(fmtN(writes(today)), 'writes today')}${card(pct(writes(today), 20000), 'of free daily writes')}</div>
    <div class="today">${card(fmtN(days7.reduce((n, k) => n + reads(k), 0)), 'reads this week')}${card(fmtN(days7.reduce((n, k) => n + writes(k), 0)), 'writes this week')}${card(active(1) ? Math.round(reads(today) / active(1)) : '—', 'reads per active account today')}${card(active(1) ? Math.round(writes(today) / active(1)) : '—', 'writes per active account today')}</div>
    <div class="card"><h4 class="dev-h">Reads per day</h4>${devBars(days14.map(k => ({ label: k, value: reads(k) })), dayLabel)}</div>
    <div class="card"><h4 class="dev-h">Writes per day</h4>${devBars(days14.map(k => ({ label: k, value: writes(k) })), dayLabel)}</div>
    <p class="dev-note">Reads & writes are counted by the app on each device and sent with its next update, so they can lag a bit and are an estimate.
      Free plan: 50,000 reads and 20,000 writes a day. Exact numbers: <a href="https://console.firebase.google.com/project/classquiz-646fe/firestore/usage" target="_blank" rel="noopener">Firebase console → Firestore → Usage</a>.</p>
    <p class="dev-note">Accounts show up here once they open QuizSpill after this update. “Active” and per-day numbers use UTC days.</p>`;
  $('#devRefresh').onclick = renderDev;
}

function openProfile() {
  const p = Cloud.profile || {}; let photo = p.photo || '';
  const oldRole = p.role === 'student' ? 'student' : 'teacher'; let role = oldRole;
  openModal(`<h3>My account</h3><p class="sub">${esc((Cloud.user && Cloud.user.email) || '')}</p>
  <div class="pf-row"><img id="pfImg" alt=""><div><button class="btn ghost" id="pfPick">Change photo</button> <button class="btn ghost" id="pfClear">Remove</button><input type="file" id="pfFile" accept="image/*" hidden></div></div>
  <label class="pf-l">Display name</label><input type="text" id="pfName" maxlength="30" value="${esc(p.displayName || '')}">
  <label class="pf-l">I use QuizSpill as a</label>
  <div class="role-pick"><button type="button" data-role="teacher"><i class='bx bxs-graduation'></i> Teacher</button><button type="button" data-role="student"><i class='bx bxs-user'></i> Student</button></div>
  <small class="pf-note" id="pfRoleNote"></small>
  <button type="button" class="btn ghost" id="pfTour" style="width:100%;margin-bottom:12px"><i class='bx bx-map-alt'></i> Show me around</button>
  ${isInstalled() ? '' : `<button type="button" class="btn ghost" id="pfInstall" style="width:100%;margin-bottom:12px"><i class='bx bx-mobile'></i> Install on this device</button>`}
  <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn" id="pfSave">Save</button></div>`);
  const paintRole = () => {
    document.querySelectorAll('#modal [data-role]').forEach(b => b.classList.toggle('on', b.dataset.role === role));
    $('#pfRoleNote').textContent = role === oldRole ? '' : 'Saving switches you to the ' + role + ' side and reloads the app. Your classes and scores stay saved.';
  };
  document.querySelectorAll('#modal [data-role]').forEach(b => { b.onclick = () => { role = b.dataset.role; paintRole(); }; });
  paintRole();
  const show = () => { $('#pfImg').src = photo || $('#profileIcon img').src; };
  show();
  $('#pfPick').onclick = () => $('#pfFile').click();
  $('#pfTour').onclick = () => { closeModal(); startTour(); };
  if ($('#pfInstall')) $('#pfInstall').onclick = installApp;
  $('#pfFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { photo = await Gate.resize(f); show(); } catch (er) { toast(er.message); } };
  $('#pfClear').onclick = () => { photo = ''; $('#pfImg').src = ''; $('#pfImg').removeAttribute('src'); };
  $('#modal [data-x]').onclick = closeModal;
  $('#pfSave').onclick = async () => {
    const name = $('#pfName').value.trim(); if (!name) return toast('Enter a display name');
    if (!Cloud.saveProfile) return toast('Connect to the internet to change your account');
    try {
      if (role !== oldRole) { await Cloud.saveProfile({ displayName: name, photo, role }); toast('Switching to ' + role + '…'); setTimeout(() => location.reload(), 500); return; }
      await Cloud.saveProfile({ displayName: name, photo });
      studentIdentity.name = name; saveStudentIdentity(); paintAvatar(); save(); if (uiMode === 'teacher') render(); closeModal(); toast('Profile saved');
    } catch (er) { toast('Could not save: ' + (er.code || er.message)); }
  };
}
$('#pmProfile').onclick = openProfile;
$('#settingsLink').onclick = e => { e.preventDefault(); openProfile(); };
$('#pmOut').onclick = () => Cloud.signOut();
$('#appLogout').onclick = e => { e.preventDefault(); Cloud.signOut(); };

/* ===================== Router ===================== */
function route() {
  const dv = document.getElementById('devView');
  if (devOpen) {                               // developer page covers everything until the seesaw is tapped again
    document.querySelectorAll('main .view').forEach(v => v.classList.toggle('on', v === dv));
    $('#studentClassTabs').hidden = true; paintBottomBar(); return;
  }
  if (dv) dv.classList.remove('on');
  const tm = document.querySelector('.side-menu.teacher-menu'), sm = document.querySelector('.side-menu.student-menu');
  if (tm) tm.style.display = uiMode === 'teacher' ? '' : 'none';
  if (sm) sm.style.display = uiMode === 'student' ? '' : 'none';
  if (uiMode === 'student') {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('on'));
    renderStudentTabs(); paintNotifs();
    if (studentSession && !studentJoinOpen) { const sv = document.getElementById('studentClassView'); if (sv) sv.classList.add('on'); renderStudentClass(); }
    else { const jv = document.getElementById('studentJoinView'); if (jv) jv.classList.add('on'); renderStudentJoin(); }
    updateStudentSidebarExtras(); paintBottomBar();
    return;
  }
  $('#studentClassTabs').hidden = true;
  paintNotifs();
  const sj = document.getElementById('studentJoinView'), sc = document.getElementById('studentClassView');
  if (sj) sj.classList.remove('on');
  if (sc) sc.classList.remove('on');
  VIEWS.forEach(v => { const el = document.querySelector('.view[data-view="' + v + '"]'); if (el) el.classList.toggle('on', nav === v); });
  document.querySelectorAll('#sidebar .teacher-menu li').forEach(li => li.classList.toggle('active', (li.dataset.view || '') === nav));
  updateStudentSidebarExtras(); paintBottomBar();
}
function goNav(v) {                       // teacher: switch page (sidebar or phone bottom bar)
  if (devOpen) setDev(false);
  const changed = nav !== v; nav = v;
  if (v === 'ai') openAITab();
  if (v === 'questions') renderQuestionSets();
  if (v === 'analytics') renderAnalytics();
  route(); scrollTo(0, 0);
  if (changed) FX.enter(document.querySelector('main .view.on'));
}
function paintBottomBar() {               // phone-only tab bar (CSS shows it on small screens)
  const bar = $('#bottomBar'); if (!bar) return;
  const items = uiMode === 'teacher'
    ? [['classes', 'bxs-graduation', 'Classes'], ['ai', 'bxs-bot', 'AI Quiz'], ['questions', 'bx-list-check', 'Questions'], ['analytics', 'bxs-doughnut-chart', 'Analytics'], ['account', 'bxs-user-circle', 'Account']]
    : [['classes', 'bxs-graduation', 'My classes'], ['account', 'bxs-user-circle', 'Account']];
  const on = uiMode === 'teacher' ? nav : 'classes';
  bar.innerHTML = items.map(([id, ic, label]) => `<button data-bb="${id}" class="${id === on ? 'on' : ''}"><i class='bx ${ic}'></i><span>${label}</span></button>`).join('');
}
$('#bottomBar').addEventListener('click', e => {
  const b = e.target.closest('[data-bb]'); if (!b) return;
  if (b.dataset.bb === 'account') return openProfile();
  if (uiMode === 'teacher') goNav(b.dataset.bb); else route();
});
document.querySelectorAll('#sidebar .teacher-menu li').forEach(li => {
  const a = li.querySelector('a'); if (!a) return;
  a.addEventListener('click', e => { e.preventDefault(); if (li.dataset.view) goNav(li.dataset.view); });
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
    existing.lastSeen = Clock.now();
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
  c.students.push({ id: studentIdentity.id, name, joinedAt: Clock.now(), lastSeen: Clock.now() });
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
    if (!c) { if (err) { err.textContent = joinFail === 'permission-denied' ? 'Your teacher has removed you from this class.' : joinFail ? 'Could not reach the class (' + joinFail + ').' : 'No class found with that code. Check with your teacher.'; err.style.display = 'block'; } return; }
    if (err) err.style.display = 'none';
    const already = joinedIds.includes(c.id);
    if (!already) { joinedIds.push(c.id); saveJoined(); }
    openStudentClass(c.id);
    registerStudentInClass(c);
    const me = c.students.find(s => s.id === studentIdentity.id);
    Cloud.joinClass(c.code, { sid: studentIdentity.id, name: studentIdentity.name, joinedAt: me ? me.joinedAt : Clock.now(), done: myDoneList(c) }).catch(() => {});
    cloudWatchStudent();
    c.opened = Clock.now(); save();
    toast(already ? 'You’re already in ' + c.name : 'Joined ' + c.name + ' — it has its own tab now');
    route(); updateStudentSidebarExtras();
  };
  btn.onclick = submit;
  input.onkeydown = e => { if (e.key === 'Enter') submit(); };
  setTimeout(() => input.focus(), 100);
}

function leaveStudentClass() {
  if (!studentSession) return;
  const c = classes.find(x => x.id === studentSession.classId);
  if (!c) { joinedIds = joinedIds.filter(id => id !== studentSession.classId); saveJoined(); studentSession = null; saveStudentSession(); route(); return; }
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
      joinedIds = joinedIds.filter(id => id !== c.id); saveJoined();
      if (joinedIds.length) openStudentClass(joinedIds[0]); else { studentSession = null; saveStudentSession(); }
      closeModal(); toast('Left ' + c.name);
      route(); updateStudentSidebarExtras();
    };
  };
}
document.getElementById('studentLeaveBtn').addEventListener('click', e => { e.preventDefault(); leaveStudentClass(); });

let gameRun = null;        // the game that's open: {game, quizId, answers answered since its last finished round}
// "Review my mistakes" practice: a set made of missed questions (id starts with review:). Its results aren't
// scores; a right answer just clears that question from the student's mistake list (kept on this device).
const isReviewRun = r => r && String(r.quizId).startsWith('review:');
const fixedKey = cid => 'adminhub_fixed_' + cid;
function clearMistakes(r, answers) {
  if (!studentSession) return 0;
  const qs = reviewSet; let fixed = {}, n = 0;
  try { fixed = JSON.parse(localStorage.getItem(fixedKey(studentSession.classId)) || '{}'); } catch (e) {}
  answers.forEach(a => { const q = qs && qs.questions[a.qIdx]; if (a.correct && q && q.src) { fixed[q.src] = Clock.now(); n++; } });
  try { localStorage.setItem(fixedKey(studentSession.classId), JSON.stringify(fixed)); } catch (e) {}
  return n;
}
window.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object' || !gameRun || e.source !== $('#battleFrame').contentWindow) return;
  if (d.type === 'quizAnswer') { gameRun.answers.push({ qIdx: d.qIdx, correct: !!d.correct }); return; }
  if (d.type !== 'gameEnd') return;
  gameRun.answers = [];     // this round gets saved in full just below
  if (uiMode !== 'student' || !studentSession) return;
  if (isReviewRun(gameRun)) { clearMistakes(gameRun, d.answers || []); return; }
  recordScore(studentSession.classId, d.game || 'unknown', d.quizId || 'preset', !!d.won, d.score, d.answers || []);
});

function renderStudentTabs() {
  const box = $('#studentClassTabs'); if (!box) return;
  box.hidden = !joinedIds.length;
  if (!joinedIds.length) return;
  const active = studentJoinOpen || !studentSession ? '__join' : studentSession.classId;
  box.innerHTML = joinedIds.map(id => { const c = classes.find(x => x.id === id);
      return `<button class="ctab ${active === id ? 'on' : ''}" data-class-tab="${esc(id)}"><i class='bx bxs-graduation'></i>${esc(c ? c.name : 'Class unavailable')}</button>`; }).join('')
    + `<button class="ctab add ${active === '__join' ? 'on' : ''}" data-class-tab="__join"><i class='bx bx-plus'></i>Join class</button>`;
  box.querySelectorAll('[data-class-tab]').forEach(b => { b.onclick = () => {
    if (devOpen) setDev(false);
    if (b.dataset.classTab === '__join') studentJoinOpen = true; else { openStudentClass(b.dataset.classTab); cloudWatchStudent(); }
    route();
  }; });
}

function finishGameRun() { // closing a game before the end still saves the questions answered so far
  const r = gameRun; gameRun = null;
  if (!r || !r.answers.length || uiMode !== 'student' || !studentSession) return;
  if (isReviewRun(r)) { clearMistakes(r, r.answers); if (studentTab === 'mistakes') renderStudentClass(); return; }
  recordScore(studentSession.classId, r.game, r.quizId, false, 0, r.answers, true);
  toast('Saved ' + r.answers.length + ' answer' + (r.answers.length === 1 ? '' : 's') + ' from that game');
  if (studentTab === 'scores' || studentTab === 'leaderboard') renderStudentClass();
}

function renderStudentClass() {
  const inner = document.getElementById('studentClassInner');
  if (!inner) return;
  if (!studentSession) { route(); return; }
  const c = classes.find(x => x.id === studentSession.classId);
  if (!c) {
    inner.innerHTML = `<div class="student-join-wrap"><div class="student-join-card">
      <div class="sj-icon" style="background:#fde8e6;color:#8a2721"><i class='bx bx-error-circle'></i></div>
      <h1>Class unavailable</h1><p>Your teacher's class is no longer available. You can join a different class with a new code.</p>
      <button class="btn" id="studentResetBtn">Remove this tab</button>
    </div></div>`;
    const b = document.getElementById('studentResetBtn');
    if (b) b.onclick = () => {
      joinedIds = joinedIds.filter(id => id !== studentSession.classId); saveJoined();
      if (joinedIds.length) openStudentClass(joinedIds[0]); else { studentSession = null; saveStudentSession(); studentJoinOpen = true; }
      route();
    };
    return;
  }
  const scores = getStudentScores(c.id, studentIdentity.id);
  const tabs = [
    { id: 'home', label: 'Home', icon: 'bxs-graduation' },
    { id: 'posts', label: 'Posts', icon: 'bxs-message-rounded' },
    { id: 'assignments', label: 'Assignments', icon: 'bx-task' },
    { id: 'practice', label: 'Practice', icon: 'bxs-book' },
    { id: 'mistakes', label: 'Mistakes', icon: 'bx-revision' },
    { id: 'scores', label: 'My scores', icon: 'bxs-bar-chart-alt-2' }
  ];
  if (c.settings && c.settings.leaderboard) tabs.splice(4, 0, { id: 'leaderboard', label: 'Leaderboard', icon: 'bxs-trophy' });
  const activeTab = tabs.find(t => t.id === studentTab) ? studentTab : 'home';

  inner.innerHTML = `
    <div class="student-class-hd">
      <div>
        <h1>${esc(c.name)}</h1>
        <div class="cls-meta"><span class="teacher-pill">${teacherOf(c).photo ? `<img src="${esc(teacherOf(c).photo)}" alt="">` : "<i class='bx bxs-user'></i>"}Teacher: ${esc(teacherOf(c).name)}</span> <span class="student-name-pill"><i class='bx bxs-user'></i> ${esc(studentIdentity.name || 'Student')}</span> <span class="student-badge"><i class='bx bxs-graduation'></i> Class code ${esc(c.code)}</span></div>
      </div>
      <button class="leave-link" id="leaveClassBtn"><i class='bx bx-log-out'></i> Leave class</button>
    </div>
    <div class="row"><div class="tabs">
      ${tabs.map(t => `<button data-student-tab="${t.id}" class="${activeTab === t.id ? 'on' : ''}"><i class='bx ${t.icon}'></i>${t.label}</button>`).join('')}
    </div></div>
    <div id="studentTabBody"></div>`;

  inner.querySelectorAll('[data-student-tab]').forEach(b => { b.onclick = () => { const changed = studentTab !== b.dataset.studentTab; studentTab = b.dataset.studentTab; renderStudentClass(); if (changed) FX.enter($('#studentTabBody')); }; });
  $('#leaveClassBtn').onclick = leaveStudentClass;
  const body = document.getElementById('studentTabBody');
  if (activeTab === 'home') renderStudentHome(c, scores);
  else if (activeTab === 'posts') renderStudentPosts(c);
  else if (activeTab === 'assignments') renderStudentAssignments(c);
  else if (activeTab === 'practice') renderStudentPractice(c);
  else if (activeTab === 'mistakes') renderStudentMistakes(c);
  else if (activeTab === 'scores') renderStudentScores(c, scores);
  else if (activeTab === 'leaderboard') renderStudentLeaderboard(c);
}

function renderStudentLeaderboard(c) {
  const body = document.getElementById('studentTabBody'), rows = leaderboardFor(c), me = studentIdentity.id;
  if (!rows.length) { body.innerHTML = `<div class="card"><div class="student-empty"><i class='bx bxs-trophy' style="font-size:42px;color:var(--blue);display:block;margin-bottom:12px"></i>No one is on the leaderboard yet. Answer questions in any game to get on it!</div></div>`; return; }
  let rank = 0, prev = null;
  body.innerHTML = `<div class="card lb">${rows.map((r, i) => {
      if (r.correct !== prev) { rank = i + 1; prev = r.correct; }
      const podium = rank <= 3 && r.correct > 0 ? ' r' + rank : '';   // gold / silver / bronze badge
      return `<div class="lb-row ${r.sid === me ? 'me' : ''}"><div class="lb-rank${podium}">${rank}</div><div class="lb-name">${esc(r.name)}${r.sid === me ? ' <small>(you)</small>' : ''}</div><div class="lb-score"><b>${r.correct}</b><small>correct</small></div></div>`;
    }).join('')}</div>
    <p class="lb-note">Ranked by correct answers across every game. It updates whenever your teacher has QuizSpill open.</p>`;
}

// Question sets a student can play in one class: that class's sets plus the built-in Preset Quiz.
const studentSetsFor = c => qsets.filter(q => q.practiceAllowed !== false && (!q._remote || q._remote === c.code));

function renderStudentHome(c, scores) {
  const body = document.getElementById('studentTabBody');
  const wins = scores.filter(s => s.won).length;
  const showWall = c.settings && c.settings.wallVisible !== false;
  const todoRows = studentTodo(c).filter(r => !r.done), nextAssign = todoRows.length ? todoRows[0].a : null;
  const recentPosts = showWall ? c.posts.slice(0, 3) : [];
  const practiceSets = studentSetsFor(c);

  let nextAssignBlock = '';
  if (nextAssign) {
    nextAssignBlock = `<div class="shsection">
      <h3><i class='bx bx-task'></i> Next up</h3>
      <div class="shline">
        <div class="shl-icon"><i class='bx bx-task'></i></div>
        <div class="shl-info"><b>${esc(nextAssign.text)}</b><small>${fmt(nextAssign.time)}${nextAssign.kind === 'quiz' ? ' · quiz' : ''} ${dueLabel(nextAssign, false)}</small></div>
        ${nextAssign.kind === 'quiz' && nextAssign.quizId ? `<div class="shl-actions">${assignPlayBtn(nextAssign)}</div>` : ''}
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
      <div class="shcard"><div class="shc-icon"><i class='bx bx-task'></i></div><b>${todoRows.length}</b><small>To-do</small></div>
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-trophy'></i></div><b>${wins}</b><small>Wins</small></div>
      <div class="shcard"><div class="shc-icon"><i class='bx bxs-joystick'></i></div><b>${scores.length}</b><small>Games played</small></div>
    </div>
    ${nextAssignBlock}
    ${postsBlock}
    <div class="shsection">
      <h3><i class='bx bxs-book'></i> Quick practice</h3>
      <p style="color:var(--dark-grey);font-size:14px;margin-bottom:12px">Play a game with any question set your teacher opened for practice.</p>
      <div class="shquick">
        ${practiceSets.length ? practiceSets.slice(0, 3).map(q => `<button class="playbtn browse" data-browse="${q.id}"><i class='bx bxs-joystick'></i> ${esc(q.title)}</button>`).join('') : '<div class="student-empty" style="padding:12px">No practice sets available yet.</div>'}
      </div>
    </div>`;
  wireStudentBodyHandlers();
}

function renderStudentPosts(c) {
  const body = document.getElementById('studentTabBody');
  if (!(c.settings && c.settings.wallVisible !== false)) { body.innerHTML = `<div class="card"><div class="student-empty">Your teacher has hidden the posts wall for now.</div></div>`; return; }
  const canPost = !!(c.settings && c.settings.studentsCanPost);
  body.innerHTML = (canPost ? `<div class="card stu-composer"><div class="composer"><div class="avatar stu-av">${esc(((studentIdentity.name || 'S').trim()[0] || 'S').toUpperCase())}</div>
      <textarea id="stuPostBox" maxlength="500" placeholder="Write something to your class…" aria-label="Write a post"></textarea></div>
      <div class="stu-post-row"><small>Everyone in the class and your teacher can see this.</small><button class="btn" id="stuPostBtn">Post</button></div></div>` : '')
    + wallHtml(c, 'student');
  if (canPost) {
    const box = $('#stuPostBox');
    $('#stuPostBtn').onclick = () => studentPost(c, box.value);
    box.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); studentPost(c, box.value); } });
  }
  body.querySelectorAll('[data-delwall]').forEach(b => b.onclick = () => deleteWallPost(c, b.dataset.delwall));
}

/* ===================== Class wall: teacher posts + student posts ===================== */
// Teacher posts live on the class (c.posts); student posts are their own cloud documents (c.wall), each
// saved under the account that wrote it, so every post shows its real author.
function wallItems(c) {
  return (c.posts || []).map(p => ({ ...p, byTeacher: true }))
    .concat((c.wall || []).map(p => ({ ...p, byTeacher: false })))
    .sort((a, b) => (b.time || 0) - (a.time || 0));
}
function wallHtml(c, who) {
  const items = wallItems(c), cls = who === 'teacher' ? 'post' : 'student-post';
  if (!items.length) return `<div class="card"><div class="${who === 'teacher' ? 'empty' : 'student-empty'}">${who === 'teacher' ? 'No posts yet. Write the first one above.' : 'No posts yet.'}</div></div>`;
  return `<div class="card">${items.map(p => {
    if (p.byTeacher) {
      const t = teacherOf(c);
      return `<div class="${cls}"><div class="meta">${tAv(t)}<div><b>${esc(t.name)}</b><small>${fmt(p.time)} · teacher</small></div>
        ${who === 'teacher' ? `<button class="del" data-del="posts:${p.id}" aria-label="Delete post"><i class='bx bx-trash'></i></button>` : ''}</div><p>${esc(p.text)}</p></div>`;
    }
    const name = who === 'teacher' ? studentName(c, { id: p.sid, name: p.name }) : (p.name || 'Student');
    const mine = who === 'student' && p.sid === studentIdentity.id;
    return `<div class="${cls}"><div class="meta"><div class="avatar stu-av">${esc(((name || 'S').trim()[0] || 'S').toUpperCase())}</div><div><b>${esc(name || 'Student')}${mine ? ' <small>(you)</small>' : ''}</b><small>${fmt(p.time)} · student</small></div>
      ${who === 'teacher' || mine ? `<button class="del" data-delwall="${esc(p.id)}" aria-label="Delete post"><i class='bx bx-trash'></i></button>` : ''}</div><p>${esc(p.text)}</p></div>`;
  }).join('')}</div>`;
}
async function studentPost(c, text) {
  text = String(text || '').trim(); if (!text) return;
  const p = { id: 'local_' + Clock.now(), sid: studentIdentity.id, name: studentIdentity.name || 'Student', text: text.slice(0, 500), time: Clock.now() };
  c.wall = [p].concat(c.wall || []); save(); renderStudentClass();
  if (!(c.remote && c.code)) return;                 // a class on this device only (no cloud)
  try { const id = await Cloud.addPost(c.code, p); if (id) p.id = id; }
  catch (e) {
    c.wall = (c.wall || []).filter(x => x !== p); save(); renderStudentClass();
    toast(e.code === 'permission-denied' ? 'Your teacher has turned off student posts' : 'Couldn’t post. Check your internet and try again');
  }
}
function deleteWallPost(c, id) {
  if (!c || !confirm('Delete this post?')) return;
  c.wall = (c.wall || []).filter(p => String(p.id) !== String(id)); save();
  if (c.code && !String(id).startsWith('local_')) Cloud.deletePost(c.code, id).catch(e => { console.warn('Delete post failed', e); toast('Couldn’t delete that post'); });
  if (uiMode === 'student') renderStudentClass(); else render();
}

function studentTodo(c) {                   // [{a, done}] with to-do first (soonest due first), then done
  const me = studentIdentity.id;
  const rows = c.assignments.map(a => ({ a, done: assignmentDone(c, a, me) }));
  const byDue = (x, y) => (x.a.due || Infinity) - (y.a.due || Infinity) || y.a.time - x.a.time;
  return rows.filter(r => !r.done).sort(byDue).concat(rows.filter(r => r.done));
}
function renderStudentAssignments(c) {
  const body = document.getElementById('studentTabBody');
  if (!c.assignments.length) { body.innerHTML = `<div class="card"><div class="student-empty">No assignments yet. Check back soon!</div></div>`; return; }
  const rows = studentTodo(c), todo = rows.filter(r => !r.done), done = rows.filter(r => r.done);
  const item = ({ a, done }) => `<div class="student-post ${done ? 'is-done' : ''}" data-aid="${a.id}">
    <div class="meta">${tAv(teacherOf(c), 'bx-task', '#2F65C8')}<div><b>${esc(teacherOf(c).name)}</b><small>Assignment · ${fmt(a.time)}${a.kind === 'quiz' ? ' · quiz' : ''} ${dueLabel(a, done)}</small></div>
      ${done ? `<span class="done-tag"><i class='bx bx-check'></i> Done</span>` : ''}</div>
    <p>${esc(a.text)}</p>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      ${a.kind === 'quiz' && a.quizId ? assignPlayBtn(a) : ''}
      ${a.kind !== 'quiz' ? `<button class="btn ghost" data-tick="${a.id}">${done ? 'Mark not done' : 'Mark done'}</button>` : ''}
      ${a.kind === 'quiz' && !done ? '<small class="hint-done">Finish a game with this quiz to complete it.</small>' : ''}
    </div>
  </div>`;
  body.innerHTML = `<h3 class="todo-h">To-do <span class="badge">${todo.length}</span></h3>
    <div class="card">${todo.length ? todo.map(item).join('') : '<div class="student-empty">All caught up!</div>'}</div>
    ${done.length ? `<h3 class="todo-h">Done <span class="badge">${done.length}</span></h3><div class="card">${done.map(item).join('')}</div>` : ''}`;
  body.querySelectorAll('[data-tick]').forEach(b => b.onclick = () => {
    const key = 'adminhub_done_' + c.id, id = Number(b.dataset.tick);
    let list = []; try { list = JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) {}
    list = list.includes(id) ? list.filter(x => x !== id) : list.concat(id);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) {}
    if (c.remote && c.code) Cloud.saveDone(c.code, list).catch(e => console.warn('Could not sync done list', e));
    renderStudentClass();
    const moved = document.querySelector(`#studentTabBody [data-aid="${id}"]`);
    if (moved) { FX.enter(moved); FX.tick(moved.querySelector('.done-tag')); }
  });
  wireStudentBodyHandlers();
}

function renderStudentPractice(c) {
  const body = document.getElementById('studentTabBody');
  const available = studentSetsFor(c);
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
        <div class="sr-badge ${s.won ? 'win' : 'lose'}"><i class='bx ${s.won ? 'bx-check' : s.quit ? 'bx-exit' : 'bx-x'}'></i></div>
        <div class="sr-info"><b>${esc(gameNames[s.game] || s.game)}</b><small>${s.won ? 'Won' : s.quit ? 'Left early' : 'Lost'} · ${(s.answers || []).filter(a => a.correct).length}/${(s.answers || []).length} correct · ${fmt(s.time)}</small></div>
        <div class="sr-score">${s.score || 0}</div>
      </div>`).join('')}
    </div>`;
}

// Questions this student got wrong the last time they saw them (and hasn't fixed in a review game since).
let reviewSet = null;
function studentMistakes(c) {
  const me = studentIdentity.id, latest = {}, misses = {};
  let fixed = {}; try { fixed = JSON.parse(localStorage.getItem(fixedKey(c.id)) || '{}'); } catch (e) {}
  getStudentScores(c.id, me).forEach(s => (s.answers || []).forEach(a => {      // newest game first
    if (typeof a.qIdx !== 'number') return;
    const key = s.quizId + '|' + a.qIdx;
    if (!(key in latest)) latest[key] = { correct: a.correct, time: s.time, quizId: s.quizId, qIdx: a.qIdx };
    if (!a.correct) misses[key] = (misses[key] || 0) + 1;
  }));
  return Object.entries(latest).filter(([k, v]) => !v.correct && !(fixed[k] > v.time)).map(([k, v]) => {
    const set = v.quizId === 'preset' ? { title: 'Preset Quiz', questions: PRESET_QUESTIONS } : qsets.find(x => x.id === v.quizId);
    const q = set && set.questions[v.qIdx];
    return q ? { key: k, q, set: set.title, misses: misses[k] || 1, time: v.time } : null;
  }).filter(Boolean).sort((a, b) => b.misses - a.misses || b.time - a.time);
}
function renderStudentMistakes(c) {
  const body = document.getElementById('studentTabBody'), list = studentMistakes(c);
  if (!list.length) { body.innerHTML = `<div class="card"><div class="student-empty"><i class='bx bx-check-circle' style="font-size:36px;color:#26890c"></i><br>No mistakes to review. Nice work!<br><small>Questions you get wrong in games show up here.</small></div></div>`; return; }
  body.innerHTML = `<div class="card mk-head"><div><b>${list.length} question${list.length === 1 ? '' : 's'} to review</b><small>Get one right in a review game and it leaves this list.</small></div>
      <button class="btn" id="mkPractice"><i class='bx bxs-joystick'></i> Practice these</button></div>
    <div class="card">${list.map(m => `<div class="mk-item">
      <div class="mk-q">${esc(m.q.question)}</div>
      <div class="mk-a"><i class='bx bx-check'></i> ${esc(m.q.options[m.q.correct] || '')}</div>
      ${m.q.explanation ? `<div class="mk-ex">${esc(m.q.explanation)}</div>` : ''}
      <small class="mk-meta">${esc(m.set)} · missed ${m.misses} time${m.misses === 1 ? '' : 's'}</small>
    </div>`).join('')}</div>`;
  $('#mkPractice').onclick = () => {
    reviewSet = { id: 'review:' + c.id, title: 'My mistakes', questions: list.slice(0, 20).map(m => ({ ...m.q, src: m.key })) };
    openGamePicker(reviewSet.id, reviewSet);
  };
}

function wireStudentBodyHandlers() {
  const inner = document.getElementById('studentClassInner'); if (!inner) return;
  inner.querySelectorAll('[data-student-tab-link]').forEach(b => { b.onclick = () => { studentTab = b.dataset.studentTabLink; renderStudentClass(); FX.enter($('#studentTabBody')); }; });
  inner.querySelectorAll('[data-student-play]').forEach(b => { b.onclick = () => { const qs = qsets.find(x => x.id === b.dataset.studentPlay); openGame(b.dataset.game, qs || null); }; });
}

/* ===================== Teacher: analytics ===================== */
let anClassId = null;
function renderAnalytics() {
  const box = $('#anBody'); if (!box) return;
  const own = classes.filter(c => !c.remote);
  if (!own.length) { box.innerHTML = `<div class="card"><div class="empty">Create a class first. Its stats show up here once students play.</div></div>`; return; }
  if (!own.some(c => c.id === anClassId)) anClassId = (own.find(c => c.id === activeId) || own[0]).id;
  const c = own.find(x => x.id === anClassId), acts = classActivity(c), weekAgo = Clock.now() - 7 * 864e5;
  let tot = 0, cor = 0; acts.forEach(a => { tot += a.total; cor += a.correct; });
  // per student
  const per = {};
  (c.students || []).forEach(s => { per[s.id] = { name: studentName(c, s), games: 0, total: 0, correct: 0, last: 0 }; });
  acts.forEach(a => { const p = per[a.sid] || (per[a.sid] = { name: a.name, games: 0, total: 0, correct: 0, last: 0 });
    p.games++; p.total += a.total; p.correct += a.correct; p.last = Math.max(p.last, a.time); });
  const studs = Object.values(per).map(p => ({ ...p, pct: p.total ? Math.round(p.correct / p.total * 100) : null }))
    .sort((a, b) => (b.pct === null ? -1 : b.pct) - (a.pct === null ? -1 : a.pct) || a.name.localeCompare(b.name));
  const needHelp = studs.filter(p => p.total >= 5 && p.pct < 60).sort((a, b) => a.pct - b.pct);
  // most-missed questions (at least 2 attempts)
  const q = {};
  acts.forEach(a => a.answers.forEach(x => { const k = a.quizId + '|' + x.qIdx, e = q[k] || (q[k] = { quizId: a.quizId, qIdx: x.qIdx, total: 0, wrong: 0 }); e.total++; if (!x.correct) e.wrong++; }));
  const missed = Object.values(q).filter(e => e.total >= 2 && e.wrong > 0).map(e => {
    const set = qsets.find(x => x.id === e.quizId) || (e.quizId === 'preset' ? { title: 'Preset Quiz', questions: PRESET_QUESTIONS } : null);
    const qq = set && set.questions[e.qIdx];
    return { ...e, pct: Math.round(e.wrong / e.total * 100), text: qq ? qq.question : 'Question ' + (e.qIdx + 1), set: set ? set.title : '' };
  }).sort((a, b) => b.pct - a.pct || b.total - a.total).slice(0, 6);
  // games played
  const gm = {}; acts.forEach(a => { gm[a.game] = (gm[a.game] || 0) + 1; });
  const gmax = Math.max(1, ...Object.values(gm));
  const lbOn = !!(c.settings && c.settings.leaderboard), lb = leaderboardFor(c).slice(0, 5);
  const bar = (pct, cls) => `<div class="an-bar"><i class="${cls || ''}" style="width:${Math.max(2, pct)}%"></i></div>`;
  const tone = pct => pct === null ? '' : pct < 60 ? 'low' : pct < 80 ? 'mid' : 'ok';

  box.innerHTML = `
    <div class="an-classes">${own.map(x => `<button class="ctab ${x.id === c.id ? 'on' : ''}" data-an-class="${x.id}">${esc(x.name)}</button>`).join('')}</div>
    <div class="today">
      <div class="tstat"><b>${(c.students || []).length}</b><small>students</small></div>
      <div class="tstat"><b>${acts.length}</b><small>games played</small></div>
      <div class="tstat"><b>${tot ? Math.round(cor / tot * 100) + '%' : '—'}</b><small>answers correct</small></div>
      <div class="tstat"><b>${new Set(acts.filter(a => a.time >= weekAgo).map(a => a.sid)).size}</b><small>active this week</small></div>
    </div>
    <div class="an-grid">
      <div class="rep"><h4><i class='bx bxs-error-circle' style="color:var(--red);margin-right:6px"></i>Needs help</h4>
        ${needHelp.length ? needHelp.map(p => `<div class="an-q"><b>${esc(p.name)}</b> — ${p.pct}% correct<small>${p.correct} of ${p.total} answers · ${p.games} game${p.games === 1 ? '' : 's'}</small>${bar(p.pct, 'low')}</div>`).join('')
          : '<div class="none">Nobody is below 60% (students show up here after 5+ answers).</div>'}</div>
      <div class="rep"><h4><i class='bx bx-question-mark' style="color:#d89e00;margin-right:6px"></i>Most-missed questions</h4>
        ${missed.length ? missed.map(m => `<div class="an-q">${esc(m.text)}<small>${m.pct}% missed · ${m.wrong} of ${m.total} attempts${m.set ? ' · ' + esc(m.set) : ''}</small>${bar(m.pct, 'low')}</div>`).join('')
          : '<div class="none">Not enough answers yet.</div>'}</div>
      <div class="rep"><h4><i class='bx bxs-joystick' style="color:var(--blue);margin-right:6px"></i>Games played</h4>
        ${Object.keys(gm).length ? Object.keys(gm).sort((a, b) => gm[b] - gm[a]).map(g => `<div class="an-q">${esc(gameName(g))}<small>${gm[g]} game${gm[g] === 1 ? '' : 's'}</small>${bar(gm[g] / gmax * 100)}</div>`).join('')
          : '<div class="none">No games played yet.</div>'}</div>
      <div class="rep"><h4><i class='bx bxs-trophy' style="color:#d89e00;margin-right:6px"></i>Leaderboard <span class="badge">${lbOn ? 'Students can see it' : 'Hidden from students'}</span></h4>
        ${lb.length ? lb.map((r, i) => `<div class="li"><span>${i + 1}. ${esc(r.name)}</span><span>${r.correct} correct</span></div>`).join('') : '<div class="none">No students yet.</div>'}
        <button class="btn ghost" style="margin-top:12px;align-self:flex-start" data-an-lb>${lbOn ? 'Hide from students' : 'Show to students'}</button></div>
    </div>
    <div class="rep an-table"><h4>Students</h4>
      ${studs.length ? `<table><thead><tr><th>Student</th><th>Games</th><th>Correct</th><th style="width:30%">Accuracy</th><th>Last played</th></tr></thead><tbody>
        ${studs.map(p => `<tr><td><b>${esc(p.name)}</b></td><td>${p.games}</td><td>${p.correct}/${p.total}</td><td>${p.pct === null ? '<span class="dim">—</span>' : p.pct + '%' + bar(p.pct, tone(p.pct))}</td><td>${p.last ? fmt(p.last) : '<span class="dim">Not yet</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<div class="none">No students yet. Share the join code.</div>'}</div>`;
}
$('#anBody').addEventListener('click', e => {
  const b = e.target.closest('[data-an-class]'); if (b) { anClassId = b.dataset.anClass; return renderAnalytics(); }
  if (e.target.closest('[data-an-lb]')) {
    const c = classes.find(x => x.id === anClassId); if (!c) return;
    c.settings.leaderboard = !c.settings.leaderboard; save(); renderAnalytics();
    toast(c.settings.leaderboard ? 'Leaderboard on for students' : 'Leaderboard hidden');
  }
});

/* ===================== Questions storage ===================== */
const QKEY = 'adminhub_questions_v2';
let qsets = [];
try { const r = localStorage.getItem(QKEY); if (r) qsets = JSON.parse(r); } catch (e) {}
function saveQSets() { try { localStorage.setItem(QKEY, JSON.stringify(qsets.filter(q => !q._remote))); } catch (e) {} saveRemote(); cloudPublishSoon(); }
function getQuestionSets() { return qsets; }
function addQuestionSet(set) {
  set.id = set.id || 'qs_' + Clock.now().toString(36);
  set.created = set.created || Clock.now();
  qsets.unshift(set); saveQSets();
  toast('Saved "' + set.title + '" · ' + set.questions.length + ' questions');
  if (nav === 'questions') renderQuestionSets();
}

const PRESET_QUESTIONS = [
  { question: "Which planet is known as the Red Planet?", options: ["Venus","Mars","Jupiter","Mercury"], correct: 1, timeLimit: 20, explanation: "Iron oxide on Mars gives it a red color.", hangmanClue: "The planet closest to the Sun", hangmanAnswer: "Mercury" },
  { question: "What is the largest ocean on Earth?", options: ["Atlantic","Indian","Arctic","Pacific"], correct: 3, timeLimit: 20, explanation: "The Pacific covers about a third of the planet.", hangmanClue: "The ocean between the Americas and Europe", hangmanAnswer: "Atlantic" },
  { question: "How many continents are there?", options: ["5","6","7","8"], correct: 2, timeLimit: 15, explanation: "Africa, Antarctica, Asia, Australia, Europe, N. America, S. America.", hangmanClue: "The continent where penguins live", hangmanAnswer: "Antarctica" },
  { question: "Who wrote Romeo and Juliet?", options: ["Charles Dickens","William Shakespeare","Jane Austen","Mark Twain"], correct: 1, timeLimit: 20, explanation: "Shakespeare wrote it around 1595.", hangmanClue: "The author of The Adventures of Tom Sawyer", hangmanAnswer: "Mark Twain" },
  { question: "What gas do plants absorb from the air?", options: ["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"], correct: 2, timeLimit: 20, explanation: "Plants take in CO2 for photosynthesis.", hangmanClue: "The process plants use to make food from sunlight", hangmanAnswer: "Photosynthesis" },
  { question: "What is the capital of France?", options: ["Lyon","Marseille","Paris","Nice"], correct: 2, timeLimit: 15, explanation: "Paris has been the capital since the 10th century.", hangmanClue: "The capital city of Italy", hangmanAnswer: "Rome" },
  { question: "Which is the longest river in the world?", options: ["Amazon","Nile","Yangtze","Mississippi"], correct: 1, timeLimit: 25, explanation: "The Nile is traditionally measured as the longest.", hangmanClue: "The biggest rainforest river in South America", hangmanAnswer: "Amazon" },
  { question: "What is 7 × 8?", options: ["54","56","58","64"], correct: 1, timeLimit: 10, explanation: "7 × 8 = 56.", hangmanClue: "9 times 9", hangmanAnswer: "81" },
  { question: "Which animal is the largest mammal?", options: ["Elephant","Blue whale","Giraffe","Hippopotamus"], correct: 1, timeLimit: 15, explanation: "Blue whales can reach 30 meters.", hangmanClue: "The tallest animal on land", hangmanAnswer: "Giraffe" },
  { question: "In which year did WWII end?", options: ["1943","1944","1945","1946"], correct: 2, timeLimit: 20, explanation: "WWII ended in 1945.", hangmanClue: "The president during the Civil War", hangmanAnswer: "Abraham Lincoln" }
];

/* ===================== Questions view (teacher) ===================== */
function renderQuestionSets() {
  const list = $('#qsList');
  if (!qsets.length) {
    list.innerHTML = `<div class="qb-empty"><i class='bx bx-list-check'></i><h3>No question sets yet</h3><p style="margin:8px 0 16px">Head to the AI Quiz tab and make one — it'll appear here.</p><button class="btn" id="qsEmptyGo">Open AI Quiz</button></div>`;
    const b = $('#qsEmptyGo'); if (b) b.onclick = () => goNav('ai');
    return;
  }
  list.innerHTML = qsets.map(qs => {
    const practiceOn = qs.practiceAllowed !== false;
    return `<div class="qset">
      <div class="top">
        <div class="info"><b>${esc(qs.title)}</b><small>${qs.questions.length} questions · ${fmt(qs.created)}${qs.assignedTo ? ' · assigned to ' + qs.assignedTo.length : ''}${practiceOn ? '' : ' · practice hidden'}</small></div>
        <div class="acts">
          <button class="iconbtn-sm ${practiceOn ? '' : 'hidden-practice'}" data-toggle-practice="${qs.id}" title="${practiceOn ? 'Hide from student practice' : 'Show in student practice'}" aria-label="${practiceOn ? 'Hide from student practice' : 'Show in student practice'}"><i class='bx ${practiceOn ? 'bxs-show' : 'bx-hide'}'></i></button>
          <button class="iconbtn-sm" data-assign="${qs.id}" title="Assign to a class" aria-label="Assign to a class"><i class='bx bx-task'></i></button>
          <button class="iconbtn-sm" data-edit="${qs.id}" title="Edit questions" aria-label="Edit questions"><i class='bx bx-edit'></i></button>
          <button class="iconbtn-sm" data-export="${qs.id}" title="Export to Kahoot or Blooket" aria-label="Export to Kahoot or Blooket"><i class='bx bx-download'></i></button>
          <button class="iconbtn-sm danger" data-delqs="${qs.id}" title="Delete set" aria-label="Delete set"><i class='bx bx-trash'></i></button>
        </div>
      </div>
      <div class="playrow">
        ${gameBtns('data-play', qs.id)}
        ${qs.questions.some(q => !q.hangmanAnswer) ? `<button class="btn ghost hm-add" data-hmadd="${qs.id}"><i class='bx bxs-pencil'></i> ${qs.questions.some(q => q.hangmanAnswer) ? 'Fill in missing Hangman clues' : 'Add Hangman clues'}</button>` : ''}
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
  list.querySelectorAll('[data-hmadd]').forEach(b => b.onclick = () => addHangmanClues(b.dataset.hmadd, b));
  list.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => editQuiz(b.dataset.edit));
  list.querySelectorAll('[data-export]').forEach(b => b.onclick = () => exportQuestions(b.dataset.export));
  list.querySelectorAll('[data-delqs]').forEach(b => b.onclick = () => { if (!confirm('Delete this question set?')) return; qsets = qsets.filter(x => x.id !== b.dataset.delqs); saveQSets(); renderQuestionSets(); });
}
$('#qsToAI').onclick = () => goNav('ai');

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
    chooseAssignGame(qs, (game, due) => {
      addAssignmentForClass(c, qs, game, due);
      toast('Assigned to ' + c.name);
      if (cur() && cur().id === c.id) { tab = 'assignments'; render(); }
      renderQuestionSets();
    });
  });
}
// Step 2 of assigning: which game? (null = students pick from all games)
function chooseAssignGame(qs, done) {
  const hasClues = qs.questions.some(q => q.hangmanAnswer);
  openModal(`<h3>Which game?</h3><p class="sub">Students play "${esc(qs.title)}" in this game.</p>
    ${dueField()}
    <div class="gpick"><button class="gcard" data-ag=""><span class="gic" style="background:#1fa971"><i class='bx bxs-joystick'></i></span><b>Students pick</b><small>Any game they like</small></button>
    ${GAMES.map(g => { const off = g.id === 'hangman' && !hasClues;
      return `<button class="gcard" data-ag="${g.id}" ${off ? 'disabled style="opacity:.45"' : ''}><span class="gic" style="background:${g.color}"><i class='bx ${g.icon}'></i></span><b>${g.name}</b><small>${off ? 'No Hangman clues in this set' : (GAME_DESC[g.id] || '')}</small></button>`; }).join('')}</div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal').querySelectorAll('[data-ag]').forEach(b => b.onclick = () => { if (b.disabled) return; const due = dueFromInput($('#dueIn').value); closeModal(); done(b.dataset.ag || null, due); });
}
function addAssignmentForClass(c, qs, game, due) {
  c.assignments.unshift({ id: Clock.now(), text: 'Quiz: ' + qs.title + ' (' + qs.questions.length + ' questions)' + (game ? ' · ' + gameName(game) : ''), time: Clock.now(), kind: 'quiz', quizId: qs.id, game: game || null, due: due || null });
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
    chooseAssignGame(qs, (game, due) => { addAssignmentForClass(c, qs, game, due); toast('Assigned "' + qs.title + '"'); render(); });
  });
}

/* ===================== Kahoot-style question editor ===================== */
const OPT_SHAPES = ['shape-a', 'shape-b', 'shape-c', 'shape-d'];
const OPT_LETTERS = ['A', 'B', 'C', 'D'];
const OPT_ICONS = ['bxs-square', 'bxs-circle', 'bxs-up-arrow', 'bxs-diamond'];
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
  FX.pop(document.querySelector('#qeScrim .qe-modal') || document.querySelector('#qeScrim > *'), document.getElementById('qeScrim'));
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
    <textarea class="qe-qinput" data-field="question" rows="2" placeholder="Type the question…">${esc(q.question)}</textarea>
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
    <div class="qe-qextra qe-hang">
      <div style="flex:2"><label>Hangman clue</label><input type="text" data-field="hangmanClue" maxlength="140" value="${esc(q.hangmanClue || '')}" placeholder="e.g. He was president during the Civil War"></div>
      <div><label>Hangman answer (1–5 words)</label><input type="text" data-field="hangmanAnswer" maxlength="30" value="${esc(q.hangmanAnswer || '')}" placeholder="e.g. Abraham Lincoln"></div>
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
    ['hangmanClue', 'hangmanAnswer'].forEach(f => { const inp = card.querySelector(`[data-field="${f}"]`); inp.addEventListener('input', () => { q[f] = inp.value; markQEDirty(); }); });
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
    const hc = (q.hangmanClue || '').trim(), ha = (q.hangmanAnswer || '').trim();
    if ((hc || ha) && !hangmanFields(q).hangmanAnswer) return toast('Question ' + (i + 1) + ': Hangman needs both a clue and a 1–5 word answer');
  }
  qs.questions.forEach(q => { const h = hangmanFields(q); delete q.hangmanClue; delete q.hangmanAnswer; Object.assign(q, h); });   // tidy / drop empty
  // Commit to the real qsets array
  const real = qsets.find(x => x.id === qeState.originalId);
  if (real) {
    real.title = qs.title.trim();
    real.questions = qs.questions;
    real.grade = qs.grade; real.difficulty = qs.difficulty;
  } else {
    qs.id = qeState.originalId || ('qs_' + Clock.now().toString(36));
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
// bump GAMES_V after changing anything in games/, so phones load the new game instead of an old saved copy
const GAMES_V = 4;
const GAMES = [
  { id: 'battleship', name: 'Battleship',     icon: 'bxs-ship',   color: '#2F65C8', file: 'games/battleship.html' },
  { id: 'bubble',     name: 'Bubble Shooter', icon: 'bxs-circle', color: '#7c3aed', file: 'games/bubble.html' },
  { id: 'asteroids',  name: 'Asteroids',      icon: 'bxs-planet', color: '#0d9488', file: 'games/asteroids.html' },
  { id: 'tetris',     name: 'Tetris',         icon: 'bxs-extension', color: '#e11d48', file: 'games/tetris.html' },
  { id: 'blockblast', name: 'Block Blast',    icon: 'bxs-cube',   color: '#ea580c', file: 'games/blockblast.html' },
  { id: 'match3',     name: 'Match 3',        icon: 'bxs-diamond', color: '#db2777', file: 'games/match3.html' },
  { id: 'checkers',   name: 'Checkers',       icon: 'bxs-crown',  color: '#b45309', file: 'games/checkers.html' },
  { id: 'connect4',   name: 'Connect 4',      icon: 'bxs-grid-alt', color: '#4b3fd0', file: 'games/connect4.html' },
  { id: 'hangman',    name: 'Hangman',        icon: 'bxs-pencil', color: '#ca8a04', file: 'games/hangman.html' },
];
const GAME_DESC = { battleship: 'Sink the enemy fleet', bubble: 'Match and pop bubbles', asteroids: 'Blast the space rocks', tetris: 'Stack blocks, clear lines', blockblast: 'Pop same-color groups', match3: 'Swap tiles to match 3', checkers: 'Jump and capture the robot', connect4: 'Get four in a row', hangman: 'Guess the word from a clue' };
const gameBtns = (attr, id) => `<button class="playbtn browse" data-browse="${id}"><i class='bx bxs-joystick'></i> Browse games</button>`;
function openGamePicker(quizId, set) {
  openModal(`<h3>Pick a game</h3><p class="sub">Every game uses the same questions.</p>
    <div class="gpick">${GAMES.map(g => `<button class="gcard" data-g="${g.id}"><span class="gic" style="background:${g.color}"><i class='bx ${g.icon}'></i></span><b>${g.name}</b><small>${GAME_DESC[g.id] || ''}</small></button>`).join('')}</div>
    <div class="foot"><button class="btn ghost" data-x>Cancel</button></div>`);
  $('#modal [data-x]').onclick = closeModal;
  $('#modal').querySelectorAll('[data-g]').forEach(b => b.onclick = () => { closeModal(); openGame(b.dataset.g, set || qsets.find(x => x.id === quizId) || null); });
}
document.addEventListener('click', e => { const b = e.target.closest('[data-browse]'); if (b) openGamePicker(b.dataset.browse); });
// An assignment can name its game; otherwise students pick one.
const assignPlayBtn = a => a.game && GAMES.some(g => g.id === a.game)
  ? `<button class="playbtn browse" data-play-game="${a.game}" data-quiz="${esc(a.quizId)}"><i class='bx bxs-joystick'></i> Play ${esc(gameName(a.game))}</button>`
  : gameBtns('', a.quizId);
document.addEventListener('click', e => { const b = e.target.closest('[data-play-game]'); if (b) openGame(b.dataset.playGame, qsets.find(x => x.id === b.dataset.quiz) || null); });

function openGame(type, qs) {
  const frame = $('#battleFrame');
  const qs_ = (qs && Array.isArray(qs.questions) && qs.questions.length) ? qs : { id: 'preset', title: 'Preset Quiz', questions: PRESET_QUESTIONS };
  frame.onload = () => {
    // hand the questions to the game once its page has loaded
    frame.contentWindow.postMessage({ type: 'loadQuiz', questions: qs_.questions, quizId: qs_.id }, '*');
  };
  gameRun = { game: type, quizId: qs_.id, answers: [] };
  Cloud.trackPlay(type);
  frame.src = (GAMES.find(g => g.id === type) || GAMES[0]).file + '?v=' + GAMES_V;
  $('#battleWrap').classList.add('show');
  document.body.style.overflow = 'hidden';
}
$('#battleClose').onclick = () => { finishGameRun(); $('#battleWrap').classList.remove('show'); $('#battleFrame').onload = null; $('#battleFrame').src = 'about:blank'; document.body.style.overflow = ''; };


/* ===================== AI / Puter sign-in ===================== */
const AI_MODEL = 'gpt-4o-mini', AI_FALLBACK = 'gpt-4o';
let aiErrors = [];
function logAIError(label, err, context) {
  const detail = (err && (err.stack || err.message)) ? (err.stack || err.message) : String(err);
  aiErrors.unshift({ time: new Date(Clock.now()).toLocaleTimeString(), label, detail, context: context || '' });
  renderAIErrors(); console.error('[AI]', label, err, context || '');
}
function renderAIErrors() {
  const panel = document.getElementById('aiErrors'), list = document.getElementById('aiErrorList'), cnt = document.getElementById('aiErrCount'), tot = document.getElementById('aiErrTotal');
  if (!panel || !list) return;
  cnt.textContent = aiErrors.length; tot.textContent = aiErrors.length;
  document.getElementById('aiErrorsToggle').style.display = aiErrors.length ? '' : 'none';   // debugging help, only when something failed
  panel.hidden = aiErrors.length === 0;
  list.innerHTML = aiErrors.map(e => `<li><b>${esc(e.label)} <span style="opacity:.6;font-weight:400">· ${esc(e.time)}</span></b>${esc(e.detail)}${e.context ? '<br><span style="opacity:.7">' + esc(e.context) + '</span>' : ''}</li>`).join('');
}
document.getElementById('aiErrorsToggle').onclick = () => { const p = document.getElementById('aiErrors'); p.hidden = !p.hidden; };
document.getElementById('aiErrorsClear').onclick = () => { aiErrors = []; renderAIErrors(); };

let authState = 'unknown', authLastReason = '';   // 'signed' | 'none' (no real Puter account yet) | 'exhausted' | 'failed' | 'unknown'
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
  if (!scrim.classList.contains('show')) FX.pop(modal, scrim);
  scrim.classList.add('show');
  modal.querySelectorAll('[data-auth-action]').forEach((btn, i) => { btn.onclick = () => { const act = (actions || [])[i]; scrim.classList.remove('show'); if (act && typeof act.onClick === 'function') act.onClick(); }; });
}
function closeAuthPopup() { const s = document.getElementById('authScrim'); if (s) s.classList.remove('show'); }
document.getElementById('authScrim').addEventListener('click', e => { if (e.target.id === 'authScrim') closeAuthPopup(); });

// Only a real Puter account (signed in with Google or email) can use AI — guest sessions have no credits.
const isRealPuterUser = u => !!u && (u.is_temp === false || (u.is_temp === undefined && !!u.email));
// Puter.js loads in the background (deferred), so wait for the page to finish loading before deciding it's missing.
const puterLoaded = () => window.puter || document.readyState === 'complete' ? Promise.resolve() : new Promise(r => window.addEventListener('load', r, { once: true }));
async function checkPuter() {            // quiet check: never opens a window or popup
  await puterLoaded();
  if (!window.puter || !puter.auth) { authState = 'failed'; authLastReason = 'Puter.js not loaded.'; updateAuthBadge(); return false; }
  try {
    if (await puter.auth.isSignedIn()) {
      const user = await puter.auth.getUser().catch(() => null);
      if (isRealPuterUser(user)) { if (authState !== 'exhausted') authState = 'signed'; updateAuthBadge(); updateLogoutVisibility(); return true; }
    }
  } catch (e) {}
  authState = 'none'; updateAuthBadge(); updateLogoutVisibility(); return false;
}
// Opens Puter's own sign-in window. Call it straight from a tap/click (no await before it), or browsers block the window.
async function puterSignIn() {
  if (!window.puter || !puter.auth) { toast('The AI service didn’t load. Check your internet and reload.'); return false; }
  try { await puter.auth.signIn(); }
  catch (e) { authLastReason = describeAuthError(e); logAIError('Puter sign-in failed', e); showPuterProblem('Sign-in didn’t finish', authLastReason); return false; }
  if (await checkPuter()) {
    toast('Signed in to Puter — you can make quizzes now!');
    if (nav === 'ai' && chatFlow) sysSay('Signed in to Puter. Let’s make a quiz!');
    return true;
  }
  showPuterProblem('Almost there', 'Puter signed you in as a guest, and guest accounts can’t use the AI. Choose “Continue with Google” (or create an account) in the Puter window.');
  return false;
}
// Step-by-step help shown when a teacher opens AI Quiz without a Puter account.
const PUTER_STEPS = [
  { icon: 'bxs-bot', title: 'Turn on the AI quiz maker',
    body: 'QuizSpill uses <b>Puter</b>, a free AI service, to write your quizzes. You need a free Puter account — you only do this once.' },
  { icon: 'bxl-google', title: 'Sign in with Google',
    body: 'A Puter window will open. Tap <b>Continue with Google</b> and pick your account. (You can also create a Puter account with an email.)',
    art: `<div class="pt-mock"><div class="pt-bar">puter.com</div><div class="pt-gbtn"><i class='bx bxl-google'></i> Continue with Google</div><div class="pt-or">or sign up with email</div></div>` },
  { icon: 'bxs-phone', title: 'Verify your phone if asked',
    body: 'Puter may ask for your <b>phone number</b> and text you a code. Type the code into the Puter window — it’s their check to stop spam. Not everyone gets asked.',
    art: `<div class="pt-mock"><div class="pt-bar">puter.com</div><div class="pt-or" style="margin:0 0 8px">Enter the code we texted you</div><div class="pt-code"><span>4</span><span>8</span><span>1</span><span></span><span></span><span></span></div></div>` },
  { icon: 'bxs-check-circle', title: 'Then come back here',
    body: 'When you’re signed in, the Puter window closes by itself and you can start making quizzes. Tap <b>Open Puter sign-in</b> to begin.' }
];
let puterStep = 0;
function showPuterTutorial(start) { const was = $('#authScrim').classList.contains('show'); puterStep = start || 0; paintPuterStep(); $('#authScrim').classList.add('show'); if (!was) FX.pop($('#authModal'), $('#authScrim')); }
function paintPuterStep() {
  const st = PUTER_STEPS[puterStep], last = puterStep === PUTER_STEPS.length - 1;
  $('#authModal').innerHTML = `<div class="pt">
    <div class="pt-dots">${PUTER_STEPS.map((_, i) => `<i class="${i === puterStep ? 'on' : ''}"></i>`).join('')}</div>
    <div class="pt-icon"><i class='bx ${st.icon}'></i></div>
    <small class="pt-step">Step ${puterStep + 1} of ${PUTER_STEPS.length}</small>
    <h3>${st.title}</h3><p>${st.body}</p>${st.art || ''}
    <div class="foot">${puterStep ? '<button class="btn ghost" data-pt="back">Back</button>' : '<button class="btn ghost" data-pt="close">Not now</button>'}
      <button class="btn" data-pt="${last ? 'go' : 'next'}">${last ? 'Open Puter sign-in' : 'Next'}</button></div></div>`;
  $('#authModal').querySelectorAll('[data-pt]').forEach(b => { b.onclick = () => {
    const a = b.dataset.pt;
    if (a === 'next') { puterStep++; paintPuterStep(); }
    else if (a === 'back') { puterStep--; paintPuterStep(); }
    else if (a === 'close') closeAuthPopup();
    else { closeAuthPopup(); puterSignIn(); }        // straight from the tap, so the Puter window isn't blocked
  }; });
}
function showPuterProblem(title, msg) {
  $('#authModal').innerHTML = `<div class="pt"><div class="pt-icon warn"><i class='bx bx-error-circle'></i></div><h3>${esc(title)}</h3><p>${esc(msg)}</p>
    <div class="foot"><button class="btn ghost" data-pp="steps">See the steps</button><button class="btn" data-pp="retry">Try again</button></div></div>`;
  $('#authModal [data-pp="steps"]').onclick = () => showPuterTutorial(1);
  $('#authModal [data-pp="retry"]').onclick = () => { closeAuthPopup(); puterSignIn(); };
  $('#authScrim').classList.add('show');
}
function openAITab() {                   // AI Quiz page: show the Puter steps only if there's no Puter account yet
  renderChat();
  checkPuter().then(ok => { if (!ok && nav === 'ai' && authState === 'none' && !tour) showPuterTutorial(); });
}
async function puterLogout() {
  if (authState !== 'signed') { toast('Logout only works for a full Puter account.'); return; }
  try {
    await puter.auth.signOut();
    authState = 'none'; authLastReason = '';
    updateAuthBadge(); updateLogoutVisibility(); toast('Signed out of Puter.');
  } catch (e) { logAIError('Sign-out failed', e); toast('Could not sign out.'); }
}
function updateLogoutVisibility() { const b = document.getElementById('puterLogout'); if (b) b.style.display = authState === 'signed' ? '' : 'none'; }
function updateAuthBadge() {
  const badge = document.getElementById('authBadge'), icon = document.getElementById('authIcon'), text = document.getElementById('authText');
  if (!badge || !icon || !text) return;
  badge.classList.remove('temp', 'signed', 'failed', 'exhausted', 'clickable'); badge.onclick = null;
  if (authState === 'signed') { badge.classList.add('signed'); icon.className = 'bx bx-check-circle'; text.textContent = 'Signed in to Puter'; }
  else if (authState === 'none') { badge.classList.add('temp', 'clickable'); icon.className = 'bx bx-log-in'; text.textContent = 'Sign in to use AI'; badge.onclick = () => showPuterTutorial(); }
  else if (authState === 'exhausted') { badge.classList.add('exhausted', 'clickable'); icon.className = 'bx bx-error'; text.textContent = 'Out of AI credits'; badge.onclick = () => window.open('https://puter.com/', '_blank'); }
  else if (authState === 'failed') { badge.classList.add('failed', 'clickable'); icon.className = 'bx bx-error-circle'; text.textContent = 'AI unavailable'; badge.onclick = () => checkPuter(); }
  else { icon.className = 'bx bx-loader-alt spin'; text.textContent = 'Checking…'; }
}

const AI_PROMPT = (n, topic, notes) => `You are a quiz generator. Return ONLY valid JSON. No prose, no markdown.
Shape: {"title":"...","questions":[{"question":"...","options":["A","B","C","D"],"correct":0,"timeLimit":20,"explanation":"...","hangmanClue":"...","hangmanAnswer":"..."}]}
Make EXACTLY ${n} questions. Topic: ${topic}. Notes: ${notes || '(none)'}.
Every question ALSO needs a separate Hangman puzzle on the same topic (used only by the Hangman game, never shown with the multiple-choice question):
- "hangmanClue": a short clue or fill-in prompt, different from the multiple-choice question.
- "hangmanAnswer": the answer to that clue, 1 to 3 words (5 words absolute max, 25 letters max), letters and numbers only, no punctuation. Example: {"hangmanClue":"He was president during the Civil War","hangmanAnswer":"Abraham Lincoln"}.`;
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
  try { raw = await aiChat(prompt); } catch (e) {
    if (e.noPuter) botSay(authState === 'exhausted' ? 'No AI credits left right now.' : 'Sign in to Puter first (follow the steps), then send your answer again.');
    else { logAIError('AI request failed', e); botSay('AI request failed. See Errors panel.'); } setWaiting(false); chatFlow.step = 'difficulty'; updateChips(); return; }
  let data = null; try { data = parseQuizJSON(raw); } catch (e) {}
  if (!data || !data.questions.length) { logAIError('Bad JSON', new Error('No questions'), raw.slice(0, 400)); botSay('Invalid JSON. Try again.'); setWaiting(false); chatFlow.step = 'difficulty'; updateChips(); return; }
  data.title = data.title || chatFlow.topic || 'Quiz';
  addQuestionSet({ title: data.title, questions: data.questions, grade: chatFlow.grade, difficulty: chatFlow.difficulty });
  Cloud.trackAI();
  botSay('Saved "' + data.title + '". Head to Questions tab.');
  setWaiting(false); chatFlow.step = 'done'; updateChips();
}
async function aiChat(prompt) {
  if (authState !== 'signed' && !(await checkPuter())) { showPuterTutorial(); const e = new Error('Not signed in to Puter'); e.noPuter = true; throw e; }
  async function attempt(model) { const res = await puter.ai.chat(prompt, { model }); return normalizePuter(res); }
  try { return await attempt(AI_MODEL); }
  catch (e) {
    if (isCreditsError(e)) { authState = 'exhausted'; updateAuthBadge(); botSay('Your Puter account is out of AI credits. Add more at puter.com, or try again later.'); e.noPuter = true; throw e; }
    if (isAuthError(e)) { authState = 'none'; updateAuthBadge(); showPuterTutorial(); e.noPuter = true; throw e; }
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
// Older sets (made before Hangman) get clues written by the AI for every question that's missing one.
async function addHangmanClues(id, btn) {
  const qs = qsets.find(x => x.id === id); if (!qs) return;
  const missing = qs.questions.map((q, i) => ({ q, i })).filter(x => !x.q.hangmanAnswer);
  if (!missing.length) return toast('Every question already has a Hangman clue');
  const prompt = `You write Hangman puzzles for a classroom quiz. Return ONLY valid JSON, no prose, no markdown:
{"items":[{"i":0,"hangmanClue":"...","hangmanAnswer":"..."}]}
For each numbered question below, write a separate short clue on the same topic (do not copy the question word for word) and its answer:
1 to 3 words (5 words absolute max, 25 letters max), letters and numbers only, no punctuation.
Questions:
${missing.map(x => x.i + '. ' + x.q.question + ' (correct answer: ' + (x.q.options[x.q.correct] || '') + ')').join('\n')}`;
  if (btn) { btn.disabled = true; btn.innerHTML = "<i class='bx bx-loader-alt spin'></i> Writing clues…"; }
  try {
    const raw = await aiChat(prompt);
    const txt = String(raw).replace(/^```(?:json)?/i, '').replace(/```$/, '');
    const obj = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    let added = 0;
    (obj.items || []).forEach(it => { const q = qs.questions[it.i]; if (!q || q.hangmanAnswer) return; const h = hangmanFields(it); if (h.hangmanAnswer) { Object.assign(q, h); added++; } });
    saveQSets(); toast(added ? 'Added Hangman clues to ' + added + ' question' + (added === 1 ? '' : 's') : 'The AI didn’t return usable clues — try again');
  } catch (e) { if (!e.noPuter) { logAIError('Hangman clues failed', e); toast('Couldn’t write clues — try again'); } }
  renderQuestionSets();
}
// Hangman's own clue + short answer (kept only if the answer is really short: max 5 words / 30 characters)
function hangmanFields(q) {
  const clue = typeof q.hangmanClue === 'string' ? q.hangmanClue.trim() : '';
  const ans = typeof q.hangmanAnswer === 'string' ? q.hangmanAnswer.replace(/[^A-Za-z0-9' -]/g, '').replace(/\s+/g, ' ').trim() : '';
  if (!clue || !ans || ans.length > 30 || ans.split(' ').length > 5) return {};
  return { hangmanClue: clue, hangmanAnswer: ans };
}
function parseQuizJSON(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const f = s.indexOf('{'), l = s.lastIndexOf('}'); if (f === -1 || l === -1) return null;
  let obj; try { obj = JSON.parse(s.slice(f, l + 1)); } catch (e) { return null; }
  if (!obj || !Array.isArray(obj.questions)) return null;
  obj.questions = obj.questions.filter(q => q && typeof q.question === 'string' && Array.isArray(q.options) && q.options.length === 4 && q.options.every(o => typeof o === 'string' && o.length) && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < 4).map(q => ({ question: q.question, options: q.options.slice(0, 4), correct: q.correct, timeLimit: Number.isFinite(q.timeLimit) ? q.timeLimit : 20, explanation: typeof q.explanation === 'string' ? q.explanation : '', ...hangmanFields(q) }));
  return obj;
}

/* ===================== Boot ===================== */
document.querySelectorAll('#sidebar .side-menu.top li a').forEach(a => a.addEventListener('click', e => e.preventDefault()));
(function ensurePreset() {
  if (!qsets.some(q => q.id === 'qs_preset')) { qsets.push({ id: 'qs_preset', title: 'Preset Quiz', created: Clock.now(), questions: PRESET_QUESTIONS, source: 'preset' }); saveQSets(); }
  const pre = qsets.find(q => q.id === 'qs_preset');   // older saved copies of the preset don't have Hangman clues yet
  if (pre && !(pre.questions || []).some(q => q.hangmanAnswer)) { pre.questions = PRESET_QUESTIONS; saveQSets(); }
})();
document.getElementById('puterLogout').addEventListener('click', e => { e.preventDefault(); puterLogout(); });


/* ===================== Guided tour (spotlight) =====================
   Dims the screen, lights up one real button at a time and explains it. Runs by itself the first time someone
   uses QuizSpill on a device (per role), and again from Account → "Show me around". Steps with `wait` hold until
   the person actually does the thing (make a first class / join a class). */
const TOUR_KEY = () => 'adminhub_tour_done_' + uiMode;
const visibleEl = sel => [].concat(sel || []).map(x => document.querySelector(x))
  .find(e => e && e.getClientRects().length && e.getBoundingClientRect().width > 0) || null;
function teacherTourSteps() {
  const steps = [];
  if (!classes.some(c => !c.remote)) steps.push({ sel: ['#firstClass', '#createClass'], title: 'Make your first class',
    text: 'Tap <b>Create class</b> and give it a name, like “Period 3 History”. The tour carries on once it’s made.',
    wait: () => classes.some(c => !c.remote), before: () => goNav('classes') });
  const page = v => () => { if (nav !== v) goNav(v); };
  const classTab = t => () => { if (nav !== 'classes') goNav('classes'); if (tab !== t) { tab = t; render(); } };
  steps.push(
    { title: 'Welcome to QuizSpill!', text: 'Here’s a quick tour of everything on the teacher side. Tap <b>Next</b> to move along, or <b>Skip tour</b> any time.', before: classTab('activity') },
    // ---- Classes ----
    { sel: ['#ownedList', '#classPick'], title: 'Your classes', text: 'All your classes are listed here. Tap one to open it, or make another with <b>Create class</b>.', before: classTab('activity') },
    { sel: '#joinBtn', title: 'Your join code', text: 'Students type this code to join your class. Tap it to copy it or show it big on the board.' },
    { sel: '#classView .tabs', title: 'Class tabs', text: 'Each class has three tabs: <b>Activity</b>, <b>Dashboard</b> and <b>Assignments</b>. Let’s look at each one.' },
    { sel: '#classView .card', title: 'Activity: the class wall', text: 'Write announcements here — they show up on your students’ class page. You can also <b>Share</b> the join code or <b>Assign</b> work from here.', before: classTab('activity') },
    { sel: '#classView .today', title: 'Dashboard: last 24 hours', text: 'Games played, students active and how many answers were right today — plus the latest activity.', before: classTab('dashboard') },
    { sel: '#classView .sumrow', title: 'Dashboard: class report', text: 'Overall mastery for the class, student count, games played, and the join code for sharing.' },
    { sel: '#assignQuizBtn', title: 'Assignments', text: '<b>Assign quiz</b>: pick a question set, then choose which game students play it in — or let them pick. Each assignment has a stats button to see how it went.', before: classTab('assignments') },
    { sel: '#assignTextBtn', title: 'Text assignments', text: 'Post a plain to-do (like “Read chapter 4”) without a quiz.' },
    { sel: '#gear', title: 'Class settings', text: 'Turn on the <b>class leaderboard</b>, choose whether students can post, hide the wall, or delete the class.' },
    // ---- AI Quiz ----
    { sel: ['#sidebar li[data-view="ai"]', '#bottomBar [data-bb="ai"]'], title: 'AI Quiz', text: 'Next, the AI quiz maker.', before: classTab('activity') },
    { sel: '.chat-wrap', title: 'Chat with the quiz maker', text: 'It asks four things — <b>topic</b>, <b>grade</b>, <b>how many questions</b> and <b>difficulty</b> — then writes the quiz and saves it to Question sets.', before: page('ai') },
    { sel: '#chatChips', optional: true, title: 'Quick answers', text: 'Tap a suggestion instead of typing.' },
    { sel: '#aiAttach', title: 'Use your own notes', text: 'Attach a <b>.txt</b> or <b>.pdf</b> (or paste long notes) and the questions come from your material.' },
    { sel: '#authBadge', title: 'AI sign-in', text: 'The AI runs on <b>Puter</b>, a free service. This badge shows if you’re signed in — tap it to sign in the first time.' },
    { sel: '#aiReset', title: 'Start over', text: '<b>New chat</b> starts a fresh quiz.' },
    // ---- Questions ----
    { sel: ['#sidebar li[data-view="questions"]', '#bottomBar [data-bb="questions"]'], title: 'Question sets', text: 'Every quiz you make lands here.', before: page('questions') },
    { sel: '#qsList .qset', title: 'A question set', text: 'Play it in any game, or use the buttons: <b>eye</b> shows/hides it in student practice, <b>assign</b> sends it to a class, <b>edit</b> changes questions, <b>trash</b> deletes it.' },
    { sel: '#qsToAI', title: 'Make a new set', text: 'Jumps to AI Quiz to make another one.' },
    // ---- Analytics ----
    { sel: ['#sidebar li[data-view="analytics"]', '#bottomBar [data-bb="analytics"]'], title: 'Analytics', text: 'How each class is doing.', before: page('analytics') },
    { sel: '#anBody .an-classes', optional: true, title: 'Pick a class', text: 'Switch between your classes here.' },
    { sel: '#anBody .an-grid', optional: true, title: 'Who needs help', text: '<b>Needs help</b> lists students under 60%, <b>Most-missed questions</b> shows what to reteach, plus games played and the leaderboard.' },
    { sel: '#anBody .an-table', optional: true, title: 'Every student', text: 'Games, correct answers, accuracy and when they last played.' },
    // ---- everywhere ----
    { sel: '#notificationIcon', title: 'Student activity', text: 'When students play, their results show up here.', before: classTab('activity') },
    { sel: ['#settingsLink', '#bottomBar [data-bb="account"]'], title: 'Your account', text: 'Change your name and photo, switch between teacher and student — and replay this tour with <b>Show me around</b>.' }
  );
  return steps;
}
function studentTourSteps() {
  const steps = [];
  if (!joinedIds.length) steps.push({ sel: '.student-join-card', title: 'Join your class',
    text: 'Type the class code your teacher gave you, then tap <b>Join class</b>. The tour carries on once you’re in.',
    wait: () => joinedIds.length > 0 && !!studentSession && !studentJoinOpen });
  steps.push(
    { title: 'Welcome to QuizSpill!', text: 'Here’s a quick look around. Tap <b>Next</b> to move along, or <b>Skip tour</b> any time.', before: () => { studentJoinOpen = false; studentTab = 'home'; route(); } },
    { sel: '#studentClassTabs', title: 'Your classes', text: 'Every class you join gets its own tab. Tap <b>Join class</b> to add another one.' },
    { sel: '#studentClassInner .tabs', title: 'Class pages', text: '<b>Home</b>, your teacher’s <b>posts</b>, <b>assignments</b>, <b>practice</b> games and <b>my scores</b>.' },
    { sel: '#studentTabBody', title: 'Assignments', text: 'Quizzes from your teacher show up here. Tap <b>Play</b> to start one.', before: () => { studentTab = 'assignments'; renderStudentClass(); } },
    { sel: ['.shquick', '#studentTabBody'], title: 'Play and learn', text: 'Every game uses your class’s questions. Run out of ammo or moves? Answer a question to keep going!', before: () => { studentTab = 'home'; renderStudentClass(); } },
    { sel: '[data-student-tab="leaderboard"]', optional: true, title: 'Class leaderboard', text: 'See how everyone in your class ranks by correct answers.' },
    { sel: '[data-student-tab="scores"]', title: 'My scores', text: 'Every game you’ve played and how many questions you got right.' },
    { sel: ['#settingsLink', '#bottomBar [data-bb="account"]'], title: 'Your account', text: 'Change your name or photo — and replay this tour with <b>Show me around</b>.' }
  );
  return steps;
}
let tour = null;
function startTour() {
  endTour(true);
  const root = document.createElement('div'); root.id = 'tour';
  root.innerHTML = '<div class="tr-shade"></div>'.repeat(4) + '<div class="tr-block"></div><div class="tr-ring"></div><div class="tr-tip" role="dialog" aria-live="polite"></div>';
  document.body.appendChild(root); document.body.classList.add('touring');
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-tr]'); if (!b || !tour) return;
    if (b.dataset.tr === 'next') tourGo(tour.i + 1, 1);
    else if (b.dataset.tr === 'back') tourGo(tour.i - 1, -1);
    else endTour();
  });
  tour = { steps: uiMode === 'teacher' ? teacherTourSteps() : studentTourSteps(), i: -1, root, timer: setInterval(tourTick, 200) };
  tourGo(0, 1);
}
function tourGo(i, dir) {
  const t = tour; if (!t) return;
  if (i >= t.steps.length) return endTour();
  i = Math.max(0, i);
  const st = t.steps[i];
  if (st.before) st.before();
  if (st.optional && !visibleEl(st.sel)) return tourGo(i + (dir || 1), dir);   // e.g. no leaderboard in this class
  t.i = i;
  const last = i === t.steps.length - 1;
  t.root.querySelector('.tr-tip').innerHTML = `<small>${i + 1} of ${t.steps.length}</small><h4>${st.title}</h4><p>${st.text}</p>
    <div class="tr-foot"><button class="tr-skip" data-tr="skip">${last ? '' : 'Skip tour'}</button>
      <span>${st.wait ? '<span class="tr-wait"><i class=\'bx bx-loader-alt spin\'></i> Waiting for you…</span>'
        : (i > 0 && !t.steps[i - 1].wait ? '<button class="btn ghost" data-tr="back">Back</button>' : '') + `<button class="btn" data-tr="next">${last ? 'Done' : 'Next'}</button>`}</span></div>`;
  tourTick();
}
function tourTick() {
  const t = tour; if (!t || t.i < 0) return;
  const st = t.steps[t.i];
  if (st.wait && st.wait()) return tourGo(t.i + 1, 1);
  // step aside while a popup, the question editor or a game is open (e.g. the "Create class" box)
  const busy = ['#scrim', '#authScrim', '#battleWrap'].some(x => { const e = $(x); return e && e.classList.contains('show'); }) || !!document.querySelector('.qe-scrim.show');
  t.root.style.display = busy ? 'none' : '';
  if (busy) return;
  const [s1, s2, s3, s4] = t.root.querySelectorAll('.tr-shade'), block = t.root.querySelector('.tr-block'), ring = t.root.querySelector('.tr-ring'), tip = t.root.querySelector('.tr-tip');
  const W = innerWidth, H = innerHeight, box = (e, x, y, w, h) => Object.assign(e.style, { left: x + 'px', top: y + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
  const el = visibleEl(st.sel);
  let r = el && el.getBoundingClientRect();
  if (r && (r.top < 60 || r.bottom > H - 70)) { el.scrollIntoView({ block: 'center' }); r = el.getBoundingClientRect(); }
  const tw = Math.min(330, W - 24); tip.style.width = tw + 'px';
  const th = tip.offsetHeight;
  if (!r) {                                   // nothing to point at: dim everything, tip in the middle
    box(s1, 0, 0, W, H); [s2, s3, s4, block, ring].forEach(e => box(e, 0, 0, 0, 0)); ring.style.display = 'none';
    Object.assign(tip.style, { left: (W - tw) / 2 + 'px', top: Math.max(12, (H - th) / 2) + 'px' });
    return;
  }
  const pad = 6, x = r.left - pad, y = r.top - pad, w = r.width + pad * 2, h = r.height + pad * 2;
  box(s1, 0, 0, W, y); box(s2, 0, y + h, W, H - y - h); box(s3, 0, y, x, h); box(s4, x + w, y, W - x - w, h);
  box(ring, x, y, w, h); ring.style.display = '';
  box(block, x, y, w, h); block.style.display = st.wait ? 'none' : '';   // only "do it" steps let taps through
  const below = y + h + 12, above = y - 12 - th;
  // below or above the target; if neither fits, keep clear of a "do it" target by sitting at the top of the screen
  const top = below + th < H - 8 ? below : above > 8 ? above : st.wait ? 8 : Math.max(8, H - th - 8);
  Object.assign(tip.style, { left: Math.min(Math.max(12, r.left + r.width / 2 - tw / 2), W - tw - 12) + 'px', top: top + 'px' });
}
function endTour(silent) {
  if (!tour) return;
  clearInterval(tour.timer); tour.root.remove(); tour = null; document.body.classList.remove('touring');
  if (!silent) { try { localStorage.setItem(TOUR_KEY(), '1'); } catch (e) {} }
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
  classes.filter(c => !c.remote).forEach(c => {
    c.leaderboard = c.settings && c.settings.leaderboard ? leaderboardFor(c) : [];   // students only see it while it's switched on
    Cloud.publishClass(c, qsetsFor(c)).catch(e => console.warn('Publish failed', e));
  });
  if (uiMode === 'teacher') Cloud.saveQsets(qsets.filter(q => !q._remote)).catch(e => console.warn('Question backup failed', e));
  cloudWatchTeacher();
}
function cloudRefresh() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { if (uiMode === 'teacher') { render(); if (nav === 'analytics') renderAnalytics(); } }, 600); }
function cloudWatchTeacher() {            // pull students + scores from students' devices into the teacher's screens
  classes.filter(c => !c.remote).forEach(c => {
    if (cloudWatched.has(c.id)) return; cloudWatched.add(c.id);
    Cloud.watchPosts(c.code, list => { c.wall = list; cloudRefresh(); });
    Cloud.watchStudents(c.code, list => {
      c.students = c.students || []; let changed = false;
      list.forEach(st => {
        if (isRemoved(c, st.sid)) { if ((st.lastSeen || 0) > c.removed[st.sid]) { delete c.removed[st.sid]; changed = true; } else return; }   // rejoined after being removed
        const ex = c.students.find(x => x.id === st.sid);
        const done = Array.isArray(st.done) ? st.done : [];
        if (!ex) { c.students.push({ id: st.sid, uid: st.uid, name: st.name, joinedAt: st.joinedAt, lastSeen: st.lastSeen, done }); changed = true; }
        else if (ex.name !== st.name || ex.lastSeen !== st.lastSeen || ex.uid !== st.uid || JSON.stringify(ex.done || []) !== JSON.stringify(done)) {
          Object.assign(ex, { name: st.name, lastSeen: st.lastSeen, uid: st.uid, done }); changed = true;
        }
      });
      if (changed) { save(); cloudRefresh(); }
    });
    Cloud.watchScores(c.code, list => { cloudScores[c.id] = list; cloudRefresh(); if (c.settings && c.settings.leaderboard) cloudPublishSoon(); });
  });
}
// Student: load a class (and its question sets) that lives in the cloud
async function importRemoteClass(code) { const d = await Cloud.fetchClass(code); return d ? applyRemoteClass(d) : null; }
function applyRemoteClass(d) {
  let c = classes.find(x => x.id === d.id);
  if (c && !c.remote) return c;           // this device is the teacher's own — keep its copy
  if (!c) { c = { students: [], opened: Clock.now() }; classes.push(c); }
  Object.assign(c, { id: d.id, name: d.name, code: d.code, created: d.created, settings: d.settings || {}, posts: d.posts || [], shared: d.shared || [], assignments: d.assignments || [], teacher: d.teacher || null, leaderboard: d.leaderboard || [], remote: true });
  const ids = new Set((d.qsets || []).map(q => q.id));
  qsets = qsets.filter(q => q._remote !== d.code || ids.has(q.id));
  (d.qsets || []).forEach(q => { const i = qsets.findIndex(x => x.id === q.id); const nq = { ...q, _remote: d.code }; if (i < 0) qsets.push(nq); else if (qsets[i]._remote) qsets[i] = nq; });
  saveRemote(); return c;
}
// Small status badge (bottom-left) so problems are visible, e.g. on an iPad with no console
(function () {
  const b = document.createElement('div'); b.id = 'cloudBadge';
  b.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;font:600 11px Poppins,sans-serif;padding:4px 10px;border-radius:20px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);max-width:70vw';
  const paint = () => {
    // only shown when there's a problem — a working connection needs no badge
    const m = { error: ['#DB504A', 'Can’t reach QuizSpill right now — changes will sync when you’re back online'], offline: ['#777', 'Offline — changes stay on this device'] }[Cloud.status];
    b.style.display = m ? '' : 'none';
    if (m) { b.style.color = m[0]; b.textContent = m[1]; b.title = Cloud.lastError || ''; }
  };
  window.addEventListener('cloudstatus', paint); paint();
  document.body.appendChild(b);
})();
const studentWatched = new Set();
function cloudWatchStudent() {            // keep every joined class's posts / assignments / sets / leaderboard live
  joinedIds.forEach(id => {
    const c = classes.find(x => x.id === id);
    if (!c || !c.remote || studentWatched.has(c.code)) return;
    studentWatched.add(c.code);
    Cloud.watchPosts(c.code, list => {
      c.wall = list;
      if (uiMode === 'student' && studentSession && studentSession.classId === c.id && studentTab === 'posts' && !studentJoinOpen) renderStudentClass();
    });
    Cloud.watchClass(c.code, d => {
      if (!d) return; applyRemoteClass(d);
      if (uiMode !== 'student') return;
      renderStudentTabs();
      if (studentSession && studentSession.classId === d.id && !studentJoinOpen) renderStudentClass();
    });
  });
}

loadRemote();
if (uiMode === 'teacher' && classes.some(c => !c.remote)) save();      // puts the teacher's name + photo on their classes
document.querySelectorAll('#modeToggle button').forEach(b => b.classList.toggle('on', b.dataset.mode === uiMode));
render();
route();
renderAIErrors();
updateAuthBadge();
updateLogoutVisibility();
updateStudentSidebarExtras();
paintAvatar();
if (uiMode === 'teacher') checkPuter();
setTimeout(() => { let done = false; try { done = !!localStorage.getItem(TOUR_KEY()); } catch (e) {} if (!done && !tour) startTour(); }, 900);   // first time here   // quiet: only sets the AI badge, never opens a window
cloudPublishSoon();
cloudWatchStudent();
Cloud.trackVisit({                           // one usage record per account (counts only; see the developer page)
  role: (Cloud.profile && Cloud.profile.role) || uiMode,
  device: matchMedia('(pointer: coarse)').matches || innerWidth < 700 ? 'phone' : 'computer',
  installed: isInstalled(),
  classes: classes.filter(c => !c.remote).length,
  sets: qsets.filter(q => !q._remote && q.id !== 'qs_preset').length
});
if (window.Splash) Splash.ready();         // the app is on screen; the loading screen closes once first data is in

/* data.js — the ONLY file that talks to Firebase (accounts + database).
   It signs people in first, THEN loads app.js, so the app always knows who is using it. */

const firebaseConfig = {
  apiKey: "AIzaSyDwukcDJ5vjMR8_0BxAq5qxIne0ZTrxgXY",
  authDomain: "classquiz-646fe.firebaseapp.com",
  projectId: "classquiz-646fe",
  storageBucket: "classquiz-646fe.firebasestorage.app",
  messagingSenderId: "48623221600",
  appId: "1:48623221600:web:8365ccdffd1a1af734fc05"
};

window.Cloud = (function () {
  const noop = async () => null, off = () => () => {};
  const api = {
    enabled: false, uid: null, user: null, profile: null, ready: Promise.resolve(false), status: 'offline', lastError: '',
    publishClass: noop, fetchClass: noop, deleteClass: noop, joinClass: noop, submitScore: noop, saveQsets: noop, removeStudent: noop, saveDone: noop,
    isDev: () => false, addPost: noop, deletePost: noop, watchPosts: off, trackVisit: noop, trackPlay: noop, trackAI: noop, devStats: async () => [],
    watchClass: off, watchStudents: off, watchScores: off
  };
  // bump ?v= when app.js changes so browsers fetch the new copy instead of an old cached one
  const startApp = () => { const s = document.createElement('script'); s.src = 'app.js?v=21'; document.body.appendChild(s); };

  if (!window.firebase) {                       // Firebase blocked/offline: run the app on this device only
    console.warn('[Cloud] Firebase did not load — running offline.');
    api.profile = { role: 'teacher', displayName: 'Teacher' };
    setTimeout(startApp, 0);
    return api;
  }

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth(), db = firebase.firestore(), L = localStorage;
  const ts = () => firebase.firestore.FieldValue.serverTimestamp();
  const clean = o => JSON.parse(JSON.stringify(o));
  // What each class / the question bank looked like when last saved, kept on this device, so opening the
  // app doesn't re-save things that haven't changed (each save is a billed Firestore write).
  const SIGS = 'adminhub_pubsig';
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36) + '.' + s.length; };
  const lastSig = (() => { try { return JSON.parse(L.getItem(SIGS) || '{}'); } catch (e) { return {}; } })();
  const saveSigs = () => { try { L.setItem(SIGS, JSON.stringify(lastSig)); } catch (e) {} };

  /* ---------- counting reads & writes (an estimate for the developer page) ---------- */
  // Counts wait on this device and are sent along with the next usage update, so counting costs no extra writes.
  const PENDING = 'adminhub_usage_pending', VISIT = 'adminhub_usage_visit', FLUSHED = 'adminhub_usage_flushed';
  const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
  let pend = null;
  const loadPend = () => pend || (pend = (() => { try { return JSON.parse(L.getItem(PENDING) || 'null') || {}; } catch (e) { return {}; } })());
  const savePend = () => { try { L.setItem(PENDING, JSON.stringify(pend)); } catch (e) {} };
  const bump = (field, n, key = dayKey()) => { const p = loadPend(); p[field] = p[field] || {}; p[field][key] = (p[field][key] || 0) + n; savePend(); };
  const R = n => bump('reads', Math.max(1, n | 0));             // Firestore bills at least 1 read per query
  const W = (n = 1) => bump('writes', n);
  const report = (status, msg) => { api.status = status; api.lastError = msg || ''; window.dispatchEvent(new Event('cloudstatus')); };
  api.report = report; report('connecting');

  let resolveReady, started = false;
  api.ready = new Promise(r => { resolveReady = r; });

  const guard = fn => async (...a) => {
    if (!(await api.ready)) throw new Error(api.lastError || 'not signed in');
    try { const r = await fn(...a); if (api.status === 'error') report('ok'); return r; }
    catch (e) { report('error', e.code || e.message); throw e; }
  };
  const classRef = code => db.collection('classes').doc(code);
  const userRef = uid => db.collection('users').doc(uid);

  /* ---------- accounts ---------- */
  api.signUp = (name, email, pw) => { window.__pendingName = name; return auth.createUserWithEmailAndPassword(email, pw); };
  api.signIn = (email, pw) => auth.signInWithEmailAndPassword(email, pw);
  api.google = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
  api.resetPassword = email => auth.sendPasswordResetEmail(email);
  api.signOut = async () => { await auth.signOut(); location.reload(); };
  api.saveProfile = async p => {                 // {displayName, role, photo}
    const u = auth.currentUser;
    await userRef(u.uid).set(clean(p), { merge: true }); W();
    api.profile = { ...(api.profile || {}), ...p };
    cacheProfile(u.uid, api.profile);
    if (p.displayName) u.updateProfile({ displayName: p.displayName }).catch(() => {});
  };
  api.finishSetup = () => boot(auth.currentUser, api.profile);

  // A new device / new account: wipe the previous person's local data, and bring a teacher's classes back from the cloud.
  async function boot(user, prof) {
    if (started) return; started = true;
    try {
      if (L.getItem('adminhub_uid') !== user.uid) {
        Object.keys(L).filter(k => k.startsWith('adminhub_')).forEach(k => L.removeItem(k));
        L.setItem('adminhub_uid', user.uid);
      }
      if (prof.role === 'teacher') {
        if (!L.getItem('adminhub_classes_v1')) {
          const snap = await db.collection('classes').where('ownerUid', '==', user.uid).get(); R(snap.size);
          const cls = snap.docs.map(d => { const c = d.data(); return { id: c.id, name: c.name, code: c.code, created: c.created, settings: c.settings || {}, posts: c.posts || [], shared: c.shared || [], assignments: c.assignments || [], blocked: c.blocked || [], students: [], opened: Date.now(), setupDone: true }; });
          if (cls.length) L.setItem('adminhub_classes_v1', JSON.stringify(cls));
        }
        if (!L.getItem('adminhub_questions_v2') && prof.qsets && prof.qsets.length) L.setItem('adminhub_questions_v2', JSON.stringify(prof.qsets));
      }
    } catch (e) { console.warn('[Cloud] restore failed', e); report('error', 'restore: ' + (e.code || e.message)); }
    api.uid = user.uid; api.user = user; api.profile = prof; api.enabled = true;
    if (api.status !== 'error') report('ok');
    resolveReady(true); Gate.hide(); startApp();
  }

  // The profile is also kept on this device, so a slow or failed network read can never be mistaken for "no account".
  const cacheProfile = (uid, p) => { try { L.setItem('adminprofile_' + uid, JSON.stringify(p)); } catch (e) {} };
  const cachedProfile = uid => { try { return JSON.parse(L.getItem('adminprofile_' + uid) || 'null'); } catch (e) { return null; } };
  async function loadProfile(uid) {                 // {ok:true, prof|null} or {ok:false, err}; retries a few times
    let err;
    for (let i = 0; i < 3; i++) {
      try { const s = await userRef(uid).get(); R(1); return { ok: true, prof: s.exists ? s.data() : null }; }
      catch (e) { err = e; if (i < 2) await new Promise(r => setTimeout(r, 1500)); }
    }
    return { ok: false, err };
  }
  async function enter(user) {
    if (started) return;
    const r = await loadProfile(user.uid);
    let prof = r.ok ? r.prof : cachedProfile(user.uid);
    if (r.ok && prof && prof.role) cacheProfile(user.uid, prof);
    if (!r.ok && !(prof && prof.role)) { console.error('[Cloud] profile read failed', r.err); report('error', 'profile: ' + (r.err.code || r.err.message)); Gate.show('retry', 'We couldn’t reach your account (' + (r.err.code || r.err.message) + '). Check your internet and try again.'); return; }
    if (!prof || !prof.role) { api.profile = prof || {}; Gate.show('setup', user); return; }
    boot(user, prof);
  }
  api.retry = () => { if (auth.currentUser) enter(auth.currentUser); };

  auth.onAuthStateChanged(async user => {
    if (user && user.isAnonymous) { await auth.signOut(); return; }      // old guest session → show sign-in
    if (!user) { if (!started) Gate.show('in'); return; }
    enter(user);
  });

  /* ---------- classes & scores ---------- */
  api.publishClass = guard(async (c, qsets) => {
    const payload = clean({
      id: c.id, name: c.name, code: c.code, created: c.created, settings: c.settings,
      posts: c.posts || [], shared: c.shared || [], assignments: c.assignments || [],
      leaderboard: c.leaderboard || [],          // ranked names + correct answers, only filled while the teacher has it switched on
      blocked: c.blocked || [],                  // account ids of removed students who may not rejoin (enforced by firestore.rules)
      qsets: qsets || [], ownerUid: api.uid,
      teacher: { name: (api.profile && api.profile.displayName) || 'Teacher', photo: (api.profile && api.profile.photo) || '' }
    });
    const sig = hash(JSON.stringify(payload));
    if (lastSig[c.code] === sig) return null;
    await classRef(c.code).set({ ...payload, updatedAt: ts() }); W();
    lastSig[c.code] = sig; saveSigs(); return true;
  });
  api.saveQsets = guard(async list => {            // teacher's full question bank, so a new device can restore it
    const sig = hash(JSON.stringify(list));
    if (lastSig.__q === sig) return null;
    await userRef(api.uid).set({ qsets: clean(list) }, { merge: true }); W(); lastSig.__q = sig; saveSigs(); return true;
  });
  api.deleteClass = guard(async code => { delete lastSig[code]; saveSigs(); await classRef(code).delete(); W(); });
  api.fetchClass = guard(async code => { const s = await classRef(code).get(); R(1); return s.exists ? s.data() : null; });
  api.joinClass = guard(async (code, st) => {
    await classRef(code).collection('students').doc(api.uid).set(
      { sid: st.sid, name: String(st.name || '').slice(0, 30), joinedAt: st.joinedAt || Date.now(), lastSeen: Date.now(), done: (st.done || []).slice(0, 300) }); W();
  });
  // Teacher removes a student from the class roster (the rules let the class owner delete roster entries).
  api.removeStudent = guard(async (code, uid) => { await classRef(code).collection('students').doc(uid).delete(); W(); });
  // Student ticks written assignments off; the teacher sees them on the roster.
  api.saveDone = guard(async (code, ids) => {
    await classRef(code).collection('students').doc(api.uid).set({ done: (ids || []).slice(0, 300), lastSeen: Date.now() }, { merge: true }); W();
  });
  api.submitScore = guard(async (code, r) => {
    await classRef(code).collection('scores').add({
      uid: api.uid, sid: r.sid, name: String(r.name || '').slice(0, 30), game: r.game, quizId: String(r.quizId || 'preset'),
      won: !!r.won, quit: !!r.quit, score: Number(r.score) || 0, answers: clean(r.answers || []), time: r.time || Date.now(), at: ts()
    }); W();
  });

  // Students' wall posts are their own documents (the teacher's posts are part of the class itself), so each
  // post is saved under the account that wrote it. Errors here go to the caller, not the status badge.
  api.addPost = async (code, p) => {
    if (!(await api.ready)) throw new Error('not signed in');
    const ref = await classRef(code).collection('posts').add({ uid: api.uid, sid: p.sid, name: String(p.name || 'Student').slice(0, 30), text: String(p.text).slice(0, 500), time: Date.now(), at: ts() });
    W(); return ref.id;
  };
  api.deletePost = async (code, id) => { if (!(await api.ready)) return; await classRef(code).collection('posts').doc(id).delete(); W(); };
  api.watchPosts = (code, cb) => {                   // newest 50 posts; retries a little while a new student's join finishes
    let unsub = () => {}, dead = false, tries = 0; const first = firstLoad();
    const start = () => { if (dead) return first();
      unsub = classRef(code).collection('posts').orderBy('time', 'desc').limit(50).onSnapshot(s => {
        first(); if (!s.metadata.fromCache) R(s.docChanges().length);
        cb(s.docs.map(d => ({ ...d.data(), at: null, id: d.id })));
      }, e => { first(); if (e.code === 'permission-denied' && ++tries < 4) setTimeout(start, 3000); else console.warn('[Cloud] wall:', e.code); });
    };
    api.ready.then(ok => { if (ok) start(); else first(); });
    return () => { dead = true; unsub(); };
  };

  // While the loading screen is up, it waits for each listener's first data (max 5 s each).
  const firstLoad = () => { let fin = () => {}; const p = new Promise(r => { fin = r; }); if (window.Splash) Splash.wait(p); return () => fin(); };
  const watch = (getRef, map) => (code, cb) => {
    let unsub = () => {}, dead = false; const first = firstLoad();
    api.ready.then(ok => { if (!ok || dead) return first();
      unsub = getRef(code).onSnapshot(s => {
        first(); if (!s.metadata.fromCache) R(s.docChanges ? s.docChanges().length : 1); cb(map(s));
      }, e => { first(); console.warn('[Cloud] listener error:', e.code); report('error', 'listener: ' + e.code); }); });
    return () => { dead = true; unsub(); };
  };
  api.watchClass    = watch(classRef, s => (s.exists ? s.data() : null));
  api.watchStudents = watch(code => classRef(code).collection('students'), s => s.docs.map(d => ({ ...d.data(), uid: d.id })));
  // Scores only ever get added, so they're kept on this device and only NEW ones are downloaded
  // (before, every app open re-read every score the class ever played).
  api.watchScores = (code, cb) => {
    const KEY = 'adminhub_scores_' + code;
    let cache = []; try { cache = JSON.parse(L.getItem(KEY) || '[]'); } catch (e) {}
    const since = cache.reduce((m, d) => Math.max(m, d._at || 0), 0);
    if (cache.length) setTimeout(() => cb(cache), 0);
    let unsub = () => {}, dead = false; const first = firstLoad();
    api.ready.then(ok => { if (!ok || dead) return first();
      let q = classRef(code).collection('scores');
      if (since) q = q.where('at', '>=', firebase.firestore.Timestamp.fromMillis(since));
      unsub = q.onSnapshot(s => {
        first(); if (!s.metadata.fromCache) R(s.docChanges().length);
        const byId = new Map(cache.map(d => [d._id, d]));
        s.docs.forEach(d => { const x = d.data(); byId.set(d.id, { ...x, at: null, _id: d.id, _at: x.at && x.at.toMillis ? x.at.toMillis() : 0 }); });
        cache = [...byId.values()];
        try { L.setItem(KEY, JSON.stringify(cache)); } catch (e) {}   // too big for this device: it just downloads them all next time
        cb(cache);
      }, e => { first(); console.warn('[Cloud] listener error:', e.code); report('error', 'listener: ' + e.code); });
    });
    return () => { dead = true; unsub(); };
  };

  /* ---------- usage numbers for the developer page (no names or emails, just counts) ---------- */
  const DEV_EMAIL = 'hatfieldnathan@oacsd.org';
  api.isDev = () => !!(api.user && api.user.emailVerified && (api.user.email || '').toLowerCase() === DEV_EMAIL);
  const usageRef = () => db.collection('usage').doc(api.uid);
  const inc = n => firebase.firestore.FieldValue.increment(n);
  const quiet = fn => async (...a) => { if (!(await api.ready)) return null; try { return await fn(...a); } catch (e) { console.warn('[usage]', e.code || e.message); return null; } };
  // Sends everything counted on this device (plays, reads, writes...) in ONE write.
  const flush = quiet(async (extra = {}) => {
    const p = loadPend(); pend = {}; savePend();
    const data = { lastSeen: Date.now(), ...extra };
    const add = (field, map) => { Object.entries(map || {}).forEach(([k, n]) => { if (n) { data[field] = data[field] || {}; data[field][k] = inc(n); } }); };
    add('days', p.days); add('games', p.games); add('reads', p.reads);
    add('writes', { ...(p.writes || {}), [dayKey()]: ((p.writes || {})[dayKey()] || 0) + 1 });   // + this write
    const plays = Object.values(p.days || {}).reduce((a, b) => a + b, 0);
    if (plays) data.plays = inc(plays);
    if (p.ai && p.ai.n) data.aiQuizzes = inc(p.ai.n);
    try { await usageRef().set(data, { merge: true }); }
    catch (e) {                                   // keep the counts for next time
      const q = loadPend(); Object.entries(p).forEach(([f, m]) => Object.entries(m).forEach(([k, n]) => { q[f] = q[f] || {}; q[f][k] = (q[f][k] || 0) + n; })); savePend(); throw e;
    }
    try { L.setItem(FLUSHED, String(Date.now())); } catch (e) {}
    return true;
  });
  const hasPlays = () => Object.keys(loadPend().days || {}).length || Object.keys(loadPend().ai || {}).length;
  const hasAny = () => Object.keys(loadPend()).some(f => Object.keys(pend[f] || {}).length);
  const sinceFlush = () => Date.now() - (Number((() => { try { return L.getItem(FLUSHED); } catch (e) { return 0; } })()) || 0);
  const maybeFlush = leaving => {                 // at most every 10 min; when leaving, game plays go out after 1 min
    if (!api.enabled || !hasAny()) return;
    if (sinceFlush() > 10 * 60e3 || (leaving && hasPlays() && sinceFlush() > 60e3)) flush();
  };
  // Once per day per device: role, device, etc. (plus whatever was counted since last time) -- one write, no reads.
  api.trackVisit = quiet(async info => {
    const today = dayKey(); let seen = null; try { seen = L.getItem(VISIT); } catch (e) {}
    if (seen === today) return maybeFlush();
    const extra = { role: info.role, device: info.device, firstSeen: Date.parse(api.user.metadata && api.user.metadata.creationTime) || Date.now(), days: { [today]: inc(0) } };
    if (info.installed) extra.installed = true;
    if (info.role === 'teacher') { extra.classes = info.classes || 0; extra.sets = info.sets || 0; }
    for (let k = 36; k < 66; k++) {               // forget daily numbers older than ~5 weeks (rolling, no read needed)
      const d = dayKey(Date.now() - k * 864e5);
      ['days', 'reads', 'writes'].forEach(f => { extra[f] = extra[f] || {}; extra[f][d] = firebase.firestore.FieldValue.delete(); });
    }
    if (await flush(extra)) { try { L.setItem(VISIT, today); } catch (e) {} }
  });
  api.trackPlay = game => { const g = String(game || 'unknown').replace(/[^a-z0-9]/gi, '').slice(0, 20) || 'unknown'; bump('days', 1); bump('games', 1, g); maybeFlush(); };
  api.trackAI = () => { bump('ai', 1, 'n'); maybeFlush(); };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') maybeFlush(true); });
  api.devStats = async () => {                     // developer only (firestore.rules refuse everyone else)
    if (!(await api.ready)) throw new Error('not signed in');
    const snap = await db.collection('usage').limit(10000).get(); R(snap.size);
    return snap.docs.map(d => d.data());
  };
  return api;
})();

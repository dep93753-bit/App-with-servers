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
    publishClass: noop, fetchClass: noop, deleteClass: noop, joinClass: noop, submitScore: noop, saveQsets: noop,
    watchClass: off, watchStudents: off, watchScores: off
  };
  // bump ?v= when app.js changes so browsers fetch the new copy instead of an old cached one
  const startApp = () => { const s = document.createElement('script'); s.src = 'app.js?v=5'; document.body.appendChild(s); };

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
  const lastSig = {};
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
    await userRef(u.uid).set(clean(p), { merge: true });
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
          const snap = await db.collection('classes').where('ownerUid', '==', user.uid).get();
          const cls = snap.docs.map(d => { const c = d.data(); return { id: c.id, name: c.name, code: c.code, created: c.created, settings: c.settings || {}, posts: c.posts || [], shared: c.shared || [], assignments: c.assignments || [], students: [], opened: Date.now(), setupDone: true }; });
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
      try { const s = await userRef(uid).get(); return { ok: true, prof: s.exists ? s.data() : null }; }
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
      qsets: qsets || [], ownerUid: api.uid,
      teacher: { name: (api.profile && api.profile.displayName) || 'Teacher', photo: (api.profile && api.profile.photo) || '' }
    });
    const sig = JSON.stringify(payload);
    if (lastSig[c.code] === sig) return null;
    await classRef(c.code).set({ ...payload, updatedAt: ts() });
    lastSig[c.code] = sig; return true;
  });
  api.saveQsets = guard(async list => {            // teacher's full question bank, so a new device can restore it
    const sig = JSON.stringify(list);
    if (lastSig.__q === sig) return null;
    await userRef(api.uid).set({ qsets: clean(list) }, { merge: true }); lastSig.__q = sig; return true;
  });
  api.deleteClass = guard(async code => { delete lastSig[code]; await classRef(code).delete(); });
  api.fetchClass = guard(async code => { const s = await classRef(code).get(); return s.exists ? s.data() : null; });
  api.joinClass = guard(async (code, st) => {
    await classRef(code).collection('students').doc(api.uid).set(
      { sid: st.sid, name: String(st.name || '').slice(0, 30), joinedAt: st.joinedAt || Date.now(), lastSeen: Date.now() });
  });
  api.submitScore = guard(async (code, r) => {
    await classRef(code).collection('scores').add({
      uid: api.uid, sid: r.sid, name: String(r.name || '').slice(0, 30), game: r.game, quizId: String(r.quizId || 'preset'),
      won: !!r.won, score: Number(r.score) || 0, answers: clean(r.answers || []), time: r.time || Date.now(), at: ts()
    });
  });

  const watch = (getRef, map) => (code, cb) => {
    let unsub = () => {}, dead = false;
    api.ready.then(ok => { if (!ok || dead) return;
      unsub = getRef(code).onSnapshot(s => cb(map(s)), e => { console.warn('[Cloud] listener error:', e.code); report('error', 'listener: ' + e.code); }); });
    return () => { dead = true; unsub(); };
  };
  api.watchClass    = watch(classRef, s => (s.exists ? s.data() : null));
  api.watchStudents = watch(code => classRef(code).collection('students'), s => s.docs.map(d => d.data()));
  api.watchScores   = watch(code => classRef(code).collection('scores'),   s => s.docs.map(d => d.data()));
  return api;
})();

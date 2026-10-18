/* data.js — the ONLY file that talks to Firebase.
   Exposes a global `Cloud`. If Firebase can't load (offline), Cloud still exists
   but every call quietly does nothing, so the app keeps working from localStorage. */

const firebaseConfig = {
  apiKey: "AIzaSyDwukcDJ5vjMR8_0BxAq5qxIne0ZTrxgXY",
  authDomain: "classquiz-646fe.firebaseapp.com",
  projectId: "classquiz-646fe",
  storageBucket: "classquiz-646fe.firebasestorage.app",
  messagingSenderId: "48623221600",
  appId: "1:48623221600:web:8365ccdffd1a1af734fc05"
};

window.Cloud = (function () {
  const noop = async () => null;
  const off = () => () => {};
  const api = {
    enabled: false, uid: null, ready: Promise.resolve(false), status: 'offline', lastError: '',
    publishClass: noop, fetchClass: noop, deleteClass: noop, joinClass: noop, submitScore: noop,
    watchClass: off, watchStudents: off, watchScores: off
  };
  if (!window.firebase) { console.warn('[Cloud] Firebase did not load — running offline.'); return api; }

  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth(), db = firebase.firestore();
  const ts = () => firebase.firestore.FieldValue.serverTimestamp();
  const clean = o => JSON.parse(JSON.stringify(o));          // Firestore rejects `undefined`
  const lastPublished = {};                                  // code -> last JSON sent (skip no-op writes)

  const report = (status, msg) => { api.status = status; api.lastError = msg || ''; window.dispatchEvent(new Event('cloudstatus')); };
  api.report = report;
  report('connecting');
  api.ready = auth.signInAnonymously()
    .then(r => { api.uid = r.user.uid; api.enabled = true; report('ok'); return true; })
    .catch(e => { console.error('[Cloud] sign-in failed:', e); report('error', 'sign-in: ' + (e.code || e.message)); return false; });

  const guard = fn => async (...a) => {
    if (!(await api.ready)) throw new Error(api.lastError || 'not signed in');
    try { const r = await fn(...a); if (api.status === 'error') report('ok'); return r; }
    catch (e) { report('error', e.code || e.message); throw e; }
  };
  const classRef = code => db.collection('classes').doc(code);

  // Teacher: save a class (+ its question sets) so students on other devices can load it.
  api.publishClass = guard(async (c, qsets) => {
    const payload = clean({
      id: c.id, name: c.name, code: c.code, created: c.created, settings: c.settings,
      posts: c.posts || [], shared: c.shared || [], assignments: c.assignments || [],
      qsets: qsets || [], ownerUid: api.uid
    });
    const sig = JSON.stringify(payload);
    if (lastPublished[c.code] === sig) return null;
    await classRef(c.code).set({ ...payload, updatedAt: ts() });
    lastPublished[c.code] = sig;
    return true;
  });

  api.deleteClass = guard(async code => { delete lastPublished[code]; await classRef(code).delete(); });

  // Student: look up a class by join code (null if it doesn't exist).
  api.fetchClass = guard(async code => { const s = await classRef(code).get(); return s.exists ? s.data() : null; });

  // Student: add / refresh yourself on the class roster.
  api.joinClass = guard(async (code, st) => {
    await classRef(code).collection('students').doc(api.uid).set(
      { sid: st.sid, name: String(st.name || '').slice(0, 30), joinedAt: st.joinedAt || Date.now(), lastSeen: Date.now() });
  });

  // Student: send one finished game's result.
  api.submitScore = guard(async (code, r) => {
    await classRef(code).collection('scores').add({
      uid: api.uid, sid: r.sid, name: String(r.name || '').slice(0, 30), game: r.game, quizId: String(r.quizId || 'preset'),
      won: !!r.won, score: Number(r.score) || 0, answers: clean(r.answers || []), time: r.time || Date.now(), at: ts()
    });
  });

  // Live listeners — each returns an "unsubscribe" function.
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

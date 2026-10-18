/* auth.js — the sign-in / sign-up screen and the first-time account setup screen.
   (The Firebase calls themselves live in data.js.) */
window.Gate = (function () {
  const $ = id => document.getElementById(id);
  const gate = $('authGate'), box = $('agBox'), setup = $('agSetup');
  let role = '', photo = '';
  const MSG = {
    'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'Wrong email or password.',
    'auth/email-already-in-use': 'That email already has an account — try Sign in.', 'auth/weak-password': 'Password needs at least 6 characters.',
    'auth/invalid-email': 'That email doesn’t look right.', 'auth/missing-password': 'Please enter a password.',
    'auth/operation-not-allowed': 'That sign-in method isn’t switched on in Firebase yet.',
    'auth/popup-closed-by-user': 'Google sign-in was closed.', 'auth/cancelled-popup-request': 'Google sign-in was closed.',
    'auth/popup-blocked': 'Your browser blocked the Google pop-up. Allow pop-ups, or use email.',
    'auth/network-request-failed': 'No internet connection.', 'auth/too-many-requests': 'Too many tries — wait a minute and retry.',
    'permission-denied': 'Database rules need updating (permission denied).'
  };
  const say = (id, e) => { $(id).textContent = e ? (MSG[e.code] || e.code || e.message || String(e)) : ''; };
  const busy = (form, on) => form.querySelectorAll('button').forEach(b => { b.disabled = on; b.style.opacity = on ? .6 : 1; });
  const go = mode => box.classList.toggle('right-panel-active', mode === 'up');

  function resize(file, size = 128) {              // photo → small square JPEG (data URL) that fits in the database
    return new Promise((ok, bad) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = c.height = size;
        const s = Math.min(img.width, img.height);
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = () => bad(new Error('Could not read that image.'));
      img.src = url;
    });
  }
  const paintSetupAvatar = () => {
    const n = ($('agDisp').value || '?').trim().charAt(0).toUpperCase();
    $('agAv').style.backgroundImage = photo ? 'url(' + photo + ')' : 'none';
    $('agAv').textContent = photo ? '' : n;
  };

  document.querySelectorAll('[data-go]').forEach(el => el.onclick = e => { e.preventDefault(); go(el.dataset.go); });
  document.querySelectorAll('[data-google]').forEach(b => b.onclick = async () => {
    say('agInErr'); say('agUpErr');
    try { await Cloud.google(); } catch (e) { say(box.classList.contains('right-panel-active') ? 'agUpErr' : 'agInErr', e); }
  });
  $('agUp').onsubmit = async e => {
    e.preventDefault(); say('agUpErr'); const f = e.target;
    const name = $('agName').value.trim(); if (!name) return say('agUpErr', { message: 'Please enter your name.' });
    busy(f, true); try { await Cloud.signUp(name, $('agUpEmail').value.trim(), $('agUpPw').value); } catch (er) { say('agUpErr', er); } busy(f, false);
  };
  $('agIn').onsubmit = async e => {
    e.preventDefault(); say('agInErr'); const f = e.target;
    busy(f, true); try { await Cloud.signIn($('agInEmail').value.trim(), $('agInPw').value); } catch (er) { say('agInErr', er); } busy(f, false);
  };
  $('agForgot').onclick = async e => {
    e.preventDefault(); const em = $('agInEmail').value.trim();
    if (!em) return say('agInErr', { message: 'Type your email above first, then tap “Forgot password”.' });
    try { await Cloud.resetPassword(em); say('agInErr', { message: 'Reset email sent — check your inbox.' }); } catch (er) { say('agInErr', er); }
  };

  document.querySelectorAll('.ag-role').forEach(b => b.onclick = () => {
    role = b.dataset.role; document.querySelectorAll('.ag-role').forEach(x => x.classList.toggle('on', x === b));
  });
  $('agPhotoBtn').onclick = () => $('agPhoto').click();
  $('agPhoto').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { photo = await resize(f); paintSetupAvatar(); } catch (er) { say('agSetErr', er); } };
  $('agDisp').oninput = paintSetupAvatar;
  $('agFinish').onclick = async () => {
    say('agSetErr'); const name = $('agDisp').value.trim();
    if (!name) return say('agSetErr', { message: 'Please enter a display name.' });
    if (!role) return say('agSetErr', { message: 'Choose Teacher or Student.' });
    const b = $('agFinish'); b.disabled = true;
    try { await Cloud.saveProfile({ displayName: name, role, photo, createdAt: Date.now() }); await Cloud.finishSetup(); }
    catch (er) { say('agSetErr', er); b.disabled = false; }
  };

  return {
    resize,
    hide() { gate.hidden = true; },
    show(mode, user) {
      gate.hidden = false; const isSetup = mode === 'setup';
      box.hidden = isSetup; setup.hidden = !isSetup;
      if (isSetup) { $('agDisp').value = (user && user.displayName) || window.__pendingName || ''; paintSetupAvatar(); } else go('in');
    }
  };
})();

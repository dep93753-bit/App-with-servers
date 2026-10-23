// Opens Recess in "this device only" mode: Firebase, Puter (AI) and Motion are blocked,
// so tests never touch the real database and run the same every time.
const { expect } = require('@playwright/test');

async function openApp(page, { aiReply } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route(/gstatic\.com\/firebasejs/, r => r.abort());
  await page.route(/js\.puter\.com/, r => r.abort());
  await page.route(/cdn\.jsdelivr\.net\/npm\/motion/, r => r.abort());
  await page.addInitScript(reply => {
    localStorage.setItem('adminhub_tour_done_teacher', '1');
    localStorage.setItem('adminhub_tour_done_student', '1');
    window.puter = {
      auth: { isSignedIn: async () => !!reply, getUser: async () => (reply ? { username: 'test' } : null), signIn: async () => {} },
      ai: { chat: async () => reply || '' }
    };
  }, aiReply || null);
  await page.goto('/index.html');
  await page.waitForFunction(() => typeof render === 'function' && document.querySelector('#classView').children.length > 0);
  return errors;
}

async function createClass(page, name = 'Period 3') {
  await page.click('#firstClass');
  await page.fill('#ask', name);
  await page.click('#modal [data-ok]');
  await expect(page.locator('#classView h1')).toHaveText(name);
}

// Pretend students have joined (normally they arrive from the cloud).
async function addStudents(page, students) {
  await page.evaluate(list => { classes[0].students = list; save(); render(); }, students);
}

async function becomeStudentAndJoin(page) {
  const code = await page.evaluate(() => classes[0].code);
  await page.evaluate(() => { uiMode = 'student'; route(); });
  await page.fill('#joinCodeInput', code);
  await page.click('#joinCodeBtn');
  await expect(page.locator('[data-student-tab="assignments"]')).toBeVisible();
}

module.exports = { openApp, createClass, addStudents, becomeStudentAndJoin };

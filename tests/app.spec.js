// The main things teachers and students do. Each test runs on a desktop screen and a phone screen.
const { test, expect } = require('@playwright/test');
const { openApp, createClass, addStudents, becomeStudentAndJoin } = require('./helpers');

test('app opens with no errors and fits the screen', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('#firstClass')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('teacher creates a class and gets a join code', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  const code = await page.evaluate(() => classes[0].code);
  expect(code).toMatch(/^[A-Z0-9]{10}$/);
  await expect(page.locator('#joinBtn')).toContainText(code);
  expect(errors).toEqual([]);
});

test('assigning a quiz with a due date shows the due badge and progress', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await addStudents(page, [{ id: 's1', name: 'Ava' }, { id: 's2', name: 'Ben' }]);
  await page.click('#classView [data-tab="assignments"]');
  await page.click('#assignQuizBtn');
  await page.click('#qsPick [data-qsid="qs_preset"]');
  await page.fill('#dueIn', '2020-01-01');
  await page.click('#modal [data-ag=""]');
  const post = page.locator('#classView .post').first();
  await expect(post).toContainText('Overdue');
  await expect(post).toContainText('0/2 done');
  expect(errors).toEqual([]);
});

test('teacher renames and removes students', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await addStudents(page, [{ id: 's1', name: 'jimmy123' }, { id: 's2', name: 'Bob' }]);
  await page.evaluate(() => showSettings());
  await page.click('#sr');
  await page.click('#modal [data-rn="s1"]');
  await page.fill('#ask', 'Jimmy K');
  await page.click('#modal [data-ok]');
  await expect(page.locator('#modal .roster-name').first()).toContainText('Jimmy K');
  await page.click('#modal [data-rm="s2"]');
  const state = await page.evaluate(() => ({ ids: classes[0].students.map(s => s.id), removed: Object.keys(classes[0].removed || {}) }));
  expect(state).toEqual({ ids: ['s1'], removed: ['s2'] });
  expect(errors).toEqual([]);
});

test('question editor saves Hangman clues', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => {
    qsets.push({ id: 'qs_old', title: 'Old set', questions: [{ question: 'Which planet is red?', options: ['Mars', 'Venus', 'Earth', 'Pluto'], correct: 0 }] });
    saveQSets(); goNav('questions');
  });
  await expect(page.locator('[data-hmadd="qs_old"]')).toBeVisible();
  await page.click('[data-edit="qs_old"]');
  await page.fill('[data-field="hangmanClue"]', 'The red planet');
  await page.fill('[data-field="hangmanAnswer"]', 'Mars');
  await page.evaluate(() => saveQuestionEditor());
  const q = await page.evaluate(() => qsets.find(x => x.id === 'qs_old').questions[0]);
  expect([q.hangmanClue, q.hangmanAnswer]).toEqual(['The red planet', 'Mars']);
  expect(errors).toEqual([]);
});

test('AI fills in missing Hangman clues', async ({ page }) => {
  const reply = JSON.stringify({ items: [{ i: 0, hangmanClue: 'Big red planet', hangmanAnswer: 'Mars' }] });
  const errors = await openApp(page, { aiReply: reply });
  await page.evaluate(() => {
    authState = 'signed';
    qsets.push({ id: 'qs_old', title: 'Old set', questions: [{ question: 'Which planet is red?', options: ['Mars', 'Venus', 'Earth', 'Pluto'], correct: 0 }] });
    saveQSets(); goNav('questions');
  });
  await page.click('[data-hmadd="qs_old"]');
  await expect.poll(() => page.evaluate(() => qsets.find(x => x.id === 'qs_old').questions[0].hangmanAnswer)).toBe('Mars');
  expect(errors).toEqual([]);
});

test('student joins, sees To-do and marks work done', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await page.click('#classView [data-tab="assignments"]');
  await page.click('#assignTextBtn');
  await page.fill('#ask', 'Read chapter 4');
  await page.click('#modal [data-ok]');
  await becomeStudentAndJoin(page);
  await page.click('[data-student-tab="assignments"]');
  await expect(page.locator('.todo-h').first()).toContainText('To-do 1');
  await page.click('[data-tick]');
  await expect(page.locator('.todo-h').nth(1)).toContainText('Done 1');
  expect(errors).toEqual([]);
});

test('a game opens with the quiz and closes again', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => openGame('tetris', qsets.find(x => x.id === 'qs_preset')));
  await expect(page.locator('#battleWrap')).toHaveClass(/show/);
  await expect(page.locator('#battleFrame')).toHaveAttribute('src', /games\//);
  await page.click('#battleClose');
  await expect(page.locator('#battleWrap')).not.toHaveClass(/show/);
  expect(errors).toEqual([]);
});

test('a crash shows the friendly message, not a red debug bar', async ({ page }) => {
  await openApp(page);
  await page.route('**/boom.js', r => r.fulfill({ contentType: 'text/javascript', body: "setTimeout(function(){ throw new Error('boom') }, 0)" }));
  await page.addScriptTag({ url: '/boom.js' });
  await expect(page.locator('#__errbar')).toContainText('Something went wrong');
});

test('student reviews mistakes and a right answer in a review game clears one', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await becomeStudentAndJoin(page);
  await page.evaluate(() => {
    const cid = classes[0].id;
    recordScore(cid, 'tetris', 'qs_preset', false, 3, [{ qIdx: 0, correct: false }, { qIdx: 1, correct: false }, { qIdx: 2, correct: true }], false);
  });
  await page.click('[data-student-tab="mistakes"]');
  await expect(page.locator('.mk-item')).toHaveCount(2);
  await page.click('#mkPractice');
  await page.click('#modal [data-g="tetris"]');
  await expect(page.locator('#battleWrap')).toHaveClass(/show/);
  const quizId = await page.evaluate(() => gameRun.quizId);
  expect(quizId).toMatch(/^review:/);
  await page.evaluate(() => gameRun.answers.push({ qIdx: 0, correct: true }));
  await page.click('#battleClose');
  await expect(page.locator('.mk-item')).toHaveCount(1);
  // practice games aren't counted as scores
  const games = await page.evaluate(() => getStudentScores(classes[0].id, studentIdentity.id).length);
  expect(games).toBe(1);
  expect(errors).toEqual([]);
});

test('the app can be installed (manifest, icons, service worker)', async ({ page, request }) => {
  const errors = await openApp(page);
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  const manifest = await (await request.get('/' + href)).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get('/' + icon.src)).ok()).toBe(true);
  expect((await request.get('/sw.js')).ok()).toBe(true);
  await page.evaluate(() => openProfile());
  await page.click('#pfInstall');
  await expect(page.locator('#modal .inst li')).toHaveCount(3);
  expect(errors).toEqual([]);
});

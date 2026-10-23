// The main things teachers and students do. Each test runs on a desktop screen and a phone screen.
const { test, expect } = require('@playwright/test');
const { openApp, createClass, addStudents, becomeStudentAndJoin } = require('./helpers');

test('app opens with no errors and fits the screen', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('#firstClass')).toBeVisible();
  await expect(page).toHaveTitle('QuizSpill');
  await expect(page.locator('.nav-brand')).toHaveText('QuizSpill');
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
  const href = await page.getAttribute('link[rel="manifest"]', 'href');   // may carry a ?v= cache-buster
  const manifest = await (await request.get('/' + href)).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons) expect((await request.get('/' + icon.src)).ok()).toBe(true);
  expect((await request.get('/sw.js')).ok()).toBe(true);
  await page.evaluate(() => openProfile());
  await page.click('#pfInstall');
  await expect(page.locator('#modal .inst li')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('teacher exports grades as a spreadsheet', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await addStudents(page, [{ id: 's1', name: 'Ava' }, { id: 's2', name: '=Bob' }]);
  await page.click('#classView [data-tab="assignments"]');
  await page.click('#assignQuizBtn');
  await page.click('#qsPick [data-qsid="qs_preset"]');
  await page.click('#modal [data-ag=""]');
  // Ava finishes the quiz with 2 of 3 right (her scores are stored the way the cloud delivers them)
  await page.evaluate(() => {
    const c = classes[0];
    cloudScores[c.id] = [{ sid: 's1', name: 'Ava', game: 'tetris', quizId: 'qs_preset', won: true, quit: false, score: 9, time: Date.now() + 1000, answers: [{ qIdx: 0, correct: true }, { qIdx: 1, correct: true }, { qIdx: 2, correct: false }] }];
  });
  await page.click('#classView [data-tab="dashboard"]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportGrades')]);
  expect(download.suggestedFilename()).toMatch(/^Period-3-grades-.*\.csv$/);
  const text = require('fs').readFileSync(await download.path(), 'utf8').replace(/^﻿/, '');
  const lines = text.split('\r\n');
  expect(lines[0]).toContain('"Student","Games played","Questions answered","Correct","% correct"');
  expect(lines[0]).toContain('Preset Quiz');
  expect(lines[1]).toMatch(/^"Ava","1","3","2","67%",".*","67%"$/);
  expect(lines[2]).toMatch(/^"'=Bob","0","0","0","","","Not done"$/);   // formula-looking names are made safe
  expect(errors).toEqual([]);
});

test('questions export for Blooket (.csv) and Kahoot (.xlsx)', async ({ page }) => {
  const errors = await openApp(page);
  await page.evaluate(() => goNav('questions'));
  await page.click('[data-export="qs_preset"]');
  const [blooket] = await Promise.all([page.waitForEvent('download'), page.click('#modal [data-exp="blooket"]')]);
  expect(blooket.suggestedFilename()).toBe('Preset-Quiz-blooket.csv');
  const csv = require('fs').readFileSync(await blooket.path(), 'utf8').replace(/^﻿/, '').split('\r\n');
  const preset = await page.evaluate(() => PRESET_QUESTIONS);
  expect(csv[1]).toContain('"Question #","Question Text","Answer 1"');
  expect(csv.length).toBe(preset.length + 2);
  expect(csv[2]).toContain(`"${preset[0].question.replace(/"/g, '""')}"`);
  expect(csv[2].endsWith(`"${preset[0].correct + 1}"`)).toBe(true);

  await page.click('[data-export="qs_preset"]');
  const [kahoot] = await Promise.all([page.waitForEvent('download'), page.click('#modal [data-exp="kahoot"]')]);
  expect(kahoot.suggestedFilename()).toBe('Preset-Quiz-kahoot.xlsx');
  const bytes = require('fs').readFileSync(await kahoot.path());
  expect(bytes.subarray(0, 2).toString()).toBe('PK');                       // it's a zip, like every .xlsx
  const raw = bytes.toString('utf8');
  expect(raw).toContain('xl/worksheets/sheet1.xml');
  expect(raw).toContain('Question - max 120 characters');
  expect(raw).toContain('<c r="A9"><v>1</v></c>');                         // first question on row 9
  expect(errors).toEqual([]);
});

test('teacher sees which students ticked off a written assignment', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await page.click('#classView [data-tab="assignments"]');
  await page.click('#assignTextBtn');
  await page.fill('#ask', 'Read chapter 4');
  await page.click('#modal [data-ok]');
  const id = await page.evaluate(() => classes[0].assignments[0].id);
  // as it arrives from the cloud roster: Ava ticked it off, Ben didn't
  await addStudents(page, [{ id: 's1', uid: 'u1', name: 'Ava', done: [id] }, { id: 's2', uid: 'u2', name: 'Ben', done: [] }]);
  await expect(page.locator('#classView .post').first()).toContainText('1/2 done');
  expect(errors).toEqual([]);
});

test('removing a student blocks them, and the teacher can let them back in', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await addStudents(page, [{ id: 's1', uid: 'u1', name: 'Ava' }, { id: 's2', uid: 'u2', name: 'Ben' }]);
  await page.evaluate(() => showSettings());
  await page.click('#sr');
  await page.click('#modal [data-rm="s2"]');
  expect(await page.evaluate(() => classes[0].blocked)).toEqual(['u2']);
  await expect(page.locator('#modal [data-unblock="u2"]')).toBeVisible();
  await expect(page.locator('#modal')).toContainText('Ben');
  await page.click('#modal [data-unblock="u2"]');
  expect(await page.evaluate(() => classes[0].blocked)).toEqual([]);
  await expect(page.locator('#modal [data-unblock]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the seesaw logo does nothing for normal accounts', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('[data-devtoggle]:visible').first().click();
  await expect(page.locator('body')).not.toHaveClass(/dev-on/);
  await expect(page.locator('#devView')).not.toHaveClass(/\bon\b/);
  expect(errors).toEqual([]);
});

test('developer account: tapping the seesaw flips it and opens the developer page', async ({ page }) => {
  const errors = await openApp(page);
  const day = k => new Date(Date.now() - k * 864e5).toISOString().slice(0, 10);
  await page.evaluate(([d0, d1]) => {
    Cloud.isDev = () => true;
    Cloud.devStats = async () => [
      { role: 'teacher', device: 'computer', installed: false, firstSeen: Date.now() - 40 * 864e5, lastSeen: Date.now(), plays: 3, games: { tetris: 3 }, days: { [d0]: 3 }, classes: 2, sets: 4, aiQuizzes: 1, reads: { [d0]: 120 }, writes: { [d0]: 9 } },
      { role: 'student', device: 'phone', installed: true, firstSeen: Date.now() - 864e5, lastSeen: Date.now() - 864e5, plays: 6, games: { tetris: 1, hangman: 5 }, days: { [d1]: 6 } },
      { role: 'student', device: 'phone', installed: false, firstSeen: Date.now() - 60 * 864e5, lastSeen: Date.now() - 50 * 864e5, plays: 0, games: {}, days: {} }
    ];
  }, [day(0), day(1)]);
  await page.locator('[data-devtoggle]:visible').first().click();
  await expect(page.locator('body')).toHaveClass(/dev-on/);
  await expect(page.locator('#devView')).toHaveClass(/\bon\b/);
  const stats = page.locator('#devView .tstat');
  await expect(stats.filter({ hasText: 'unique accounts' })).toContainText('3');
  await expect(stats.filter({ hasText: 'active this week' })).toContainText('2');
  await expect(stats.filter({ hasText: 'games played' })).toContainText('9');
  await expect(stats.filter({ hasText: 'installed the app' })).toContainText('1');
  await expect(page.locator('#devView .dev-row').first()).toContainText('Hangman');
  await expect(stats.filter({ hasText: 'reads today' })).toContainText('120');
  await expect(stats.filter({ hasText: 'writes today' })).toContainText('9');
  // the seesaw tips to the other side (CSS plank rotation flips sign)
  const tilt = await page.locator('.seesaw:visible .ss-plank').first().evaluate(el => new DOMMatrix(getComputedStyle(el).transform).b);
  expect(tilt).toBeGreaterThan(0);
  // tap again: back to normal
  await page.locator('[data-devtoggle]:visible').first().click();
  await expect(page.locator('body')).not.toHaveClass(/dev-on/);
  await expect(page.locator('#devView')).not.toHaveClass(/\bon\b/);
  expect(errors).toEqual([]);
});

test.describe('loading screen', () => {
  test.use({ reducedMotion: 'no-preference' });
  test('QUIZSPILL writes itself out, then the loading screen goes away', async ({ page }) => {
    await page.route(/gstatic\.com\/firebasejs|js\.puter\.com|cdn\.jsdelivr\.net/, r => r.abort());
    await page.goto('/index.html');
    await expect(page.locator('#splash .worm')).toBeVisible();
    await expect(page.locator('#splash .worm path')).toHaveCount(9);            // one stroke per letter
    // letters start hidden and finish fully drawn
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('#splash .worm path:last-child')).strokeDashoffset), { timeout: 3000 }).toMatch(/^0(px)?$/);
    await expect(page.locator('#splash')).toHaveCount(0, { timeout: 5000 });
  });
});

test('wall: a student posts under their own name, not the teacher\'s', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await page.fill('#postBox', 'Welcome everyone');                   // teacher post
  await page.press('#postBox', 'Enter');
  await becomeStudentAndJoin(page);
  await page.evaluate(() => { studentIdentity.name = 'Ava'; });
  await page.click('[data-student-tab="posts"]');
  await page.fill('#stuPostBox', 'Hi class, Ava here');
  await page.click('#stuPostBtn');
  const posts = page.locator('#studentTabBody .student-post');
  await expect(posts).toHaveCount(2);
  await expect(posts.first()).toContainText('Ava');
  await expect(posts.first()).toContainText('Hi class, Ava here');
  await expect(posts.first()).toContainText('(you)');
  await expect(posts.nth(1)).toContainText('Welcome everyone');
  await expect(posts.nth(1)).toContainText('teacher');
  // the teacher sees the student's name on the student's post
  await page.evaluate(() => { uiMode = 'teacher'; tab = 'activity'; route(); render(); });
  const tposts = page.locator('#classView .post');
  await expect(tposts.filter({ hasText: 'Hi class, Ava here' })).toContainText('Ava');
  await expect(tposts.filter({ hasText: 'Hi class, Ava here' })).not.toContainText('Teacher');
  expect(errors).toEqual([]);
});

test('wall: no post box when the teacher turns student posts off; students can delete their own post', async ({ page }) => {
  const errors = await openApp(page);
  await createClass(page);
  await becomeStudentAndJoin(page);
  await page.click('[data-student-tab="posts"]');
  await page.fill('#stuPostBox', 'oops');
  await page.click('#stuPostBtn');
  await page.locator('#studentTabBody [data-delwall]').first().click();      // confirm() is auto-accepted
  await expect(page.locator('#studentTabBody .student-post')).toHaveCount(0);
  await page.evaluate(() => { classes[0].settings.studentsCanPost = false; save(); renderStudentClass(); });
  await expect(page.locator('#stuPostBox')).toHaveCount(0);
  expect(errors).toEqual([]);
});

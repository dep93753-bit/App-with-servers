// The pixel-art look shared by the games (games/pixel.js). Each game is opened on its own page.
const { test, expect } = require('@playwright/test');

const PIXEL_GAMES = ['tetris', 'checkers', 'connect4', 'bubble'];   // more join as they are converted

async function openGame(page, id) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/games/' + id + '.html');
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

for (const id of PIXEL_GAMES) {
  test(`${id}: pixel font and crisp (unblurred) pixels`, async ({ page }) => {
    const errors = await openGame(page, id);
    await expect(page.locator('body')).toHaveClass(/\bpx\b/);
    expect(await page.evaluate(() => document.fonts.check('16px "Press Start 2P"'))).toBe(true);   // bundled font loaded
    const canvases = await page.evaluate(() => [...document.querySelectorAll('canvas')].map(c => getComputedStyle(c).imageRendering));
    for (const r of canvases) expect(r).toMatch(/pixelated|crisp-edges/);
    expect(errors).toEqual([]);
  });
}

test('tetris draws on a small, chunky pixel grid', async ({ page }) => {
  await openGame(page, 'tetris');
  const { w, h } = await page.evaluate(() => ({ w: document.getElementById('board').width, h: document.getElementById('board').height }));
  expect([w, h]).toEqual([80, 160]);
});

test('the quiz question pop-up keeps the normal, easy-to-read font', async ({ page }) => {
  const errors = await openGame(page, 'tetris');
  for (let i = 0; i < 13 && !(await page.locator('.quiz-box').count()); i++) {   // drop pieces until ammo runs out,
    for (let k = 0; k < i % 4 * 2; k++) await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');   // spread out so the stack doesn't top out
    await page.keyboard.press(' ');
    await page.waitForTimeout(30);
  }
  await expect(page.locator('.quiz-box')).toBeVisible();
  expect(await page.locator('.quiz-box').evaluate(el => getComputedStyle(el).fontFamily)).not.toContain('Press Start');
  expect(await page.locator('.hud').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Press Start');
  expect(errors).toEqual([]);
});

test('connect 4: no robot claw, the robot\'s disc just drops in', async ({ page }) => {
  const errors = await openGame(page, 'connect4');
  await expect(page.locator('#hand, .rail, .bin-front')).toHaveCount(0);
  await page.locator('#cols .col').nth(3).click();
  await expect(page.locator('.disc.a:not(.ghost)')).toHaveCount(1, { timeout: 5000 });   // the robot answered
  expect(errors).toEqual([]);
});

test('checkers: pieces and the robot are pixel art', async ({ page }) => {
  const errors = await openGame(page, 'checkers');
  await expect(page.locator('.pc')).toHaveCount(24);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--px-red'))).toContain('data:image/svg+xml');
  expect(await page.locator('#rob rect').count()).toBeGreaterThan(5);
  expect(errors).toEqual([]);
});

test('bubble shooter: drawn on a small pixel canvas and can still shoot', async ({ page }) => {
  const errors = await openGame(page, 'bubble');
  expect(await page.evaluate(() => [document.getElementById('cv').width, document.getElementById('cv').height])).toEqual([200, 280]);
  await page.click('#fireBtn');
  await expect(page.locator('#ammoVal')).toContainText('4');
  expect(errors).toEqual([]);
});

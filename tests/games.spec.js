// The pixel-art look shared by the games (games/pixel.js). Each game is opened on its own page.
const { test, expect } = require('@playwright/test');

const PIXEL_GAMES = ['tetris'];   // more join as they are converted

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
    expect(await page.evaluate(() => document.fonts.check('16px "Pixelify Sans"'))).toBe(true);   // bundled font loaded
    const canvases = await page.evaluate(() => [...document.querySelectorAll('canvas')].map(c => getComputedStyle(c).imageRendering));
    for (const r of canvases) expect(r).toMatch(/pixelated|crisp-edges/);
    expect(errors).toEqual([]);
  });
}

test('tetris draws at half size, so each art pixel is a 2x2 block on screen', async ({ page }) => {
  await openGame(page, 'tetris');
  const { w, h } = await page.evaluate(() => ({ w: document.getElementById('board').width, h: document.getElementById('board').height }));
  expect([w, h]).toEqual([150, 300]);
});

test('the quiz question pop-up keeps the normal, easy-to-read font', async ({ page }) => {
  const errors = await openGame(page, 'tetris');
  for (let i = 0; i < 13 && !(await page.locator('.quiz-box').count()); i++) {   // drop pieces until ammo runs out,
    for (let k = 0; k < i % 4 * 2; k++) await page.keyboard.press(i % 2 ? 'ArrowLeft' : 'ArrowRight');   // spread out so the stack doesn't top out
    await page.keyboard.press(' ');
    await page.waitForTimeout(30);
  }
  await expect(page.locator('.quiz-box')).toBeVisible();
  expect(await page.locator('.quiz-box').evaluate(el => getComputedStyle(el).fontFamily)).not.toContain('Pixelify');
  expect(await page.locator('.hud').evaluate(el => getComputedStyle(el).fontFamily)).toContain('Pixelify');
  expect(errors).toEqual([]);
});

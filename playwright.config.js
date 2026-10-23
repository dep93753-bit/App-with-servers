// Automatic browser tests: `npm test` locally, and GitHub runs them on every pull request.
const { defineConfig, devices } = require('@playwright/test');

const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {};

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  // reducedMotion: the loading screen then only shows briefly, so tests don't wait on the animation
  use: { baseURL: 'http://localhost:8766', trace: 'retain-on-failure', reducedMotion: 'reduce' },
  webServer: { command: 'python3 -m http.server 8766', stdout: 'ignore', stderr: 'ignore', url: 'http://localhost:8766/index.html', reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 }, launchOptions } },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium', launchOptions } }
  ]
});

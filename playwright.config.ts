import { defineConfig } from '@playwright/test';
import { resolve } from 'path';

/**
 * E2E tests against the production build (dist/) served by PHP's built-in server.
 * Run with `npm run e2e` (builds first). Data lives in e2e/.data and is wiped on every start.
 * PHP runs with several workers so parallel requests really hit the file lock concurrently.
 * "Today" is pinned to 2026-12-08, so doors 1–8 are open.
 */
const PORT = 8095;
const DATA_DIR = resolve(__dirname, 'e2e/.data');

export default defineConfig({
  testDir: 'e2e',
  // Tests share one backend and its settings, so run them one after another
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: {timeout: 15_000},
  reporter: process.env.CI ? [['list'], ['html', {open: 'never'}]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'off',
  },
  webServer: {
    command: `rm -rf '${DATA_DIR}' && mkdir -p '${DATA_DIR}' && php -S 127.0.0.1:${PORT} -t dist/santa-dice`,
    url: `http://127.0.0.1:${PORT}/api.php?action=calendar`,
    reuseExistingServer: false,
    env: {PHP_CLI_SERVER_WORKERS: '8', DATA_DIR, ADMIN_TOKEN: 'e2e-admin', FAKE_TODAY: '2026-12-08'},
  },
});

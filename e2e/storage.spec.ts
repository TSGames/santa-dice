import { expect, test } from '@playwright/test';
import { ChildProcess, spawn } from 'child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/** Own PHP server on a separate data dir, so the legacy migration can be tested from scratch. */
const PORT = 8096;
let server: ChildProcess;
let dataDir: string;

test.beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'santa-storage-'));
  writeFileSync(join(dataDir, 'data.json'), readFileSync(resolve(__dirname, '../dev/seed.json')));
  server = spawn('php', ['-S', `127.0.0.1:${PORT}`, '-t', resolve(__dirname, '../dist/santa-dice')], {
    env: {...process.env, DATA_DIR: dataDir, ADMIN_TOKEN: 'storage-admin', FAKE_TODAY: '2026-12-08'},
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      await fetch(`http://127.0.0.1:${PORT}/api.php?action=image&id=x`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('PHP server did not start');
});

test.afterAll(() => {
  server?.kill();
  rmSync(dataDir, {recursive: true, force: true});
});

test('legacy data.json is split into settings, items and days on first request', async ({request}) => {
  const seed = JSON.parse(readFileSync(resolve(__dirname, '../dev/seed.json'), 'utf8'));
  const res = await request.get(`http://127.0.0.1:${PORT}/api.php?action=calendar`);
  expect(res.ok()).toBe(true);

  expect(existsSync(join(dataDir, 'data.json'))).toBe(false);
  expect(existsSync(join(dataDir, 'data.json.migrated'))).toBe(true);
  const items = JSON.parse(readFileSync(join(dataDir, 'items.json'), 'utf8'));
  const days = JSON.parse(readFileSync(join(dataDir, 'days.json'), 'utf8'));
  const settings = JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'));
  expect(items).toEqual(seed.items);
  expect(Object.keys(days)).toEqual(Object.keys(seed.days));
  expect(Array.isArray(settings) || typeof settings === 'object').toBe(true);

  // The calendar is the same as before the split
  const calendar = await res.json();
  expect(calendar.days.find((d: any) => d.day === 1).winner).toBe(seed.days['1'].winner);
});

test('a roll writes only days.json and leaves no temp files', async ({request}) => {
  const before = {
    items: readFileSync(join(dataDir, 'items.json'), 'utf8'),
    settings: readFileSync(join(dataDir, 'settings.json'), 'utf8'),
  };
  const base = `http://127.0.0.1:${PORT}/api.php`;
  await request.post(`${base}?action=join`, {data: {day: 8, name: 'Speichertest'}});
  const res = await request.post(`${base}?action=roll`, {data: {day: 8, name: 'Speichertest'}});
  expect(res.ok()).toBe(true);

  expect(readFileSync(join(dataDir, 'items.json'), 'utf8')).toBe(before.items);
  expect(readFileSync(join(dataDir, 'settings.json'), 'utf8')).toBe(before.settings);
  const days = JSON.parse(readFileSync(join(dataDir, 'days.json'), 'utf8'));
  expect(days['8'].rounds[0].rolls['Speichertest']).toHaveLength(2);
  expect(readdirSync(dataDir).filter((f) => f.endsWith('.tmp'))).toEqual([]);

  // Admin setting goes to settings.json
  await request.post(`${base}?action=open-until`, {data: {value: 4}, headers: {'X-Admin-Token': 'storage-admin'}});
  expect(JSON.parse(readFileSync(join(dataDir, 'settings.json'), 'utf8'))).toEqual({openUntil: 4});
});

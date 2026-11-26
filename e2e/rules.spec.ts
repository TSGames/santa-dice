import { expect, test } from '@playwright/test';
import { api, apiStatus, calendarDay, newUser } from './helpers';

test('admin override limits open doors on the server and in the calendar', async ({browser, request}) => {
  try {
    const {openUntil} = await api(request, 'open-until', {value: 3}, true);
    expect(openUntil).toBe(3);
    expect((await calendarDay(request, 4)).open).toBe(false);
    expect((await apiStatus(request, 'join', {day: 5, name: 'Früh'})).body.error).toBe('door not open yet');

    const {context, page} = await newUser(browser);
    await page.goto('/#/tuer/5');
    await expect(page.getByText('Dieses Türchen ist noch geschlossen.')).toBeVisible();
    await context.close();

    // Admin page shows the manual setting
    const admin = await newUser(browser, {admin: true});
    await admin.page.goto('/#/admin');
    await expect(admin.page.getByText('Geöffnete Türchen')).toBeVisible();
    await expect(admin.page.getByText('Manuell festgelegt.')).toBeVisible();
    await admin.page.locator('select').first().selectOption('auto');
    await expect(admin.page.getByText('Manuell festgelegt.')).toHaveCount(0);
    await admin.context.close();

    expect((await calendarDay(request, 8)).open).toBe(true);
    expect((await calendarDay(request, 9)).open).toBe(false);
  } finally {
    await api(request, 'open-until', {value: null}, true);
  }
});

test('admin actions need the token', async ({request}) => {
  for (const action of ['close', 'winner', 'tiebreak', 'reveal', 'day-reset', 'open-until', 'items', 'item-save', 'assign']) {
    const {status, body} = await apiStatus(request, action, {day: 6, value: 1, title: 'x'});
    expect(status, action).toBe(403);
    expect(body.error).toBe('admin token required');
  }
});

test('closed round rejects joins and rolls of non-players', async ({request}) => {
  const day = 6;
  await api(request, 'join', {day, name: 'Anna'});
  await api(request, 'join', {day, name: 'Ben'});
  await api(request, 'close', {day}, true);
  expect((await apiStatus(request, 'join', {day, name: 'Carla'})).body.error).toBe('round already closed');
  expect((await apiStatus(request, 'roll', {day, name: 'Anna'})).body.error).toBe('round closed');
  expect((await apiStatus(request, 'roll', {day: 7, name: 'Niemand'})).body.error).toBe('not a player in this round');

  // Reset brings the door back to a clean state
  await api(request, 'day-reset', {day}, true);
  const d = await calendarDay(request, day);
  expect(d.participants).toEqual([]);
});

test('uploads above 500 KB are rejected', async ({request}) => {
  const {id} = await api(request, 'item-save', {title: 'Großes Bild'}, true);
  const res = await request.post(`/api.php?action=upload&id=${id}`, {
    headers: {'X-Admin-Token': 'e2e-admin'},
    multipart: {image: {name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(600 * 1024, 1)}},
  });
  expect(res.status()).toBe(413);
});

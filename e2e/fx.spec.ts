import { expect, test } from '@playwright/test';
import { api, calendarDay, newUser } from './helpers';

/**
 * WebGL effects are optional. Headless Chromium renders WebGL in software, so by default the
 * effects switch themselves off: that is the fallback for everyone without (fast) WebGL.
 * With localStorage "fx" = "on" they are forced on to check they work and keep the result correct.
 */
const DAY = 7;

test('without fast WebGL the plain fallback is used', async ({browser}) => {
  const {context, page} = await newUser(browser);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/#/');
  await expect(page.locator('.door').first()).toBeVisible();
  await expect(page.locator('app-aurora, app-frost, app-tree, app-lights, app-deep-snow')).toHaveCount(0);
  await expect(page.locator('svg.deco')).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});

test('forced on: aurora, snow layers, lights, frost and tree render, shooting stars can be caught, 3D dice land on the server result', async ({browser, request}) => {
  const name = 'Effekt';
  await api(request, 'join', {day: DAY, name});
  const context = await browser.newContext();
  await context.addInitScript((n) => {
    localStorage.setItem('fx', 'on');
    localStorage.setItem('name', n);
  }, name);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.text().startsWith('WebGL-Effekte aus') && errors.push(m.text()));

  await page.goto('/#/');
  await expect(page.locator('app-aurora canvas')).toHaveCount(1);
  await expect(page.locator('app-frost canvas')).toHaveCount(1);
  await expect(page.locator('app-tree canvas')).toHaveCount(1);

  await expect(page.locator('app-deep-snow canvas')).toHaveCount(2);
  await expect(page.locator('app-lights canvas')).toHaveCount(1);

  // Shooting stars: probe the sky with clicks until one is caught
  const caught = page.getByText('Sternschnuppe gefangen!');
  await expect(async () => {
    await page.evaluate(() => {
      for (let x = 20; x < innerWidth; x += 50) {
        for (let y = 10; y < innerHeight * .55; y += 50) {
          window.dispatchEvent(new PointerEvent('pointerdown', {clientX: x, clientY: y}));
        }
      }
    });
    await expect(caught).toBeVisible({timeout: 200});
  }).toPass({timeout: 25_000, intervals: [100]});

  await page.goto(`/#/tuer/${DAY}`);
  await expect(page.locator('app-dice-3d canvas')).toBeVisible();
  await page.getByRole('button', {name: 'Würfeln!'}).click();
  await expect(page.locator('section.mine.done')).toBeVisible({timeout: 20_000});
  const roll = (await calendarDay(request, DAY)).rounds[0].rolls[name];
  await expect(page.locator('section.mine.done .sum')).toHaveText(String(roll[0] + roll[1]));

  expect(errors).toEqual([]);
  await context.close();
});

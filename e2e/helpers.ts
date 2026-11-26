import { APIRequestContext, Browser, BrowserContext, expect, Page } from '@playwright/test';

export const ADMIN_TOKEN = 'e2e-admin';

/** Calls the backend directly. Throws with the server's error message on failure. */
export async function api(request: APIRequestContext, action: string, body: object = {}, admin = false) {
  const res = await request.post(`/api.php?action=${action}`, {
    data: body,
    headers: admin ? {'X-Admin-Token': ADMIN_TOKEN} : {},
  });
  const json = await res.json();
  if (!res.ok()) {
    throw new Error(`${action}: ${res.status()} ${json.error}`);
  }
  return json;
}

/** Same as api(), but returns the HTTP status and error instead of throwing. */
export async function apiStatus(request: APIRequestContext, action: string, body: object = {}, admin = false) {
  const res = await request.post(`/api.php?action=${action}`, {
    data: body,
    headers: admin ? {'X-Admin-Token': ADMIN_TOKEN} : {},
  });
  return {status: res.status(), body: await res.json()};
}

export async function calendarDay(request: APIRequestContext, day: number, admin = false) {
  const res = await request.get('/api.php?action=calendar', {headers: admin ? {'X-Admin-Token': ADMIN_TOKEN} : {}});
  const calendar = await res.json();
  return calendar.days.find((d: any) => d.day === day);
}

/** Creates prize items as admin and returns their ids. */
export async function createItems(request: APIRequestContext, titles: string[]) {
  const ids: string[] = [];
  for (const title of titles) {
    const {id} = await api(request, 'item-save', {title, description: `Beschreibung ${title}`, link: 'https://example.com'}, true);
    ids.push(id);
  }
  return ids;
}

/** Browser context with a name (participant) or admin token preset in localStorage. */
export async function newUser(browser: Browser, opts: { name?: string, admin?: boolean } = {}) {
  const context = await browser.newContext();
  await context.addInitScript(([name, token]) => {
    if (name) localStorage.setItem('name', name);
    if (token) localStorage.setItem('adminToken', token);
  }, [opts.name || '', opts.admin ? ADMIN_TOKEN : '']);
  const page = await context.newPage();
  return {context, page};
}

export async function closeAll(contexts: BrowserContext[]) {
  await Promise.all(contexts.map((c) => c.close()));
}

/** Joins via the door page form. */
export async function joinViaUi(page: Page, day: number, name: string) {
  await page.goto(`/#/tuer/${day}`);
  await page.locator('input[name=name]').fill(name);
  await page.getByRole('button', {name: 'Eintragen'}).click();
  await expect(page.getByRole('button', {name: 'Würfeln!'})).toBeVisible();
}

/** Rolls via the door page and waits until the own result is shown. */
export async function rollViaUi(page: Page) {
  await page.getByRole('button', {name: 'Würfeln!'}).click();
  await expect(page.locator('section.mine.done')).toBeVisible();
}

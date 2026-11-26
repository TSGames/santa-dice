import { expect, Page, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { api, apiStatus, calendarDay, closeAll, createItems, joinViaUi, newUser, rollViaUi } from './helpers';

/**
 * Full flow in the browser with 10 participants in their own browser contexts at the same time,
 * plus one spectator and one admin: join, roll, tiebreak, winner, reveal, pick for the next door.
 */
const PLAYERS = Array.from({length: 10}, (_, i) => `Gast ${i + 1}`);
const DAY = 2;

test('10 participants in parallel browsers through the whole door flow', async ({browser, request}) => {
  const [prize, nextPrize] = await createItems(request, ['UI-Preis', 'UI-Nachfolger', 'UI-Reserve']);
  await api(request, 'assign', {day: DAY, itemId: prize}, true);

  const users = await Promise.all(PLAYERS.map((name) => newUser(browser, {name})));
  const spectator = await newUser(browser);
  const admin = await newUser(browser, {admin: true});
  const pages = new Map<string, Page>(PLAYERS.map((name, i) => [name, users[i].page]));

  try {
    await spectator.page.goto(`/#/tuer/${DAY}`);
    await admin.page.goto(`/#/tuer/${DAY}`);
    await expect(spectator.page.locator('h1')).toHaveText(`Türchen ${DAY}`);

    // Prize stays wrapped for everyone, the admin sees a preview
    await expect(spectator.page.getByText('Was ist wohl drin?')).toBeVisible();
    await expect(admin.page.getByText('Nur für Admin sichtbar: hinterlegt ist „UI-Preis“.')).toBeVisible();

    // All 10 join at the same time
    await Promise.all(PLAYERS.map((name) => joinViaUi(pages.get(name)!, DAY, name)));
    await expect(spectator.page.locator('ul.pending li')).toHaveCount(10);

    // Spectator watches: rolls of others show up as live dice
    const liveSeen = spectator.page.locator('section.live').waitFor({state: 'visible', timeout: 30_000});

    // All 10 roll at the same time
    await Promise.all(PLAYERS.map((name) => rollViaUi(pages.get(name)!)));
    await liveSeen;

    // Spectator ends up with all 10 rolls in the ranking (after the live animations)
    const firstRanking = spectator.page.locator('section.list ol.ranking').last();
    await expect(firstRanking.locator('li.row')).toHaveCount(10, {timeout: 30_000});
    let d = await calendarDay(request, DAY);
    expect(Object.keys(d.rounds[0].rolls)).toHaveLength(10);
    expect(d.roundComplete).toBe(true);

    // Each player sees their own result with the correct sum
    for (const name of PLAYERS) {
      const roll = d.rounds[0].rolls[name];
      await expect(pages.get(name)!.locator('section.mine.done .sum')).toHaveText(String(roll[0] + roll[1]));
    }

    // Tiebreak rounds via the admin buttons until one leader is left
    for (let i = 0; d.leaders.length > 1; i++) {
      expect(i).toBeLessThan(20);
      const tied: string[] = d.leaders;
      await expect(admin.page.locator('.tie-banner')).toBeVisible();
      await admin.page.getByRole('button', {name: 'Stechen starten'}).click();
      await Promise.all(tied.map(async (name) => {
        const page = pages.get(name)!;
        await expect(page.getByText('Stechen – du bist dran')).toBeVisible();
        await rollViaUi(page);
      }));
      const outsider = PLAYERS.find((p) => !tied.includes(p))!;
      await expect(pages.get(outsider)!.getByRole('button', {name: 'Würfeln!'})).toHaveCount(0);
      d = await calendarDay(request, DAY);
    }

    // Admin sets the winner, everyone sees it
    const leader = d.leaders[0];
    await admin.page.getByRole('button', {name: `Gewinner*in festlegen: ${leader}`}).click();
    await expect(spectator.page.getByText(`Gewonnen von ${leader}`)).toBeVisible();
    const winnerPage = pages.get(leader)!;
    await expect(winnerPage.getByText(`Gewonnen von ${leader}`)).toBeVisible();
    await expect(winnerPage.getByText('Du darfst auswählen!')).toHaveCount(0);

    // Reveal: spectator watching live gets the animation, the prize shows up everywhere
    await admin.page.getByRole('button', {name: 'Preis freigeben'}).click();
    await expect(spectator.page.locator('section.prize.revealing')).toBeVisible();
    await expect(spectator.page.locator('.prize-content h2')).toHaveText('UI-Preis');
    await expect(pages.get(PLAYERS.find((p) => p !== leader)!)!.locator('.prize-content h2')).toHaveText('UI-Preis');

    // Winner picks the prize for the next door without a prize
    await expect(winnerPage.getByText('Du darfst auswählen!')).toBeVisible();
    await winnerPage.locator('.pick-item', {hasText: 'UI-Nachfolger'}).click();
    await winnerPage.getByRole('button', {name: /„UI-Nachfolger“ für Türchen \d+ wählen/}).click();
    d = await calendarDay(request, DAY);
    expect(d.pickedFor).toBeGreaterThan(DAY);
    await expect(spectator.page.getByText(`${leader} hat den Preis für Türchen ${d.pickedFor} ausgewählt.`)).toBeVisible();
    const {items} = await api(request, 'items', {}, true);
    expect(items.find((i: any) => i.id === nextPrize).assignedDay).toBe(d.pickedFor);

    // Late join is rejected
    expect((await apiStatus(request, 'join', {day: DAY, name: 'Zu spät'})).body.error).toBe('door already decided');
  } finally {
    await closeAll([...users.map((u) => u.context), spectator.context, admin.context]);
  }
});

test('tiebreak in the browser with a fixed tie', async ({browser, request}) => {
  const day = 3;
  // Prepare a tie at the top directly in days.json (the server reads it on every request)
  const file = resolve(__dirname, '.data/days.json');
  const days = JSON.parse(readFileSync(file, 'utf8'));
  days[String(day)] = {
    ...days[String(day)],
    participants: ['Anna', 'Ben', 'Carla'],
    rounds: [{players: ['Anna', 'Ben', 'Carla'], rolls: {Anna: [6, 6], Ben: [6, 6], Carla: [1, 2]}, closed: false}],
    winner: null, revealed: false, pickedFor: null,
  };
  writeFileSync(file, JSON.stringify(days));

  const players = await Promise.all(['Anna', 'Ben', 'Carla'].map((name) => newUser(browser, {name})));
  const [anna, ben, carla] = players.map((p) => p.page);
  const admin = await newUser(browser, {admin: true});
  try {
    await Promise.all([...players.map((p) => p.page), admin.page].map((page) => page.goto(`/#/tuer/${day}`)));
    await expect(anna.getByText('Gleichstand an der Spitze: Anna, Ben – Stechen!')).toBeVisible();
    await expect(admin.page.getByRole('button', {name: /Gewinner\*in festlegen/})).toBeDisabled();

    let d = await calendarDay(request, day);
    for (let i = 0; d.leaders.length > 1; i++) {
      expect(i).toBeLessThan(20);
      await admin.page.getByRole('button', {name: 'Stechen starten'}).click();
      await expect(carla.getByText('Stechen 1')).toBeVisible();
      await expect(carla.getByRole('button', {name: 'Würfeln!'})).toHaveCount(0);
      await Promise.all([anna, ben].map(async (page) => {
        await expect(page.getByText('Stechen – du bist dran')).toBeVisible();
        await rollViaUi(page);
      }));
      d = await calendarDay(request, day);
    }
    expect(d.rounds.length).toBeGreaterThan(1);
    expect(['Anna', 'Ben']).toContain(d.leaders[0]);
    await admin.page.getByRole('button', {name: `Gewinner*in festlegen: ${d.leaders[0]}`}).click();
    await expect(carla.getByText(`Gewonnen von ${d.leaders[0]}`)).toBeVisible();
  } finally {
    await closeAll([...players.map((p) => p.context), admin.context]);
  }
});

import { expect, test } from '@playwright/test';
import { api, apiStatus, calendarDay, createItems } from './helpers';

/**
 * Concurrency against the backend: 10 participants send their requests at the same time.
 * The server serializes writes with flock, so no join or roll may get lost or counted twice.
 */
const PLAYERS = Array.from({length: 10}, (_, i) => `Spieler ${i + 1}`);

test('10 parallel joins and rolls, tiebreaks until a unique winner, single pick', async ({request}) => {
  const day = 1;
  const [prize, next] = await createItems(request, ['API-Preis', 'API-Nachfolger']);
  await api(request, 'assign', {day, itemId: prize}, true);

  await Promise.all(PLAYERS.map((name) => api(request, 'join', {day, name})));
  let d = await calendarDay(request, day);
  expect(d.participants).toHaveLength(10);
  expect([...d.participants].sort()).toEqual([...PLAYERS].sort());
  expect(d.rounds[0].players).toHaveLength(10);

  // Every player fires two rolls at once: exactly one per player may succeed
  const results = await Promise.all(PLAYERS.flatMap((name) => [
    apiStatus(request, 'roll', {day, name}),
    apiStatus(request, 'roll', {day, name}),
  ]));
  expect(results.filter((r) => r.status === 200)).toHaveLength(10);
  const rejected = results.filter((r) => r.status !== 200);
  expect(rejected).toHaveLength(10);
  rejected.forEach((r) => expect(r.body.error).toBe('already rolled'));

  d = await calendarDay(request, day);
  const rolls = d.rounds[0].rolls;
  expect(Object.keys(rolls)).toHaveLength(10);
  for (const roll of Object.values<number[]>(rolls)) {
    expect(roll).toHaveLength(2);
    roll.forEach((n) => expect(n).toBeGreaterThanOrEqual(1));
    roll.forEach((n) => expect(n).toBeLessThanOrEqual(6));
  }
  expect(d.roundComplete).toBe(true);

  // Tiebreak rounds until one leader is left; only the tied players may roll
  for (let i = 0; d.leaders.length > 1; i++) {
    expect(i).toBeLessThan(20);
    const tied: string[] = d.leaders;
    expect((await apiStatus(request, 'winner', {day}, true)).body.error).toBe('no unique leader');
    await api(request, 'tiebreak', {day}, true);
    const outsider = PLAYERS.find((p) => !tied.includes(p))!;
    expect((await apiStatus(request, 'roll', {day, name: outsider})).body.error).toBe('not a player in this round');
    await Promise.all(tied.map((name) => api(request, 'roll', {day, name})));
    d = await calendarDay(request, day);
    expect(d.rounds[d.rounds.length - 1].players.sort()).toEqual([...tied].sort());
  }
  expect((await apiStatus(request, 'tiebreak', {day}, true)).body.error).toBe('no tie at the top');

  await api(request, 'winner', {day}, true);
  d = await calendarDay(request, day);
  const winner = d.winner;
  expect(PLAYERS).toContain(winner);
  expect(d.item).toBeNull();
  expect(d.hasItem).toBe(true);

  // Pick only after reveal and only by the winner
  expect((await apiStatus(request, 'pick', {day, name: winner, itemId: next})).body.error).toBe('prize not revealed yet');
  await api(request, 'reveal', {day}, true);
  d = await calendarDay(request, day);
  expect(d.item.title).toBe('API-Preis');
  const loser = PLAYERS.find((p) => p !== winner)!;
  expect((await apiStatus(request, 'pick', {day, name: loser, itemId: next})).status).toBe(403);

  // Winner picks three times at once: exactly one pick succeeds
  const picks = await Promise.all([1, 2, 3].map(() => apiStatus(request, 'pick', {day, name: winner, itemId: next})));
  expect(picks.filter((p) => p.status === 200)).toHaveLength(1);
  d = await calendarDay(request, day);
  expect(d.pickedFor).toBeGreaterThan(day);
  const {items} = await api(request, 'items', {}, true);
  expect(items.find((i: any) => i.id === next).assignedDay).toBe(d.pickedFor);

  // Rolling or joining a decided door is rejected
  expect((await apiStatus(request, 'join', {day, name: 'Nachzügler'})).body.error).toBe('door already decided');
  expect((await apiStatus(request, 'roll', {day, name: winner})).body.error).toBe('door already decided');
});

test('parallel joins with the same name count once', async ({request}) => {
  const day = 4;
  await Promise.all(Array.from({length: 10}, () => api(request, 'join', {day, name: 'Doppelt'})));
  const d = await calendarDay(request, day);
  expect(d.participants).toEqual(['Doppelt']);
  expect(d.rounds[0].players).toEqual(['Doppelt']);
});

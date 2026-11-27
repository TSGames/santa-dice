import { Component, OnDestroy } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { combineLatest, Subscription } from 'rxjs';
import { ApiService, Calendar, Day, Item, Round } from '../api.service';
import { LAND_MS } from '../die.component';
import { SnowService } from '../snow.service';

export interface RankedRoll {
  name: string;
  roll: number[];
  total: number;
  rank: number;
  tie: boolean;
}

interface RoundView {
  index: number;
  players: string[];
  ranking: RankedRoll[];
  waiting: string[];
  closed: boolean;
}

/** Wurf einer anderen Person, der gerade live animiert wird. */
interface LiveRoll {
  key: string;
  name: string;
  roll: number[];
  /** Startet erst nach dem ersten Rendern, damit der Würfel den Wechsel mitbekommt. */
  rolling: boolean;
  /** null, solange die Würfel noch wirbeln. */
  shown: number[] | null;
}

/** So lange wirbeln die Würfel bei Würfen anderer, bevor sie landen. */
const LIVE_TUMBLE_MS = 1100;
/** So lange bleibt das Ergebnis nach der Landung stehen, bevor es in die Rangliste wandert. */
const LIVE_HOLD_MS = 1600;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Component({
  selector: 'app-door',
  templateUrl: './door.component.html',
  styleUrls: ['./door.component.scss'],
})
export class DoorComponent implements OnDestroy {
  calendar: Calendar | null = null;
  day: Day | null = null;
  rounds: RoundView[] = [];
  current: RoundView | null = null;

  nameInput = '';
  error: string | null = null;
  busy = false;

  /** Würfeln läuft: Würfel wirbeln, bis myRoll gesetzt ist, dann landen sie. */
  isDicing = false;
  myRoll: number[] | null = null;
  shownSum: number | null = null;

  available: Item[] | null = null;
  selectedItem: Item | null = null;

  /** Würfe anderer, die gerade live gezeigt werden. */
  liveRolls: LiveRoll[] = [];
  /** Bereits bekannte Würfe als "tag:runde:name"; null = noch nicht initialisiert. */
  private knownRolls: Set<string> | null = null;
  private knownDay: number | null = null;
  private liveTimers: any[] = [];

  confetti: { x: number, delay: number, duration: number, color: string, rotate: number }[] = [];
  /** Enthüllungs-Animation läuft (nur wenn die Freigabe live beobachtet wird). */
  revealing = false;
  private seen: { day: number, revealed: boolean } | null = null;
  private sub: Subscription;

  constructor(public api: ApiService, route: ActivatedRoute, private snow: SnowService) {
    this.nameInput = api.name;
    this.sub = combineLatest([route.paramMap, api.calendar$]).subscribe(([params, calendar]) => {
      const dayNumber = Number(params.get('day'));
      this.calendar = calendar;
      this.update(calendar?.days.find((d) => d.day === dayNumber) || null);
    });
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.liveTimers.forEach(clearTimeout);
  }

  get me() {
    return this.api.name;
  }

  get decided() {
    return !!this.day?.winner;
  }

  get joined() {
    return !!this.me && !!this.day?.participants?.includes(this.me);
  }

  get canJoin() {
    const d = this.day;
    return !!d?.open && !d.winner && d.rounds?.length === 1 && !d.rounds[0].closed && !this.joined;
  }

  get canRoll() {
    const r = this.current;
    return !this.decided && !!r && !r.closed && r.players.includes(this.me) && !this.myCurrentRoll;
  }

  get myCurrentRoll(): RankedRoll | undefined {
    return this.current?.ranking.find((r) => r.name === this.me);
  }

  get isTiebreak() {
    return (this.day?.rounds?.length || 0) > 1;
  }

  get isWinner() {
    return !!this.me && this.day?.winner === this.me;
  }

  // --- Aktionen ------------------------------------------------------------

  async join() {
    const name = this.nameInput.trim();
    if (!name || !this.day) {
      return;
    }
    await this.run(async () => {
      this.api.name = name;
      await this.api.join(this.day!.day, name);
    });
  }

  switchName() {
    this.api.name = '';
    this.nameInput = '';
    this.update(this.day);
  }

  async roll() {
    if (this.isDicing || !this.day) {
      return;
    }
    this.error = null;
    this.isDicing = true;
    this.snow.boost(3000);
    this.myRoll = null;
    this.shownSum = null;
    const started = Date.now();
    try {
      const {roll} = await this.api.roll(this.day.day, this.me);
      await sleep(Math.max(0, 1600 - (Date.now() - started)));
      this.myRoll = roll;
      await sleep(LAND_MS + 250);
      this.isDicing = false;
      this.myRoll = null;
      await this.api.refresh();
      this.update(this.day);
      this.countUp(roll[0] + roll[1]);
    } catch (e) {
      this.isDicing = false;
      this.myRoll = null;
      this.error = (e as Error).message;
    }
  }

  async loadAvailable() {
    this.available = await this.api.available();
  }

  async pick() {
    if (!this.selectedItem || !this.day) {
      return;
    }
    await this.run(() => this.api.pick(this.day!.day, this.me, this.selectedItem!.id));
  }

  async admin(action: 'close' | 'winner' | 'tiebreak' | 'reveal' | 'day-reset') {
    if (action === 'day-reset' && !confirm('Alle Teilnahmen und Würfe dieses Türchens löschen?')) {
      return;
    }
    await this.run(() => this.api.adminAction(action, this.day!.day));
  }

  trackByName(_: number, r: { name: string } | string) {
    return typeof r === 'string' ? r : r.name;
  }

  trackByKey(_: number, r: LiveRoll) {
    return r.key;
  }

  trackByIndex(i: number) {
    return i;
  }

  trackById(_: number, i: Item) {
    return i.id;
  }

  // --- intern --------------------------------------------------------------

  private async run(fn: () => Promise<unknown>) {
    this.error = null;
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }

  private update(day: Day | null) {
    this.day = day;
    this.detectLiveRolls(day);
    this.rounds = (day?.rounds || []).map((r, i) => this.roundView(r, i));
    this.current = this.rounds[this.rounds.length - 1] || null;
    if (day?.winner && this.isWinner && day.pickTarget && !this.available) {
      this.loadAvailable();
    }
    // Enthüllung nur animieren, wenn die Freigabe live passiert, nicht beim Öffnen eines alten Türchens
    if (day && this.seen?.day === day.day && !this.seen.revealed && day.revealed) {
      this.playReveal();
    }
    this.seen = day ? {day: day.day, revealed: !!day.revealed} : null;
  }

  /**
   * Neue Würfe anderer seit dem letzten Polling erkennen und live animieren.
   * Beim ersten Laden eines Türchens wird nichts animiert, nur der Stand gemerkt.
   */
  private detectLiveRolls(day: Day | null) {
    if (!day?.rounds) {
      return;
    }
    if (this.knownDay !== day.day) {
      this.knownDay = day.day;
      this.knownRolls = null;
      this.liveRolls = [];
    }
    const keys = new Map<string, { name: string, roll: number[] }>();
    day.rounds.forEach((round, i) => Object.entries(round.rolls)
      .forEach(([name, roll]) => keys.set(`${day.day}:${i}:${name}`, {name, roll})));
    if (this.knownRolls) {
      keys.forEach(({name, roll}, key) => {
        if (!this.knownRolls!.has(key) && name !== this.me) {
          this.playLiveRoll(key, name, roll);
        }
      });
    }
    this.knownRolls = new Set(keys.keys());
  }

  private playLiveRoll(key: string, name: string, roll: number[]) {
    const live: LiveRoll = {key, name, roll, rolling: false, shown: null};
    this.snow.boost(2000);
    this.liveRolls = [...this.liveRolls, live];
    this.liveTimers.push(setTimeout(() => live.rolling = true, 30));
    this.liveTimers.push(setTimeout(() => live.shown = roll, LIVE_TUMBLE_MS));
    this.liveTimers.push(setTimeout(() => {
      this.liveRolls = this.liveRolls.filter((r) => r !== live);
      // Rangliste neu aufbauen, damit der Wurf dort erscheint
      this.rounds = (this.day?.rounds || []).map((r, i) => this.roundView(r, i));
      this.current = this.rounds[this.rounds.length - 1] || null;
    }, LIVE_TUMBLE_MS + LAND_MS + LIVE_HOLD_MS));
  }

  private roundView(round: Round, index: number): RoundView {
    const hideMine = this.isDicing;
    const live = new Set(this.liveRolls.filter((r) => r.key.endsWith(`:${index}:${r.name}`)).map((r) => r.name));
    const rolls = Object.entries(round.rolls)
      .filter(([name]) => !(hideMine && name === this.me))
      .filter(([name]) => !live.has(name))
      .map(([name, roll]) => ({name, roll, total: roll[0] + roll[1], rank: 0, tie: false}))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    rolls.forEach((r, i) => r.rank = i > 0 && rolls[i - 1].total === r.total ? rolls[i - 1].rank : i + 1);
    rolls.forEach((r) => r.tie = rolls.filter((o) => o.total === r.total).length > 1);
    const rolled = new Set(rolls.map((r) => r.name));
    return {
      index,
      players: round.players,
      ranking: rolls,
      waiting: round.players.filter((p) => !rolled.has(p)),
      closed: round.closed,
    };
  }

  private countUp(total: number) {
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 600);
      this.shownSum = Math.round(total * (1 - Math.pow(1 - p, 3)));
      p < 1 ? requestAnimationFrame(tick) : setTimeout(() => this.shownSum = null, 50);
    };
    requestAnimationFrame(tick);
  }

  private playReveal() {
    this.revealing = true;
    setTimeout(() => this.celebrate(), 1300);
    setTimeout(() => this.revealing = false, 4200);
  }

  private celebrate() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const colors = ['#4f8069', '#d4a64a', '#0d5266', '#10372f', '#e9c98c', '#fbf7ee'];
    this.confetti = Array.from({length: 90}, () => ({
      x: Math.random() * 100,
      delay: Math.random() * 400,
      duration: 1800 + Math.random() * 1400,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotate: Math.random() * 720 - 360,
    }));
    setTimeout(() => this.confetti = [], 3600);
  }
}

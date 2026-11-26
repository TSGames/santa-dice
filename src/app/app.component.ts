import { ApplicationRef, Component, NgZone } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import {environment} from '../environments/environment';
import {ActivatedRoute} from '@angular/router';
import {LAND_MS} from './die.component';

export type Mode = 'names' | 'topics';

const TEXTS = {
  names: {
    title: 'Wichteln & Würfeln',
    joinTitle: 'Mitmachen!',
    joinHint: 'Trag deinen Namen ein und würfle mit zwei Würfeln. Die höchste Augensumme gewinnt.',
    label: 'Dein Name',
    join: 'Eintragen',
    rollTitle: 'Du bist dran',
    resultTitle: 'Dein Ergebnis',
    rankingTitle: 'Rangliste',
    progress: (diced: number, total: number) => `${diced} von ${total} haben gewürfelt`,
    pendingTitle: 'Noch nicht gewürfelt',
    empty: 'Noch niemand dabei. Sei die erste Person!',
    switch: 'Anderer Name',
  },
  topics: {
    title: 'Themen auswürfeln',
    joinTitle: 'Thema vorschlagen',
    joinHint: 'Schlag ein Thema vor und würfle dafür. Das Thema mit der höchsten Augensumme kommt zuerst dran.',
    label: 'Dein Themenvorschlag',
    join: 'Vorschlagen',
    rollTitle: 'Würfle für dein Thema',
    resultTitle: 'Ergebnis für dein Thema',
    rankingTitle: 'Themen-Reihenfolge',
    progress: (diced: number, total: number) => `${diced} von ${total} Themen ausgewürfelt`,
    pendingTitle: 'Noch nicht ausgewürfelt',
    empty: 'Noch kein Thema vorgeschlagen.',
    switch: 'Anderes Thema',
  },
};

export interface RankedDice extends Dice {
  rank: number;
  total: number;
  tie: boolean;
}

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  constructor(private http: HttpClient, private ngZone: NgZone, private ref: ApplicationRef, private route: ActivatedRoute) {
    this.route.queryParams.subscribe((params) => {
      this.mode = params.mode === 'topics' ? 'topics' : 'names';
      document.title = this.t.title;
    });
    this.name = localStorage.getItem('name');
    setInterval(() => this.updateList(), 1000);
    this.updateList();
    this.renderSnow();
  }

  static API_URL = 'api.php';
  snowCount = 500;
  snow: any = [];
  adminName = environment.adminName;
  name: string;
  isAdded = false;
  dices: Dice[];
  isDicing = false;
  mode: Mode = 'names';
  /** Server result for the roll in progress; dice land on it. */
  myRoll: number[] | null = null;
  /** Animated sum shown right after landing. */
  shownSum: number | null = null;
  confetti: { x: number, delay: number, duration: number, color: string, rotate: number }[] = [];

  get t() {
    return TEXTS[this.mode];
  }

  get isAdmin() {
    return !!this.name && this.name === this.adminName;
  }

  /** 'join' → enter name, 'roll' → own dice pending/rolling, 'result' → own dice done */
  get state(): 'join' | 'roll' | 'result' {
    const mine = this.getMyDice();
    if (!this.isAdded || !mine || this.isAdmin) {
      return 'join';
    }
    return mine.number && !this.isDicing ? 'result' : 'roll';
  }

  private rankingCache: { dices: Dice[], dicing: boolean, name: string, result: RankedDice[] };

  /** Diced entries sorted by sum, competition ranking (1, 1, 3). Own roll in progress is excluded. Cached so ngFor keeps its DOM. */
  get ranking(): RankedDice[] {
    const c = this.rankingCache;
    if (c && c.dices === this.dices && c.dicing === this.isDicing && c.name === this.name) {
      return c.result;
    }
    const diced = (this.dices || [])
      .filter((d) => d.number && !(this.isDicing && d.name === this.name))
      .map((d) => ({...d, total: this.sum(d.number), rank: 0, tie: false}))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    diced.forEach((d, i) => {
      d.rank = i > 0 && diced[i - 1].total === d.total ? diced[i - 1].rank : i + 1;
    });
    diced.forEach((d) => d.tie = diced.filter((o) => o.total === d.total).length > 1);
    this.rankingCache = {dices: this.dices, dicing: this.isDicing, name: this.name, result: diced};
    return diced;
  }

  trackByName(_: number, d: Dice) {
    return d.name;
  }

  trackByIndex(i: number) {
    return i;
  }

  get pending(): Dice[] {
    return (this.dices || []).filter((d) => !d.number || (this.isDicing && d.name === this.name));
  }

  get myRank(): RankedDice {
    return this.ranking.find((d) => d.name === this.name);
  }

  get dicedCount() {
    return this.ranking.length;
  }

  get hasTopTie() {
    const r = this.ranking;
    return r.length > 1 && r[0].total === r[1].total;
  }

  private renderSnow() {
    this.ngZone.runOutsideAngular(() => {
      while (this.snow.length < this.snowCount / 2) {
        this.snow.push({y: Math.random() * window.innerHeight, x: Math.random() * 100, size: Math.random() * 5 + 3,
          direction: Math.random() - 0.5, speed: Math.random() * 0.5 + 0.5});
      }
      setTimeout(() => {
        if (this.snow.length < this.snowCount && Math.random() < 0.5) {
          this.snow.push({y: -5, x: Math.random() * 100, size: Math.random() * 5 + 3,
            direction: Math.random() - 0.5, speed: Math.random() * 0.5 + 0.5});
        }
        const copy = [];
        for (const s of this.snow) {
          s.y += s.speed / 3;
          s.x += s.direction / 6;
          if (s.y < 105) {
            copy.push(s);
          }
        }
        this.snow = copy;
        this.ref.tick();
        this.renderSnow();
      }, 1000. / 60.);
    });
  }
  async updateList() {
    let newDices = await this.http.get<Dice[]>(AppComponent.API_URL).toPromise();
    if (this.isAdded) {
      let data = newDices?.filter((d) => d.name === this.name);
      if (this.isDicing) {
        data = this.dices.filter((d) => d.name === this.name);
      }
      newDices = data.concat(newDices.filter((d) => d.name !== this.name));
    }
    if (JSON.stringify(this.dices) !== JSON.stringify(newDices)) {
      this.dices = newDices;
    }
    if (!this.isAdded && this.name && !this.isAdmin && newDices?.some((d) => d.name === this.name)) {
      this.isAdded = true;
    }


  }
  async reset(mode: 'reset' | 'delete') {
    await this.http.get<Dice[]>(AppComponent.API_URL + '?action=' + mode).toPromise();
    if (mode === 'delete') {
      this.isAdded = false;
    }
    this.updateList();
  }
  async addName() {
    this.name = this.name?.trim();
    if (!this.name || this.isAdmin) {
      return;
    }
    this.isAdded = true;
    localStorage.setItem('name', this.name);
    // only add if not in list
    if (!this.getMyDice()) {
      await this.http.get<Dice[]>(AppComponent.API_URL + '?action=put&name=' + encodeURIComponent(this.name)).toPromise();
    }
    this.updateList();
  }
  switchName() {
    this.isAdded = false;
    this.name = '';
    localStorage.removeItem('name');
  }
  getMyDice() {
    return this.dices?.filter((d) => d.name === this.name)[0];
  }
  sum(numbers: number[]) {
    if (!numbers) {
      return 0;
    }
    return numbers?.reduce((a, b) => a + b);
  }
  async startDice() {
    if (this.isDicing) {
      return;
    }
    this.isDicing = true;
    this.myRoll = null;
    this.shownSum = null;
    const started = Date.now();
    await this.http.get(AppComponent.API_URL + '?action=put&name=' + encodeURIComponent(this.name) + '&dice=true').toPromise();
    const list = await this.http.get<Dice[]>(AppComponent.API_URL).toPromise();
    const result = list?.find((d) => d.name === this.name)?.number;
    // let the dice tumble a moment for suspense
    await new Promise((r) => setTimeout(r, Math.max(0, 1600 - (Date.now() - started))));
    this.myRoll = result || null;
    await new Promise((r) => setTimeout(r, LAND_MS + 250));
    this.isDicing = false;
    this.myRoll = null;
    this.dices = list;
    if (result) {
      this.countUp(this.sum(result));
      if (this.myRank?.rank === 1) {
        this.celebrate();
      }
    }
    this.updateList();
  }

  private countUp(total: number) {
    const start = performance.now();
    const duration = 600;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      this.shownSum = Math.round(total * (1 - Math.pow(1 - p, 3)));
      if (p < 1) {
        requestAnimationFrame(tick);
      } else {
        setTimeout(() => this.shownSum = null, 50);
      }
    };
    requestAnimationFrame(tick);
  }

  private celebrate() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const colors = ['#b3261e', '#c99a06', '#1f7a4d', '#ffffff', '#2b5fd9'];
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

export interface Dice {
  name: string;
  number: number[];
}

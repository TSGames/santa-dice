import { Injectable, NgZone } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { BehaviorSubject, firstValueFrom } from 'rxjs';

export interface Item {
  id: string;
  title: string;
  description: string;
  link: string;
  image: string | null;
  assignedDay?: number | null;
}

export interface Round {
  players: string[];
  rolls: { [name: string]: number[] };
  closed: boolean;
}

export interface Day {
  day: number;
  open: boolean;
  item?: Item | null;
  participants?: string[];
  rounds?: Round[];
  winner?: string | null;
  pickedFor?: number | null;
  pickTarget?: number | null;
  roundComplete?: boolean;
  leaders?: string[];
}

export interface Calendar {
  today: string;
  openUntil: number;
  admin: boolean;
  days: Day[];
}

const API = 'api.php';

/** Fehlermeldungen des Backends auf Deutsch. */
const ERRORS: { [key: string]: string } = {
  'door not open yet': 'Dieses Türchen ist noch nicht offen.',
  'door already decided': 'Dieses Türchen ist schon ausgewürfelt.',
  'round already closed': 'Eintragen ist nicht mehr möglich, die Runde läuft schon.',
  'round closed': 'Die Runde ist geschlossen.',
  'not a player in this round': 'Du würfelst in dieser Runde nicht mit.',
  'already rolled': 'Du hast schon gewürfelt.',
  'only the winner can pick': 'Nur die Gewinner*in darf auswählen.',
  'already picked': 'Es wurde schon ausgewählt.',
  'no door left to fill': 'Es gibt kein Türchen mehr ohne Preis.',
  'item already assigned': 'Dieser Preis ist schon vergeben.',
  'no unique leader': 'Es gibt keine eindeutige Höchstsumme.',
  'no tie at the top': 'Kein Gleichstand an der Spitze.',
  'admin token required': 'Admin-Token fehlt oder ist falsch.',
  'item is assigned to a door': 'Der Preis hängt schon an einem Türchen.',
};

@Injectable({providedIn: 'root'})
export class ApiService {
  readonly calendar$ = new BehaviorSubject<Calendar | null>(null);
  readonly error$ = new BehaviorSubject<string | null>(null);

  private polling: any;

  constructor(private http: HttpClient, private zone: NgZone) {
  }

  get name(): string {
    return this.storage('name') || '';
  }

  set name(value: string) {
    this.setStorage('name', value);
  }

  get adminToken(): string {
    return this.storage('adminToken') || '';
  }

  set adminToken(value: string) {
    this.setStorage('adminToken', value);
  }

  /** Kalender laden und alle 2 s aktualisieren (pausiert im Hintergrund-Tab). */
  startPolling() {
    if (this.polling) {
      return;
    }
    this.refresh();
    this.polling = setInterval(() => {
      if (document.visibilityState === 'visible') {
        this.refresh();
      }
    }, 2000);
  }

  async refresh() {
    try {
      const calendar = await firstValueFrom(this.http.get<Calendar>(API, {headers: this.headers()}));
      const current = this.calendar$.value;
      if (!current || JSON.stringify(current) !== JSON.stringify(calendar)) {
        this.calendar$.next(calendar);
      }
    } catch (e) {
      this.error$.next('Server nicht erreichbar.');
    }
  }

  join(day: number, name: string) {
    return this.post<Calendar>('join', {day, name}).then((c) => this.calendar$.next(c));
  }

  roll(day: number, name: string) {
    return this.post<{ roll: number[] }>('roll', {day, name});
  }

  pick(day: number, name: string, itemId: string) {
    return this.post<{ pickedFor: number }>('pick', {day, name, itemId}).then(() => this.refresh());
  }

  available() {
    return firstValueFrom(this.http.get<{ items: Item[] }>(API + '?action=available')).then((r) => r.items);
  }

  // --- Admin ---------------------------------------------------------------

  adminAction(action: 'close' | 'winner' | 'tiebreak' | 'day-reset', day: number) {
    return this.post<Calendar>(action, {day}).then((c) => this.calendar$.next(c));
  }

  items() {
    return this.post<{ items: Item[] }>('items', {}).then((r) => r.items);
  }

  saveItem(item: Partial<Item>) {
    return this.post<{ id: string }>('item-save', item).then((r) => r.id);
  }

  deleteItem(id: string) {
    return this.post('item-delete', {id});
  }

  upload(id: string, file: File) {
    const form = new FormData();
    form.append('image', file);
    return this.request(API + '?action=upload&id=' + encodeURIComponent(id), form);
  }

  assign(day: number, itemId: string | null) {
    return this.post<Calendar>('assign', {day, itemId}).then((c) => this.calendar$.next(c));
  }

  // -------------------------------------------------------------------------

  private post<T>(action: string, body: any): Promise<T> {
    return this.request<T>(API + '?action=' + action, body);
  }

  private async request<T>(url: string, body: any): Promise<T> {
    try {
      return await firstValueFrom(this.http.post<T>(url, body, {headers: this.headers()}));
    } catch (e) {
      const message = (e as HttpErrorResponse).error?.error;
      throw new Error(ERRORS[message] || message || 'Unbekannter Fehler.');
    }
  }

  private headers() {
    return this.adminToken ? new HttpHeaders({'X-Admin-Token': this.adminToken}) : new HttpHeaders();
  }

  private storage(key: string) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private setStorage(key: string, value: string) {
    try {
      value ? localStorage.setItem(key, value) : localStorage.removeItem(key);
    } catch {
    }
  }
}

/** Deterministischer Zufall (mulberry32) mit String-Seed. */
export function seededShuffle<T>(list: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  const random = () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const result = [...list];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

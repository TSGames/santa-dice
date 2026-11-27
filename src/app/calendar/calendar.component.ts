import { Component, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { map } from 'rxjs';
import { ApiService, Day, shuffle } from '../api.service';

/** Duration of the door opening animation before navigating. */
const OPEN_MS = 750;

@Component({
  selector: 'app-calendar',
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.scss'],
})
export class CalendarComponent implements OnDestroy {
  /** Door that is currently swinging open. */
  opening: number | null = null;
  /** Locked door that was clicked: shakes and shows a hint. */
  nudged: { day: number, text: string, shake: boolean } | null = null;
  private timers: any[] = [];

  /** Bei jedem Aufruf neu gemischt, bleibt stabil, solange die Seite offen ist. */
  private readonly order = shuffle(Array.from({length: 24}, (_, i) => i + 1));

  readonly view$ = this.api.calendar$.pipe(map((c) => c && {
    ...c,
    doors: this.order.map((n) => c.days.find((d) => d.day === n)!).filter(Boolean),
  }));

  constructor(public api: ApiService, private router: Router) {
  }

  ngOnDestroy() {
    this.timers.forEach(clearTimeout);
  }

  /** Opens a door with a swing animation, then navigates. Modifier clicks keep the normal link behavior. */
  open(event: MouseEvent, day: number) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (this.opening !== null) {
      return;
    }
    if (reducedMotion()) {
      this.router.navigate(['/tuer', day]);
      return;
    }
    this.opening = day;
    this.timers.push(setTimeout(() => this.router.navigate(['/tuer', day]), OPEN_MS));
  }

  /** Locked door: shake it and say when it opens. */
  nudge(day: number, today: string) {
    const text = lockedText(day, today);
    // Remove the class first so a second click restarts the shake
    this.nudged = {day, text, shake: false};
    this.timers.push(setTimeout(() => this.nudged?.day === day && (this.nudged = {day, text, shake: true}), 20));
    this.timers.push(setTimeout(() => this.nudged?.day === day && (this.nudged = null), 2600));
  }

  trackByDay(_: number, d: Day) {
    return d.day;
  }
}

function reducedMotion() {
  return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Hint for a locked door, based on the server's date (YYYY-MM-DD). */
export function lockedText(day: number, today: string) {
  const [, month, date] = today.split('-').map(Number);
  if (month !== 12) {
    return `Öffnet am ${day}. Dezember`;
  }
  const diff = day - date;
  if (diff === 1) {
    return 'Morgen geht es auf!';
  }
  return diff > 1 ? `Noch ${diff} Tage` : 'Noch nicht freigegeben';
}

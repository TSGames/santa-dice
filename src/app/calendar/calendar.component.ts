import { Component } from '@angular/core';
import { map } from 'rxjs';
import { ApiService, Day, shuffle } from '../api.service';

@Component({
  selector: 'app-calendar',
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.scss'],
})
export class CalendarComponent {
  /** Bei jedem Aufruf neu gemischt, bleibt stabil, solange die Seite offen ist. */
  private readonly order = shuffle(Array.from({length: 24}, (_, i) => i + 1));

  readonly view$ = this.api.calendar$.pipe(map((c) => c && {
    ...c,
    doors: this.order.map((n) => c.days.find((d) => d.day === n)!).filter(Boolean),
  }));

  constructor(public api: ApiService) {
  }

  trackByDay(_: number, d: Day) {
    return d.day;
  }
}

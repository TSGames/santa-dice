import { Component } from '@angular/core';
import { map } from 'rxjs';
import { ApiService, Day, seededShuffle } from '../api.service';

@Component({
  selector: 'app-calendar',
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.scss'],
})
export class CalendarComponent {
  /** Türchen in täglich neuer, für alle gleicher Reihenfolge. */
  readonly view$ = this.api.calendar$.pipe(map((c) => c && {
    ...c,
    doors: seededShuffle(c.days, 'advent-' + c.today),
  }));

  constructor(public api: ApiService) {
  }

  trackByDay(_: number, d: Day) {
    return d.day;
  }

  status(d: Day): 'locked' | 'decided' | 'open' {
    if (!d.open) {
      return 'locked';
    }
    return d.winner ? 'decided' : 'open';
  }
}

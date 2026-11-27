import { Component } from '@angular/core';
import { ApiService } from './api.service';
import { FxService } from './fx/fx.service';
import { keepInputsAboveKeyboard } from './keyboard';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent {
  /** Short message, e.g. after catching a shooting star. */
  toast: string | null = null;
  private toastTimer: any;

  constructor(public api: ApiService, public fx: FxService) {
    api.startPolling();
    keepInputsAboveKeyboard();
  }

  /** A shooting star was clicked: congratulate and count it in this browser. */
  starCaught() {
    let count = 1;
    try {
      count = Number(localStorage.getItem('shootingStars') || 0) + 1;
      localStorage.setItem('shootingStars', String(count));
    } catch {
    }
    this.toast = count === 1
      ? 'Sternschnuppe gefangen! Wünsch dir was.'
      : `Sternschnuppe gefangen! Wünsch dir was. (Nummer ${count})`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast = null, 4000);
  }
}

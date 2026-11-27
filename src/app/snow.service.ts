import { Injectable } from '@angular/core';

/**
 * Shared snow state read every frame by the snow layers (canvas snow and WebGL depth snow):
 * short boosts (e.g. while dice roll) and gusty wind, so all layers drift together.
 */
@Injectable({providedIn: 'root'})
export class SnowService {
  boostUntil = 0;

  boost(ms = 2500) {
    this.boostUntil = Math.max(this.boostUntil, performance.now() + ms);
  }

  /** Horizontal wind in px per frame for the nearest layer (scale by depth); calm with gusts. */
  wind(now = performance.now()) {
    const t = now / 1000;
    const gust = Math.max(0, Math.sin(t * .11) * Math.sin(t * .37 + 1.3));
    return .15 * Math.sin(t * .05) + gust * 1.6;
  }
}

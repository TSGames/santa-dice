import { Injectable } from '@angular/core';

/** Lets other components make it snow harder for a moment (read by SnowComponent every frame). */
@Injectable({providedIn: 'root'})
export class SnowService {
  boostUntil = 0;

  boost(ms = 2500) {
    this.boostUntil = Math.max(this.boostUntil, performance.now() + ms);
  }
}

import { AfterViewInit, Component, ElementRef, EventEmitter, NgZone, OnDestroy, Output, ViewChild } from '@angular/core';
import type { DiceEngine } from './dice-engine';
import { FxService } from './fx.service';

/**
 * Two physical 3D dice on the card (WebGL only, see FxService). three.js and cannon-es are loaded
 * on first use. If anything fails, (failed) fires and the door page shows the CSS dice instead.
 */
@Component({
  selector: 'app-dice-3d',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [':host { display: block; width: 100%; height: 210px; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class Dice3dComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;
  @Output() failed = new EventEmitter<void>();

  private engine: Promise<DiceEngine | null>;
  private destroyed = false;

  constructor(private zone: NgZone, private fx: FxService) {
  }

  ngAfterViewInit() {
    this.engine = this.zone.runOutsideAngular(async () => {
      try {
        const {DiceEngine} = await import('./dice-engine');
        if (this.destroyed) {
          return null;
        }
        const css = getComputedStyle(document.documentElement);
        const colors = {face: css.getPropertyValue('--cream').trim() || '#fbf7ee', pip: css.getPropertyValue('--forest').trim() || '#10372f'};
        return new DiceEngine(this.canvas.nativeElement, colors, () => this.fail('WebGL-Kontext verloren'));
      } catch (e) {
        this.fail('Würfel: ' + (e as Error).message);
        return null;
      }
    });
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.engine?.then((e) => e?.dispose());
  }

  async shake() {
    (await this.engine)?.shake();
  }

  /** Resolves once the dice lie still showing the values. Rejects if the 3D dice are not available. */
  async throw(values: number[]) {
    const engine = await this.engine;
    if (!engine) {
      throw new Error('3D-Würfel nicht verfügbar');
    }
    await this.zone.runOutsideAngular(() => engine.throw(values));
  }

  private fail(reason: string) {
    this.fx.disable(reason);
    this.zone.run(() => this.failed.emit());
  }
}

import { AfterViewInit, Component, ElementRef, Input, NgZone, OnChanges, OnDestroy, ViewChild } from '@angular/core';
import type { TreeScene } from './tree-scene';
import { FxService } from './fx.service';

/** 3D tree in the calendar header with one bauble per open door (WebGL only, see FxService). */
@Component({
  selector: 'app-tree',
  template: '<canvas #canvas role=img [attr.aria-label]="count + \' Kugeln am Baum\'"></canvas>',
  styles: [':host { display: block; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class TreeComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;
  @Input() count = 0;

  private scene: TreeScene | null = null;
  private destroyed = false;

  constructor(private zone: NgZone, private fx: FxService) {
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(async () => {
      try {
        const {TreeScene} = await import('./tree-scene');
        if (this.destroyed) {
          return;
        }
        const css = getComputedStyle(document.documentElement);
        const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
        this.scene = new TreeScene(this.canvas.nativeElement, {
          needles: v('--sage', '#4f8069'),
          needlesDark: v('--forest', '#10372f'),
          trunk: v('--mustard', '#d4a64a'),
          star: v('--gold-icon', '#e0b04a'),
          baubles: [v('--gold-icon', '#e0b04a'), v('--petrol', '#0d5266'), v('--cream', '#fbf7ee'), v('--mustard', '#d4a64a')],
        }, () => this.fx.disable('WebGL-Kontext verloren'));
        this.scene.setCount(this.count);
      } catch (e) {
        this.fx.disable('Baum: ' + (e as Error).message);
      }
    });
  }

  ngOnChanges() {
    this.scene?.setCount(this.count);
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.scene?.dispose();
  }
}

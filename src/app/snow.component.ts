import { Component, ElementRef, NgZone, OnDestroy, AfterViewInit, ViewChild } from '@angular/core';

interface Flake {
  x: number;
  y: number;
  r: number;
  drift: number;
  speed: number;
}

/** Schnee auf einem Canvas, komplett außerhalb der Angular Change Detection. */
@Component({
  selector: 'app-snow',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [':host { position: fixed; inset: 0; pointer-events: none; z-index: 1; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class SnowComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;

  private flakes: Flake[] = [];
  private frame = 0;
  private resizeHandler = () => this.resize();

  constructor(private zone: NgZone) {
  }

  ngAfterViewInit() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.resize();
      window.addEventListener('resize', this.resizeHandler);
      const count = Math.min(250, Math.round(window.innerWidth * window.innerHeight / 6000));
      for (let i = 0; i < count; i++) {
        this.flakes.push(this.flake(Math.random() * window.innerHeight));
      }
      const loop = () => {
        this.draw();
        this.frame = requestAnimationFrame(loop);
      };
      loop();
    });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('resize', this.resizeHandler);
  }

  private flake(y: number): Flake {
    return {x: Math.random() * window.innerWidth, y, r: Math.random() * 2.5 + 1.2, drift: Math.random() - .5, speed: Math.random() * .6 + .4};
  }

  private resize() {
    const c = this.canvas.nativeElement;
    const dpr = window.devicePixelRatio || 1;
    c.width = window.innerWidth * dpr;
    c.height = window.innerHeight * dpr;
    c.getContext('2d')!.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private draw() {
    const ctx = this.canvas.nativeElement.getContext('2d')!;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, .95)';
    ctx.shadowColor = 'rgba(79, 128, 105, .45)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i];
      f.y += f.speed;
      f.x += f.drift * .4;
      if (f.y > h + 5 || f.x < -5 || f.x > w + 5) {
        this.flakes[i] = this.flake(-5);
        continue;
      }
      ctx.moveTo(f.x + f.r, f.y);
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

import { Component, ElementRef, NgZone, OnDestroy, AfterViewInit, ViewChild } from '@angular/core';
import { SnowService } from './snow.service';

interface Flake {
  x: number;
  y: number;
  r: number;
  drift: number;
  speed: number;
  /** Push from the pointer, decays every frame. */
  vx: number;
  vy: number;
  /** Extra flake during a boost, not respawned afterwards. */
  extra: boolean;
}

/** Radius around the pointer in which flakes are pushed away. */
const REPEL_RADIUS = 110;
const REPEL_FORCE = 1.4;
/** Factor of extra flakes while boosted (e.g. while dice are rolling). */
const BOOST_FACTOR = 1.2;

/** Snow lying on top of elements marked with data-snow (and cards): column width and max height in px. */
const LEDGE_SELECTOR = '[data-snow], .card';
const COL = 3;
const MAX_CAP = 8;
/** Chance that a flake hitting a ledge stays there. */
const SETTLE_CHANCE = .6;

/** Schnee auf einem Canvas, komplett außerhalb der Angular Change Detection. Weicht dem Mauszeiger aus. */
@Component({
  selector: 'app-snow',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  // In front of the content (z-index 3) so flakes can be seen landing on the doors
  styles: [':host { position: fixed; inset: 0; pointer-events: none; z-index: 4; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class SnowComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;

  private flakes: Flake[] = [];
  /** Snow height per column for each ledge element. */
  private ledges = new Map<Element, Float32Array>();
  private ticks = 0;
  private baseCount = 0;
  private frame = 0;
  private pointer: { x: number, y: number } | null = null;
  private resizeHandler = () => this.resize();
  private moveHandler = (e: PointerEvent) => this.pointer = {x: e.clientX, y: e.clientY};
  private leaveHandler = (e: PointerEvent) => {
    if (!e.relatedTarget) {
      this.pointer = null;
    }
  };

  constructor(private zone: NgZone, private snow: SnowService) {
  }

  ngAfterViewInit() {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    this.zone.runOutsideAngular(() => {
      this.resize();
      window.addEventListener('resize', this.resizeHandler);
      window.addEventListener('pointermove', this.moveHandler, {passive: true});
      document.addEventListener('pointerout', this.leaveHandler, {passive: true});
      this.baseCount = Math.min(500, Math.round(window.innerWidth * window.innerHeight / 3000));
      for (let i = 0; i < this.baseCount; i++) {
        this.flakes.push(this.flake(Math.random() * window.innerHeight, false));
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
    window.removeEventListener('pointermove', this.moveHandler);
    document.removeEventListener('pointerout', this.leaveHandler);
  }

  private flake(y: number, extra: boolean): Flake {
    return {
      x: Math.random() * window.innerWidth, y,
      r: Math.random() * 2.5 + 1.2,
      drift: Math.random() - .5,
      speed: (Math.random() * .6 + .4) * (extra ? 2.2 : 1),
      vx: 0, vy: 0, extra,
    };
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
    const boosted = performance.now() < this.snow.boostUntil;

    // While boosted, a few extra flakes start at the top every frame
    if (boosted && this.flakes.length < this.baseCount * (1 + BOOST_FACTOR)) {
      for (let i = 0; i < 4; i++) {
        this.flakes.push(this.flake(-5 - Math.random() * 40, true));
      }
    }

    if (this.ticks++ % 60 === 0) {
      this.refreshLedges();
    }
    const ledges = this.visibleLedges(h);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255, 255, 255, .9)';
    ctx.shadowColor = 'rgba(79, 128, 105, .45)';
    ctx.shadowBlur = 3;
    ctx.beginPath();
    const p = this.pointer;
    for (let i = 0; i < this.flakes.length; i++) {
      const f = this.flakes[i];
      if (p) {
        const dx = f.x - p.x;
        const dy = f.y - p.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < REPEL_RADIUS * REPEL_RADIUS && d2 > .01) {
          const d = Math.sqrt(d2);
          const push = (1 - d / REPEL_RADIUS) * REPEL_FORCE;
          f.vx += dx / d * push;
          f.vy += dy / d * push;
        }
      }
      f.vx *= .9;
      f.vy *= .9;
      const prevY = f.y;
      f.y += f.speed + f.vy;
      f.x += f.drift * .4 + f.vx;
      if (this.settle(f, prevY, ledges)) {
        this.flakes[i] = this.flake(-5, false);
        if (f.extra) {
          this.flakes.splice(i--, 1);
        }
        continue;
      }
      if (f.y > h + 5 || f.x < -5 || f.x > w + 5) {
        if (f.extra) {
          this.flakes.splice(i--, 1);
        } else {
          this.flakes[i] = this.flake(-5, false);
        }
        continue;
      }
      ctx.moveTo(f.x + f.r, f.y);
      ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    }
    ctx.fill();
    this.drawCaps(ctx, ledges);
  }

  /** Picks up elements to collect snow on; keeps the snow of elements that are still there. */
  private refreshLedges() {
    const found = new Set<Element>(Array.from(document.querySelectorAll(LEDGE_SELECTOR)));
    for (const el of Array.from(this.ledges.keys())) {
      if (!found.has(el)) {
        this.ledges.delete(el);
      }
    }
    for (const el of Array.from(found)) {
      if (!this.ledges.has(el)) {
        const cols = Math.ceil(el.getBoundingClientRect().width / COL) + 1;
        // Start with a thin, uneven layer so it looks wintry right away
        const caps = new Float32Array(cols);
        let v = 2;
        for (let c = 0; c < cols; c++) {
          v = Math.max(1, Math.min(4, v + (Math.random() - .5) * 1.2));
          caps[c] = v;
        }
        this.ledges.set(el, caps);
      }
    }
  }

  private visibleLedges(h: number) {
    const list: { rect: DOMRect, caps: Float32Array }[] = [];
    this.ledges.forEach((caps, el) => {
      // A door swinging open drops its snow
      if (el.classList.contains('opening')) {
        caps.fill(0);
        return;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.top > -10 && rect.top < h) {
        list.push({rect, caps});
      }
    });
    return list;
  }

  /** Lets a flake land on a ledge it just crossed; the pointer brushes snow off. Returns true if it landed. */
  private settle(f: Flake, prevY: number, ledges: { rect: DOMRect, caps: Float32Array }[]) {
    const p = this.pointer;
    let landed = false;
    for (const {rect, caps} of ledges) {
      if (f.x < rect.left || f.x > rect.right) {
        continue;
      }
      const col = Math.min(caps.length - 1, Math.floor((f.x - rect.left) / COL));
      const surface = rect.top - caps[col];
      if (!landed && prevY < surface && f.y >= surface && Math.random() < SETTLE_CHANCE) {
        for (let c = col - 2; c <= col + 2; c++) {
          if (c >= 0 && c < caps.length) {
            caps[c] = Math.min(MAX_CAP, caps[c] + f.r * (c === col ? .9 : .45));
          }
        }
        landed = true;
      }
    }
    if (p) {
      for (const {rect, caps} of ledges) {
        if (p.x >= rect.left && p.x <= rect.right && Math.abs(p.y - rect.top) < 12) {
          const col = Math.floor((p.x - rect.left) / COL);
          for (let c = col - 4; c <= col + 4; c++) {
            if (c >= 0 && c < caps.length) {
              caps[c] *= .85;
            }
          }
        }
      }
    }
    return landed;
  }

  private drawCaps(ctx: CanvasRenderingContext2D, ledges: { rect: DOMRect, caps: Float32Array }[]) {
    ctx.fillStyle = 'rgba(255, 255, 255, .97)';
    ctx.shadowColor = 'rgba(16, 55, 47, .25)';
    ctx.shadowBlur = 2;
    ctx.beginPath();
    for (const {rect, caps} of ledges) {
      const top = rect.top + 1;
      ctx.moveTo(rect.left, top);
      for (let c = 0; c < caps.length; c++) {
        const x = Math.min(rect.right, rect.left + c * COL);
        // Taper towards the corners so the snow sits on the rounded edges
        const edge = Math.min(x - rect.left, rect.right - x);
        const taper = Math.min(1, edge / 10);
        const smooth = (caps[Math.max(0, c - 1)] + caps[c] * 2 + caps[Math.min(caps.length - 1, c + 1)]) / 4;
        ctx.lineTo(x, top - smooth * taper);
      }
      ctx.lineTo(rect.right, top);
      ctx.closePath();
    }
    ctx.fill();
  }
}

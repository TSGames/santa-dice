import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { createProgram, FxService } from './fx.service';
import { cssColor } from './shaders';

/*
 * Icicles along the bottom edge of the calendar frame (WebGL only, see FxService).
 * They grow slowly, now and then a drop forms at the tip and falls. Clicking or swiping fast
 * through one breaks it off: it falls with a spin, shatters into shards and grows back later.
 */

const VERTEX = `
attribute vec2 pos;
attribute vec4 color;
attribute float size;
uniform vec2 res;
uniform float pixelRatio;
varying vec4 vColor;
void main() {
  vColor = color;
  gl_Position = vec4(pos.x / res.x * 2.0 - 1.0, 1.0 - pos.y / res.y * 2.0, 0.0, 1.0);
  gl_PointSize = size * pixelRatio;
}
`;

const FRAGMENT = `
precision mediump float;
uniform float mode; // 0 = icicle triangles, 1 = round drops and shards
varying vec4 vColor;
void main() {
  float a = vColor.a;
  if (mode > 0.5) {
    a *= smoothstep(1.0, 0.6, length(gl_PointCoord - 0.5) * 2.0);
  }
  gl_FragColor = vec4(vColor.rgb * a, a);
}
`;

/** Average distance between icicles and the range of their final lengths (px). */
const GAP = 26;
const MIN_LENGTH = 12;
const MAX_LENGTH = 46;
/** Growth in px per second, and how long a broken icicle waits before growing again. */
const GROWTH = .35;
const REGROW_DELAY = 6000;
const GRAVITY = 1400;

interface Icicle {
  /** Position along the flat part of the bottom edge, 0..1. */
  at: number;
  width: number;
  length: number;
  maxLength: number;
  /** Slight bend of the tip, -1..1. */
  bend: number;
  /** Time until it may grow again after breaking off. */
  regrowAt: number;
  /** Drop forming at the tip, 0..1, or -1. */
  drop: number;
}

interface Falling {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  width: number;
  length: number;
  bend: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  life: number;
}

@Component({
  selector: 'app-icicles',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [':host { position: fixed; inset: 0; pointer-events: none; z-index: 5; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class IciclesComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;

  private frame = 0;
  private icicles: Icicle[] = [];
  private falling: Falling[] = [];
  private particles: Particle[] = [];
  private edge: { left: number, right: number, y: number } | null = null;
  private pointer: { x: number, y: number, t: number } | null = null;
  private moveHandler = (e: PointerEvent) => {
    const now = performance.now();
    const last = this.pointer;
    this.pointer = {x: e.clientX, y: e.clientY, t: now};
    // Swiping fast through an icicle breaks it as well
    if (last && now - last.t < 50) {
      const speed = Math.hypot(e.clientX - last.x, e.clientY - last.y) / Math.max(1, now - last.t);
      if (speed > 1.6) {
        this.breakAt(e.clientX, e.clientY, (e.clientX - last.x) / Math.max(1, now - last.t));
      }
    }
  };
  private downHandler = (e: PointerEvent) => this.breakAt(e.clientX, e.clientY, 0);

  constructor(private zone: NgZone, private fx: FxService) {
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      try {
        this.start();
      } catch (e) {
        this.fx.disable('Eiszapfen: ' + (e as Error).message);
      }
    });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('pointermove', this.moveHandler);
    window.removeEventListener('pointerdown', this.downHandler, true);
  }

  private start() {
    const canvas = this.canvas.nativeElement;
    const gl = canvas.getContext('webgl', {premultipliedAlpha: true})!;
    if (!gl) {
      throw new Error('kein WebGL');
    }
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.fx.disable('WebGL-Kontext verloren');
    });
    window.addEventListener('pointermove', this.moveHandler, {passive: true});
    window.addEventListener('pointerdown', this.downHandler, {capture: true, passive: true});

    const program = createProgram(gl, VERTEX, FRAGMENT);
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const attr = (name: string, size: number, offset: number) => {
      const loc = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 28, offset);
    };
    attr('pos', 2, 0);
    attr('color', 4, 8);
    attr('size', 1, 24);
    const u = (name: string) => gl.getUniformLocation(program, name);
    const light = cssColor('--icicle', [.88, .95, 1]);
    const shade = cssColor('--icicle-shade', [.6, .79, .9]);

    const check = this.fx.watchdog();
    let last = performance.now();
    const loop = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(innerWidth * dpr);
      const h = Math.round(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      const now = performance.now();
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.updateEdge();
      this.simulate(now, dt);
      gl.uniform2f(u('res'), innerWidth, innerHeight);
      gl.uniform1f(u('pixelRatio'), dpr);
      this.draw(gl, u, light, shade);
      if (check()) {
        this.frame = requestAnimationFrame(loop);
      }
    };
    loop();
  }

  /** Flat part of the frame's bottom edge; creates the icicles once its width is known. */
  private updateEdge() {
    const frame = document.querySelector('.frame');
    const rect = frame?.getBoundingClientRect();
    if (!frame || !rect || rect.width === 0) {
      this.edge = null;
      return;
    }
    const radius = parseFloat(getComputedStyle(frame).borderBottomLeftRadius) || 0;
    this.edge = {left: rect.left + radius, right: rect.right - radius, y: rect.bottom - 1};
    const count = Math.max(4, Math.round((this.edge.right - this.edge.left) / GAP));
    if (this.icicles.length !== count) {
      this.icicles = Array.from({length: count}, (_, i) => {
        const maxLength = MIN_LENGTH + Math.pow(Math.random(), 1.5) * (MAX_LENGTH - MIN_LENGTH);
        return {
          at: (i + .5 + (Math.random() - .5) * .7) / count,
          width: 5 + Math.random() * 5,
          // Already grown a bit when the page opens
          length: maxLength * (.3 + Math.random() * .5),
          maxLength,
          bend: (Math.random() - .5) * 2,
          regrowAt: 0,
          drop: -1,
        };
      });
    }
  }

  private simulate(now: number, dt: number) {
    for (const ice of this.icicles) {
      if (now > ice.regrowAt && ice.length < ice.maxLength) {
        ice.length = Math.min(ice.maxLength, ice.length + GROWTH * dt * (1 - ice.length / ice.maxLength * .7));
      }
      // A drop slowly forms at the tip of grown icicles and falls when full
      if (ice.drop < 0 && ice.length > 10 && Math.random() < dt * .06) {
        ice.drop = 0;
      }
      if (ice.drop >= 0) {
        ice.drop += dt / 2.5;
        if (ice.drop >= 1 && this.edge) {
          const tip = this.tip(ice);
          this.particles.push({x: tip.x, y: tip.y + 2, vx: 0, vy: 30, size: 4.5, life: 2});
          ice.drop = -1;
        }
      }
    }
    for (const f of this.falling) {
      f.vy += GRAVITY * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.angle += f.spin * dt;
    }
    // Shatter at the bottom of the screen
    this.falling = this.falling.filter((f) => {
      if (f.y < innerHeight - 4) {
        return true;
      }
      for (let i = 0; i < 9; i++) {
        this.particles.push({
          x: f.x, y: innerHeight - 4,
          vx: (Math.random() - .5) * 260, vy: -80 - Math.random() * 220,
          size: 2 + Math.random() * 3, life: .9 + Math.random() * .5,
        });
      }
      return false;
    });
    for (const p of this.particles) {
      p.vy += GRAVITY * .6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0 && p.y < innerHeight + 20);
  }

  private tip(ice: Icicle) {
    const e = this.edge!;
    const x = e.left + (e.right - e.left) * ice.at;
    return {x: x + ice.bend * ice.length * .08, y: e.y + ice.length};
  }

  /** Breaks off the icicle under the pointer, if any. */
  private breakAt(x: number, y: number, pushX: number) {
    const e = this.edge;
    if (!e || y < e.y - 4 || y > e.y + MAX_LENGTH + 6) {
      return;
    }
    for (const ice of this.icicles) {
      const ix = e.left + (e.right - e.left) * ice.at;
      if (ice.length > 6 && Math.abs(x - ix) < Math.max(8, ice.width) && y <= e.y + ice.length + 4) {
        this.falling.push({
          x: ix, y: e.y, vx: pushX * 250 + (Math.random() - .5) * 40, vy: 0,
          angle: 0, spin: (Math.random() - .5) * 6 + pushX * 4,
          width: ice.width, length: ice.length, bend: ice.bend,
        });
        ice.length = 0;
        ice.drop = -1;
        ice.regrowAt = performance.now() + REGROW_DELAY;
        return;
      }
    }
  }

  private draw(gl: WebGLRenderingContext, u: (name: string) => WebGLUniformLocation | null,
               light: [number, number, number], shade: [number, number, number]) {
    const tris: number[] = [];
    const e = this.edge;
    if (e) {
      for (const ice of this.icicles) {
        if (ice.length > .5) {
          this.icicleShape(tris, e.left + (e.right - e.left) * ice.at, e.y, 0, ice.width, ice.length, ice.bend, light, shade);
        }
      }
    }
    for (const f of this.falling) {
      this.icicleShape(tris, f.x, f.y, f.angle, f.width, f.length, f.bend, light, shade);
    }
    gl.uniform1f(u('mode'), 0);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(tris), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, tris.length / 7);

    const points: number[] = [];
    if (e) {
      for (const ice of this.icicles) {
        if (ice.drop > 0) {
          const tip = this.tip(ice);
          points.push(tip.x, tip.y + ice.drop * 2, ...light, .9, 1.5 + ice.drop * 3);
        }
      }
    }
    for (const p of this.particles) {
      points.push(p.x, p.y, ...light, Math.min(1, p.life * 1.5) * .9, p.size);
    }
    if (points.length) {
      gl.uniform1f(u('mode'), 1);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.POINTS, 0, points.length / 7);
    }
  }

  /** Tapered, slightly bent icicle as triangles: shaded body and a light streak on the left. */
  private icicleShape(out: number[], x: number, y: number, angle: number, width: number, length: number, bend: number,
                      light: [number, number, number], shade: [number, number, number]) {
    const segments = 6;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const point = (dx: number, dy: number) => [x + dx * cos - dy * sin, y + dx * sin + dy * cos];
    const rows: { l: number[], m: number[], r: number[] }[] = [];
    for (let i = 0; i <= segments; i++) {
      const f = i / segments;
      const half = width / 2 * Math.pow(1 - f, 1.3);
      const cx = bend * length * .08 * f * f;
      const dy = length * f;
      rows.push({l: point(cx - half, dy), m: point(cx - half * .25, dy), r: point(cx + half, dy)});
    }
    const v = (p: number[], c: [number, number, number], a: number) => out.push(p[0], p[1], c[0], c[1], c[2], a, 1);
    for (let i = 0; i < segments; i++) {
      const a = rows[i];
      const b = rows[i + 1];
      const alpha = .92 - i / segments * .25;
      // light streak (left part)
      v(a.l, light, alpha); v(a.m, light, alpha); v(b.l, light, alpha);
      v(b.l, light, alpha); v(a.m, light, alpha); v(b.m, light, alpha);
      // shaded body (right part)
      v(a.m, shade, alpha); v(a.r, shade, alpha * .85); v(b.m, shade, alpha);
      v(b.m, shade, alpha); v(a.r, shade, alpha * .85); v(b.r, shade, alpha * .85);
    }
  }
}

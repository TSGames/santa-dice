import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { createProgram, FxService } from './fx.service';
import { cssColor } from './shaders';

/*
 * String lights hanging in an arc over the calendar frame (WebGL only, see FxService).
 * Bulbs glow with a soft halo (additive, fake bloom), breathe slowly (no blinking) and swing
 * when the pointer brushes past them.
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
uniform float mode; // 0 = wire, 1 = halo, 2 = bulb
varying vec4 vColor;
void main() {
  if (mode < 0.5) {
    gl_FragColor = vec4(vColor.rgb * vColor.a, vColor.a);
    return;
  }
  float d = length(gl_PointCoord - 0.5) * 2.0;
  if (mode < 1.5) {
    float a = pow(max(0.0, 1.0 - d), 2.2) * vColor.a;
    gl_FragColor = vec4(vColor.rgb * a, 0.0); // additive glow
  } else {
    // Bulb: slightly oval, bright core
    vec2 p = (gl_PointCoord - 0.5) * vec2(2.0, 1.6);
    float body = smoothstep(1.0, 0.85, length(p));
    vec3 c = mix(vColor.rgb, vec3(1.0), smoothstep(0.6, 0.0, length(p + vec2(0.0, 0.15))) * 0.7);
    gl_FragColor = vec4(c * body, body);
  }
}
`;

/** Distance between bulbs along the wire and how far they hang below it (px). */
const SPACING = 64;
const DROP = 12;
const SAG = 14;

interface Bulb {
  angle: number;
  velocity: number;
  color: [number, number, number];
  phase: number;
}

@Component({
  selector: 'app-lights',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [':host { position: fixed; inset: 0; pointer-events: none; z-index: 5; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class LightsComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;

  private frame = 0;
  private bulbs: Bulb[] = [];
  private pointer: { x: number, y: number, vx: number } | null = null;
  private moveHandler = (e: PointerEvent) => {
    this.pointer = {x: e.clientX, y: e.clientY, vx: this.pointer ? e.clientX - this.pointer.x : 0};
  };

  constructor(private zone: NgZone, private fx: FxService) {
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      try {
        this.start();
      } catch (e) {
        this.fx.disable('Lichterkette: ' + (e as Error).message);
      }
    });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('pointermove', this.moveHandler);
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

    const program = createProgram(gl, VERTEX, FRAGMENT);
    gl.useProgram(program);
    gl.enable(gl.BLEND);
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
    const palette = [
      cssColor('--bulb-1', [.98, .78, .35]), cssColor('--bulb-2', [.95, .36, .3]),
      cssColor('--bulb-3', [.3, .88, .6]), cssColor('--bulb-4', [.4, .7, 1]),
    ];
    const wireColor = cssColor('--forest', [.06, .22, .18]);

    const check = this.fx.watchdog();
    const loop = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.round(innerWidth * dpr);
      const h = Math.round(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const frame = document.querySelector('.frame');
      const rect = frame?.getBoundingClientRect();
      if (rect && rect.width > 0 && rect.bottom > 0 && rect.top < innerHeight) {
        this.draw(gl, u, rect, palette, wireColor, dpr);
      }
      if (check()) {
        this.frame = requestAnimationFrame(loop);
      }
    };
    loop();
  }

  private draw(gl: WebGLRenderingContext, u: (name: string) => WebGLUniformLocation | null, rect: DOMRect,
               palette: [number, number, number][], wireColor: [number, number, number], dpr: number) {
    const now = performance.now() / 1000;
    const left = rect.left + 18;
    const right = rect.right - 18;
    const top = rect.top - 9;
    const width = right - left;
    // Wire: a gentle sag (parabola) that sways a little
    const sway = Math.sin(now * .6) * 2;
    const wireY = (x: number) => {
      const f = (x - left) / width;
      return top + 4 * f * (1 - f) * (SAG + sway);
    };

    const count = Math.max(2, Math.floor(width / SPACING));
    while (this.bulbs.length < count) {
      const i = this.bulbs.length;
      this.bulbs.push({angle: 0, velocity: 0, color: palette[i % palette.length], phase: Math.random() * 6.28});
    }
    this.bulbs.length = count;

    const p = this.pointer;
    const wire: number[] = [];
    for (let i = 0; i <= 80; i++) {
      const x = left + width * i / 80;
      wire.push(x, wireY(x), ...wireColor, .9, 1);
    }
    const halos: number[] = [];
    const bulbs: number[] = [];
    this.bulbs.forEach((b, i) => {
      const x = left + width * (i + .5) / count;
      const y = wireY(x);
      // Pendulum: gravity pulls back, damping slows down, the pointer pushes
      b.velocity += -b.angle * .04;
      b.velocity *= .96;
      if (p && Math.hypot(p.x - x, p.y - (y + DROP)) < 26) {
        b.velocity += Math.max(-.08, Math.min(.08, p.vx * .01));
      }
      b.angle += b.velocity;
      const bx = x + Math.sin(b.angle) * DROP;
      const by = y + Math.cos(b.angle) * DROP;
      wire.push(x, y, ...wireColor, .9, 1, bx, by, ...wireColor, .9, 1);
      const glow = .55 + .25 * Math.sin(now * 1.1 + b.phase);
      halos.push(bx, by, ...b.color, glow, 56);
      bulbs.push(bx, by + 1, ...b.color, 1, 11);
    });

    gl.uniform2f(u('res'), innerWidth, innerHeight);
    gl.uniform1f(u('pixelRatio'), dpr);
    gl.lineWidth(1);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(u('mode'), 0);
    // Wire as one strip, then the short sockets as lines
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(wire), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.LINE_STRIP, 0, 81);
    gl.drawArrays(gl.LINES, 81, this.bulbs.length * 2);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.uniform1f(u('mode'), 1);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(halos), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, this.bulbs.length);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1f(u('mode'), 2);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bulbs), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.POINTS, 0, this.bulbs.length);
  }
}

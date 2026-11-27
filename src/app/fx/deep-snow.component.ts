import { AfterViewInit, Component, ElementRef, Input, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { SnowService } from '../snow.service';
import { createProgram, FxService } from './fx.service';

/*
 * Snow with depth (WebGL only, see FxService), as two layers around the canvas snow:
 *  - "back": thousands of tiny, distant flakes behind the content,
 *  - "front": a few big, out-of-focus flakes in front of everything.
 * The canvas snow (SnowComponent) stays the middle layer that settles on the doors.
 * All flakes move on the GPU from per-flake seeds; wind and pointer parallax scale with depth.
 */

const VERTEX = `
attribute vec4 seed;   // x, y (0..1), speed, phase
attribute float depth; // 0 far .. 1 near
uniform vec2 res;
uniform float t;
uniform float windOffset;
uniform vec2 parallax;
uniform float sizeMin;
uniform float sizeMax;
uniform float pixelRatio;
varying float vDepth;
void main() {
  float margin = sizeMax;
  float y = fract(seed.y + t * seed.z * (0.02 + depth * 0.05)) * (res.y + margin * 2.0) - margin;
  float x = seed.x * (res.x + 200.0) - 100.0
    + sin(t * (0.3 + seed.z) + seed.w * 6.28) * (6.0 + depth * 18.0)
    + windOffset * (0.25 + depth)
    + parallax.x * (10.0 + depth * 40.0);
  x = mod(x + 100.0, res.x + 200.0) - 100.0;
  y += parallax.y * (6.0 + depth * 20.0);
  vDepth = depth;
  gl_Position = vec4(x / res.x * 2.0 - 1.0, 1.0 - y / res.y * 2.0, 0.0, 1.0);
  gl_PointSize = mix(sizeMin, sizeMax, depth) * pixelRatio;
}
`;

const FRAGMENT = `
precision mediump float;
uniform float softness;
uniform float opacity;
varying float vDepth;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  // Soft disc; front flakes are blurred (out of focus)
  float a = smoothstep(1.0, 1.0 - softness, d) * opacity * (0.45 + 0.55 * vDepth);
  gl_FragColor = vec4(vec3(a), a);
}
`;

interface LayerConfig {
  count: number;
  sizeMin: number;
  sizeMax: number;
  softness: number;
  opacity: number;
  zIndex: number;
}

const LAYERS: { [name: string]: LayerConfig } = {
  back: {count: 2600, sizeMin: 1.2, sizeMax: 3.2, softness: .8, opacity: .75, zIndex: 1},
  front: {count: 36, sizeMin: 16, sizeMax: 42, softness: 1, opacity: .28, zIndex: 6},
};

@Component({
  selector: 'app-deep-snow',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [':host { position: fixed; inset: 0; pointer-events: none; } canvas { width: 100%; height: 100%; display: block; }'],
  host: {'[style.z-index]': 'config.zIndex'},
})
export class DeepSnowComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;
  @Input() layer: 'back' | 'front' = 'back';

  private frame = 0;
  private target = [0, 0];
  private parallax = [0, 0];
  private moveHandler = (e: PointerEvent) => this.target = [e.clientX / innerWidth - .5, e.clientY / innerHeight - .5];

  constructor(private zone: NgZone, private fx: FxService, private snow: SnowService) {
  }

  get config() {
    return LAYERS[this.layer];
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      try {
        this.start();
      } catch (e) {
        this.fx.disable('Schnee: ' + (e as Error).message);
      }
    });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('pointermove', this.moveHandler);
  }

  private start() {
    const config = this.config;
    const canvas = this.canvas.nativeElement;
    const gl = canvas.getContext('webgl', {premultipliedAlpha: true, antialias: false})!;
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
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Per flake: x, y, speed, phase, depth
    const data = new Float32Array(config.count * 5);
    for (let i = 0; i < config.count; i++) {
      data.set([Math.random(), Math.random(), .5 + Math.random(), Math.random(), Math.pow(Math.random(), 1.6)], i * 5);
    }
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const seed = gl.getAttribLocation(program, 'seed');
    const depth = gl.getAttribLocation(program, 'depth');
    gl.enableVertexAttribArray(seed);
    gl.vertexAttribPointer(seed, 4, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(depth);
    gl.vertexAttribPointer(depth, 1, gl.FLOAT, false, 20, 16);

    const u = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform1f(u('sizeMin'), config.sizeMin);
    gl.uniform1f(u('sizeMax'), config.sizeMax);
    gl.uniform1f(u('softness'), config.softness);
    gl.uniform1f(u('opacity'), config.opacity);

    const check = this.fx.watchdog();
    const started = performance.now();
    let windOffset = 0;
    let last = started;
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
      // Wind is given per 60 fps frame; integrate it over real time
      windOffset += this.snow.wind(now) * Math.min(4, (now - last) / 16.7);
      last = now;
      this.parallax = this.parallax.map((p, i) => p + (this.target[i] - p) * .04);
      gl.uniform2f(u('res'), innerWidth, innerHeight);
      gl.uniform1f(u('t'), (now - started) / 1000);
      gl.uniform1f(u('windOffset'), windOffset);
      gl.uniform2f(u('parallax'), -this.parallax[0], -this.parallax[1]);
      gl.uniform1f(u('pixelRatio'), dpr);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, config.count);
      if (check()) {
        this.frame = requestAnimationFrame(loop);
      }
    };
    loop();
  }
}

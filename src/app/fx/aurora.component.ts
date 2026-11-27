import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { createProgram, FxService } from './fx.service';
import { cssColor, NOISE_GLSL } from './shaders';

const VERTEX = `
attribute vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision highp float;
uniform vec2 res;
uniform float t;
uniform vec2 mouse;
uniform vec3 c1;
uniform vec3 c2;
uniform vec3 c3;
${NOISE_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  float y = 1.0 - uv.y;
  vec3 col = vec3(0.0);
  float alpha = 0.0;

  // Static stars (no blinking), fading towards the horizon
  vec2 grid = gl_FragCoord.xy / 6.0;
  vec2 cell = floor(grid);
  vec2 spot = vec2(hash(cell + 3.1), hash(cell + 5.7)) * 0.6 + 0.2;
  float dot = smoothstep(0.16, 0.0, length(fract(grid) - spot));
  float star = step(0.975, hash(cell)) * dot * (0.35 + 0.65 * hash(cell + 7.0)) * smoothstep(1.0, 0.3, y);
  col += vec3(star);
  alpha += star;

  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x * 1.4 + mouse.x * 0.04 * (fi + 1.0);
    float center = 0.2 + fi * 0.1
      + 0.06 * sin(x * 2.0 + t * 0.1 * (fi + 1.0) + fi * 2.0)
      + 0.1 * (fbm(vec2(x * 1.4, t * 0.03 + fi * 3.0)) - 0.5)
      + mouse.y * 0.02;
    float d = y - center;
    // Curtain: bright lower edge, long rays upwards broken up by vertical streaks
    float rays = 0.35 + 0.65 * fbm(vec2(x * 10.0 + t * 0.06, fi * 4.0 + t * 0.015));
    float v = (d < 0.0 ? exp(d * 7.0) : exp(-d * d / 0.003)) * rays;
    v *= 0.55 + 0.45 * sin(x * 2.6 - t * 0.15 + fi * 1.7);
    v *= i == 0 ? 1.0 : (i == 1 ? 0.75 : 0.45);
    vec3 c = i == 0 ? c1 : (i == 1 ? c2 : c3);
    col += c * v;
    alpha += v;
  }
  alpha = clamp(alpha, 0.0, 0.9);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), alpha);
}
`;

/**
 * Northern lights and stars on the night sky behind the content (WebGL only, see FxService;
 * without it the plain night gradient from styles.scss remains). Rendered at half resolution,
 * shifts slightly with the pointer.
 */
@Component({
  selector: 'app-aurora',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [':host { position: fixed; inset: 0; pointer-events: none; z-index: 0; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class AuroraComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;

  private frame = 0;
  private mouse = [0, 0];
  private target = [0, 0];
  private moveHandler = (e: PointerEvent) => this.target = [e.clientX / innerWidth - .5, e.clientY / innerHeight - .5];

  constructor(private zone: NgZone, private fx: FxService) {
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      try {
        this.start();
      } catch (e) {
        this.fx.disable('Polarlicht: ' + (e as Error).message);
      }
    });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('pointermove', this.moveHandler);
  }

  private start() {
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
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    gl.uniform3fv(u('c1'), cssColor('--aurora-green', [.24, .9, .63]));
    gl.uniform3fv(u('c2'), cssColor('--aurora-teal', [.17, .71, .78]));
    gl.uniform3fv(u('c3'), cssColor('--aurora-violet', [.54, .42, .94]));

    const check = this.fx.watchdog();
    const started = performance.now();
    const loop = () => {
      // Half resolution is enough for soft light and keeps it cheap
      const w = Math.max(1, Math.round(innerWidth / 2));
      const h = Math.max(1, Math.round(innerHeight / 2));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      this.mouse = this.mouse.map((m, i) => m + (this.target[i] - m) * .03);
      gl.uniform2f(u('res'), w, h);
      gl.uniform1f(u('t'), (performance.now() - started) / 1000);
      gl.uniform2f(u('mouse'), this.mouse[0], this.mouse[1]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (check()) {
        this.frame = requestAnimationFrame(loop);
      }
    };
    loop();
  }
}

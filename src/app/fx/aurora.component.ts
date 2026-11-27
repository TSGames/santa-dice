import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { createProgram, FxService } from './fx.service';
import { cssColor, NOISE_GLSL } from './shaders';

const VERTEX = `
attribute vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }
`;

const FRAGMENT = `
precision mediump float;
uniform vec2 res;
uniform float t;
uniform vec2 mouse;
uniform float strength;
uniform vec3 c1;
uniform vec3 c2;
uniform vec3 c3;
${NOISE_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  float y = 1.0 - uv.y;
  vec3 col = vec3(0.0);
  float alpha = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = uv.x * 1.6 + mouse.x * 0.04 * (fi + 1.0);
    float center = 0.16 + fi * 0.08
      + 0.05 * sin(x * 2.2 + t * 0.12 * (fi + 1.0) + fi * 2.0)
      + 0.08 * (fbm(vec2(x * 1.5, t * 0.04 + fi * 3.0)) - 0.5)
      + mouse.y * 0.02;
    float d = y - center;
    // Curtain: soft lower edge, long fading rays upwards, broken up by vertical streaks
    float rays = 0.45 + 0.55 * fbm(vec2(x * 9.0 + t * 0.08, fi * 4.0 + t * 0.02));
    // Both sides meet at 1.0 for d = 0, so there is no hard edge
    float v = (d < 0.0 ? exp(d * 9.0) : exp(-d * d / 0.004)) * rays;
    v *= 0.6 + 0.4 * sin(x * 3.0 - t * 0.2 + fi);
    vec3 c = i == 0 ? c1 : (i == 1 ? c2 : c3);
    // The warm band stays a faint glow
    v *= i == 2 ? 0.45 : 1.0;
    col += c * v;
    alpha += v;
  }
  alpha = clamp(alpha * strength, 0.0, 0.5);
  col = col / max(alpha / strength, 0.001);
  gl_FragColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}
`;

/**
 * Northern lights behind the content (WebGL only, see FxService). Rendered at half resolution,
 * stronger in the evening, shifts slightly with the pointer.
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
    gl.uniform3fv(u('c1'), cssColor('--sage', [.31, .5, .41]));
    gl.uniform3fv(u('c2'), cssColor('--petrol', [.05, .32, .4]));
    gl.uniform3fv(u('c3'), cssColor('--mustard', [.83, .65, .29]));
    const hour = new Date().getHours();
    gl.uniform1f(u('strength'), hour >= 16 || hour < 7 ? .75 : .45);

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

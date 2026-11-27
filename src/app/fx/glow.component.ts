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
uniform float strength;
uniform vec3 gold;
uniform vec3 light;
${NOISE_GLSL}
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  // Light source just above the top edge, drifting slightly with the pointer
  vec2 p = vec2((uv.x - 0.5) * res.x / res.y, 1.0 - uv.y);
  vec2 d = p - vec2(mouse.x * 0.25, -0.25);
  float dist = length(d);
  float angle = atan(d.x, d.y);

  // Soft rays fanning down, slowly changing
  float rays = fbm(vec2(angle * 7.0, t * 0.05)) * 0.7 + 0.3 * sin(angle * 18.0 + t * 0.15);
  rays = smoothstep(0.35, 0.9, rays);
  float fall = exp(-dist * 1.4);
  float glow = exp(-dist * dist * 2.5);

  float alpha = clamp((glow * 0.7 + rays * fall * 0.55) * strength, 0.0, 0.75);
  vec3 color = mix(gold, light, glow);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

/**
 * Warm light from above behind the content: a golden glow with slowly moving rays
 * (WebGL only, see FxService). Rendered at half resolution, a bit stronger in the evening,
 * the source drifts slightly with the pointer.
 */
@Component({
  selector: 'app-glow',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [':host { position: fixed; inset: 0; pointer-events: none; z-index: 0; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class GlowComponent implements AfterViewInit, OnDestroy {
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
        this.fx.disable('Licht: ' + (e as Error).message);
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
    gl.uniform3fv(u('gold'), cssColor('--gold-icon', [.88, .69, .29]));
    gl.uniform3fv(u('light'), cssColor('--door-glow', [1, .95, .77]));
    const hour = new Date().getHours();
    gl.uniform1f(u('strength'), hour >= 16 || hour < 7 ? 1 : .75);

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

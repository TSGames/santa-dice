import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { createProgram, FxService } from './fx.service';
import { NOISE_GLSL } from './shaders';

/** Wipe mask per door: cells across and down, 1 = frozen, 0 = wiped clear. */
const MW = 48;
const MH = 32;
const SLOTS_X = 6;
const SLOTS_Y = 4;
/** Frozen again after a wipe within about this many frames. */
const REFREEZE_PER_FRAME = .004;
const WIPE_RADIUS = 6;
const THAW_MS = 2500;

const VERTEX = `
attribute vec2 corner;
uniform vec4 rect;
uniform vec2 res;
varying vec2 uv;
void main() {
  uv = corner;
  vec2 px = rect.xy + corner * rect.zw;
  gl_Position = vec4(px.x / res.x * 2.0 - 1.0, 1.0 - px.y / res.y * 2.0, 0.0, 1.0);
}
`;

const FRAGMENT = `
// highp: pixel coordinates, and uniforms shared with the vertex shader must match its precision
precision highp float;
varying vec2 uv;
uniform vec4 rect;
uniform float t;
uniform float seed;
uniform float melt;
uniform vec4 slot;
uniform sampler2D mask;
${NOISE_GLSL}
void main() {
  // Rounded corners like the door tiles (10px)
  vec2 px = uv * rect.zw;
  vec2 q = abs(px - rect.zw * 0.5) - (rect.zw * 0.5 - 10.0);
  if (length(max(q, 0.0)) > 10.0) discard;

  vec2 p = px / 90.0 + seed;
  // Distance to the nearest edge in px, scaled: frost sits at the rim like on a window pane
  float edgePx = min(min(px.x, rect.z - px.x), min(px.y, rect.w - px.y));
  float n = fbm(p * 1.5);
  // Relative to the door size, so small doors (phones) keep a clear middle too
  float e = edgePx / max(24.0, min(rect.z, rect.w) * 0.5) + (n - 0.5) * 0.25;
  float rim = smoothstep(0.45, 0.05, e);
  // A few crystals reach inwards, the middle with the number stays clear
  float ridge = 1.0 - abs(fbm(p * 5.0 + n * 2.0) * 2.0 - 1.0);
  float feather = pow(ridge, 8.0) * smoothstep(0.75, 0.2, e);
  float ice = clamp(rim * 0.9 + feather * 0.7, 0.0, 1.0);

  // Wiped parts from the mask
  float frozen = texture2D(mask, slot.xy + uv * slot.zw).r;
  ice *= smoothstep(0.05, 0.6, frozen);
  // Thawing: melts from the inside out along the noise
  ice *= smoothstep(melt, melt + 0.25, 1.0 - e * 0.5 + (n - 0.5) * 0.3);

  vec3 color = mix(vec3(0.93, 0.97, 1.0), vec3(1.0), feather);
  float alpha = clamp(ice * 0.88, 0.0, 1.0);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

interface Melting {
  day: number;
  start: number;
}

/**
 * Ice on locked doors without sparkles (WebGL only, see FxService). The pointer wipes it clear, it freezes over
 * again, and a door that opens while the page is visible thaws.
 * Doors are found via [data-day]; locked ones carry the class "locked".
 */
@Component({
  selector: 'app-frost',
  template: '<canvas #canvas aria-hidden="true"></canvas>',
  styles: [':host { position: fixed; inset: 0; pointer-events: none; z-index: 4; } canvas { width: 100%; height: 100%; display: block; }'],
})
export class FrostComponent implements AfterViewInit, OnDestroy {
  @ViewChild('canvas', {static: true}) canvas: ElementRef<HTMLCanvasElement>;

  private frame = 0;
  private masks = new Map<number, Float32Array>();
  private atlas = new Uint8Array(MW * SLOTS_X * MH * SLOTS_Y);
  private locked = new Set<number>();
  private melting: Melting[] = [];
  private pointer: { x: number, y: number } | null = null;
  private moveHandler = (e: PointerEvent) => this.pointer = {x: e.clientX, y: e.clientY};
  private leaveHandler = (e: PointerEvent) => !e.relatedTarget && (this.pointer = null);

  constructor(private zone: NgZone, private fx: FxService) {
  }

  ngAfterViewInit() {
    this.zone.runOutsideAngular(() => {
      try {
        this.start();
      } catch (e) {
        this.fx.disable('Eis: ' + (e as Error).message);
      }
    });
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.frame);
    window.removeEventListener('pointermove', this.moveHandler);
    document.removeEventListener('pointerout', this.leaveHandler);
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
    document.addEventListener('pointerout', this.leaveHandler, {passive: true});

    const program = createProgram(gl, VERTEX, FRAGMENT);
    gl.useProgram(program);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const corner = gl.getAttribLocation(program, 'corner');
    gl.enableVertexAttribArray(corner);
    gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u = (name: string) => gl.getUniformLocation(program, name);

    const check = this.fx.watchdog();
    const started = performance.now();
    const loop = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.round(innerWidth * dpr);
      const h = Math.round(innerHeight * dpr);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      const now = performance.now();
      const doors = this.collectDoors(now);
      this.updateMasks(doors);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, MW * SLOTS_X, MH * SLOTS_Y, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, this.atlas);

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u('res'), innerWidth, innerHeight);
      gl.uniform1f(u('t'), (now - started) / 1000);
      for (const door of doors) {
        const r = door.rect;
        const slot = door.day - 1;
        gl.uniform4f(u('rect'), r.left, r.top, r.width, r.height);
        gl.uniform1f(u('seed'), door.day * 7.31);
        gl.uniform1f(u('melt'), door.melt);
        gl.uniform4f(u('slot'), (slot % SLOTS_X) / SLOTS_X, Math.floor(slot / SLOTS_X) / SLOTS_Y, 1 / SLOTS_X, 1 / SLOTS_Y);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      if (check()) {
        this.frame = requestAnimationFrame(loop);
      }
    };
    loop();
  }

  /** Locked doors on screen plus doors that just opened and are thawing. */
  private collectDoors(now: number) {
    const result: { day: number, rect: DOMRect, melt: number }[] = [];
    const seen = new Set<number>();
    document.querySelectorAll<HTMLElement>('.door[data-day]').forEach((el) => {
      const day = Number(el.dataset['day']);
      const rect = el.getBoundingClientRect();
      const visible = rect.bottom > 0 && rect.top < innerHeight && rect.width > 0;
      if (el.classList.contains('locked')) {
        seen.add(day);
        if (visible) {
          result.push({day, rect, melt: 0});
        }
      } else {
        const melting = this.melting.find((m) => m.day === day);
        if (melting && visible) {
          result.push({day, rect, melt: Math.min(1.2, (now - melting.start) / THAW_MS * 1.2)});
        }
      }
    });
    // A door that was locked and is not anymore starts to thaw
    this.locked.forEach((day) => !seen.has(day) && this.melting.push({day, start: now}));
    this.locked = seen;
    this.melting = this.melting.filter((m) => now - m.start < THAW_MS);
    return result;
  }

  private updateMasks(doors: { day: number, rect: DOMRect }[]) {
    const p = this.pointer;
    for (const {day, rect} of doors) {
      let mask = this.masks.get(day);
      if (!mask) {
        mask = new Float32Array(MW * MH).fill(1);
        this.masks.set(day, mask);
      }
      for (let i = 0; i < mask.length; i++) {
        mask[i] = Math.min(1, mask[i] + REFREEZE_PER_FRAME);
      }
      if (p && p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom) {
        const cx = (p.x - rect.left) / rect.width * MW;
        const cy = (p.y - rect.top) / rect.height * MH;
        for (let y = Math.max(0, Math.floor(cy - WIPE_RADIUS)); y < Math.min(MH, cy + WIPE_RADIUS); y++) {
          for (let x = Math.max(0, Math.floor(cx - WIPE_RADIUS)); x < Math.min(MW, cx + WIPE_RADIUS); x++) {
            const d = Math.hypot(x - cx, (y - cy) * 1.3) / WIPE_RADIUS;
            if (d < 1) {
              mask[y * MW + x] = Math.min(mask[y * MW + x], d * d);
            }
          }
        }
      }
      // Copy into the atlas slot (texture row 0 is the top of the slot)
      const slot = day - 1;
      const ox = (slot % SLOTS_X) * MW;
      const oy = Math.floor(slot / SLOTS_X) * MH;
      const stride = MW * SLOTS_X;
      for (let y = 0; y < MH; y++) {
        for (let x = 0; x < MW; x++) {
          this.atlas[(oy + y) * stride + ox + x] = mask[y * MW + x] * 255;
        }
      }
    }
  }
}

import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * Decides whether optional WebGL effects run. They are pure additions: when this says no,
 * every component keeps its plain fallback (CSS dice, canvas snow, dimmed locked doors).
 *
 * Off when: prefers-reduced-motion, no WebGL, software rendering, weak device, or later on
 * lost context / poor frame rate. Override for testing: localStorage "fx" = "on" | "off".
 */
@Injectable({providedIn: 'root'})
export class FxService {
  readonly enabled$ = new BehaviorSubject<boolean>(detect());

  get enabled() {
    return this.enabled$.value;
  }

  /** Switches all effects off for this page view, e.g. after a lost WebGL context. */
  disable(reason: string) {
    if (this.enabled) {
      console.info('WebGL-Effekte aus:', reason);
      this.enabled$.next(false);
    }
  }

  /**
   * Frame rate check for one effect: call the returned function once per animation frame.
   * If frames stay slow for a few seconds, all effects are disabled.
   */
  watchdog() {
    // Forced on (testing, screenshots): never switch off for slowness
    return readOverride() === 'on' ? () => true : createWatchdog((reason) => this.disable(reason));
  }
}

function detect(): boolean {
  const forced = readOverride();
  if (forced) {
    return forced === 'on' && hasWebGl(false);
  }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return false;
  }
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency && nav.hardwareConcurrency < 4) || (nav.deviceMemory && nav.deviceMemory < 4)) {
    return false;
  }
  return hasWebGl(true);
}

function readOverride(): string | null {
  try {
    return localStorage.getItem('fx');
  } catch {
    return null;
  }
}

/** True if a WebGL context can be created; optionally rejects software renderers. */
function hasWebGl(rejectSoftware: boolean): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) {
      return false;
    }
    let ok = true;
    if (rejectSoftware) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      ok = !/swiftshader|llvmpipe|software|basic render/i.test(renderer);
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return ok;
  } catch {
    return false;
  }
}

/** Disables effects if the average frame time stays above 45 ms over a 3 s window. */
function createWatchdog(onSlow: (reason: string) => void) {
  let start = 0;
  let last = 0;
  let frames = 0;
  let done = false;
  return () => {
    if (done) {
      return true;
    }
    const now = performance.now();
    if (!start || now - last > 500) {
      // (Re)start after a pause, e.g. background tab
      start = now;
      frames = 0;
    }
    last = now;
    frames++;
    if (now - start > 3000) {
      done = true;
      const avg = (now - start) / frames;
      if (avg > 45) {
        onSlow(`zu langsam (${Math.round(avg)} ms pro Bild)`);
        return false;
      }
    }
    return true;
  };
}

/** Compiles a shader program for a fullscreen-style quad. Throws on errors. */
export function createProgram(gl: WebGLRenderingContext, vertex: string, fragment: string) {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || 'shader error');
    }
    return shader;
  };
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || 'link error');
  }
  return program;
}

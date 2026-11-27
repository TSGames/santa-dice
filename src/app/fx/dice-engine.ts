import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry';
import * as CANNON from 'cannon-es';

/*
 * 3D dice with physics. Loaded lazily (own chunk with three and cannon-es) only when WebGL effects are on.
 *
 * The server decides the result. To still get a real physical throw, the throw is simulated first,
 * the face that ends up on top is noted, and the die mesh is turned relative to its physics body by a
 * cube symmetry so that exactly that face shows the wanted number. Then the recorded throw is played back.
 */

/** Face values in BoxGeometry material order (+x, -x, +y, -y, +z, -z); opposite faces add up to 7. */
const FACE_VALUES = [1, 6, 2, 5, 3, 4];
const FACE_NORMALS = [
  new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1),
];
const PIPS: { [n: number]: [number, number][] } = {
  1: [[.5, .5]],
  2: [[.27, .27], [.73, .73]],
  3: [[.27, .27], [.5, .5], [.73, .73]],
  4: [[.27, .27], [.73, .27], [.27, .73], [.73, .73]],
  5: [[.27, .27], [.73, .27], [.5, .5], [.27, .73], [.73, .73]],
  6: [[.27, .25], [.73, .25], [.27, .5], [.73, .5], [.27, .75], [.73, .75]],
};
const STEP = 1 / 60;
const MAX_STEPS = 60 * 5;

interface Frame {
  p: CANNON.Vec3[];
  q: CANNON.Quaternion[];
}

export interface DiceColors {
  face: string;
  pip: string;
}

export class DiceEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(32, 1, .1, 100);
  private dice: THREE.Mesh[] = [];
  /** Extra rotation per die so the wanted face ends up on top. */
  private offsets = [new THREE.Quaternion(), new THREE.Quaternion()];
  private frame = 0;
  private mode: 'idle' | 'shake' | 'throw' = 'idle';
  private playback: { frames: Frame[], start: number, done: () => void } | null = null;
  private halfWidth = 4;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, colors: DiceColors, private onLost: () => void) {
    this.renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas.addEventListener('webglcontextlost', this.lost);

    this.camera.position.set(0, 6.4, 3.6);
    this.camera.lookAt(0, 0, .35);
    this.scene.add(new THREE.HemisphereLight(0xfffaf0, 0x667766, .9));
    const sun = new THREE.DirectionalLight(0xffffff, .9);
    sun.position.set(3, 9, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {left: -8, right: 8, top: 5, bottom: -5});
    this.scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 20), new THREE.ShadowMaterial({opacity: .18}));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const materials = FACE_VALUES.map((n) => new THREE.MeshStandardMaterial({map: faceTexture(n, colors), roughness: .45}));
    const geometry = new RoundedBoxGeometry(1, 1, 1, 4, .12);
    for (let i = 0; i < 2; i++) {
      const die = new THREE.Mesh(geometry, materials);
      die.castShadow = true;
      die.position.set(i ? .8 : -.8, .5, .2);
      die.rotation.set(0, i ? .5 : -.3, 0);
      this.scene.add(die);
      this.dice.push(die);
    }
    this.resize();
    this.loop();
  }

  /** Lift the dice and spin them while waiting for the server. */
  shake() {
    this.mode = 'shake';
  }

  /** Throws the dice so that they show the given values; resolves when they lie still. */
  throw(values: number[]): Promise<void> {
    const frames = this.simulate(values);
    return new Promise((resolve) => {
      this.mode = 'throw';
      this.playback = {frames, start: performance.now(), done: resolve};
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    this.renderer.dispose();
  }

  private lost = (e: Event) => {
    e.preventDefault();
    this.onLost();
  };

  private resize() {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      // Visible half width on the table, so the dice stay in view
      const dist = this.camera.position.length();
      this.halfWidth = Math.max(2.5, Math.min(7, Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * dist * this.camera.aspect - .9));
    }
  }

  private loop = () => {
    if (this.disposed) {
      return;
    }
    this.resize();
    const now = performance.now();
    if (this.mode === 'shake') {
      this.dice.forEach((die, i) => {
        die.position.lerp(new THREE.Vector3(-this.halfWidth * .6 + i * 1.1, 1.9 + Math.sin(now / 90 + i) * .12, i * .3), .15);
        die.rotation.x += .21 + i * .03;
        die.rotation.y += .17;
        die.rotation.z += .11;
      });
    } else if (this.mode === 'throw' && this.playback) {
      const {frames, start, done} = this.playback;
      const index = Math.min(frames.length - 1, Math.floor((now - start) / 1000 / STEP));
      const f = frames[index];
      this.dice.forEach((die, i) => {
        die.position.set(f.p[i].x, f.p[i].y, f.p[i].z);
        die.quaternion.set(f.q[i].x, f.q[i].y, f.q[i].z, f.q[i].w).multiply(this.offsets[i]);
      });
      if (index === frames.length - 1) {
        this.playback = null;
        this.mode = 'idle';
        done();
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.loop);
  };

  /** Runs the physics from the current dice positions and records it; retries if a die ends up tilted. */
  private simulate(values: number[]): Frame[] {
    for (let attempt = 0; attempt < 12; attempt++) {
      const world = new CANNON.World({gravity: new CANNON.Vec3(0, -32, 0)});
      world.allowSleep = true;
      const material = new CANNON.Material();
      world.addContactMaterial(new CANNON.ContactMaterial(material, material, {friction: .3, restitution: .35}));
      const wall = (normal: CANNON.Vec3, offset: CANNON.Vec3) => {
        const body = new CANNON.Body({mass: 0, material, shape: new CANNON.Plane()});
        body.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), normal);
        body.position.copy(offset);
        world.addBody(body);
      };
      wall(new CANNON.Vec3(0, 1, 0), new CANNON.Vec3(0, 0, 0));
      wall(new CANNON.Vec3(-1, 0, 0), new CANNON.Vec3(this.halfWidth, 0, 0));
      wall(new CANNON.Vec3(1, 0, 0), new CANNON.Vec3(-this.halfWidth, 0, 0));
      wall(new CANNON.Vec3(0, 0, -1), new CANNON.Vec3(0, 0, 1.5));
      wall(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(0, 0, -1.1));

      const bodies = this.dice.map((die) => {
        const body = new CANNON.Body({mass: 1, material, shape: new CANNON.Box(new CANNON.Vec3(.5, .5, .5)),
          linearDamping: .1, angularDamping: .1, sleepSpeedLimit: .15, sleepTimeLimit: .3});
        body.position.set(die.position.x, Math.max(die.position.y, 1.2), die.position.z);
        body.quaternion.set(die.quaternion.x, die.quaternion.y, die.quaternion.z, die.quaternion.w);
        body.velocity.set(7 + Math.random() * 4, 1 + Math.random() * 2, (Math.random() - .5) * 2);
        body.angularVelocity.set((Math.random() - .5) * 30, (Math.random() - .5) * 30, (Math.random() - .5) * 30);
        world.addBody(body);
        return body;
      });

      const frames: Frame[] = [];
      for (let step = 0; step < MAX_STEPS; step++) {
        world.step(STEP);
        frames.push({p: bodies.map((b) => b.position.clone()), q: bodies.map((b) => b.quaternion.clone())});
        if (step > 30 && bodies.every((b) => b.sleepState === CANNON.Body.SLEEPING)) {
          break;
        }
      }
      const last = frames[frames.length - 1];
      const ups = last.q.map((q) => upFace(q));
      if (ups.every((u) => u.dot > .97)) {
        this.offsets = values.map((value, i) => {
          const wanted = FACE_NORMALS[FACE_VALUES.indexOf(value)];
          // Rotation that moves the wanted face to where the top face is (always a cube symmetry)
          return new THREE.Quaternion().setFromUnitVectors(wanted, FACE_NORMALS[ups[i].index]);
        });
        return frames;
      }
    }
    // Fallback: no clean landing found, just show the values lying flat
    this.offsets = values.map((v) => new THREE.Quaternion().setFromUnitVectors(FACE_NORMALS[FACE_VALUES.indexOf(v)], FACE_NORMALS[2]));
    return [{p: this.dice.map((d, i) => new CANNON.Vec3(i ? .8 : -.8, .5, .2)), q: this.dice.map(() => new CANNON.Quaternion())}];
  }
}

/** Which local face points up for a body orientation, and how straight. */
function upFace(q: CANNON.Quaternion) {
  const quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  let best = {index: 0, dot: -2};
  FACE_NORMALS.forEach((n, index) => {
    const dot = n.clone().applyQuaternion(quat).y;
    if (dot > best.dot) {
      best = {index, dot};
    }
  });
  return best;
}

function faceTexture(n: number, colors: DiceColors) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colors.face;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = colors.pip;
  for (const [x, y] of PIPS[n]) {
    ctx.beginPath();
    ctx.arc(x * size, y * size, size * .085, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

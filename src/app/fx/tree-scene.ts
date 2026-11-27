import * as THREE from 'three';

/*
 * Small 3D Christmas tree (loaded lazily with three.js). One bauble per open door, new ones pop in;
 * with all 24 doors open the star on top lights up.
 */

export interface TreeColors {
  needles: string;
  needlesDark: string;
  trunk: string;
  star: string;
  baubles: string[];
}

const SLOTS = 24;

export class TreeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, .1, 50);
  private tree = new THREE.Group();
  private baubles: THREE.Mesh[] = [];
  private star: THREE.Mesh;
  private starMaterial: THREE.MeshStandardMaterial;
  private pops = new Map<number, number>();
  private count = 0;
  private frame = 0;
  private disposed = false;
  private pointerX = 0;
  private target = 0;

  constructor(private canvas: HTMLCanvasElement, colors: TreeColors, private onLost: () => void) {
    this.renderer = new THREE.WebGLRenderer({canvas, alpha: true, antialias: true});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    canvas.addEventListener('webglcontextlost', this.lost);
    window.addEventListener('pointermove', this.move, {passive: true});

    this.camera.position.set(0, 2.1, 8.2);
    this.camera.lookAt(0, 1.75, 0);
    this.scene.add(new THREE.HemisphereLight(0xfff8e8, 0x334433, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, .9);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    const needles = (color: string) => new THREE.MeshStandardMaterial({color, roughness: .8, flatShading: true});
    const layers: [number, number, number, string][] = [
      [1.5, 1.5, .55, colors.needlesDark], [1.2, 1.3, 1.35, colors.needles], [.85, 1.1, 2.1, colors.needlesDark], [.5, .9, 2.75, colors.needles],
    ];
    for (const [radius, height, y, color] of layers) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry(radius, height, 9), needles(color));
      cone.position.y = y + height / 2 - .2;
      this.tree.add(cone);
    }
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(.2, .25, .5, 8), new THREE.MeshStandardMaterial({color: colors.trunk}));
    trunk.position.y = .15;
    this.tree.add(trunk);

    this.starMaterial = new THREE.MeshStandardMaterial({color: colors.star, emissive: colors.star, emissiveIntensity: .1, metalness: .3, roughness: .4});
    this.star = new THREE.Mesh(starGeometry(), this.starMaterial);
    this.star.position.y = 3.65;
    this.tree.add(this.star);

    // Baubles along a spiral on the cone surface, bottom to top
    const sphere = new THREE.SphereGeometry(.13, 16, 12);
    for (let i = 0; i < SLOTS; i++) {
      const f = i / SLOTS;
      const y = .45 + f * 2.75;
      const radius = 1.38 * (1 - f * .82) + .04;
      const angle = i * 2.4;
      const color = colors.baubles[i % colors.baubles.length];
      const bauble = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({color, metalness: .55, roughness: .25}));
      bauble.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      bauble.scale.setScalar(0);
      this.tree.add(bauble);
      this.baubles.push(bauble);
    }
    this.scene.add(this.tree);
    this.loop();
  }

  /** Number of baubles to show (= open doors). New ones pop in. */
  setCount(count: number) {
    const now = performance.now();
    const next = Math.max(0, Math.min(SLOTS, count));
    for (let i = this.count; i < next; i++) {
      // First fill appears quickly one after another, later ones pop when a door opens
      this.pops.set(i, now + (this.count === 0 ? i * 60 : (i - this.count) * 250));
    }
    for (let i = next; i < this.count; i++) {
      this.pops.delete(i);
      this.baubles[i].scale.setScalar(0);
    }
    this.count = next;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.canvas.removeEventListener('webglcontextlost', this.lost);
    window.removeEventListener('pointermove', this.move);
    this.renderer.dispose();
  }

  private lost = (e: Event) => {
    e.preventDefault();
    this.onLost();
  };

  private move = (e: PointerEvent) => this.target = (e.clientX / innerWidth - .5) * .6;

  private loop = () => {
    if (this.disposed) {
      return;
    }
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    // Hidden (e.g. on small screens): skip rendering
    if (w && h) {
      const size = this.renderer.getSize(new THREE.Vector2());
      if (size.x !== w || size.y !== h) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      const now = performance.now();
      this.pointerX += (this.target - this.pointerX) * .05;
      this.tree.rotation.y = now / 4000 + this.pointerX;
      this.pops.forEach((at, i) => {
        const p = Math.max(0, Math.min(1, (now - at) / 450));
        // Ease out with a little overshoot
        this.baubles[i].scale.setScalar(p === 0 ? 0 : 1 + 2.7 * Math.pow(p - 1, 3) + 1.7 * Math.pow(p - 1, 2));
        if (p === 1) {
          this.pops.delete(i);
        }
      });
      const full = this.count >= SLOTS;
      this.starMaterial.emissiveIntensity = full ? 1.2 + Math.sin(now / 300) * .4 : .1;
      this.star.rotation.y = -this.tree.rotation.y + now / 1500;
      this.renderer.render(this.scene, this.camera);
    }
    this.frame = requestAnimationFrame(this.loop);
  };
}

function starGeometry() {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? .12 : .28;
    const a = i / 10 * Math.PI * 2 + Math.PI / 2;
    i ? shape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const geometry = new THREE.ExtrudeGeometry(shape, {depth: .08, bevelEnabled: true, bevelSize: .02, bevelThickness: .02, bevelSegments: 2});
  geometry.center();
  return geometry;
}

import { Component, ElementRef, Input, OnChanges, OnDestroy, SimpleChanges, ViewChild, AfterViewInit } from '@angular/core';

/** Rotation that brings face n to the front (see face placement in die.component.scss). */
const FACE_ROTATION: { [n: number]: [number, number] } = {
  1: [0, 0],
  2: [0, -90],
  3: [-90, 0],
  4: [90, 0],
  5: [0, 90],
  6: [0, 180],
};

/** Pip cells (1–9, row-major in a 3×3 grid) per face value. */
const PIPS: { [n: number]: number[] } = {
  1: [5],
  2: [3, 7],
  3: [3, 5, 7],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

const IDLE: [number, number] = [-24, 36];
export const LAND_MS = 1300;
const TUMBLE_MS = 320;

@Component({
  selector: 'app-die',
  templateUrl: './die.component.html',
  styleUrls: ['./die.component.scss'],
})
export class DieComponent implements OnChanges, AfterViewInit, OnDestroy {
  /** Face to show; null shows the idle cube. */
  @Input() value: number | null = null;
  /** Tumble until a value arrives. */
  @Input() rolling = false;
  @Input() size = 72;
  /** Small per-die delay so a pair does not move in lockstep. */
  @Input() delay = 0;

  @ViewChild('cube', {static: true}) cube: ElementRef<HTMLElement>;

  readonly faces = [1, 2, 3, 4, 5, 6];
  readonly cells = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  landing = false;

  private rx = IDLE[0];
  private ry = IDLE[1];
  private rz = 0;
  private tumbleTimer: any;
  private landTimer: any;
  private reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  hasPip(face: number, cell: number) {
    return PIPS[face].includes(cell);
  }

  ngAfterViewInit() {
    if (this.value) {
      [this.rx, this.ry] = FACE_ROTATION[this.value];
    }
    this.apply('none');
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!this.cube) {
      return;
    }
    if (changes.rolling && this.rolling && !this.value) {
      this.startTumble();
    }
    if (changes.value) {
      if (this.value && (this.rolling || this.tumbleTimer)) {
        this.land(this.value);
      } else if (this.value) {
        [this.rx, this.ry] = FACE_ROTATION[this.value];
        this.rz = 0;
        this.apply('none');
      } else {
        this.stopTumble();
        [this.rx, this.ry] = IDLE;
        this.rz = 0;
        this.apply('transform .6s ease');
      }
    }
  }

  ngOnDestroy() {
    this.stopTumble();
    clearTimeout(this.landTimer);
  }

  private startTumble() {
    this.stopTumble();
    if (this.reducedMotion) {
      return;
    }
    const step = () => {
      this.rx += 200 + Math.random() * 160;
      this.ry += 200 + Math.random() * 160;
      this.rz += Math.random() * 90 - 45;
      this.apply(`transform ${TUMBLE_MS}ms linear`);
    };
    setTimeout(step, this.delay);
    this.tumbleTimer = setInterval(step, TUMBLE_MS);
  }

  private stopTumble() {
    clearInterval(this.tumbleTimer);
    this.tumbleTimer = null;
  }

  private land(value: number) {
    this.stopTumble();
    const [tx, ty] = FACE_ROTATION[value];
    // Next matching orientation at least two more full turns ahead, so it keeps spinning forward.
    const ahead = (current: number, target: number) => {
      const base = Math.ceil((current + 720 - target) / 360) * 360;
      return base + target;
    };
    this.rx = ahead(this.rx, tx);
    this.ry = ahead(this.ry, ty);
    this.rz = 0;
    const duration = this.reducedMotion ? 0 : LAND_MS - this.delay;
    this.apply(`transform ${duration}ms cubic-bezier(.15, .85, .35, 1.08)`);
    this.landing = true;
    clearTimeout(this.landTimer);
    this.landTimer = setTimeout(() => this.landing = false, LAND_MS);
  }

  private apply(transition: string) {
    const el = this.cube.nativeElement;
    el.style.transition = transition;
    el.style.transform = `rotateX(${this.rx}deg) rotateY(${this.ry}deg) rotateZ(${this.rz}deg)`;
  }
}

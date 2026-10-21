import type { Calibration, EyeSample, ViewerTracker } from './types';

/** Fallback "tracker": the pointer position stands in for the head, the
 *  mouse wheel moves it nearer or further. Useful without a webcam. */
export class MouseTracker implements ViewerTracker {
  readonly kind = 'mouse';
  distance = 0.6;
  private nx = 0;
  private ny = 0;
  private sample: EyeSample | null = null;

  constructor(private calibration: () => Calibration) {}

  async start(): Promise<void> {
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    this.update();
  }

  stop(): void {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('wheel', this.onWheel);
  }

  // Re-stamp every call so the filter keeps settling while the pointer rests.
  latest(): EyeSample | null { return this.sample && { pos: this.sample.pos, time: performance.now() }; }

  private onMove = (e: PointerEvent): void => {
    this.nx = (e.clientX / window.innerWidth) * 2 - 1;
    this.ny = 1 - (e.clientY / window.innerHeight) * 2;
    this.update();
  };

  private onWheel = (e: WheelEvent): void => {
    if ((e.target as HTMLElement | null)?.closest('.panel')) return;
    this.distance = Math.min(1.5, Math.max(0.2, this.distance * Math.exp(e.deltaY * 0.001)));
    this.update();
  };

  private update(): void {
    const cal = this.calibration();
    // Let the pointer swing the head a bit past the screen edges.
    const W = cal.screenWidthCm / 100, H = cal.screenHeightCm / 100;
    this.sample = { pos: { x: this.nx * W * 0.8, y: this.ny * H * 0.8, z: this.distance }, time: performance.now() };
  }
}

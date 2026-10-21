import { OneEuro } from './oneEuro';
import type { EyeSample, Vec3 } from './types';

export interface FilterSettings {
  /** 0 = raw, 1 = very smooth (mapped to the One Euro min cutoff). */
  smoothing: number;
  /** How quickly smoothing backs off during fast moves (One Euro beta). */
  responsiveness: number;
  /** Extrapolate the head this far ahead to hide tracking latency. */
  predictMs: number;
}

export const DEFAULT_FILTER: FilterSettings = { smoothing: 0.6, responsiveness: 1.5, predictMs: 30 };

/** Smooths raw eye samples and predicts ahead by `predictMs`. */
export class EyeFilter {
  private fx = new OneEuro();
  private fy = new OneEuro();
  private fz = new OneEuro();
  private lastTime = -1;
  private pos: Vec3 | null = null;

  constructor(public settings: FilterSettings) {}

  reset(): void {
    this.fx.reset(); this.fy.reset(); this.fz.reset();
    this.lastTime = -1; this.pos = null;
  }

  /** Feed the newest tracker sample (repeats are ignored); returns the eye
   *  position to render from at `now`, or null before the first sample. */
  update(sample: EyeSample | null, now: number): Vec3 | null {
    const s = this.settings;
    // smoothing 0..1 -> min cutoff 8 Hz..0.08 Hz (log scale)
    const minCutoff = 8 * Math.pow(0.01, s.smoothing);
    for (const f of [this.fx, this.fy, this.fz]) { f.minCutoff = minCutoff; f.beta = s.responsiveness; }
    if (sample && sample.time !== this.lastTime) {
      this.lastTime = sample.time;
      this.pos = {
        x: this.fx.filter(sample.pos.x, sample.time),
        y: this.fy.filter(sample.pos.y, sample.time),
        z: this.fz.filter(sample.pos.z, sample.time),
      };
    }
    if (!this.pos) return null;
    // Predict from the sample's capture time to now plus the extra lead.
    // Stop extrapolating if samples dry up, or the head would drift away.
    const age = now - this.lastTime;
    const predict = s.predictMs > 0 && age < 150 ? (age + s.predictMs) / 1000 : 0;
    return {
      x: this.pos.x + this.fx.velocity * predict,
      y: this.pos.y + this.fy.velocity * predict,
      z: Math.max(0.05, this.pos.z + this.fz.velocity * predict),
    };
  }
}

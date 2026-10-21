// One Euro filter (Casiez et al. 2012): heavy smoothing when still, light
// smoothing when moving fast. Also exposes the filtered velocity, which the
// eye filter uses for latency prediction.

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  constructor(public minCutoff = 1, public beta = 1, public dCutoff = 1) {}

  reset(): void { this.x = null; this.dx = 0; }

  get value(): number { return this.x ?? 0; }
  get velocity(): number { return this.dx; }

  filter(value: number, timeMs: number): number {
    if (this.x === null) {
      this.x = value; this.dx = 0; this.t = timeMs;
      return value;
    }
    const dt = Math.max(1e-3, (timeMs - this.t) / 1000);
    this.t = timeMs;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

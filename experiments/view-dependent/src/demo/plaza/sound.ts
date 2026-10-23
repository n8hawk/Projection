// Synthesized plaza sounds (no audio files): a plasma bolt with a falling
// zap, crunchy impacts, booming explosions and the overheat vent hiss.

export class PlazaSfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;

  private audio(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return null; }
      const len = Math.floor(this.ctx.sampleRate * 1.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      // A little compression keeps full-auto fire and chained blasts from clipping.
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private env(ctx: AudioContext, peak: number, attack: number, decay: number, at = ctx.currentTime): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    g.connect(this.master!);
    return g;
  }

  private noiseBurst(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number, peak: number, decay: number, delay = 0): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const t = ctx.currentTime + delay;
    src.connect(f).connect(this.env(ctx, peak, 0.003, decay, t));
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.1);
  }

  /** One plasma bolt; `heat` (0..1) makes it whinier as the gun runs hot. */
  shot(heat: number): void {
    const ctx = this.audio();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 900 + heat * 500 + Math.random() * 80;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.18, t + 0.11);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 3200;
    o.connect(lp).connect(this.env(ctx, 0.22, 0.002, 0.11));
    o.start(t); o.stop(t + 0.16);
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(140, t);
    sub.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    sub.connect(this.env(ctx, 0.35, 0.002, 0.08));
    sub.start(t); sub.stop(t + 0.12);
    this.noiseBurst(ctx, 'bandpass', 2400, 1.2, 0.12, 0.05);
  }

  /** Bolt landing; `hard` for metal, otherwise stone. */
  impact(hard: boolean, distance: number): void {
    const ctx = this.audio();
    if (!ctx) return;
    const v = Math.max(0.04, 0.3 / (1 + distance * 0.02));
    this.noiseBurst(ctx, hard ? 'bandpass' : 'lowpass', hard ? 3200 : 900, hard ? 3 : 0.7, v, hard ? 0.08 : 0.12);
  }

  explosion(size: number, distance: number): void {
    const ctx = this.audio();
    if (!ctx) return;
    const v = Math.min(0.9, (0.25 + size * 0.06) / (1 + distance * 0.008));
    const delay = Math.min(1.2, distance / 340);
    this.noiseBurst(ctx, 'lowpass', 500 + 2000 / (1 + distance * 0.02), 0.6, v, 0.5 + size * 0.06, delay);
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 0.6);
    o.connect(this.env(ctx, v * 0.9, 0.005, 0.6, t));
    o.start(t); o.stop(t + 0.8);
  }

  vent(): void {
    const ctx = this.audio();
    if (!ctx) return;
    this.noiseBurst(ctx, 'highpass', 3000, 0.5, 0.16, 0.9);
  }

  kill(): void {
    const ctx = this.audio();
    if (!ctx) return;
    const t = ctx.currentTime;
    for (const [f, d] of [[1320, 0], [1980, 0.05]] as const) {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f;
      o.connect(this.env(ctx, 0.07, 0.002, 0.09, t + d));
      o.start(t + d); o.stop(t + d + 0.12);
    }
  }
}

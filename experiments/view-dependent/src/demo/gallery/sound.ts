// Little synthesized sounds (no audio files): a cork-gun pop, a bell ding,
// a glassy clink for bottles and a dull thud for wood.

export class Sfx {
  muted = false;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  private audio(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return null; }
      const len = Math.floor(this.ctx.sampleRate * 0.3);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private env(ctx: AudioContext, peak: number, attack: number, decay: number): GainNode {
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(ctx.destination);
    return g;
  }

  private tone(freq: number, type: OscillatorType, peak: number, decay: number, delay = 0): void {
    const ctx = this.audio();
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.env(ctx, peak, 0.004, decay);
    o.connect(g);
    o.start(ctx.currentTime + delay);
    o.stop(ctx.currentTime + delay + decay + 0.05);
  }

  shot(): void {
    const ctx = this.audio();
    if (!ctx || !this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 0.8;
    src.connect(f).connect(this.env(ctx, 0.5, 0.002, 0.09));
    src.start();
    this.tone(180, 'sine', 0.25, 0.06);
  }

  ding(points: number): void {
    const base = points >= 50 ? 1568 : points >= 25 ? 1318 : 1046;
    this.tone(base, 'sine', 0.22, 0.6, 0.03);
    this.tone(base * 2.76, 'sine', 0.05, 0.25, 0.03);
    if (points >= 50) this.tone(base * 1.5, 'sine', 0.18, 0.7, 0.14);
  }

  clink(): void {
    this.tone(2600, 'triangle', 0.12, 0.18, 0.02);
    this.tone(3900, 'sine', 0.06, 0.12, 0.05);
  }

  thud(): void { this.tone(110, 'sine', 0.3, 0.12, 0.01); }
}

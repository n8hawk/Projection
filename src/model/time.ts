import type { Show, Transport } from './types';

export function transportTime(t: Transport, duration: number, now = Date.now()): number {
  let time = t.playing ? t.anchorTime + (now - t.anchorWall) / 1000 : t.anchorTime;
  if (t.loop && duration > 0) time = ((time % duration) + duration) % duration;
  else time = Math.min(time, duration);
  return time;
}

export function activeClip(show: Show, layerId: string, time: number) {
  // Later clips win when two overlap.
  let found = null;
  for (const c of show.clips) {
    if (c.layerId === layerId && time >= c.start && time < c.start + c.duration) found = c;
  }
  return found;
}

export function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${String(m).padStart(2, '0')}:${sec.toFixed(2).padStart(5, '0')}`;
}

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

import { useStore } from '../state/store';

// PS5 / any standard-mapping gamepad, polled once per frame.
// L-stick Y: speed. R-stick X: hue. R2: effects mix. Triangle: freeze.
// Cross: play/pause. Options: blackout.

const DEAD = 0.15;
let prevButtons: boolean[] = [];
let prevR2 = -1;
export let gamepadName: string | null = null;

export function pollGamepad(dt: number): void {
  const pads = navigator.getGamepads?.() ?? [];
  const pad = [...pads].find((p) => p && p.connected) ?? null;
  gamepadName = pad ? pad.id : null;
  if (!pad) return;
  const store = useStore.getState();
  const live = store.show.live;
  const patch: Partial<typeof live> = {};
  const ly = pad.axes[1] ?? 0;
  if (Math.abs(ly) > DEAD) patch.speed = Math.min(4, Math.max(0, live.speed - ly * dt * 1.5));
  const rx = pad.axes[2] ?? 0;
  if (Math.abs(rx) > DEAD) patch.hue = ((live.hue + rx * dt * 120 + 540) % 360) - 180;
  const r2 = pad.buttons[7]?.value ?? 0;
  if (Math.abs(r2 - prevR2) > 0.01 && prevR2 >= 0) patch.fxMix = r2;
  prevR2 = r2;
  const pressed = pad.buttons.map((b) => b.pressed);
  const edge = (i: number) => pressed[i] && !prevButtons[i];
  if (edge(3)) patch.freeze = !live.freeze;
  if (edge(9)) patch.blackout = !live.blackout;
  if (edge(0)) (store.transport.playing ? store.pause : store.play)();
  prevButtons = pressed;
  if (Object.keys(patch).length) store.update((d) => Object.assign(d.live, patch), { record: false });
}

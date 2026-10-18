import { useStore } from '../state/store';

// PS5 / any standard-mapping gamepad, polled once per frame.
// The last controller touched wins. L-stick Y: speed. R-stick X: hue. R2: effects mix. Triangle: freeze.
// Cross: play/pause. Options: blackout.

const DEAD = 0.15;
let prevButtons: boolean[] = [];
let prevR2 = -1;
let activeIndex = -1;
export let gamepadName: string | null = null;

const isPlayStation = (p: Gamepad) => /054c|dualsense|dualshock/i.test(p.id);
const isActive = (p: Gamepad) => p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5);

/**
 * Several controllers can be connected (e.g. a paired Xbox pad next to the
 * PS5 one). Use the last one someone touched; before any input, prefer a
 * PlayStation controller.
 */
function pickPad(pads: Gamepad[]): Gamepad | null {
  const touched = pads.find(isActive);
  if (touched) activeIndex = touched.index;
  return pads.find((p) => p.index === activeIndex) ?? pads.find(isPlayStation) ?? pads[0] ?? null;
}

function friendlyName(p: Gamepad): string {
  if (/dualsense|0ce6|0df2/i.test(p.id)) return 'PS5 controller';
  if (isPlayStation(p)) return 'PlayStation controller';
  if (/xbox|xinput|045e/i.test(p.id)) return 'Xbox controller';
  return p.id.replace(/\s*\(.*\)\s*$/, '') || 'Controller';
}

export function pollGamepad(dt: number): void {
  const pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);
  const before = activeIndex;
  const pad = pickPad(pads);
  gamepadName = pad ? friendlyName(pad) : null;
  if (!pad) return;
  if (pad.index !== before) {
    // Switching controllers: the press that picked it shouldn't also fire an action.
    activeIndex = pad.index;
    prevButtons = pad.buttons.map((b) => b.pressed);
    prevR2 = -1;
  }
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

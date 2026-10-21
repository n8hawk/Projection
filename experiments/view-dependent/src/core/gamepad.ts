// Controller polling, adapted from the hub's src/engine/gamepad.ts and
// pads.ts (those are tied to the hub store, so this is a standalone copy).
// The browser only reports controllers to the focused window.

export interface PadSnapshot {
  index: number;
  id: string;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

/** Standard-mapping button indices (PS5 names). */
export const PS = {
  cross: 0, circle: 1, square: 2, triangle: 3,
  l1: 4, r1: 5, l2: 6, r2: 7, create: 8, options: 9, l3: 10, r3: 11,
  up: 12, down: 13, left: 14, right: 15, ps: 16, touchpad: 17,
} as const;

export const STICK_DEAD = 0.15;

function readPads(): PadSnapshot[] {
  return [...(navigator.getGamepads?.() ?? [])]
    .filter((p): p is Gamepad => !!p && p.connected)
    .map((p) => ({ index: p.index, id: p.id, axes: [...p.axes], buttons: p.buttons.map((b) => ({ pressed: b.pressed, value: b.value })) }));
}

const isPlayStation = (p: PadSnapshot) => /054c|dualsense|dualshock/i.test(p.id);
const isActive = (p: PadSnapshot) => p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5);

function friendlyName(p: PadSnapshot): string {
  if (/dualsense|0ce6|0df2/i.test(p.id)) return 'PS5 controller';
  if (isPlayStation(p)) return 'PlayStation controller';
  if (/xbox|xinput|045e/i.test(p.id)) return 'Xbox controller';
  return p.id.replace(/\s*\(.*\)\s*$/, '') || 'Controller';
}

/**
 * Polls once per frame. With several controllers connected, the last one
 * touched wins; before any input, a PlayStation controller is preferred.
 */
export class PadReader {
  pad: PadSnapshot | null = null;
  name: string | null = null;
  private activeIndex = -1;
  private prev: boolean[] = [];

  poll(): PadSnapshot | null {
    const pads = readPads();
    const touched = pads.find(isActive);
    const before = this.activeIndex;
    if (touched) this.activeIndex = touched.index;
    const pad = pads.find((p) => p.index === this.activeIndex) ?? pads.find(isPlayStation) ?? pads[0] ?? null;
    this.prev = pad && pad.index === before && this.pad ? this.pad.buttons.map((b) => b.pressed) : (pad?.buttons.map((b) => b.pressed) ?? []);
    this.pad = pad;
    this.name = pad ? friendlyName(pad) : null;
    return pad;
  }

  pressed(i: number): boolean { return !!this.pad?.buttons[i]?.pressed; }

  /** True on the frame a button goes down. */
  edge(i: number): boolean { return this.pressed(i) && !this.prev[i]; }

  /** Stick axis with the dead zone removed and rescaled to 0..1 beyond it. */
  axis(i: number): number {
    const v = this.pad?.axes[i] ?? 0;
    const a = Math.abs(v);
    return a < STICK_DEAD ? 0 : (Math.sign(v) * (a - STICK_DEAD)) / (1 - STICK_DEAD);
  }
}

// Shared by the editor and the output page, so it must not pull in the store.

/** A plain copy of a Gamepad, so it can cross the BroadcastChannel. */
export interface PadSnapshot {
  index: number;
  id: string;
  axes: number[];
  buttons: { pressed: boolean; value: number }[];
}

/** Reads this window's connected controllers. */
export function readPads(): PadSnapshot[] {
  return [...(navigator.getGamepads?.() ?? [])]
    .filter((p): p is Gamepad => !!p && p.connected)
    .map((p) => ({ index: p.index, id: p.id, axes: [...p.axes], buttons: p.buttons.map((b) => ({ pressed: b.pressed, value: b.value })) }));
}

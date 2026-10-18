import type { Show, Transport } from '../model/types';
import type { PadSnapshot } from '../engine/pads';

// Editor and output window are separate pages on the same machine. They share
// the show and the transport over a BroadcastChannel; both read Date.now(), so
// the transport anchor keeps them on the same frame without streaming time.

export type SyncMessage =
  | { type: 'hello' }
  | { type: 'state'; show: Show; transport: Transport }
  | { type: 'transport'; transport: Transport }
  | { type: 'bye' }
  | { type: 'output-status'; fps: number; width: number; height: number }
  | { type: 'gamepad'; pads: PadSnapshot[] };

export const CHANNEL = 'projection-studio';

export function openChannel(onMessage: (m: SyncMessage) => void): { post: (m: SyncMessage) => void; close: () => void } {
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => onMessage(e.data as SyncMessage);
  return { post: (m) => ch.postMessage(m), close: () => ch.close() };
}

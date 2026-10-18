import { create } from 'zustand';
import type { Show, Transport } from '../model/types';
import { warehouseBoxes } from '../model/defaultShow';
import { transportTime } from '../model/time';

export type Tab = 'rehearsal' | 'map' | 'live';
export type StageView = 'audience' | 'top' | 'projector';

export interface UiState {
  tab: Tab;
  selectedClipId: string | null;
  selectedLayerId: string | null;
  selectedSurfaceId: string | null;
  selectedBoxId: string | null;
  stageView: StageView;
  outputOpen: boolean;
  /** Live: the output window shows the show only. Off: it also draws the mapping helpers. */
  live: boolean;
  /** Point being edited on the selected surface or mask. */
  selectedPoint: number;
  /** Draw every surface outline while mapping, not just the selected one. */
  outlines: boolean;
  /** Set when boxes moved since the last auto-map. */
  mapStale: boolean;
  pixelsPerSecond: number;
}

interface StoreState {
  show: Show;
  transport: Transport;
  ui: UiState;
  past: Show[];
  future: Show[];
  /** Change the show. Pass record:false for continuous drags after calling checkpoint(). */
  update: (fn: (draft: Show) => void, opts?: { record?: boolean }) => void;
  checkpoint: () => void;
  undo: () => void;
  redo: () => void;
  replaceShow: (show: Show) => void;
  setUi: (patch: Partial<UiState>) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (t: number) => void;
  setTransport: (t: Transport) => void;
}

const SAVE_KEY = 'projection-studio.show.v1';
const HISTORY = 100;

function loadShow(): Show {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Show;
      if (s.version === 1 && Array.isArray(s.layers)) return { ...warehouseBoxes(), ...s, live: { ...warehouseBoxes().live, ...s.live, blackout: false } };
    }
  } catch {
    // Corrupt save: start from the template.
  }
  return warehouseBoxes();
}

export const useStore = create<StoreState>((set, get) => ({
  show: loadShow(),
  transport: { playing: false, anchorTime: 0, anchorWall: Date.now(), loop: true },
  ui: {
    tab: 'rehearsal',
    selectedClipId: 'k3',
    selectedLayerId: 'L2',
    selectedSurfaceId: null,
    selectedBoxId: null,
    stageView: 'audience',
    outputOpen: false,
    live: false,
    selectedPoint: 0,
    outlines: true,
    mapStale: false,
    pixelsPerSecond: 24,
  },
  past: [],
  future: [],
  update: (fn, opts) => {
    const prev = get().show;
    const next = structuredClone(prev);
    fn(next);
    if (opts?.record === false) set({ show: next });
    else set({ show: next, past: [...get().past, prev].slice(-HISTORY), future: [] });
  },
  checkpoint: () => set({ past: [...get().past, get().show].slice(-HISTORY), future: [] }),
  undo: () => {
    const { past, show, future } = get();
    if (!past.length) return;
    set({ show: past[past.length - 1], past: past.slice(0, -1), future: [show, ...future] });
  },
  redo: () => {
    const { past, show, future } = get();
    if (!future.length) return;
    set({ show: future[0], future: future.slice(1), past: [...past, show] });
  },
  replaceShow: (show) => set({ show, past: [...get().past, get().show].slice(-HISTORY), future: [] }),
  setUi: (patch) => set({ ui: { ...get().ui, ...patch } }),
  play: () => {
    const t = get().transport;
    if (t.playing) return;
    set({ transport: { ...t, playing: true, anchorWall: Date.now() } });
  },
  pause: () => {
    const t = get().transport;
    if (!t.playing) return;
    set({ transport: { ...t, playing: false, anchorTime: transportTime(t, get().show.duration), anchorWall: Date.now() } });
  },
  stop: () => set({ transport: { ...get().transport, playing: false, anchorTime: 0, anchorWall: Date.now() } }),
  seek: (time) => {
    const t = get().transport;
    const clamped = Math.max(0, Math.min(get().show.duration, time));
    set({ transport: { ...t, anchorTime: clamped, anchorWall: Date.now() } });
  },
  setTransport: (transport) => set({ transport }),
}));

export const now = () => {
  const { transport, show } = useStore.getState();
  return transportTime(transport, show.duration);
};

// Autosave, debounced so knob drags don't hammer storage.
let saveTimer = 0;
useStore.subscribe((s, p) => {
  if (s.show === p.show) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(s.show));
    } catch {
      // Storage full or blocked; the show still runs.
    }
  }, 400);
});

import { DEFAULT_CALIBRATION, type Calibration } from '../core/types';
import { DEFAULT_FILTER, type FilterSettings } from '../core/eyeFilter';
import type { SplatPlacement } from './scene';
import { DEFAULT_AIM, type AimSettings } from '../core/aim';
import { DEFAULT_FLASHLIGHT, type FlashlightSettings } from './flashlight';

export type TrackerMode = 'webcam' | 'mouse';

export interface DemoSettings {
  mode: TrackerMode;
  calibration: Calibration;
  filter: FilterSettings;
  /** Exaggerate head motion (1 = physically correct). */
  gain: number;
  /** Treat the browser window as a smaller pane of the screen. */
  followWindow: boolean;
  roomDepthCm: number;
  showRoom: boolean;
  calibDistanceCm: number;
  splatUrl: string;
  /** Scene id: 'builtin', 'sample', 'url', or 'lib:<file>' from public/splats. */
  scene: string;
  /** Placement of the current scene; edited live by the panel. */
  placement: SplatPlacement;
  /** Remembered placement per scene id, since every capture sits differently. */
  placements: Record<string, SplatPlacement>;
  flashlight: FlashlightSettings;
  /** Bumped when flashlight defaults change, so only those reset. */
  flashlightV: number;
  aim: AimSettings;
  /** Show a dot where the aim ray hits. */
  showAimDot: boolean;
}

// v2: mild ambient light and a narrower beam.
const FLASHLIGHT_V = 2;

export const SAMPLE_SPLAT = 'https://sparkjs.dev/assets/splats/butterfly.spz';

export function defaultPlacement(): SplatPlacement {
  return { scale: 1, zOffset: 0, yawDeg: 0, flip: true };
}

export function defaultSettings(): DemoSettings {
  return {
    // The hosted build runs in a sandbox without camera access.
    mode: import.meta.env.VITE_HOSTED ? 'mouse' : 'webcam',
    calibration: { ...DEFAULT_CALIBRATION },
    filter: { ...DEFAULT_FILTER },
    gain: 1,
    // Inside an iframe the window metrics don't describe the canvas.
    followWindow: !import.meta.env.VITE_HOSTED,
    roomDepthCm: 40,
    showRoom: true,
    calibDistanceCm: 60,
    splatUrl: SAMPLE_SPLAT,
    scene: 'builtin',
    placement: defaultPlacement(),
    placements: {},
    flashlight: { ...DEFAULT_FLASHLIGHT },
    flashlightV: FLASHLIGHT_V,
    aim: { ...DEFAULT_AIM },
    showAimDot: true,
  };
}

// Bumped when defaults change in a way old saved settings should not mask
// (v2: calmer smoothing, v3: 16" 16:10 panel, v4: m16 R2 webcam FOV).
const KEY = 'view-dependent-demo/settings/v4';

// Storage can be unavailable (private windows, sandboxed previews); the demo
// works without it, it just forgets calibration between visits.
export function loadSettings(): DemoSettings {
  const d = defaultSettings();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return d;
    const s = JSON.parse(raw) as Partial<DemoSettings>;
    return {
      ...d, ...s,
      calibration: { ...d.calibration, ...s.calibration },
      filter: { ...d.filter, ...s.filter },
      placement: { ...d.placement, ...s.placement },
      placements: { ...s.placements },
      // Older saved flashlight settings mask new defaults: reset just those.
      flashlight: s.flashlightV === FLASHLIGHT_V ? { ...d.flashlight, ...s.flashlight } : d.flashlight,
      flashlightV: FLASHLIGHT_V,
      aim: { ...d.aim, ...s.aim },
    };
  } catch { return d; }
}

export function saveSettings(s: DemoSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

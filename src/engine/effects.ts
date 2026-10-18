import type { Effect, EffectType } from '../model/types';
import { uid } from '../model/time';

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  def: number;
  step?: number;
  format: (v: number) => string;
}

export interface EffectDef {
  type: EffectType;
  name: string;
  color: string;
  params: ParamDef[];
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
const deg = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}°`;

export const EFFECTS: Record<EffectType, EffectDef> = {
  kaleido: {
    type: 'kaleido',
    name: 'KALEIDOSCOPE',
    color: '#90ECFF',
    params: [
      { key: 'segments', label: 'SEGMENTS', min: 2, max: 16, def: 6, step: 1, format: (v) => String(Math.floor(v)) },
      { key: 'rotate', label: 'ROTATE', min: -180, max: 180, def: 0, format: deg },
      { key: 'zoom', label: 'ZOOM', min: 0.25, max: 3, def: 1, format: (v) => `${v.toFixed(2)}×` },
    ],
  },
  color: {
    type: 'color',
    name: 'COLOR',
    color: '#62D289',
    params: [
      { key: 'hue', label: 'HUE', min: -180, max: 180, def: 0, format: deg },
      { key: 'saturate', label: 'SATURATE', min: 0, max: 2, def: 1, format: pct },
      { key: 'bright', label: 'BRIGHT', min: 0, max: 2, def: 1, format: pct },
    ],
  },
  trails: {
    type: 'trails',
    name: 'TRAILS',
    color: '#C182D4',
    params: [
      { key: 'length', label: 'LENGTH', min: 0, max: 1, def: 0.6, format: pct },
      { key: 'fade', label: 'SOFTEN', min: 0, max: 1, def: 0.3, format: pct },
      { key: 'drift', label: 'DRIFT', min: -1, max: 1, def: 0.2, format: pct },
    ],
  },
};

export function makeEffect(type: EffectType, enabled = false): Effect {
  const params: Record<string, number> = {};
  for (const p of EFFECTS[type].params) params[p.key] = p.def;
  return { id: uid('fx'), type, enabled, params };
}

export const CLIP_PARAMS: ParamDef[] = [
  { key: 'speed', label: 'SPEED', min: 0, max: 4, def: 1, format: (v) => `${v.toFixed(2)}×` },
  { key: 'opacity', label: 'OPACITY', min: 0, max: 1, def: 1, format: pct },
  { key: 'scale', label: 'SCALE', min: 0.25, max: 4, def: 1, format: (v) => `${v.toFixed(2)}×` },
  { key: 'rotate', label: 'ROTATE', min: -180, max: 180, def: 0, format: deg },
];

import { useRef } from 'react';
import type { ParamDef } from '../engine/effects';

interface Props {
  def: ParamDef;
  value: number;
  color?: string;
  size?: number;
  mapLabel?: string;
  onStart?: () => void;
  onChange: (v: number) => void;
}

const ARC = 84.8;

/** Arc knob. Drag up/down (Shift for fine), scroll, or double-click to reset. */
export function Knob({ def, value, color = 'var(--active)', size = 48, mapLabel, onStart, onChange }: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const norm = Math.max(0, Math.min(1, (value - def.min) / (def.max - def.min)));
  const clamp = (v: number) => {
    let x = Math.max(def.min, Math.min(def.max, v));
    if (def.step) x = Math.round(x / def.step) * def.step;
    return x;
  };
  const thick = size < 40 ? 5 : 4;
  return (
    <div
      className="knob"
      role="slider"
      aria-label={def.label}
      aria-valuemin={def.min}
      aria-valuemax={def.max}
      aria-valuenow={value}
      tabIndex={0}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture(e.pointerId);
        drag.current = { y: e.clientY, v: value };
        onStart?.();
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        const range = def.max - def.min;
        const dy = drag.current.y - e.clientY;
        onChange(clamp(drag.current.v + (dy / (e.shiftKey ? 600 : 150)) * range));
      }}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => {
        onStart?.();
        onChange(def.def);
      }}
      onWheel={(e) => {
        onStart?.();
        onChange(clamp(value - Math.sign(e.deltaY) * (def.step ?? (def.max - def.min) / 100)));
      }}
      onKeyDown={(e) => {
        const d = (def.step ?? (def.max - def.min) / 50) * (e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0);
        if (d) {
          e.preventDefault();
          onStart?.();
          onChange(clamp(value + d));
        }
      }}
    >
      <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r="18" fill="none" stroke="var(--raised)" strokeWidth={thick} strokeLinecap="round" strokeDasharray="84.8 113.1" transform="rotate(135 24 24)" />
        <circle cx="24" cy="24" r="18" fill="none" stroke={color} strokeWidth={thick} strokeLinecap="round" strokeDasharray={`${(ARC * norm).toFixed(1)} 113.1`} transform="rotate(135 24 24)" />
        {size >= 40 && <circle cx="24" cy="24" r="10" fill="var(--raised)" />}
      </svg>
      <span className="knob-val">{def.format(value)}</span>
      <span className="knob-label">{def.label}</span>
      {mapLabel !== undefined && <span className="knob-map">{mapLabel}</span>}
    </div>
  );
}

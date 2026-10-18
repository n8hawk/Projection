import { useState } from 'react';
import { useStore } from '../state/store';
import { Fit16x9, Viewport } from './Viewport';
import { Knob } from './Knob';
import { useTick } from './hooks';
import { GENERATORS } from '../engine/shaders';
import { activeClip, formatTime, uid } from '../model/time';
import { newClip, resolveOverlaps, sourceName } from '../model/ops';
import { gamepadName } from '../engine/gamepad';
import { outputStatus } from '../engine/loop';
import type { ParamDef } from '../engine/effects';
import type { ClipSource } from '../model/types';

const MACROS: (ParamDef & { k: 'speed' | 'hue' | 'fxMix'; ctrl: string })[] = [
  { k: 'speed', key: 'speed', label: 'SPEED', min: 0, max: 4, def: 1, format: (v) => `${v.toFixed(2)}×`, ctrl: 'L-STICK ↕' },
  { k: 'hue', key: 'hue', label: 'HUE', min: -180, max: 180, def: 0, format: (v) => `${Math.round(v)}°`, ctrl: 'R-STICK ↔' },
  { k: 'fxMix', key: 'fx', label: 'FX MIX', min: 0, max: 1, def: 1, format: (v) => `${Math.round(v * 100)}%`, ctrl: 'R2' },
];

function CueList() {
  const rawCues = useStore((s) => s.show.cues);
  const cues = [...rawCues].sort((a, b) => a.time - b.time);
  const t = useTick(8);
  const { seek, play, update } = useStore.getState();
  let current = -1;
  cues.forEach((c, i) => { if (t >= c.time) current = i; });
  const next = cues.length ? (current + 1) % cues.length : -1;
  const fire = (i: number) => { seek(cues[i].time); play(); };
  return (
    <aside className="panel" aria-label="Cue list">
      <div className="panel-head">
        <span className="label">CUES</span>
        <button type="button" className="btn sm" title="Add a cue at the playhead" onClick={() => update((d) => { d.cues.push({ id: uid('cue'), name: `Cue ${d.cues.length + 1}`, time: Math.round(t * 2) / 2 }); })}>+ AT PLAYHEAD</button>
      </div>
      <div className="cue-list">
        {cues.map((c, i) => (
          <button key={c.id} type="button" className={`cue-item ${i === current ? 'live' : ''} ${i === next ? 'next' : ''}`} onClick={() => fire(i)}>
            <span className="n">{String(i + 1).padStart(2, '0')}</span>
            <span>{c.name}</span>
            <span className="t">{i === current ? '▶ LIVE' : i === next ? 'NEXT' : formatTime(c.time).slice(0, 5)}</span>
          </button>
        ))}
      </div>
      {next >= 0 && <button type="button" className="go" style={{ marginTop: 'auto' }} onClick={() => fire(next)}>GO · CUE {String(next + 1).padStart(2, '0')}</button>}
      <span className="mono muted" style={{ fontSize: 10.5, letterSpacing: '0.1em', textAlign: 'center' }}>ENTER = GO · SPACE = PLAY / PAUSE</span>
    </aside>
  );
}

function Program() {
  const live = useStore((s) => s.show.live);
  const outputOpen = useStore((s) => s.ui.outputOpen);
  const { update, checkpoint } = useStore.getState();
  useTick(2);
  const status = outputStatus && Date.now() - outputStatus.at < 3000 ? outputStatus : null;
  return (
    <main className="center">
      <Fit16x9>
        {(w, h) => (
          <Viewport kind="output" style={{ width: w, height: h }}>
            <div className="vp-bar">
              <span className="chip" style={{ color: outputOpen ? 'var(--active)' : undefined }}>{outputOpen ? 'PROGRAM · ON OUTPUT WINDOW' : 'PROGRAM · PREVIEW ONLY'}</span>
              <div className="spacer" />
              {live.blackout && <span className="chip" style={{ color: '#F08A96' }}>BLACKOUT</span>}
              {live.freeze && <span className="chip" style={{ color: 'var(--violet)' }}>FROZEN</span>}
            </div>
          </Viewport>
        )}
      </Fit16x9>
      <div className="live-controls">
        <div className="card">
          <div className="panel-head"><span className="label">MASTER BRIGHTNESS</span><span className="mono">{Math.round(live.brightness * 100)}%</span></div>
          <input
            className="fader" type="range" min={0} max={1} step={0.01} value={live.brightness} aria-label="Master brightness"
            style={{ ['--pct' as string]: `${live.brightness * 100}%` }}
            onPointerDown={checkpoint}
            onChange={(e) => update((d) => { d.live.brightness = Number(e.target.value); }, { record: false })}
          />
          <div className="row">
            <button type="button" className={`blackout ${live.blackout ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => update((d) => { d.live.blackout = !d.live.blackout; })}>■ BLACKOUT</button>
            <button type="button" className={`toggle-big ${live.testPattern ? 'on' : ''}`} style={{ flex: 1 }} onClick={() => update((d) => { d.live.testPattern = !d.live.testPattern; })}>TEST PATTERN</button>
          </div>
        </div>
        <div className="card">
          <span className="label">INPUTS & OUTPUT</span>
          <div>
            <div className="status-row"><span>Game controller</span><span className="v" style={{ color: gamepadName ? 'var(--green)' : 'var(--muted)' }}>{gamepadName ? `● ${gamepadName.toUpperCase()}` : '○ PRESS A BUTTON'}</span></div>
            <div className="status-row"><span>Output window</span><span className="v" style={{ color: status ? 'var(--green)' : 'var(--muted)' }}>{status ? `● ${status.width}×${status.height} · ${status.fps} FPS` : outputOpen ? '● OPEN' : '○ CLOSED'}</span></div>
          </div>
        </div>
      </div>
    </main>
  );
}

function PadsAndMacros() {
  const show = useStore((s) => s.show);
  const [layerId, setLayerId] = useState(show.layers[show.layers.length - 1]?.id);
  const t = useTick(4);
  const { update, checkpoint } = useStore.getState();
  const layer = show.layers.find((l) => l.id === layerId) ?? show.layers[0];
  const current = layer ? activeClip(show, layer.id, t) : null;
  const pads: { src: ClipSource; name: string; thumb?: string }[] = [
    ...GENERATORS.map((g) => ({ src: { kind: 'generator', gen: g.id } as ClipSource, name: g.name, thumb: g.thumb })),
    ...show.media.map((m) => ({ src: { kind: 'media', mediaId: m.id } as ClipSource, name: m.name })),
  ];
  const isLive = (src: ClipSource) => current && JSON.stringify(current.source) === JSON.stringify(src);

  // A pad swaps what the layer is playing right now; with nothing playing it drops in an 8 s clip.
  const trigger = (src: ClipSource) => {
    if (!layer) return;
    if (current) {
      update((d) => { const c = d.clips.find((x) => x.id === current.id); if (c) { c.source = src; c.name = sourceName(d, src); } });
    } else {
      const s = useStore.getState();
      const clip = newClip(s.show, layer.id, Math.floor(t), src);
      update((d) => { d.clips.push(clip); resolveOverlaps(d, clip.id); });
    }
  };

  return (
    <aside className="panel" aria-label="Clip pads">
      <div className="panel-head">
        <span className="label">CLIP PADS</span>
        <select className="select" style={{ width: 150 }} value={layer?.id} aria-label="Pad layer" onChange={(e) => setLayerId(e.target.value)}>
          {show.layers.map((l, i) => <option key={l.id} value={l.id}>L{i + 1} · {l.name}</option>)}
        </select>
      </div>
      <div className="pads">
        {pads.map((p) => (
          <button key={JSON.stringify(p.src)} type="button" className={`pad ${isLive(p.src) ? 'live' : ''}`} onClick={() => trigger(p.src)}>
            <span className="pad-thumb" style={{ background: p.thumb ?? 'linear-gradient(135deg, #1C3640, #18191B)' }} />
            <span className="pad-name"><span>{p.name}</span>{isLive(p.src) && <span style={{ color: 'var(--active)' }}>●</span>}</span>
          </button>
        ))}
      </div>
      <div className="card">
        <div className="panel-head"><span className="label">PERFORMANCE MACROS</span><span className="mono muted" style={{ fontSize: 10.5 }}>GAMEPAD</span></div>
        <div className="knobs">
          {MACROS.map((m) => (
            <Knob key={m.k} def={m} value={show.live[m.k]} mapLabel={m.ctrl} color={m.k === 'fxMix' ? 'var(--violet)' : undefined} onStart={checkpoint} onChange={(v) => update((d) => { d.live[m.k] = v; }, { record: false })} />
          ))}
          <div className="knob" style={{ cursor: 'default' }}>
            <button type="button" aria-pressed={show.live.freeze} className={`toggle-big ${show.live.freeze ? 'on' : ''}`} style={{ width: 48, height: 48, padding: 0, fontSize: 18 }} onClick={() => update((d) => { d.live.freeze = !d.live.freeze; })}>❄</button>
            <span className="knob-val">{show.live.freeze ? 'ON' : 'OFF'}</span>
            <span className="knob-label">FREEZE</span>
            <span className="knob-map">△</span>
          </div>
        </div>
        <span className="empty">Cross plays or pauses, Options toggles blackout.</span>
      </div>
    </aside>
  );
}

export function LiveScreen() {
  return (
    <div className="work live">
      <CueList />
      <Program />
      <PadsAndMacros />
    </div>
  );
}

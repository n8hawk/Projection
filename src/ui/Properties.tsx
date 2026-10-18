import { useStore } from '../state/store';
import { CLIP_PARAMS, EFFECTS, type ParamDef } from '../engine/effects';
import { GENERATORS } from '../engine/shaders';
import { Knob } from './Knob';
import { layerTargetLabel, resolveOverlaps, sourceName } from '../model/ops';
import type { ClipParams, Show } from '../model/types';

const fmtM = (v: number) => `${v.toFixed(2)} M`;
const fmtDeg = (v: number) => `${Math.round(v)}°`;
const BOX_PARAMS: (ParamDef & { get: (b: Show['stage']['boxes'][number]) => number; set: (b: Show['stage']['boxes'][number], v: number) => void })[] = [
  { key: 'x', label: 'LEFT/RIGHT', min: -4, max: 4, def: 0, format: fmtM, get: (b) => b.pos[0], set: (b, v) => (b.pos[0] = v) },
  { key: 'z', label: 'DEPTH POS', min: -2.8, max: 3, def: 0, format: fmtM, get: (b) => b.pos[2], set: (b, v) => (b.pos[2] = v) },
  { key: 'r', label: 'TURN', min: -180, max: 180, def: 0, format: fmtDeg, get: (b) => b.rotY, set: (b, v) => (b.rotY = v) },
  { key: 'w', label: 'WIDTH', min: 0.2, max: 3, def: 1, format: fmtM, get: (b) => b.size[0], set: (b, v) => (b.size[0] = v) },
  { key: 'h', label: 'HEIGHT', min: 0.2, max: 3, def: 1, format: fmtM, get: (b) => b.size[1], set: (b, v) => (b.size[1] = v) },
  { key: 'd', label: 'DEPTH', min: 0.2, max: 3, def: 1, format: fmtM, get: (b) => b.size[2], set: (b, v) => (b.size[2] = v) },
];

type Proj = Show['stage']['projector'];
const PROJ_PARAMS: (ParamDef & { get: (p: Proj, s: Show['stage']) => number; set: (p: Proj, v: number, s: Show['stage']) => void })[] = [
  { key: 'throw', label: 'THROW', min: 0.5, max: 3, def: 1.25, format: (v) => v.toFixed(2), get: (p) => p.throwRatio, set: (p, v) => (p.throwRatio = v) },
  { key: 'dist', label: 'DISTANCE', min: 1, max: 9, def: 4.8, format: fmtM, get: (p) => p.pos[2], set: (p, v) => (p.pos[2] = v) },
  { key: 'height', label: 'HEIGHT', min: 0.3, max: 4, def: 1.7, format: fmtM, get: (p) => p.pos[1], set: (p, v) => (p.pos[1] = v) },
  { key: 'aim', label: 'AIM', min: -1, max: 3, def: 1.05, format: fmtM, get: (p) => p.target[1], set: (p, v) => (p.target[1] = v) },
  { key: 'lum', label: 'BRIGHTNESS', min: 0.2, max: 2, def: 1, format: (v) => `${Math.round(v * 100)}%`, get: (p) => p.brightness, set: (p, v) => (p.brightness = v) },
  { key: 'amb', label: 'ROOM LIGHT', min: 0, max: 0.6, def: 0.1, format: (v) => `${Math.round(v * 100)}%`, get: (_p, s) => s.ambient, set: (_p, v, s) => (s.ambient = v) },
];

export function BoxCard({ boxId }: { boxId: string }) {
  const box = useStore((s) => s.show.stage.boxes.find((b) => b.id === boxId));
  const { update, checkpoint, setUi } = useStore.getState();
  if (!box) return null;
  return (
    <div className="card">
      <div className="panel-head">
        <div>
          <div className="label muted">SELECTED OBJECT</div>
          <div className="clip-title">{box.name}</div>
          <div className="clip-sub">{box.shape === 'cylinder' ? `CYLINDER · ⌀ ${box.size[0].toFixed(2)} × ${box.size[1].toFixed(2)} M` : `BOX · ${box.size.map((v) => v.toFixed(2)).join(' × ')} M`}</div>
        </div>
        <span className="badge">STAGE</span>
      </div>
      <div className="knobs three">
        {BOX_PARAMS.filter((p) => !(box.shape === 'cylinder' && (p.key === 'd' || p.key === 'r'))).map((p) => box.shape === 'cylinder' && p.key === 'w' ? { ...p, label: 'DIAMETER' } : p).map((p) => (
          <Knob key={p.key} def={p} value={p.get(box)} size={40} onStart={checkpoint} onChange={(v) => {
            update((d) => { const b = d.stage.boxes.find((x) => x.id === boxId); if (b) p.set(b, v); }, { record: false });
            setUi({ mapStale: true });
          }} />
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn sm" onClick={() => setUi({ selectedBoxId: null })}>DONE</button>
        <button type="button" className="btn sm danger" onClick={() => {
          update((d) => { d.stage.boxes = d.stage.boxes.filter((b) => b.id !== boxId); });
          setUi({ selectedBoxId: null, mapStale: true });
        }}>DELETE</button>
      </div>
    </div>
  );
}

export function ClipCard() {
  const show = useStore((s) => s.show);
  const clipId = useStore((s) => s.ui.selectedClipId);
  const { update, checkpoint, setUi } = useStore.getState();
  const clip = show.clips.find((c) => c.id === clipId);
  if (!clip) {
    return <div className="card"><div className="label muted">SELECTED CLIP</div><div className="empty">Select a clip in the timeline to adjust it.</div></div>;
  }
  const layerIdx = show.layers.findIndex((l) => l.id === clip.layerId);
  const sourceValue = clip.source.kind === 'generator' ? `gen:${clip.source.gen}` : `media:${clip.source.mediaId}`;
  const set = (k: keyof ClipParams, v: number) => update((d) => { const c = d.clips.find((x) => x.id === clip.id); if (c) c.params[k] = v; }, { record: false });
  return (
    <div className="card">
      <div className="panel-head" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="label muted">SELECTED CLIP</div>
          <div className="clip-title">{clip.name}</div>
          <div className="clip-sub">L{layerIdx + 1} → {layerTargetLabel(show, clip.layerId)} · {clip.start.toFixed(1)}–{(clip.start + clip.duration).toFixed(1)} S</div>
        </div>
        <span className="badge">SELECTED</span>
      </div>
      <div className="knobs">
        {CLIP_PARAMS.map((p) => (
          <Knob key={p.key} def={p} value={clip.params[p.key as keyof ClipParams]} color={p.key === 'opacity' ? 'var(--violet)' : undefined} onStart={checkpoint} onChange={(v) => set(p.key as keyof ClipParams, v)} />
        ))}
      </div>
      <label className="field">
        <span>SOURCE</span>
        <select className="select" value={sourceValue} onChange={(e) => {
          const [kind, id] = e.target.value.split(/:(.*)/);
          update((d) => {
            const c = d.clips.find((x) => x.id === clip.id);
            if (!c) return;
            c.source = kind === 'gen' ? { kind: 'generator', gen: id } : { kind: 'media', mediaId: id };
            c.name = sourceName(d, c.source);
          });
        }}>
          <optgroup label="Generators">{GENERATORS.map((g) => <option key={g.id} value={`gen:${g.id}`}>{g.name}</option>)}</optgroup>
          {show.media.length > 0 && <optgroup label="Loops">{show.media.map((m) => <option key={m.id} value={`media:${m.id}`}>{m.name}</option>)}</optgroup>}
        </select>
      </label>
      <div className="row">
        <button type="button" className="btn sm" onClick={() => {
          const copy = { ...structuredClone(clip), id: `${clip.id}_${Date.now().toString(36)}`, start: Math.min(show.duration - clip.duration, clip.start + clip.duration) };
          update((d) => { d.clips.push(copy); resolveOverlaps(d, copy.id); });
          setUi({ selectedClipId: copy.id });
        }}>DUPLICATE</button>
        <button type="button" className="btn sm danger" onClick={() => {
          update((d) => { d.clips = d.clips.filter((c) => c.id !== clip.id); });
          setUi({ selectedClipId: null });
        }}>DELETE</button>
      </div>
    </div>
  );
}

export function EffectRack() {
  const show = useStore((s) => s.show);
  const ui = useStore((s) => s.ui);
  const { update, checkpoint } = useStore.getState();
  const clipLayer = show.clips.find((c) => c.id === ui.selectedClipId)?.layerId;
  const layer = show.layers.find((l) => l.id === (clipLayer ?? ui.selectedLayerId)) ?? show.layers[show.layers.length - 1];
  if (!layer) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div className="panel-head">
        <span className="label">EFFECTS · {layer.name}</span>
        <span className="mono muted" style={{ fontSize: 10.5 }}>WHOLE LAYER</span>
      </div>
      {layer.effects.map((fx) => {
        const def = EFFECTS[fx.type];
        const setFx = (fn: (e: typeof fx) => void, record = true) => update((d) => {
          const e = d.layers.find((l) => l.id === layer.id)?.effects.find((x) => x.id === fx.id);
          if (e) fn(e);
        }, { record });
        return (
          <div key={fx.id} className={`pedal ${fx.enabled ? '' : 'off'}`}>
            <div className="pedal-strip" style={{ background: fx.enabled ? def.color : 'var(--raised)' }} />
            <div className="pedal-body">
              <div className="pedal-head">
                <button type="button" className="power" aria-label={`${fx.enabled ? 'Bypass' : 'Enable'} ${def.name}`} aria-pressed={fx.enabled} style={{ opacity: 1 }} onClick={() => setFx((e) => { e.enabled = !e.enabled; })}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={fx.enabled ? def.color : 'var(--muted)'} strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M12 3v8" /><path d="M6.3 7.5a8 8 0 1 0 11.4 0" /></svg>
                </button>
                <b>{def.name}</b>
                <span className="state" style={{ color: fx.enabled ? def.color : 'var(--muted)' }}>{fx.enabled ? 'ON' : 'BYPASS'}</span>
              </div>
              <div className="knobs three">
                {def.params.map((p) => (
                  <Knob key={p.key} def={p} value={fx.params[p.key]} size={34} color={def.color} onStart={checkpoint} onChange={(v) => setFx((e) => { e.params[p.key] = v; }, false)} />
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ProjectorCard() {
  const stage = useStore((s) => s.show.stage);
  const { update, checkpoint, setUi } = useStore.getState();
  return (
    <div className="card">
      <div className="panel-head"><span className="label">PROJECTOR 1 · VIRTUAL</span><span className="mono muted" style={{ fontSize: 10.5 }}>1280×720</span></div>
      <div className="knobs three">
        {PROJ_PARAMS.map((p) => (
          <Knob key={p.key} def={p} size={40} value={p.get(stage.projector, stage)} onStart={checkpoint} onChange={(v) => {
            update((d) => p.set(d.stage.projector, v, d.stage), { record: false });
            if (p.key !== 'lum' && p.key !== 'amb') setUi({ mapStale: true });
          }} />
        ))}
      </div>
    </div>
  );
}


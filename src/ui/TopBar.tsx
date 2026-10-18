import { useEffect, useRef, useState } from 'react';
import { useStore, type Tab } from '../state/store';
import { onStats } from '../engine/loop';
import { goLive, endLive, openOutput, closeOutput } from './golive';
import { TEMPLATES } from '../model/defaultShow';
import { toast } from './hooks';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rehearsal', label: 'REHEARSAL' },
  { id: 'map', label: 'MAP' },
  { id: 'live', label: 'LIVE' },
];

/** Starts a new show from one of the templates, at its default settings. */
function TemplateMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const pick = (t: (typeof TEMPLATES)[number]) => {
    const show = t.make();
    const s = useStore.getState();
    s.replaceShow(show);
    s.stop();
    s.setUi({
      tab: show.kind === 'blank' ? 'map' : 'rehearsal',
      selectedClipId: show.clips[0]?.id ?? null,
      selectedLayerId: show.layers[show.layers.length - 1]?.id ?? null,
      selectedSurfaceId: null,
      selectedBoxId: null,
      mapStale: false,
    });
    setOpen(false);
    toast(`Started a new ${t.label} show. Press Ctrl+Z to go back.`);
  };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`btn ${open ? 'fill' : ''}`} aria-expanded={open} title="Start a new show from a template" onClick={() => setOpen(!open)}>TEMPLATE ▾</button>
      {open && (
        <div className="card" role="menu" style={{ position: 'absolute', right: 0, top: 40, width: 300, zIndex: 20, background: 'var(--panel)', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' }}>
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" role="menuitem" className="btn" style={{ height: 'auto', padding: '10px 12px', textAlign: 'left', whiteSpace: 'normal', display: 'flex', flexDirection: 'column', gap: 4 }} onClick={() => pick(t)}>
              <span>{t.label}</span>
              <span className="muted" style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none' }}>{t.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function TopBar() {
  const tab = useStore((s) => s.ui.tab);
  const name = useStore((s) => s.show.name);
  const blank = useStore((s) => s.show.kind === 'blank');
  const outputOpen = useStore((s) => s.ui.outputOpen);
  const live = useStore((s) => s.ui.live);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { setUi, undo, redo } = useStore.getState();
  const [fps, setFps] = useState({ fps: 0, ms: 0 });
  useEffect(() => onStats((f, ms) => setFps({ fps: f, ms })), []);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#18191B" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" /></svg>
        </div>
        <div className="brand-name"><b>PROJECTION STUDIO</b><span>/ {name}</span></div>
      </div>
      <nav className="tabs" aria-label="Workspace">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setUi({ tab: t.id })}>{blank && t.id === 'rehearsal' ? 'SHOW' : t.label}</button>
        ))}
      </nav>
      <div className="spacer" />
      <span className="stat fps">{fps.fps} FPS · {fps.ms.toFixed(1)} MS</span>
      <span className="stat">OUTPUT: {!outputOpen ? 'SIM' : live ? 'LIVE' : 'MAPPING'}</span>
      <button type="button" className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
      </button>
      <button type="button" className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
      </button>
      <TemplateMenu />
      {outputOpen ? (
        <button type="button" className="btn" title="Close the projector window" onClick={closeOutput}>CLOSE OUTPUT</button>
      ) : (
        <button type="button" className="btn" title="Open the projector window with mapping outlines and points showing" onClick={() => void openOutput()}>OPEN OUTPUT</button>
      )}
      {live ? (
        <button type="button" className="btn cyan on" title="Back to mapping: show outlines and points on the projector" onClick={endLive}><span className="dot" />LIVE · END</button>
      ) : (
        <button type="button" className="btn cyan" title="Hide all mapping helpers: the projector shows the show only" onClick={() => void goLive()}><span className="dot" />GO LIVE</button>
      )}
    </header>
  );
}

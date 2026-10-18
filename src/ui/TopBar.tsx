import { useEffect, useState } from 'react';
import { useStore, type Tab } from '../state/store';
import { onStats } from '../engine/loop';
import { goLive, closeOutput } from './golive';
import { warehouseBoxes } from '../model/defaultShow';
import { toast } from './hooks';

const TABS: { id: Tab; label: string }[] = [
  { id: 'rehearsal', label: 'REHEARSAL' },
  { id: 'map', label: 'MAP' },
  { id: 'live', label: 'LIVE' },
];

export function TopBar() {
  const tab = useStore((s) => s.ui.tab);
  const name = useStore((s) => s.show.name);
  const outputOpen = useStore((s) => s.ui.outputOpen);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const { setUi, undo, redo, replaceShow } = useStore.getState();
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
          <button key={t.id} type="button" className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setUi({ tab: t.id })}>{t.label}</button>
        ))}
      </nav>
      <div className="spacer" />
      <span className="stat fps">{fps.fps} FPS · {fps.ms.toFixed(1)} MS</span>
      <span className="stat">OUTPUT: {outputOpen ? 'WINDOW' : 'SIM'}</span>
      <button type="button" className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
      </button>
      <button type="button" className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>
      </button>
      <button
        type="button"
        className="btn"
        title="Replace the current show with the Warehouse boxes template"
        onClick={() => {
          replaceShow(warehouseBoxes());
          toast('Loaded the Warehouse boxes template. Press Ctrl+Z to go back.');
        }}
      >TEMPLATE</button>
      {outputOpen ? (
        <button type="button" className="btn cyan on" onClick={closeOutput}><span className="dot" />LIVE · CLOSE</button>
      ) : (
        <button type="button" className="btn cyan" onClick={() => void goLive()}><span className="dot" />GO LIVE</button>
      )}
    </header>
  );
}

import { useEffect, useRef, useState } from 'react';
import { now, useStore } from '../state/store';
import { formatTime } from '../model/time';

/** Re-renders the component a few times a second (for cue and pad highlights). */
export function useTick(hz = 4): number {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), 1000 / hz);
    return () => clearInterval(id);
  }, [hz]);
  return now();
}

/** Writes the transport time into an element every frame without re-rendering React. */
export function useLiveTime<T extends HTMLElement>(fn: (el: T, t: number) => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      if (ref.current) fn(ref.current, now());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

export function TimeReadout() {
  const duration = useStore((s) => s.show.duration);
  const ref = useLiveTime<HTMLSpanElement>((el, t) => {
    const txt = formatTime(t);
    if (el.textContent !== txt) el.textContent = txt;
  });
  return (
    <span className="time">
      <span ref={ref}>00:00.00</span> <span className="muted">/ {formatTime(duration)}</span>
    </span>
  );
}

let toastTimer = 0;
export function toast(msg: string) {
  window.dispatchEvent(new CustomEvent('ps-toast', { detail: msg }));
  void toastTimer;
}

export function Toast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail);
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => setMsg(null), 2600);
    };
    window.addEventListener('ps-toast', on);
    return () => window.removeEventListener('ps-toast', on);
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

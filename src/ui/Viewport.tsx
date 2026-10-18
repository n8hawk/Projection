import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { registerView, type ViewKind } from '../engine/loop';

interface ViewportProps {
  kind: ViewKind;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
  onEl?: (el: HTMLDivElement | null) => void;
}

/** A transparent hole in the UI; the shared canvas draws this view underneath it. */
export function Viewport({ kind, className = '', style, children, onEl }: ViewportProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    onEl?.(ref.current);
    const off = registerView(ref.current, kind);
    return () => {
      off();
      onEl?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
  return (
    <div ref={ref} className={`viewport ${className}`} style={style}>
      {children}
    </div>
  );
}

/** Sizes its child to the largest 16:9 box that fits. */
export function Fit16x9({ children }: { children: (w: number, h: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  let w = size.w;
  let h = w / (16 / 9);
  if (h > size.h) {
    h = size.h;
    w = h * (16 / 9);
  }
  return <div ref={ref} className="fit">{size.w > 0 && children(Math.floor(w), Math.floor(h))}</div>;
}

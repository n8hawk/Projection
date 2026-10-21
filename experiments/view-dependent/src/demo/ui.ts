// Tiny DOM helpers for the calibration panel. Each control reads its value
// through `get` and writes through `set`, then calls the shared onChange.

type El = HTMLElement;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class PanelBuilder {
  private refreshers: (() => void)[] = [];

  constructor(public root: El, private onChange: () => void) {}

  /** Re-read every control from its getter (after a reset or calibration). */
  refresh(): void { this.refreshers.forEach((r) => r()); }

  /** A collapsible section; its open/closed state is remembered per title. */
  section(title: string, open = true): El {
    const d = h('details', 'section');
    const key = `view-dependent-demo/section/${title}`;
    let saved: string | null = null;
    try { saved = localStorage.getItem(key); } catch { /* storage unavailable */ }
    d.open = saved === null ? open : saved === '1';
    d.addEventListener('toggle', () => {
      try { localStorage.setItem(key, d.open ? '1' : '0'); } catch { /* ignore */ }
    });
    d.append(h('summary', undefined, title));
    this.root.append(d);
    return d;
  }

  slider(parent: El, label: string, o: { min: number; max: number; step: number; unit?: string; digits?: number; get: () => number; set: (v: number) => void }): void {
    const row = h('label', 'row');
    const name = h('span', 'name', label);
    const input = h('input');
    input.type = 'range';
    input.min = String(o.min); input.max = String(o.max); input.step = String(o.step);
    const val = h('span', 'val');
    const show = () => { input.value = String(o.get()); val.textContent = o.get().toFixed(o.digits ?? 1) + (o.unit ?? ''); };
    input.addEventListener('input', () => { o.set(parseFloat(input.value)); show(); this.onChange(); });
    row.append(name, input, val);
    parent.append(row);
    this.refreshers.push(show);
    show();
  }

  number(parent: El, label: string, o: { step: number; unit?: string; get: () => number; set: (v: number) => void }): void {
    const row = h('label', 'row');
    const input = h('input', 'num');
    input.type = 'number';
    input.step = String(o.step);
    const show = () => { if (document.activeElement !== input) input.value = String(+o.get().toFixed(2)); };
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      if (Number.isFinite(v)) { o.set(v); this.onChange(); }
    });
    row.append(h('span', 'name', label), input, h('span', 'unit', o.unit ?? ''));
    parent.append(row);
    this.refreshers.push(show);
    show();
  }

  toggle(parent: El, label: string, o: { get: () => boolean; set: (v: boolean) => void }): void {
    const row = h('label', 'row check');
    const input = h('input');
    input.type = 'checkbox';
    const show = () => { input.checked = o.get(); };
    input.addEventListener('change', () => { o.set(input.checked); this.onChange(); });
    row.append(input, h('span', 'name', label));
    parent.append(row);
    this.refreshers.push(show);
    show();
  }

  select<T extends string>(parent: El, label: string, options: [T, string][], o: { get: () => T; set: (v: T) => void }): HTMLSelectElement {
    const row = h('label', 'row');
    const sel = h('select');
    for (const [v, text] of options) { const op = h('option', undefined, text); op.value = v; sel.append(op); }
    const show = () => { sel.value = o.get(); };
    sel.addEventListener('change', () => { o.set(sel.value as T); this.onChange(); });
    row.append(h('span', 'name', label), sel);
    parent.append(row);
    this.refreshers.push(show);
    show();
    return sel;
  }

  text(parent: El, o: { placeholder?: string; get: () => string; set: (v: string) => void }): HTMLInputElement {
    const input = h('input', 'text');
    input.type = 'text';
    input.placeholder = o.placeholder ?? '';
    const show = () => { input.value = o.get(); };
    input.addEventListener('change', () => { o.set(input.value.trim()); this.onChange(); });
    parent.append(input);
    this.refreshers.push(show);
    show();
    return input;
  }

  buttons(parent: El, items: [string, () => void][]): HTMLButtonElement[] {
    const row = h('div', 'buttons');
    const out = items.map(([text, fn]) => {
      const b = h('button', undefined, text);
      b.type = 'button';
      b.addEventListener('click', fn);
      row.append(b);
      return b;
    });
    parent.append(row);
    return out;
  }

  note(parent: El, text: string): El {
    const p = h('p', 'note', text);
    parent.append(p);
    return p;
  }
}

export { h };

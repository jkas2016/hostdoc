import React from 'react';

/**
 * Tabs — segmented control for switching between views (hosting modes, code
 * variants, doc sections). Uncontrolled by default; pass `value`/`onChange`
 * to control it. `variant` 'underline' for section nav, 'segmented' for a
 * pill control.
 */
export function Tabs({ tabs = [], value, defaultValue, onChange, variant = 'underline', style = {}, children }) {
  const ids = tabs.map(t => (typeof t === 'string' ? t : t.id));
  const [internal, setInternal] = React.useState(defaultValue ?? ids[0]);
  const active = value !== undefined ? value : internal;
  const select = (id) => { if (value === undefined) setInternal(id); onChange && onChange(id); };

  const isSeg = variant === 'segmented';
  const listStyle = isSeg
    ? { display: 'inline-flex', gap: 2, padding: 3, background: 'var(--surface-sunken)', border: '1px solid var(--line)', borderRadius: 'var(--r-md)' }
    : { display: 'flex', gap: 4, borderBottom: '1px solid var(--line)' };

  return (
    <div style={style}>
      <div role="tablist" style={listStyle}>
        {tabs.map(t => {
          const id = typeof t === 'string' ? t : t.id;
          const label = typeof t === 'string' ? t : t.label;
          const on = id === active;
          const segBtn = {
            padding: '6px 14px', borderRadius: 'var(--r-sm)', border: 'none',
            background: on ? 'var(--surface)' : 'transparent',
            color: on ? 'var(--ink-900)' : 'var(--ink-500)',
            boxShadow: on ? 'var(--shadow-xs)' : 'none', fontWeight: on ? 600 : 500,
          };
          const underBtn = {
            padding: '9px 4px', margin: '0 8px -1px 0', border: 'none', background: 'none',
            borderBottom: `2px solid ${on ? 'var(--cobalt-600)' : 'transparent'}`,
            color: on ? 'var(--ink-900)' : 'var(--ink-500)', fontWeight: on ? 600 : 500,
          };
          return (
            <button key={id} role="tab" aria-selected={on} onClick={() => select(id)} style={{
              cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 14,
              lineHeight: 1, transition: 'color var(--dur-fast), background var(--dur-fast)',
              ...(isSeg ? segBtn : underBtn),
            }}>{label}</button>
          );
        })}
      </div>
      {typeof children === 'function' ? children(active) : children}
    </div>
  );
}

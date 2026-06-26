import React from 'react';

/**
 * Badge — small status / category label.
 * Tones: neutral, brand, success, warning, danger. Optional leading dot.
 */
export function Badge({ tone = 'neutral', dot = false, size = 'md', style = {}, children, ...rest }) {
  const tones = {
    neutral: { bg: 'var(--surface-sunken)', fg: 'var(--ink-700)', bd: 'var(--line)', dot: 'var(--ink-400)' },
    brand:   { bg: 'var(--cobalt-50)', fg: 'var(--cobalt-700)', bd: 'var(--cobalt-100)', dot: 'var(--cobalt-500)' },
    success: { bg: 'var(--success-100)', fg: 'var(--success-600)', bd: 'transparent', dot: 'var(--success-600)' },
    warning: { bg: 'var(--warning-100)', fg: 'var(--warning-600)', bd: 'transparent', dot: 'var(--warning-600)' },
    danger:  { bg: 'var(--danger-100)', fg: 'var(--danger-600)', bd: 'transparent', dot: 'var(--danger-600)' },
  };
  const t = tones[tone] || tones.neutral;
  const sm = size === 'sm';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: sm ? 5 : 6,
      background: t.bg, color: t.fg, border: `1px solid ${t.bd}`,
      padding: sm ? '2px 8px' : '3px 10px',
      borderRadius: 'var(--r-pill)',
      fontFamily: 'var(--font-mono)', fontSize: sm ? 11 : 12, fontWeight: 500,
      letterSpacing: '0.01em', lineHeight: 1.4, whiteSpace: 'nowrap',
      ...style,
    }} {...rest}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: t.dot, flex: '0 0 auto' }} />}
      {children}
    </span>
  );
}

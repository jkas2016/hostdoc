import React from 'react';

/**
 * Note — a doc callout for tips, warnings, and status. Tinted surface with a
 * left accent rule and a glyph. Tones: info, warning, success, danger.
 */
export function Note({ tone = 'info', title = '', style = {}, children, ...rest }) {
  const tones = {
    info:    { bg: 'var(--cobalt-50)', accent: 'var(--cobalt-500)', fg: 'var(--cobalt-800)', glyph: 'i' },
    warning: { bg: 'var(--warning-100)', accent: 'var(--warning-600)', fg: '#7a4e0e', glyph: '!' },
    success: { bg: 'var(--success-100)', accent: 'var(--success-600)', fg: '#0f5c3a', glyph: '✓' },
    danger:  { bg: 'var(--danger-100)', accent: 'var(--danger-600)', fg: '#8c2417', glyph: '×' },
  };
  const t = tones[tone] || tones.info;
  return (
    <div role="note" style={{
      display: 'flex', gap: 12,
      background: t.bg, borderLeft: `3px solid ${t.accent}`,
      borderRadius: '0 var(--r-md) var(--r-md) 0',
      padding: '14px 16px 14px 14px', ...style,
    }} {...rest}>
      <span aria-hidden="true" style={{
        flex: '0 0 auto', width: 20, height: 20, marginTop: 1,
        borderRadius: '50%', background: t.accent, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, lineHeight: 1,
      }}>{t.glyph}</span>
      <div style={{ fontSize: 14.5, lineHeight: 1.55, color: t.fg }}>
        {title && <div style={{ fontWeight: 600, marginBottom: 3, color: t.fg }}>{title}</div>}
        <div style={{ color: 'var(--ink-700)' }}>{children}</div>
      </div>
    </div>
  );
}

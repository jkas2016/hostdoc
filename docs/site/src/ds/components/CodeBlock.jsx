import React from 'react';

/**
 * CodeBlock — a syntax-neutral code panel with optional filename header,
 * language tag, and copy button. theme 'dark' matches the terminal surface;
 * 'light' uses the warm sunken surface for inline doc snippets.
 */
export function CodeBlock({ code = '', lang = '', filename = '', theme = 'light', copyable = true, style = {}, ...rest }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    try { navigator.clipboard.writeText(code); } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const dark = theme === 'dark';
  const surface = dark ? 'var(--term-bg)' : 'var(--surface-sunken)';
  const fg = dark ? 'var(--term-fg)' : 'var(--ink-800)';
  const headerBg = dark ? 'var(--term-bg-2)' : 'var(--surface)';
  const line = dark ? 'var(--term-line)' : 'var(--line)';
  const muted = dark ? 'var(--term-muted)' : 'var(--ink-500)';
  const hasHeader = filename || lang || copyable;

  return (
    <div style={{
      background: surface, borderRadius: 'var(--r-md)',
      border: `1px solid ${line}`, overflow: 'hidden',
      boxShadow: dark ? 'var(--shadow-term)' : 'none', ...style,
    }} {...rest}>
      {hasHeader && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 12px 8px 14px', background: headerBg,
          borderBottom: `1px solid ${line}`,
        }}>
          <span style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12, color: fg, fontWeight: 500 }}>{filename}</span>
          {lang && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, letterSpacing: '0.06em', textTransform: 'uppercase', color: muted }}>{lang}</span>}
          {copyable && (
            <button onClick={copy} style={{
              border: 'none', background: 'transparent',
              color: copied ? (dark ? 'var(--term-prompt)' : 'var(--success-600)') : muted,
              fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
              padding: '3px 7px', borderRadius: 'var(--r-xs)',
            }}>{copied ? 'copied ✓' : 'copy'}</button>
          )}
        </div>
      )}
      <pre style={{
        margin: 0, padding: '14px 16px', fontFamily: 'var(--font-mono)',
        fontSize: 13, lineHeight: 1.6, color: fg, overflowX: 'auto',
      }}><code>{code}</code></pre>
    </div>
  );
}

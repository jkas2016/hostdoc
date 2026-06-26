import React from 'react';

/**
 * Terminal — a titled terminal window for CLI commands and their output.
 * Pass `lines` as [{ type, text }] where type is
 * 'cmd' | 'comment' | 'out' | 'success' | 'error'. Commands render with a
 * green prompt; a copy button copies all command lines.
 */
export function Terminal({ title = 'bash', lines = [], copyable = true, style = {}, ...rest }) {
  const [copied, setCopied] = React.useState(false);
  const cmdText = lines.filter(l => l.type === 'cmd').map(l => l.text).join('\n');

  const copy = () => {
    try { navigator.clipboard.writeText(cmdText); } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const colors = {
    cmd: 'var(--term-fg)',
    comment: 'var(--term-muted)',
    out: 'var(--term-muted)',
    success: 'var(--term-prompt)',
    error: '#f3897a',
  };

  return (
    <div style={{
      background: 'var(--term-bg)', borderRadius: 'var(--r-md)',
      boxShadow: 'var(--shadow-term)', overflow: 'hidden',
      border: '1px solid var(--term-line)', ...style,
    }} {...rest}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 14px', background: 'var(--term-bg-2)',
        borderBottom: '1px solid var(--term-line)',
      }}>
        <span style={{ display: 'flex', gap: 6 }}>
          {['#ff5f57', '#febc2e', '#28c840'].map(c => (
            <span key={c} style={{ width: 11, height: 11, borderRadius: '50%', background: c }} />
          ))}
        </span>
        <span style={{
          flex: 1, textAlign: 'center', fontFamily: 'var(--font-mono)',
          fontSize: 12, color: 'var(--term-muted)', letterSpacing: '0.02em',
          marginRight: copyable ? 0 : 40,
        }}>{title}</span>
        {copyable && (
          <button onClick={copy} style={{
            border: 'none', background: copied ? 'var(--term-line)' : 'transparent',
            color: copied ? 'var(--term-prompt)' : 'var(--term-muted)',
            fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
            padding: '3px 8px', borderRadius: 'var(--r-xs)',
            transition: 'color var(--dur-fast), background var(--dur-fast)',
          }}>{copied ? 'copied ✓' : 'copy'}</button>
        )}
      </div>
      <div style={{
        padding: '14px 16px', fontFamily: 'var(--font-mono)',
        fontSize: 13.5, lineHeight: 1.7, color: 'var(--term-fg)',
        overflowX: 'auto',
      }}>
        {lines.map((l, i) => (
          <div key={i} style={{ color: colors[l.type] || 'var(--term-fg)', whiteSpace: 'pre' }}>
            {l.type === 'cmd' && <span style={{ color: 'var(--term-prompt)', userSelect: 'none' }}>$ </span>}
            {l.type === 'success' && <span style={{ userSelect: 'none' }}>✓ </span>}
            {l.text}
          </div>
        ))}
      </div>
    </div>
  );
}

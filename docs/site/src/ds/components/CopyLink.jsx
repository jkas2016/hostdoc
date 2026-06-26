import React from 'react';

/**
 * CopyLink — the shareable result of `hostdoc publish`: a short link in a
 * pill with a protocol badge (HTTP/HTTPS) and a one-click copy button.
 */
export function CopyLink({ url = '', label = '', style = {}, ...rest }) {
  const [copied, setCopied] = React.useState(false);
  const isHttps = /^https:/i.test(url);
  const copy = () => {
    try { navigator.clipboard.writeText(url); } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const display = url.replace(/^https?:\/\//, '');
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 0,
      background: 'var(--surface)', border: '1px solid var(--line-strong)',
      borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden', maxWidth: '100%', ...style,
    }} {...rest}>
      <span style={{
        flex: '0 0 auto', alignSelf: 'stretch', display: 'flex', alignItems: 'center',
        padding: '0 10px', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
        letterSpacing: '0.04em',
        background: isHttps ? 'var(--cobalt-50)' : 'var(--surface-sunken)',
        color: isHttps ? 'var(--cobalt-700)' : 'var(--ink-500)',
        borderRight: '1px solid var(--line)',
      }}>{isHttps ? 'HTTPS' : 'HTTP'}</span>
      <span style={{
        flex: 1, minWidth: 0, padding: '9px 12px',
        fontFamily: 'var(--font-mono)', fontSize: 13.5, color: 'var(--ink-800)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }} title={url}>{label || display}</span>
      <button onClick={copy} aria-label="Copy link" style={{
        flex: '0 0 auto', alignSelf: 'stretch', border: 'none',
        borderLeft: '1px solid var(--line)', cursor: 'pointer',
        padding: '0 14px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600,
        background: copied ? 'var(--cobalt-600)' : 'var(--surface)',
        color: copied ? '#fff' : 'var(--cobalt-600)',
        transition: 'background var(--dur-fast), color var(--dur-fast)',
      }}>{copied ? 'copied ✓' : 'copy'}</button>
    </div>
  );
}

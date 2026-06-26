// Reusable prose primitives for docs pages — eyebrow kicker, anchored section,
// body paragraph, and inline code. Shared across the guide and future pages so
// type rhythm stays identical everywhere.

export function Eyebrow({ children }) {
  return (
    <div style={{
      fontFamily: 'var(--font-mono)', fontSize: 12, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: 'var(--cobalt-600)', fontWeight: 600, marginBottom: 12,
    }}>{children}</div>
  );
}

export function Section({ id, kicker, title, children }) {
  return (
    <section id={id} style={{ scrollMarginTop: 80, paddingTop: 56 }}>
      {kicker && <Eyebrow>{kicker}</Eyebrow>}
      <h2 style={{ fontSize: 28, marginBottom: 14 }}>{title}</h2>
      {children}
    </section>
  );
}

export function P({ children, muted }) {
  return (
    <p style={{
      fontSize: 16, lineHeight: 1.65,
      color: muted ? 'var(--ink-500)' : 'var(--ink-700)',
      maxWidth: 680, margin: '0 0 16px',
    }}>{children}</p>
  );
}

// Inline code chip (matches the base.css inline-code treatment).
export function C({ children }) {
  return (
    <code style={{
      background: 'var(--surface-sunken)', border: '1px solid var(--line)', color: 'var(--ink-800)',
      padding: '0.12em 0.4em', borderRadius: 4, fontSize: '0.86em', fontFamily: 'var(--font-mono)',
    }}>{children}</code>
  );
}

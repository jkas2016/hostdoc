// hostdoc docs — application shell: top bar, left section nav (scroll-spy),
// fluid content column. Reusable across docs pages: pass the page's own
// `sections` ([{ id, label }]) and the page body as children.
import React from 'react';
const { useState, useEffect } = React;

export function Logo({ size = 30 }) {
  const r = size * 0.27;
  return (
    <span style={{
      width: size, height: size, borderRadius: r, background: 'var(--cobalt-600)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: 'var(--shadow-xs)', flex: '0 0 auto',
    }}>
      <svg width={size * 0.66} height={size * 0.66} viewBox="0 0 30 30" fill="none" aria-hidden="true">
        <path d="M10.8 7H16.8L21 11.2V21.6A1.4 1.4 0 0 1 19.6 23H10.8A1.4 1.4 0 0 1 9.4 21.6V8.4A1.4 1.4 0 0 1 10.8 7Z" fill="#fbfaf6"/>
        <path d="M16.8 7V10A1.4 1.4 0 0 0 18.2 11.2H21L16.8 7Z" fill="#c2cdff"/>
        <path d="M15 21.1V14.5" stroke="#1a8f5c" strokeWidth="1.7" strokeLinecap="round"/>
        <path d="M12.4 16.4L15 13.8L17.6 16.4" stroke="#1a8f5c" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

function TopBar() {
  const linkS = { color: 'var(--ink-600)', fontSize: 14, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 };
  return (
    <header style={{
      position: 'sticky', top: 0, zIndex: 20, height: 60,
      display: 'flex', alignItems: 'center', gap: 16,
      padding: '0 28px', background: 'rgba(251,250,246,0.82)',
      backdropFilter: 'saturate(180%) blur(12px)', WebkitBackdropFilter: 'saturate(180%) blur(12px)',
      borderBottom: '1px solid var(--line)',
    }}>
      <a href="#" style={{ display: 'inline-flex', alignItems: 'center', gap: 11, textDecoration: 'none' }}>
        <Logo size={30} />
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 20, letterSpacing: '-0.02em', color: 'var(--ink-900)' }}>hostdoc</span>
      </a>
      <span className="hd-pill" style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-500)',
        border: '1px solid var(--line)', borderRadius: 'var(--r-pill)', padding: '2px 9px',
        background: 'var(--surface)',
      }}>v1 · S3 + CloudFront</span>
      <div style={{ flex: 1 }} />
      <nav style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <a href="https://github.com/jkas2016/hostdoc" style={linkS}>GitHub</a>
        <a href="https://www.npmjs.com/package/hostdoc" style={linkS}>npm</a>
        <a href="https://github.com/jkas2016/hostdoc/issues" style={linkS}>Issues</a>
      </nav>
    </header>
  );
}

function Sidebar({ sections, active }) {
  return (
    <nav aria-label="Sections" style={{ display: 'flex', flexDirection: 'column', gap: 1, position: 'sticky', top: 84 }}>
      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--ink-400)', padding: '0 12px 10px',
      }}>Guide</div>
      {sections.map(s => {
        const on = s.id === active;
        return (
          <a key={s.id} href={'#' + s.id} style={{
            display: 'block', padding: '7px 12px', borderRadius: 'var(--r-sm)',
            fontSize: 14, lineHeight: 1.3, textDecoration: 'none',
            color: on ? 'var(--cobalt-700)' : 'var(--ink-600)',
            background: on ? 'var(--cobalt-50)' : 'transparent',
            fontWeight: on ? 600 : 500,
            borderLeft: on ? '2px solid var(--cobalt-600)' : '2px solid transparent',
          }}>{s.label}</a>
        );
      })}
    </nav>
  );
}

export function DocsShell({ sections = [], children }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const opts = { rootMargin: '-72px 0px -70% 0px', threshold: 0 };
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
    }, opts);
    sections.forEach(s => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [sections]);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-page)' }}>
      <style>{`
        @media (max-width: 880px) {
          .hd-side { display: none !important; }
          .hd-grid { grid-template-columns: 1fr !important; gap: 0 !important; }
          .hd-pill { display: none !important; }
        }
      `}</style>
      <TopBar />
      <div className="hd-grid" style={{
        maxWidth: 1200, margin: '0 auto', padding: '0 28px',
        display: 'grid', gridTemplateColumns: '220px minmax(0,1fr)', gap: 48,
        alignItems: 'start',
      }}>
        <aside className="hd-side" style={{ paddingTop: 40, alignSelf: 'stretch' }}>
          <Sidebar sections={sections} active={active} />
        </aside>
        <main style={{ paddingTop: 8, paddingBottom: 120, minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  );
}

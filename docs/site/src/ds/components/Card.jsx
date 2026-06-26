import React from 'react';

/**
 * Card — raised or outlined surface container.
 * Variants: outline (default), raised (shadow), sunken (inset well).
 */
export function Card({ variant = 'outline', padding = 'md', style = {}, children, ...rest }) {
  const pads = { none: 0, sm: 'var(--space-4)', md: 'var(--space-6)', lg: 'var(--space-8)' };
  const variants = {
    outline: { background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'none' },
    raised:  { background: 'var(--surface)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-md)' },
    sunken:  { background: 'var(--surface-sunken)', border: '1px solid var(--line)', boxShadow: 'none' },
  };
  return (
    <div style={{
      borderRadius: 'var(--r-lg)',
      padding: pads[padding] ?? pads.md,
      ...(variants[variant] || variants.outline),
      ...style,
    }} {...rest}>
      {children}
    </div>
  );
}

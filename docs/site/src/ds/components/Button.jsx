import React from 'react';

/**
 * hostdoc Button — primary actions, links styled as buttons.
 * Variants: primary (cobalt), secondary (outline), ghost, danger.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  iconBefore = null,
  iconAfter = null,
  disabled = false,
  fullWidth = false,
  as = 'button',
  style = {},
  children,
  ...rest
}) {
  const sizes = {
    sm: { padding: '0 12px', height: 32, fontSize: 13, gap: 6 },
    md: { padding: '0 16px', height: 40, fontSize: 14, gap: 8 },
    lg: { padding: '0 22px', height: 48, fontSize: 15, gap: 9 },
  };
  const variants = {
    primary: {
      background: 'var(--cobalt-600)', color: '#fff',
      border: '1px solid var(--cobalt-600)',
      boxShadow: 'var(--shadow-xs)',
      '--hover-bg': 'var(--cobalt-700)', '--hover-border': 'var(--cobalt-700)',
    },
    secondary: {
      background: 'var(--surface)', color: 'var(--ink-800)',
      border: '1px solid var(--line-strong)',
      boxShadow: 'var(--shadow-xs)',
      '--hover-bg': 'var(--surface-sunken)', '--hover-border': 'var(--ink-300)',
    },
    ghost: {
      background: 'transparent', color: 'var(--ink-700)',
      border: '1px solid transparent',
      '--hover-bg': 'var(--surface-sunken)', '--hover-border': 'transparent',
    },
    danger: {
      background: 'var(--danger-600)', color: '#fff',
      border: '1px solid var(--danger-600)',
      '--hover-bg': '#b8331f', '--hover-border': '#b8331f',
    },
  };
  const sz = sizes[size] || sizes.md;
  const vr = variants[variant] || variants.primary;
  const Tag = as;

  const [hover, setHover] = React.useState(false);
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: sz.gap, height: sz.height, padding: sz.padding,
    fontFamily: 'var(--font-sans)', fontSize: sz.fontSize, fontWeight: 600,
    lineHeight: 1, letterSpacing: '-0.005em', borderRadius: 'var(--r-sm)',
    cursor: disabled ? 'not-allowed' : 'pointer', textDecoration: 'none',
    width: fullWidth ? '100%' : undefined,
    opacity: disabled ? 0.5 : 1,
    transition: 'background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out)',
    transform: hover && !disabled ? 'translateY(-1px)' : 'none',
    ...vr,
    ...(hover && !disabled ? { background: vr['--hover-bg'], borderColor: vr['--hover-border'] } : null),
    ...style,
  };

  return (
    <Tag
      style={base}
      disabled={Tag === 'button' ? disabled : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      {...rest}
    >
      {iconBefore}
      {children}
      {iconAfter}
    </Tag>
  );
}

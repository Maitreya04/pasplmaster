import { normalizeUom } from '../../lib/picking/pickerMicrocopy';

const UOM_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  PCS: {
    bg: 'var(--bg-positive-subtle)',
    text: 'var(--content-positive)',
    border: 'var(--border-positive)',
  },
  SET: {
    bg: 'var(--bg-accent-subtle)',
    text: 'var(--content-accent)',
    border: 'var(--border-accent)',
  },
  PAIR: {
    bg: 'var(--bg-info-subtle, var(--bg-accent-subtle))',
    text: 'var(--content-accent)',
    border: 'var(--border-subtle)',
  },
  KIT: {
    bg: 'var(--bg-warning-subtle)',
    text: 'var(--content-warning-on-light)',
    border: 'var(--border-warning)',
  },
};

export interface UomBadgeProps {
  uom: string;
  className?: string;
}

export function UomBadge({ uom, className = '' }: UomBadgeProps): React.JSX.Element {
  const key = normalizeUom(uom);
  const style = UOM_STYLES[key] ?? UOM_STYLES.PCS;

  return (
    <span
      className={`inline-flex shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${className}`}
      style={{
        backgroundColor: style.bg,
        color: style.text,
        borderColor: style.border,
      }}
    >
      {key}
    </span>
  );
}

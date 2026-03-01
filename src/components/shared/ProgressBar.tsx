interface Segment {
  value: number;
  color: 'green' | 'red' | 'gray';
}

interface ProgressBarProps {
  segments: Segment[];
  total: number;
  className?: string;
}

const colorMap: Record<Segment['color'], string> = {
  green: 'bg-[var(--bg-positive)]',
  red: 'bg-[var(--bg-negative)]',
  gray: 'bg-[var(--border-subtle)]',
};

export function ProgressBar({ segments, total, className = '' }: ProgressBarProps) {
  if (total === 0) return null;

  return (
    <div className={`flex gap-0.5 h-1.5 rounded-full overflow-hidden bg-[var(--bg-tertiary)] ${className}`}>
      {segments.map((seg, i) => {
        const pct = (seg.value / total) * 100;
        if (pct === 0) return null;
        return (
          <div
            key={i}
            className={`${colorMap[seg.color]} rounded-full transition-all duration-300`}
            style={{ width: `${pct}%` }}
          />
        );
      })}
    </div>
  );
}

type SkeletonVariant = 'text' | 'card' | 'list';

interface SkeletonProps {
  variant?: SkeletonVariant;
  count?: number;
  lines?: number;
  className?: string;
}

function PulseLine({ width = 'w-full' }: { width?: string }) {
  return (
    <div className={`h-4 ${width} rounded-xl bg-[var(--bg-tertiary)] animate-pulse`} />
  );
}

function TextSkeleton({ lines = 3 }: { lines: number }) {
  const widths = ['w-full', 'w-5/6', 'w-4/6', 'w-3/4', 'w-2/3'];
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <PulseLine key={i} width={widths[i % widths.length]} />
      ))}
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="rounded-2xl bg-[var(--bg-tertiary)] p-5 space-y-3 animate-pulse">
      <div className="h-5 w-2/3 rounded-xl bg-[var(--border-subtle)]" />
      <div className="h-4 w-full rounded-xl bg-[var(--border-subtle)]" />
      <div className="h-4 w-4/5 rounded-xl bg-[var(--border-subtle)]" />
      <div className="flex justify-between pt-1">
        <div className="h-4 w-20 rounded-xl bg-[var(--border-subtle)]" />
        <div className="h-4 w-16 rounded-xl bg-[var(--border-subtle)]" />
      </div>
    </div>
  );
}

function ListSkeleton({ lines = 4 }: { lines: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 animate-pulse">
          <div className="h-10 w-10 rounded-xl bg-[var(--bg-tertiary)] shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 rounded-xl bg-[var(--bg-tertiary)]" />
            <div className="h-3 w-1/2 rounded-xl bg-[var(--bg-tertiary)]" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Skeleton({
  variant = 'text',
  count = 1,
  lines = 3,
  className = '',
}: SkeletonProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => {
        switch (variant) {
          case 'card':
            return <CardSkeleton key={i} />;
          case 'list':
            return <ListSkeleton key={i} lines={lines} />;
          case 'text':
          default:
            return <TextSkeleton key={i} lines={lines} />;
        }
      })}
    </div>
  );
}

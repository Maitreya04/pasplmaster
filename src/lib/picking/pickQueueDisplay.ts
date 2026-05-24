export interface OrderItemPreview {
  item_name: string | null;
  state: string;
  rack_no: string | null;
}

export function summarizeOrderItems(names: string[], max = 3): string {
  const trimmed = names.map((n) => n.trim()).filter(Boolean);
  if (trimmed.length === 0) return '';
  const shown = trimmed.slice(0, max);
  const summary = shown.join(', ');
  if (trimmed.length > max) return `${summary}…`;
  return summary;
}

function normalizeRackToken(rack: string): string {
  return rack.trim().toUpperCase();
}

export function summarizeRackRange(rackNos: (string | null | undefined)[]): string | null {
  const unique = [...new Set(
    rackNos
      .map((r) => (r ?? '').trim())
      .filter(Boolean)
      .map(normalizeRackToken),
  )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (unique.length === 0) return null;
  if (unique.length === 1) return `Rack ${unique[0]}`;
  return `Rack ${unique[0]} → ${unique[unique.length - 1]}`;
}

export function computePickProgress(
  items: { state: string }[],
): { done: number; total: number; ratio: number } {
  const total = items.length;
  if (total === 0) return { done: 0, total: 0, ratio: 0 };
  let done = 0;
  for (const item of items) {
    if (item.state === 'picked' || item.state === 'flagged') done += 1;
  }
  return { done, total, ratio: done / total };
}

export function pickStatusLabel(ratio: number): 'Almost done' | 'In progress' {
  return ratio >= 0.8 ? 'Almost done' : 'In progress';
}

export function itemSummaryFromPreview(items: OrderItemPreview[] | undefined, max = 3): string {
  if (!items?.length) return '';
  return summarizeOrderItems(
    items.map((i) => i.item_name ?? ''),
    max,
  );
}

export function rackRangeFromPreview(items: OrderItemPreview[] | undefined): string | null {
  if (!items?.length) return null;
  return summarizeRackRange(items.map((i) => i.rack_no));
}

export function pickProgressFromPreview(
  items: OrderItemPreview[] | undefined,
): { done: number; total: number; ratio: number } {
  if (!items?.length) return { done: 0, total: 0, ratio: 0 };
  return computePickProgress(items);
}

export function formatQueueTimeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Exact clock time when billing approved — pickers plan around cut-offs, not "ago". */
export function formatBilledTime(
  approvedAt: string | null | undefined,
  createdAt?: string | null,
): string {
  const when = approvedAt ?? createdAt;
  if (!when) return '';
  const d = new Date(when);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const time = d.toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  if (d.toDateString() === now.toDateString()) return time;
  const date = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `${date}, ${time}`;
}

/** When billing approved the order — primary queue timing signal for pickers. */
export function formatBilledLabel(
  approvedAt: string | null | undefined,
  createdAt?: string | null,
): string {
  const exact = formatBilledTime(approvedAt, createdAt);
  return exact ? `Billed ${exact}` : '';
}

export function formatLineCountLabel(
  count: number,
  opts?: { short?: boolean },
): string {
  const n = Math.max(0, count);
  const word = n === 1 ? 'line' : 'lines';
  if (opts?.short) return `${n} ${word}`;
  return `${n} ${word} on bill`;
}


export function initialsFromName(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[parts.length - 1][0] ?? ''}`.toUpperCase();
}

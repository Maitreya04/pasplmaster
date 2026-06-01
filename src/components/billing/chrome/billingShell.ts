/** Shared layout tokens for billing order chrome (Geist-density). */
export const billingShell = {
  /** Horizontal padding for every chrome band + table */
  x: 'px-4',
  /** Top nav bar (back + reject) — 48px */
  nav: 'billing-chrome-nav shrink-0',
  /** Bill header / identity — 44px */
  header: 'billing-chrome-identity shrink-0',
  /** Stage bar — 32px */
  stages: 'billing-chrome-stage shrink-0',
  /** Stage bar when all stages complete */
  stagesDone: 'billing-chrome-stage billing-chrome-stage--done shrink-0',
  /** Context bar — 36px */
  context: 'billing-chrome-context shrink-0',
  /** Context bar with stale-urgent tint */
  contextUrgent: 'billing-chrome-context billing-chrome-context--urgent shrink-0',
  /** Summary bar — 44px */
  summary: 'h-12 px-4 flex items-center gap-4 border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]',
  /** Action bar — 48px */
  actions: 'h-14 px-4 flex items-center gap-3 border-t border-[var(--border-faint)] bg-[var(--bg-primary)]',
  /** Scrollable work surface */
  body: 'px-0',
  /** Meta pill base + intent variants */
  metaPill: 'billing-meta-pill',
  metaPillAccent: 'billing-meta-pill billing-meta-pill--accent',
  metaPillNeutral: 'billing-meta-pill billing-meta-pill--neutral',
  metaPillWarning: 'billing-meta-pill billing-meta-pill--warning',
  metaPillNegative: 'billing-meta-pill billing-meta-pill--negative',
  metaPillPositive: 'billing-meta-pill billing-meta-pill--positive',
  orderId: 'billing-chrome-order-id',
  /** @deprecated use specific zone tokens */
  title: 'px-4 pt-3 pb-2.5 border-b border-[var(--border-faint)]',
  toolbar: 'px-4 py-2 border-b border-[var(--border-faint)]',
  steps: 'px-4 border-b border-[var(--border-faint)]',
  footer: 'px-4 py-2.5 border-t border-[var(--border-faint)] bg-[var(--bg-secondary)]',
} as const;

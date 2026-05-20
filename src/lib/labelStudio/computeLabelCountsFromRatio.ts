import type { ReceiveMode, SellUnitPaspl } from '../../types/receiving';

export interface RatioInput {
  receiveMode: ReceiveMode;
  masterCartonQty: number;
  innerPerMaster: number | null;
  /** For inner_only: operator-entered inner count. Ignored for structured (derived). */
  innerPackCount: number;
  eaPerInner: number;
  /** Loose receive: direct total eaches */
  looseTotalEa?: number;
}

export interface LabelCountsResult {
  masterLabelsCount: number;
  innerLabelsCount: number;
  /** Always 0 at job creation (each labels only on break). */
  eachLabelsCountAtJob: number;
  totalEa: number;
  warnings: string[];
  /** Structured mode: inner count was derived from master × ipm */
  derivedInnerPackCount: boolean;
}

export function deriveInnerPackCount(args: {
  receiveMode: ReceiveMode;
  masterCartonQty: number;
  innerPerMaster: number | null;
  manualInnerPackCount?: number;
}): number {
  if (args.receiveMode === 'structured') {
    const masters = Math.max(0, Math.floor(args.masterCartonQty));
    const ipm = Math.max(0, Math.floor(args.innerPerMaster ?? 0));
    return masters * ipm;
  }
  return Math.max(0, Math.floor(args.manualInnerPackCount ?? 0));
}

/**
 * Computes master/inner label counts from confirmed physical ratio.
 * Each labels are never counted at job creation.
 */
export function computeLabelCountsFromRatio(input: RatioInput): LabelCountsResult {
  const warnings: string[] = [];
  const eachLabelsCountAtJob = 0;

  if (input.receiveMode === 'loose') {
    const total = Math.max(0, Math.floor(input.looseTotalEa ?? 0));
    if (total <= 0) warnings.push('Loose mode: total EA should be > 0 for stock entry.');
    return {
      masterLabelsCount: 0,
      innerLabelsCount: 0,
      eachLabelsCountAtJob,
      totalEa: total,
      warnings,
      derivedInnerPackCount: false,
    };
  }

  const ea = Math.max(1, Math.floor(input.eaPerInner || 1));
  const derived = input.receiveMode === 'structured';
  const innerPacks = derived
    ? deriveInnerPackCount({
        receiveMode: input.receiveMode,
        masterCartonQty: input.masterCartonQty,
        innerPerMaster: input.innerPerMaster,
      })
    : Math.max(0, Math.floor(input.innerPackCount));

  if (input.receiveMode === 'structured') {
    const masters = Math.max(0, Math.floor(input.masterCartonQty));
    const ipm = Math.max(0, Math.floor(input.innerPerMaster ?? 0));
    if (masters > 0 && ipm <= 0) {
      warnings.push('Set inner boxes per outer carton.');
    }
    if (masters <= 0) warnings.push('Outer carton count should be > 0.');
    const totalEa = innerPacks * ea;
    return {
      masterLabelsCount: masters,
      innerLabelsCount: innerPacks,
      eachLabelsCountAtJob,
      totalEa,
      warnings,
      derivedInnerPackCount: true,
    };
  }

  // inner_only
  const totalEa = innerPacks * ea;
  if (innerPacks <= 0) warnings.push('Inner-only mode: set inner pack count > 0.');
  return {
    masterLabelsCount: 0,
    innerLabelsCount: innerPacks,
    eachLabelsCountAtJob,
    totalEa,
    warnings,
    derivedInnerPackCount: false,
  };
}

export function ratioMatchesNominal(args: {
  receiveMode: ReceiveMode;
  nominalOuter: number | null;
  nominalInner: number | null;
  innerPackCount: number;
  masterCartonQty: number;
  innerPerMaster: number | null;
}): boolean | null {
  if (args.receiveMode === 'loose') return null;
  const no = args.nominalOuter;
  const ni = args.nominalInner;
  if (no == null && ni == null) return null;
  if (args.receiveMode === 'structured') {
    if (ni != null && args.innerPerMaster != null && args.innerPerMaster !== ni) return false;
    if (no != null && args.masterCartonQty > 0) {
      const expectedInners = args.masterCartonQty * (args.innerPerMaster ?? ni ?? 0);
      if (expectedInners !== args.innerPackCount) return false;
    }
    return true;
  }
  if (args.receiveMode === 'inner_only' && ni != null) {
    return true;
  }
  return null;
}

export function normalizeSellUnit(raw: string | null | undefined): SellUnitPaspl {
  const u = raw?.trim().toUpperCase();
  if (u === 'PACK' || u === 'BOTH') return u;
  return 'EACH';
}

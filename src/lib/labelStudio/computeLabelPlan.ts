import type { ReceiveMode } from '../../types/receiving';

export interface LabelPlanInput {
  receiveMode: ReceiveMode;
  outerLabels: number;
  innerLabels: number;
  pieceLabels: number;
  pcsPerInner: number;
  /** Loose mode: direct total pieces */
  looseTotalEa?: number;
}

export interface LabelPlanResult {
  masterLabelsCount: number;
  innerLabelsCount: number;
  eachLabelsCount: number;
  totalEa: number;
  masterCartonQty: number;
  innerPerMaster: number | null;
  innerPackCount: number;
  eaPerInner: number;
  warnings: string[];
}

/**
 * Label-count-first receiving: operator types how many labels to print per tier.
 * Does not derive inner label count from outer × inners-per-outer.
 */
export function computeLabelPlan(input: LabelPlanInput): LabelPlanResult {
  const warnings: string[] = [];

  if (input.receiveMode === 'loose') {
    const total = Math.max(0, Math.floor(input.looseTotalEa ?? 0));
    if (total <= 0) warnings.push('Enter total pieces for loose receive.');
    return {
      masterLabelsCount: 0,
      innerLabelsCount: 0,
      eachLabelsCount: 0,
      totalEa: total,
      masterCartonQty: 0,
      innerPerMaster: null,
      innerPackCount: 0,
      eaPerInner: Math.max(1, Math.floor(input.pcsPerInner || 1)),
      warnings,
    };
  }

  const outer = Math.max(0, Math.floor(input.outerLabels));
  const inner = Math.max(0, Math.floor(input.innerLabels));
  const piece = Math.max(0, Math.floor(input.pieceLabels));
  const pcs = Math.max(1, Math.floor(input.pcsPerInner || 1));

  if (inner > 0 && pcs <= 0) {
    warnings.push('Pieces per inner is required when printing inner labels.');
  }
  if (outer === 0 && inner === 0 && piece === 0) {
    warnings.push('Enter at least one label count to print.');
  }

  const totalEa = piece + inner * pcs;

  return {
    masterLabelsCount: input.receiveMode === 'structured' ? outer : 0,
    innerLabelsCount: inner,
    eachLabelsCount: piece,
    totalEa,
    masterCartonQty: input.receiveMode === 'structured' ? outer : 0,
    innerPerMaster: null,
    innerPackCount: inner,
    eaPerInner: pcs,
    warnings,
  };
}

/** Human-readable pack size for putaway / scan hints. */
export function formatPackDefinitionHint(args: {
  innerPackQty: number | null;
  outerPackQty: number | null;
}): string | null {
  const inner = args.innerPackQty;
  const outer = args.outerPackQty;
  if (inner == null || inner < 1) return null;
  if (outer != null && outer >= inner && outer % inner === 0) {
    const innersPerOuter = Math.floor(outer / inner);
    return `Pack: ${innersPerOuter} inner boxes × ${inner} pcs (${outer} pcs/outer)`;
  }
  return `Pack: ${inner} pcs per inner box`;
}

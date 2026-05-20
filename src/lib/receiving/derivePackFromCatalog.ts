import type { ItemPackDefinition } from '../../types';

export interface CatalogPackHint {
  pcsPerInner: number | null;
  innersPerOuter: number | null;
  twoLevel: boolean;
  /** Human-readable, e.g. "30 pcs/outer · 1 pc/inner" */
  label: string | null;
}

/**
 * Map item_pack_definitions (Book box: MAST.BOX + INNER.BOX) → receiving gate fields.
 *
 * - inner_pack_qty = INNER.BOX (pieces per inner carton)
 * - outer_pack_qty = MAST.BOX (total pieces per outer/master carton)
 * - inners per outer = outer / inner when both set
 *
 * When INNER.BOX is 1, treat as 2-level UX: outer holds pieces directly (30 pcs/outer).
 */
export function derivePackFromCatalog(def: ItemPackDefinition | undefined): CatalogPackHint {
  if (!def) {
    return { pcsPerInner: null, innersPerOuter: null, twoLevel: false, label: null };
  }

  const inner = def.inner_pack_qty;
  const outer = def.outer_pack_qty;

  if (outer != null && outer >= 1 && (inner == null || inner < 1)) {
    return {
      pcsPerInner: outer,
      innersPerOuter: null,
      twoLevel: true,
      label: `${outer} pcs per outer box`,
    };
  }

  if (outer != null && inner != null && inner >= 1) {
    if (inner === 1) {
      return {
        pcsPerInner: outer,
        innersPerOuter: null,
        twoLevel: true,
        label: `${outer} pcs per outer box (no inner cartons)`,
      };
    }
    const ipo = Math.max(1, Math.round(outer / inner));
    return {
      pcsPerInner: inner,
      innersPerOuter: ipo,
      twoLevel: false,
      label: `${ipo} inner boxes × ${inner} pcs (${outer} pcs/outer)`,
    };
  }

  if (inner != null && inner >= 1) {
    return {
      pcsPerInner: inner,
      innersPerOuter: null,
      twoLevel: false,
      label: `${inner} pcs per inner box`,
    };
  }

  if (outer != null && outer >= 1) {
    return {
      pcsPerInner: outer,
      innersPerOuter: null,
      twoLevel: true,
      label: `${outer} pcs per outer box`,
    };
  }

  return { pcsPerInner: null, innersPerOuter: null, twoLevel: false, label: null };
}

import type { ItemPackDefinition, ItemSellingUnit } from '../../types';
import type { UomTier } from '../../lib/scanner/uomMapper';

export type HierarchyStep = 1 | 2 | 3 | 'review';

export interface BoxLayerDraft {
  scanRaw: string | null;
  noLabel: boolean;
  labelPreset: 'Box' | 'Carton' | 'Outer';
  labelCustom: string;
  packetsInside: number | '';
  sellThisUnit: boolean;
}

export interface PacketLayerDraft {
  scanRaw: string | null;
  noLabel: boolean;
  labelPreset: 'Packet' | 'Set' | 'Strip';
  labelCustom: string;
  piecesInside: number | '';
  sellThisUnit: boolean;
}

export interface PieceLayerDraft {
  scanRaw: string | null;
  noLabel: boolean;
}

export interface HierarchyDraft {
  box: BoxLayerDraft;
  packet: PacketLayerDraft;
  piece: PieceLayerDraft;
}

export function defaultHierarchyDraft(): HierarchyDraft {
  return {
    box: {
      scanRaw: null,
      noLabel: false,
      labelPreset: 'Box',
      labelCustom: '',
      packetsInside: '',
      sellThisUnit: false,
    },
    packet: {
      scanRaw: null,
      noLabel: false,
      labelPreset: 'Packet',
      labelCustom: '',
      piecesInside: '',
      sellThisUnit: false,
    },
    piece: { scanRaw: null, noLabel: false },
  };
}

export function formatLayerLabel(preset: string, custom: string): string {
  const t = custom.trim();
  return t || preset;
}

export function computeDerivedPieces(
  draft: HierarchyDraft,
): { piecesPerPacket: number; packetsPerBox: number; piecesPerBox: number } | null {
  const ppp = Number(draft.packet.piecesInside);
  const ppb = Number(draft.box.packetsInside);
  if (!Number.isFinite(ppp) || ppp <= 1 || !Number.isInteger(ppp)) return null;
  if (!Number.isFinite(ppb) || ppb < 1 || !Number.isInteger(ppb)) return null;
  return {
    piecesPerPacket: ppp,
    packetsPerBox: ppb,
    piecesPerBox: ppb * ppp,
  };
}

export function derivedSellingUnit(draft: HierarchyDraft): ItemSellingUnit {
  if (draft.packet.sellThisUnit) return 'packet';
  if (draft.box.sellThisUnit) return 'box';
  return 'piece';
}

export function validateLayer1(draft: HierarchyDraft): string | null {
  const ppb = Number(draft.box.packetsInside);
  if (!Number.isFinite(ppb) || ppb < 1 || !Number.isInteger(ppb)) {
    return 'How many inner packs fit inside this outer? Use a whole number ≥ 1.';
  }
  return null;
}

export function validateLayer2(draft: HierarchyDraft): string | null {
  const ppp = Number(draft.packet.piecesInside);
  if (!Number.isFinite(ppp) || ppp <= 1 || !Number.isInteger(ppp)) {
    return 'How many pieces are inside one inner pack? Use a whole number > 1.';
  }
  if (draft.box.sellThisUnit && draft.packet.sellThisUnit) {
    return 'Choose selling at outer or inner only — turn one off.';
  }
  return null;
}

/** Gate before leaving step 1 — outer scan optional only when explicitly marked. */
export function validateOuterScanGate(draft: HierarchyDraft): string | null {
  if (!draft.box.noLabel && !(draft.box.scanRaw && draft.box.scanRaw.trim())) {
    return 'Scan the outer barcode or choose “No outer barcode”.';
  }
  return null;
}

export function validatePacketScanGate(draft: HierarchyDraft): string | null {
  if (!draft.packet.noLabel && !(draft.packet.scanRaw && draft.packet.scanRaw.trim())) {
    return 'Scan the inner-pack barcode or choose “No inner barcode”.';
  }
  return null;
}

export function applyTierScanToDraft(
  draft: HierarchyDraft,
  tier: UomTier,
  raw: string,
): HierarchyDraft {
  const trimmed = raw.trim();
  if (!trimmed) return draft;
  if (tier === 'box') {
    return {
      ...draft,
      box: { ...draft.box, scanRaw: raw, noLabel: false },
    };
  }
  if (tier === 'packet') {
    return {
      ...draft,
      packet: { ...draft.packet, scanRaw: raw, noLabel: false },
    };
  }
  return {
    ...draft,
    piece: { ...draft.piece, scanRaw: raw, noLabel: false },
  };
}

/** Prefill from DB row + catalog selling unit when opening a SKU. */
export function hydrateHierarchyDraftFromCatalog(args: {
  def: ItemPackDefinition | undefined;
  sellingUnit: ItemSellingUnit | null | undefined;
}): HierarchyDraft {
  const d = defaultHierarchyDraft();
  const { def, sellingUnit } = args;
  if (def?.inner_pack_qty != null && def?.outer_pack_qty != null) {
    const inner = Number(def.inner_pack_qty);
    const outer = Number(def.outer_pack_qty);
    if (inner > 1 && outer > 1 && outer % inner === 0) {
      d.packet.piecesInside = inner;
      d.box.packetsInside = outer / inner;
    }
  }
  if (def?.box_label) d.box.labelCustom = String(def.box_label);
  if (def?.packet_label) d.packet.labelCustom = String(def.packet_label);
  if (sellingUnit === 'box') {
    d.box.sellThisUnit = true;
    d.packet.sellThisUnit = false;
  } else if (sellingUnit === 'packet') {
    d.packet.sellThisUnit = true;
    d.box.sellThisUnit = false;
  } else {
    d.box.sellThisUnit = false;
    d.packet.sellThisUnit = false;
  }
  return d;
}

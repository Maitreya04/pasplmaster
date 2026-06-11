import type { PickerV10DemoScenario, PickerV10Line, PickerV10ScenarioPlaybook } from './types';

const MRP_MAIN = {
  location: 'Main Store' as const,
  location_code: 'main_store' as const,
};

function mrp(
  value: number,
  qty: number,
  date: string,
  latest = true,
): NonNullable<PickerV10Line['mrpHistory']>[number] {
  return {
    mrp: value,
    qty,
    salesprice: null,
    ...MRP_MAIN,
    date,
    updated_at: null,
    is_latest: latest,
  };
}

/** Shared lines reused across scenarios. */
const LINE_PAIR_OVER: PickerV10Line = {
  id: 1,
  code: '8180756100',
  name: 'STS Stb Lnk Frnt XUV500',
  rack: 'NGF-4',
  shelf: 'Shelf 2',
  bin: 'B07',
  qty: 1,
  uom: 'PAIR',
  verifyMode: 'confirm',
  mrpHistory: [mrp(255, 12, 'Jun 2026')],
};

const LINE_SET_PARTIAL: PickerV10Line = {
  id: 2,
  code: 'TIDCK31',
  name: 'TIDC Passion Plus New',
  rack: 'NGF-4',
  shelf: 'Shelf 1',
  bin: 'B11',
  qty: 10,
  uom: 'SET',
  verifyMode: 'type',
  mrpHistory: [mrp(664, 40, 'Jun 2026')],
};

const LINE_MULTI_MRP: PickerV10Line = {
  id: 3,
  code: 'BAJCT07',
  name: 'Bajaj CT100 — Brake Shoe Set',
  rack: 'C2',
  shelf: 'Shelf 1',
  bin: 'B11',
  qty: 10,
  uom: 'PCS',
  verifyMode: 'type',
  mrpHistory: [mrp(18, 130, 'May 2026'), mrp(16, 80, 'Jan 2026', false)],
};

const LINE_KIT_GAP: PickerV10Line = {
  id: 4,
  code: 'HROSP22',
  name: 'Hero Splendor — Oil Seal Kit',
  rack: 'A1',
  shelf: 'Shelf 4',
  bin: 'B03',
  qty: 5,
  uom: 'KIT',
  verifyMode: 'confirm',
  mrpHistory: [mrp(110, 50, 'Apr 2026'), mrp(105, 100, 'Nov 2025', false)],
};

const LINE_PCS_EXACT: PickerV10Line = {
  id: 101,
  code: 'VARROC1',
  name: 'Varroc — Headlight Assembly',
  rack: 'B2',
  qty: 20,
  uom: 'PCS',
  verifyMode: 'confirm',
  mrpHistory: [mrp(850, 20, 'Mar 2026')],
};

const LINE_NO_MRP: PickerV10Line = {
  id: 201,
  code: 'NOMRP01',
  name: 'Unlisted Fastener — no stock MRP',
  rack: 'D1',
  bin: 'B99',
  qty: 3,
  uom: 'PCS',
  verifyMode: 'confirm',
  mrpHistory: [],
};

const LINE_SCAN: PickerV10Line = {
  id: 202,
  code: 'SCANQR01',
  name: 'TVS Apache — Chain Sprocket',
  rack: 'E3',
  bin: 'B12',
  qty: 2,
  uom: 'PCS',
  verifyMode: 'scan',
  mrpHistory: [mrp(420, 8, 'Jun 2026')],
};

const LINE_EXTREME_OVER: PickerV10Line = {
  id: 203,
  code: 'EXTREME1',
  name: 'Rare Gasket — qty 1 stress test',
  rack: 'F1',
  qty: 1,
  uom: 'PCS',
  verifyMode: 'confirm',
  mrpHistory: [mrp(45, 5, 'Jun 2026')],
};

const LINE_HIGH_QTY: PickerV10Line = {
  id: 204,
  code: 'TIDCK31',
  name: 'TIDC Passion Plus — Clutch Plate (bulk)',
  rack: 'NGF-4',
  qty: 600,
  uom: 'PCS',
  verifyMode: 'type',
  mrpHistory: [mrp(245, 600, 'May 2026')],
};

/** Default rack walk — one line per UOM + multi-MRP on line 3. */
export const DEMO_PICKER_LINES: PickerV10Line[] = [
  LINE_PAIR_OVER,
  LINE_SET_PARTIAL,
  LINE_MULTI_MRP,
  LINE_KIT_GAP,
];

/**
 * Full edge-case tour — pick in order; each line targets one primary edge case.
 * Completing all 7 lines exercises every qty state, verify mode, and handoff step.
 */
export const EDGE_CASE_TOUR_LINES: PickerV10Line[] = [
  {
    ...LINE_SET_PARTIAL,
    id: 301,
    qty: 10,
    name: '① Exact fill · SET · type verify',
  },
  {
    ...LINE_PAIR_OVER,
    id: 302,
    name: '② Over-target · PAIR · note required',
  },
  {
    ...LINE_MULTI_MRP,
    id: 303,
    name: '③ Multi-batch split · 6@₹18 then 4@₹16',
  },
  {
    ...LINE_NO_MRP,
    id: 304,
    name: '④ No MRP history · type custom ₹',
  },
  {
    ...LINE_SCAN,
    id: 305,
    name: '⑤ Scan verify · single MRP',
  },
  {
    ...LINE_KIT_GAP,
    id: 306,
    qty: 5,
    name: '⑥ Partial gap · log 3 kits then flag short',
  },
  {
    ...LINE_EXTREME_OVER,
    id: 307,
    name: '⑦ Extreme over · log 5 for qty 1 (3× banner)',
  },
];

export const DEMO_SCENARIO_LINES: Record<PickerV10DemoScenario, PickerV10Line[]> = {
  edge_case_tour: EDGE_CASE_TOUR_LINES,
  default: DEMO_PICKER_LINES,
  single_pcs: [LINE_PCS_EXACT],
  pair_over: [LINE_PAIR_OVER],
  set_partial: [LINE_SET_PARTIAL],
  multi_mrp: [LINE_MULTI_MRP],
  multi_batch_split: [LINE_MULTI_MRP],
  extreme_over: [LINE_EXTREME_OVER],
  no_mrp: [LINE_NO_MRP],
  scan_verify: [LINE_SCAN],
};

export const DEMO_SCENARIO_HINTS: Record<PickerV10DemoScenario, string> = {
  edge_case_tour:
    'Complete all 7 lines in order — covers exact, over, multi-batch, no MRP, scan, gap+flag, extreme over',
  default: 'Rack walk: PAIR + SET + multi-MRP PCS + KIT — good smoke test',
  single_pcs: 'Single line · log exactly 20 → green exact state + session end',
  pair_over: 'Order 1 pair · enter 5 on qty → note gates CTA until filled',
  set_partial: 'Order 10 sets · log 8 → gap screen → Next label or flag short',
  multi_mrp: 'Two stock bands ₹18 / ₹16 — practice reading label before qty',
  multi_batch_split: 'Log 6@₹18 → gap → Next label → log 4@₹16 → exact complete',
  extreme_over: 'Order 1 pc · log 5 → extreme over banner (3×+ copy)',
  no_mrp: 'Empty mrpHistory — must type MRP manually on numpad',
  scan_verify: 'Opens scan verify sheet before MRP entry',
};

/** Detailed playbooks for lab testers. */
export const DEMO_SCENARIO_PLAYBOOKS: Record<PickerV10DemoScenario, PickerV10ScenarioPlaybook> = {
  edge_case_tour: {
    scenario: 'edge_case_tour',
    title: 'Full edge-case tour',
    edgeCases: [
      'Exact fill (green)',
      'Over-target + note gate',
      'Multi-MRP batch split',
      'Custom MRP (no history)',
      'Scan verify',
      'Gap state + flag short',
      'Extreme over (3× banner)',
      'Rack list done-dim',
      'Item complete overlay',
      'Session summary + handoff',
    ],
    steps: [
      'Line 1: Type-verify TIDCK31 → MRP ₹664 → qty 10 → exact ✓',
      'Line 2: Confirm → MRP ₹255 → qty 5 → add note → log over batch',
      'Line 3: Type-verify → log 6@₹18 → gap → Next label → log 4@₹16',
      'Line 4: Confirm → type custom MRP (e.g. ₹99) → qty 3 → exact',
      'Line 5: Scan-verify (tap through) → MRP ₹420 → qty 2 → exact',
      'Line 6: Confirm → MRP ₹110 → qty 3 → gap → Flag short stock',
      'Line 7: Confirm → MRP ₹45 → qty 5 + note → extreme over banner',
      'Finish: box count → Hand off to billing',
    ],
  },
  default: {
    scenario: 'default',
    title: 'Rack walk smoke test',
    edgeCases: ['All 4 UOM badges', 'Type + confirm verify', 'Multi-MRP on line 3'],
    steps: [
      'Pick each line on NGF-4 / C2 / A1 racks',
      'Line 3: try two different MRP labels across batches',
      'Complete all → session summary',
    ],
  },
  single_pcs: {
    scenario: 'single_pcs',
    title: 'PCS exact fill',
    edgeCases: ['Empty qty state', 'Partial feedback', 'Exact green CTA'],
    steps: [
      'Confirm item → MRP ₹850',
      'On qty: tap nothing → see "tap a number"',
      'Enter 15 → see "5 pcs still to log"',
      'Tap All 20 or enter 20 → green exact → log batch',
    ],
  },
  pair_over: {
    scenario: 'pair_over',
    title: 'PAIR over-target',
    edgeCases: ['Over qty color', 'Over banner', 'Note CTA gate', 'Red commit CTA'],
    steps: [
      'Confirm → MRP ₹255 → qty screen',
      'Enter 5 → over banner appears',
      'Tap CTA → opens note (Add a note first)',
      'Type reason → CTA turns red → log batch',
    ],
  },
  set_partial: {
    scenario: 'set_partial',
    title: 'SET partial → gap',
    edgeCases: ['Partial batch', 'Gap amber hero', 'Next label returns to MRP'],
    steps: [
      'Type last 4: CK31 → MRP ₹664',
      'Enter qty 8 → log batch',
      'Gap: 2 sets still unlogged',
      'Next label → enter second batch OR Flag short',
    ],
  },
  multi_mrp: {
    scenario: 'multi_mrp',
    title: 'Multi-MRP awareness',
    edgeCases: ['Two stock suggestions', 'MRP chip edit from qty'],
    steps: [
      'Type-verify → see ₹18 and ₹16 suggestions',
      'Pick label price manually',
      'From qty screen tap MRP chip → back to MRP entry',
    ],
  },
  multi_batch_split: {
    scenario: 'multi_batch_split',
    title: 'Two-batch MRP split',
    edgeCases: ['Batch pills on tally', 'Gap between batches', 'Exact on second batch'],
    steps: [
      'MRP ₹18 → qty 6 → log → gap shows 4 remaining',
      'Next label → MRP ₹16 → qty 4 → exact complete',
      'Item complete overlay shows 2 batch pills',
    ],
  },
  extreme_over: {
    scenario: 'extreme_over',
    title: 'Extreme over (3×+)',
    edgeCases: ['Stronger over banner copy', 'Note required'],
    steps: [
      'Confirm → MRP ₹45',
      'Enter qty 5 (order is 1) → read extreme over banner',
      'Add note → log batch',
    ],
  },
  no_mrp: {
    scenario: 'no_mrp',
    title: 'No MRP history',
    edgeCases: ['Empty suggestions', 'Manual numpad MRP only'],
    steps: [
      'Confirm item → MRP screen has no stock chips',
      'Type price on numpad (e.g. 120) → proceed to qty',
    ],
  },
  scan_verify: {
    scenario: 'scan_verify',
    title: 'Scan verify path',
    edgeCases: ['Scan sheet', 'Type fallback link'],
    steps: [
      'Tap Got it → scan verify sheet opens',
      'Tap through scan OR "Type code instead"',
      'Complete MRP + qty normally',
    ],
  },
};

/** Matrix mapping edge cases → which scenario exercises them. */
export const DEMO_EDGE_CASE_MATRIX: { edgeCase: string; scenarios: PickerV10DemoScenario[] }[] = [
  { edgeCase: 'Qty empty state', scenarios: ['single_pcs', 'edge_case_tour'] },
  { edgeCase: 'Qty partial → gap', scenarios: ['set_partial', 'multi_batch_split', 'edge_case_tour'] },
  { edgeCase: 'Qty exact (green)', scenarios: ['single_pcs', 'edge_case_tour'] },
  { edgeCase: 'Qty over + note gate', scenarios: ['pair_over', 'edge_case_tour'] },
  { edgeCase: 'Extreme over 3× banner', scenarios: ['extreme_over', 'edge_case_tour'] },
  { edgeCase: 'Multi-MRP two batches', scenarios: ['multi_batch_split', 'multi_mrp', 'edge_case_tour'] },
  { edgeCase: 'No MRP history', scenarios: ['no_mrp', 'edge_case_tour'] },
  { edgeCase: 'Scan verify', scenarios: ['scan_verify', 'edge_case_tour'] },
  { edgeCase: 'Type verify (last 4)', scenarios: ['set_partial', 'multi_mrp', 'edge_case_tour'] },
  { edgeCase: 'Confirm verify (no scan)', scenarios: ['pair_over', 'no_mrp', 'edge_case_tour'] },
  { edgeCase: 'Flag short from gap', scenarios: ['set_partial', 'edge_case_tour'] },
  { edgeCase: 'Optional note (normal pick)', scenarios: ['single_pcs', 'default'] },
  { edgeCase: 'All {n} fill shortcut', scenarios: ['single_pcs', 'set_partial'] },
  { edgeCase: 'UOM: PCS / PAIR / SET / KIT', scenarios: ['default', 'edge_case_tour'] },
  { edgeCase: 'Rack list done-dim + next CTA', scenarios: ['edge_case_tour', 'default'] },
  { edgeCase: 'Item complete overlay', scenarios: ['edge_case_tour', 'multi_batch_split'] },
  { edgeCase: 'Session summary + handoff', scenarios: ['edge_case_tour', 'single_pcs'] },
];

export const DEMO_ORDER_LABEL = '1st Town Garage';
export const DEMO_CUSTOMER_LABEL = 'PA-260523-0014 · Jai Jalaram Auto Parts';

/** High-qty line for numpad / large-number stress (optional lab use). */
export const DEMO_HIGH_QTY_LINE = LINE_HIGH_QTY;

import type { OrderItem, OrderWithItems, SalesLineUnit } from '../../../types';

export type LabDemoScenarioId =
  | 'UAT-PICK-001'
  | 'UAT-PICK-002'
  | 'UAT-PICK-003'
  | 'UAT-PICK-004'
  | 'UAT-PICK-005';

export type LabDemoScenario = {
  id: LabDemoScenarioId;
  title: string;
  expected: string;
  order: OrderWithItems;
};

let nextItemId = 900_000;

function line(
  orderId: number,
  opts: {
    code: string;
    name: string;
    rack: string;
    qty: number;
    uom: SalesLineUnit;
    mainGroup?: string;
    billLineNo: number;
  },
): OrderItem {
  nextItemId += 1;
  return {
    id: nextItemId,
    order_id: orderId,
    bill_line_no: opts.billLineNo,
    item_id: nextItemId,
    item_name: opts.name,
    item_alias: opts.code,
    catalog_alias: opts.code,
    catalog_alias1: opts.code,
    catalog_main_group: opts.mainGroup ?? 'TIDC',
    catalog_parent_group: 'Two Wheeler',
    rack_no: opts.rack,
    sales_unit: opts.uom,
    qty_requested: opts.qty,
    qty_shippable: opts.qty,
    qty_po: 0,
    qty_approved: opts.qty,
    stock_location_code: 'main_store',
    price_quoted: 100,
    price_system: 100,
    state: 'pending',
    flag_reason: null,
    flag_notes: null,
    flag_box_price: null,
    scan_result: null,
  };
}

function shell(orderId: number, label: string, items: OrderItem[]): OrderWithItems {
  return {
    id: orderId,
    order_number: label,
    customer_id: 1,
    customer_name: 'Lab Customer',
    customer_city: 'Jabalpur',
    transport_id: null,
    transport_name: null,
    salesperson_name: 'Lab Sales',
    reviewer_name: null,
    picker_name: 'Lab Picker',
    workflow_status: 'picking',
    fulfillment_path: 'warehouse_pick',
    stock_location_code: 'main_store',
    priority: 'normal',
    notes: 'Picker UX lab — no DB writes',
    item_count: items.length,
    pick_line_count: items.length,
    total_value: items.reduce((s, i) => s + (i.price_quoted ?? 0) * i.qty_requested, 0),
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    picked_at: null,
    completed_at: null,
    dispatched_at: null,
    items,
  };
}

/** In-memory lab orders — no Supabase fetch required. */
export const LAB_DEMO_SCENARIOS: LabDemoScenario[] = [
  {
    id: 'UAT-PICK-001',
    title: 'Same group, same rack',
    expected: 'Rack stays stable while part numbers change clearly.',
    order: shell(910_001, 'LAB-UAT-001', [
      line(910_001, {
        code: 'TIDCK31',
        name: 'TIDC Passion Plus New',
        rack: 'NGF-4',
        qty: 10,
        uom: 'set',
        billLineNo: 1,
      }),
      line(910_001, {
        code: 'TIDCK32',
        name: 'TIDC Passion Pro Cable',
        rack: 'NGF-4',
        qty: 4,
        uom: 'set',
        billLineNo: 2,
      }),
      line(910_001, {
        code: 'TIDCK33',
        name: 'TIDC Passion Side Panel',
        rack: 'NGF-4',
        qty: 2,
        uom: 'pcs',
        billLineNo: 3,
      }),
    ]),
  },
  {
    id: 'UAT-PICK-002',
    title: 'Same group, multiple racks',
    expected: 'Group stays together and advances rack by rack.',
    order: shell(910_002, 'LAB-UAT-002', [
      line(910_002, {
        code: 'TIDCK31',
        name: 'TIDC Passion Plus New',
        rack: 'NGF-4',
        qty: 6,
        uom: 'set',
        billLineNo: 1,
      }),
      line(910_002, {
        code: 'TIDCK40',
        name: 'TIDC Clutch Plate',
        rack: 'NGF-7',
        qty: 3,
        uom: 'set',
        billLineNo: 2,
      }),
      line(910_002, {
        code: 'TIDCK41',
        name: 'TIDC Brake Shoe',
        rack: 'NGF-2',
        qty: 5,
        uom: 'pcs',
        billLineNo: 3,
      }),
    ]),
  },
  {
    id: 'UAT-PICK-003',
    title: 'Multiple main groups',
    expected: 'Main group comes first, rack order comes second.',
    order: shell(910_003, 'LAB-UAT-003', [
      line(910_003, {
        code: 'TIDCK31',
        name: 'TIDC Passion Plus New',
        rack: 'NGF-4',
        qty: 4,
        uom: 'set',
        mainGroup: 'TIDC',
        billLineNo: 1,
      }),
      line(910_003, {
        code: 'BAJCT07',
        name: 'Bajaj CT100 Brake Shoe Set',
        rack: 'C2',
        qty: 10,
        uom: 'pcs',
        mainGroup: 'BAJAJ',
        billLineNo: 2,
      }),
      line(910_003, {
        code: 'HROSP22',
        name: 'Hero Splendor Oil Seal Kit',
        rack: 'A1',
        qty: 5,
        uom: 'kit',
        mainGroup: 'HERO',
        billLineNo: 3,
      }),
    ]),
  },
  {
    id: 'UAT-PICK-004',
    title: 'Edit before submit',
    expected: 'Picked affordance and edit action are visible before handoff.',
    order: shell(910_004, 'LAB-UAT-004', [
      line(910_004, {
        code: 'VARROC1',
        name: 'Varroc Headlamp Assembly',
        rack: 'D3',
        qty: 12,
        uom: 'pcs',
        billLineNo: 1,
      }),
    ]),
  },
  {
    id: 'UAT-PICK-005',
    title: 'Exception flow',
    expected: 'Short, over-pick, and multi-price paths require the right inputs.',
    order: shell(910_005, 'LAB-UAT-005', [
      line(910_005, {
        code: 'TIDCK31',
        name: 'TIDC Passion Plus New',
        rack: 'NGF-4',
        qty: 10,
        uom: 'set',
        billLineNo: 1,
      }),
      line(910_005, {
        code: 'BAJCT07',
        name: 'Bajaj CT100 Brake Shoe Set',
        rack: 'C2',
        qty: 10,
        uom: 'pcs',
        billLineNo: 2,
      }),
      line(910_005, {
        code: '8180756100',
        name: 'STS Stb Lnk Frnt XUV500',
        rack: 'NGF-4',
        qty: 1,
        uom: 'pcs',
        billLineNo: 3,
      }),
    ]),
  },
];

export const DEFAULT_LAB_DEMO_ID: LabDemoScenarioId = 'UAT-PICK-005';

export function getLabDemoScenario(id: string | null | undefined): LabDemoScenario | null {
  if (!id) return null;
  return LAB_DEMO_SCENARIOS.find((s) => s.id === id) ?? null;
}

export function isLabDemoScenarioId(id: string | null | undefined): id is LabDemoScenarioId {
  return LAB_DEMO_SCENARIOS.some((s) => s.id === id);
}

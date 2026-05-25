import type { PickerV10Line } from './types';

/** Demo fixtures mirroring picker-v10.jsx prototypes. */
export const DEMO_PICKER_LINES: PickerV10Line[] = [
  {
    id: 1,
    code: 'TIDCK31',
    name: 'TIDC Passion Plus — Clutch Plate',
    rack: 'D4',
    shelf: 'Shelf 2',
    bin: 'B07',
    qty: 600,
    verifyMode: 'scan',
    mrpHistory: [{ mrp: 245, qty: 600, salesprice: null, location: 'Main Store', location_code: 'main_store', date: 'May 2026', updated_at: null, is_latest: true }],
  },
  {
    id: 2,
    code: 'BAJCT07',
    name: 'Bajaj CT100 — Brake Shoe Set',
    rack: 'C2',
    shelf: 'Shelf 1',
    bin: 'B11',
    qty: 210,
    verifyMode: 'type',
    mrpHistory: [
      { mrp: 18, qty: 130, salesprice: null, location: 'Main Store', location_code: 'main_store', date: 'May 2026', updated_at: null, is_latest: true },
      { mrp: 16, qty: 80, salesprice: null, location: 'Main Store', location_code: 'main_store', date: 'Jan 2026', updated_at: null, is_latest: false },
    ],
  },
  {
    id: 3,
    code: 'HROSP22',
    name: 'Hero Splendor — Oil Seal Kit',
    rack: 'A1',
    shelf: 'Shelf 4',
    bin: 'B03',
    qty: 280,
    verifyMode: 'confirm',
    mrpHistory: [
      { mrp: 110, qty: 50, salesprice: null, location: 'JBP', location_code: 'jabalpur', date: 'Apr 2026', updated_at: null, is_latest: true },
      { mrp: 105, qty: 100, salesprice: null, location: 'JBP', location_code: 'jabalpur', date: 'Nov 2025', updated_at: null, is_latest: false },
      { mrp: 95, qty: 50, salesprice: null, location: 'JBP', location_code: 'jabalpur', date: 'Jul 2025', updated_at: null, is_latest: false },
    ],
  },
  {
    id: 4,
    code: 'VARROC1',
    name: 'Varroc — Headlight Assembly',
    rack: 'B2',
    shelf: 'Shelf 1',
    bin: 'B01',
    qty: 20,
    verifyMode: 'scan',
    mrpHistory: [{ mrp: 850, qty: 20, salesprice: null, location: 'Main Store', location_code: 'main_store', date: 'Mar 2026', updated_at: null, is_latest: true }],
  },
];

export const DEMO_ORDER_LABEL = 'PA-260523-0014';
export const DEMO_CUSTOMER_LABEL = 'Jai Jalaram Auto Parts';

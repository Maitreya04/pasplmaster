export const FLAG_REASONS = [
  'Price Mismatch',
  'Out of Stock',
  'Wrong Part',
  'Damaged',
  "Can't Find",
  'Other',
] as const;

export type FlagReason = (typeof FLAG_REASONS)[number];

export const SALES_NAMES = [
  'Satish',
  'Hemant',
  'Mankar',
  'Raju Ji',
  'Rehan Multani',
  'Hardeep Singh',
  'Deepak',
  'Vinod',
  'Sachin Rao',
  'Anand Awasthi',
  'Gourav Yadav',
  'Mahendra Rajput',
  'Manish Sharma',
  'Shri Ram Sharma',
  'Asad Khan',
  'Direct',
];

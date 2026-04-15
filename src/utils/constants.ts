export const FLAG_REASONS = [
  'Price Mismatch',
  'Out of Stock',
  'Wrong Part',
  'Damaged',
  "Can't Find",
  'Other',
] as const;

export type FlagReason = (typeof FLAG_REASONS)[number];

export const BILLING_NAMES = [
  'Kamlakar',
  'Govind',
  'Deepak Yogi',
  'Neetu',
  'Ashok',
];

export const PICKER_NAMES = [
  'Shankar',
  'Dharmendra',
  'Abhishek',
];

export const SALES_NAMES = [
  'Satish',
  'Hemant',
  'Rohan',
  'Raju',
  'Guddu',
  'Mankar',
  'Sachin Rao',
  'Mahendra Rajput',
  'Pankaj',
  'Direct',
  'Neeraj',
  'Asad',
  'Manish',
  'Hardeep',
  'Shashank',
  'Awasthi',
];

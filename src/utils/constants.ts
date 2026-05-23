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
  'Deepak Yogi',
  'Kamlakar',
  'Govind',
  'Neetu',
  'Sachin Rathore',
  'Ashok',
];

export const PICKER_NAMES = [
  'Shankar',
  'Dharmendra',
  'Abhishek',
  'Harsh',
  'Sameer',
  'Bittu',
];

export const SALES_NAMES = [
  'Hardeep',
  'Rehan Multani',
  'Shri Ram Sharma',
  'Mahendra Rajput',
  'Sachin Rao',
  'Pankaj Meena',
  'Raju Ji',
  'Hemant',
  'Guddu',
  'Mankar',
  'Asad',
  'Anand Awasthi',
  'Manish Sharma',
  'Kamlakar',
  'Neeraj',
  'Shashank',
  'Satish',
  'Deepak Sharma',
];

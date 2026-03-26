import { matchOcrToItem } from './src/lib/ocr/ocrMatcher';

const tests = [
  {
    name: 'Diamond Chain K6N (raw text fallback)',
    ocrText: "XL SUPER HD NEW 420-110 L\nK6N\nDIAMOND MOPED\n12Jan26Y3863",
    expected: { item_name: "TIDC XL HEAVY DUTY NEW-110L", item_alias: null },
    alias1: "TIDCK6N",
    mainGroup: "TIDC",
    parentGroup: "T. KIT",
  },
  {
    name: 'ASK Brake Shoe exact match',
    ocrText: "ASK BRAKE SHOE\nPart No. : ASK/NA/BS/00002\nQuantity: 20 Unit (Set of 2 Pieces)\nMRP: Rs.4700.00\nASK/ HN ACT N\nASBESTOS FREE",
    expected: { item_name: "ASK BRAKE SHOE NA HONDA ACTIVA NEW", item_alias: "ASK/NA/BS/00002" },
    alias1: "ASKBSNAHONACTNE",
    mainGroup: "ASK",
    parentGroup: "ASK BS",
  },
  {
    name: 'ASK Clutch Shoe should NOT match Brake Shoe',
    ocrText: "ASK CLUTCH SHOE\nPart No. : ASK/CS/0411\n40 Unit (Set of 3 Pieces)\nMRP: Rs.36520.00\nASK/ HN ACT-N 110\nASBESTOS FREE",
    expected: { item_name: "ASK BRAKE SHOE NA HONDA ACTIVA NEW", item_alias: "ASK/NA/BS/00002" },
    alias1: "ASKBSNAHONACTNE",
    mainGroup: "ASK",
    parentGroup: "ASK BS",
  },
  {
    name: 'Lucas TVS Starter prefix-stripped match',
    ocrText: "Lucas TVS\nPart No. : 26046091\nProduct: STARTER-HER-PRO/I-SM/SPL/HFDL\nQuantity: 1 Number\nMRP: Rs. 1381.00",
    expected: { item_name: "LC STARTER MOTOR PAS. PRO/I3S/SPL.P/DLX", item_alias: null },
    alias1: "LC26046091",
    mainGroup: "LUCAS",
    parentGroup: "LUCAS STARTER MOTOR",
  },
  {
    name: 'USHA Piston Assembly (no code match, vehicle+type+variant)',
    ocrText: "USHA PISTON ASSEMBLY\nHONDA ACTIVA / DIO\n110cc HET BS6\n0.25 [47.00mm]\nPart No. S75 NC\nMRP Rs.802.00\nShriram Pistons & Rings Ltd.",
    expected: { item_name: "USHA2 HONDA ACTIVA 110C HET BSVI NC 0.25", item_alias: null },
    alias1: "U2HONACTHETBSVINC0.25",
    mainGroup: "USHA",
    parentGroup: "U2 PISTON ASSY",
  },
  {
    name: 'Suprajit Clutch Cable direct match',
    ocrText: "Suprajit\nCLUTCH CABLE\nSHH0120\nQty: 5 N\nMRP: Rs.485\nRs.97.00 PER NUMBER",
    expected: { item_name: "SJ CLUTCH CABLE JY/CDDWN/SPL/PASS/+", item_alias: null },
    alias1: "SHH0120",
    mainGroup: "SUPRAJIT",
    parentGroup: "SJ.CABLES",
  },
  {
    name: 'USHA Piston Rings D32 (alias match)',
    ocrText: "PISTON RINGS SPR\nSuitable for LEY-HINO 6ETI / BS3A\nMOLY GOLD SSM (104.00 mm)\nSIZE - STD\nControl No. - D 32\nMRP 7507.00",
    expected: { item_name: "RING LEYLAND HINO 6ETI CP/MOLYSSM(R-D32)", item_alias: "R-D32" },
    alias1: "URLH6ETICPGOLD",
    mainGroup: "USHA",
    parentGroup: "U4 RING",
  },
  {
    name: 'KSPG Cam Bush TATA 1516',
    ocrText: "TATA 1516/1312 CAM BUSH\nSTD PF METAL - C/L & W/M\nPART NO : - PC.217.7 18.003\nQTY. - 1 KIT (10 SETS)\nMAX. RETAIL PRICE/KIT : Rs.3800.00\nDATE OF PACKING : MAR.2025\nKSPG AUTOMOTIVE INDIA PRIVATE LIMITED",
    expected: { item_name: "BEARING TATA 1516/1312 SE/B UB NT STD", item_alias: "PS.217.5.10.703" },
    alias1: "BPS217510703",
    mainGroup: "KSPG",
    parentGroup: "K.BEARINGS",
  },
];

for (const t of tests) {
  console.log(`\n\n========== ${t.name} ==========`);
  const res = matchOcrToItem(
    t.ocrText,
    t.expected,
    undefined,
    t.mainGroup,
    t.alias1,
    t.parentGroup,
  );
  console.log(`\nRESULT: isMatch=${res.isMatch}, confidence=${res.confidence}`);
  console.log('Signals:');
  for (const s of res.signals) {
    console.log(`  ${s.signal}: ${s.score}/${s.maxScore} — ${s.detail}`);
  }
}

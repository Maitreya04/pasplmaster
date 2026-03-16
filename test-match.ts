import { matchOcrToItem } from './src/lib/ocr/ocrMatcher';

const ocrText = `Suitable for
LEY- HINO 6ETI / BS3A
MOLY GOLD SSM
(104.00 mm)
SIZE - STD Qty.: 18 Nos
Control No. - D 32
6 KSS Inlaid Moly - 3.00 mm
6 Taper ID Step - 2.49 mm
6 DVM - 3.00 mm`;

const expectedItem = {
  item_name: "PISTON LEYLAND HINO 6ETI EURO II (P-D32)",
  item_alias: "P-D32"
};

const result = matchOcrToItem(ocrText, expectedItem, undefined, null, null);
console.log(JSON.stringify(result, null, 2));

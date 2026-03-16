import { matchOcrToItem } from './src/lib/ocr/ocrMatcher';

const ocrTextVariations = [
  "XL SUPER HD NEW 420-110 L\nK6N\nDIAMOND MOPED",
  "XL SUPER HD NEW 420 - 110 L\nKGN\nDIAMOND MOPED",
  "XL SUPER HD NEW 420-110L\nK 6 N\nDIAMOND MOPED",
  "K6N XL SUPER HD NEW", 
  "DIAMOND K6N MOPED",
  "K6N",
];

const expected = {
  item_name: "TIDC XL HEAVY DUTY NEW-110L",
  item_alias: "TIDCK6N"
};

for (const ocr of ocrTextVariations) {
  console.log(`\n\n--- Testing OCR Text: "${ocr.replace(/\n/g, ' ')}" ---`);
  const res = matchOcrToItem(ocr, expected);
  console.log("Match:", res.isMatch, "Confidence:", res.confidence, "Detail:", res.signals[0]?.detail);
}

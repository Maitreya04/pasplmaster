import { matchOcrToItem } from './src/lib/ocr/ocrMatcher';

function runTest(testName: string, ocrText: string, expectedItem: any, alias1: string | null = null) {
  console.log(`\n\n=== TEST: ${testName} ===`);
  const result = matchOcrToItem(ocrText, expectedItem, undefined, null, alias1);
  console.log('RESULT JSON:', JSON.stringify(result, null, 2));
}

runTest('6. 3-char extraction passing Layer 1',
  `TIDC K6N QTY: 1`, // Added space so K6N is captured as a 3-char code
  {
    item_name: "TIDC CHAIN K6N",
    item_alias: "TIDCK6N"
  },
  "TIDCK6N"
);

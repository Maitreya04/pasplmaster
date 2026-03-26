import { matchOcrToItem } from './src/lib/ocr/ocrMatcher';

function runTest(testName: string, ocrText: string, expectedItem: any, alias1: string | null = null, mainGroup: string | null = null) {
  console.log(`\n\n=== TEST: ${testName} ===`);
  const result = matchOcrToItem(ocrText, expectedItem, undefined, mainGroup, alias1, null);
  console.log('RESULT:', result.isMatch ? 'MATCH' : 'NO MATCH', `(${result.confidence}/100)`);
  for (const s of result.signals) {
    if (s.signal !== 'summary') {
      console.log(`  ${s.signal}: ${s.score}/${s.maxScore} — ${s.detail}`);
    }
  }
}

runTest('3-char code K6N suffix match',
  `TIDC K6N QTY: 1`,
  { item_name: "TIDC XL HEAVY DUTY NEW-110L", item_alias: null },
  "TIDCK6N",
  "TIDC"
);

runTest('K6N vs K6ND (should not match DURO variant)',
  `XL SUPER HD NEW K6N DIAMOND MOPED`,
  { item_name: "TIDC XL HEAVY DUTY NEW-110L DURO", item_alias: null },
  "TIDCK6ND",
  "TIDC"
);

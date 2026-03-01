/**
 * Pressure-test the search modal against real-world order lines.
 * Run: npx tsx scripts/pressure-test-search.ts
 * CSV path: $HOME/Downloads/files/items_import_fixed.csv (or pass as first arg)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  normalizeQuery,
  searchItems,
  detectCodeLike,
  type SearchResult,
} from '../src/lib/search/itemSearch';
import type { Item } from '../src/types';

const PRESSURE_TEST_QUERIES = [
  'Tank unit cd dlx',
  'Clutch cable pulsar 125 bs6',
  'RR unit spl old',
  'RR sup spl HH33 varroc',
  'Main handle cd dlx varroc',
  'Main handle ct100 varroc',
  'Disk pas tvs raider front',
  'Rear shocker passion pro red',
  'Self relay passion pro varroc',
];

function parseCSV(filePath: string): Item[] {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',');
  const nameIdx = header.indexOf('name');
  const aliasIdx = header.indexOf('alias');
  const alias1Idx = header.indexOf('alias1');
  const parentIdx = header.indexOf('parent_group');
  const priceIdx = header.indexOf('sales_price');
  if (nameIdx < 0 || parentIdx < 0) throw new Error('CSV missing required columns');
  const items: Item[] = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i];
    const parts = row.split(',');
    const name = parts[nameIdx]?.trim();
    if (!name) continue;
    const parent = parts[parentIdx]?.trim() ?? null;
    const mainGroup = parent ? parent.split(/[\s.]/)[0] ?? null : null;
    items.push({
      id: i,
      name,
      alias: parts[aliasIdx]?.trim() || null,
      alias1: parts[alias1Idx]?.trim() || null,
      parent_group: parent,
      main_group: mainGroup,
      item_category: null,
      sales_price: Number(parts[priceIdx]) || 0,
      stock_qty: 0,
      rack_no: null,
    });
  }
  return items;
}

function main() {
  const csvPath =
    process.argv[2] ||
    path.join(process.env.HOME || '', 'Downloads/files/items_import_fixed.csv');
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }
  console.log('Loading catalog from', csvPath);
  const items = parseCSV(csvPath);
  console.log('Items loaded:', items.length);
  console.log('\n--- Pressure test: normalizeQuery + searchItems ---\n');

  for (const raw of PRESSURE_TEST_QUERIES) {
    const normalized = normalizeQuery(raw);
    const isCode = detectCodeLike(raw);
    const results: SearchResult[] = searchItems(raw, items);
    const top = results.slice(0, 5);

    console.log(`Query: "${raw}"`);
    console.log(`  Normalized: "${normalized}"  |  Code-like: ${isCode}`);
    console.log(`  Results: ${results.length} total`);
    if (top.length) {
      top.forEach((r, i) => {
        console.log(`    ${i + 1}. [${r.score}] ${r.matchType}: ${r.item.name.slice(0, 60)}${r.item.name.length > 60 ? '…' : ''}`);
      });
    } else {
      console.log('    (no matches)');
    }
    console.log('');
  }
}

main();

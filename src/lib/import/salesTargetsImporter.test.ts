import assert from 'node:assert/strict';
import { normalizeSalesTargetProductGroup } from './salesTargetNormalization';

assert.equal(normalizeSalesTargetProductGroup('U4 CON RODS'), 'U4 CON RODS');
assert.equal(normalizeSalesTargetProductGroup('U4 CRANKSHAFTS (1.5)'), 'U4 CRANKSHAFTS');
assert.equal(normalizeSalesTargetProductGroup('USHA 4W'), 'USHA 4W');
assert.equal(normalizeSalesTargetProductGroup('SJ.CABLES 4W'), 'SJ.CABLES');
assert.equal(normalizeSalesTargetProductGroup('G. VALVES'), 'G.Val');

console.log('sales target importer normalization tests passed');

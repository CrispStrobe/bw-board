import test from 'node:test';
import {assembleRepPfPitRom} from '../scripts/i80386-rep-pf-pit-oracle.mjs';
test('free ROM assembles',()=>assembleRepPfPitRom());

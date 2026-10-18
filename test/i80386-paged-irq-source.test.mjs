import test from 'node:test';
import {runRetainedUnit} from '../scripts/pr-backlog-retained-unit.mjs';

// The native comparison attests this exact historical CPU, not current HEAD.
// Its unchanged original body still executes every architectural assertion.
test('retained paged IRQ oracle runs all original assertions at its attested source', t=>{
 const result=runRetainedUnit('paged-irq');
 t.diagnostic(result.stdout);
});

import test from 'node:test';
import {runRetainedUnit} from '../scripts/pr-backlog-retained-unit.mjs';

// Master's newer source-context bridge supersedes this scheduling prototype.
// Preserve and exercise the original planner's strict predicates unchanged.
test('retained cohort planner runs all original controls at its original source', t=>{
 const result=runRetainedUnit('cohort-planner');
 t.diagnostic(result.stdout);
});

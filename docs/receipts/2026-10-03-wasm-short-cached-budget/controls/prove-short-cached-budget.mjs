import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root = '/tmp/labwired-same-host-20261003.R0T0cC';
const cwd = root + '/labwired-bool-tail';
const base = '43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
const source = '565dce2b35c67c4661055443ce9bb5d47039249e';
const file = 'crates/core/src/cpu/cortex_m.rs';
const git = args => execFileSync('git', args, {cwd, encoding:'utf8'});
assert.equal(git(['rev-parse','HEAD']).trim(), source);
assert.equal(git(['rev-parse','HEAD^']).trim(), base);
const original = git(['show',base+':'+file]);
const modified = readFileSync(cwd+'/'+file,'utf8');
const addition = `        // Short WASM budgets cannot amortize loop discovery. The checked
        // cached executor can still retire a single instruction without
        // relaxing the caller's scheduler or observation guards.
        #[cfg(target_arch = "wasm32")]
        if max_count < 8 {
            return self.run_t16_cached_run(bus, max_count);
        }
`;
assert.equal(modified.split(addition).length,2);
const guard = '&& (max_count - executed >= 8 || cfg!(target_arch = "wasm32"))';
assert.equal(modified.split(guard).length,2);
assert.equal(modified.replace(addition,'').replace(guard,'&& max_count - executed >= 8'),original);
const testFile = 'crates/core/src/cpu/cortex_m/t16_discovery_tests.rs';
const tests = readFileSync(cwd+'/'+testFile,'utf8');
const oldTests = git(['show',base+':'+testFile]);
const start = tests.indexOf('#[test]\nfn cached_short_budgets_match_interpreter_and_stop_at_live_barriers()');
const end = tests.indexOf('// Frozen pre-dispatch call order:',start);
assert(start>=0 && end>start);
assert.equal(tests.slice(0,start)+tests.slice(end),oldTests);
const paths=git(['diff','--name-only',base,source]).trim().split('\n').sort();
assert.deepEqual(paths,['.github/workflows/wasm-short-cached-budget.yml',file,testFile].sort());
const proof={base,source,sourceFiles:paths,originalCpuSha256:createHash('sha256').update(original).digest('hex'),
  cpuReconstructionExact:true,existingTestsPreserved:true,nativeDispatchUnchanged:true,
  wasmBudgets:[0,1,2,3,4,5,6,7],cachedRunCap:16,callerGuardsUnchanged:true,
  noLocalEngineExecution:true,noPerformanceConclusion:true};
const out=root+'/short-cached-budget-source-contract.json';
assert(!existsSync(out),'Preserve original proof; do not overwrite');
const data=JSON.stringify(proof,null,2)+'\n';
execFileSync('apply_patch',[],{input:'*** Begin Patch\n*** Add File: '+out+'\n'+data.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n'});
console.log(JSON.stringify(proof));

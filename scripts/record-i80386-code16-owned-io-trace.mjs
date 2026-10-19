/** Source-bound, media-free acceptance receipt for the owned code16 trace. */
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {cpus} from 'node:os';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const hash=data=>createHash('sha256').update(data).digest('hex');
const sourcePaths=[
  'src/experimental/i80386-code16-owned-io-trace.js',
  'test/i80386-code16-owned-io-trace.test.mjs',
  'test/fixtures/i80386-win16-io-boundary.S',
  'src/experimental/i80386.js',
  'scripts/record-i80386-code16-owned-io-trace.mjs',
];
const sourceHashes=Object.fromEntries(sourcePaths.map(path=>
  [path,hash(readFileSync(resolve(repo,path)))]));
const oraclePath='docs/receipts/2026-09-28-i80386-win16-io-boundary-oracle.json';
const negativePath='docs/receipts/2026-09-28-i80386-win16-io-boundary-mutation.json';
const oracleBytes=readFileSync(resolve(repo,oraclePath));
const negativeBytes=readFileSync(resolve(repo,negativePath));
const oracle=JSON.parse(oracleBytes),negative=JSON.parse(negativeBytes);
for(const path of ['test/fixtures/i80386-win16-io-boundary.S',
  'src/experimental/i80386.js'])
  if(sourceHashes[path]!==oracle.sourceHashes[path])
    throw new Error(`prior oracle source changed: ${path}`);
if(oracle.reference.outputHex!=='a54b'||oracle.bochs?.outputHex!=='a54b'||
   oracle.status!=='pass'||negative.status!=='fail'||
   negative.differences?.map(item=>item.field).join()!=='local.after')
  throw new Error('pinned QEMU/Bochs oracle receipts failed');
const testCommand=['--test','test/i80386-code16-owned-io-trace.test.mjs'];
const run=spawnSync(process.execPath,testCommand,{cwd:repo,encoding:'utf8'});
if(run.error||run.status!==0||!run.stdout.includes('# pass 4')||
   !run.stdout.includes('# fail 0'))
  throw new Error(`owned trace acceptance failed:\n${run.stderr}\n${run.stdout}`);
const testNames=[...run.stdout.matchAll(/^# Subtest: (.+)$/gm)].map(match=>match[1]);
if(testNames.length!==4)throw new Error('unexpected test set');
const receipt={schema:'bw.i80386-code16-owned-io-trace.v1',
  revision:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
  sourceHashes,
  priorOracle:{positiveReceiptSha256:hash(oracleBytes),
    negativeReceiptSha256:hash(negativeBytes),
    imageSha256:oracle.imageSha256,
    qemuSha256:oracle.reference.qemuSha256,
    bochsSha256:oracle.bochs.bochsSha256,
    scope:'QEMU 486 CPU-state checkpoints; Bochs CPU-level-3 output witness only'},
  acceptance:{entry:{cs:8,eip:0x7c2e,eflags:6},
    taken:{completed:3,exit:'io-required',stop:{cs:8,eip:0x7c3c},
      readCounts:[0,1],referenceBefore:oracle.reference.before,
      referenceAfter:oracle.reference.after},
    deadline:{one:'chip-deadline, completed 0, unchanged state',
      two:'chip-deadline, completed 0, unchanged state',
      three:'accepted, completed 3'},
    fallthrough:{cmpImmediate:2,exit:'branch-fallthrough',
      stop:{cs:8,eip:0x7c36},readCount:0,ordinaryParity:true},
    mutation:{kind:'JZ displacement changed from 06 to 07',
      exit:'code-mismatch',completed:0,unchangedCpuAndPortState:true}},
  validation:{command:`node ${testCommand.join(' ')}`,passed:4,failed:0,testNames},
  host:{node:process.version,cpuModel:cpus()[0]?.model},
  limits:'Fixture-specific protected16 correctness only. No production integration, general ISA coverage, real chip scheduler, Windows media, VM86 result, or speed claim.'};
console.log(JSON.stringify(receipt,null,2));

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {assertNativeRepPfPitProof,parseRepNativeLog} from '../scripts/i80386-native-rep-pf-pit-board-gate.mjs';
import {assembleRepPfPitRom} from '../scripts/i80386-rep-pf-pit-oracle.mjs';

// Lossless, actual first passing four-arm capture. Final qualification uses a
// fresh source freeze after these tests; no failed diagnostic capture is used.
const actualSha='9516ac2e3e38a42c52d41c6490f0b90e696afdd3c20137aede753ffc5a406a01';
const actualRevision='59b528bf0a0dbc5dc7bbc0416c9ade035fca78d5';
const sha=v=>createHash('sha256').update(v).digest('hex');
let bytes=gunzipSync(readFileSync(new URL('./fixtures/i80386-native-rep-pf-pit-board-gate-capture.json.gz',import.meta.url)));
assert.equal(sha(bytes),actualSha);
const capture=JSON.parse(bytes);bytes=null;
const {rom}=assembleRepPfPitRom(),names=['continuous','budget1','budget2','budget257'];
const zero='0'.repeat(64);
// Share immutable large board journals. Clone only branches changed by a test,
// avoiding a second 116MiB report per mutation on the small qualification VPS.
function copy(){return {...capture,arms:{...capture.arms},artifacts:{...capture.artifacts},source:structuredClone(capture.source),probes:{...capture.probes},transportProbes:{...capture.transportProbes}};}
function arm(r,name){if(r.arms[name]===capture.arms[name]){const a=capture.arms[name];r.arms[name]={...a,raw:{...a.raw},rpc:{...a.rpc},artifacts:structuredClone(a.artifacts)};r.artifacts[name]=structuredClone(a.artifacts);}return r.arms[name];}
const ord={CMD:5,ATTEMPT:4,PREFETCH:3,RPC_REQ:8,RPC_REP:4,RPC_MEM:9,RPC_PAGE:8,COMMIT:8,COHERENCE:6,QUANTUM:9,NATIVE_TICK:4,MEM:7,EXEC:4,PORT:5,HALT_IDLE:6,POST_STATE:22,POST_EXTRA:22,POST_SEG:17,POST_SYS:17,POST_DR:8,BOUNDARY:5,FAULT_BEGIN:7,FAULT_DELIVERED:8,IRQ_ACK:5,IRQ_DELIVERED:6,IRQ_LINE:3};
function row(records,tag,predicate=()=>true){const x=records.find(x=>x.tag===tag&&predicate(x.fields));assert(x,`actual ${tag} witness`);return x;}
function rewrite(r,name,change,{renumber=false}={}){const a=arm(r,name),records=structuredClone(a.native.records);change(records);if(renumber){let n=1;for(const x of records)if(Object.hasOwn(ord,x.tag))x.fields[ord[x.tag]]=String(n++);}let next=0;const lines=a.raw.stderr.split('\n').flatMap(line=>{if(!line.startsWith('BWS11\t'))return [line];if(next===records.length)return [];const x=records[next++];return [['BWS11',x.tag,...x.fields].join('\t')];});assert.equal(next,records.length);a.raw.stderr=lines.join('\n');a.native=parseRepNativeLog(a.raw.stderr);a.artifacts.files.stderr.sha256=r.artifacts[name].files.stderr.sha256=sha(a.raw.stderr);assert.deepEqual(a.artifacts,r.artifacts[name]);}
const native=(r,tag,change,predicate)=>names.forEach(n=>rewrite(r,n,records=>change(row(records,tag,predicate).fields)));
function remove(r,tag,predicate){for(const n of names)rewrite(r,n,records=>{const x=row(records,tag,predicate);records.splice(records.indexOf(x),1);},{renumber:true});}
function rpc(r,name,direction,change){const a=arm(r,name),lines=[...a.rpc[direction]];change(lines);a.rpc[direction]=lines;const kind=direction==='fromNative'?'rpcFromNative':'rpcToNative';a.raw[kind]=lines.join('\n')+'\n';a.artifacts.files[kind].sha256=r.artifacts[name].files[kind].sha256=sha(a.raw[kind]);}
function swapData(r){for(const n of names)rewrite(r,n,records=>{const selected=records.filter(x=>x.tag==='MEM'&&x.fields[0]==='W'&&x.fields[8]==='data'&&x.fields[1]==='00004ff8');assert.equal(selected.length,1);const a=selected[0],b=records[records.indexOf(a)+1];assert.equal(b.tag,'MEM');const pa=[...a.fields],pb=[...b.fields];a.fields=pb;b.fields=pa;[a.fields[7],b.fields[7]]=[pa[7],pb[7]];});}
function swapOrdinaryRead(r){for(const n of names)rewrite(r,n,records=>{const a=row(records,'MEM',p=>p[0]==='R'&&p[8]==='data'),b=records[records.indexOf(a)+1];assert.equal(b.tag,'MEM');assert.equal(b.fields[0],'R');const pa=[...a.fields],pb=[...b.fields];a.fields=pb;b.fields=pa;[a.fields[7],b.fields[7]]=[pa[7],pb[7]];});}
function pendingFaultWrite(r){native(r,'MEM',p=>p[8]='data',p=>p[8]==='pte-ad-write');}
function probe(r,group){const key=Object.keys(r[group])[0];r[group][key]=structuredClone(r[group][key]);return r[group][key];}

function coherentKind(r,site){for(const n of names){const a=arm(r,n),request=a.host.journal.find(x=>x.kind==='request'&&x.request.operation==='QUANTUM'&&x.request.successfulQuanta===site);assert(request);const seq=request.request.seq,kind=request.request.arg0===1?0:1;a.host={...a.host,journal:a.host.journal.map(x=>x===request?{...x,request:{...x.request,arg0:kind}}:x)};rpc(r,n,'fromNative',lines=>{const at=lines.findIndex(x=>x.startsWith(`BWR11\tREQ\t${seq}\t`));assert(at>=0);const p=lines[at].split('\t');p[4]=String(kind);lines[at]=p.join('\t');});rewrite(r,n,records=>{row(records,'RPC_REQ',p=>Number(p[0])===seq).fields[2]=String(kind);row(records,'QUANTUM',p=>Number(p[6])===site).fields[0]=String(kind);const boundary=row(records,'BOUNDARY',p=>Number(p[4])===site+1&&['ordinary','rep-element'].includes(p[0]));boundary.fields[0]=kind?'rep-element':'ordinary';for(const x of records){if(x.tag==='COMMIT'&&Number(x.fields[7])===site+1)x.fields[9]=boundary.fields[0];if(x.tag==='COHERENCE'&&Number(x.fields[5])===site+1)x.fields[7]=boundary.fields[0];}});}}
function wholeChipReplay(r){for(const n of names){const a=arm(r,n);a.host={...a.host,journal:a.host.journal.map(x=>{if(x.kind!=='request')return x;const tweak=state=>({...state,board:{...state.board,chipStates:{...state.board.chipStates,uart1:{...state.board.chipStates.uart1,lcr:state.board.chipStates.uart1.lcr^1}}}});return {...x,before:tweak(x.before),after:tweak(x.after)};})};}}

test('actual historical capture proves compact REP/PF/PIT actual-board scope',()=>{assert.equal(capture.source.boardRevision,actualRevision);const result=assertNativeRepPfPitProof(capture,rom);assert.equal(result.fullResetParity,false);assert.equal(result.fullByteBusOrderParity,false);assert.equal(result.nativeBudgetByteBusOrderParity,true);for(const a of Object.values(result.arms))assert.deepEqual(a,{successfulQuanta:135,nativeTicks:137,faults:2,irq:32,boardClocks:814});assert.equal(result.budgetProof.onlyScopedResumeDecodes,true);});

function wrongReplyTuple(r){for(const n of names){rpc(r,n,'toNative',lines=>{const i=lines.findIndex(x=>x.startsWith('BWR11\tREP\t'));assert(i>=0);const p=lines[i].split('\t');p[2]=String(Number(p[2])+1);lines[i]=p.join('\t');});}}
function wholeTableAttribution(r,from,to){for(const n of names)rewrite(r,n,records=>{const first=row(records,'MEM',p=>p[8]===from),at=records.indexOf(first);for(const x of records.slice(at,at+4)){assert.equal(x.tag,'MEM');assert.equal(x.fields[8],from);x.fields[8]=to;}});}
const cases=[
 ['ordinary read order outside four named rules',swapOrdinaryRead,/strict per-Q ordered data bus with only four declared read rules/],
 ['actual fault frame RF byte changed',r=>native(r,'MEM',p=>p[4]='00',p=>p[0]==='W'&&p[8]==='fault-frame'&&p[1]==='00008ffe'&&p[4]==='01'),/every native physical byte is actual board callback/],
 ['whole same-value PDE group substituted as PTE',r=>wholeTableAttribution(r,'pde-read','pte-read'),/PDE\/PTE reads derive exact fixture/],
 ['combined A/D write role substituted',r=>wholeTableAttribution(r,'pde-ad-write','pte-ad-write'),/PTE A\/D targets exact sparse mapping/],
 ['wrong page-fault CR2',r=>native(r,'FAULT_BEGIN',p=>p[2]='00006000'),/exact failed attempt page-fault begin/],
 ['wrong page-fault restart PC',r=>native(r,'FAULT_BEGIN',p=>p[4]='00000234'),/exact failed attempt page-fault begin/],
 ['wrong ACK vector',r=>native(r,'IRQ_ACK',p=>p[0]='21'),/IRQ ACK exact STI successor eligibility and zero-work delivery/],
 ['wrong synchronous reply ownership',wrongReplyTuple,/RPC chronology\/reply bytes/],
 ['coherent nonfinal REP classification',r=>coherentKind(r,71),/quantum kind\/site and committed REP progress/],
 ['coherent final REP classification',r=>coherentKind(r,105),/quantum kind\/site and committed REP progress/],
 ['coherent zero REP classification',r=>coherentKind(r,89),/quantum kind\/site and committed REP progress/],
 ['whole configured UART snapshots coherently altered',wholeChipReplay,/actual host replay journal/],
 ['missing actual arm',r=>delete r.arms.budget257,/four actual arms/],
 ['missing named reset differences',r=>r.resetDifferences={},/named CPU differences/],
 ['missing exact source-backed bus differences',r=>r.busDifferences={},/exact delivery order declaration/],
 ['well formed substituted binary digest',r=>r.source.binarySha256=zero,/qualified native build binarySha256/],
 ['missing transitive PIT source',r=>delete r.source.sourceHashes['src/i8254.js'],/complete historical inventory/],
 ['substituted compiled runtime',r=>r.source.runtimeSha256=zero,/qualified native build runtimeSha256/],
 ['substituted transformed paging',r=>r.source.patchedHashes['bochs/cpu/paging.cc']=zero,/all native transformed byte pins/],
 ['wrong immutable ROM',r=>r.source.romSha256=zero,/free ROM bytes/],
 ['native guard absent',r=>delete r.probes[Object.keys(r.probes)[0]],/actual rejection probe set/],
 ['native guard normal exit',r=>probe(r,'probes').exit={code:0,signal:null},/native rejection exit/],
 ['transport injection absent',r=>probe(r,'transportProbes').injected=false,/actual transport injection reached/],
 ['fallback exact zero shape',r=>native(r,'FALLBACK',p=>p[0]='1'),/zero fallback exact shape/],
 ['missing callback API rejection',r=>remove(r,'PROBE',p=>p[0]==='line-reentry'),/all actual API probes/],
 ['quantum ledger gap',r=>native(r,'QUANTUM',p=>p[6]='1'),/Q ledger/],
 ['native tick double charge',r=>native(r,'NATIVE_TICK',p=>p[0]='2'),/independent native tick ledger/],
 ['nonfinal REP partial CX changed',r=>native(r,'QUANTUM',p=>p[4]='0002',p=>p[0]==='1'&&p[4]==='0003'),/quantum kind\/site and committed REP progress/],
 ['final REP destination progress changed',r=>native(r,'QUANTUM',p=>p[5]='00006004',p=>p[0]==='1'&&p[5]==='00006008'),/quantum kind\/site and committed REP progress/],
 ['zero-count REP incorrectly charged as element',r=>native(r,'QUANTUM',p=>p[0]='1',p=>p[2]==='00000234'),/quantum kind\/site and committed REP progress/],
 ['fault delivery charges Q',r=>native(r,'FAULT_DELIVERED',p=>p[7]=String(Number(p[7])+1)),/raw event clock chronology/],
 ['IRQ delivery charges N',r=>native(r,'IRQ_DELIVERED',p=>p[4]=String(Number(p[4])+1)),/raw event clock chronology/],
 ['ACK before STI successor',r=>native(r,'IRQ_ACK',p=>p[2]='00000250'),/IRQ ACK exact STI successor eligibility and zero-work delivery/],
 ['page pointer generation stale',r=>native(r,'EXEC',p=>p[5]='1'),/execute ROM pointer SHA\/generation/],
 ['page pointer digest wrong',r=>native(r,'EXEC',p=>p[6]=zero),/execute ROM pointer SHA\/generation/],
 ['raw physical prefetch changed',r=>native(r,'PREFETCH',p=>p[0]='000f0100'),/actual prefetch current architectural PC/],
 ['decoded instruction bytes changed',r=>native(r,'ATTEMPT',p=>p[7]='90'.repeat(Number(p[6]))),/actual decoded instruction bytes/],
 ['full CPU register changed',r=>native(r,'POST_STATE',p=>p[0]='00000001'),/successful raw CPU checkpoint and named differences/],
 ['segment cache base changed',r=>native(r,'POST_SEG',p=>p[10]='00001000'),/full segment descriptor\/cache attributes/],
 ['system cache limit changed',r=>native(r,'POST_SYS',p=>p[11]='00000000'),/raw system caches unchanged/],
 ['debug register changed',r=>native(r,'POST_DR',p=>p[0]='00000001'),/all debug registers/],
 ['raw native interrupt pending changed',r=>native(r,'POST_EXTRA',p=>p[18]='00000400'),/raw native pending interrupt and IF event mask/],
 ['raw IF event mask changed',r=>native(r,'POST_EXTRA',p=>p[19]='00000100'),/raw native pending interrupt and IF event mask/],
 ['commit generation changed',r=>native(r,'COMMIT',p=>p[4]=String(Number(p[4])+1)),/exact acknowledged RAM commit/],
 ['commit whole span changed',r=>native(r,'COMMIT',p=>{p[2]='1';p[3]=p[3].slice(0,2);}),/exact acknowledged RAM commit/],
 ['missing committed effect coherently renumbered',r=>remove(r,'COMMIT'),/exact acknowledged RAM commit|incomplete or duplicate effects publication/],
 ['coherence clock changed',r=>native(r,'COHERENCE',p=>p[4]=String(Number(p[4])+1)),/raw event clock chronology/],
 ['pagewalk boundary admits ordinary write',pendingFaultWrite,/prefetch drains only pagewalk A\/D effects|strict per-Q ordered data bus/],
 ['ordinary REP byte order swapped',swapData,/ordered ordinary\/REP per-Q data writes/],
 ['PDE read attribution replaced by same-value PTE',r=>native(r,'MEM',p=>p[8]='pte-read',p=>p[8]==='pde-read'),/whole typed PDE\/PTE read|PDE\/PTE reads derive/],
 ['cumulative slice attempts changed',r=>native(r,'SLICE',p=>p[15]=String(Number(p[15])+1)),/complete RUN DONE\/raw SLICE mirror/],
 ['callback physical read summary changed',r=>native(r,'CALLBACKS',p=>p[0]=String(Number(p[0])+1)),/actual callback summary/],
 ['budget1 exact resume decode missing',r=>rewrite(r,'budget1',records=>{const x=row(records,'ATTEMPT',p=>p[2]==='73'&&p[3]==='73'&&p[1]==='0000022c');records.splice(records.indexOf(x),1);},{renumber:true}),/actual attempt rows|only two scoped budget-induced resume entries/],
];
for(const [name,mutate,expected] of cases)test(`reject ${name}`,()=>{const report=copy();mutate(report);assert.throws(()=>assertNativeRepPfPitProof(report,rom),expected);});

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {assertNativeCombinedPagingRamProof,parseCombinedNativeLog} from '../scripts/i80386-native-combined-paging-ram-board-gate.mjs';
import {assembleCombinedPagingRamRom} from '../scripts/i80386-combined-paging-ram-oracle.mjs';

// Lossless, actual first passing four-arm capture. Final qualification uses a
// fresh source freeze after these tests; no failed diagnostic capture is used.
const actualSha='3c926e4decb51179698bd8129b14abaebc66edcf77d888b79c3c3ff00c9a9e0a';
const actualRevision='57548693306523025b43787b50337451cd0c6079';
const sha=v=>createHash('sha256').update(v).digest('hex');
let bytes=gunzipSync(readFileSync(new URL('./fixtures/i80386-native-combined-paging-ram-board-gate-capture.json.gz',import.meta.url)));
assert.equal(sha(bytes),actualSha);
const capture=JSON.parse(bytes);bytes=null;
const {rom}=assembleCombinedPagingRamRom(),names=['continuous','budget1','budget2','budget257'];
const zero='0'.repeat(64);
// Share immutable large board journals. Clone only branches changed by a test,
// avoiding a second 188MB report per mutation on the small qualification VPS.
function copy(){return {...capture,arms:{...capture.arms},artifacts:{...capture.artifacts},source:structuredClone(capture.source),probes:{...capture.probes},transportProbes:{...capture.transportProbes}};}
function arm(r,name){if(r.arms[name]===capture.arms[name]){const a=capture.arms[name];r.arms[name]={...a,raw:{...a.raw},rpc:{...a.rpc},artifacts:structuredClone(a.artifacts)};r.artifacts[name]=structuredClone(a.artifacts);}return r.arms[name];}
const ord={CMD:5,ATTEMPT:4,PREFETCH:3,RPC_REQ:8,RPC_REP:4,RPC_MEM:9,RPC_PAGE:8,RPC_PIO:6,ALIAS_UPDATE:9,STAMP:6,PREFETCH_INVALIDATE:7,TLB_INVALIDATE:4,TLB_OBSERVED:7,MAP_COMMIT:6,COMMIT:8,COHERENCE:6,QUANTUM:9,NATIVE_TICK:4,MEM:7,EXEC:4,PORT:5,HALT_IDLE:6,POST_STATE:22,POST_EXTRA:22,POST_SEG:17,POST_SYS:17,POST_DR:8,BOUNDARY:5,FAULT_BEGIN:7,FAULT_DELIVERED:8,IRQ_ACK:5,IRQ_DELIVERED:6,IRQ_LINE:3};
function row(records,tag,predicate=()=>true){const x=records.find(x=>x.tag===tag&&predicate(x.fields));assert(x,`actual ${tag} witness`);return x;}
function rewrite(r,name,change,{renumber=false}={}){const a=arm(r,name),records=structuredClone(a.native.records);change(records);if(renumber){let n=1;for(const x of records)if(Object.hasOwn(ord,x.tag))x.fields[ord[x.tag]]=String(n++);}let next=0;const lines=a.raw.stderr.split('\n').flatMap(line=>{if(!line.startsWith('BWS12\t'))return [line];if(next===records.length)return [];const x=records[next++];return [['BWS12',x.tag,...x.fields].join('\t')];});assert.equal(next,records.length);a.raw.stderr=lines.join('\n');a.native=parseCombinedNativeLog(a.raw.stderr);a.artifacts.files.stderr.sha256=r.artifacts[name].files.stderr.sha256=sha(a.raw.stderr);assert.deepEqual(a.artifacts,r.artifacts[name]);}
const native=(r,tag,change,predicate)=>names.forEach(n=>rewrite(r,n,records=>change(row(records,tag,predicate).fields)));
function remove(r,tag,predicate){for(const n of names)rewrite(r,n,records=>{const x=row(records,tag,predicate);records.splice(records.indexOf(x),1);},{renumber:true});}
function rpc(r,name,direction,change){const a=arm(r,name),lines=[...a.rpc[direction]];change(lines);a.rpc[direction]=lines;const kind=direction==='fromNative'?'rpcFromNative':'rpcToNative';a.raw[kind]=lines.join('\n')+'\n';a.artifacts.files[kind].sha256=r.artifacts[name].files[kind].sha256=sha(a.raw[kind]);}
function swapData(r){for(const n of names)rewrite(r,n,records=>{const selected=records.filter(x=>x.tag==='MEM'&&x.fields[0]==='W'&&x.fields[8]==='data'&&x.fields[1]==='00004ff8');assert.equal(selected.length,1);const a=selected[0],b=records[records.indexOf(a)+1];assert.equal(b.tag,'MEM');const pa=[...a.fields],pb=[...b.fields];a.fields=pb;b.fields=pa;[a.fields[7],b.fields[7]]=[pa[7],pb[7]];});}
function swapOrdinaryRead(r){for(const n of names)rewrite(r,n,records=>{const a=row(records,'MEM',p=>p[0]==='R'&&p[8]==='data'),b=records[records.indexOf(a)+1];assert.equal(b.tag,'MEM');assert.equal(b.fields[0],'R');const pa=[...a.fields],pb=[...b.fields];a.fields=pb;b.fields=pa;[a.fields[7],b.fields[7]]=[pa[7],pb[7]];});}
function pendingFaultWrite(r){native(r,'MEM',p=>p[8]='data',p=>p[8]==='pte-ad-write');}
function probe(r,group){const key=Object.keys(r[group])[0];r[group][key]=structuredClone(r[group][key]);return r[group][key];}


// The fixture is the exact actual first r2 passing source-bound candidate.
// Every raw change reparses native evidence and binds both artifact mirrors.
const nativeField=(tag,index,value,predicate)=>r=>native(r,tag,p=>p[index]=typeof value==='function'?value(p[index]):value,predicate);
const bump=value=>String(Number(value)+1);
function coherentConfig(r){r.source.bochsrcText=r.source.bochsrcText.replace('ips=10000000','ips=9999999');r.source.bochsrcSha256=sha(r.source.bochsrcText);r.artifacts.bochsrc={...r.artifacts.bochsrc,sha256:r.source.bochsrcSha256};}
function coherentWholeChip(r){for(const n of names){const a=arm(r,n),tweak=s=>({...s,board:{...s.board,chipStates:{...s.board.chipStates,uart1:{...s.board.chipStates.uart1,lcr:s.board.chipStates.uart1.lcr^1}}}});a.host={...a.host,journal:a.host.journal.map(x=>x.kind==='request'?{...x,before:tweak(x.before),after:tweak(x.after)}:x)};}}
function coherentKind(r,site){for(const n of names){const a=arm(r,n),callback=a.host.journal.find(x=>x.kind==='request'&&x.request.operation==='QUANTUM'&&x.request.successfulQuanta===site);assert(callback);const seq=callback.request.seq,kind=1-callback.request.arg0;a.host={...a.host,journal:a.host.journal.map(x=>x===callback?{...x,request:{...x.request,arg0:kind}}:x)};rpc(r,n,'fromNative',lines=>{const i=lines.findIndex(x=>x.startsWith(`BWR12\tREQ\t${seq}\t`));assert(i>=0);const p=lines[i].split('\t');p[4]=String(kind);lines[i]=p.join('\t');});rewrite(r,n,records=>{row(records,'RPC_REQ',p=>Number(p[0])===seq).fields[2]=String(kind);row(records,'QUANTUM',p=>Number(p[6])===site).fields[0]=String(kind);const b=row(records,'BOUNDARY',p=>Number(p[4])===site+1&&['ordinary','rep-element'].includes(p[0]));const oldKind=b.fields[0],ownN=b.fields[3];b.fields[0]=kind?'rep-element':'ordinary';for(const x of records){if(x.tag==='COMMIT'&&Number(x.fields[7])===site+1&&x.fields[6]===ownN&&x.fields[9]===oldKind)x.fields[9]=b.fields[0];if(x.tag==='COHERENCE'&&Number(x.fields[5])===site+1&&x.fields[4]===ownN&&x.fields[7]===oldKind)x.fields[7]=b.fields[0];}});}}
function probeRaw(r,group,name,kind,change){const p=r[group][name]=structuredClone(r[group][name]);p.raw[kind]=change(p.raw[kind]);const prefix=group==='probes'?'guard':'transport';r.artifacts[prefix+'-'+name]=structuredClone(p.files);p.files[kind].sha256=r.artifacts[prefix+'-'+name][kind].sha256=sha(p.raw[kind]);}
function wrongResumeCut(r){const n='budget1';let seq;rewrite(r,n,records=>{const s=row(records,'SLICE',p=>p[12]==='94'&&p[14]==='94');seq=s.fields[0];s.fields[6]='2';});rpc(r,n,'fromNative',lines=>{const i=lines.findIndex(x=>x.startsWith(`BWR12\tDONE\t${seq}\tRUN\t`));assert(i>=0);const p=lines[i].split('\t');p[4]='2';lines[i]=p.join('\t');});}
function changedPITAdvance(r){for(const n of names){const a=arm(r,n);a.host={...a.host,chipAdvances:a.host.chipAdvances.map((x,i)=>i===0?{...x,after:{...x.after,pit:{...x.after.pit,fraction:x.after.pit.fraction+0.125}}}:x)};}}
function changedPITEdge(r){for(const n of names){const a=arm(r,n);let found=false;a.host={...a.host,journal:a.host.journal.map(x=>{if(!found&&x.kind==='pit-output'&&x.channel===0&&x.level){found=true;return {...x,level:0};}return x;})};assert(found,'actual PIT rising edge');}}
function corruptedADBefore(r){for(const n of names){const a=arm(r,n),ad=a.native.events.find(e=>e.tag==='MEM'&&e.why==='pde-ad-write'),ordinal=ad.ordinal,reply=a.native.events.filter(e=>e.tag==='RPC_MEM'&&e.ordinal<ordinal).at(-1);assert(reply);a.host={...a.host,bus:a.host.bus.map(b=>b.seq===reply.seq&&b.raw===ad.raw?{...b,before:b.before^0x10}:b)};}}
function guardForbiddenRequest(r){const name='executable-table-ad-write';probeRaw(r,'probes',name,'rpcFromNative',()=> 'BWR12\tREQ\t1\tWRITE\t28672\t1\t0\t00\t0\t0\n');probeRaw(r,'probes',name,'stderr',text=>text.replace('BWS12\tFAIL', 'BWS12\tRPC_REQ\t1\tWRITE\t28672\t1\t0\t00\t0\t0\t2\nBWS12\tFAIL'));}
function guardForbiddenEffect(r){probeRaw(r,'probes','executable-table-ad-write','stderr',text=>text.replace('BWS12\tFAIL','BWS12\tMEM\tW\t00007000\t00007000\tram\t00\tram-commit\t0\t2\tpte-ad-write\t0\t1\nBWS12\tFAIL'));}
function restoredTransportDigest(r){probeRaw(r,'transportProbes','page-digest','rpcToNative',text=>{const lines=text.trimEnd().split('\n'),data=lines.filter(x=>x.startsWith('BWR12\tDATA\t')).map(x=>Buffer.from(x.split('\t')[4],'hex'));assert.equal(data.length,64);const i=lines.findIndex(x=>x.startsWith('BWR12\tPAGE\t'));assert(i>=0);const p=lines[i].split('\t');p[6]=sha(Buffer.concat(data));lines[i]=p.join('\t');return lines.join('\n')+'\n';});}
function earlyCallbackAPI(r){for(const n of names)rewrite(r,n,records=>{const p=row(records,'PROBE',p=>p[0]==='callback-reentry');records.splice(records.indexOf(p),1);records.unshift(p);});}
const cases=[
 ['guard forbidden WRITE RPC before named denial with coherent hashes',guardForbiddenRequest,/guard before-effect RPC streams empty/],
 ['guard forbidden AD byte effect before named denial with coherent hashes',guardForbiddenEffect,/guard before-effect native startup only/],
 ['transport malformed digest restored while retaining injected claim',restoredTransportDigest,/actual malformed transport reply witness/],
 ['API callback reentry witness moved before cold activation',earlyCallbackAPI,/API preactivation phases/],
 ['A/D original-byte permission provenance changed',corruptedADBefore,/actual host byte ledger/],
 ['PIT fractional phase in actual chip advance changed',changedPITAdvance,/whole chip advance journal/],
 ['actual PIT rising edge suppressed in journal',changedPITEdge,/actual host replay journal/],
 ['coherent actual REP resume cut reason changed',wrongResumeCut,/only Q-budget REP reentry/],
 ['cumulative REP partial count changed',nativeField('SLICE',18,bump),/every slice cumulative raw event counters/],
 ['API reentry witness absent',r=>remove(r,'PROBE',p=>p[0]==='callback-reentry'),/all exact actual API rejection witnesses/],
 ['API line reentry falsely accepted',nativeField('PROBE',1,'accepted',p=>p[0]==='line-reentry'),/all exact actual API rejection witnesses/],
 ['transport injection metadata absent',r=>probe(r,'transportProbes').injected=false,/actual transport injection reached/],
 ['transport raw FAIL cause altered with both hashes',r=>probeRaw(r,'transportProbes','page-digest','stderr',text=>text.replace('BWS12\tFAIL\trpc-page-sha256','BWS12\tFAIL\trpc-page-metadata')),/raw named FAIL witness/],
 ['native denial signal replaced with normal exit',r=>probe(r,'probes').exit={code:0,signal:null},/native rejection exit/],
 ['PTE A\/D group reclassified as PDE A\/D coherently',r=>{for(const n of names)rewrite(r,n,records=>{const first=row(records,'MEM',p=>p[8]==='pte-ad-write'),i=records.indexOf(first),raw=first.fields[1];for(const x of records.slice(i,i+4))x.fields[8]='pde-ad-write';row(records,'COMMIT',p=>p[0]===raw&&p[11]==='pte-ad-write').fields[11]='pde-ad-write';});},/source legacy combined A\/D updates after permission validation/],
 ['coherent nonfinal REP kind changed',r=>coherentKind(r,92),/ordinary\/zeroREP vs each successful REP element/],
 ['coherent final REP kind changed',r=>coherentKind(r,107),/ordinary\/zeroREP vs each successful REP element/],
 ['coherent zero REP kind changed',r=>coherentKind(r,110),/ordinary\/zeroREP vs each successful REP element/],
 ['substituted binary pin',r=>r.source.binarySha256=zero,/qualified native build binarySha256/],
 ['substituted runtime pin',r=>r.source.runtimeSha256=zero,/qualified native build runtimeSha256/],
 ['substituted generated config pin',r=>r.source.configSha256=zero,/qualified native build configSha256/],
 ['coherent canonical Bochs directive mutation',coherentConfig,/complete canonical Bochs configuration/],
 ['manifest identity changed',r=>r.source.manifestSha256=zero,/audited actual prepared build manifest/],
 ['patched paging substituted',r=>r.source.patchedHashes['bochs/cpu/paging.cc']=zero,/all native transformed byte pins/],
 ['comparison vendor source omitted',r=>delete r.source.comparisonSourceHashes['bochs/cpu/call_far.cc'],/all native raw-state\/bus comparison source pins/],
 ['actual PIT transitive source omitted',r=>delete r.source.sourceHashes['src/i8254.js'],/complete historical inventory/],
 ['configuration profile hash changed',r=>r.source.boardConfigurationSha256=zero,/actual board configuration/],
 ['actual ROM digest changed',r=>r.source.romSha256=zero,/free ROM bytes/],
 ['bus order differences omitted',r=>r.busDifferences={},/exact delivery order declaration/],
 ['native guard absent',r=>delete r.probes[Object.keys(r.probes)[0]],/actual rejection probe set/],
 ['whole configured UART snapshots coherent mutation',coherentWholeChip,/actual host replay journal/],
 ['cold raw EDX changed',nativeField('RESET',2,'00000300'),/source-backed complete raw reset/],
 ['successful full raw EAX changed',nativeField('POST_STATE',0,'00000001'),/all raw CPU fields with named source-backed differences/],
 ['raw CS cache base changed',nativeField('POST_SEG',10,'00001000',p=>p[0]==='1'),/segment.*base|descriptor.*cache|raw.*cache/],
 ['raw LDTR cache changed',nativeField('POST_SYS',11,'00000000'),/unchanged full raw LDTR\/TR checkpoint/],
 ['raw debug register changed',nativeField('POST_DR',0,'00000001'),/unchanged complete raw debug checkpoint/],
 ['raw exported pending interrupt changed',nativeField('POST_EXTRA',18,'00000400'),/exported line and IF mask source semantics/],
 ['decoded RAM opcode changed',nativeField('ATTEMPT',7,'bb9999',p=>p[9]==='ram'&&p[6]==='3'),/actual executed owned cache bytes/],
 ['RAM alias generation stale',nativeField('ATTEMPT',10,'0',p=>p[9]==='ram'),/actual instruction mapping/],
 ['raw instruction alias mapping changed',nativeField('ATTEMPT',8,'00107000',p=>p[9]==='ram'&&p[8]==='00007000'),/actual instruction mapping/],
 ['execute pointer page SHA changed',nativeField('EXEC',6,zero),/owned execute page metadata/],
 ['alias update omits second OFF alias',r=>remove(r,'ALIAS_UPDATE',p=>p[0]==='00007000'&&p[5]==='1'),/STAMP derived tag/],
 ['all-alias update SHA changed',nativeField('ALIAS_UPDATE',6,zero),/ALIAS_UPDATE derived sha256/],
 ['alias update generation changed',nativeField('ALIAS_UPDATE',4,bump),/ALIAS_UPDATE derived generation/],
 ['alias stamp raw key changed',nativeField('STAMP',0,'00007000'),/STAMP derived raw/],
 ['alias stamp fails to stop trace',nativeField('STAMP',9,'0'),/actual alias write stamp STOP_TRACE/],
 ['selective prefetch invalidation absent',r=>remove(r,'PREFETCH_INVALIDATE'),/unexpected cache action|coherence before derived actions/],
 ['mapping epoch changed',nativeField('MAP_COMMIT',3,bump),/MAP_COMMIT derived newEpoch/],
 ['native internal A20 falsely disabled',nativeField('EXEC',9,'0'),/owned execute page metadata/],
 ['ordinary RAM data incorrectly flushes TLB',nativeField('COHERENCE',10,'1',p=>p[0]==='publish-only'),/exact bridge-owned cache policy/],
 ['REP element incorrectly flushes icache',nativeField('COHERENCE',11,'1',p=>p[7]==='rep-element'),/exact bridge-owned cache policy/],
 ['missing committed ordinary RAM effect',r=>remove(r,'COMMIT',p=>p[11]==='data'),/unexpected cache action|coherence before derived actions/],
 ['native delivery Q changed',nativeField('FAULT_DELIVERED',7,bump),/FAULT_DELIVERED Q clock/],
 ['actual failed PF cause changed',nativeField('FAULT_BEGIN',2,'00006000'),/exact actual PF restart\/address\/zeroQ site/],
 ['IRQ delivery native tick changed',nativeField('IRQ_DELIVERED',4,bump),/IRQ_DELIVERED native clock/],
 ['STI successor eligibility changed',nativeField('IRQ_ACK',2,'000002c8'),/exact STI successor eligibility\/PIC ACK/],
 ['partial successful REP CX changed',nativeField('QUANTUM',4,'0002',p=>p[0]==='1'&&p[4]==='0003'),/actual REP\/work progress/],
 ['same-value PDE group reclassified PTE',r=>{for(const n of names)rewrite(r,n,records=>{const x=row(records,'MEM',p=>p[8]==='pde-read'),i=records.indexOf(x);for(const x of records.slice(i,i+4))x.fields[8]='pte-read';});},/native pagewalk begins PDE role/],
 ['all fallback exact zero witness changed',nativeField('FALLBACK',0,'1'),/all fallback paths zero/],
 ['cumulative slice HALT count changed',nativeField('SLICE',22,bump),/complete RUN DONE\/raw SLICE mirror|every slice cumulative raw event counters/],
 ['callback read census changed',nativeField('CALLBACKS',0,bump),/exact observed callback census/],
];
test('actual first r2 capture proves only its bounded combined board scope',()=>{assert.equal(capture.source.boardRevision,actualRevision);const proof=assertNativeCombinedPagingRamProof(capture,rom);assert.equal(proof.qualificationStatus,'QUALIFIED');assert.equal(proof.fullResetParity,false);assert.equal(proof.fullByteBusOrderParity,false);assert.equal(proof.nativeBudgetByteBusOrderParity,true);for(const a of Object.values(proof.arms))assert.deepEqual(a,{successfulQuanta:192,nativeTicks:194,boardClocks:1156});assert.equal(proof.budgetProof.logicalRecords,6192);});

for(const [name,mutate,diagnostic] of cases)test(name,()=>{const report=copy();mutate(report);assert.throws(()=>assertNativeCombinedPagingRamProof(report,rom),diagnostic);});


/** Fresh-profile, loopback-only Chromium worker benchmark. No npm dependency. */
import {createServer} from 'node:http';
import {readFileSync,mkdtempSync,rmSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve,sep,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir,cpus,platform,arch} from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {summarizeHarrisBrowserSamples} from '../scripts/lib/harris-browser-measurement.mjs';
const root=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
const rounds=Number(process.argv[2]??3),workloads=(process.argv[3]??'memory,io,dma,interrupt,idle').split(',');
if(!Number.isSafeInteger(rounds)||rounds<1||rounds>10||workloads.some(n=>!['memory','io','dma','interrupt','idle'].includes(n)))throw new RangeError('rounds/workloads');
const chrome=process.env.CHROME_BIN;
if(!chrome)throw new Error('Set CHROME_BIN to an existing local Chromium binary');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHashes=Object.fromEntries(['bench/harris-browser.mjs','scripts/lib/harris-browser-measurement.mjs','src/execution-measurement.js']
    .map(path=>[path,hash(readFileSync(join(root,path)))]));
const nativePath=process.env.HARRIS_NET_WASM;
let nativeBytes=null,nativeModule=null;
if(nativePath) {
    nativeBytes=readFileSync(nativePath);
    const build=JSON.parse(readFileSync(join(dirname(nativePath),'wired-net-kernel-build.json')));
    const verifiedSources=build.sourceHashes??{'src/experimental/wired-kernel/net-resolver.c':build.sourceSHA256};
    assert.ok(Object.hasOwn(verifiedSources,'src/experimental/wired-kernel/net-resolver.c'));
    for(const [path,expected] of Object.entries(verifiedSources)) {
        assert.ok(['src/experimental/wired-kernel/net-resolver.c','src/experimental/wired-kernel/memory-banks.c','src/experimental/wired-kernel/memory-circuit.c','src/experimental/wired-kernel/phase-components.c','src/experimental/wired-kernel/phase-circuit.c','src/experimental/wired-kernel/phase-schedule.c','src/experimental/wired-kernel/incremental-nets.c','src/experimental/wired-kernel/bus-sequencer.c'].includes(path),'unexpected native source');
        assert.equal(hash(readFileSync(join(root,path))),expected,'rebuild native module for this source');sourceHashes[path]=expected;
    }
    assert.equal(build.wasmSHA256,hash(nativeBytes),'native build/module mismatch');
    nativeModule={sha256:build.wasmSHA256,sourceHashes:verifiedSources,compiler:build.compiler,
        admittedGraph:WebAssembly.Module.exports(new WebAssembly.Module(nativeBytes)).some(e=>e.name==='admit_owned_context'),
        incrementalGraph:WebAssembly.Module.exports(new WebAssembly.Module(nativeBytes)).some(e=>e.name==='incremental_kernel_version')};
}
const nodeReceiptBytes=readFileSync(join(root,'docs/HARRIS-OWNED-WORKLOADS-BENCH.json'));
const nodeReceipt=JSON.parse(nodeReceiptBytes),expectedStateHashes=Object.fromEntries(nodeReceipt.samples.map(s=>[s.name,s.stateSHA256]));
const availableModes={reference:{},packed:{netBackend:'compiled',memoryScheduling:true,deviceScheduling:true,packedBus:true},
    layouts:{netBackend:'compiled',memoryScheduling:true,deviceScheduling:true,packedBus:true,driveLayouts:true}};
const selectedModes=(process.argv[4]??'reference,packed').split(',');
if(new Set(selectedModes).size!==selectedModes.length||selectedModes.some(m=>!Object.hasOwn(availableModes,m)))throw new RangeError('browser modes');
const config={nonce:randomUUID(),rounds,workloads,expectedStateHashes,nativeOracle:nativeModule,modes:Object.fromEntries(selectedModes.map(m=>[m,availableModes[m]]))};
let resolveReport,rejectReport;
const done=new Promise((resolve,reject)=>{resolveReport=resolve;rejectReport=reject;});
const server=createServer((req,res)=>{
    if(req.url==='/config'&&req.method==='GET'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(config));return;}
    if(req.url==='/kernel.wasm'&&req.method==='GET'&&nativeBytes){res.setHeader('Content-Type','application/wasm');res.end(nativeBytes);return;}
    if(req.url==='/result'&&req.method==='POST') {
        let body='',oversize=false;
        req.on('data',chunk=>{body+=chunk;if(body.length>4*1024*1024){oversize=true;req.destroy();rejectReport(new Error('oversized browser receipt'));}});
        req.on('end',()=>{if(oversize)return;try{const report=JSON.parse(body);assert.equal(report.nonce,config.nonce);res.end('ok');resolveReport(report);}catch(error){res.statusCode=400;res.end('invalid receipt');rejectReport(error);}});
        return;
    }
    try {
        const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
        const allowed=pathname==='/bench/harris-browser.html'||pathname==='/bench/harris-browser-worker.mjs'||
            ['/scripts/lib/harris-browser-measurement.mjs','/scripts/lib/harris-owned-workloads.mjs','/scripts/lib/harris-native-settle-oracle.mjs','/scripts/lib/harris-native-memory-oracle.mjs','/scripts/lib/harris-native-memory-circuit-oracle.mjs','/scripts/lib/harris-native-phase-oracle.mjs','/scripts/lib/harris-native-phase-circuit-oracle.mjs','/scripts/lib/harris-native-phase-schedule-oracle.mjs','/scripts/lib/harris-native-bus-sequencer-oracle.mjs'].includes(pathname)||pathname.startsWith('/src/')&&pathname.endsWith('.js');
        if(req.method!=='GET'||!allowed)throw new Error('not served');
        const path=realpathSync(resolve(root,'.'+pathname));if(!path.startsWith(root+sep))throw new Error('outside source root');
        const bytes=readFileSync(path),key=path.slice(root.length+1),digest=hash(bytes);
        if(sourceHashes[key]&&sourceHashes[key]!==digest)throw new Error('source changed during browser run');
        sourceHashes[key]=digest;res.setHeader('Cache-Control','no-store');
        res.setHeader('Content-Type',pathname.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.end(bytes);
    }catch{res.statusCode=404;res.end('not served');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const profile=mkdtempSync(join(tmpdir(),'harris-browser-'));
let child,timeout,browserClosed,stderr='',completedReport;
const ownProcessGroup=process.platform!=='win32';
const stopBrowser=signal=>{
    if(!child?.pid)return;
    try{if(ownProcessGroup)process.kill(-child.pid,signal);else child.kill(signal);}
    catch(error){if(error.code!=='ESRCH')throw error;}
};
try {
    const browserVersion=execFileSync(chrome,['--version'],{encoding:'utf8'}).trim();
    child=spawn(chrome,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-first-run',
        '--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync',
        `--user-data-dir=${profile}`,`http://127.0.0.1:${server.address().port}/bench/harris-browser.html`],{stdio:['ignore','ignore','pipe'],detached:ownProcessGroup});
    browserClosed=new Promise(resolve=>child.once('close',resolve));
    child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-16000);});
    child.on('error',rejectReport);child.on('exit',code=>rejectReport(new Error(`Chromium exited before receipt (${code}): ${stderr}`)));
    timeout=setTimeout(()=>rejectReport(new Error(`browser benchmark timeout: ${stderr}`)),600000);
    const report=await done;
    assert.equal(report.accepted,true,report.error);assert.equal(report.samples.length,rounds*workloads.length*Object.keys(config.modes).length);
    for(const sample of report.samples)assert.equal(sample.stateSHA256,expectedStateHashes[sample.name]);
    if(nativeModule){
        assert.equal(hash(readFileSync(nativePath)),nativeModule.sha256,'native module changed during run');
        assert.equal(report.nativeOracle?.accepted,true);assert.equal(report.nativeOracle?.capacityClaim,false);
        assert.equal(report.nativeOracle?.moduleSHA256,nativeModule.sha256);assert.ok(report.nativeOracle.comparisons>200);
        if(nativeModule.sourceHashes['src/experimental/wired-kernel/memory-banks.c']) {
            assert.equal(report.nativeOracle.memory?.accepted,true);assert.equal(report.nativeOracle.memory?.capacityClaim,false);
            assert.equal(report.nativeOracle.memory?.byteValues,256);assert.equal(report.nativeOracle.memory?.faults,1);
        }
        if(nativeModule.sourceHashes['src/experimental/wired-kernel/memory-circuit.c']) {
            assert.equal(report.nativeOracle.memoryCircuit?.accepted,true);assert.equal(report.nativeOracle.memoryCircuit?.capacityClaim,false);
            assert.equal(report.nativeOracle.memoryCircuit?.comparisons,1026);assert.equal(report.nativeOracle.memoryCircuit?.faults,1);
        }
        if(nativeModule.sourceHashes['src/experimental/wired-kernel/phase-components.c']) {
            assert.equal(report.nativeOracle.phase?.accepted,true);assert.equal(report.nativeOracle.phase?.capacityClaim,false);
            assert.equal(report.nativeOracle.phase?.periods,360);assert.equal(report.nativeOracle.phase?.latchComparisons,128);
        }
        if(nativeModule.sourceHashes['src/experimental/wired-kernel/phase-circuit.c']) {
            assert.equal(report.nativeOracle.phaseCircuit?.accepted,true);assert.equal(report.nativeOracle.phaseCircuit?.capacityClaim,false);
            assert.equal(report.nativeOracle.phaseCircuit?.comparisons,1532);assert.equal(report.nativeOracle.phaseCircuit?.transactions,128);
        }
        if(nativeModule.sourceHashes['src/experimental/wired-kernel/phase-schedule.c']) {
            assert.equal(report.nativeOracle.schedule?.accepted,true);assert.equal(report.nativeOracle.schedule?.capacityClaim,false);
            assert.equal(report.nativeOracle.schedule?.periods,258);assert.equal(report.nativeOracle.schedule?.reads,64);
        }
        if(nativeModule.admittedGraph) {
            const admitted=report.nativeOracle.admittedGraph;assert.equal(admitted?.accepted,true);assert.equal(admitted?.capacityClaim,false);
            assert.equal(admitted?.memory.comparisons,1026);assert.equal(admitted?.phase.comparisons,1532);assert.equal(admitted?.schedule.periods,258);
        }
        if(nativeModule.incrementalGraph) {
            const incremental=report.nativeOracle.incrementalGraph;
            assert.equal(incremental?.accepted,true);assert.equal(incremental?.capacityClaim,false);
            assert.equal(incremental?.memory.comparisons,1026);assert.equal(incremental?.phase.comparisons,1532);assert.equal(incremental?.schedule.periods,258);
        }
        if(nativeModule.sourceHashes['src/experimental/wired-kernel/bus-sequencer.c']) {
            const bus=report.nativeOracle.busSequencer;
            assert.equal(bus?.accepted,true);assert.equal(bus?.capacityClaim,false);
            assert.equal(bus.boundaries,782);assert.equal(bus.transactions,30);assert.equal(bus.completions,36);
        }
        report.nativeBuild=nativeModule;
    }
    for(const [path,expected] of Object.entries(sourceHashes))assert.equal(hash(readFileSync(join(root,path))),expected,`${path} changed during run`);
    assert.equal(report.measurementVersion,2,'worker clock measurement contract');
    report.summaries=workloads.map(name=>({name,modes:Object.fromEntries(Object.keys(config.modes).map(mode=>{
        const samples=report.samples.filter(s=>s.name===name&&s.mode===mode);
        return [mode,summarizeHarrisBrowserSamples(samples)];
    }))}));
    delete report.nonce;
    Object.assign(report,{benchmark:'owned-wired-browser-worker',browserVersion,node:process.version,
        host:{platform:platform(),arch:arch(),cpu:cpus()[0]?.model,logicalCPUs:cpus().length},sourceHashes,
        nodeReference:{receipt:'HARRIS-OWNED-WORKLOADS-BENCH.json',sha256:hash(nodeReceiptBytes),revision:nodeReceipt.revision},
        notes:['Fresh browser profile and loopback-only source server; no guest media.','Capacity factor is not complete silicon timing certification.',
            'Measurement v2 uses actual bus clock delta including initialization; legacy clocks remains post-initialization for historical state hashes.',
            'elapsedMS, periodsPerSecond and medianMS are wall-paced; active timing sums initialization and synchronous chunks, excluding awaited yields.',
            'xtCapacityFactor now aliases measured active capacityRealTimeFactor; historical receipts used a yield-inclusive wall proxy and excluded initialization periods from their numerator.',
            'Summary rates/factors are medians of sample rates/factors, not rates reconstructed from median durations.',
            'Worker heartbeat is observed responsiveness, not a hard frame deadline or an intrinsic throughput gain.','Shared host load uncontrolled.']});
    completedReport=report;
}finally {
    clearTimeout(timeout);
    if(child?.pid) {
        stopBrowser('SIGTERM');
        const force=setTimeout(()=>stopBrowser('SIGKILL'),2000);
        await browserClosed;clearTimeout(force);
        // 'exit' covers only Chrome's main process. This fresh process group
        // also contains its profile-writing utility children; never signal
        // another browser or identify targets by executable-name matching.
        if(ownProcessGroup){stopBrowser('SIGKILL');await new Promise(resolve=>setTimeout(resolve,50));}
    }
    await new Promise(resolve=>server.close(resolve));
    // This is only the fresh temporary profile created above, never a user profile.
    // Chromium utility processes can finish a profile write just after the
    // main process exits. Bounded retries handle ENOTEMPTY without masking it.
    rmSync(profile,{recursive:true,force:true,maxRetries:8,retryDelay:100});
}
// Do not publish an accepted receipt until browser/profile cleanup succeeded.
const output=JSON.stringify({...completedReport,temporaryProfileRemoved:true},null,2);
if(process.env.HARRIS_BROWSER_REPORT)writeFileSync(process.env.HARRIS_BROWSER_REPORT,output+'\n',{flag:'wx'});
console.log(output);

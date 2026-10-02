#!/usr/bin/env python3
"""One authenticated SOURCE-ONLY child; importing this helper launches nothing."""
import datetime, hashlib, json, os, pathlib, resource, shutil, signal, subprocess, time
BASE_REVISION = 'fe1eff2039520536350922a2164c8bbe29404c68'
ROOT = pathlib.Path(os.environ.get('BW_SPAN_ROOT', '/tmp/bw-board-386-owned-span-proof-source-20261002')).resolve()
OUT = pathlib.Path(os.environ.get('BW_SPAN_OUT', '/mnt/volume1/tmp-astra/native-owned-span-source-controls-20261002')).resolve()
NODE = pathlib.Path(os.environ.get('BW_SPAN_NODE', '/tmp/node-v22.23.3-linux-x64/bin/node')).resolve()
BINDING = pathlib.Path(os.environ.get('BW_SPAN_BINDING', '/mnt/volume1/tmp-astra/386-owned-span-proof-source-draft-20261002.json')).resolve()
CONTROL = ROOT / 'scripts/bochs-cpu3-native-owned-span/controls.mjs'
BLANK_KEYS = ('NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'BW_HOT_NAPI_PROFILE', 'NODE_V8_COVERAGE')
SOURCE_PATHS = ('package.json', 'roms/free-at-bios/BIOS-bochs-legacy', 'roms/free-at-bios/vgabios-lgpl.bin', 'scripts/audit-i80386-native-direct-board-adapter.mjs', 'scripts/bochs-cpu3-native-combined-paging-ram/host.mjs', 'scripts/bochs-cpu3-native-combined-paging-ram/patch.mjs', 'scripts/bochs-cpu3-native-device-quanta/patch.mjs', 'scripts/bochs-cpu3-native-direct-board-adapter/loader.mjs', 'scripts/bochs-cpu3-native-direct-board-adapter/napi.cc', 'scripts/bochs-cpu3-native-direct-board/abi.h', 'scripts/bochs-cpu3-native-direct-board/addon.mk', 'scripts/bochs-cpu3-native-direct-board/board.mjs', 'scripts/bochs-cpu3-native-direct-board/patch.mjs', 'scripts/bochs-cpu3-native-direct-board/runtime.h', 'scripts/bochs-cpu3-native-direct-board/runtime.inc', 'scripts/bochs-cpu3-native-events/patch.mjs', 'scripts/bochs-cpu3-native-hot-direct/board.mjs', 'scripts/bochs-cpu3-native-hot-direct/journal.mjs', 'scripts/bochs-cpu3-native-hot-direct/loader.mjs', 'scripts/bochs-cpu3-native-hot-direct/profile.mjs', 'scripts/bochs-cpu3-native-hot-direct/runtime.mjs', 'scripts/bochs-cpu3-native-hot-packed-scalar/napi.mjs', 'scripts/bochs-cpu3-native-memory-map/patch.mjs', 'scripts/bochs-cpu3-native-owned-clock/abi.h', 'scripts/bochs-cpu3-native-owned-clock/clock.inc', 'scripts/bochs-cpu3-native-owned-clock/contract.md', 'scripts/bochs-cpu3-native-owned-clock/derive.mjs', 'scripts/bochs-cpu3-native-owned-clock/factory.mjs', 'scripts/bochs-cpu3-native-owned-clock/identity.mjs', 'scripts/bochs-cpu3-native-owned-clock/loader.mjs', 'scripts/bochs-cpu3-native-owned-clock/napi.mjs', 'scripts/bochs-cpu3-native-owned-clock/provider.mjs', 'scripts/bochs-cpu3-native-owned-clock/runtime.mjs', 'scripts/bochs-cpu3-native-owned-clock/worker.mjs', 'scripts/bochs-cpu3-native-owned-in8/abi.h', 'scripts/bochs-cpu3-native-owned-in8/admission.mjs', 'scripts/bochs-cpu3-native-owned-in8/bootstrap.mjs', 'scripts/bochs-cpu3-native-owned-in8/contract.md', 'scripts/bochs-cpu3-native-owned-in8/identity.mjs', 'scripts/bochs-cpu3-native-owned-in8/napi.mjs', 'scripts/bochs-cpu3-native-owned-in8/provider.mjs', 'scripts/bochs-cpu3-native-owned-in8/reset-witness.mjs', 'scripts/bochs-cpu3-native-owned-in8/runtime.mjs', 'scripts/bochs-cpu3-native-ram-coherence/patch.mjs', 'scripts/bochs-cpu3-native-rep-pf-pit/patch.mjs', 'scripts/bochs-cpu3-native-slice/patch.mjs', 'scripts/i80386-combined-paging-ram-oracle.mjs', 'scripts/i80386-free-combined-hot.mjs', 'scripts/i80386-free-owned-in8.mjs', 'scripts/i80386-native-combined-paging-ram-board-gate.mjs', 'scripts/lib/i80386-source-inventory.mjs', 'scripts/prepare-bochs-cpu3-native-direct-board.mjs', 'scripts/prepare-bochs-cpu3-native-hot-direct.mjs', 'scripts/prepare-bochs-cpu3-native-owned-clock.mjs', 'scripts/prepare-bochs-cpu3-native-owned-in8.mjs', 'scripts/run-i80386-free-owned-in8.mjs', 'scripts/run-i80386-native-owned-clock.mjs', 'scripts/run-i80386-native-owned-in8.mjs', 'src/adc0809.js', 'src/at-8042-a20.js', 'src/at-ps2-mouse.js', 'src/at-system-control.js', 'src/audio-bus.js', 'src/cga-card.js', 'src/chip-ledger.js', 'src/dac0832.js', 'src/ega-card.js', 'src/experimental/ata16.js', 'src/experimental/i80286-protected.js', 'src/experimental/i80386-at-machine.js', 'src/experimental/i80386.js', 'src/experimental/vga-memory.js', 'src/hercules-card.js', 'src/i8086-machine.js', 'src/i8086-ram-words.js', 'src/i8086.js', 'src/i8088-cycles.js', 'src/i8088-timing.js', 'src/i8237.js', 'src/i8251.js', 'src/i8254.js', 'src/i8255.js', 'src/i8259.js', 'src/machine-checkpoint.js', 'src/mc146818.js', 'src/mc6845.js', 'src/mc6850.js', 'src/ne2000.js', 'src/ns16c550.js', 'src/pc-speaker.js', 'src/sb-dsp.js', 'src/upd765.js', 'src/vga-card.js', 'src/ym3812.js', 'test/fixtures/i80386-free-combined-hot.S', 'test/fixtures/i80386-free-combined-paging-ram.S', 'test/fixtures/i80386-free-owned-in8.S', 'test/fixtures/i80386-owned-clock-harness.cc', 'test/i80386-native-direct-board.test.mjs', 'test/i80386-native-hot-direct.test.mjs', 'test/i80386-native-owned-clock-c-harness.test.mjs', 'test/i80386-native-owned-clock.test.mjs', 'test/i80386-native-owned-in8.test.mjs', 'scripts/bochs-cpu3-native-owned-span/baseline-source.json', 'scripts/bochs-cpu3-native-owned-span/controls.mjs', 'scripts/bochs-cpu3-native-owned-span/derivation.json', 'scripts/bochs-cpu3-native-owned-span/derive.mjs', 'scripts/bochs-cpu3-native-owned-span/plan.md', 'scripts/bochs-cpu3-native-owned-span/provider.mjs', 'scripts/bochs-cpu3-native-owned-span/span-method.txt')
LIMITS = {'cpuSeconds':120, 'wallSeconds':120, 'fileBytes':256*1024*1024, 'coreBytes':0, 'niceIncrement':10, 'heapMiB':512}
def sha(path): return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def safe_sha(path):
    try: return sha(path),None
    except Exception as e: return None,type(e).__name__+': '+str(e)
def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def persist(path,value): path.write_text(json.dumps(value,indent=2)+'\n')
def snapshot():
    hashes,errors={},{}
    for name in SOURCE_PATHS:
        try: hashes[name]=sha(ROOT/name)
        except Exception as e: hashes[name]=None; errors[name]=type(e).__name__+': '+str(e)
    return hashes,errors
def git_hashes(names,env):
    requests=''.join(BASE_REVISION+':'+name+'\n' for name in names).encode()
    r=subprocess.run(['git','-C',str(ROOT),'cat-file','--batch'],input=requests,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=30)
    if r.returncode: raise RuntimeError('git cat-file failed: '+r.stderr.decode(errors='replace'))
    output,offset,hashes=r.stdout,0,{}
    for name in names:
        end=output.index(b'\n',offset); header=output[offset:end].split()
        if len(header)!=3 or header[1]!=b'blob': raise RuntimeError('expected Git blob: '+name)
        size=int(header[2]); start=end+1; stop=start+size
        if stop>=len(output) or output[stop:stop+1]!=b'\n': raise RuntimeError('incomplete Git blob: '+name)
        hashes[name]=hashlib.sha256(output[start:stop]).hexdigest(); offset=stop+1
    if offset!=len(output): raise RuntimeError('unexpected Git batch suffix')
    return hashes
def authenticate(record,env):
    binding=json.loads(BINDING.read_text()); inherited=binding['baselineSourceHashes']; added=binding['newFiles']
    if len(inherited)!=103 or len(added)!=7 or set(inherited)&set(added) or set(inherited)|set(added)!=set(SOURCE_PATHS): raise RuntimeError('exact103+7 source names required')
    if binding['baseRevision']!=BASE_REVISION: raise RuntimeError('wrong baseline revision')
    if binding['wrapper']['sha256']!=record['wrapperSha256']: raise RuntimeError('wrapper differs from reviewed binding')
    if binding['node']['sha256']!=sha(NODE): raise RuntimeError('Node differs from pinned22.23.3 binary')
    record.update({'sourceExpected':{**inherited,**added},'bindingSha256':sha(BINDING),'node':{'path':str(NODE),'sha256':sha(NODE),'expectedVersion':'22.23.3'}})
    if record['bindingSha256']!=record['bindingSha256Before'] or record['node']['sha256']!=record['nodeSha256Before']: raise RuntimeError('binding/Node changed during prelaunch authentication')
    for name,h in record['sourceExpected'].items():
        if record['sourceBefore'][name]!=h: raise RuntimeError('prelaunch source mismatch: '+name)
    manifest=json.loads((ROOT/'scripts/bochs-cpu3-native-owned-span/baseline-source.json').read_text())
    if manifest['revision']!=BASE_REVISION or manifest['hashes']!=inherited: raise RuntimeError('baseline manifest differs from binding')
    record['baselineGitHashes']=git_hashes(sorted(inherited),env)
    if record['baselineGitHashes']!=inherited: raise RuntimeError('inherited sources differ from Git fe1')
    record['authentication']={'status':'ALL_110_SOURCE_AND_103_GIT_BYTES_AUTHENTICATED_BEFORE_CHILD','sourceCount':110,'gitBaselineCount':103}
def child_setup():
    os.setsid(); os.nice(10)
    resource.setrlimit(resource.RLIMIT_CPU,(120,120)); resource.setrlimit(resource.RLIMIT_FSIZE,(256*1024*1024,256*1024*1024)); resource.setrlimit(resource.RLIMIT_CORE,(0,0))
def main():
    OUT.mkdir(exist_ok=False); env=os.environ.copy()
    for key in BLANK_KEYS: env[key]=''
    before,errors=snapshot(); command=[str(NODE),'--max-old-space-size=512',str(CONTROL)]
    record={'status':'PRELAUNCH_AUTHENTICATION_PENDING_NO_CHILD','startedUtc':stamp(),'cwd':str(ROOT),'output':str(OUT),'command':command,'wrapperSha256':sha(__file__),'binding':str(BINDING),'sourceBefore':before,'sourceBeforeErrors':errors,'blankEnvironment':{k:env[k] for k in BLANK_KEYS},'limits':LIMITS,'portableOverrides':{k:os.environ.get(k) for k in ('BW_SPAN_ROOT','BW_SPAN_OUT','BW_SPAN_NODE','BW_SPAN_BINDING')},'childLaunched':False,'exitCode':None,'timedOut':False,'scope':'SOURCE ONLY: fixed-ROM reconstruction and actual board callbacks; no addon, native compilation, CPU guest, profile or speed result.'}
    record['bindingSha256Before'],record['bindingBeforeError']=safe_sha(BINDING)
    record['nodeSha256Before'],record['nodeBeforeError']=safe_sha(NODE)
    persist(OUT/'invocation.json',record); persist(OUT/'source-before.json',{'hashes':before,'errors':errors})
    started=time.monotonic(); child=None
    try:
        authenticate(record,env); record['status']='AUTHENTICATED_ONE_SOURCE_CONTROL_CHILD_READY'; persist(OUT/'invocation.json',record)
        with (OUT/'stdout.json').open('xb') as stdout,(OUT/'stderr.txt').open('xb') as stderr:
            child=subprocess.Popen(command,cwd=ROOT,env=env,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,preexec_fn=child_setup)
            record['pid']=child.pid; record['childLaunched']=True; persist(OUT/'invocation.json',record)
            try: record['exitCode']=child.wait(timeout=120)
            except subprocess.TimeoutExpired:
                record['timedOut']=True; os.killpg(child.pid,signal.SIGKILL); record['exitCode']=child.wait()
    except Exception as e:
        record['executionError']=type(e).__name__+': '+str(e)
        if child is not None and child.poll() is None: os.killpg(child.pid,signal.SIGKILL); record['exitCode']=child.wait()
    finally:
        after,errors=snapshot(); record.update({'endedUtc':stamp(),'elapsedWallSecondsForResourceBoundOnly':time.monotonic()-started,'sourceAfter':after,'sourceAfterErrors':errors})
        for tag,path in (('wrapper',__file__),('binding',BINDING),('node',NODE)):
            record[tag+'Sha256After'],record[tag+'AfterError']=safe_sha(path)
        persist(OUT/'source-after.json',{'hashes':after,'errors':errors})
        for name in ('stdout.json','stderr.txt'):
            path=OUT/name
            if not path.exists(): path.write_bytes(b'')
            record[name+'Sha256']=sha(path)
        record['retainedDiagnosticTestSeams']={}
        for name in ('baseline-control-seam.mjs','candidate-control-seam.mjs'):
            source=ROOT/'scripts/bochs-cpu3-native-owned-span'/name
            if source.is_file():
                try:
                    target=OUT/'diagnostic-test-seams'/name; target.parent.mkdir(exist_ok=True); shutil.copyfile(source,target); record['retainedDiagnosticTestSeams'][name]=sha(target)
                except Exception as e: record.setdefault('evidenceErrors',{})[name]=type(e).__name__+': '+str(e)
        # Persist all execution/failure/timeout evidence BEFORE checking status or output JSON.
        record['status']='SOURCE_CONTROL_EXECUTION_RECORDED_OUTPUT_NOT_YET_VALIDATED'; persist(OUT/'exit.json',record)
    success=False
    try:
        if record.get('executionError') or not record['childLaunched'] or record['exitCode']!=0 or record['timedOut']: raise RuntimeError('authentication/launch/child failure; inspect retained receipt')
        if record['sourceAfter']!=record['sourceExpected'] or record['sourceAfterErrors']: raise RuntimeError('source changed or became unreadable')
        if record['wrapperSha256After']!=record['wrapperSha256']: raise RuntimeError('wrapper changed')
        if record['bindingSha256After']!=record['bindingSha256Before'] or record['bindingAfterError']: raise RuntimeError('binding changed or became unreadable')
        if record['nodeSha256After']!=record['nodeSha256Before'] or record['nodeAfterError']: raise RuntimeError('Node changed or became unreadable')
        if record.get('evidenceErrors'): raise RuntimeError('diagnostic test seam retention failed')
        result=json.loads((OUT/'stdout.json').read_text())
        if result['status']!='SOURCE_ONLY_PRIVATE_UNIFORM_SPAN_DIFFERENTIAL_CONTROLS_PASS': raise RuntimeError('wrong control result status')
        if result['sourceInputs']!=record['sourceExpected'] or result['sourceAfter']!=record['sourceExpected']: raise RuntimeError('child source maps differ from parent')
        if result['providerSha256']!=record['sourceExpected']['scripts/bochs-cpu3-native-owned-span/provider.mjs'] or result['originalRevision']!=BASE_REVISION or result['originalSourceCount']!=103: raise RuntimeError('child source identity mismatch')
        record.update({'checks':result['checks'],'caseCount':len(result['cases']),'providerSha256':result['providerSha256']}); record['status']='SOURCE_ONLY_AUTHENTICATED_CONTROL_CHILD_AND_RESULT_PASS'; success=True
    except Exception as e: record['status']='SOURCE_ONLY_CONTROL_AUTHENTICATION_EXECUTION_OR_RESULT_FAILED'; record['resultValidationError']=type(e).__name__+': '+str(e)
    persist(OUT/'exit.json',record)
    print(json.dumps({k:record[k] for k in ('status','childLaunched','exitCode','timedOut','checks','caseCount') if k in record}))
    return 0 if success else 1
if __name__=='__main__': raise SystemExit(main())

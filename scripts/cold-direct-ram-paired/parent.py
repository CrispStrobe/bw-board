"""Run closed fresh-child semantic preflight and alternating paired measurements."""
import hashlib,json,os,platform,shutil,subprocess,sys
from pathlib import Path
from policy import CONTRACT,ARMS,schedule,summarize,checked_timing,require
from bounded import run_bounded

HERE=Path(__file__).resolve().parent
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,value):Path(path).write_text(json.dumps(value,sort_keys=True,indent=2)+'\n')
def path(value):
    p=Path(value);require(p.is_absolute() and p.resolve()==p and p.exists(),'absolute existing role path')
    return p
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],text=True,timeout=20).strip()

def authenticate_setup(setup):
    require(set(setup)=={'schema','harnessRoot','harnessHead','qualifiedRoot','directAddon',
       'directAddonSha256','directBuildAuth','directBuildAuthSha256',
       'companionAddon','ownerAddon','ownerAddonSha256','ownerBuildReceipt','ownerBuildReceiptSha256',
       'configuration','reference','referenceSha256','output','node'},'exact setup roles')
    require(setup['schema']=='bw.cold-direct-ram.paired-setup.v1','setup schema')
    for key in ('harnessRoot','qualifiedRoot','directAddon','directBuildAuth','companionAddon',
                'ownerAddon','ownerBuildReceipt','reference','output','node'):
        setup[key]=str(path(setup[key])) if key!='output' else str(Path(setup[key]).resolve())
    for arm in ('direct','companion'):
        setup['configuration'][arm]=str(path(setup['configuration'][arm]))
    require(set(setup['configuration'])=={'direct','companion'},'exact config arms')
    require(git(setup['harnessRoot'],'rev-parse','HEAD')==setup['harnessHead'],'exact harness head')
    require(not git(setup['harnessRoot'],'status','--porcelain'),'clean harness')
    require(git(setup['qualifiedRoot'],'rev-parse','HEAD')==CONTRACT['qualifiedSourceHead'],'qualified source head')
    require(not git(setup['qualifiedRoot'],'status','--porcelain'),'clean qualified source')
    assert Path(setup['harnessRoot']).resolve()!=Path(setup['qualifiedRoot']).resolve()
    require(subprocess.check_output([setup['node'],'--version'],text=True,timeout=10).strip()=='v22.23.3','pinned Node')
    role=CONTRACT['actualQualification']
    for key,want in (('directAddon',setup['directAddonSha256']),('ownerAddon',setup['ownerAddonSha256']),
                     ('companionAddon',CONTRACT['compactAddon']['addonSha256'])):
        require(sha(setup[key])==want,'exact '+key)
    require(sha(setup['directBuildAuth'])==setup['directBuildAuthSha256'],'direct static build receipt')
    build=json.loads(Path(setup['directBuildAuth']).read_text())
    require(build['schema']=='bw.cold-native.direct-ram-static-build.v1' and
            build['sourceHead']==CONTRACT['qualifiedSourceHead'] and
            build['addonSha256']==setup['directAddonSha256'] and
            build['addonLoaded'] is False,'fresh qualified direct static build')
    require(sha(setup['ownerBuildReceipt'])==setup['ownerBuildReceiptSha256'],'owner build receipt')
    owner=json.loads(Path(setup['ownerBuildReceipt']).read_text())
    source=Path(setup['qualifiedRoot'])/'scripts/bochs-cpu3-native-cold-owned-ram/napi.cc'
    require(owner['schema']=='bw.cold-direct-ram.paired-owner-build.v1' and
            owner['sourceHead']==CONTRACT['qualifiedSourceHead'] and
            owner['sourceSha256']==sha(source) and
            owner['sourceSha256']==hashlib.sha256(subprocess.check_output(['git','-C',setup['qualifiedRoot'],
             'show',CONTRACT['qualifiedSourceHead']+':scripts/bochs-cpu3-native-cold-owned-ram/napi.cc'],timeout=20)).hexdigest() and
            owner['addonSha256']==setup['ownerAddonSha256'] and
            owner['flags']==['-std=c++17','-O1','-fPIC','-shared','-Wall','-Wextra','-Werror','-I/usr/include/node'] and
            sha(owner['compilerPath'])==owner['compilerSha256'] and
            subprocess.check_output([owner['compilerPath'],'--version'],text=True,timeout=10).splitlines()[0]==owner['compilerVersion'],
            'fresh qualified owner source/build/toolchain')
    require(sha(setup['reference'])==setup['referenceSha256']==
            CONTRACT['compactReferenceSha256'],'exact compact reference')
    ref=json.loads(Path(setup['reference']).read_text())
    require(ref['schema']=='bw.cold-direct-ram.paired-reference.v1' and
            ref['sourceHead']==CONTRACT['qualifiedSourceHead'] and
            ref['officialZipSha256']==role['zipSha256'] and
            ref['target']==role['targetQuanta'] and ref['journalEntries']==91958,'qualified reference')
    return ref

def metadata():
    out={'platform':platform.platform(),'python':sys.version,'uname':list(os.uname()),
         'cpuCount':os.cpu_count(),'environmentKeys':sorted(os.environ)}
    for name in ('/proc/cpuinfo','/sys/fs/cgroup/cpu.max','/sys/fs/cgroup/memory.max'):
        p=Path(name)
        if p.exists():out[name]=p.read_text()[:24000]
    return out

def child(setup,comparison,pair,arm,base,reference):
    stem=f'{comparison}-pair-{pair:02d}-{arm}'
    child_dir=base/stem;child_dir.mkdir()
    receipt_dir=child_dir/'receipt';inp=child_dir/'input.json'
    common={'qualifiedHead':CONTRACT['qualifiedSourceHead'],'sourceRoot':setup['qualifiedRoot'],
            'reference':setup['reference'],'referenceSha256':setup['referenceSha256'],
            'output':str(receipt_dir)}
    if arm=='plain-js':
        args={**common,'schema':'bw.cold-direct-ram.paired-plain-input.v1'}
        script=HERE/'plain-child.mjs'
    else:
        args={**common,'schema':'bw.cold-direct-ram.paired-native-input.v1','mode':arm,
          'addon':setup['directAddon'] if arm=='direct' else setup['companionAddon'],
          'addonSha256':setup['directAddonSha256'] if arm=='direct' else CONTRACT['compactAddon']['addonSha256'],
          'ownerAddon':setup['ownerAddon'] if arm=='companion' else None,
          'ownerAddonSha256':setup['ownerAddonSha256'] if arm=='companion' else None,
          'directBuildAuth':setup['directBuildAuth'] if arm=='direct' else None,
          'directBuildAuthSha256':setup['directBuildAuthSha256'] if arm=='direct' else None,
          'ownerBuildReceipt':setup['ownerBuildReceipt'] if arm=='companion' else None,
          'ownerBuildReceiptSha256':setup['ownerBuildReceiptSha256'] if arm=='companion' else None,
          'configuration':setup['configuration'][arm],
          'configurationSha256':sha(setup['configuration'][arm])}
        script=HERE/'native.mjs'
    write(inp,args)
    cmd=[setup['node'],'--max-old-space-size=768',str(script),str(inp)]
    invoke={'argv':cmd,'cwd':setup['harnessRoot'],'timeoutSeconds':300,'cpuLimitSeconds':240,
            'memoryVirtualBytes':64*1024**3,'maxObservedRssBytes':1536*1024**2,
            'stdout':'stdout.txt','stderr':'stderr.txt'}
    write(child_dir/'invocation.json',invoke)
    whole=run_bounded(cmd,setup['harnessRoot'],child_dir/'stdout.txt',child_dir/'stderr.txt')
    if arm!='plain-js':
        lines=Path(setup['configuration'][arm]).read_text().splitlines()
        logs=[line[5:] for line in lines if line.startswith('log: ')]
        require(len(logs)==1,'single Bochs log role')
        log=Path(logs[0])
        if log.is_file():
            require(log.stat().st_size<=64*1024**2,'bounded Bochs log')
            shutil.copyfile(log,child_dir/'bochs.log')
    write(child_dir/'exit.json',whole)
    require(not whole['timedOut'] and not whole['rssExceeded'] and
            whole['processGroupEmptyAfterExit'] and whole['exitCode']==0 and
            (receipt_dir/'receipt.json').is_file(),stem+' completed receipt')
    receipt=json.loads((receipt_dir/'receipt.json').read_text())
    require(receipt.get('status')=='SEMANTIC_PASS',stem+' semantic')
    require(receipt.get('qualifiedHead')==CONTRACT['qualifiedSourceHead'] and
            receipt.get('referenceSha256')==setup['referenceSha256'],stem+' exact roles')
    require(receipt.get('mode')==arm,stem+' mode')
    checked_timing(receipt)
    if arm=='plain-js':
        require(receipt.get('terminationScope')=='process-only; no model close API' and
                'closed' not in receipt and whole['processGroupEmptyAfterExit'],
                stem+' process-scope closure without invented model close')
        require(receipt['reset']['board']==reference['reset']['board']['board'],stem+' reset board')
        require(receipt['final']['board']==reference['board']['board'] and
                receipt['final']['ramSha256']==reference['ramSha256'],stem+' full board/RAM')
        require(len(receipt['ports'])==len(reference['ports']),stem+' complete PIO count')
        require(receipt['final']['cpu']==receipt['beforeSettle']['cpu'],stem+' settle CPU')
    else:
        require(receipt.get('closed') is True,stem+' native/provider close')
        require(receipt['addonSha256']==args['addonSha256'] and
                receipt['configurationSha256']==args['configurationSha256'] and
                receipt['ownerAddonSha256']==args['ownerAddonSha256'] and
                receipt['directBuildAuthSha256']==args['directBuildAuthSha256'] and
                receipt['ownerBuildReceiptSha256']==args['ownerBuildReceiptSha256'],
                stem+' addon/build/config binding')
        require(receipt['reset']['board']==reference['reset']['board'],stem+' reset board')
        for cut in ('reset','last','final'):
            actual=receipt['reset']['native'] if cut=='reset' else receipt[cut]
            wanted=reference['reset']['native'] if cut=='reset' else reference[cut]
            for key in ('state','extra','segments','system','debug','nativeTicks','successfulQuanta',
                        'mappingEpoch','boardA20','clockTransfers','callbacks','fallback','execution'):
                require(actual[key]==wanted[key],stem+' native '+cut+' '+key)
        require(receipt['lastReturn']==reference['lastReturn'] and
                receipt['board']==reference['board'] and
                receipt['ramSha256']==reference['ramSha256'] and
                receipt['ports']==reference['ports'],stem+' compact/board/RAM/PIO')
    start=receipt['startupTiming'];require(set(start)=={'cpuMicroseconds','elapsedMilliseconds','scope'},'startup fields')
    require(set(start['cpuMicroseconds'])=={'user','system'} and
            all(type(v)==int and v>=0 for v in start['cpuMicroseconds'].values()) and
            type(start['elapsedMilliseconds'])==int and start['elapsedMilliseconds']>=0,'startup units')
    if arm=='direct':
        require(all(receipt['providerDerivation'][key]==value for key,value in
                    CONTRACT['timingProvider'].items()),'exact timing provider derivation')
        require(receipt['ownerProvider']['journalEntries']==91958,'direct scalar journal extent')
        require(receipt['ownerAfterClose']['ownerClosed'] is True and
                receipt['ownerAfterClose']['cpuClosed'] is True,'direct CPU/owner close')
        require(receipt['ownerBeforeClose']['committed']=='91958' and
                receipt['ownerBeforeClose']['acknowledged']=='91958' and
                receipt['ownerBeforeClose']['directReads']=='91949' and
                receipt['ownerBeforeClose']['directWrites']=='91958' and
                receipt['final']['bridgeMemoryEntryAttempts']==
                {'ordinaryRead':'0','ordinaryWrite':'0','fusedOuter':'0'},'direct source-backed counters')
    result={'semantic':'PASS','closed':True,'wholeChild':whole,'receipt':receipt,
            'receiptSha256':sha(receipt_dir/'receipt.json')}
    write(child_dir/'terminal-validation.json',{'semantic':'PASS','closed':True,
         'receiptSha256':result['receiptSha256'],'executionTiming':receipt['executionTiming'],
         'startupTiming':start,'wholeChild':whole})
    return result

def run(setup_file):
    setup=json.loads(Path(setup_file).read_text());reference=authenticate_setup(setup)
    output=Path(setup['output']);output.mkdir(mode=0o700)
    write(output/'binding.json',{'schema':'bw.cold-direct-ram.paired-binding.v1',
        'harnessHead':setup['harnessHead'],'qualifiedSourceHead':CONTRACT['qualifiedSourceHead'],
        'referenceSha256':setup['referenceSha256'],'officialZipSha256':reference['officialZipSha256'],
        'addonSha256':{k:sha(setup[k]) for k in ('directAddon','companionAddon','ownerAddon')},
        'directBuildAuthSha256':setup['directBuildAuthSha256'],
        'ownerBuildReceiptSha256':setup['ownerBuildReceiptSha256'],
        'configSha256':{k:sha(v) for k,v in setup['configuration'].items()},'node':setup['node']})
    write(output/'host-before.json',metadata())
    summaries={}
    try:
        for comparison in ARMS:
            pairs=[]
            for item in schedule(comparison):
                result={**item,'arms':{}}
                for arm in item['order']:
                    result['arms'][arm]=child(setup,comparison,item['pair'],arm,output,reference)
                pairs.append(result)
                write(output/(comparison+'-completed-pairs.json'),pairs)
            summaries[comparison]=summarize(comparison,pairs)
            write(output/(comparison+'-summary.json'),summaries[comparison])
    finally:write(output/'host-after.json',metadata())
    write(output/'result.json',{'schema':'bw.cold-direct-ram.paired-result.v1',
         'status':'SEMANTIC_PASS_TIMING_RECORDED','comparisons':summaries,
         'adoptionGatePass':summaries['direct-v-plain-js']['quantitativeGatePass']})
    return summaries

if __name__=='__main__':
    require(len(sys.argv)==2,'exact setup JSON')
    print(json.dumps(run(sys.argv[1]),sort_keys=True))

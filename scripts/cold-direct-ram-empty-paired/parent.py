"""Same-host fresh-child paired gate. All source and semantics precede timing policy."""
import hashlib,json,os,platform,subprocess,sys
from pathlib import Path
from policy import COMPARISONS,require,schedule,summarize,metric

HERE=Path(__file__).resolve().parent
sys.path.append(str(HERE.parent/'cold-direct-ram-paired'))
from bounded import run_bounded

QUALIFIED='acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1'
REFERENCE_SHA='74f365d0ab5a00ab229f29291f46ed15451b7a37a442301eabd88a22fb4153ff'
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def save(path,value):Path(path).write_text(json.dumps(value,sort_keys=True,indent=2)+'\n')
def read(path,limit=8*1024*1024):
    p=Path(path);require(p.is_file() and not p.is_symlink() and p.stat().st_size<=limit,'bounded ordinary JSON')
    return json.loads(p.read_text())
def git(root,*args):return subprocess.check_output(['git','-C',str(root),*args],text=True,timeout=20).strip()
def exact(path):
    p=Path(path);require(p.is_absolute() and p.resolve()==p,'canonical absolute role');return p
def metadata():
    result={'platform':platform.platform(),'python':sys.version,'uname':list(os.uname()),
            'cpuCount':os.cpu_count(),'environmentKeys':sorted(os.environ)}
    for name in ('/proc/cpuinfo','/sys/fs/cgroup/cpu.max','/sys/fs/cgroup/memory.max'):
        p=Path(name)
        if p.is_file():result[name]=p.read_text()[:24000]
    return result
def authenticate(setup):
    require(set(setup)=={'schema','harnessRoot','harnessHead','qualifiedRoot','sourceAdmission',
      'priorQualification','priorQualificationSha256',
      'addon','addonSha256','buildAuth','buildAuthSha256','configuration','configurationSha256',
      'reference','referenceSha256','output','node'},'exact setup roles')
    require(setup['schema']=='bw.cold-direct-ram.empty-paired-setup.v1','setup schema')
    for role in ('harnessRoot','qualifiedRoot','sourceAdmission','priorQualification','addon','buildAuth',
                 'configuration','reference','output','node'):setup[role]=str(exact(setup[role]))
    h=setup['harnessRoot'];q=setup['qualifiedRoot']
    require(h!=q and git(h,'rev-parse','HEAD')==setup['harnessHead'] and
            git(q,'rev-parse','HEAD')==QUALIFIED,'exact heads')
    require(not git(h,'status','--porcelain') and not git(q,'status','--porcelain'),'clean source')
    require(subprocess.check_output([setup['node'],'--version'],text=True,timeout=10).strip()=='v22.23.3','Node 22.23.3')
    source=read(setup['sourceAdmission']);require(source['schema']=='bw.cold-direct-ram.empty-paired-source.v1' and
      source['harnessHead']==setup['harnessHead'] and source['qualifiedHead']==QUALIFIED,'source manifest roles')
    subprocess.run([setup['node'],str(HERE/'source-admission.mjs'),h,setup['harnessHead'],q,
                    setup['sourceAdmission'],'--verify'],check=True,timeout=120,capture_output=True)
    require(sha(setup['addon'])==setup['addonSha256'],'fresh exact addon')
    require(sha(setup['buildAuth'])==setup['buildAuthSha256'],'exact static build receipt')
    auth=read(setup['buildAuth']);require(auth['schema']=='bw.cold-native.direct-ram-static-build.v1' and
      auth['sourceHead']==QUALIFIED and auth['addonSha256']==setup['addonSha256'] and
      auth['addonLoaded'] is False,'qualified static build binding')
    require(sha(setup['configuration'])==setup['configurationSha256'],'exact cold config bytes')
    require(sha(setup['reference'])==setup['referenceSha256']==REFERENCE_SHA,'exact original replay reference')
    ref=read(setup['reference']);require(ref['schema']=='bw.cold-direct-ram.paired-reference.v1' and
      ref['sourceHead']==QUALIFIED and ref['target']==316562 and ref['journalEntries']==91958 and
      ref['officialZipSha256']=='3881456e5dd46f256640cd28af30117f0be1a92f1b2fe9df1712067c3ea31905',
      'replayed official reference')
    require(sha(setup['priorQualification'])==setup['priorQualificationSha256'],'prior qualification receipt bytes')
    prior=read(setup['priorQualification']);require(prior['schema']=='bw.cold-direct-ram.empty-paired-prior-qualification.v1' and
      prior['status']=='AUTHENTICATED' and prior['emptyZipSha256']=='260ed36433b3c5e02461cae3b1d6fcd05fd49e9b191bdf8093014a3a9b304b0f' and
      prior['originalZipSha256']==ref['officialZipSha256'] and prior['target']==ref['target'] and
      prior['journalEntries']==ref['journalEntries'],'prior empty guest qualification')
    return source,ref
def native_semantics(receipt,reference,variant,source):
    require(receipt['mode']=='direct' and receipt['closed'] is True,'direct closed')
    require(receipt['providerDerivation']==source['providers'][variant],'exact inverse-verified provider')
    require(receipt['resumes']==reference['resumes']==16524 and
      receipt['zero']==reference['zero']==0 and receipt['progressQ']==reference['target']==316562,
      'complete cold workload and progress')
    for cut in ('reset','last','final'):
        actual=receipt['reset']['native'] if cut=='reset' else receipt[cut]
        wanted=reference['reset']['native'] if cut=='reset' else reference[cut]
        require([len(actual[key]) for key in ('state','extra','segments','system','debug')]==
          [20,20,90,30,6],'full 166 native state words')
        for key in ('state','extra','segments','system','debug','nativeTicks','successfulQuanta',
          'mappingEpoch','boardA20','clockTransfers','callbacks','fallback','execution'):
            require(actual[key]==wanted[key],cut+' complete native '+key)
    require(receipt['reset']['board']==reference['reset']['board'] and
      receipt['lastReturn']==reference['lastReturn'] and receipt['board']==reference['board'] and
      receipt['ramSha256']==reference['ramSha256'] and receipt['ports']==reference['ports'],
      'full native board/RAM/ordered PIO/compact return')
    before=receipt['ownerBeforeClose'];after=receipt['ownerAfterClose']
    require(before['ownerFailed'] is False and before['journalPending']=='0' and
      before['prepared'] is False and before['pageTicket'] is False and
      before['uncommittedRetry'] is False and before['committedCodeFence'] is False,
      'no outstanding owner effect')
    require(before['committed']==before['acknowledged']=='91958' and
      before['directReads']=='91949' and before['directWrites']=='91958' and
      receipt['ownerProvider']['journalEntries']==91958 and
      receipt['final']['bridgeMemoryEntryAttempts']==
      {'ordinaryRead':'0','ordinaryWrite':'0','fusedOuter':'0'},'source-backed owner counters')
    require(after['ownerClosed'] is True and after['cpuClosed'] is True,'CPU/owner closed')
def plain_semantics(receipt,reference):
    require(receipt['mode']=='plain-js' and receipt['terminationScope']=='process-only; no model close API' and
            'closed' not in receipt,'plain process-only closure')
    require(receipt['target']==reference['target']==316562,'plain full workload')
    require(receipt['reset']['board']==reference['reset']['board']['board'] and
      receipt['final']['board']==reference['board']['board'] and
      receipt['final']['ramSha256']==reference['ramSha256'] and
      receipt['final']['cpu']==receipt['beforeSettle']['cpu'],'plain full board/RAM')
    require(len(receipt['ports'])==len(reference['ports'])==16475,'complete plain PIO extent')
    for got,want in zip(receipt['ports'],reference['ports']):
        require([want['ordinal'],want['dir'],want['port'],want.get('width',8),want['value'],
                 want['successfulQuanta'],want['cycles']]==
                [got['ordinal'],got['dir'],got['port'],got['width'],got['value'],
                 got['q']-1,got['cycles']],'ordered plain PIO projection')
def child(setup,source,reference,comparison,pair,arm,base):
    folder=base/f'{comparison}-pair-{pair:02d}-{arm}';folder.mkdir()
    receipt_path=folder/'receipt';input_path=folder/'input.json'
    common={'qualifiedHead':QUALIFIED,'sourceRoot':setup['qualifiedRoot'],
      'reference':setup['reference'],'referenceSha256':setup['referenceSha256'],'output':str(receipt_path)}
    if arm=='plain-js':
        args={**common,'schema':'bw.cold-direct-ram.paired-plain-input.v1'}
        script=Path(setup['harnessRoot'])/'scripts/cold-direct-ram-paired/plain-child.mjs'
    else:
        args={**common,'schema':'bw.cold-direct-ram.paired-native-input.v1','mode':'direct',
          'providerVariant':arm,'addon':setup['addon'],'addonSha256':setup['addonSha256'],
          'directBuildAuth':setup['buildAuth'],'directBuildAuthSha256':setup['buildAuthSha256'],
          'configuration':setup['configuration'],'configurationSha256':setup['configurationSha256'],
          'ownerAddon':None,'ownerAddonSha256':None,'ownerBuildReceipt':None,'ownerBuildReceiptSha256':None}
        script=HERE/'native-child.mjs'
    save(input_path,args)
    cmd=[setup['node'],'--max-old-space-size=768',str(script),str(input_path)]
    save(folder/'invocation.json',{'argv':cmd,'cwd':setup['harnessRoot'],'timeoutSeconds':300,
      'cpuLimitSeconds':240,'maxObservedRssBytes':1536*1024**2,'stdout':'stdout.txt','stderr':'stderr.txt'})
    def output_cap(_):
        for name in ('stdout.txt','stderr.txt'):
            p=folder/name
            if p.exists():require(p.stat().st_size<=8*1024*1024,'bounded child output')
    whole=run_bounded(cmd,setup['harnessRoot'],folder/'stdout.txt',folder/'stderr.txt',on_poll=output_cap)
    save(folder/'exit.json',whole)
    require(not whole['timedOut'] and not whole['rssExceeded'] and whole['processGroupEmptyAfterExit'] and
      whole['exitCode']==0 and (receipt_path/'receipt.json').is_file(),'child complete')
    receipt=read(receipt_path/'receipt.json')
    require(receipt['status']=='SEMANTIC_PASS' and receipt['qualifiedHead']==QUALIFIED and
      receipt['referenceSha256']==setup['referenceSha256'],'child source/reference and semantic claim')
    if arm=='plain-js':plain_semantics(receipt,reference)
    else:
        require(receipt['addonSha256']==setup['addonSha256'] and
          receipt['directBuildAuthSha256']==setup['buildAuthSha256'] and
          receipt['configurationSha256']==setup['configurationSha256'],'child addon/config/build binding')
        native_semantics(receipt,reference,arm,source)
    result={'semantic':'PASS','closed':True,'receipt':receipt,'wholeChild':whole,
            'receiptSha256':sha(receipt_path/'receipt.json')}
    metric(result)
    save(folder/'terminal-validation.json',{'semantic':'PASS','closureScope':'process-only' if arm=='plain-js' else 'CPU/owner/provider',
      'receiptSha256':result['receiptSha256'],'executionTiming':receipt['executionTiming'],
      'startupTiming':receipt['startupTiming'],'wholeChild':whole})
    return result
def run(setup_path):
    setup=read(setup_path);source,reference=authenticate(setup)
    output=Path(setup['output']);output.mkdir(mode=0o700)
    save(output/'binding.json',{'schema':'bw.cold-direct-ram.empty-paired-binding.v1',
      'harnessHead':setup['harnessHead'],'qualifiedHead':QUALIFIED,
      'sourceAdmissionSha256':sha(setup['sourceAdmission']),
      'priorQualificationSha256':setup['priorQualificationSha256'],
      'addonSha256':setup['addonSha256'],'buildAuthSha256':setup['buildAuthSha256'],
      'configurationSha256':setup['configurationSha256'],'referenceSha256':setup['referenceSha256']})
    save(output/'host-before.json',metadata());summaries={}
    try:
        for comparison in COMPARISONS:
            pairs=[]
            for row in schedule(comparison):
                got={**row,'arms':{}}
                for arm in row['order']:
                    got['arms'][arm]=child(setup,source,reference,comparison,row['pair'],arm,output)
                pairs.append(got)
                save(output/(comparison+'-completed-pairs.json'),[{
                  **{k:p[k] for k in ('pair','phase','measuredPair','order')},
                  'arms':{arm:{'semantic':v['semantic'],'closed':v['closed'],
                    'receiptSha256':v['receiptSha256'],'wholeChild':v['wholeChild'],
                    'executionTiming':v['receipt']['executionTiming']}
                    for arm,v in p['arms'].items()}} for p in pairs])
            summaries[comparison]=summarize(comparison,pairs)
            save(output/(comparison+'-summary.json'),summaries[comparison])
    finally:
        primary=sys.exc_info()[1]
        try:save(output/'host-after.json',metadata())
        except Exception as secondary:
            if primary is None:raise
            try:save(output/'host-after-error.json',{'error':str(secondary),'primaryError':str(primary)})
            except Exception:pass
    adoption=summaries['candidate-v-plain-js']['quantitativeGatePass']
    save(output/'result.json',{'schema':'bw.cold-direct-ram.empty-paired-result.v1',
      'status':'SEMANTIC_PASS_ADOPTION_PASS' if adoption else 'SEMANTIC_PASS_ADOPTION_FAIL',
      'comparisons':summaries,'adoptionGatePass':adoption})
    return summaries
if __name__=='__main__':
    require(len(sys.argv)==2,'exact setup JSON')
    print(json.dumps(run(sys.argv[1]),sort_keys=True))

"""Semantic-gated, bounded inspector diagnostic; never computes an adoption result."""
import hashlib,json,os,subprocess,sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
PAIRED=HERE.parent/'cold-direct-ram-paired'
sys.path.insert(0,str(PAIRED))
import parent  # noqa: E402 - exact paired child authentication and semantic gates
from profile import summarize  # noqa: E402 - this directory's bounded profile validator

EXPECTED_NORMALIZED={
 'native.mjs':'f6cc99f87dab5c45b664f25e9ae8b744b1a4c8b5364956a0396be71a35abf54a',
 'plain.mjs':'fa8d5124f659ffbdd4458afff554654a5b73294ac4bcb323c873d32feb91fc25',
 'plain-child.mjs':'17d363ee941cd549e7e23eefd562301b455a00bc2d67e079388891b0ea2cd246'
}
EXPECTED_ADAPTER='52faa28cde054a625ad13f99d926e0fd971668d2bfac37bf5b1b16d3445eb3f2'
ROUNDS=(('direct','companion','plain-js'),
        ('plain-js','direct','companion'),
        ('companion','plain-js','direct'))

def require(good,why):
    if not good:raise ValueError(why)
def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,data):Path(path).write_text(json.dumps(data,sort_keys=True,indent=2)+'\n')

def run(setup_file):
    setup=json.loads(Path(setup_file).read_text());reference=parent.authenticate_setup(setup)
    output=Path(setup['output']);output.mkdir(mode=0o700)
    derived=output/'derived';materializer=HERE/'materialize.mjs'
    raw=subprocess.check_output([setup['node'],str(materializer),setup['harnessRoot'],str(derived)],
                                text=True,timeout=30)
    derivation=json.loads(raw)
    require(derivation['schema']=='bw.cold-direct-ram.sampling-derivation.v1' and
            derivation['normalized']==EXPECTED_NORMALIZED and
            derivation['adapterSha256']==EXPECTED_ADAPTER and
            set(derivation['loaded'])==set(EXPECTED_NORMALIZED),'authenticated exact worker derivative')
    for name,digest in derivation['loaded'].items():
        require(sha(derived/name)==digest,'exact loaded derivative bytes')
    write(output/'derivation.json',derivation)
    provider_module=Path(setup['harnessRoot'])/'scripts/cold-direct-ram-paired/direct-provider.mjs'
    probe="""import {pathToFileURL} from 'node:url';
const {deriveDirectTimingProvider}=await import(pathToFileURL(process.argv[1]).href);
const p=deriveDirectTimingProvider(process.argv[2]);
process.stdout.write(JSON.stringify({loaded:p.loadedModuleSha256,normalized:p.derivedSha256})+'\\n');"""
    expected_provider=json.loads(subprocess.check_output(
        [setup['node'],'--input-type=module','-e',probe,str(provider_module),setup['qualifiedRoot']],
        text=True,timeout=30))
    require(expected_provider['normalized']==parent.CONTRACT['timingProvider']['derivedSha256'] and
            len(expected_provider['loaded'])==64,'independent exact provider loaded bytes')
    write(output/'binding.json',{'schema':'bw.cold-direct-ram.sampling-binding.v1',
         'harnessHead':setup['harnessHead'],'qualifiedHead':parent.CONTRACT['qualifiedSourceHead'],
         'referenceSha256':setup['referenceSha256'],'officialZipSha256':reference['officialZipSha256'],
         'addonSha256':{key:sha(setup[key]) for key in ('directAddon','ownerAddon','companionAddon')},
         'configurationSha256':{key:sha(value) for key,value in setup['configuration'].items()},
         'nodeSha256':sha(setup['node']),'providerLoadedSha256':expected_provider['loaded']})
    write(output/'host-before.json',parent.metadata())
    results=[]
    try:
        for round_number,arms in enumerate(ROUNDS):
            for arm in arms:
                sampled=round_number>0
                parent.HERE=derived if sampled else PAIRED
                stem=f'sampling-pair-{round_number:02d}-{arm}'
                profile_path=output/stem/'receipt'/'profile.cpuprofile'
                if sampled:os.environ['BW_CPU_PROFILE_PATH']=str(profile_path)
                else:os.environ.pop('BW_CPU_PROFILE_PATH',None)
                try:
                    # This inherited child verifies the full reset/final CPU,
                    # board/RAM/PIO, source/build/config, counters and close receipt.
                    result=parent.child(setup,'sampling',round_number,arm,output,reference)
                finally:os.environ.pop('BW_CPU_PROFILE_PATH',None)
                item={'round':round_number,'arm':arm,'sampled':sampled,
                      'semantic':'PASS','receiptSha256':result['receiptSha256'],
                      'wholeChild':result['wholeChild'],
                      'executionTiming':result['receipt']['executionTiming']}
                if sampled:
                    receipt=result['receipt'];provider=receipt.get('providerDerivation') or {}
                    provider_file=profile_path.with_name('profiled-direct-provider.mjs') if arm=='direct' else None
                    if arm=='direct':
                        require(provider.get('loadedModuleSha256')==expected_provider['loaded'],
                                'independently recomputed direct provider loaded bytes')
                        require(provider_file.is_file() and not provider_file.is_symlink() and
                                provider_file.resolve()==provider_file and
                                0<provider_file.stat().st_size<=1024*1024 and
                                sha(provider_file)==expected_provider['loaded'],
                                'exact ordinary provider profile file bytes')
                        item['providerFileSha256']=sha(provider_file)
                    context={'providerLoadedSha256':expected_provider['loaded'] if arm=='direct' else None,
                             'providerFile':str(provider_file) if provider_file else None,
                             'qualifiedRoot':setup['qualifiedRoot'],
                             'harnessRoot':setup['harnessRoot'],'derivedRoot':str(derived)}
                    item['profileSha256']=sha(profile_path)
                    item['profile']=summarize(profile_path,context)
                results.append(item)
                write(output/'completed.json',results)
    finally:
        primary=sys.exc_info()[1]
        parent.HERE=PAIRED
        os.environ.pop('BW_CPU_PROFILE_PATH',None)
        try:write(output/'host-after.json',parent.metadata())
        except Exception as error:
            if primary is None:raise
            try:write(output/'host-after-error.json',{
                'type':type(error).__name__,'message':str(error)[:512]})
            except Exception:pass
    require(len(results)==9 and sum(item['sampled'] for item in results)==6,
            'one warm-up and two sampled children per arm')
    report={'schema':'bw.cold-direct-ram.sampling-result.v1',
            'status':'SEMANTIC_PASS_DIAGNOSTIC_SAMPLES_ONLY',
            'adoptionGate':'NOT_RUN','qualifiedHead':parent.CONTRACT['qualifiedSourceHead'],
            'harnessHead':setup['harnessHead'],'children':results}
    write(output/'result.json',report)
    return report

if __name__=='__main__':
    require(len(sys.argv)==2,'exact setup JSON')
    print(json.dumps(run(sys.argv[1]),sort_keys=True))

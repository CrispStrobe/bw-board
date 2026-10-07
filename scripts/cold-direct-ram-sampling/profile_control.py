"""Small adversaries for profile graph, timing and source-role admission."""
import base64,copy,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
from profile import load,summarize

def denied(fn):
    try:fn()
    except (ValueError,TypeError,KeyError,OverflowError):return
    raise AssertionError('malformed CPU profile accepted')

with tempfile.TemporaryDirectory(prefix='cold-sampling-control-') as folder:
    root=Path(folder);profile_path=root/'control.cpuprofile';qualified=root/'qualified';qualified.mkdir()
    (root/'harness').mkdir();(root/'derived').mkdir()
    (qualified/'board.mjs').write_text('export const nativeTick=()=>{};\n')
    provider=b'export const reconcile=()=>{};'
    url='data:text/javascript;base64,'+base64.b64encode(provider).decode()
    def frame(name,url):return {'functionName':name,'url':url,'scriptId':'1',
                                'lineNumber':1,'columnNumber':0}
    profile={'nodes':[
        {'id':1,'callFrame':frame('(root)',''),'children':[2,3,5]},
        {'id':2,'callFrame':frame('reconcile',url),'children':[4]},
        {'id':3,'callFrame':frame('(garbage collector)','')},
        {'id':4,'callFrame':frame('native addon','')},
        {'id':5,'callFrame':frame('nativeTick',(qualified/'board.mjs').as_uri())}],
        'startTime':100,'endTime':5100,'samples':[2,3,4,5],
        'timeDeltas':[1000,1000,1000,1000]}
    context={'qualifiedRoot':str(qualified),'harnessRoot':str(root/'harness'),
             'derivedRoot':str(root/'derived'),
             'providerLoadedSha256':hashlib.sha256(provider).hexdigest()}
    def write(value):profile_path.write_text(json.dumps(value)+'\n')
    write(profile);out=summarize(profile_path,context)
    assert out['sampleCount']==4 and out['buckets']['js_reconcile']['samples']==1
    assert out['timeDeltaStatus']=='MONOTONIC' and out['sampledDeltaMicroseconds']==4000
    assert out['buckets']['v8_gc']['samples']==1
    assert out['buckets']['native_or_unresolved']['samples']==1
    assert out['buckets']['js_board_device']['samples']==1
    wrong=copy.deepcopy(context);wrong['providerLoadedSha256']='0'*64
    assert summarize(profile_path,wrong)['buckets']['js_reconcile']['samples']==0
    provider_folder=root/'receipt';provider_folder.mkdir()
    provider_file=provider_folder/'profiled-direct-provider.mjs';provider_file.write_bytes(provider)
    file_context={**context,'providerFile':str(provider_file)}
    file_profile=copy.deepcopy(profile)
    file_profile['nodes'][1]['callFrame']['url']=provider_file.as_uri()
    write(file_profile)
    assert summarize(profile_path,file_context)['buckets']['js_reconcile']['samples']==1
    bad_file={**file_context,'providerLoadedSha256':'0'*64}
    assert summarize(profile_path,bad_file)['buckets']['js_reconcile']['samples']==0
    provider_file.write_bytes(provider+b' changed')
    assert summarize(profile_path,file_context)['buckets']['js_reconcile']['samples']==0
    provider_file.unlink();outside=root/'outside-provider.mjs';outside.write_bytes(provider)
    provider_file.symlink_to(outside)
    assert summarize(profile_path,file_context)['buckets']['js_reconcile']['samples']==0
    provider_file.unlink();provider_file.write_bytes(provider)
    long_provider=provider+b'/*'+b'x'*2048+b'*/'
    long_url='data:text/javascript;base64,'+base64.b64encode(long_provider).decode()
    assert len(long_url)>1024
    truncated=copy.deepcopy(profile);truncated['nodes'][1]['callFrame']['url']=long_url[:1024]
    write(truncated)
    long_context={**context,'providerLoadedSha256':hashlib.sha256(long_provider).hexdigest()}
    assert summarize(profile_path,long_context)['buckets']['js_reconcile']['samples']==0
    signed=copy.deepcopy(profile);signed['timeDeltas']=[1000,1000,-53,1000]
    write(signed);limited=summarize(profile_path,context)
    assert limited['timeDeltaStatus']=='NONMONOTONIC_COUNTS_ONLY'
    assert limited['negativeTimeDeltaCount']==1 and limited['minimumTimeDeltaMicroseconds']==-53
    assert limited['rawSignedDeltaSumMicroseconds']==2947 and limited['sampledDeltaMicroseconds'] is None
    assert sum(b['samples'] for b in limited['buckets'].values())==4
    assert all(b['sampledDeltaMicroseconds'] is None and b['fractionOfSampledDeltas'] is None
               for b in limited['buckets'].values())
    bad=copy.deepcopy(signed);bad['timeDeltas'][0]=-53;write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(signed);bad['timeDeltas'][2]=-1001;write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(signed);bad['timeDeltas']=[1000,5100,-1000,0]
    write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['samples'][1]=99;write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['timeDeltas'][0]=-1;write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][3]['children']=[2];write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][0]['children']=[2,3];write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['endTime']=bad['startTime'];write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['timeDeltas'].pop();write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][0]['children']=[2,2,3,5];write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][0],bad['nodes'][1]=bad['nodes'][1],bad['nodes'][0]
    write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][2]['callFrame']['url']=(qualified/'board.mjs').as_uri()
    write(bad);assert summarize(profile_path,context)['buckets']['v8_gc']['samples']==0
    bad=copy.deepcopy(profile);bad['nodes'][2]['callFrame']['scriptId']='not-a-script'
    write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][2]['callFrame']['lineNumber']=True
    write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['startTime']=-1;write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['timeDeltas']=[3000000]*4
    write(bad);denied(lambda:load(profile_path))
    outside=root/'outside.mjs';outside.write_text('export const nativeTick=()=>{};\n')
    (qualified/'link.mjs').symlink_to(outside)
    bad=copy.deepcopy(profile);bad['nodes'][4]['callFrame']['url']=(qualified/'link.mjs').as_uri()
    write(bad);assert summarize(profile_path,context)['buckets']['js_board_device']['samples']==0
    deep={'nodes':[{'id':i,'callFrame':frame('f','node:internal'),
                    'children':[i+1] if i<1500 else []} for i in range(1,1501)],
          'startTime':1,'endTime':2000,'samples':[1500],'timeDeltas':[1500]}
    write(deep);assert summarize(profile_path,context)['nodeCount']==1500
    actual=root/'actual.cpuprofile'
    code="""import {Session} from 'node:inspector/promises';
import {writeFileSync} from 'node:fs';
const s=new Session();s.connect();await s.post('Profiler.enable');
await s.post('Profiler.setSamplingInterval',{interval:1000});await s.post('Profiler.start');
let x=0;for(let i=0;i<2000000;i++)x+=Math.sqrt(i);
const {profile}=await s.post('Profiler.stop');s.disconnect();
if(!Number.isFinite(x))throw Error('control loop');
writeFileSync(process.argv[1],JSON.stringify(profile)+'\\n');"""
    subprocess.run([sys.argv[1] if len(sys.argv)>1 else 'node','--input-type=module','-e',code,str(actual)],
                   check=True,timeout=15,capture_output=True)
    real=load(actual)
    assert len(real[0]['samples'])>0 and real[3]>0
print('bounded inspector profile controls PASS')

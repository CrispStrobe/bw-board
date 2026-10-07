"""Small adversaries for profile graph, timing and source-role admission."""
import base64,copy,hashlib,json,tempfile
from pathlib import Path
from profile import load,summarize

def denied(fn):
    try:fn()
    except (ValueError,TypeError,KeyError,OverflowError):return
    raise AssertionError('malformed CPU profile accepted')

with tempfile.TemporaryDirectory(prefix='cold-sampling-control-') as folder:
    root=Path(folder);profile_path=root/'control.cpuprofile';qualified=root/'qualified';qualified.mkdir()
    (qualified/'board.mjs').write_text('export const nativeTick=()=>{};\n')
    provider=b'export const reconcile=()=>{};'
    url='data:text/javascript;base64,'+base64.b64encode(provider).decode()
    profile={'nodes':[
        {'id':1,'callFrame':{'functionName':'(root)','url':''},'children':[2,3,5]},
        {'id':2,'callFrame':{'functionName':'reconcile','url':url},'children':[4]},
        {'id':3,'callFrame':{'functionName':'(garbage collector)','url':''}},
        {'id':4,'callFrame':{'functionName':'native addon','url':''}},
        {'id':5,'callFrame':{'functionName':'nativeTick','url':(qualified/'board.mjs').as_uri()}}],
        'startTime':100,'endTime':5100,'samples':[2,3,4,5],
        'timeDeltas':[1000,1000,1000,1000]}
    context={'qualifiedRoot':str(qualified),'harnessRoot':str(root/'harness'),
             'derivedRoot':str(root/'derived'),
             'providerLoadedSha256':hashlib.sha256(provider).hexdigest()}
    def write(value):profile_path.write_text(json.dumps(value)+'\n')
    write(profile);out=summarize(profile_path,context)
    assert out['sampleCount']==4 and out['buckets']['js_reconcile']['samples']==1
    assert out['buckets']['v8_gc']['samples']==1
    assert out['buckets']['native_or_unresolved']['samples']==1
    assert out['buckets']['js_board_device']['samples']==1
    wrong=copy.deepcopy(context);wrong['providerLoadedSha256']='0'*64
    assert summarize(profile_path,wrong)['buckets']['js_reconcile']['samples']==0
    bad=copy.deepcopy(profile);bad['samples'][1]=99;write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['timeDeltas'][0]=-1;write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][3]['children']=[2];write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][0]['children']=[2,3];write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['endTime']=bad['startTime'];write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['timeDeltas'].pop();write(bad);denied(lambda:load(profile_path))
    bad=copy.deepcopy(profile);bad['nodes'][0]['children']=[2,2,3,5];write(bad);denied(lambda:load(profile_path))
print('bounded inspector profile controls PASS')

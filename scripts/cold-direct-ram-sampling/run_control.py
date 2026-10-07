"""Modeled parent control: nine-child schedule, profile gating and failure retention."""
import json,os,shutil,tempfile
from pathlib import Path
import run as sampling

def require(ok,message):
    if not ok:raise AssertionError(message)

with tempfile.TemporaryDirectory(prefix='cold-sampling-parent-control-') as folder:
    root=Path(folder);roles={}
    for name in ('directAddon','companionAddon','ownerAddon','node','reference'):
        path=root/name;path.write_bytes(name.encode());roles[name]=str(path)
    for name in ('direct','companion'):
        path=root/('config-'+name);path.write_bytes(name.encode());roles[name+'Config']=str(path)
    original_auth=sampling.parent.authenticate_setup
    original_child=sampling.parent.child
    original_check=sampling.subprocess.check_output
    original_metadata=sampling.parent.metadata
    calls=[];fail_at=None
    provider_loaded='a'*64
    def auth(setup):return {'officialZipSha256':'b'*64}
    def check_output(cmd,*args,**kwargs):
        if len(cmd)>1 and cmd[1]=='--input-type=module':
            return json.dumps({'loaded':provider_loaded,
             'normalized':sampling.parent.CONTRACT['timingProvider']['derivedSha256']})+'\n'
        return original_check(cmd,*args,**kwargs)
    def child(setup,comparison,pair,arm,output,reference):
        calls.append((pair,arm,bool(os.environ.get('BW_CPU_PROFILE_PATH'))))
        if len(calls)==fail_at:raise ValueError('modeled child semantic failure')
        path=os.environ.get('BW_CPU_PROFILE_PATH')
        if path:
            p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
            p.write_text(json.dumps({'nodes':[{'id':1,'callFrame':{
             'functionName':'(root)','scriptId':'0','url':'',
             'lineNumber':-1,'columnNumber':-1}}],
             'startTime':10,'endTime':2010,'samples':[1],'timeDeltas':[1000]})+'\n')
        return {'receiptSha256':'c'*64,'wholeChild':{'exitCode':0},
                'receipt':{'executionTiming':{'cpuMicroseconds':{'user':1,'system':1},
                 'wallNanoseconds':'1000'},
                 'providerDerivation':{'loadedModuleSha256':provider_loaded} if arm=='direct' else None}}
    try:
        sampling.parent.authenticate_setup=auth;sampling.parent.child=child
        sampling.subprocess.check_output=check_output
        sampling.parent.metadata=lambda:{'modeled':True}
        def setup(where):
            data={'schema':'modeled','harnessRoot':str(sampling.HERE.parent.parent),
                  'harnessHead':'model','qualifiedRoot':str(root),
                  'referenceSha256':'d'*64,'output':str(where),
                  'configuration':{'direct':roles['directConfig'],
                                   'companion':roles['companionConfig']},**roles}
            data['node']=shutil.which('node')
            file=where.parent/(where.name+'-setup.json');file.write_text(json.dumps(data))
            return file
        report=sampling.run(setup(root/'ok'))
        require(report['status']=='SEMANTIC_PASS_DIAGNOSTIC_SAMPLES_ONLY' and
                report['adoptionGate']=='NOT_RUN' and len(report['children'])==9,
                'nine diagnostic children without adoption')
        require(sum(sampled for _,_,sampled in calls)==6 and
                {arm for _,arm,_ in calls}=={'direct','companion','plain-js'} and
                all(sum(arm==name for _,arm,_ in calls)==3 for name in
                    ('direct','companion','plain-js')),'one warm-up/two samples each')
        require(all(('profile' in item)==item['sampled'] for item in report['children']),
                'profile only after sampled semantic child')
        calls.clear();fail_at=4
        try:sampling.run(setup(root/'fail'))
        except ValueError as error:require('semantic failure' in str(error),'original child failure')
        else:raise AssertionError('failed child accepted')
        require(not (root/'fail'/'result.json').exists() and
                len(json.loads((root/'fail'/'completed.json').read_text()))==3,
                'no summary after failed semantic child; partial evidence retained')
        calls.clear();fail_at=4
        metadata_calls=[0]
        def failing_metadata():
            metadata_calls[0]+=1
            if metadata_calls[0]==2:raise OSError('modeled host-after failure')
            return {'modeled':True}
        sampling.parent.metadata=failing_metadata
        try:sampling.run(setup(root/'fail-host-after'))
        except ValueError as error:require('semantic failure' in str(error),
                                         'host-after error must preserve child failure')
        else:raise AssertionError('host-after masked failed child')
        require(json.loads((root/'fail-host-after'/'host-after-error.json').read_text())
                ['type']=='OSError' and
                len(json.loads((root/'fail-host-after'/'completed.json').read_text()))==3,
                'secondary host-after failure recorded without semantic summary')
    finally:
        sampling.parent.authenticate_setup=original_auth
        sampling.parent.child=original_child
        sampling.subprocess.check_output=original_check
        sampling.parent.metadata=original_metadata
print('modeled bounded inspector parent controls PASS')

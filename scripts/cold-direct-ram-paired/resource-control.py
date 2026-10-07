"""Node-only bounded process and orphan controls; no addon or guest."""
import json,os,sys,tempfile
from pathlib import Path
from bounded import run_bounded

assert len(sys.argv)==2
node=sys.argv[1]
with tempfile.TemporaryDirectory(prefix='cold-paired-resource-') as folder:
    root=Path(folder)
    def run(name,code,seconds=5):
        result=run_bounded([node,'--max-old-space-size=32','-e',code],root,
                           root/(name+'.stdout'),root/(name+'.stderr'),
                           seconds=seconds,cpu_seconds=5,max_rss_bytes=256*1024**2)
        return result
    good=run('good','let s=0;for(let i=0;i<2000000;i++)s+=i; if(!s)process.exit(2)')
    assert good['exitCode']==0 and good['processGroupEmptyAfterExit'] and not good['timedOut']
    assert good['cpuSeconds']>0 and good['wallSeconds']>0 and good['childMaxRssKilobytes']>0
    slow=run('slow','setTimeout(()=>{},5000)',seconds=0.2)
    assert slow['timedOut'] and slow['exitCode']!=0
    orphan=run('orphan',"require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},5000)'],{stdio:'ignore'}).unref()")
    assert orphan['exitCode']==0 and not orphan['processGroupEmptyAfterExit']
    observed=[]
    def fail_poll(pid):observed.append(pid);raise RuntimeError('injected monitor failure')
    try:run_bounded([node,'-e','setTimeout(()=>{},5000)'],root,
                    root/'failure.stdout',root/'failure.stderr',seconds=5,
                    cpu_seconds=5,max_rss_bytes=256*1024**2,on_poll=fail_poll)
    except RuntimeError as error:assert str(error)=='injected monitor failure'
    else:raise AssertionError('monitor failure not propagated')
    assert len(observed)==1
    try:os.killpg(observed[0],0)
    except ProcessLookupError:pass
    else:raise AssertionError('monitor failure stranded owned process group')
print(json.dumps({'schema':'bw.cold-direct-ram.paired-resource-control.v1','status':'PASS',
                  'cases':['normal','timeout','orphan-process-group','monitor-exception-cleanup']},sort_keys=True))

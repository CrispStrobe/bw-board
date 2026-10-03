"""Manual one-comparison orchestrator. Pending prerequisite refuses all setup."""
import sys
sys.dont_write_bytecode=True
import os,signal,json
from pathlib import Path
import importlib.util
_spec=importlib.util.spec_from_file_location('paired_setup_guard',Path(__file__).resolve().parent/'setup-entry.py');_module=importlib.util.module_from_spec(_spec);_spec.loader.exec_module(_module);pending_guard=_module.pending_guard
from parent import require,main as paired_main,read_json,write,parent_identity,identity_sha,bounded_child,interrupted,host_context
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
def main(comparison,out):
    pending_guard() # No metadata subprocess, download or child before source authority.
    require(comparison in ('native-oneQ-v-batched','plain-JS-v-batched'),'one explicit comparison')
    require(os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch','manual-only source grant')
    identity=parent_identity();require(identity['revision']==os.environ['GITHUB_SHA'],'exact actual dispatch HEAD')
    out=Path(out);require(out==Path('/home/runner/work/_temp/cold-paired-performance'),'fixed hosted output role');require(out.is_absolute() and out.resolve()==out and out.parent.is_dir() and not os.path.lexists(out),'exclusive hosted parent output');out.mkdir()
    write(out/'parent-source.json',identity);write(out/'host-before-setup.json',host_context())
    primary=None
    try:
        node=os.environ['BW_COLD_NODE'];setup=out/'setup';bounds={'cpuSeconds':60,'wallSeconds':240,'heapMiB':128,'fileBytes':16<<20,'coreBytes':0,'niceIncrement':10}
        result=bounded_child([sys.executable,'-B',str(HERE/'setup-entry.py'),str(setup),node],ROOT,out/'setup-child',bounds,permit_api_token=True)
        require(result['exitCode']==0 and not result['timedOut'] and not result['interrupted'],'first setup failure; no pairs or retry')
        proof=read_json(setup/'setup-result.json');require(proof['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED','actual closed setup proof')
        request=out/'request.json';write(request,{'comparison':comparison,'output':str(out/'pairs'),'parentRevision':identity['revision'],'parentSourceSha256':identity_sha(identity['revision'],identity['hashes'])})
        paired_main(request,setup/'derived-paired-binding.json')
    except BaseException as error:primary=error;raise
    finally:
        final_error=None
        try:
            after=parent_identity();write(out/'parent-source-after.json',after);require(after==identity,'outer parent source unchanged on every outcome')
        except BaseException as error:final_error=error;write(out/'parent-source-after-unavailable.json',{'error':repr(error)})
        write(out/'host-after-setup-or-pairs.json',host_context())
        if final_error is not None and primary is None:raise final_error
if __name__=='__main__':
    for s in (signal.SIGINT,signal.SIGTERM):signal.signal(s,interrupted)
    require(len(sys.argv)==3,'one comparison and closed output');main(sys.argv[1],sys.argv[2])

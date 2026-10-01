#!/usr/bin/env python3
"""Linux child containment for lossless native hot traces; never uses stderr pipes."""
import argparse,hashlib,json,pathlib,resource,subprocess,time

def run_child(node,entry,input_path,stem,*,heap_mib=512,timeout_seconds=120,max_file_mib=256):
    stem=pathlib.Path(stem)
    if not stem.is_absolute():raise ValueError('absolute new artifact stem required')
    if not 128<=heap_mib<=1024 or not 1<=timeout_seconds<=300 or not 1<=max_file_mib<=256:raise ValueError('bounded child resources required')
    for suffix in ['.stdout','.stderr','.exit.json']:
        if pathlib.Path(str(stem)+suffix).exists():raise FileExistsError(str(stem)+suffix)
    def limits():
        cap=max_file_mib*1024*1024
        resource.setrlimit(resource.RLIMIT_FSIZE,(cap,cap))
        resource.setrlimit(resource.RLIMIT_CORE,(0,0))
    start=time.monotonic_ns();timed_out=False;status=None;error=None
    with open(str(stem)+'.stdout','xb') as out,open(str(stem)+'.stderr','xb') as err:
        try:
            child=subprocess.run([str(node),'--max-old-space-size='+str(heap_mib),str(entry),str(input_path)],stdin=subprocess.DEVNULL,stdout=out,stderr=err,preexec_fn=limits,timeout=timeout_seconds)
            status=child.returncode
        except subprocess.TimeoutExpired:
            timed_out=True;error='child wall timeout; subprocess killed and waited'
        except OSError as exc:error=str(exc)
    raw=pathlib.Path(str(stem)+'.stderr')
    file_limit_reached=any(pathlib.Path(str(stem)+suffix).stat().st_size>=max_file_mib*1024*1024 for suffix in ['.stdout','.stderr'])
    if file_limit_reached:error='file-size bound reached; evidence may be truncated'
    with open(raw,'rb') as file:digest=hashlib.file_digest(file,'sha256').hexdigest()
    result={'returncode':status,'signal':-status if status is not None and status<0 else None,'timedOut':timed_out,'fileLimitReached':file_limit_reached,'error':error,'stderrBytes':raw.stat().st_size,'stderrSha256':digest,'wallNs':time.monotonic_ns()-start,'transport':'regular file descriptors, no nonblocking pipe','RLIMIT_FSIZE':max_file_mib*1024*1024,'heapMiB':heap_mib,'command':[str(node),str(entry),str(input_path)],'status':'CHILD_EXIT_PASS_NOT_QUALIFICATION' if status==0 and not error else 'ACTUAL_CHILD_FAILURE_PRESERVED'}
    with open(str(stem)+'.exit.json','x') as file:json.dump(result,file,indent=2)
    return result

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['node','entry','input','stem']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--heap-mib',type=int,default=512);parser.add_argument('--timeout-seconds',type=int,default=120);parser.add_argument('--max-file-mib',type=int,default=256)
    args=parser.parse_args();result=run_child(args.node,args.entry,args.input,args.stem,heap_mib=args.heap_mib,timeout_seconds=args.timeout_seconds,max_file_mib=args.max_file_mib)
    print(json.dumps(result));raise SystemExit(0 if result['status']=='CHILD_EXIT_PASS_NOT_QUALIFICATION' else 1)

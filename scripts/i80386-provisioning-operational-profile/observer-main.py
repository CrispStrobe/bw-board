"""Fixed root observer composing unchanged admission/lifetime with owned endpoints."""
import hashlib,json,os,stat,socket,subprocess,sys,types
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PROFILE='scripts/i80386-provisioning-operational-profile/'

def _read_bound(path,cap):
    fd=None;primary=None;body=None
    try:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        if type(fd)is not int or fd<0:raise ValueError('bootstrap-file-handle')
        first=os.fstat(fd)
        if not stat.S_ISREG(first.st_mode)or first.st_nlink!=1 or first.st_size>cap:raise ValueError('bootstrap-source-shape')
        chunks=[];count=0
        while True:
            part=os.read(fd,min(65536,cap+1-count));count+=len(part)
            if count>cap:raise ValueError('bootstrap-source-cap')
            if not part:break
            chunks.append(part)
        end=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        if count!=first.st_size or not stat.S_ISREG(named.st_mode)or end.st_nlink!=1 or named.st_nlink!=1 or(first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns)!=(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)or(first.st_dev,first.st_ino,first.st_size,first.st_mtime_ns)!=(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns):raise ValueError('bootstrap-source-changed')
        body=b''.join(chunks)
    except BaseException as error:primary=error
    finally:
        if fd is not None:
            try:os.close(fd)
            except BaseException as error:
                if primary is None:primary=error
    if primary is not None:raise primary
    return body

def _preload(raw,seal):
    if type(raw)is not bytes or len(raw)>65536 or type(seal)is not str or len(seal)!=64 or hashlib.sha256(raw).hexdigest()!=seal:raise ValueError('approval-unsealed')
    def pairs(items):
        out={}
        for k,v in items:
            if k in out:raise ValueError('duplicate-approval')
            out[k]=v
        return out
    def bad(_):raise ValueError('approval-number')
    approved=json.loads(raw.decode(),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
    if type(approved)is not dict or set(approved)!={'schema','repository','head','mode','roles','graphSha256'}or approved['schema']!='bw.provisioning-operational-approval.v1'or approved['mode']!='limits-ack-approval-refusal':raise ValueError('approval-shape')
    if type(approved['roles'])is not dict or not 1<=len(approved['roles'])<=100:raise ValueError('approval-roles')
    bodies={}
    for relative,row in approved['roles'].items():
        if type(relative)is not str or relative.startswith('/')or len(relative)>240 or any(p in ('','.','..')for p in relative.split('/')):raise ValueError('approval-path')
        if type(row)is not dict or set(row)!={'bytes','sha256'}or type(row['bytes'])is not int or not 0<row['bytes']<=524288 or type(row['sha256'])is not str or len(row['sha256'])!=64:raise ValueError('approval-row')
        body=_read_bound(ROOT/relative,524288)
        if len(body)!=row['bytes']or hashlib.sha256(body).hexdigest()!=row['sha256']:raise ValueError('approval-source-changed')
        bodies[relative]=body
    graph_relative='scripts/i80386-provisioning-operational-profile/fixed-graph.json'
    if graph_relative not in bodies or hashlib.sha256(bodies[graph_relative]).hexdigest()!=approved['graphSha256']:raise ValueError('approval-graph')
    graph=json.loads(bodies[graph_relative],object_pairs_hook=pairs)
    if set(graph)!={'schema','roles','held'}or graph['schema']!='bw.provisioning-operational-graph.v1'or type(graph['roles'])is not list or any(type(x)is not str for x in graph['roles'])or len(set(graph['roles']))!=len(graph['roles'])or set(graph['roles'])!=set(bodies):raise ValueError('approval-closure')
    for relative,row in graph['held'].items():
        if relative not in approved['roles']or approved['roles'][relative]!=row:raise ValueError('held-changed')
    path='scripts/i80386-provisioning-operational-profile/collect.py'
    if path not in bodies:raise ValueError('collect-unapproved')
    module=types.ModuleType('approved_collect');module.__file__=str(ROOT/path)
    exec(compile(bodies[path],'<approved-collector>','exec'),module.__dict__)
    return module

def _collector(raw,seal):return _preload(raw,seal)

def main():
    output=Path(os.environ['RUNNER_TEMP'])/'bw-provisioning-operational'
    raw=_read_bound(output/'approval.json',65536);seal=os.environ.get('BW_APPROVAL_SHA256')
    c=_collector(raw,seal);approval,bodies=c.admit(ROOT,raw,seal)
    c.need(sys.platform=='linux'and all(type(v)is int and v==0 for v in (os.getuid(),os.geteuid(),os.getgid(),os.getegid())),'root-observer')
    c.need(os.stat(ROOT).st_uid==0 and os.stat(ROOT/'.git').st_uid==0,'root-owned-checkout')
    reportfd=os.open(output,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    primary=None;result=None
    try:result=_connected(c,approval,bodies,output,reportfd,seal)
    except BaseException as error:primary=error
    finally:
        try:os.close(reportfd)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary
    return result

def _connected(c,approval,bodies,output,reportfd,seal):
    store=c.Store(reportfd)
    lifetime_module=c.module(ROOT,bodies,'scripts/i80386-provisioning-observer-lifetime/lifetime.py')
    lifetime=lifetime_module.Lifetime();owned=[];channels=[];channel_fds={};consumed=set();process=None;primary=None
    def close_channel(channel):
        fd=channel_fds.get(id(channel))
        if type(fd)is int and fd>=0:
            if fd in consumed:return
            consumed.add(fd)
        channel.close()
    def close_raw(fd):
        # Socket owner wins if an invalid manufactured return aliases its FD.
        if type(fd)is not int or fd<0 or fd in consumed or fd in channel_fds.values():return
        consumed.add(fd);os.close(fd)
    def launch():
        nonlocal process
        # Root privilege already established before endpoints: no inner sudo.
        left,right=socket.socketpair(socket.AF_UNIX,socket.SOCK_SEQPACKET|socket.SOCK_CLOEXEC)
        channels.extend((left,right))
        channel_fds[id(left)]=left.fileno();channel_fds[id(right)]=right.fileno()
        left.setsockopt(socket.SOL_SOCKET,socket.SO_PASSCRED,1)
        outread,outwrite=os.pipe2(os.O_CLOEXEC|os.O_NONBLOCK);owned.extend((outread,outwrite))
        errread,errwrite=os.pipe2(os.O_CLOEXEC|os.O_NONBLOCK);owned.extend((errread,errwrite))
        childreport=os.open(output,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);owned.append(childreport)
        allfds=owned+[channel_fds[id(left)],channel_fds[id(right)]]
        c.need(all(type(fd)is int and fd>=0 for fd in allfds)and len(set(allfds))==len(allfds),'duplicate-owned-handles')
        env={'PATH':'/usr/bin:/bin','LANG':'C','LC_ALL':'C','PYTHONDONTWRITEBYTECODE':'1','GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'CrispStrobe/bw-board','GITHUB_RUN_ATTEMPT':'1','BW_APPROVAL_SHA256':seal}
        command=('/usr/bin/timeout','--signal=KILL','480s','/usr/bin/unshare','--pid','--fork','--mount-proc','--kill-child=KILL','--','/usr/bin/python3','-I','-B',str(ROOT/PROFILE/'contained-bootstrap.py'),'--channel-fd',str(right.fileno()),'--report-fd',str(childreport))
        process=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=outwrite,stderr=errwrite,pass_fds=(right.fileno(),childreport),env=env,close_fds=True)
        # Transfer parent ends to unchanged Lifetime; consume other ends once.
        for fd in (outwrite,errwrite,childreport):
            owned.remove(fd);close_raw(fd)
        channels.remove(right);close_channel(right)
        bundle=(process,left,outread,errread)
        owned.remove(outread);owned.remove(errread);channels.remove(left)
        return bundle
    lifetime_module._launch=launch
    try:lifetime._run()
    except BaseException as error:primary=error
    finally:
        # Incomplete launch before returned bundle is uncertain; no inferred
        # kill of numeric PIDs or unrelated/discovered process groups.
        for fd in reversed(owned):
            try:close_raw(fd)
            except BaseException as error:
                if primary is None:primary=error
        for channel in channels:
            try:close_channel(channel)
            except BaseException as error:
                if primary is None:primary=error
        try:
            status=lifetime.status();stdout=status.pop('stdout');stderr=status.pop('stderr')
            store.put('stdout.bin',stdout);store.put('stderr.bin',stderr)
            store.json('lifetime-status.json',status)
            if lifetime.observer is not None:
                observed=lifetime.observer.status();packet=observed.pop('packet')
                observed['sourceSchema']=observed['schema'];observed['schema']='bw.provisioning-operational-resource-observation.v1'
                wire=None
                try:wire=c.regular(output/'resource-wire.bin',8192)
                except FileNotFoundError:pass
                observed['resourceWireReference']=None if wire is None else {'bytes':len(wire),'sha256':hashlib.sha256(wire).hexdigest()}
                c.need(packet is None or wire is not None and c.decoded(wire,8192)==packet,'resource-original-join')
                store.json('resource-observation.json',observed)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary
    return 0
if __name__=='__main__':sys.exit(main())

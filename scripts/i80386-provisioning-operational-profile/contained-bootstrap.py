"""Fixed PID1 smoke: genuine limits and ACK, then held approval-unarmed refusal."""
import hashlib,json,os,stat,socket,sys,types
from pathlib import Path
HERE=Path(__file__).resolve().parent
ROOT=HERE.parent.parent

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
        if type(fd)is int and fd>=0:
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

def _load_collect(raw,seal):return _preload(raw,seal)

def main():
    # These descriptors are fixed internally generated child mapping, not an API
    # for caller factories, source commands or completion predicates.
    if len(sys.argv)!=5 or sys.argv[1]!='--channel-fd'or sys.argv[3]!='--report-fd':raise ValueError('fixed-bootstrap-argv')
    channel_fd=int(sys.argv[2]);report_fd=int(sys.argv[4])
    if channel_fd<3 or report_fd<3 or channel_fd==report_fd:raise ValueError('bootstrap-handles')
    seal=os.environ.get('BW_APPROVAL_SHA256');raw=None;fd=None;read_primary=None
    try:
        fd=os.open('approval.json',os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=report_fd)
        if type(fd)is not int or fd<0:raise ValueError('approval-handle')
        st=os.fstat(fd)
        if not stat.S_ISREG(st.st_mode)or st.st_nlink!=1 or st.st_size>65536:raise ValueError('approval-shape')
        raw=os.read(fd,65537)
        if len(raw)!=st.st_size or len(raw)>65536 or os.read(fd,1):raise ValueError('approval-cap')
    except BaseException as error:read_primary=error
    finally:
        if type(fd)is int and fd>=0:
            try:os.close(fd)
            except BaseException as error:
                if read_primary is None:read_primary=error
    if read_primary is not None:raise read_primary
    c=_load_collect(raw,seal);approval,bodies=c.admit(str(ROOT),raw,seal);store=c.Store(report_fd)
    entry_module=c.module(ROOT,bodies,'scripts/i80386-provisioning-contained/entry.py')
    entry=entry_module.Entry();controller=None;primary=None;capture_errors=[];socket_owner=None
    class Wire:
        def __init__(self,owned):self.owned=owned
        def sendmsg(self,buffers,ancillary):
            c.need(type(buffers)is list and len(buffers)==1 and type(buffers[0])is bytes,'resource-wire')
            store.put('resource-wire.bin',buffers[0])
            return self.owned.sendmsg(buffers,ancillary)
        def recv(self,n):return self.owned.recv(n)
        def settimeout(self,n):return self.owned.settimeout(n)
        def getsockopt(self,*args):return self.owned.getsockopt(*args)
        def close(self):return self.owned.close()
    try:
        socket_owner=socket.socket(fileno=channel_fd)
        entry_module._channel=lambda:Wire(socket_owner)
        entry_module._CHECKOUT=str(ROOT)
        # Actual external controller authorization is intentionally absent in
        # this smoke. These unused bounded metadata bytes confer no authority.
        entry_module._APPROVAL_RAW=b'{}';entry_module._DESCRIPTOR_RAW=b'{}';entry_module._TABLE_RAW=b'{}'
        entry._run()
        c.need(False,'unexpected-controller-success')
    except BaseException as error:primary=error
    finally:
        # Capture source status only after original Entry/Controller finally.
        result=None;controller_result=None
        try:
            controller=entry._controller
            if controller is not None:
                c.need(controller.busy is False and controller.closed is True,'controller-not-final')
                controller_result=controller.status();store.json('controller-status.json',controller_result)
        except BaseException as error:capture_errors.append(type(error).__name__)
        try:
            result=entry.status();issued=result.pop('controllerResult')
            row=store.records.get('controller-status.json')
            result['sourceControllerResultState']='absent'if issued is None else'issued-success-result'
            result['controllerStatusCapture']=None if row is None else dict(row)
            store.json('entry-status.json',result)
        except BaseException as error:capture_errors.append(type(error).__name__)
        # The resource packet is original bytes captured before send. A status
        # serialization is not substituted for an unissued resource packet.
        try:
            store.json('child-capture.json',{'schema':'bw.provisioning-contained-capture.v1','records':store.records,'primaryType':None if primary is None else type(primary).__name__,'captureErrors':capture_errors,'observationAbsentReason':'child-before-group-absent','actualAcquisitionQualified':False,'compilerQualified':False})
        except BaseException:
            capture_errors.append('capture-index-refused')
            try:sys.stderr.buffer.write(b'capture-journal-refused\n')
            except BaseException:pass
        try:os.close(report_fd)
        except BaseException:
            capture_errors.append('report-directory-close-refused')
            try:sys.stderr.buffer.write(b'post-journal-report-directory-close-refused\n')
            except BaseException:pass
    ok=(controller_result is not None and controller_result['firstFailure']=='approval-unarmed'and controller_result['sourceBefore']is None and controller_result['sourceAfter']is None and controller_result['transport']is None and controller_result['coordinator']is None and result is not None and result['ackReceived']is True and result['handshakeSent']is True and result['cleanupRefused']==0 and not capture_errors)
    if not ok:raise primary if primary is not None else ValueError('smoke-incomplete')
    # Exit0 denotes expected smoke refusal capture, never provisioning success.
    return 0

if __name__=='__main__':sys.exit(main())

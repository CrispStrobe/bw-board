"""Owned bounded report retention; emitted bytes remain distinct from source status."""
import hashlib,json,os,stat,types
from pathlib import Path
CAPS={'controller-status.json':262144,'entry-status.json':65536,'resource-wire.bin':8192,'resource-observation.json':16384,'lifetime-status.json':32768,'capture-index.json':16384,'official-event.json':8192,'stdout.bin':65536,'stderr.bin':65536,'observation.zip':524288,'child-capture.json':16384,'observer-diagnostic.bin':65536}
PROFILE='scripts/i80386-provisioning-operational-profile/'
class Refusal(ValueError):pass
def need(ok,code):
    if not ok:raise Refusal(code)
def encoded(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def decoded(body,cap):
    need(type(body)is bytes and len(body)<=cap,'json-cap')
    def pairs(rows):
        out={}
        for key,value in rows:
            need(key not in out,'duplicate-key');out[key]=value
        return out
    def bad(_):raise Refusal('json-number')
    try:return json.loads(body.decode(),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
    except (ValueError,UnicodeError,RecursionError)as error:raise Refusal('json-refused')from error

def regular(path,cap):
    fd=None;primary=None;body=None
    try:
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        need(type(fd)is int and fd>=0,'file-handle')
        st=os.fstat(fd);need(stat.S_ISREG(st.st_mode)and st.st_nlink==1 and st.st_size<=cap,'file-shape')
        chunks=[];count=0
        while True:
            part=os.read(fd,min(65536,cap+1-count));count+=len(part)
            need(count<=cap,'file-cap')
            if not part:break
            chunks.append(part)
        end=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        need(count==st.st_size and stat.S_ISREG(end.st_mode)and stat.S_ISREG(named.st_mode)and end.st_nlink==named.st_nlink==1 and (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns)==(named.st_dev,named.st_ino,named.st_size,named.st_mtime_ns),'file-changed')
        body=b''.join(chunks)
    except BaseException as error:primary=error
    finally:
        if type(fd)is int and fd>=0:
            try:os.close(fd)
            except BaseException as error:
                if primary is None:primary=error
    if primary is not None:raise primary
    return body

def admit(root,raw,seal):
    need(type(seal)is str and len(seal)==64 and all(c in '0123456789abcdef'for c in seal),'approval-unsealed')
    need(type(raw)is bytes and len(raw)<=65536,'approval-cap')
    need(hashlib.sha256(raw).hexdigest()==seal,'approval-digest')
    value=decoded(raw,65536)
    need(type(value)is dict and set(value)=={'schema','repository','head','mode','roles','graphSha256'},'approval-shape')
    need(value['schema']=='bw.provisioning-operational-approval.v1'and value['repository']=='CrispStrobe/bw-board'and value['mode']=='limits-ack-approval-refusal','approval-context')
    graph_body=regular(Path(root)/PROFILE/'fixed-graph.json',65536)
    need(hashlib.sha256(graph_body).hexdigest()==value['graphSha256'],'graph-unapproved')
    graph=decoded(graph_body,65536)
    need(type(graph)is dict and set(graph)=={'schema','roles','held'} and graph['schema']=='bw.provisioning-operational-graph.v1','graph-shape')
    need(type(graph['roles'])is list and len(graph['roles'])<=100 and all(type(p)is str for p in graph['roles'])and len(set(graph['roles']))==len(graph['roles']),'graph-roles')
    need(type(value['roles'])is dict and all(type(k)is str for k in value['roles']),'approval-roles')
    need(set(value['roles'])==set(graph['roles']),'source-closure')
    bodies={}
    for relative in graph['roles']:
        need(type(relative)is str and not relative.startswith('/')and all(p not in ('','.','..')for p in relative.split('/')),'source-path')
        row=value['roles'][relative];need(type(row)is dict and set(row)=={'bytes','sha256'}and type(row['bytes'])is int and 0<row['bytes']<=524288,'source-row')
        body=regular(Path(root)/relative,524288)
        need(len(body)==row['bytes']and hashlib.sha256(body).hexdigest()==row['sha256'],'source-digest')
        if relative in graph['held']:need(row==graph['held'][relative],'held-source-changed')
        bodies[relative]=body
    return value,bodies

def module(root,bodies,relative):
    need(relative in bodies,'module-unadmitted')
    m=types.ModuleType('operational_'+Path(relative).stem.replace('-','_'));m.__file__=str(Path(root)/relative)
    exec(compile(bodies[relative],'<admitted-operational-source>','exec'),m.__dict__)
    return m

class Store:
    def __init__(self,fd):
        need(type(fd)is int and fd>=0 and stat.S_ISDIR(os.fstat(fd).st_mode),'report-directory')
        self.fd=fd;self.records={};self.attempted=set()
    def put(self,name,body):
        need(name in CAPS and name not in self.attempted,'capture-once');self.attempted.add(name)
        record={'state':'serialization-refused','attempts':1,'rolePresent':False,'contentComplete':False,'closeCertain':True,'reason':None}
        self.records[name]=record
        if type(body)is not bytes or len(body)>CAPS[name]:
            record['reason']='serialization-cap-refused';raise Refusal('report-cap')
        fd=None;primary=None
        try:
            fd=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=self.fd)
            need(type(fd)is int and fd>=0,'write-handle')
            record['rolePresent']=True;record['state']='write-refused';off=0
            while off<len(body):
                n=os.write(fd,body[off:]);need(type(n)is int and 0<n<=len(body)-off,'write-progress');off+=n
            record['contentComplete']=True
            written=os.fstat(fd)
            need(stat.S_ISREG(written.st_mode)and written.st_nlink==1 and written.st_size==len(body),'write-identity')
        except BaseException as error:primary=error;record['reason']='write-refused'
        finally:
            if type(fd)is int and fd>=0:
                try:os.close(fd)
                except BaseException as error:
                    record['closeCertain']=False;record['state']='close-uncertain';record['reason']='close-refused'
                    if primary is None:primary=error
        if primary is not None:raise primary
        readfd=None;verification=None
        try:
            readfd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=self.fd);need(type(readfd)is int and readfd>=0,'readback-handle');st=os.fstat(readfd);parts=[];count=0
            while True:
                part=os.read(readfd,min(65536,len(body)+1-count));count+=len(part);need(count<=len(body),'readback-cap')
                if not part:break
                parts.append(part)
            named=os.stat(name,dir_fd=self.fd,follow_symlinks=False);end=os.fstat(readfd)
            need(stat.S_ISREG(st.st_mode)and st.st_nlink==end.st_nlink==named.st_nlink==1 and(written.st_dev,written.st_ino,written.st_size)==(st.st_dev,st.st_ino,st.st_size)==(end.st_dev,end.st_ino,end.st_size)==(named.st_dev,named.st_ino,named.st_size)and b''.join(parts)==body,'readback-changed')
            record['bytes']=len(body);record['sha256']=hashlib.sha256(body).hexdigest();record['state']='captured'
        except BaseException as error:verification=error;record['state']='write-refused';record['reason']='readback-refused'
        finally:
            if type(readfd)is int and readfd>=0:
                try:os.close(readfd)
                except BaseException as error:
                    record['closeCertain']=False;record['state']='close-uncertain';record['reason']='close-refused'
                    if verification is None:verification=error
        if verification is not None:raise verification
    def json(self,name,value):
        # One serialization attempt. On a failure no substituted report is issued.
        need(name not in self.attempted,'capture-once')
        try:body=encoded(value)
        except BaseException:
            self.attempted.add(name);self.records[name]={'state':'serialization-refused','attempts':1,'rolePresent':False,'contentComplete':False,'closeCertain':True,'reason':'serialization-refused'};raise
        self.put(name,body)

def package(output,members):
    """Package immutable readback bodies once; no binaries, inputs or staging journal."""
    import io,zipfile
    allowed=set(CAPS)-{'child-capture.json'}
    need(type(members)is dict and set(members)<=allowed and sum(len(b)for b in members.values())<=1572864,'artifact-shape')
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',compression=zipfile.ZIP_STORED,allowZip64=False)as archive:
        for name in sorted(members):
            body=members[name];need(type(body)is bytes and len(body)<=CAPS[name],'artifact-role')
            info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.create_system=3;info.external_attr=(0o100600<<16);archive.writestr(info,body)
    body=buffer.getvalue();need(len(body)<=2097152,'artifact-cap')
    fd=os.open(Path(output)/'companion.zip',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600);primary=None
    try:
        off=0
        while off<len(body):
            n=os.write(fd,body[off:]);need(type(n)is int and 0<n<=len(body)-off,'artifact-write');off+=n
    except BaseException as error:primary=error
    finally:
        try:os.close(fd)
        except BaseException as error:
            if primary is None:primary=error
    if primary is not None:raise primary

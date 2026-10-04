"""Fixed post-child evidence copies; no recorder, decoder, setup or guest execution."""
import sys
sys.dont_write_bytecode=True
import os,stat,json,hashlib,signal,resource,subprocess,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from admission import ROOT,WS,OUT,PARENT
from policy import require
BASE=Path('/home/runner/work/_temp')
EXPORT=BASE/'cold-ledger-scalars-native-symbol-export'
ROOTS=(OUT,PARENT)
MAX_FILES=1000;MAX_DEPTH=16;MAX_MEMBER=64<<20;MAX_TOTAL=256<<20
DIR_FLAGS=os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC
FILE_FLAGS=os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC

def identity(s):return (s.st_dev,s.st_ino,s.st_mode,s.st_nlink,s.st_uid,s.st_gid,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
def open_directory(path):
 require(path.is_absolute() and '..' not in path.parts,'fixed absolute directory')
 fd=os.open('/',DIR_FLAGS)
 try:
  for name in path.parts[1:]:
   nxt=os.open(name,DIR_FLAGS,dir_fd=fd);os.close(fd);fd=nxt
  return fd
 except BaseException:os.close(fd);raise

def copy_tree(source_fd,destination_fd,relative,report,depth=0):
 require(depth<=MAX_DEPTH,'bounded export depth')
 before_dir=os.fstat(source_fd)
 names=os.listdir(source_fd);require(len(names)<=MAX_FILES,'bounded directory entries')
 for name in sorted(names):
  report['entryCount']+=1;require(report['entryCount']<=MAX_FILES,'bounded total entries')
  require(name not in ('.','..') and '/' not in name and len(name.encode())<=255,'bounded ordinary entry name')
  rel=relative+'/'+name;require(len(rel.encode())<=4096,'bounded export path')
  seen=os.stat(name,dir_fd=source_fd,follow_symlinks=False)
  if stat.S_ISSOCK(seen.st_mode) and rel==OUT.name+'/control.sock':
   require(seen.st_uid==report['ordinaryOwnerUid'] and seen.st_nlink==1,'exact ordinary-owned control socket');report['skipped'].append({'path':rel,'reason':'Known ephemeral control socket, not archive evidence','stat':identity(seen)});continue
  if stat.S_ISDIR(seen.st_mode):
   child=os.open(name,DIR_FLAGS,dir_fd=source_fd)
   try:
    require(identity(os.fstat(child))==identity(seen),'directory open race')
    os.mkdir(name,0o700,dir_fd=destination_fd);target=os.open(name,DIR_FLAGS,dir_fd=destination_fd)
    try:copy_tree(child,target,rel,report,depth+1);os.fchmod(target,0o755)
    finally:os.fchmod(target,0o755);os.close(target)
    require(identity(os.stat(name,dir_fd=source_fd,follow_symlinks=False))==identity(seen),'directory path race')
   finally:os.close(child)
   continue
  require(stat.S_ISREG(seen.st_mode) and seen.st_nlink==1,'regular single-link evidence only: '+rel)
  require(seen.st_size<=MAX_MEMBER,'bounded export member')
  require(len(report['files'])<MAX_FILES,'bounded export file count')
  entry={'sourceStatBefore':identity(seen),'bytes':0,'complete':False};report['files'][rel]=entry
  source=os.open(name,FILE_FLAGS,dir_fd=source_fd);target=None;h=hashlib.sha256()
  try:
   require(identity(os.fstat(source))==identity(seen),'file open race')
   target=os.open(name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600,dir_fd=destination_fd)
   while True:
    data=os.read(source,65536)
    if not data:break
    entry['bytes']+=len(data);report['streamedBytes']+=len(data)
    require(entry['bytes']<=MAX_MEMBER and report['streamedBytes']<=MAX_TOTAL,'bounded streamed export')
    h.update(data);view=memoryview(data)
    while view:view=view[os.write(target,view):]
   entry['sha256']=h.hexdigest();entry['sourceStatAfter']=identity(os.fstat(source))
   require(entry['bytes']==seen.st_size and entry['sourceStatAfter']==entry['sourceStatBefore'],'source unchanged during copy')
   require(identity(os.stat(name,dir_fd=source_fd,follow_symlinks=False))==identity(seen),'source pathname unchanged')
   os.fchmod(target,0o644);entry['complete']=True
  except BaseException as error:entry['partialSha256']=h.hexdigest();entry['error']=repr(error);raise
  finally:
   if target is not None:os.fchmod(target,0o644);os.close(target)
   os.close(source)
 require(identity(os.fstat(source_fd))==identity(before_dir),'source directory unchanged during export')

def read_json_at(fd,name):
 f=os.open(name,FILE_FLAGS,dir_fd=fd)
 try:
  s=os.fstat(f);require(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and s.st_size<=1<<20,'bounded cleanup receipt')
  raw=b''
  while True:
   b=os.read(f,65536)
   if not b:break
   raw+=b;require(len(raw)<=1<<20,'bounded cleanup stream')
  require(identity(os.fstat(f))==identity(s),'stable cleanup receipt');return json.loads(raw)
 finally:os.close(f)

def live_process_evidence():
 groups=set();users=[];started=time.monotonic();entries=list(Path('/proc').iterdir());require(len(entries)<=20000,'bounded process census')
 for entry in entries:
  require(time.monotonic()-started<=5,'bounded cleanup census wall')
  if entry.name.isdecimal():
   try:
    groups.add(int((entry/'stat').read_text().rsplit(')',1)[1].split()[2]))
    cwd=os.readlink(entry/'cwd')
    with (entry/'cmdline').open('rb') as stream:command=stream.read(8193)
    require(len(command)<=8192,'bounded process command')
    paths=(str(OUT),str(PARENT))
    held_entry=str(WS/'symbol-worker/scripts/cold-native-ledger-scalars-symbol-profile/worker.mjs').encode()
    if any(cwd==p or cwd.startswith(p+'/') for p in paths) or held_entry in command or str(OUT/'perf.data').encode() in command:
     users.append({'pid':int(entry.name),'cwd':cwd,'commandSha256':hashlib.sha256(command).hexdigest()})
   except (FileNotFoundError,ProcessLookupError):pass
 return groups,users

def cleanup_gate(parent_fd,report):
 groups,users=live_process_evidence();report['activeEvidenceUsers']=users;require(not users,'active evidence user; export denied')
 for name in ('setup-child','observer-child'):
  try:child=os.open(name,DIR_FLAGS,dir_fd=parent_fd)
  except FileNotFoundError:report['cleanupGate'][name]={'created':False};continue
  try:
   exit=read_json_at(child,'exit.json');pid=exit.get('pid')
   require(pid is None or type(pid)is int and pid>1,'ordinary launched group identifier')
   require(pid is None and exit.get('launchError') or pid is not None and exit.get('rawWaitStatus')is not None,'reaped or prelaunch failure receipt')
   require(pid not in groups,'launched group still active; export denied')
   report['cleanupGate'][name]={'pid':pid,'reaped':pid is not None,'groupAbsent':True,'exit':exit}
  finally:os.close(child)
 # No cleanup authority is taken from mutable PIDs: exporter never kills anything.

def authenticate_dispatch():
 require(ROOT==WS/'runtime','fixed dispatch source root')
 env={'PATH':'/usr/bin:/bin','LC_ALL':'C','GIT_CONFIG_GLOBAL':'/dev/null','GIT_CONFIG_NOSYSTEM':'1'}
 def git(*args):return subprocess.check_output(['/usr/bin/git','-c','safe.directory='+str(ROOT),'-C',str(ROOT),*args],env=env,timeout=15)
 revision=git('rev-parse','HEAD').decode().strip();require(revision==os.environ['GITHUB_SHA'] and not git('status','--porcelain'),'exact clean dispatch head')
 paths=[p for p in HERE.iterdir() if p.is_file()]+[ROOT/'.github/workflows/i80386-cold-ledger-scalars-native-symbol.yml',ROOT/'test/i80386-cold-ledger-scalars-native-symbol-hosted-source.test.mjs'];hashes={}
 for path in paths:
  require(not path.is_symlink() and path.resolve()==path,'fixed source file')
  name=str(path.relative_to(ROOT));raw=path.read_bytes();require(len(raw)<=8<<20,'bounded dispatch source');h=hashlib.sha256(raw).hexdigest();require(h==hashlib.sha256(git('show',revision+':'+name)).hexdigest(),'current/Git exporter source');hashes[name]=h
 return {'revision':revision,'hashes':hashes,'gitTrustScope':[str(ROOT)]}

def create_export(base):
 os.mkdir(EXPORT.name,0o700,dir_fd=base);dest=os.open(EXPORT.name,DIR_FLAGS,dir_fd=base)
 try:require(os.fstat(dest).st_uid==0,'new root-owned export');return dest
 except BaseException:os.close(dest);raise

def interrupted(signum,frame):raise TimeoutError('exporter wall60 watchdog or interruption')

def main():
 require(len(sys.argv)==1 and os.geteuid()==0,'fixed root exporter, no caller paths')
 resource.setrlimit(resource.RLIMIT_CPU,(15,15));resource.setrlimit(resource.RLIMIT_FSIZE,(64<<20,64<<20));resource.setrlimit(resource.RLIMIT_CORE,(0,0));os.nice(10)
 report={'schema':'bw.cold-native-symbol.evidence-export.v1','status':'FAIL','scope':'Copies only; original observation outcome unchanged','files':{},'skipped':[],'cleanupGate':{},'streamedBytes':0,'entryCount':0};primary=None;base=None;dest=None;started=time.monotonic()
 try:
  for sig in (signal.SIGINT,signal.SIGTERM,signal.SIGALRM):signal.signal(sig,interrupted)
  signal.alarm(60);report['wallSeconds']=60
  source=authenticate_dispatch();report['dispatchSource']=source
  owner=(WS/'symbol-worker').stat();require(owner.st_uid>0,'authenticated ordinary worker owner');report['ordinaryOwnerUid']=owner.st_uid
  base=open_directory(BASE);dest=create_export(base)
  try:parent=open_directory(PARENT)
  except FileNotFoundError:
   require(not OUT.exists(),'OUT without parent cleanup authority');report['earlyFailure']='No parent created; source/setup admission may have failed before effects'
  else:
   try:cleanup_gate(parent,report)
   finally:os.close(parent)
  for path in ROOTS:
   try:fd=open_directory(path)
   except FileNotFoundError:report.setdefault('missingRoots',[]).append(str(path));continue
   try:
    os.mkdir(path.name,0o700,dir_fd=dest);target=os.open(path.name,DIR_FLAGS,dir_fd=dest)
    try:copy_tree(fd,target,path.name,report);os.fchmod(target,0o755)
    finally:os.fchmod(target,0o755);os.close(target)
   finally:os.close(fd)
  groups,users=live_process_evidence();report['activeEvidenceUsersAfter']=users;require(not users,'evidence user appeared during export')
  report['status']='READABLE_EVIDENCE_COPY_COMPLETE_NOT_OBSERVATION_SUCCESS'
 except BaseException as error:primary=error;report['error']=repr(error)
 finally:
  try:
   remaining=60-(time.monotonic()-started);require(remaining>0,'no wall budget for final source authentication');signal.alarm(max(1,int(remaining)))
   report['dispatchSourceAfter']=authenticate_dispatch();require(report['dispatchSourceAfter']==report.get('dispatchSource'),'export source unchanged')
  except BaseException as error:report['sourceFinalizationError']=repr(error);report['status']='FAIL';primary=primary or error
  signal.alarm(0)
  for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,signal.SIG_IGN)
  if dest is not None:
   try:
    raw=(json.dumps(report,indent=2)+'\n').encode();require(len(raw)<=8<<20,'bounded export manifest')
    f=os.open('export-manifest.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644,dir_fd=dest)
    try:
     with os.fdopen(f,'wb') as output:output.write(raw);os.fchmod(output.fileno(),0o644)
    finally:os.fchmod(dest,0o755)
   except BaseException as error:report['manifestError']=repr(error);primary=primary or error
   try:require(identity(os.stat(EXPORT.name,dir_fd=base,follow_symlinks=False))==identity(os.fstat(dest)),'exclusive export path still names opened directory')
   except BaseException as error:report['destinationError']=repr(error);primary=primary or error
   os.close(dest)
  if base is not None:os.close(base)
  print(json.dumps({'status':report['status'],'originalExportError':repr(primary) if primary else None,'manifestError':report.get('manifestError'),'destinationError':report.get('destinationError'),'copiedFiles':sum(x['complete'] for x in report['files'].values()),'bytes':report['streamedBytes']}),file=sys.stderr,flush=True)
 if primary:raise primary
if __name__=='__main__':main()

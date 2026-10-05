"""Future sole-ZIP audit. No downloads, extraction, restoration, addon or guest.
Requires root's official artifact descriptor. Emits logical JSON on stdout only
when invoked later; this prepared file has not been invoked against a guest.
"""
import hashlib,json,stat,zipfile,zlib,sys
from pathlib import Path
P=Path('/tmp/native-paged-int-iret-postfix-audit-preparation-20261005')
CAP=64<<20;STORED=16<<20;SMALL=128<<10
HOST='d46b68c201628a05f5f9934ada7fdddd3a57e683'
CONTRACT=Path('/tmp/bw-native-paged-int-iret-persistence-hosted-20261004/scripts/paged-int-iret-hosted/contract.json')
CONTRACT_SHA='8f3bd4c425884c48e7e1bd9b56d445cb00c9e9e7670ae88457622d317d16ecc9'
def require(value,msg):
 if not value:raise ValueError(msg)
def sha(b):return hashlib.sha256(b).hexdigest()
def ordinary(p,cap):
 p=Path(p);s=p.lstat();require(stat.S_ISREG(s.st_mode)and not p.is_symlink()and s.st_size<=cap,'ordinary bounded input');b=p.read_bytes();require(len(b)==s.st_size,'stable byte length');return b
def exact_json(b):
 def pairs(items):
  out={}
  for k,v in items:require(k not in out,'duplicate JSON key');out[k]=v
  return out
 return json.loads(b,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('nonfinite JSON')))

report={'status':'AUDIT_INCOMPLETE','stage':'before descriptor','members':{},'scope':'Read-only sole-ZIP audit; missing evidence is never synthesized.'}
outdir=P
logical=None
primary=None
write_error=None
def excerpt(error):
 text=str(error);b=text.encode('utf-8','replace');return {'type':type(error).__name__,'excerpt':b[:4096].decode('utf-8','replace'),'utf8Bytes':len(b),'sha256':sha(b),'truncated':len(b)>4096}
def audit():
 global report,outdir,logical
 report['stage']='official descriptor'
 request=exact_json(ordinary(P/'official-request.json',SMALL))
 require(set(request)=={'status','zip','zipBytes','zipSha256','runId','artifactId','attempt','hostedRevision','output'},'closed official descriptor')
 require(request['status']=='ROOT_SHARED_OFFICIAL_ARTIFACT'and request['hostedRevision']==HOST and request['attempt']==1,'actual reviewed source/attempt; PENDING refuses')
 for k in ['runId','artifactId','zipBytes']:require(type(request[k])is int and request[k]>0,'actual official numbers')
 require(isinstance(request['zipSha256'],str)and len(request['zipSha256'])==64 and all(c in '0123456789abcdef'for c in request['zipSha256']),'official SHA')
 report['official']=request
 report['stage']='official ZIP hash'
 zpath=Path(request['zip']);outdir=Path(request['output']);require(zpath.is_absolute()and outdir.is_absolute()and outdir.is_dir(),'fixed absolute roles')
 zs=zpath.lstat();require(stat.S_ISREG(zs.st_mode)and not zpath.is_symlink()and zs.st_size==request['zipBytes']and zs.st_size<=64<<20,'sole official ZIP bounded')
 h=hashlib.sha256()
 with zpath.open('rb')as f:
  for chunk in iter(lambda:f.read(1<<20),b''):h.update(chunk)
 require(h.hexdigest()==request['zipSha256'],'official ZIP digest')
 report['stage']='fixed contract'
 cb=ordinary(CONTRACT,1<<20);require(sha(cb)==CONTRACT_SHA,'frozen owned contract');contract=exact_json(cb)
 report['stage']='archive bounds/CRC/member hashes'
 with zipfile.ZipFile(zpath)as z:
  infos=z.infolist();names=[i.filename for i in infos];require(len(names)==len(set(names)),'unique archive names')
  require(all(not i.is_dir()and not n.startswith('/')and '\\'not in n and '..'not in n.split('/')and not stat.S_ISLNK(i.external_attr>>16)for n,i in zip(names,infos)),'ordinary bounded archive roles')
  require(len(infos)<=256 and sum(i.file_size for i in infos)<=192<<20,'archive count/decoded aggregate cap')
  records={};report['members']=records
  for i in infos:
   require(i.file_size<=64<<20,'per member cap');digest=hashlib.sha256();length=0
   with z.open(i)as f:
    for chunk in iter(lambda:f.read(1<<20),b''):length+=len(chunk);require(length<=i.file_size,'member overflow');digest.update(chunk)
   require(length==i.file_size,'member exact length/CRC');records[i.filename]={'bytes':length,'sha256':digest.hexdigest()}
  def get(suffix,cap=16<<20,required=True):
   candidates=[n for n in names if n.startswith('_temp/paged-int-iret-execution/')and n.endswith('/'+suffix)]
   require(len(candidates)<=1,'unambiguous '+suffix)
   if not candidates:
    require(not required,'missing '+suffix);return None
   require(z.getinfo(candidates[0]).file_size<=cap,'member bound '+suffix);return z.read(candidates[0])
  def obj(suffix,cap=16<<20,required=True):
   b=get(suffix,cap,required);return exact_json(b)if b is not None else None
  report['stage']='parent lifecycle/source maps'
  status=obj('final-status.json');ex=obj('worker.exit.json',SMALL,False)
  report['parentStatus']=status;report['workerExit']=ex
  def diagnostic(suffix):
   b=get(suffix,STORED,False)
   if b is None:return None
   return {'bytes':len(b),'sha256':sha(b),'prefix':b[:4096].decode('utf-8','replace'),'tail':b[-4096:].decode('utf-8','replace'),'truncated':len(b)>8192}
  report['workerStreams']={key:diagnostic('worker.'+key)for key in ['stdout','stderr']}
  before=obj('fixed-before.json',required=False);after=obj('fixed-after.json',required=False)
  if before is not None and after is not None:
   require(before==after,'fixed final authentication')
   require(len(before['tooling']['files'])==12 and len(before['compiled'])==208 and len(before['driver'])==81,'role closure counts')
   for role in ['compiled','driver']:require(before[role]=={p:v['sha256']for p,v in contract[role+'Files'].items()},'owned role map '+role)
  if status['status']=='PASS':require(before is not None and after is not None,'complete fixed before/after for PASS')
  restoredBefore=obj('restored-before.json',8<<20,False);restoredAfter=obj('restored-after.json',8<<20,False)
  if restoredBefore is not None and restoredAfter is not None:require(restoredBefore==restoredAfter,'restored final authentication')
  if status['status']=='PASS':require(restoredBefore is not None and restoredAfter is not None,'complete restored before/after for PASS')
  original=get('official-artifact.zip',required=False)
  if original is not None:require(len(original)==contract['zipBytes']and sha(original)==contract['zipSha256'],'original static ZIP unchanged')
  if status['status']=='PASS':require(original is not None,'original build evidence for PASS')
  report['stage']='independent outcome and compressed body'
  outcome=obj('guest/outcome.json',SMALL,False);logical=None;transport=None
  report['outcome']=outcome
  if outcome is not None:
   require(outcome.get('schema')=='bw.paged-int-iret.evidence-outcome.v1','outcome schema');body=outcome.get('body')
   if outcome.get('bodyComplete')is True:
    require(isinstance(body,dict)and set(body)=={'filename','decodedBytes','storedBytes','decodedSha256','storedSha256','encoding','decodedCap','storedCap'},'body metadata exact keys')
    require(body['filename']in ['capture.json.gz','first-divergence.json.gz']and body['encoding']=='gzip-single-member-json'and body['decodedCap']==CAP and body['storedCap']==STORED,'owned compressed format')
    for key,cap in [('decodedBytes',CAP),('storedBytes',STORED)]:require(type(body[key])is int and 0<body[key]<=cap,'declared body cap')
    packed=get('guest/'+body['filename'],STORED);require(len(packed)==body['storedBytes']and sha(packed)==body['storedSha256'],'stored body digest/length')
    inflater=zlib.decompressobj(31);decoded=inflater.decompress(packed,CAP+1)
    require(len(decoded)<=CAP and inflater.eof and not inflater.unconsumed_tail and not inflater.unused_data,'complete single gzip without trailing/member/overflow')
    require(len(decoded)==body['decodedBytes']and sha(decoded)==body['decodedSha256'],'decoded body digest/length')
    logical=exact_json(decoded);require(logical.get('progress')==outcome.get('progress'),'small/bulk progress binding')
    transport=body
   if status['status']=='PASS':
    require(ex is not None and ex['exitCode']==0 and not ex['timeout'],'successful child exit');require(outcome.get('status')=='PASS'and outcome.get('parityStatus')=='PASS'and outcome.get('primaryError')is None and outcome.get('persistenceError')is None and logical is not None and logical.get('status')=='PASS','complete PASS transport')
  else:require(status['status']!='PASS','PASS cannot omit outcome')
  report.update({'status':'READ_ONLY_TRANSPORT_AUDIT_PASS_OF_'+status['status'],'official':request,'members':records,'parentStatus':status,'availableMaps':{'fixedBefore':before is not None,'fixedAfter':after is not None,'restoredBefore':restoredBefore is not None,'restoredAfter':restoredAfter is not None,'originalStaticZip':original is not None},'workerExit':ex,'outcome':outcome,'body':transport,'logicalEvidenceAvailable':logical is not None,'scope':'Sole existing ZIP read-only streaming; no extraction, restore, addon, guest or retry. Transport audit is not architectural PASS.'})
  report['stage']='complete transport audit'

try:
 audit()
except BaseException as error:
 primary=error;report['status']='AUDIT_FAILED';report['primaryAuditError']=excerpt(error)
finally:
 try:
  with (outdir/'coder-transport-audit.json').open('x')as f:json.dump(report,f,indent=2);f.write('\n')
 except BaseException as error:
  write_error=error
 if primary is not None or write_error is not None:
  sys.stderr.write(json.dumps({'primaryAuditError':excerpt(primary)if primary is not None else None,'reportWriteError':excerpt(write_error)if write_error is not None else None})+'\n')
if primary is not None or write_error is not None:raise SystemExit(1)
if logical is not None:json.dump(logical,sys.stdout,separators=(',',':'))

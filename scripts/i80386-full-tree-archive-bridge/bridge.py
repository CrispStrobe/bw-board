"""Manufactured TAR-to-writer bridge, not operational admission."""
import bz2,hashlib,time,types
from pathlib import Path
WRITER_SHA='e0a844ce3445b344a02e09ebee02ce8eca4a9ef7afc5a26d741b00902db561a2'
p=Path(__file__).parent.parent/'i80386-full-tree-provisioner'/'provision.py'
with p.open('rb') as f:raw=f.read(65537)
if len(raw)>65536 or hashlib.sha256(raw).hexdigest()!=WRITER_SHA:raise ValueError('writer-seal-refused')
writer=types.ModuleType('bound_full_tree_writer');writer.__file__=str(p)
exec(compile(raw,'<bound-full-tree-writer>','exec'),writer.__dict__)
ROWS=writer.ROWS
PINS=writer.ARCHIVE_PINS
MAX_DECODED=3*1024**3
MAX_MEMBERS=30000
CHUNK=65536
DEADLINE=120
class Refusal(ValueError):pass
def need(ok,why):
 if not ok:raise Refusal(why)
def field(raw):
 end=raw.find(b'\0');end=len(raw) if end<0 else end
 need(not any(raw[end:]) and all(32<=c<127 for c in raw[:end]),'header-name')
 return raw[:end].decode('ascii')
def number(raw):
 need(not raw[0]&128,'header-number');value=raw.strip(b'\0 ')
 need(bool(value) and all(c in b'01234567' for c in value),'header-number');return int(value,8)
def canonical(name,directory=False):
 need(type(name)is str and 0<len(name)<=240,'archive-path')
 if directory and name.endswith('/'):name=name[:-1]
 writer.parts(name);return name
class Decoder:
 def __init__(self,data,check):self.data=data;self.check=check;self.d=bz2.BZ2Decompressor();self.pos=0;self.buffer=b'';self.decoded=0
 def fill(self):
  self.check()
  if self.d.eof:
   need(not self.d.unused_data and self.pos==len(self.data),'compressed-tail');return False
  if self.d.needs_input:
   need(self.pos<len(self.data),'compressed-truncated');block=self.data[self.pos:self.pos+CHUNK];self.pos+=len(block)
  else:block=b''
  out=self.d.decompress(block,max_length=CHUNK);self.check();self.decoded+=len(out);need(self.decoded<=MAX_DECODED,'decoded-cap');self.buffer+=out
  if self.d.eof:need(not self.d.unused_data and self.pos==len(self.data),'compressed-tail')
  return bool(out) or not self.d.eof
 def read(self,n):
  need(type(n)is int and 0<n<=CHUNK,'read-cap')
  while len(self.buffer)<n:
   if not self.fill():break
  out=self.buffer[:n];self.buffer=self.buffer[n:];return out
 def exact(self,n):
  out=self.read(n);need(len(out)==n,'archive-truncated');return out
 def clear(self):self.data=b'';self.buffer=b'';self.d=None
class Bridge:
 def __init__(self,parent):
  # Validate without constructing a writer or performing filesystem work.
  need(type(parent)is str and len(parent)<=4046 and parent.startswith('/') and '\0'not in parent,'parent-shape')
  need(len(parent.encode('utf8'))<=4046,'parent-shape');parts=parent.split('/')[1:]
  need(len(parts)<=30 and all(v not in ('','.','..') for v in parts),'parent-shape')
  self.parent=parent;self.busy=False;self.closed=False;self.entered=False;self.first=None;self.active=None;self.phase='new';self.authenticated=0;self.headers=0;self.gnu=0;self.applied=0;self.pending=False;self.decoded=0;self.reserved=0;self.chunks=0;self.writer_status=None;self.cleanup_refused=False;self.parse_entered=False
 def fail(self,why):
  if self.first is None:self.first=why
 def reentry(self):
  self.fail('bridge-reentry')
  if self.active is not None:self.active._fail('observer-reentry')
 def check(self):
  need(self.first is None,'poisoned');need(time.monotonic()<=self.ends,'deadline')
 def parse(self,data):
  if self.busy and (self.parse_entered or self.phase!='parsing'):
   self.reentry();raise Refusal('bridge-reentry')
  need(self.busy and self.entered and not self.closed and self.phase=='parsing' and self.authenticated==4 and not self.parse_entered,'parser-entry')
  self.check();need(type(data)is bytes,'parser-input');self.parse_entered=True
  need(type(ROWS)is list and len(ROWS)<=1287,'manifest-shape');table={r['path']:r for r in ROWS};need(len(table)==len(ROWS),'manifest-duplicate')
  contents={};seen=set();required=set();pending=None;reader=Decoder(data,self.check);chunk_cap=sum((r['bytes']+CHUNK-1)//CHUNK for r in ROWS if r['type']=='file')
  try:
   while True:
    self.check();header=reader.exact(512)
    if header==bytes(512):
     need(pending is None,'gnu-orphan');need(reader.exact(512)==bytes(512),'end-block')
     while True:
      tail=reader.read(CHUNK);self.check()
      if not tail:break
      need(not any(tail),'trailing-data')
     break
    self.headers+=1;need(self.headers<=MAX_MEMBERS,'member-cap');need(number(header[148:156])==sum(header[:148])+256+sum(header[156:]),'checksum')
    need(header[257:263] in (b'ustar\0',b'ustar '),'magic')
    short=field(header[:100]);prefix=field(header[345:500]);name=prefix+'/'+short if prefix else short;kind=header[156:157];extent=number(header[124:136]);mode=number(header[100:108]);link=field(header[157:257])
    need(not mode&0o6000,'mode')
    if kind==b'L':
     need(pending is None and header[257:263]==b'ustar ' and name=='././@LongLink' and not prefix and not link,'gnu-header');need(2<=extent<=241,'gnu-extent')
     payload=reader.exact(extent);need(payload[-1:]==b'\0' and b'\0'not in payload[:-1] and all(32<=v<127 for v in payload[:-1]),'gnu-payload');pending=payload[:-1].decode('ascii');canonical(pending,directory=pending.endswith('/'))
     need(not any(reader.exact(512-extent%512)),'gnu-padding');self.gnu+=1;self.pending=True;continue
    need(kind in (b'0',b'\0',b'5',b'1'),'type')
    if pending is not None:
     need(not prefix and name==pending[:100],'gnu-placeholder');name=pending;pending=None;self.pending=False;self.applied+=1
    name=canonical(name,kind==b'5');need(name not in seen,'duplicate');need(name in table,'extra-member');row=table[name];expectedtype='directory' if kind==b'5' else ('hardlink' if kind==b'1' else 'file');need(row['type']==expectedtype,'member-type')
    ps=name.split('/');ancestors=['/'.join(ps[:i]) for i in range(1,len(ps))]
    need(all(a not in seen or table[a]['type']=='directory' for a in ancestors),'file-ancestor');need(expectedtype=='directory' or name not in required,'file-ancestor');required.update(ancestors);seen.add(name)
    if expectedtype=='hardlink':
     need(extent==0 and canonical(link)==row['resolved'] and row['resolved'] in contents,'alias-target');continue
    need(not link,'ordinary-link')
    if expectedtype=='directory':need(extent==0,'directory-extent');continue
    need(extent==row['bytes'] and extent<=writer.CONTENT_FILE_CAP,'member-extent');self.reserved+=extent;need(self.reserved<=writer.CONTENT_TOTAL_CAP,'aggregate-cap')
    n=(extent+CHUNK-1)//CHUNK;need(self.chunks+n<=chunk_cap,'chunk-cap');self.chunks+=n;blocks=[];h=hashlib.sha256();remaining=extent
    while remaining:
     self.check();block=reader.exact(min(CHUNK,remaining));self.check();remaining-=len(block);h.update(block);self.check();blocks.append(block)
    need(h.hexdigest()==row['sha256'],'member-hash');contents[name]=blocks
    if extent%512:need(not any(reader.exact(512-extent%512)),'body-padding')
   need(seen==set(table),'missing-member');self.decoded=reader.decoded;return contents
  finally:self.decoded=reader.decoded;reader.clear()
 def provision(self,toolchain,djcrx,djdev,djlsr,notices):
  if self.busy:self.reentry();raise Refusal('bridge-reentry')
  need(not self.entered and not self.closed,'closed-or-consumed');self.entered=True;self.busy=True;self.ends=time.monotonic()+DEADLINE;primary=None
  try:
   for body,(role,extent,digest) in zip((toolchain,djcrx,djdev,djlsr),PINS):
    self.check();need(type(body)is bytes and len(body)==extent,'input-extent');need(hashlib.sha256(body).hexdigest()==digest,'input-hash');self.check();self.authenticated+=1
   need(self.authenticated==4,'input-count');writer.chunks_admit(notices,writer.NOTICES,writer.NOTICE_FILE_CAP,writer.NOTICE_TOTAL_CAP);self.check();self.phase='parsing';contents=self.parse(toolchain);self.check()
   self.active=writer.Provisioner(self.parent);self.check();self.phase='writing';self.active.provision(contents,notices);self.check();self.phase='observed-complete'
  except BaseException as error:self.fail(str(error) if type(error)is Refusal else 'operation-refused');self.phase='refused';primary=error
  finally:
   if self.active is not None:
    try:self.active.close()
    except BaseException:self.cleanup_refused=True;self.fail('cleanup-refused')
    try:self.writer_status=self.active.status()
    except BaseException:self.cleanup_refused=True;self.fail('cleanup-refused')
   self.busy=False;self.closed=True
  if primary is not None:raise primary
  need(self.first is None,'poisoned');return self.status()
 def close(self):
  if self.busy:self.reentry();raise Refusal('bridge-reentry')
  self.closed=True;return self.status()
 def status(self):
  if self.busy:self.reentry()
  return {'schema':'bw.full-tree-archive-bridge.v1','phase':self.phase,'closed':self.closed,'firstFailure':self.first,'authenticatedInputs':self.authenticated,'headers':self.headers,'gnuHeaders':self.gnu,'gnuApplied':self.applied,'gnuPending':self.pending,'decodedBytes':self.decoded,'reservedContentBytes':self.reserved,'cachedChunks':self.chunks,'writerStatus':None if self.writer_status is None else dict(self.writer_status),'bridgeCleanupRefused':self.cleanup_refused,'observedPrototypeComplete':self.phase=='observed-complete' and self.first is None,'opaqueZipSourceJoinsQualified':False,'noticeSourceOwnedQualified':False,'completeNoticesQualified':False,'rawActualArchiveCompatibilityQualified':False,'filesystemLeaseQualified':False,'sourceOwnedQualified':False,'fullToolchainReady':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}

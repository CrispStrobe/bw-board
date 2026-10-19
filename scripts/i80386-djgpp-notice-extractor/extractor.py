"""Manufactured strict ZIP notice policy; no actual compatibility authority."""
import hashlib,struct,zlib,time
PINS=(('toolchain',80596981,'8464f17017d6ab1b2bb2df4ed82357b5bf692e6e2b7fee37e315638f3d505f00'),('djcrx',895256,'22274ed8d5ee57cf7ccf161f5e1684fd1c0192068724a7d34e1bde168041ca60'),('djdev',2509574,'4557dfb6c161d326680ae5fa71f0098ac49425a1b11b90a020b83162eb705dda'),('djlsr',2047171,'80690b6e44ff8bc6c6081fca1f4faeba1591c4490b76ef0ec8b35847baa5deea'))
SELECTED={'copying':(18092,'8177f97513213526df2cf6184d8ff986c675afb514d4e68a404010521b880643'),'copying.dj':(2089,'f7b76a85cfe1407ea99a933699f1b9e79e74b7689cf6db9dc7c406f3c02dc884'),'copying.lib':(26530,'dc626520dcd53a22f727af3ee42c770e56c97a64fe3adb063799d8ab032fe551')}
MAX_MEMBERS=30000
MAX_FILE=16777216
MAX_TOTAL=67108864
MAX_RATIO=1000
CHUNK=65536
DEADLINE=120
class Refusal(ValueError):pass
def need(ok,why):
 if not ok:raise Refusal(why)
def canonical(raw,directory):
 need(type(raw)is bytes and 0<len(raw)<=240 and all(32<=c<127 for c in raw),'name-shape');name=raw.decode('ascii')
 if directory:need(name.endswith('/') and not name.endswith('//'),'directory-name');name=name[:-1]
 else:need(not name.endswith('/'),'file-name')
 need(not any(c in name for c in ('\\',':')) and all(c not in ('','.','..') for c in name.split('/')),'name-path');return name
class Extractor:
 def __init__(self):self.busy=False;self.closed=False;self.entered=False;self.parse_entered=False;self.first=None;self.phase='new';self.authenticated=0;self.members=0;self.reserved=0;self.decoded=0;self._selected={};self._facts=[]
 def fail(self,reason):
  if self.first is None:self.first=reason
 def reentry(self):self.fail('extractor-reentry')
 def check(self):
  need(self.first is None,'poisoned');now=time.monotonic();need(self.first is None,'poisoned');need(now<=self.ends,'deadline')
 def _unpack(self,fmt,data,offset):
  self.check();n=struct.calcsize(fmt);self.check();need(0<=offset<=len(data)-n,'structure-truncated');value=struct.unpack_from(fmt,data,offset);self.check();return value
 def parse(self,data):
  if self.busy and (self.parse_entered or self.phase!='parsing'):self.reentry();raise Refusal('extractor-reentry')
  need(self.busy and self.entered and not self.closed and self.phase=='parsing' and self.authenticated==4 and not self.parse_entered,'parser-entry');self.check();need(type(data)is bytes,'parser-input');self.parse_entered=True
  need(len(data)>=22,'eocd');e=self._unpack('<4s4H2LH',data,len(data)-22)
  sig,disk,startdisk,nlocal,count,central_size,central_offset,comment=e
  need(sig==b'PK\x05\x06' and disk==startdisk==0 and nlocal==count and comment==0,'eocd');need(0<count<=MAX_MEMBERS and count!=65535 and central_size!=0xffffffff and central_offset!=0xffffffff,'member-cap');need(central_offset+central_size==len(data)-22,'central-extent')
  rows=[];seen={};required=set();pos=central_offset;local_end=0;selected_names=set()
  # Full central/local topology and all reservations precede body decompression.
  for _ in range(count):
   c=self._unpack('<4s6H3L5H2L',data,pos)
   sig,made,version,flags,method,mtime,mdate,crc,compressed,extent,namelen,extra,comment,disk,internal,external,offset=c
   need(sig==b'PK\x01\x02' and disk==0,'central-header');need(version in (10,20) and flags==0 and method in (0,8),'zip-subset');need(extra==comment==0 and 0<namelen<=240,'central-name-extra');need(compressed!=0xffffffff and extent!=0xffffffff and offset!=0xffffffff,'zip64')
   end=pos+46+namelen;need(end<=central_offset+central_size,'central-extent');namebytes=data[pos+46:end];mode=external>>16;kind=mode&0o170000;directory=namebytes.endswith(b'/')
   need(kind in (0,0o100000,0o040000) and not mode&0o6000 and not (external&0xffff)&~0x37,'member-mode');need((kind!=0o040000 or directory) and (kind!=0o100000 or not directory) and (not external&0x10 or directory),'member-mode');name=canonical(namebytes,directory)
   need(name not in seen,'duplicate');ancestors=['/'.join(name.split('/')[:i]) for i in range(1,len(name.split('/')))]
   need(all(a not in seen or seen[a] for a in ancestors) and (directory or name not in required),'file-ancestor');required.update(ancestors);seen[name]=directory
   need(extent<=MAX_FILE and (extent==0 if directory else True),'member-extent');need(extent<=max(1,compressed)*MAX_RATIO,'ratio');self.reserved+=extent;need(self.reserved<=MAX_TOTAL,'aggregate-cap');need(method!=0 or compressed==extent,'stored-extent')
   need(offset==local_end and offset<central_offset,'local-topology')
   l=self._unpack('<4s5H3L2H',data,offset);lsig,lv,lf,lm,lt,ld,lc,lcompressed,lextent,ln,lextra=l
   need(lsig==b'PK\x03\x04' and (lv,lf,lm,lt,ld,lc,lcompressed,lextent,ln,lextra)==(version,flags,method,mtime,mdate,crc,compressed,extent,namelen,0),'local-central')
   begin=offset+30+namelen;finish=begin+compressed;need(begin<=finish<=central_offset and data[offset+30:begin]==namebytes,'local-name-extent');local_end=finish
   if name in SELECTED:need(not directory and extent==SELECTED[name][0],'selected-extent');selected_names.add(name)
   rows.append((name,directory,method,crc,extent,begin,finish));self.members+=1;pos=end;self.check()
  need(pos==central_offset+central_size and local_end==central_offset,'topology-tail');need(selected_names==set(SELECTED),'selected-set')
  pending={};facts=[]
  for name,directory,method,crc,extent,begin,finish in rows:
   self.check();h=hashlib.sha256();self.check();checksum=0;total=0;blocks=[] if name in SELECTED else None
   def accept(block):
    nonlocal total,checksum
    need(type(block)is bytes and len(block)<=CHUNK,'chunk');total+=len(block);need(total<=extent,'decoded-extent');self.decoded+=len(block);need(self.decoded<=self.reserved,'decoded-cap');checksum=zlib.crc32(block,checksum);self.check();h.update(block);self.check()
    if blocks is not None:blocks.append(block)
   if method==0:
    for p in range(begin,finish,CHUNK):self.check();accept(data[p:min(p+CHUNK,finish)])
   else:
    self.check();decoder=zlib.decompressobj(-15);self.check();cursor=begin
    while cursor<finish:
     self.check();body=data[cursor:min(cursor+CHUNK,finish)];cursor+=len(body)
     while body:
      self.check();block=decoder.decompress(body,min(CHUNK,extent+1-total));self.check();accept(block);body=decoder.unconsumed_tail;self.check()
      unused=decoder.unused_data;self.check();need(not unused,'deflate-tail')
      eof=decoder.eof;self.check()
      if eof:need(not body and cursor==finish,'deflate-tail');break
    eof=decoder.eof;self.check();unused=decoder.unused_data;self.check();unconsumed=decoder.unconsumed_tail;self.check();need(eof and not unused and not unconsumed,'deflate-truncated')
   self.check();need(total==extent and checksum&0xffffffff==crc,'crc-or-extent')
   if blocks is not None:
    digest=h.hexdigest();self.check();need(digest==SELECTED[name][1],'selected-hash');pending[name]=tuple(blocks);facts.append({'role':name,'bytes':total,'sha256':digest})
  self.check();self._selected=pending;self._facts=facts
 def extract(self,toolchain,djcrx,djdev,djlsr):
  if self.busy:self.reentry();raise Refusal('extractor-reentry')
  need(not self.entered and not self.closed,'closed-or-consumed');self.entered=True;self.busy=True
  try:
   self.ends=time.monotonic()+DEADLINE
   for body,(role,extent,digest) in zip((toolchain,djcrx,djdev,djlsr),PINS):
    self.check();need(type(body)is bytes and len(body)==extent,'input-extent');h=hashlib.sha256(body);self.check();observed=h.hexdigest();self.check();need(observed==digest,'input-hash');self.authenticated+=1
   need(self.authenticated==4,'input-count');self.phase='parsing';self.parse(djcrx);self.check();self.phase='observed-complete'
  except BaseException as error:self.fail(str(error) if type(error)is Refusal else 'operation-refused');self.phase='refused';self._selected={};self._facts=[];raise
  finally:self.busy=False;self.closed=True
  return self.status()
 def close(self):
  if self.busy:self.reentry();raise Refusal('extractor-reentry')
  self.closed=True;self._selected={};return self.status()
 def status(self):
  if self.busy:self.reentry()
  return {'schema':'bw.djgpp-notice-extractor.v1','phase':self.phase,'closed':self.closed,'firstFailure':self.first,'authenticatedInputs':self.authenticated,'members':self.members,'reservedDecodedBytes':self.reserved,'decodedBytes':self.decoded,'selectedFacts':[dict(r) for r in self._facts],'observedSyntheticSelectedConsistency':self.phase=='observed-complete' and self.first is None,'opaqueInputSourceJoinsQualified':False,'actualZipCompatibilityQualified':False,'sourceIssuedHandoffQualified':False,'sourceOwnershipQualified':False,'filesystemLeaseQualified':False,'completeNoticeCoverageQualified':False,'legalClearanceQualified':False,'gccNoticesAcquired':False,'compilerQualified':False,'guestQualified':False}

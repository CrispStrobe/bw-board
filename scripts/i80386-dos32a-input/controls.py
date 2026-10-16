#!/usr/bin/env python3
"""Authored bytes and mocked lifecycle controls; no emulator/guest/media access."""
import ast
import copy
import importlib.util
import json
import struct
from pathlib import Path
HERE=Path(__file__).parent

def module(name):
 s=importlib.util.spec_from_file_location(name,HERE/(name+'.py'));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
r=module('reader');b=module('build');passed=0

def check(label,fn):
 global passed
 fn();passed+=1;print('PASS '+label)
def refuses(label,fn):
 def run():
  try:fn()
  except (ValueError,KeyError,TypeError,IndexError):return
  raise AssertionError('accepted '+label)
 check(label,run)
def frame(*lines):
 raw=bytearray(4000)
 for y,line in enumerate(lines):
  for x,c in enumerate(line.ljust(80)):raw[y*160+x*2]=ord(c);raw[y*160+x*2+1]=7
 return bytes(raw)
def region(final=False,key='a',returned=True):
 fat=bytearray(20992);fat[:4]=b'\xf8\xff\xff\xff';root=bytearray(16384);clusters={}
 if final:
  for i,(role,data) in enumerate([('result',bytes.fromhex(r.RESULT[key])),*[(k,v) for k,v in r.EXPECTED.items() if k!='returned' or returned]]):
   cluster=40+i;at=i*32;root[at:at+11]=r.NAMES[role];root[at+11]=32;struct.pack_into('<HI',root,at+26,cluster,len(data));fat[cluster*2:cluster*2+2]=b'\xff\xff';clusters[str(cluster)]=(data+b'\0'*(1024-len(data))).hex()
 return {'fatHex':fat.hex(),'fat2Hex':fat.hex(),'rootHex':root.hex(),'clusters':clusters,'diskSha256':('a' if final else 'b')*64,'diskBytes':10653696}
def target(key):
 steps=[2000000,6000000,8000000,12000000]
 screens=[{'role':role,'step':step,'hex':frame(*lines).hex(),'regions':region(role in ['response','final'],key,role=='final')} for role,step,lines in zip(['boot','ready','response','final'],steps,[['A:\\>'],['BW-LE-INPUT-READY'],['BW-LE-INPUT-CLOSED','A:\\>'],['A:\\>']])]
 w=[{'role':role,'step':step,'linear':65536+off,'cs':35,'eip':65536+off,'cr0':1,'csDefault32':True,'eax':eax} for role,step,off,eax in zip(['entry','read','consumed','computed','closed','exit'],[5000000,5000100,6000001,6000002,6000003,6000004],[0,16,20,60,127,142],[0,0,ord(key),int.from_bytes(bytes.fromhex(r.RESULT[key])[1:],'little'),0,0x4c00])]
 w[0]['payloadHex']=b.build()[0][4096:].hex();w[4]['resultHex']=r.RESULT[key]
 # Independent literal Set1 tables for this fixture, not the reader's encoder.
 codes={'n':49,'c':46,':':39,'\\':43,'r':19,'u':22,'k':37,'e':18,'y':21,'.':52,'b':48,'a':30,'t':20,'v':47,'i':23,'f':33,'\r':28}
 def vector(command):
  out=[]
  for c in command:
   if c==':':out.append(42)
   out.extend([codes[c],codes[c]+128])
   if c==':':out.append(170)
  return out
 events=[]
 for stage,command,start in [('boot','n\r',0),('client','c:\\runkey.bat\r',2000000),('response',key,6000000),('shell','c:\\verify.bat\r',8000000)]:
  events.extend({'stage':stage,'step':start+i*65536,'scan':code,'accepted':True} for i,code in enumerate(vector(command)))
 return {'schema':'bw.le-key.target.v1','key':key,'firstFailure':None,'stage':'done','pending':0,'ordinaryStep':True,'steps':13000000,'clientSha256':r.CLIENT,'final':{'shutdown':False},'screens':screens,'witnesses':w,'events':events}
def oracle(key):
 screens=[];raws={}
 for i,(role,lines) in enumerate([('boot',['A:\\>']),('ready',['BW-LE-INPUT-READY']),('response',['BW-LE-INPUT-CLOSED','A:\\>']),('final',['A:\\>'])]):
  raw=frame(*lines);name='vga-'+role+'.bin';raws[name]=raw;screens.append({'regions':region(role in ['response','final'],key,role=='final'),'role':role,'elapsedNs':(i+1)*100,'file':name,'sha256':r.SHA(raw),'rows':r.text(raw)})
 return {'schema':'bw.le-key.oracle.v1','key':key,'firstFailure':None,'exitCode':0,'reaped':True,'groupEmpty':True,'command':['qemu','-accel','tcg','-machine','pc','-cpu','486','-m','4','-display','none'],'screens':screens,'events':[{'role':role,'elapsedNs':t,'completedElapsedNs':t+1,'textHex':command.encode().hex(),'qcodes':[[{'\\':'backslash','.':'dot','\r':'ret'}.get(c,c)] if c!=':' else ['shift','semicolon'] for c in command]} for role,t,command in [('decline',10,'n\r'),('run',150,'c:\\runkey.bat\r'),('challenge',250,key),('verify',350,'c:\\verify.bat\r')]]},raws

def test_build():
 raw,meta=b.build();assert r.SHA(raw)==r.CLIENT and len(raw)==8192
 assert raw[:2]==b'LE' and struct.unpack_from('<I',raw,0xb0)[0]==0x2007
 code=raw[4096:];assert code[:6]==b'\xe8\0\0\0\0\x5d' and code[16:20]==b'\xb4\x08\xcd\x21'
 assert code[20:23]==b'\x0f\xb6\xc0' and code[49:60]==b'\x69\xc0\x01\x01\x01\x01\x35\x5a\x5a\x5a\x5a'
 assert code[60:63]==b'\x89\x46\x01' and code[137:144]==b'\xb8\0\x4c\0\0\xcd\x21'
 assert code[165:185]==b'BW-LE-INPUT-READY\r\n$' and code[225:239]==b'C:\\RESULT.BIN\0'
 for key,golden in [('a','613b3b3b3b'),('b','6238383838')]:assert (bytes([ord(key)])+struct.pack('<I',(ord(key)*16843009)^1515870810)).hex()==golden
 # Every near condition targets fail/close_fail within owned code, not arbitrary data.
 for i in range(meta['codeBytes']-5):
  if code[i:i+2] in [b'\x0f\x82',b'\x0f\x87',b'\x0f\x85']:
   assert i+6+struct.unpack_from('<i',code,i+2)[0] in [144,148]
check('independent LE/opcode/flags/branch/arithmetic goldens',test_build)
check('initial absent',lambda:r.region_files(region()))
for key in 'ab':
 check('file golden '+key,lambda key=key:r.need(r.region_files(region(True,key))['result'].hex()==r.RESULT[key],'golden'))
 check('target positive '+key,lambda key=key:r.target(target(key),key))
 o,raws=oracle(key);check('oracle positive '+key,lambda o=o,raws=raws,key=key:r.oracle(o,key,raws))
for label,mutate in [
 ('wrong input consumed',lambda x:x['witnesses'][2].update(eax=ord('b'))),
 ('wrong arithmetic',lambda x:x['witnesses'][3].update(eax=0)),
 ('wrong store',lambda x:x['witnesses'][4].update(resultHex=r.RESULT['b'])),
 ('wrong CS mode',lambda x:x['witnesses'][2].update(csDefault32=False)),
 ('wrong linear PC',lambda x:x['witnesses'][2].update(linear=1)),
 ('pre-ready hardware',lambda x:x['events'][0].update(step=1)),
 ('missing key release',lambda x:x['events'].pop()),
 ('wrong key release',lambda x:next(e for e in x['events'] if e['stage']=='response' and e['scan']>127).update(scan=0xb0)),
 ('consume before readiness',lambda x:x['witnesses'][2].update(step=5500000)),
 ('nonzero DOS exit',lambda x:x['witnesses'][5].update(eax=0x4c01)),
 ('CPU shutdown',lambda x:x['final'].update(shutdown=True)),
 ('incomplete stage',lambda x:x.update(stage='response')),
 ('missing current prompt',lambda x:x['screens'][2].update(hex=frame('BW-LE-INPUT-CLOSED').hex())),
 ('echo is not readiness',lambda x:x['screens'][1].update(hex=frame('A:\\>echo BW-LE-INPUT-READY').hex()))]:
 x=target('a');mutate(x);refuses(label,lambda x=x:r.target(x,'a'))
for label,mutate in [('bad EOC',lambda x:x.update(fatHex=(bytes.fromhex(x['fatHex'])[:80]+b'\x02\0'+bytes.fromhex(x['fatHex'])[82:]).hex())),('missing cluster',lambda x:x['clusters'].clear()),('extra cluster/media',lambda x:x['clusters'].update({'90':'00'*1024})),('wrong disk size',lambda x:x.update(diskBytes=1024))]:
 x=region(True);mutate(x);refuses(label,lambda x=x:r.region_files(x))
for raw in [b'{"a":1,"a":2}',b'{"x":NaN}',b'{"x":1e999}',b'['*30+b'0'+b']'*30]:refuses('JSON refuse '+raw[:20].decode(),lambda raw=raw:r.decode(raw))
# No producer/emulator imports in the standalone original reader.
check('reader dependency boundary',lambda:r.need(all((isinstance(n,ast.Import) and all(a.name in ['argparse','hashlib','json','math','re','io','zipfile','stat'] for a in n.names)) or (isinstance(n,ast.ImportFrom) and n.module=='pathlib') for n in ast.walk(ast.parse((HERE/'reader.py').read_text())) if isinstance(n,(ast.Import,ast.ImportFrom))),'dependency'))
print('PASS groups='+str(passed))
# Additional semantic cuts update the actual original regions, not their hash only.
x=region(True);x['fat2Hex']='00'*20992;refuses('independent second FAT mismatch',lambda:r.region_files(x))
x=region(True);root=bytearray.fromhex(x['rootHex']);at=3*32;root[at:at+11]=b'DOS32A  EXE';root[at+11]=32;struct.pack_into('<HI',root,at+26,40,5);x['rootHex']=root.hex();refuses('selected cluster aliases foreign EOC',lambda:r.region_files(x))
x=target('a');x['screens'][1]['regions']=region(True);refuses('preexisting result at READY',lambda:r.target(x,'a'))
x=target('a');x['screens'][2]['regions']=region(True);refuses('return preexists VERIFY',lambda:r.target(x,'a'))
x=target('a');next(e for e in x['events'] if e['stage']=='shell').update(scan=18);refuses('VERIFY hardware substitution',lambda:r.target(x,'a'))
x=target('a');next(e for e in x['events'] if e['stage']=='client').update(scan=18);refuses('launch hardware substitution',lambda:r.target(x,'a'))
x=target('a');x['witnesses'][0]['payloadHex']='00'*4096;refuses('common prefix cannot stand for owned payload',lambda:r.target(x,'a'))
x=target('a');x['witnesses'][2]['cr0']=True;refuses('boolean CPU register',lambda:r.target(x,'a'))
x=target('a');x['steps']=True;refuses('boolean step counter',lambda:r.target(x,'a'))
x=target('a');idx=next(i for i,e in enumerate(x['events']) if e['stage']=='response');retry={**x['events'][idx],'accepted':False};
for e in x['events']:
 if e['stage']=='response':e['step']+=1
for w in x['witnesses']:
 if w['role'] in ['consumed','computed','closed','exit']:w['step']+=1
x['events'].insert(idx,retry);check('refused attempt retries same key without consuming gap',lambda:r.target(x,'a'))
resource={'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','memory.events':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0','affinity':[0],'cgroup':'/authored'}
check('resource profile positive',lambda:r.resource_interval(resource,copy.deepcopy(resource)))
for label,change in [('wrong quota',lambda x:x.update({'cpu.max':'200000 100000'})),('swap allowed',lambda x:x.update({'memory.swap.max':'1'})),('two CPUs',lambda x:x.update(affinity=[0,1])),('between-case OOM',lambda x:x.update({'memory.events':x['memory.events'].replace('oom 0','oom 1')}))]:
 x=copy.deepcopy(resource);change(x);refuses(label,lambda x=x:r.resource_interval(resource,x))
# Invoke actual owner lifecycle with entirely mocked process/resource primitives.
from unittest.mock import patch
from types import SimpleNamespace
import tempfile
s=module('source')
def child_failure():
 proc=SimpleNamespace(pid=71,returncode=None);calls=[]
 with tempfile.TemporaryDirectory() as tmp,patch.object(s,'resource_state',side_effect=[resource,ValueError('later resource refusal')]),patch.object(s.subprocess,'Popen',return_value=proc),patch.object(s.os,'waitid',return_value=True),patch.object(s.os,'wait4',return_value=(71,256,SimpleNamespace(ru_utime=0,ru_stime=0))),patch.object(s,'group_members',side_effect=[[71],[]]):
  try:s.child(['authored'],Path(tmp))
  except ValueError as e:assert str(e)=='child exit 1'
  else:raise AssertionError('nonzero accepted')
  record=json.loads((Path(tmp)/'process.json').read_text());assert record['firstFailure']=='child exit 1' and record['secondary']==['later resource refusal'] and record['reaped'] and record['groupEmpty']
check('actual controller nonzero survives later resource refusal',child_failure)
print('FINAL PASS groups='+str(passed))

# Exact public DOS/32 Advanced license text, retained as a notice fixture only.
# https://raw.githubusercontent.com/amindlost/dos32a/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc/license
import base64
import io
import zipfile
LICENSE_TEXT=base64.b64decode('RE9TLzMyIEFkdmFuY2VkIERPUyBFeHRlbmRlciBTb2Z0d2FyZSBMaWNlbnNlCj09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQoKQ29weXJpZ2h0IChDKSAxOTk2LTIwMDYgYnkgTmFyZWNoIEsuIEFsbCByaWdodHMgcmVzZXJ2ZWQuCgpSZWRpc3RyaWJ1dGlvbiAgYW5kICB1c2UgIGluIHNvdXJjZSBhbmQgIGJpbmFyeSAgZm9ybXMsIHdpdGggb3Igd2l0aG91dAptb2RpZmljYXRpb24sICBhcmUgcGVybWl0dGVkIHByb3ZpZGVkIHRoYXQgdGhlIGZvbGxvd2luZyBjb25kaXRpb25zIGFyZQptZXQ6CgoxLiAgUmVkaXN0cmlidXRpb25zICBvZiAgc291cmNlIGNvZGUgIG11c3QgIHJldGFpbiAgdGhlIGFib3ZlIGNvcHlyaWdodApub3RpY2UsIHRoaXMgbGlzdCBvZiBjb25kaXRpb25zIGFuZCB0aGUgZm9sbG93aW5nIGRpc2NsYWltZXIuCgoyLiAgUmVkaXN0cmlidXRpb25zICBpbiBiaW5hcnkgZm9ybSAgbXVzdCByZXByb2R1Y2UgdGhlIGFib3ZlIGNvcHlyaWdodApub3RpY2UsICB0aGlzICBsaXN0IG9mIGNvbmRpdGlvbnMgYW5kICB0aGUgIGZvbGxvd2luZyBkaXNjbGFpbWVyIGluIHRoZQpkb2N1bWVudGF0aW9uIGFuZC9vciBvdGhlciBtYXRlcmlhbHMgcHJvdmlkZWQgd2l0aCB0aGUgZGlzdHJpYnV0aW9uLgoKMy4gVGhlIGVuZC11c2VyIGRvY3VtZW50YXRpb24gaW5jbHVkZWQgd2l0aCB0aGUgcmVkaXN0cmlidXRpb24sIGlmIGFueSwKbXVzdCBpbmNsdWRlIHRoZSBmb2xsb3dpbmcgYWNrbm93bGVkZ21lbnQ6CgoiVGhpcyBwcm9kdWN0IHVzZXMgRE9TLzMyIEFkdmFuY2VkIERPUyBFeHRlbmRlciB0ZWNobm9sb2d5LiIKCkFsdGVybmF0ZWx5LCAgdGhpcyBhY2tub3dsZWRnbWVudCBtYXkgYXBwZWFyIGluIHRoZSBzb2Z0d2FyZSBpdHNlbGYsIGlmCmFuZCB3aGVyZXZlciBzdWNoIHRoaXJkLXBhcnR5IGFja25vd2xlZGdtZW50cyBub3JtYWxseSBhcHBlYXIuCgo0LiAgUHJvZHVjdHMgZGVyaXZlZCBmcm9tIHRoaXMgc29mdHdhcmUgIG1heSBub3QgYmUgY2FsbGVkICJET1MvMzJBIiBvcgoiRE9TLzMyIEFkdmFuY2VkIi4KClRISVMgIFNPRlRXQVJFIEFORCBET0NVTUVOVEFUSU9OIElTIFBST1ZJREVEICAiQVMgSVMiIEFORCBBTlkgRVhQUkVTU0VECk9SICBJTVBMSUVEICBXQVJSQU5USUVTLCAgSU5DTFVESU5HLCBCVVQgIE5PVCAgTElNSVRFRCAgVE8sIFRIRSBJTVBMSUVECldBUlJBTlRJRVMgIE9GIE1FUkNIQU5UQUJJTElUWSBBTkQgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQVJFCkRJU0NMQUlNRUQuICBJTiAgTk8gIEVWRU5UIFNIQUxMIFRIRSAgQVVUSE9SUyAgT1IgIENPUFlSSUdIVCBIT0xERVJTIEJFCkxJQUJMRSAgRk9SICBBTlkgRElSRUNULCBJTkRJUkVDVCwgIElOQ0lERU5UQUwsICBTUEVDSUFMLCBFWEVNUExBUlksIE9SCkNPTlNFUVVFTlRJQUwgIERBTUFHRVMgIChJTkNMVURJTkcsIEJVVCBOT1QgIExJTUlURUQgVE8sIFBST0NVUkVNRU5UIE9GClNVQlNUSVRVVEUgIEdPT0RTICBPUiAgU0VSVklDRVM7ICBMT1NTIE9GICBVU0UsICBEQVRBLCAgT1IgIFBST0ZJVFM7IE9SCkJVU0lORVNTICBJTlRFUlJVUFRJT04pIEhPV0VWRVIgQ0FVU0VEIEFORCAgT04gQU5ZIFRIRU9SWSBPRiBMSUFCSUxJVFksCldIRVRIRVIgSU4gQ09OVFJBQ1QsIFNUUklDVCBMSUFCSUxJVFksIE9SIFRPUlQgKElOQ0xVRElORyBORUdMSUdFTkNFIE9SCk9USEVSV0lTRSkgIEFSSVNJTkcgSU4gQU5ZIFdBWSBPVVQgT0YgVEhFIFVTRSBPRiBUSElTIFNPRlRXQVJFLCBFVkVOIElGCkFEVklTRUQgT0YgVEhFIFBPU1NJQklMSVRZIE9GIFNVQ0ggREFNQUdFLgoK')
ROOT=HERE.parents[1]
def encoded(obj):return json.dumps(obj,sort_keys=True,separators=(',',':')).encode()
def full_packet():
 packet={};head='a'*40
 files={}
 for p in [*HERE.glob('*.py'),HERE/'probe.mjs',HERE/'README.md',ROOT/'.github/workflows/i80386-dos32a-input.yml',ROOT/'test/i80386-dos32a-input.test.mjs',ROOT/'roms/free-at-bios/LICENSE',ROOT/'roms/free-at-bios/README.md']:
  raw=p.read_bytes();files[str(p.relative_to(ROOT))]={'bytes':len(raw),'sha256':r.SHA(raw)}
 source={'head':head,'files':files,'census':'manufactured selected original fixture; not a genuine Git admission'}
 runtime={name:{'path':'/authored/'+name,'bytes':10,'sha256':'c'*64,'version':'v22.23.3' if name=='node' else 'manufactured'} for name in ['node','python3','git','qemu-system-i386','bios-256k.bin','vgabios-stdvga.bin']}
 packet.update({'source-before.json':encoded(source),'source-after.json':encoded(source),'runtime-before.json':encoded(runtime),'runtime-after.json':encoded(runtime),'client.json':encoded(b.build()[1]),'initial-regions.json':encoded(region()),'DOS32A-LICENSE.txt':LICENSE_TEXT,'DOS32A-ACKNOWLEDGMENT.txt':b'This product uses DOS/32 Advanced DOS Extender technology.\n'})
 for role,n in [('free-bios-LICENSE.txt','LICENSE'),('free-bios-README.txt','README.md')]:packet[role]=(ROOT/'roms/free-at-bios'/n).read_bytes()
 pins={'bios':(65536,'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'),'vga':(38400,'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'),'floppy':(1228800,'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'),'extender':(27504,'d189be603e72f79d3c2f68114eb34d0cab8bd9744ef0f327497d57bcd8e16817'),'license':(1821,'116fded3b2c68e4884dae6cdfe420d5df03807cc2e06bd888a3a74f02e5975b0')}
 packet['input-admission.json']=encoded({k:{'bytes':size,'sha256':digest} for k,(size,digest) in pins.items()})
 for i,(engine,key) in enumerate([('target','a'),('oracle','a'),('target','b'),('oracle','b')]):
  prefix=engine+'-'+key+'/';final=region(True,key);fs=r.region_files(final)
  if engine=='target':report=target(key)
  else:
   report,raws=oracle(key)
   for name,raw in raws.items():packet[prefix+name]=raw
   packet[prefix+'qemu.stdout']=b'';packet[prefix+'qemu.stderr']=b'';report['pid']=800+i
   report['command']=['/authored/qemu-system-i386','-accel','tcg','-machine','pc','-cpu','486','-m','4','-display','none','-nic','none','-bios','/authored/bios-256k.bin','-vga','none','-device','VGA,romfile=/authored/vgabios-stdvga.bin','-no-reboot']
  report.update(initialDiskSha256=region()['diskSha256'],diskSha256=final['diskSha256'],files={k:None if v is None else v.hex() for k,v in fs.items()})
  argv=['/authored/node','--max-old-space-size=512','/authored/source/scripts/i80386-dos32a-input/probe.mjs','target','/authored/input','/authored/out'] if engine=='target' else ['/authored/python3','-B','/authored/source/scripts/i80386-dos32a-input/oracle.py','/authored/input','/authored/out']
  process={'argv':argv,'pid':700+i,'exitCode':0,'reaped':True,'groupEmpty':True,'firstFailure':None,'secondary':[],'wallSeconds':1,'cpuSeconds':.1,'resourceBefore':copy.deepcopy(resource),'resourceAfter':copy.deepcopy(resource)}
  packet.update({prefix+'report.json':encoded(report),prefix+'disk-regions.json':encoded(final),prefix+'process.json':encoded(process),prefix+'stdout':b'',prefix+'stderr':b''})
 return packet,source,runtime

def admission(packet,source,runtime):
 return {'official':{'conclusion':'success','event':'pull_request','eventAction':'labeled','label':'x86-dos32a-input-actual','head':source['head'],'repository':'CrispStrobe/bw-board','enclosingCleanupSuccess':True,'runId':100,'attempt':1,'jobId':200,'jobName':'actual','workflowPath':'.github/workflows/i80386-dos32a-input.yml','workflowSha256':source['files']['.github/workflows/i80386-dos32a-input.yml']['sha256'],'artifactId':300,'artifactBytes':1,'artifactSha256':'0'*64,'requiredSteps':{'Bounded four fresh applications':'success','Owned controller terminal and empty':'success','Retain original evidence':'success'}},'source':copy.deepcopy(source),'runtime':copy.deepcopy(runtime),'roles':{n:{'bytes':len(raw),'sha256':r.SHA(raw)} for n,raw in packet.items()}}
def archive(packet,external,extra=None):
 stream=io.BytesIO()
 with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED) as z:
  for name,body in packet.items():z.writestr(name,body)
  if extra is not None:z.writestr(extra[0],extra[1])
 raw=stream.getvalue();external['official']['artifactBytes']=len(raw);external['official']['artifactSha256']=r.SHA(raw);return raw

def complete_positive():
 packet,source,runtime=full_packet();external=admission(packet,source,runtime)
 assert r.audit(packet)['finiteKeyboardApplicationPass'] is False
 assert r.audit(packet,external)['finiteKeyboardApplicationPass'] is True
 assert r.verify_artifact(archive(packet,external),external)['finiteKeyboardApplicationPass'] is True
check('complete manufactured audit and authentic ZIP positive',complete_positive)

def packet_cut(label,mutate):
 packet,source,runtime=full_packet();mutate(packet)
 external=admission(packet,source,runtime);raw=archive(packet,external)
 refuses(label,lambda:r.verify_artifact(raw,external))
def change_json(packet,name,mutate):
 obj=json.loads(packet[name]);mutate(obj);packet[name]=encoded(obj)
packet_cut('rehashed complete wrong AL consumption',lambda p:change_json(p,'target-a/report.json',lambda x:x['witnesses'][2].update(eax=98)))
packet_cut('rehashed complete pre-VERIFY return',lambda p:change_json(p,'target-a/report.json',lambda x:x['screens'][2].update(regions=region(True))))
packet_cut('rehashed complete substituted QMP command',lambda p:change_json(p,'oracle-a/report.json',lambda x:next(e for e in x['events'] if e['role']=='run').update(textHex=b'echo wrong\r'.hex())))
packet_cut('rehashed complete missing QEMU group cleanup',lambda p:change_json(p,'oracle-a/report.json',lambda x:x.update(groupEmpty=False)))
def gap_oom(packet):
 def bump(x):
  for side in ['resourceBefore','resourceAfter']:x[side]['memory.events']=x[side]['memory.events'].replace('oom 0','oom 1')
 change_json(packet,'oracle-a/process.json',bump)
packet_cut('rehashed complete between-case OOM',gap_oom)
packet_cut('rehashed complete wrong source after',lambda p:change_json(p,'source-after.json',lambda x:x.update(head='b'*40)))
packet_cut('rehashed complete missing original stderr',lambda p:p.pop('target-a/stderr'))
packet_cut('rehashed complete unexpected stderr',lambda p:p.update({'oracle-b/qemu.stderr':b'failure'}))
packet_cut('rehashed complete extra role',lambda p:p.update({'extra':b'not admitted'}))
packet_cut('rehashed complete duplicate JSON',lambda p:p.update({'target-a/report.json':b'{"x":1,"x":2}'}))
packet_cut('rehashed complete nonfinite JSON exponent',lambda p:p.update({'target-a/report.json':b'{"x":1e999}'}))
for label,mutate in [('official failure',lambda x:x['official'].update(conclusion='failure')),('official repeated attempt',lambda x:x['official'].update(attempt=2)),('official cleanup failed',lambda x:x['official'].update(enclosingCleanupSuccess=False)),('official wrong workflow',lambda x:x['official'].update(workflowSha256='d'*64))]:
 packet,source,runtime=full_packet();external=admission(packet,source,runtime);raw=archive(packet,external);mutate(external);refuses(label,lambda raw=raw,external=external:r.verify_artifact(raw,external))
packet,source,runtime=full_packet();external=admission(packet,source,runtime);raw=archive(packet,external,('extra',b'x'));refuses('rehashed ZIP extra role',lambda:r.verify_artifact(raw,external))
print('COMPLETE FINAL PASS groups='+str(passed))

# Execute the exact workflow shell against authored systemctl/cgroup substitutes.
# No sudo, systemctl, controller, guest, network or real cgroup operation runs.
import subprocess
import textwrap
workflow=(ROOT/'.github/workflows/i80386-dos32a-input.yml').read_text()
def workflow_body(name):
 section=workflow.split('      - name: '+name+'\n',1)[1].split('\n      - ',1)[0]
 return textwrap.dedent(section.split('        run: |\n',1)[1])
cleanup=workflow_body('Owned controller terminal and empty')
mock_shell=r'''
sudo() {
  builtin test "$1" = systemctl || return 91
  shift
  case "$1" in
    list-units)
      builtin test "$MODE" != list-error || return 92
      if builtin test "$MODE" != collected; then printf '%s loaded active\n' "$unit.service"; fi ;;
    show)
      builtin test "$MODE" != show-error || return 93
      if builtin test -f "$RUNNER_TEMP/mock-stopped"; then
        builtin test "$MODE" != after-show-error || return 94
        printf 'Id=%s.service\nMainPID=%s\nActiveState=%s\n' "$unit" "$MOCK_PID" "$MOCK_STATE"
      else
        printf 'Id=%s.service\nControlGroup=%s\n' "$MOCK_ID" "$MOCK_GROUP"
      fi ;;
    stop)
      builtin test "$MODE" != stop-error || return 95
      command touch "$RUNNER_TEMP/mock-stopped" ;;
    *) return 96 ;;
  esac
}
test() {
  if builtin test "$#" = 2 && builtin test "$1" = -d && [[ "$2" = /sys/fs/cgroup/* ]]; then return 0; fi
  builtin test "$@"
}
cat() {
  [[ "$1" = /sys/fs/cgroup/*/cgroup.procs ]] || return 97
  builtin test "$MODE" != cgroup-read-error || return 98
  if builtin test "$MODE" = nonempty; then printf '123\n'; fi
}
'''
def shell_cleanup(mode,requested=True,waited=True,body=cleanup):
 with tempfile.TemporaryDirectory() as tmp:
  path=Path(tmp)
  if requested:(path/'le-key-unit-requested').touch()
  if waited:(path/'le-key-unit-waited').write_text('0\n')
  env={'PATH':'/usr/bin:/bin','RUNNER_TEMP':tmp,'GITHUB_RUN_ID':'100','GITHUB_RUN_ATTEMPT':'1','MODE':mode,'MOCK_ID':'other' if mode=='wrong-id' else 'bw-le-key-100-1','MOCK_GROUP':'/other' if mode=='wrong-group' else '/system.slice/bw-le-key-100-1.service','MOCK_PID':'1' if mode=='live-pid' else '0','MOCK_STATE':'active' if mode=='active-state' else 'inactive'}
  return subprocess.run(['/bin/bash','-c',mock_shell+'\n'+body],env=env,capture_output=True,timeout=2)
for mode,requested,waited in [('live',True,True),('collected',True,True),('live',False,False)]:
 check('exact cleanup shell positive '+mode+' requested='+str(requested),lambda mode=mode,requested=requested,waited=waited:r.need(shell_cleanup(mode,requested,waited).returncode==0,'mock cleanup positive'))
for mode in ['list-error','show-error','after-show-error','wrong-id','wrong-group','stop-error','cgroup-read-error','nonempty','live-pid','active-state']:
 check('exact cleanup shell refuses '+mode,lambda mode=mode:r.need(shell_cleanup(mode).returncode!=0,'mock cleanup fail closed'))
check('collected unit requires completed wait',lambda:r.need(shell_cleanup('collected',waited=False).returncode!=0,'missing wait'))
def cgroup_read_mutant():
 old=cleanup.replace('MEMBERS=$(cat "$CG/cgroup.procs")\n  test -z "$MEMBERS"','test -z "$(cat "$CG/cgroup.procs")"')
 assert old!=cleanup and shell_cleanup('cgroup-read-error',body=old).returncode==0
check('cleanup semantic mutation exposes swallowed cgroup read error',cgroup_read_mutant)
def attempt_guards():
 assert 'github.run_attempt == 1' in workflow.split('  actual:',1)[1].split('    runs-on:',1)[0]
 for name,cut in [('Fixed component acquisition and source admission','test "$(git rev-parse HEAD)"'),('Bounded four fresh applications','touch "$RUNNER_TEMP/le-key-unit-requested"')]:
  prefix=workflow_body(name).split(cut,1)[0]
  assert 'test "$GITHUB_RUN_ATTEMPT" = 1' in prefix
  for attempt in ['1','2']:
   result=subprocess.run(['/bin/bash','-c',prefix+'\nprintf reached'],env={'PATH':'/usr/bin:/bin','GITHUB_RUN_ID':'100','GITHUB_RUN_ATTEMPT':attempt},capture_output=True,timeout=2)
   assert (result.returncode==0)==(attempt=='1') and (result.stdout==b'reached')==(attempt=='1')
check('actual job and both prelaunch shells refuse repeated attempt',attempt_guards)
print('WORKFLOW FINAL PASS groups='+str(passed))

# A deleted current foreign root entry does not make its initial data publishable.
def initially_foreign(packet):
 initial=json.loads(packet['initial-regions.json']);fat=bytearray.fromhex(initial['fatHex']);root=bytearray.fromhex(initial['rootHex'])
 root[:11]=b'DOS32A  EXE';root[11]=32;struct.pack_into('<HI',root,26,2,5);fat[4:6]=b'\xff\xff'
 initial.update(rootHex=root.hex(),fatHex=fat.hex(),fat2Hex=fat.hex());packet['initial-regions.json']=encoded(initial)
def reuse_initial_cluster(cut,row_index=0):
 root=bytearray.fromhex(cut['rootHex']);fat=bytearray.fromhex(cut['fatHex']);at=row_index*32
 old=struct.unpack_from('<H',root,at+26)[0];cut['clusters']['2']=cut['clusters'].pop(str(old))
 struct.pack_into('<H',root,at+26,2);fat[old*2:old*2+2]=b'\0\0';fat[4:6]=b'\xff\xff'
 cut.update(rootHex=root.hex(),fatHex=fat.hex(),fat2Hex=fat.hex())
def allocated_cut(engine,role):
 packet,source,runtime=full_packet();initially_foreign(packet)
 name=engine+'-a/report.json';report=json.loads(packet[name]);screen=next(x for x in report['screens'] if x['role']==role)
 if not screen['regions']['clusters']:screen['regions']=region(True,'a',False)
 reuse_initial_cluster(screen['regions']);packet[name]=encoded(report)
 external=admission(packet,source,runtime);raw=archive(packet,external)
 try:r.verify_artifact(raw,external)
 except ValueError as e:assert str(e)=='result aliases initial allocated content'
 else:raise AssertionError('accepted initial foreign '+engine+'/'+role)
for engine in ['target','oracle']:
 for role in ['boot','ready','response','final']:
  check('rehashed initially allocated '+engine+' '+role,lambda engine=engine,role=role:allocated_cut(engine,role))
def allocated_final():
 packet,source,runtime=full_packet();initially_foreign(packet);name='target-a/disk-regions.json'
 cut=json.loads(packet[name]);reuse_initial_cluster(cut);packet[name]=encoded(cut)
 external=admission(packet,source,runtime);raw=archive(packet,external)
 try:r.verify_artifact(raw,external)
 except ValueError as e:assert str(e)=='result aliases initial allocated content'
 else:raise AssertionError('accepted initial foreign final disk region')
check('rehashed initially allocated final disk region',allocated_final)
def producer_allocation_guard():
 current=region(True,'a',False);reuse_initial_cluster(current,1)
 frozen=bytearray(20992);frozen[:4]=b'\xf8\xff\xff\xff';frozen[4:6]=b'\xff\xff'
 class AuthoredSnapshot:
  reads=0
  def __len__(self):return 10653696
  def __getitem__(self,key):
   for start,stop,name in [(9216,30208,'fatHex'),(30208,51200,'fat2Hex'),(51200,67584,'rootHex')]:
    if (key.start,key.stop)==(start,stop):return bytes.fromhex(current[name])
   self.reads+=1;raise AssertionError('selected bytes copied before all initial allocations admitted')
 raw=AuthoredSnapshot()
 try:s.regions(raw,bytes(frozen))
 except ValueError as e:assert str(e)=='selected cluster initially allocated' and raw.reads==0
 else:raise AssertionError('producer accepted initially foreign second cluster')
 # A fresh result remains possible; no selected bytes exist in this initial view.
 empty=region();raw_empty=AuthoredSnapshot()
 with patch.object(s,'sha',return_value='b'*64):
  current=empty;assert s.regions(raw_empty,bytes(frozen))['clusters']=={} and raw_empty.reads==0
check('Python producer admits all initial allocations before any selected byte copy',producer_allocation_guard)
def oracle_capture_allocation_guard():
 current=region(True,'a',False);reuse_initial_cluster(current,1)
 frozen=bytearray(20992);frozen[4:6]=b'\xff\xff';original=bytes(frozen)
 class Initial:
  def __getitem__(self,key):assert (key.start,key.stop)==(9216,30208);return frozen
 class Current:
  reads=0
  def __len__(self):return 10653696
  def __getitem__(self,key):
   for a,z,name in [(9216,30208,'fatHex'),(30208,51200,'fat2Hex'),(51200,67584,'rootHex')]:
    if (key.start,key.stop)==(a,z):return bytes.fromhex(current[name])
   self.reads+=1;raise AssertionError('oracle copied selected data before allocation admission')
 raw=Current();tree=ast.parse((HERE/'oracle.py').read_text());run=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run')
 binding=next(n for n in run.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='initial_fat' for t in n.targets))
 capture=next(n for n in ast.walk(run) if isinstance(n,ast.FunctionDef) and n.name=='capture')
 with tempfile.TemporaryDirectory() as tmp:
  namespace={'initial':Initial(),'ensure':lambda:None,'monitor':SimpleNamespace(screen=lambda _: (['authored'],b' '*4000)),'scratch':Path(tmp),'out':Path(tmp),'h':SimpleNamespace(ordinary=lambda *args:raw,GEOMETRY_BYTES=10653696,sha=lambda _:'authored'),'disk':Path('authored'),'report':{'screens':[]},'start':0,'time':SimpleNamespace(monotonic=lambda:1)}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[binding,capture],type_ignores=[])),'actual-oracle-capture','exec'),namespace)
  frozen[4:6]=b'\0\0';assert namespace['initial_fat']==original
  with patch.dict('sys.modules',{'source':s}):
   try:namespace['capture']('response')
   except ValueError as e:assert str(e)=='selected cluster initially allocated' and raw.reads==0
   else:raise AssertionError('oracle accepted initial foreign second cluster')
check('actual oracle capture preserves initial FAT and refuses before selected data',oracle_capture_allocation_guard)
print('ALLOCATION FINAL PASS groups='+str(passed))

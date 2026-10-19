#!/usr/bin/env python3
"""CPU-free authored bytes, mocked source edges and manufactured originals only."""
import ast
import base64
import copy
import hashlib
import importlib.util
import io
import json
import struct
import subprocess
import tempfile
import textwrap
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
HERE=Path(__file__).parent;ROOT=HERE.parents[1]
def module(name):
 spec=importlib.util.spec_from_file_location('file_controls_'+name,HERE/(name+'.py'));result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
r=module('reader');b=module('build');s=module('source');raw,m=b.build();body=raw[4096:]
G=bytes.fromhex('a55aa55a3cc33cc3')
PINS={'bios':'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac','vga':'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1','floppy':'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'}
passed=0
def check(name,fn):
 global passed
 fn();passed+=1;print('PASS '+name)
def refuses(name,fn):
 def run():
  try:fn()
  except (ValueError,KeyError,TypeError,IndexError):return
  raise AssertionError('accepted '+name)
 check(name,run)
def payload(key):return bytes(((37*i+17) if key=='a' else (53*i+167))&255 for i in range(17 if key=='a' else 31))

def proof(key):
 b=payload(key);n=len(b);return b'BWFR1'+bytes([ord(key),n,n,5,0,165])+b+b'\xcc'*(64-n)+b[-5:]+b'\xcc'*11+b'\xcc'*16+G*6

def region(key=None,returned=False):
 fat=bytearray(20992);fat[:4]=bytes.fromhex('f8ffffff');root=bytearray(16384);clusters={}
 if key:
  records=[(b'DATA    BIN',payload(key)),(b'RESULT  BIN',proof(key)),(b'KEYOK   TXT',b'BW-FILE-EXIT-0\r\n')]
  if returned:records.append((b'RETURN  TXT',b'BW-FILE-SHELL-RETURN\r\n'))
  for i,(name,b) in enumerate(records):
   cluster=40+i;root[i*32:i*32+11]=name;root[i*32+11]=32;struct.pack_into('<HI',root,i*32+26,cluster,len(b));fat[cluster*2:cluster*2+2]=b'\xff\xff';clusters[str(cluster)]=(b+b'\0'*(1024-len(b))).hex()
 return {'fatHex':fat.hex(),'fat2Hex':fat.hex(),'rootHex':root.hex(),'clusters':clusters,'diskSha256':('a' if key else 'b')*64,'diskBytes':10653696}

def screen(*lines):
 raw=bytearray(4000)
 for y,line in enumerate(lines):
  for x,c in enumerate(line):raw[y*160+x*2]=ord(c);raw[y*160+x*2+1]=7
 return raw.hex()

def events():
 table=dict(zip('abcdefghijklmnopqrstuvwxyz',[30,48,46,32,18,33,34,35,23,36,37,38,50,49,24,25,16,19,31,20,22,47,17,45,21,44]));table.update({'\\':43,':':39,'.':52,'\r':28});return table

def target(key):
 w=[];base=65536
 for i,role in enumerate(m['witnessRoles']):
  row={name:0 for name in ['eax','ebx','ecx','edx','esi','edi','ebp','esp','eflags']};row['ebp']=0 if role=='entry' else base+5;row.update(role=role,step=5000000+i if i<2 else 6100000+i*100,linear=base+m['labels'][role],eip=base+m['labels'][role],cr0=1,cs=35,csBase=0,csLimit=0xffffffff,csDefault32=True,ds=43,dsSelector=43,dsBase=0,dsLimit=0xffffffff,dsDefault32=False,codeHex=body[m['labels'][role]:m['labels'][role]+6].hex())
  if role=='entry':row['payloadHex']=body.hex()
  w.append(row)
 by={x['role']:x for x in w};n=len(payload(key));by['input_call']['eax']=0x800;by['input_return'].update(eax=0x800+ord(key),eflags=1)
 for prefix,service,label in [('data_create',0x3c00,'data_path'),('reopen',0x3d00,'data_path'),('proof_create',0x3c00,'proof_path')]:by[prefix+'_call'].update(eax=service,edx=base+m['labels'][label]);by[prefix+'_return']['eax']=5
 for prefix,label,count in [('data_write','payload_'+key,n),('proof_write','proof',155)]:by[prefix+'_call'].update(eax=0x4000,ebx=5,ecx=count,edx=base+m['labels'][label]);by[prefix+'_return']['eax']=count
 for prefix in ['data_close','read_close','proof_close']:by[prefix+'_call'].update(eax=0x3e00,ebx=5)
 for name,label,size,count,returned,post in [('full','full_buffer',64,n,n,payload(key)+b'\xcc'*(64-n)),('short','tail_buffer',16,8,5,payload(key)[-5:]+b'\xcc'*11),('eof','eof_buffer',16,1,0,b'\xcc'*16)]:
  by[name+'_call'].update(eax=0x3f00,ebx=5,ecx=count,edx=base+m['labels'][label]);by[name+'_return']['eax']=returned
  for suffix,data in [('call',b'\xcc'*size),('return',post)]:by[name+'_'+suffix]['buffer']={'linear':base+m['labels'][label],'prefixHex':G.hex(),'dataHex':data.hex(),'suffixHex':G.hex()}
 by['seek_call'].update(eax=0x4200,ebx=5,ecx=0,edx=n-5);by['seek_return'].update(eax=n-5,edx=0)
 by['proof_ready'].update(proofLinear=base+m['labels']['proof'],savedCountsLinear=base+m['labels']['saved_counts'],proofHex=proof(key).hex(),savedCountsHex=struct.pack('<III',n,5,0).hex());by['exit']['eax']=0x4c00
 inputs=[];table=events()
 for stage,command,start in [('boot','n\r',0),('client','c:\\runfile.bat\r',2000000),('response',key,6000000),('shell','c:\\verify.bat\r',8000000)]:
  vector=[]
  for c in command:
   if c==':':vector.append(('shift',42,'make'))
   vector.extend([(c,table[c],'make'),(c,table[c]+128,'break')])
   if c==':':vector.append(('shift',170,'break'))
  inputs.extend({'stage':stage,'step':start+i*65536,'key':c,'scan':code,'phase':phase,'accepted':True} for i,(c,code,phase) in enumerate(vector))
 screens=[{'role':role,'step':step,'hex':screen(*lines),'regions':region(key if role in ['response','final'] else None,role=='final')} for role,step,lines in [('boot',2000000,['A:\\>']),('ready',6000000,['BW-LE-FILE-READY']),('response',8000000,['BW-LE-FILE-CLOSED','A:\\>']),('final',12000000,['A:\\>'])]]
 return {'schema':'bw.le-file.target.v1','key':key,'firstFailure':None,'events':inputs,'witnesses':w,'screens':screens,'stage':'done','steps':13000000,'readyStep':6000000,'pending':0,'files':{},'diskSha256':'a'*64,'initialDiskSha256':'b'*64,'clientSha256':m['sha256'],'inputHashes':PINS,'final':{'eax':0,'cycles':1,'shutdown':False},'ordinaryStep':True}

# Exact retained public DOS/32 Advanced license; notice fixture, no executable.
# https://github.com/amindlost/dos32a/blob/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc/license
LICENSE_TEXT=base64.b64decode('RE9TLzMyIEFkdmFuY2VkIERPUyBFeHRlbmRlciBTb2Z0d2FyZSBMaWNlbnNlCj09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PQoKQ29weXJpZ2h0IChDKSAxOTk2LTIwMDYgYnkgTmFyZWNoIEsuIEFsbCByaWdodHMgcmVzZXJ2ZWQuCgpSZWRpc3RyaWJ1dGlvbiAgYW5kICB1c2UgIGluIHNvdXJjZSBhbmQgIGJpbmFyeSAgZm9ybXMsIHdpdGggb3Igd2l0aG91dAptb2RpZmljYXRpb24sICBhcmUgcGVybWl0dGVkIHByb3ZpZGVkIHRoYXQgdGhlIGZvbGxvd2luZyBjb25kaXRpb25zIGFyZQptZXQ6CgoxLiAgUmVkaXN0cmlidXRpb25zICBvZiAgc291cmNlIGNvZGUgIG11c3QgIHJldGFpbiAgdGhlIGFib3ZlIGNvcHlyaWdodApub3RpY2UsIHRoaXMgbGlzdCBvZiBjb25kaXRpb25zIGFuZCB0aGUgZm9sbG93aW5nIGRpc2NsYWltZXIuCgoyLiAgUmVkaXN0cmlidXRpb25zICBpbiBiaW5hcnkgZm9ybSAgbXVzdCByZXByb2R1Y2UgdGhlIGFib3ZlIGNvcHlyaWdodApub3RpY2UsICB0aGlzICBsaXN0IG9mIGNvbmRpdGlvbnMgYW5kICB0aGUgIGZvbGxvd2luZyBkaXNjbGFpbWVyIGluIHRoZQpkb2N1bWVudGF0aW9uIGFuZC9vciBvdGhlciBtYXRlcmlhbHMgcHJvdmlkZWQgd2l0aCB0aGUgZGlzdHJpYnV0aW9uLgoKMy4gVGhlIGVuZC11c2VyIGRvY3VtZW50YXRpb24gaW5jbHVkZWQgd2l0aCB0aGUgcmVkaXN0cmlidXRpb24sIGlmIGFueSwKbXVzdCBpbmNsdWRlIHRoZSBmb2xsb3dpbmcgYWNrbm93bGVkZ21lbnQ6CgoiVGhpcyBwcm9kdWN0IHVzZXMgRE9TLzMyIEFkdmFuY2VkIERPUyBFeHRlbmRlciB0ZWNobm9sb2d5LiIKCkFsdGVybmF0ZWx5LCAgdGhpcyBhY2tub3dsZWRnbWVudCBtYXkgYXBwZWFyIGluIHRoZSBzb2Z0d2FyZSBpdHNlbGYsIGlmCmFuZCB3aGVyZXZlciBzdWNoIHRoaXJkLXBhcnR5IGFja25vd2xlZGdtZW50cyBub3JtYWxseSBhcHBlYXIuCgo0LiAgUHJvZHVjdHMgZGVyaXZlZCBmcm9tIHRoaXMgc29mdHdhcmUgIG1heSBub3QgYmUgY2FsbGVkICJET1MvMzJBIiBvcgoiRE9TLzMyIEFkdmFuY2VkIi4KClRISVMgIFNPRlRXQVJFIEFORCBET0NVTUVOVEFUSU9OIElTIFBST1ZJREVEICAiQVMgSVMiIEFORCBBTlkgRVhQUkVTU0VECk9SICBJTVBMSUVEICBXQVJSQU5USUVTLCAgSU5DTFVESU5HLCBCVVQgIE5PVCAgTElNSVRFRCAgVE8sIFRIRSBJTVBMSUVECldBUlJBTlRJRVMgIE9GIE1FUkNIQU5UQUJJTElUWSBBTkQgRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQVJFCkRJU0NMQUlNRUQuICBJTiAgTk8gIEVWRU5UIFNIQUxMIFRIRSAgQVVUSE9SUyAgT1IgIENPUFlSSUdIVCBIT0xERVJTIEJFCkxJQUJMRSAgRk9SICBBTlkgRElSRUNULCBJTkRJUkVDVCwgIElOQ0lERU5UQUwsICBTUEVDSUFMLCBFWEVNUExBUlksIE9SCkNPTlNFUVVFTlRJQUwgIERBTUFHRVMgIChJTkNMVURJTkcsIEJVVCBOT1QgIExJTUlURUQgVE8sIFBST0NVUkVNRU5UIE9GClNVQlNUSVRVVEUgIEdPT0RTICBPUiAgU0VSVklDRVM7ICBMT1NTIE9GICBVU0UsICBEQVRBLCAgT1IgIFBST0ZJVFM7IE9SCkJVU0lORVNTICBJTlRFUlJVUFRJT04pIEhPV0VWRVIgQ0FVU0VEIEFORCAgT04gQU5ZIFRIRU9SWSBPRiBMSUFCSUxJVFksCldIRVRIRVIgSU4gQ09OVFJBQ1QsIFNUUklDVCBMSUFCSUxJVFksIE9SIFRPUlQgKElOQ0xVRElORyBORUdMSUdFTkNFIE9SCk9USEVSV0lTRSkgIEFSSVNJTkcgSU4gQU5ZIFdBWSBPVVQgT0YgVEhFIFVTRSBPRiBUSElTIFNPRlRXQVJFLCBFVkVOIElGCkFEVklTRUQgT0YgVEhFIFBPU1NJQklMSVRZIE9GIFNVQ0ggREFNQUdFLgoK')

def encoded(obj):return json.dumps(obj,sort_keys=True,separators=(',',':')).encode()
resource={'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','memory.events':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0','affinity':[0],'cgroup':'/authored'}
def oracle(key):
 screens=[];raws={}
 for i,(role,lines) in enumerate([('boot',['A:\\>']),('ready',['BW-LE-FILE-READY']),('response',['BW-LE-FILE-CLOSED','A:\\>']),('final',['A:\\>'])]):
  raw=bytes.fromhex(screen(*lines));name='vga-'+role+'.bin';raws[name]=raw;screens.append({'regions':region(key if role in ['response','final'] else None,role=='final'),'role':role,'elapsedNs':(i+1)*100,'file':name,'sha256':hashlib.sha256(raw).hexdigest(),'rows':r.text(raw)})
 events=[]
 for role,t,command in [('decline',10,'n\r'),('run',150,'c:\\runfile.bat\r'),('challenge',250,key),('verify',350,'c:\\verify.bat\r')]:
  qcodes=[{':':['shift','semicolon'],'\\':['backslash'],'.':['dot'],'\r':['ret']}.get(c,[c]) for c in command]
  events.append({'role':role,'elapsedNs':t,'completedElapsedNs':t+1,'textHex':command.encode().hex(),'qcodes':qcodes})
 report={'schema':'bw.le-file.oracle.v1','key':key,'profile':'QEMU pc/486 compatibility oracle, independent BIOS/VGA','command':['/authored/qemu-system-i386','-accel','tcg','-machine','pc','-cpu','486','-m','4','-display','none','-nic','none','-bios','/authored/bios-256k.bin','-vga','none','-device','VGA,romfile=/authored/vgabios-stdvga.bin','-no-reboot','-boot','order=a','-drive','file=/authored/floppy.img,if=floppy,index=0,format=raw,readonly=on','-drive','file=/authored/oracle-'+key+'/disk.raw,if=ide,index=0,format=raw,cache=directsync','-qmp','unix:/authored/oracle-'+key+'/scratch/qmp.sock,server=on,wait=off'],'events':events,'screens':screens,'firstFailure':None,'initialDiskSha256':'b'*64,'pid':800,'groupEmpty':True,'exitCode':0,'cpuSeconds':.1,'reaped':True,'files':{},'diskSha256':'a'*64,'elapsedSeconds':1}
 report.update(secondary=[],quitObservation={'kind':'ack','detail':None})
 return report,raws

def full_packet():
 packet={};head='a'*40;files={}
 for p in [*HERE.glob('*.py'),HERE/'probe.mjs',HERE/'README.md',ROOT/'.github/workflows/i80386-dos32a-file-readback.yml',ROOT/'test/i80386-dos32a-file-readback.test.mjs',ROOT/'roms/free-at-bios/LICENSE',ROOT/'roms/free-at-bios/README.md']:
  data=p.read_bytes();files[str(p.relative_to(ROOT))]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 source={'head':head,'files':files,'census':'manufactured selected-source fixture, not genuine Git admission'}
 runtime={name:{'path':'/authored/'+name,'bytes':10,'sha256':'c'*64,'version':'v22.23.3' if name=='node' else 'manufactured'} for name in ['node','python3','git','qemu-system-i386']}
 runtime.update({name:{'path':'/authored/'+name,'bytes':10,'sha256':'c'*64} for name in ['bios-256k.bin','vgabios-stdvga.bin']})
 packet.update({'source-before.json':encoded(source),'source-after.json':encoded(source),'runtime-before.json':encoded(runtime),'runtime-after.json':encoded(runtime),'client.json':encoded(m),'initial-regions.json':encoded(region()),'DOS32A-LICENSE.txt':LICENSE_TEXT,'DOS32A-ACKNOWLEDGMENT.txt':b'This product uses DOS/32 Advanced DOS Extender technology.\n'})
 for role,name in [('free-bios-LICENSE.txt','LICENSE'),('free-bios-README.txt','README.md')]:packet[role]=(ROOT/'roms/free-at-bios'/name).read_bytes()
 pins={'bios':(65536,PINS['bios']),'vga':(38400,PINS['vga']),'floppy':(1228800,PINS['floppy']),'extender':(27504,'d189be603e72f79d3c2f68114eb34d0cab8bd9744ef0f327497d57bcd8e16817'),'license':(1821,'116fded3b2c68e4884dae6cdfe420d5df03807cc2e06bd888a3a74f02e5975b0')}
 packet['input-admission.json']=encoded({k:{'bytes':size,'sha256':digest} for k,(size,digest) in pins.items()})
 for i,(engine,key) in enumerate([('target','a'),('oracle','a'),('target','b'),('oracle','b')]):
  prefix=engine+'-'+key+'/';final=region(key,True);fs=r.region_files(final)
  if engine=='target':report=target(key)
  else:
   report,raws=oracle(key)
   for name,data in raws.items():packet[prefix+name]=data
   packet[prefix+'qemu.stdout']=b'';packet[prefix+'qemu.stderr']=b'';report['pid']=800+i
  report.update(initialDiskSha256=region()['diskSha256'],diskSha256=final['diskSha256'],files={k:None if v is None else v.hex() for k,v in fs.items()})
  argv=['/authored/node','--max-old-space-size=512','/authored/source/scripts/i80386-dos32a-file-readback/probe.mjs','target','/authored/input','/authored/out'] if engine=='target' else ['/authored/python3','-B','/authored/source/scripts/i80386-dos32a-file-readback/oracle.py','/authored/input','/authored/out']
  process={'argv':argv,'pid':700+i,'exitCode':0,'reaped':True,'groupEmpty':True,'firstFailure':None,'secondary':[],'wallSeconds':1,'cpuSeconds':.1,'resourceBefore':copy.deepcopy(resource),'resourceAfter':copy.deepcopy(resource)}
  packet.update({prefix+'report.json':encoded(report),prefix+'disk-regions.json':encoded(final),prefix+'process.json':encoded(process),prefix+'stdout':b'',prefix+'stderr':b''})
 return packet,source,runtime

def admission(packet,source,runtime):
 return {'official':{'conclusion':'success','event':'pull_request','eventAction':'labeled','label':'x86-dos32a-file-readback-actual','head':source['head'],'repository':'CrispStrobe/bw-board','enclosingCleanupSuccess':True,'runId':100,'attempt':1,'jobId':200,'jobName':'actual','workflowPath':'.github/workflows/i80386-dos32a-file-readback.yml','workflowSha256':source['files']['.github/workflows/i80386-dos32a-file-readback.yml']['sha256'],'artifactId':300,'artifactBytes':1,'artifactSha256':'0'*64,'requiredSteps':{'Bounded four fresh applications':'success','Owned controller terminal and empty':'success','Retain original evidence':'success'}},'source':copy.deepcopy(source),'runtime':copy.deepcopy(runtime),'roles':{name:{'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in packet.items()}}
def archive(packet,external,extra=None):
 stream=io.BytesIO()
 with zipfile.ZipFile(stream,'w',compression=zipfile.ZIP_DEFLATED) as z:
  for name,data in packet.items():z.writestr(name,data)
  if extra is not None:z.writestr(extra[0],extra[1])
 data=stream.getvalue();external['official']['artifactBytes']=len(data);external['official']['artifactSha256']=hashlib.sha256(data).hexdigest();return data

def generator_goldens():
 assert len(raw)==8192 and raw[:2]==b'LE' and m['payloadBytes']==1780
 assert hashlib.sha256(raw).hexdigest()=='c4cd62d6e884264f03eda088c826c9158564d2a3c1250120844a2efa1937d1f3'
 assert hashlib.sha256(body).hexdigest()=='97d98fa77248b1f2914f3490dbf064d1664d4a2c3f96349f3c52d23cc5f07787'
 assert struct.unpack_from('<I',raw,0xb0)[0]==0x2007 and struct.unpack_from('<I',raw,0xc8)[0]==0x2003
 for key,digest in [('a','53ed14cbc792e80fe88f2ac9714d997e4cf3a658421b3f2601afd35c1102f7c2'),('b','4376b5d8223e2838c3b6e5a656c7e62563f6a718e1c4dfe776104863f71f70af')]:
  assert len(proof(key))==155 and hashlib.sha256(proof(key)).hexdigest()==digest and r.proof(key)==proof(key)
 assert body[:6]==b'\xe8\0\0\0\0\x5d'
 for role in m['witnessRoles']:
  off=m['labels'][role]
  if role.endswith('_call'):
   assert body[off:off+2]==b'\xcd\x21' and m['labels'][role[:-5]+'_return']==off+2
 for name in ['full','short','eof']:
  at=m['labels'][name+'_return'];assert body[at:at+2]==b'\x0f\x82'
 assert body[m['labels']['input_return']:m['labels']['input_return']+3]==b'\x0f\xb6\xc0'
check('independent client/header/opcode/call adjacency/proof goldens',generator_goldens)
for key in 'ab':
 check('target full/short/EOF positive '+key,lambda key=key:r.target(target(key),key))
 o,raws=oracle(key);check('oracle VGA/QMP/file positive '+key,lambda o=o,raws=raws,key=key:r.oracle(o,key,raws))
def complete_positive():
 packet,source,runtime=full_packet();external=admission(packet,source,runtime)
 assert r.audit(packet)['finiteFileReadbackPass'] is False
 assert r.audit(packet,external)['finiteFileReadbackPass'] is True
 assert r.verify_artifact(archive(packet,external),external)['finiteFileReadbackPass'] is True
check('complete MANUFACTURED audit and authentic ZIP positive; not actual qualification',complete_positive)

def change_json(packet,name,fn):
 value=json.loads(packet[name]);fn(value);packet[name]=encoded(value)
def packet_cut(name,fn):
 packet,source,runtime=full_packet();fn(packet);external=admission(packet,source,runtime);data=archive(packet,external)
 refuses(name,lambda:r.verify_artifact(data,external))
def witness_cut(name,role,fn):
 packet_cut('rehashed '+name,lambda p:change_json(p,'target-a/report.json',lambda x:fn(next(w for w in x['witnesses'] if w['role']==role))))
for name,role,change in [
 ('wrong live reopened handle','full_call',{'ebx':6}),('wrong DOS read service','full_call',{'eax':0x4000}),
 ('wrong seek origin','seek_call',{'eax':0x4201}),('wrong seek requested low offset','seek_call',{'edx':0}),('wrong seek requested high offset','seek_call',{'ecx':1}),
 ('wrong returned seek high half','seek_return',{'edx':65536}),('unchecked high read return bits','full_return',{'eax':65553}),
 ('static lie saved actual count','proof_ready',{'savedCountsHex':'00'*12}),('wrong read-handle close','read_close_call',{'ebx':0}),
 ('wrong original buffer pointer','full_call',{'edx':65536+m['labels']['payload_a']}),('wrong DS bound','full_call',{'dsLimit':10}),
 ('wrong code window','full_call',{'codeHex':'00'*6}),('wrong protected mode','full_call',{'cr0':0}),('wrong CS.D','full_call',{'csDefault32':False}),
 ('wrong proof address','proof_ready',{'proofLinear':65536+m['labels']['proof']+1}),('wrong full read requested count','full_call',{'ecx':18}),
 ('nonzero EOF','eof_return',{'eax':1}),('missing CALL/POP anchor','full_call',{'ebp':0})]:
 witness_cut(name,role,lambda w,change=change:w.update(change))
for name,role,field,data in [('changed full prefix','full_return','prefixHex','00'*8),('changed tail suffix','short_return','suffixHex','00'*8),('static full buffer','full_return','dataHex','00'*64),('EOF modified destination','eof_return','dataHex','00'*16),('unread partial tail changed','short_return','dataHex',payload('a')[-5:].hex()+'00'*11)]:
 witness_cut(name,role,lambda w,field=field,data=data:w['buffer'].update({field:data}))
def header_lie(w):
 data=bytearray.fromhex(w['proofHex']);data[7]=18;w['proofHex']=data.hex()
witness_cut('header versus original full return count mismatch','proof_ready',header_lie)
def compensated_ds(x):
 for w in x['witnesses']:
  w['dsBase']=1
  if w['role'] in ['data_create_call','data_write_call','reopen_call','full_call','short_call','eof_call','proof_create_call','proof_write_call']:w['edx']-=1
packet_cut('rehashed compensating DS base/EDX cannot replace original anchor',lambda p:change_json(p,'target-a/report.json',compensated_ds))
packet_cut('rehashed missing actual read return',lambda p:change_json(p,'target-a/report.json',lambda x:x['witnesses'].pop(12)))
packet_cut('rehashed co-mutated labels do not change fixed pointer identity',lambda p:change_json(p,'client.json',lambda x:x['labels'].update(full_buffer=1)))
packet_cut('rehashed same proof for distinct case',lambda p:change_json(p,'target-b/report.json',lambda x:next(w for w in x['witnesses'] if w['role']=='proof_ready').update(proofHex=proof('a').hex())))
packet_cut('rehashed preexisting READY outputs',lambda p:change_json(p,'target-a/report.json',lambda x:x['screens'][1].update(regions=region('a'))))
packet_cut('rehashed return before VERIFY',lambda p:change_json(p,'target-a/report.json',lambda x:x['screens'][2].update(regions=region('a',True))))
packet_cut('rehashed wrong actual input release',lambda p:change_json(p,'target-a/report.json',lambda x:next(e for e in x['events'] if e['stage']=='response' and e['phase']=='break').update(scan=0xb0)))
packet_cut('rehashed original event phase lie',lambda p:change_json(p,'target-a/report.json',lambda x:x['events'][0].update(phase='break')))
packet_cut('rehashed original QMP command substitution',lambda p:change_json(p,'oracle-a/report.json',lambda x:next(e for e in x['events'] if e['role']=='run').update(textHex=b'echo wrong\r'.hex())))
packet_cut('rehashed QEMU command profile substitution',lambda p:change_json(p,'oracle-a/report.json',lambda x:x['command'].__setitem__(6,'386')))
packet_cut('rehashed QEMU group not empty',lambda p:change_json(p,'oracle-a/report.json',lambda x:x.update(groupEmpty=False)))
packet_cut('rehashed missing original stderr',lambda p:p.pop('target-a/stderr'))
packet_cut('rehashed unexpected original stderr',lambda p:p.update({'oracle-b/qemu.stderr':b'failure'}))
packet_cut('rehashed extra role',lambda p:p.update({'extra':b'not admitted'}))
packet_cut('rehashed source changed after run',lambda p:change_json(p,'source-after.json',lambda x:x.update(head='b'*40)))
packet_cut('rehashed duplicate JSON keys',lambda p:p.update({'target-a/report.json':b'{"x":1,"x":2}'}))
packet_cut('rehashed nonfinite JSON exponent',lambda p:p.update({'target-a/report.json':b'{"x":1e999}'}))
for name,fn in [('official conclusion',lambda x:x['official'].update(conclusion='failure')),('official repeated attempt',lambda x:x['official'].update(attempt=2)),('official cleanup failure',lambda x:x['official'].update(enclosingCleanupSuccess=False)),('official workflow source mismatch',lambda x:x['official'].update(workflowSha256='d'*64))]:
 packet,source,runtime=full_packet();external=admission(packet,source,runtime);data=archive(packet,external);fn(external);refuses(name,lambda:r.verify_artifact(data,external))
packet,source,runtime=full_packet();external=admission(packet,source,runtime);data=archive(packet,external,('extra',b'x'));refuses('rehashed ZIP extra role',lambda:r.verify_artifact(data,external))
print('READER FINAL PASS groups='+str(passed))

# Retained frozen-v1 false accepts: all mutations rehash ZIP and external roles.
packet_cut('rehashed QEMU literal VGA role/file alias',lambda p:change_json(p,'oracle-a/report.json',lambda x:x['screens'][3].update(file='vga-boot.bin')))
def corrupt_final(packet,engine,role):
 def mutate(report):
  region=report['screens'][3]['regions'];cluster='40' if role=='data' else '41';data=bytearray.fromhex(region['clusters'][cluster]);data[0]^=1;region['clusters'][cluster]=data.hex()
 change_json(packet,engine+'-a/report.json',mutate)
packet_cut('rehashed target final screen DATA diverges from good final disk',lambda p:corrupt_final(p,'target','data'))
packet_cut('rehashed QEMU final screen proof diverges from good final disk',lambda p:corrupt_final(p,'oracle','result'))
packet_cut('rehashed QEMU cleanup secondary cannot qualify',lambda p:change_json(p,'oracle-a/report.json',lambda x:x.update(secondary=['hidden cleanup error'])))
packet_cut('rehashed QEMU protocol error cannot be a quit disconnect',lambda p:change_json(p,'oracle-a/report.json',lambda x:x.update(quitObservation={'kind':'disconnect','detail':'QMP command error'})))
packet_cut('rehashed QEMU quit acknowledgement has no error detail',lambda p:change_json(p,'oracle-a/report.json',lambda x:x.update(quitObservation={'kind':'ack','detail':'QMP reply extent'})))
def disconnected_terminal_positive():
 packet,source,runtime=full_packet();change_json(packet,'oracle-a/report.json',lambda x:x.update(quitObservation={'kind':'disconnect','detail':'QMP reply extent'}));external=admission(packet,source,runtime)
 assert r.verify_artifact(archive(packet,external),external)['finiteFileReadbackPass'] is True
check('manufactured quit-disconnect observation requires successful original terminal state',disconnected_terminal_positive)
packet_cut('rehashed disconnect observation cannot hide nonzero exit',lambda p:change_json(p,'oracle-a/report.json',lambda x:x.update(exitCode=1,quitObservation={'kind':'disconnect','detail':'QMP reply extent'})))

def initially_foreign(packet):
 initial=json.loads(packet['initial-regions.json']);fat=bytearray.fromhex(initial['fatHex']);root=bytearray.fromhex(initial['rootHex'])
 root[:11]=b'DOS32A  EXE';root[11]=32;struct.pack_into('<HI',root,26,2,5);fat[4:6]=b'\xff\xff'
 initial.update(rootHex=root.hex(),fatHex=fat.hex(),fat2Hex=fat.hex());packet['initial-regions.json']=encoded(initial)
def reuse_foreign(cut,index=1):
 root=bytearray.fromhex(cut['rootHex']);fat=bytearray.fromhex(cut['fatHex']);at=index*32;old=struct.unpack_from('<H',root,at+26)[0]
 cut['clusters']['2']=cut['clusters'].pop(str(old));struct.pack_into('<H',root,at+26,2);fat[old*2:old*2+2]=b'\0\0';fat[4:6]=b'\xff\xff'
 cut.update(rootHex=root.hex(),fatHex=fat.hex(),fat2Hex=fat.hex())
def foreign_screen(engine,role):
 packet,source,runtime=full_packet();initially_foreign(packet);name=engine+'-a/report.json';report=json.loads(packet[name]);cut=next(x for x in report['screens'] if x['role']==role)
 if not cut['regions']['clusters']:cut['regions']=region('a')
 reuse_foreign(cut['regions']);packet[name]=encoded(report);external=admission(packet,source,runtime);data=archive(packet,external)
 try:r.verify_artifact(data,external)
 except ValueError as e:assert str(e)=='result aliases initial allocated content'
 else:raise AssertionError('initial foreign screen accepted')
for engine in ['target','oracle']:
 for role in ['boot','ready','response','final']:check('rehashed initial foreign '+engine+'/'+role,lambda engine=engine,role=role:foreign_screen(engine,role))
def foreign_final():
 packet,source,runtime=full_packet();initially_foreign(packet);name='target-a/disk-regions.json';cut=json.loads(packet[name]);reuse_foreign(cut);packet[name]=encoded(cut)
 external=admission(packet,source,runtime);data=archive(packet,external)
 try:r.verify_artifact(data,external)
 except ValueError as e:assert str(e)=='result aliases initial allocated content'
 else:raise AssertionError('initial foreign final accepted')
check('rehashed initial foreign final disk region',foreign_final)

def authored_snapshot():
 current=region('a');reuse_foreign(current);frozen=bytearray(20992);frozen[:4]=b'\xf8\xff\xff\xff';frozen[4:6]=b'\xff\xff'
 class Current:
  reads=0
  def __len__(self):return 10653696
  def __getitem__(self,key):
   for a,z,name in [(9216,30208,'fatHex'),(30208,51200,'fat2Hex'),(51200,67584,'rootHex')]:
    if (key.start,key.stop)==(a,z):return bytes.fromhex(current[name])
   self.reads+=1;raise AssertionError('selected bytes copied before all selected allocations admitted')
 return Current(),bytes(frozen)
def all_selected_before_copy():
 current,fat=authored_snapshot()
 try:s.regions(current,fat)
 except ValueError as e:assert str(e)=='selected cluster initially allocated' and current.reads==0
 else:raise AssertionError('foreign second selected result accepted')
 empty=region()
 class Empty:
  def __len__(self):return 10653696
  def __getitem__(self,k):return bytes.fromhex({9216:empty['fatHex'],30208:empty['fat2Hex'],51200:empty['rootHex']}[k.start])
 with patch.object(s,'sha',return_value='authored'):assert s.regions(Empty(),fat)['clusters']=={}
check('Python source all-five selector admits every allocation before any data copy',all_selected_before_copy)
def exact_oracle_capture():
 current,fat=authored_snapshot();frozen=bytearray(fat)
 class Initial:
  def __getitem__(self,k):assert (k.start,k.stop)==(9216,30208);return frozen
 tree=ast.parse((HERE/'oracle.py').read_text());run=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run')
 binding=next(n for n in run.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='initial_fat' for t in n.targets));capture=next(n for n in ast.walk(run) if isinstance(n,ast.FunctionDef) and n.name=='capture')
 with tempfile.TemporaryDirectory() as tmp:
  namespace={'initial':Initial(),'ensure':lambda:None,'monitor':SimpleNamespace(screen=lambda _: (['authored'],b' '*4000)),'scratch':Path(tmp),'out':Path(tmp),'h':SimpleNamespace(ordinary=lambda *args:current,GEOMETRY_BYTES=10653696,sha=lambda _:'authored',root_file=lambda *args:None),'disk':Path('authored'),'report':{'screens':[]},'start':0,'time':SimpleNamespace(monotonic=lambda:1)}
  exec(compile(ast.fix_missing_locations(ast.Module(body=[binding,capture],type_ignores=[])),'actual-oracle-capture','exec'),namespace)
  frozen[4:6]=b'\0\0';assert namespace['initial_fat']==fat
  with patch.dict('sys.modules',{'source':s}):
   try:namespace['capture']('response')
   except ValueError as e:assert str(e)=='selected cluster initially allocated' and current.reads==0
   else:raise AssertionError('oracle copied foreign selected data')
  namespace['h'].root_file=lambda *args:b'BW-FILE-EXIT-1\r\n'
  try:namespace['capture']()
  except ValueError as e:assert str(e)=='QEMU actual guest failure marker'
  else:raise AssertionError('oracle ignored actual failure before READY')
check('exact oracle capture freezes FAT, preadmits all data and fails fast on guest failure',exact_oracle_capture)

def inventory_controls():
 names=[*map(str,[p.relative_to(ROOT) for p in HERE.glob('*') if p.is_file()]),'test/i80386-dos32a-file-readback.test.mjs','.github/workflows/i80386-dos32a-file-readback.yml',*s.PINS,'package.json','roms/free-at-bios/LICENSE','roms/free-at-bios/README.md']
 names=list(dict.fromkeys(names));original={name:(ROOT/name).read_bytes() for name in names};original['src/authored.js']=b'// authored census fixture\n';names.append('src/authored.js');head='a'*40
 with tempfile.TemporaryDirectory() as tmp:
  base=Path(tmp);versions=dict(original)
  for name,data in original.items():p=base/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
  def git(*args):
   if args==('rev-parse','HEAD'):return head.encode()
   if args==('ls-files','-z'):return '\0'.join(names).encode()+b'\0'
   assert args[0]=='show' and args[1].startswith(head+':');return versions[args[1][41:]]
  with patch.object(s,'ROOT',base),patch.object(s,'git',side_effect=git):
   observed=s.inventory(head);assert set(names)==set(observed['files']) and set(s.PINS)<=set(observed['files'])
   for name in s.PINS:
    altered=original[name]+b'x';(base/name).write_bytes(altered);versions[name]=altered
    try:s.inventory(head)
    except ValueError as e:assert str(e)=='immutable helper '+name
    else:raise AssertionError('helper pin drift admitted')
    (base/name).write_bytes(original[name]);versions[name]=original[name]
   name='scripts/i80386-dos32a-file-readback/probe.mjs';(base/name).write_bytes(original[name]+b'x')
   try:s.inventory(head)
   except ValueError as e:assert str(e)=='source drift '+name
   else:raise AssertionError('live/Git drift admitted')
check('new census includes all nine paths/six pins and refuses each immutable drift',inventory_controls)
def held_loader_refusal():
 for what in ['bytes','Git']:
  with patch.object(s.importlib.util,'spec_from_file_location',side_effect=AssertionError('unadmitted helper executed')):
   manager=patch.object(s,'sha',return_value='0'*64) if what=='bytes' else patch.object(s,'git',return_value=b'unreviewed')
   with manager:
    try:s.held()
    except ValueError as e:assert str(e)=='held lifecycle helper'
    else:raise AssertionError('unadmitted helper loaded')
check('held loader refuses wrong bytes/Git before exec or import',held_loader_refusal)

# Entire new run wiring executes against authored files and mocked boundaries.
# No real process, resource observation, media, acquisition or guest is used.
def run_wiring(mode):
 real_sha=lambda data:hashlib.sha256(data).hexdigest();calls=[];source_count=0;runtime_count=0;initial=b'X'+bytes(30207);fat=initial[9216:30208];head='a'*40
 with tempfile.TemporaryDirectory() as tmp:
  base=Path(tmp);inputs={'scratch':str(base/'scratch')};identities={}
  pins=[('bios',65536,PINS['bios']),('vga',38400,PINS['vga']),('floppy',1228800,PINS['floppy']),('extender',27504,'d189be603e72f79d3c2f68114eb34d0cab8bd9744ef0f327497d57bcd8e16817'),('license',1821,'116fded3b2c68e4884dae6cdfe420d5df03807cc2e06bd888a3a74f02e5975b0')]
  for i,(name,size,digest) in enumerate(pins):
   data=bytes([i+1])+bytes(size-1);path=base/name;path.write_bytes(data);inputs[name]=str(path);identities[real_sha(data)]=digest
  def inventory(h):
   nonlocal source_count
   source_count+=1;calls.append('inventory'+str(source_count));assert h==head
   return {'head':'b'*40 if mode=='source-drift' and source_count==2 else head,'files':{},'census':'authored wiring only'}
  def runtime():
   nonlocal runtime_count
   runtime_count+=1;calls.append('runtime'+str(runtime_count));answer={name:{'path':'/authored/'+name} for name in ['node','python3','qemu-system-i386','bios-256k.bin','vgabios-stdvga.bin']}
   if mode=='runtime-drift' and runtime_count==2:answer['node']['path']='changed'
   return answer
  def stage(argv,**kwargs):
   assert argv[2]=='media' and argv[1]==str(ROOT/'scripts/i80386-dos32a-file-readback/probe.mjs');calls.append('stage');Path(argv[-1]).write_bytes(initial)
  final_regions=[]
  def regions(data,initial_fat):
   assert type(initial_fat)is bytes and initial_fat==fat;final_regions.append(data)
   if data!=initial and mode=='child-failure':raise ValueError('later region refusal')
   return {'manufacturedOnly':True}
  def child(argv,out):
   cfg=json.loads(Path(argv[-2]).read_text());work=Path(argv[-1]);engine='target' if argv[2].endswith('probe.mjs') else 'oracle';calls.append((engine,cfg['key']))
   assert argv[0]=='/authored/'+('node' if engine=='target' else 'python3') and argv[1]==('--max-old-space-size=512' if engine=='target' else '-B')
   assert cfg['disk']==str(base/'scratch/initial.raw') and cfg['diskSha256']==real_sha(initial) and cfg['clientSha256']==m['sha256']
   (work/'report.json').write_text('{"manufacturedOnly":true}');(work/'disk.raw').write_bytes(b'authored final observation')
   if mode=='initial-mutation':Path(cfg['disk']).write_bytes(b'Y'+initial[1:])
   if mode.startswith('child-failure'):raise ValueError('original child failure')
   return copy.deepcopy(resource)
  helper=SimpleNamespace(runtime=runtime,resource_state=lambda:copy.deepcopy(resource),no_oom=lambda a,b:r.resource_interval(a,b),child=child)
  original_copy=s.shutil.copyfile
  def copyfile(a,z):
   if mode=='child-failure' and Path(a).name=='report.json':raise OSError('later retention refusal')
   return original_copy(a,z)
  original_write=Path.write_text;original_iter=Path.iterdir
  def write_text(path,*args,**kwargs):
   if mode=='child-failure-write' and path==base/'out/failure.json':raise OSError('later failure receipt refusal')
   return original_write(path,*args,**kwargs)
  def iterdir(path):
   if mode=='child-failure-enumerate' and path==base/'scratch/target-a':raise OSError('later enumeration refusal')
   return original_iter(path)
  with patch.object(s,'inventory',side_effect=inventory),patch.object(s,'held',return_value=helper),patch.object(s,'regions',side_effect=regions),patch.object(s,'sha',side_effect=lambda data:identities.get(real_sha(data),real_sha(data))),patch.object(s.subprocess,'run',side_effect=stage),patch.object(s.shutil,'copyfile',side_effect=copyfile),patch.object(Path,'write_text',write_text),patch.object(Path,'iterdir',iterdir),patch.dict('sys.modules',{'build':b}):
   error=None;caught=None
   try:s.run(inputs,base/'out',head)
   except ValueError as e:error=str(e);caught=e
  executed=[x for x in calls if type(x)is tuple]
  assert calls[:3]==['inventory1','runtime1','stage']
  if mode.startswith('child-failure'):
   assert error=='original child failure' and executed==[('target','a')]
   if mode=='child-failure-write':
    assert not (base/'out/failure.json').exists() and any('later failure receipt refusal' in note for note in caught.__notes__)
   else:
    failed=json.loads((base/'out/failure.json').read_text());assert failed['firstFailure']=='original child failure'
    assert failed['retentionSecondary']==(['output enumeration: later enumeration refusal'] if mode=='child-failure-enumerate' else ['later retention refusal','later region refusal'])
  elif mode=='initial-mutation':assert error=='initial media mutated' and executed==[('target','a')]
  else:
   assert executed==[('target','a'),('oracle','a'),('target','b'),('oracle','b')] and len(final_regions)==5 and source_count==runtime_count==2
   assert error==('source/runtime drift' if mode.endswith('drift') else None)
   for engine,key in executed:assert (base/'out'/f'{engine}-{key}'/'report.json').read_text()=='{"manufacturedOnly":true}'
for mode in ['positive','source-drift','runtime-drift','initial-mutation','child-failure','child-failure-write','child-failure-enumerate']:check('new four-case wiring '+mode,lambda mode=mode:run_wiring(mode))

# Execute the exact workflow shell against authored systemctl/cgroup substitutes.
# No sudo, systemctl, controller, guest, network or real cgroup operation runs.
import subprocess
import textwrap
workflow=(ROOT/'.github/workflows/i80386-dos32a-file-readback.yml').read_text()
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
  if requested:(path/'le-file-unit-requested').touch()
  if waited:(path/'le-file-unit-waited').write_text('0\n')
  env={'PATH':'/usr/bin:/bin','RUNNER_TEMP':tmp,'GITHUB_RUN_ID':'100','GITHUB_RUN_ATTEMPT':'1','MODE':mode,'MOCK_ID':'other' if mode=='wrong-id' else 'bw-le-file-100-1','MOCK_GROUP':'/other' if mode=='wrong-group' else '/system.slice/bw-le-file-100-1.service','MOCK_PID':'1' if mode=='live-pid' else '0','MOCK_STATE':'active' if mode=='active-state' else 'inactive'}
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
 for name,cut in [('Fixed component acquisition and source admission','test "$(git rev-parse HEAD)"'),('Bounded four fresh applications','touch "$RUNNER_TEMP/le-file-unit-requested"')]:
  prefix=workflow_body(name).split(cut,1)[0]
  assert 'test "$GITHUB_RUN_ATTEMPT" = 1' in prefix
  for attempt in ['1','2']:
   result=subprocess.run(['/bin/bash','-c',prefix+'\nprintf reached'],env={'PATH':'/usr/bin:/bin','GITHUB_RUN_ID':'100','GITHUB_RUN_ATTEMPT':attempt},capture_output=True,timeout=2)
   assert (result.returncode==0)==(attempt=='1') and (result.stdout==b'reached')==(attempt=='1')
check('actual job and both prelaunch shells refuse repeated attempt',attempt_guards)
print('WORKFLOW FINAL PASS groups='+str(passed))


# Exercise the exact new oracle run function with in-memory paths and mocked
# QMP, clock, process and kernel edges. This is not a guest or an oracle result.
def oracle_lifecycle(mode):
 tree=ast.parse((HERE/'oracle.py').read_text());fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='run')
 files={};state={'phase':'menu','quit':False,'reaped':False,'clock':0};calls=[]
 first=ValueError('original QMP failure');wait_error=OSError('later wait4 refusal');report_error=OSError('later report refusal')
 class MemoryPath:
  def __init__(self,value):self.value=value.value if isinstance(value,MemoryPath) else str(value)
  def __truediv__(self,name):return MemoryPath(self.value+'/'+str(name))
  def __str__(self):return self.value
  def mkdir(self):calls.append(('mkdir',self.value))
  def exists(self):return self.value.endswith('qmp.sock') or self.value in files
  def open(self,*args):return io.BytesIO()
  def stat(self):return SimpleNamespace(st_size=len(files.get(self.value,b'')))
  def read_bytes(self):return files[self.value]
  def write_bytes(self,data):files[self.value]=bytes(data);return len(data)
  def write_text(self,text):
   if self.value.endswith('/report.json') and mode in ['first-report','report-only']:raise report_error
   files[self.value]=text.encode();return len(text)
 def clock():state['clock']+=100 if mode=='quit-protocol' and state['quit'] else .01;return state['clock']
 def root_file(raw,name):
  if name==b'KEYFAIL TXT':return None
  if state['phase'] not in ['response','final']:return None
  if name==b'RETURN  TXT':return b'mocked return' if state['phase']=='final' else None
  return b'mocked owned bytes'
 class Monitor:
  def screen(self,scratch):
   lines=['Do you want to proceed'] if state['phase']=='menu' else ['BW-LE-FILE-READY'] if state['phase']=='ready' else ['A:\\>']
   return lines,b' '*4000
  def send(self,text):
   calls.append(('input',text));state['phase']={'n\r':'boot','c:\\runfile.bat\r':'ready','a':'response','c:\\verify.bat\r':'final'}[text]
  def call(self,name):
   assert name=='quit';state['quit']=True
   if mode=='quit-protocol':raise first
   if mode=='disconnect-extent':raise ValueError('QMP reply extent')
   if mode=='disconnect-eof':raise EOFError()
   if mode=='disconnect-pipe':raise BrokenPipeError()
   if mode=='disconnect-reset':raise ConnectionResetError()
   if mode=='quit-oserror':raise first
   return {}
  def close(self):
   if mode=='close-only':raise first
 def monitor(path):
  if mode in ['first-wait','first-report']:raise first
  return Monitor()
 def wait4(pid,options):
  calls.append(('wait4',pid))
  if mode=='first-wait':raise wait_error
  state['reaped']=True;return pid,256 if mode=='nonzero' else 0,SimpleNamespace(ru_utime=.1,ru_stime=.1)
 def popen(command,**kwargs):
  assert kwargs['start_new_session'] and kwargs['preexec_fn'] is helper.child_limit
  calls.append(('spawn',command));return SimpleNamespace(pid=123,returncode=None)
 def waitid(*args):return state['quit'] and mode!='quit-protocol'
 helper=SimpleNamespace(ordinary=lambda *args:b'X'+bytes(30207),GEOMETRY_BYTES=10653696,FLOPPY_SHA='authored',sha=lambda data:hashlib.sha256(data).hexdigest(),child_limit=lambda:None,QMP=monitor,root_file=root_file,has_prompt=lambda lines:lines==['A:\\>'],keys=lambda text:[[text]])
 fake_os=SimpleNamespace(P_PID=1,WEXITED=4,WNOHANG=1,WNOWAIT=0x1000000,waitid=waitid,killpg=lambda pid,sig:calls.append(('group signal',pid,sig)),wait4=wait4,waitstatus_to_exitcode=lambda status:status>>8)
 fake_signal=SimpleNamespace(SIGTERM=15,SIGINT=2,SIGKILL=9,SIG_IGN=1,signal=lambda *args:None)
 fake_source=SimpleNamespace(regions=lambda *args:{'manufacturedOnly':True},held=lambda:SimpleNamespace(group_members=lambda pid:[] if state['reaped'] else [pid]))
 namespace={'helper':lambda:helper,'Path':MemoryPath,'json':json,'subprocess':SimpleNamespace(Popen=popen),'os':fake_os,'signal':fake_signal,'time':SimpleNamespace(monotonic=clock,sleep=lambda delay:None)}
 exec(compile(ast.fix_missing_locations(ast.Module(body=[fn],type_ignores=[])),'exact-oracle-run-mocked','exec'),namespace)
 if mode=='quit-protocol':first=ValueError('QMP command error: original quit rejection')
 if mode=='quit-oserror':first=OSError('original quit transport refusal')
 inp={'disk':'initial','diskSha256':'authored','floppy':'floppy','key':'a','qemu':'qemu','oracleBios':{'path':'bios','bytes':1,'sha256':'authored'},'oracleVga':{'path':'vga','bytes':1,'sha256':'authored'}}
 caught=None;result=None
 with patch.dict('sys.modules',{'source':fake_source}):
  try:result=namespace['run'](inp,'out')
  except BaseException as error:caught=error
 saved=json.loads(files['out/report.json']) if 'out/report.json' in files else None
 if mode.startswith('disconnect-') or mode=='positive':
  assert caught is None and result['firstFailure'] is None and result['secondary']==[] and result['exitCode']==0 and result['reaped'] and result['groupEmpty']
  assert result['quitObservation']==({'kind':'ack','detail':None} if mode=='positive' else {'kind':'disconnect','detail':{'disconnect-extent':'QMP reply extent','disconnect-eof':'EOFError','disconnect-pipe':'BrokenPipeError','disconnect-reset':'ConnectionResetError'}[mode]})
  assert [c[1] for c in calls if c[0]=='input']==['n\r','c:\\runfile.bat\r','a','c:\\verify.bat\r']
  assert len([c for c in calls if c[0]=='wait4'])==1
 elif mode in ['first-wait','first-report','quit-protocol','quit-oserror','close-only']:
  assert caught is first,(mode,str(caught))
  if mode=='first-report':assert saved is None and any('report retention' in note for note in caught.__notes__)
  else:
   assert saved['firstFailure']==str(first)
   if mode=='first-wait':assert saved['secondary']==['wait4 cleanup: later wait4 refusal']
 elif mode=='report-only':assert caught is report_error and saved is None
 elif mode=='nonzero':assert isinstance(caught,ValueError) and str(caught)=='QEMU exit' and saved['exitCode']==1
 else:raise AssertionError(mode)
for mode in ['positive','disconnect-extent','disconnect-eof','disconnect-pipe','disconnect-reset','first-wait','first-report','quit-protocol','quit-oserror','close-only','report-only','nonzero']:
 check('exact oracle lifecycle '+mode,lambda mode=mode:oracle_lifecycle(mode))

print("COMPLETE FINAL PASS groups="+str(passed))

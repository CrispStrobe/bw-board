#!/usr/bin/env python3
"""Original-only finite LE keyboard reader. Never imports producers or emulators."""
import argparse
import hashlib
import json
import math
import io
import zipfile
import stat
import re
from pathlib import Path
SHA=lambda b:hashlib.sha256(b).hexdigest()
CLIENT='bedf8a2786c64e01cb8810499d869e9243ad94cc44fe43d3a9fb895afa2e7179'
RESULT={'a':'613b3b3b3b','b':'6238383838'}
NAMES={'result':b'RESULT  BIN','ok':b'KEYOK   TXT','fail':b'KEYFAIL TXT','returned':b'RETURN  TXT'}
EXPECTED={'ok':b'BW-KEY-EXIT-0\r\n','returned':b'BW-KEY-SHELL-RETURN\r\n'}
def need(value,reason):
 if not value:raise ValueError(reason)
def integer(v):return type(v)is int and 0<=v<=2**53-1
def decode(raw):
 need(type(raw)is bytes and len(raw)<=4<<20,'JSON extent')
 def pairs(p):
  d={}
  for k,v in p:need(k not in d,'duplicate key');d[k]=v
  return d
 depth=0;quoted=False;escaped=False
 for c in raw:
  if quoted:
   if escaped:escaped=False
   elif c==92:escaped=True
   elif c==34:quoted=False
  elif c==34:quoted=True
  elif c in (91,123):depth+=1;need(depth<=24,'JSON predecode depth')
  elif c in (93,125):depth-=1;need(depth>=0,'JSON balance')
 need(depth==0 and not quoted,'JSON closure')
 obj=json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError('nonfinite')))
 def walk(x,depth=0):
  need(depth<=24,'JSON depth')
  if type(x)is float:need(math.isfinite(x),'nonfinite')
  if isinstance(x,dict):
   for v in x.values():walk(v,depth+1)
  elif isinstance(x,list):
   need(len(x)<=4096,'JSON array');
   for v in x:walk(v,depth+1)
 walk(obj);return obj

def region_files(region):
 need(set(region)=={'fatHex','fat2Hex','rootHex','clusters','diskSha256','diskBytes'},'region keys')
 need(region['diskBytes']==10653696 and re.fullmatch('[0-9a-f]{64}',region['diskSha256']),'disk shape')
 fat=bytes.fromhex(region['fatHex']);root=bytes.fromhex(region['rootHex']);need(len(fat)==20992 and len(root)==16384,'fixed FAT/root offsets')
 need(bytes.fromhex(region['fat2Hex'])==fat,'independent FAT mirrors')
 need(fat[:4]==b'\xf8\xff\xff\xff','FAT header')
 result={k:None for k in NAMES};clusters=region['clusters'];used=set();names=set();owners={}
 for i in range(512):
  row=root[i*32:(i+1)*32]
  if row[0]==0:break
  if row[0]==229:continue
  need(row[11]==32,'ordinary root files only')
  c=int.from_bytes(row[26:28],'little');n=int.from_bytes(row[28:32],'little');need(n<=32768,'root file cap');chain=set()
  for _ in range((n+1023)//1024):
   need(2<=c<=10339 and c not in chain and c not in owners,'all-root chain ownership')
   chain.add(c);owners[c]=row[:11];c=int.from_bytes(fat[c*2:c*2+2],'little')
  need(not n or c>=65528,'all-root EOC')
 for i in range(512):
  row=root[i*32:(i+1)*32]
  if row[0]==0:break
  if row[0]==0xe5:continue
  name=row[:11];need(name not in names,'duplicate root');names.add(name)
  if name not in NAMES.values():continue
  need(row[11]==0x20,'result attributes');role=next(k for k,v in NAMES.items() if v==name)
  first=int.from_bytes(row[26:28],'little');size=int.from_bytes(row[28:32],'little')
  need(2<=first<=10339 and 1<=size<=1024 and first not in used,'result extent')
  need(int.from_bytes(fat[first*2:first*2+2],'little')>=0xfff8,'single-cluster EOC')
  need(str(first) in clusters,'missing original data cluster');data=bytes.fromhex(clusters[str(first)]);need(len(data)==1024,'cluster extent')
  used.add(first);result[role]=data[:size]
 need(set(clusters)=={str(n) for n in used},'extraneous cluster/media leakage')
 return result

def text(raw):
 need(len(raw)==4000,'VGA extent');return [''.join(chr(c) if 32<=c<=126 else ' ' for c in raw[y*160:(y+1)*160:2]).rstrip() for y in range(25)]
def prompt(lines):return bool(re.fullmatch(r'[A-Z]:\\>\s*',next((x.strip() for x in reversed(lines) if x.strip()),'')))
def screen_roles(report,raws=None):
 screens=report['screens'];need(len(screens)==4,'four original screens');need([x['role'] for x in screens]==['boot','ready','response','final'],'screen roles')
 lines={}
 for s in screens:
  if raws is None:raw=bytes.fromhex(s['hex'])
  else:raw=raws[s['file']];need(SHA(raw)==s['sha256'] and text(raw)==s['rows'],'QEMU raw VGA join')
  lines[s['role']]=text(raw)
 need(any(x.strip()=='BW-LE-INPUT-READY' for x in lines['ready']),'completed readiness')
 for name in ['boot','response','final']:need(prompt(lines[name]),'current shell prompt')
 cuts={s['role']:region_files(s['regions']) for s in screens}
 need(all(v is None for v in cuts['ready'].values()),'ready files absent')
 need(cuts['response']['returned'] is None and cuts['response']['fail'] is None and cuts['response']['ok']==EXPECTED['ok'],'response before separate VERIFY')
 need(cuts['final']['returned']==EXPECTED['returned'],'final shell file')
 need(any(x.strip()=='BW-LE-INPUT-CLOSED' for x in lines['response']),'closed response visible')
 return screens

def scans(text):
 table=dict(zip('abcdefghijklmnopqrstuvwxyz',[30,48,46,32,18,33,34,35,23,36,37,38,50,49,24,25,16,19,31,20,22,47,17,45,21,44]));table.update({'\\':43,'.':52,'\r':28,':':39})
 result=[]
 for ch in text:
  c=table[ch]
  if ch==':':result.append(42)
  result.extend([c,c+128])
  if ch==':':result.append(170)
 return result

def target(report,key):
 need(report['schema']=='bw.le-key.target.v1' and report['key']==key and report['firstFailure'] is None,'target status')
 need(report['stage']=='done' and report['pending']==0 and report['ordinaryStep'] is True and integer(report['steps']) and report['steps']<120000000,'target completion')
 need(report['clientSha256']==CLIENT and report['final']['shutdown'] is False,'client/CPU')
 screens=screen_roles(report);need(region_files(screens[2]['regions'])['result']==bytes.fromhex(RESULT[key]),'response original result');steps=[s['step'] for s in screens];need(all(integer(x) for x in steps) and all(a<b for a,b in zip(steps,steps[1:])),'screen order')
 w=report['witnesses'];need([x['role'] for x in w]==['entry','read','consumed','computed','closed','exit'],'complete owned witness order')
 need(SHA(bytes.fromhex(w[0]['payloadHex']))=='30619991ce136ef48ac1be080688fa706aa150534d4b0860b30eb55f04badd40','whole owned payload original')
 offsets=[0,16,20,60,127,142];base=w[0]['linear']
 for x,off in zip(w,offsets):need(all(type(x[k])is int and 0<=x[k]<=0xffffffff for k in ['linear','cs','eip','cr0']) and ('eax' not in x or type(x['eax'])is int and 0<=x['eax']<=0xffffffff) and integer(x['step']) and x['cr0']&1 and not(x['cr0']&0x80000000) and x['csDefault32'] is True and x['linear']==base+off and x['cs']==w[0]['cs'],'protected owned code')
 need(all(a['step']<b['step'] for a,b in zip(w,w[1:])),'witness order')
 need(w[2]['eax']&255==ord(key) and w[3]['eax']==int.from_bytes(bytes.fromhex(RESULT[key])[1:],'little'),'consumed and computed')
 need(w[4]['resultHex']==RESULT[key] and w[5]['eax']&65535==0x4c00,'stored bytes/zero exit')
 need(w[1]['step']<=steps[1]<w[2]['step']<steps[2]<steps[3]<=report['steps'],'readiness/consume/response fences')
 events=report['events'];need(len(events)<=512 and all(type(e['accepted'])is bool and integer(e['step']) and type(e['scan'])is int for e in events),'input acceptance')
 need(all(a['step']<b['step'] for a,b in zip(events,events[1:])),'offered order')
 accepted=[e for e in events if e['accepted']];need(all(b['step']-a['step']>=65536 for a,b in zip(accepted,accepted[1:])),'accepted input spacing')
 for i,e in enumerate(events):
  if not e['accepted']:
   next_event=next((x for x in events[i+1:] if x['accepted']),None);need(next_event is not None and (e['scan'],e['stage'])==(next_event['scan'],next_event['stage']),'refused retry does not consume input')
 bystage={stage:[e for e in accepted if e['stage']==stage] for stage in ['boot','client','response','shell']}
 need(all(e['stage'] in bystage for e in events),'input stage')
 need([e['scan'] for e in bystage['boot']] in [scans('n\r'),scans('\r')+scans('n\r')],'finite boot input')
 for stage,command in [('client','c:\\runkey.bat\r'),('response',key),('shell','c:\\verify.bat\r')]:need([e['scan'] for e in bystage[stage]]==scans(command),'fixed hardware command '+stage)
 need(bystage['boot'][-1]['step']<=steps[0]<=bystage['client'][0]['step'] and bystage['client'][-1]['step']<steps[1],'launch phase fences')
 challenge=bystage['response'];need(steps[1]<=challenge[0]['step']<w[2]['step'] and challenge[-1]['step']<steps[2],'real challenge consumption/release')
 need(steps[2]<=bystage['shell'][0]['step']<bystage['shell'][-1]['step']<steps[3],'separate VERIFY after result')

 return True

def oracle(report,key,raws):
 need(report['schema']=='bw.le-key.oracle.v1' and report['key']==key and report['firstFailure'] is None and report['exitCode']==0 and report['reaped'] is True and report['groupEmpty'] is True,'oracle process')
 need(report['command'][1:10]==['-accel','tcg','-machine','pc','-cpu','486','-m','4','-display'],'explicit QEMU compatibility profile')
 screens=screen_roles(report,raws);need(region_files(screens[2]['regions'])['result']==bytes.fromhex(RESULT[key]),'QEMU response original result');times=[s['elapsedNs'] for s in screens];need(all(integer(t) for t in times) and all(a<b for a,b in zip(times,times[1:])),'QEMU screen order')
 es=report['events'];need([e['role'] for e in es if e['role'] not in ['menu','decline']]==['run','challenge','verify'],'QEMU input phases')
 need(sum(e['role']=='decline' for e in es)==1 and sum(e['role']=='menu' for e in es)<=1,'finite QEMU boot policy')
 def qcodes(command):
  mapping={':':['shift','semicolon'],'\\':['backslash'],'.':['dot'],'\r':['ret']}
  return [mapping[c] if c in mapping else [c] for c in command]
 expected={'decline':'n\r','menu':'\r','run':'c:\\runkey.bat\r','challenge':key,'verify':'c:\\verify.bat\r'}
 for e in es:
  need(e['role'] in expected and e['textHex']==expected[e['role']].encode().hex() and e['qcodes']==qcodes(expected[e['role']]),'fixed QMP command')
  need(integer(e['elapsedNs']) and integer(e['completedElapsedNs']) and e['elapsedNs']<e['completedElapsedNs'],'completed QMP input')
 need(all(a['completedElapsedNs']<b['elapsedNs'] for a,b in zip(es,es[1:])),'QMP input order')
 ch=next(e for e in es if e['role']=='challenge');verify=next(e for e in es if e['role']=='verify')
 need(ch['textHex']==key.encode().hex() and ch['qcodes']==[[key]] and times[1]<ch['elapsedNs']<ch['completedElapsedNs']<times[2]<verify['elapsedNs']<verify['completedElapsedNs']<times[3],'QMP after readiness/response')
 return True

def resources(row):
 need(set(row)=={'cpu.max','memory.max','memory.swap.max','memory.events','affinity','cgroup'},'resource keys')
 need(row['cpu.max']=='100000 100000' and row['memory.max']=='1073741824' and row['memory.swap.max']=='0' and len(row['affinity'])==1 and integer(row['affinity'][0]),'hard resource profile')
 counters={}
 for line in row['memory.events'].splitlines():
  k,v=line.split();need(k not in counters and v.isdecimal(),'memory event type');counters[k]=int(v)
 need({'low','high','max','oom','oom_kill','oom_group_kill'}<=set(counters),'memory event keys')
 return counters

def resource_interval(a,b):
 x,y=resources(a),resources(b);need({k:v for k,v in a.items() if k!='memory.events'}=={k:v for k,v in b.items() if k!='memory.events'},'same owned cgroup')
 need(x.keys()==y.keys() and all(y[k]>=x[k] for k in x) and all(x[k]==y[k] for k in ['oom','oom_kill','oom_group_kill']),'OOM/regression')

def audit(packet,external=None):
 """packet maps original relative roles to bytes; external is caller-admitted official/source/runtime/role identity."""
 need(type(packet)is dict and len(packet)<=80 and sum(len(x) for x in packet.values())<=16<<20,'packet cap')
 for n,b in packet.items():need(not n.startswith('/') and '..' not in n.split('/') and type(b)is bytes,'packet role')
 before=decode(packet['source-before.json']);after=decode(packet['source-after.json']);need(before==after and len(before['files'])>=1,'source unchanged')
 runtime=decode(packet['runtime-before.json']);need(runtime==decode(packet['runtime-after.json']) and runtime['node']['version']=='v22.23.3','runtime unchanged')
 need(decode(packet['client.json'])['sha256']==CLIENT,'authored client identity')
 media=decode(packet['input-admission.json']);pins={'bios':(65536,'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'),'vga':(38400,'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'),'floppy':(1228800,'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'),'extender':(27504,'d189be603e72f79d3c2f68114eb34d0cab8bd9744ef0f327497d57bcd8e16817'),'license':(1821,'116fded3b2c68e4884dae6cdfe420d5df03807cc2e06bd888a3a74f02e5975b0')}
 need(media=={k:{'bytes':v[0],'sha256':v[1]} for k,v in pins.items()},'fixed media admission')
 need(len(packet['DOS32A-LICENSE.txt'])==1821 and SHA(packet['DOS32A-LICENSE.txt'])==pins['license'][1] and packet['DOS32A-ACKNOWLEDGMENT.txt']==b'This product uses DOS/32 Advanced DOS Extender technology.\n','extender notices')
 for role,path in [('free-bios-LICENSE.txt','roms/free-at-bios/LICENSE'),('free-bios-README.txt','roms/free-at-bios/README.md')]:need(SHA(packet[role])==before['files'][path]['sha256'],'firmware notices')
 initial=decode(packet['initial-regions.json']);need(all(v is None for v in region_files(initial).values()),'initial absent')
 initial_fat=bytes.fromhex(initial['fatHex'])
 prior_resource=None;script_root=None
 for engine,key in [('target','a'),('oracle','a'),('target','b'),('oracle','b')]:
  prefix=engine+'-'+key+'/';r=decode(packet[prefix+'report.json']);region=decode(packet[prefix+'disk-regions.json']);files=region_files(region)
  for cut in [region,*[screen['regions'] for screen in r['screens']]]:
   region_files(cut)
   need(all(initial_fat[int(c)*2:int(c)*2+2]==b'\0\0' for c in cut['clusters']),'result aliases initial allocated content')
  need(files['result']==bytes.fromhex(RESULT[key]) and files['fail'] is None and all(files[k]==v for k,v in EXPECTED.items()),'independent guest files')
  need(r['initialDiskSha256']==initial['diskSha256'] and r['diskSha256']==region['diskSha256'],'original region capture joins')
  need(r['files']=={k:None if v is None else v.hex() for k,v in files.items()},'file report join')
  p=decode(packet[prefix+'process.json']);need(p['exitCode']==0 and p['firstFailure'] is None and p['reaped'] is True and p['groupEmpty'] is True and 0<=p['wallSeconds']<=600,'child status')
  need(packet[prefix+'stderr']==b'','unexpected child stderr')
  need(integer(p['pid']) and p['pid']>0,'owned PID')
  argv=p['argv'];suffix='/scripts/i80386-dos32a-input/'+('probe.mjs' if engine=='target' else 'oracle.py')
  need(type(argv)is list and len(argv)==(6 if engine=='target' else 5) and argv[0]==runtime['node' if engine=='target' else 'python3']['path'] and argv[1]==('--max-old-space-size=512' if engine=='target' else '-B') and argv[2].endswith(suffix),'fixed child command')
  root=argv[2][:-len(suffix)]
  if script_root is None:script_root=root
  need(root==script_root and (engine!='target' or argv[3]=='target'),'same admitted source route')
  resource_interval(p['resourceBefore'],p['resourceAfter'])
  if prior_resource is not None:resource_interval(prior_resource,p['resourceBefore'])
  prior_resource=p['resourceAfter']
  if engine=='target':target(r,key)
  else:
   command=r['command'];need(command[0]==runtime['qemu-system-i386']['path'] and command[13:15]==['-bios',runtime['bios-256k.bin']['path']] and command[15:19]==['-vga','none','-device','VGA,romfile='+runtime['vgabios-stdvga.bin']['path']],'QEMU observed firmware identity')
   need(integer(r['pid']) and r['pid']>0 and packet[prefix+'qemu.stderr']==b'','owned QEMU PID/stderr');oracle(r,key,{s['file']:packet[prefix+s['file']] for s in r['screens']})
 expected_roles={'source-before.json','source-after.json','runtime-before.json','runtime-after.json','client.json','initial-regions.json','input-admission.json','DOS32A-LICENSE.txt','DOS32A-ACKNOWLEDGMENT.txt','free-bios-LICENSE.txt','free-bios-README.txt'}
 for engine,key in [('target','a'),('oracle','a'),('target','b'),('oracle','b')]:
  prefix=engine+'-'+key+'/'
  expected_roles.update(prefix+n for n in ['process.json','stdout','stderr','report.json','disk-regions.json'])
  if engine=='oracle':expected_roles.update(prefix+n for n in ['qemu.stdout','qemu.stderr','vga-boot.bin','vga-ready.bin','vga-response.bin','vga-final.bin'])
 need(set(packet)==expected_roles,'closed original packet roles')
 qualified=False
 if external is not None:
  need(set(external)=={'official','source','runtime','roles'},'external closed keys')
  official=external['official'];need(set(official)=={'conclusion','event','eventAction','label','head','repository','enclosingCleanupSuccess','runId','attempt','jobId','jobName','workflowPath','workflowSha256','artifactId','artifactBytes','artifactSha256','requiredSteps'},'official keys')
  need(all(integer(official[k]) and official[k]>0 for k in ['runId','jobId','artifactId','artifactBytes']) and official['attempt']==1 and type(official['attempt'])is int,'official IDs/attempt')
  need(official['jobName']=='actual' and official['eventAction']=='labeled' and official['workflowPath']=='.github/workflows/i80386-dos32a-input.yml' and official['workflowSha256']==before['files'][official['workflowPath']]['sha256'],'official workflow binding')
  need(official['requiredSteps']=={'Bounded four fresh applications':'success','Owned controller terminal and empty':'success','Retain original evidence':'success'},'official step conclusions')
  need(official['conclusion']=='success' and official['event']=='pull_request' and official['label']=='x86-dos32a-input-actual' and official['head']==before['head'] and official['repository']=='CrispStrobe/bw-board' and official['enclosingCleanupSuccess'] is True,'official original admission')
  need(before==external['source'] and runtime==external['runtime'],'external source/runtime admission')
  need(external['roles']=={n:{'bytes':len(b),'sha256':SHA(b)} for n,b in packet.items()},'external original role admission')
  qualified=True
 return {'schema':'bw.le-key.audit.v1','reportedConsistencyPass':True,'finiteKeyboardApplicationPass':qualified,'wholeDiskByteProof':False,'strict386DX':False,'fullOS':False,'installedGUI':False,'missingGates':[] if qualified else ['independently admitted official job/controller cleanup/source/runtime/original role identities']}
def verify_artifact(raw,external):
 need(type(raw)is bytes and len(raw)<=32<<20,'artifact cap')
 o=external['official'];need(len(raw)==o['artifactBytes'] and SHA(raw)==o['artifactSha256'],'official artifact original')
 packet={};total=0
 with zipfile.ZipFile(io.BytesIO(raw)) as archive:
  need(len(archive.infolist())<=80,'ZIP role count')
  for entry in archive.infolist():
   name=entry.filename;need(not entry.is_dir() and name not in packet and not name.startswith('/') and '\\' not in name and '..' not in name.split('/') and not stat.S_ISLNK(entry.external_attr>>16) and not entry.flag_bits&1,'ZIP path/type')
   need(entry.file_size<=4<<20,'ZIP member cap');total+=entry.file_size;need(total<=16<<20,'decoded artifact cap')
   with archive.open(entry) as stream:body=stream.read((4<<20)+1)
   need(len(body)==entry.file_size,'ZIP member extent');packet[name]=body
 return audit(packet,external)

if __name__=='__main__':
 p=argparse.ArgumentParser();g=p.add_mutually_exclusive_group(required=True);g.add_argument('--packet',type=Path);g.add_argument('--artifact',type=Path);p.add_argument('--external',type=Path);a=p.parse_args();roles={}
 if a.artifact:
  need(a.external is not None and a.external.stat().st_size<=4<<20 and a.artifact.stat().st_size<=32<<20,'external/artifact input caps');print(json.dumps(verify_artifact(a.artifact.read_bytes(),decode(a.external.read_bytes())),sort_keys=True));raise SystemExit(0)
 total=0
 for f in a.packet.rglob('*'):
  need(not f.is_symlink(),'packet symlink')
  if f.is_file():
   size=f.stat().st_size;need(size<=4<<20 and len(roles)<80,'role cap/count');total+=size;need(total<=16<<20,'packet aggregate cap before read')
   roles[str(f.relative_to(a.packet))]=f.read_bytes();need(len(roles[str(f.relative_to(a.packet))])==size,'role extent changed')
 print(json.dumps(audit(roles,decode(a.external.read_bytes()) if a.external else None),sort_keys=True))

#!/usr/bin/env python3
"""Original-only finite LE file readback reader. Never imports producers or emulators."""
import argparse
import hashlib
import json
import math
import io
import zipfile
import stat
import struct
import re
from pathlib import Path
SHA=lambda b:hashlib.sha256(b).hexdigest()
# Literal generator identities/labels are frozen independently before source admission.
# Byte identities, call/return adjacency, paths, guards and count-store opcodes independently checked.
CLIENT='c4cd62d6e884264f03eda088c826c9158564d2a3c1250120844a2efa1937d1f3'
PAYLOAD_SHA='97d98fa77248b1f2914f3490dbf064d1664d4a2c3f96349f3c52d23cc5f07787'
CLIENT_META={'bytes': 8192,
 'cases': {'a': '11365b80a5caef14395e83a8cdf2173c61',
           'b': 'a7dc11467bb0e51a4f84b9ee23588dc2f72c6196cb00356a9fd4093e73a8dd'},
 'labels': {'bad': 1357,
            'cc_loop_1': 353,
            'cc_loop_3': 601,
            'cc_loop_4': 746,
            'compare_loop_0': 311,
            'compare_loop_2': 571,
            'copy_loop_10': 1013,
            'copy_loop_11': 1043,
            'copy_loop_12': 1073,
            'copy_loop_13': 1103,
            'copy_loop_5': 863,
            'copy_loop_6': 893,
            'copy_loop_7': 923,
            'copy_loop_8': 953,
            'copy_loop_9': 983,
            'data_close_call': 194,
            'data_close_return': 196,
            'data_create_call': 115,
            'data_create_return': 117,
            'data_path': 1375,
            'data_write_call': 163,
            'data_write_return': 165,
            'done': 1337,
            'entry': 0,
            'eof_buffer': 1756,
            'eof_call': 704,
            'eof_prefix': 1748,
            'eof_return': 706,
            'eof_suffix': 1772,
            'exit': 1242,
            'fail': 1298,
            'full_buffer': 1644,
            'full_call': 261,
            'full_prefix': 1636,
            'full_return': 263,
            'full_suffix': 1708,
            'input_call': 24,
            'input_return': 26,
            'length': 1405,
            'payload_a': 1433,
            'payload_b': 1450,
            'proof': 1481,
            'proof_close_call': 1216,
            'proof_close_return': 1218,
            'proof_create_call': 1139,
            'proof_create_return': 1141,
            'proof_fail': 1280,
            'proof_handle': 1417,
            'proof_path': 1387,
            'proof_ready': 1123,
            'proof_write_call': 1186,
            'proof_write_return': 1188,
            'read_close_call': 838,
            'read_close_return': 840,
            'read_fail': 1262,
            'read_handle': 1413,
            'ready': 1318,
            'reopen_call': 213,
            'reopen_return': 215,
            'saved_counts': 1421,
            'seek_call': 459,
            'seek_return': 461,
            'selected': 1401,
            'selected_case': 81,
            'short_call': 514,
            'short_return': 516,
            'tail_buffer': 1724,
            'tail_prefix': 1716,
            'tail_suffix': 1740,
            'tail_unread': 1729,
            'write_fail': 1244,
            'write_handle': 1409},
 'payloadBytes': 1780,
 'payloadSha256': '97d98fa77248b1f2914f3490dbf064d1664d4a2c3f96349f3c52d23cc5f07787',
 'schema': 'bw.le-file.client.v1',
 'sha256': 'c4cd62d6e884264f03eda088c826c9158564d2a3c1250120844a2efa1937d1f3',
 'windows': {'data_close_call': 'cd210f824804',
             'data_close_return': '0f8248040000',
             'data_create_call': 'cd210f829704',
             'data_create_return': '0f8297040000',
             'data_write_call': 'cd210f823104',
             'data_write_return': '0f8231040000',
             'entry': 'e8000000005d',
             'eof_call': 'cd210f822602',
             'eof_return': '0f8226020000',
             'exit': 'cd218b9d7c05',
             'full_call': 'cd210f82e103',
             'full_return': '0f82e1030000',
             'input_call': 'cd210fb6c03c',
             'input_return': '0fb6c03c610f',
             'proof_close_call': 'cd210f824a00',
             'proof_close_return': '0f824a000000',
             'proof_create_call': 'cd210f829700',
             'proof_create_return': '0f8297000000',
             'proof_ready': '8d9566050000',
             'proof_write_call': 'cd210f825600',
             'proof_write_return': '0f8256000000',
             'read_close_call': 'cd210f82c401',
             'read_close_return': '0f82c4010000',
             'reopen_call': 'cd210f823504',
             'reopen_return': '0f8235040000',
             'seek_call': 'cd210f821b03',
             'seek_return': '0f821b030000',
             'short_call': 'cd210f82e402',
             'short_return': '0f82e4020000'},
 'witnessRoles': ['entry',
                  'input_call',
                  'input_return',
                  'data_create_call',
                  'data_create_return',
                  'data_write_call',
                  'data_write_return',
                  'data_close_call',
                  'data_close_return',
                  'reopen_call',
                  'reopen_return',
                  'full_call',
                  'full_return',
                  'seek_call',
                  'seek_return',
                  'short_call',
                  'short_return',
                  'eof_call',
                  'eof_return',
                  'read_close_call',
                  'read_close_return',
                  'proof_ready',
                  'proof_create_call',
                  'proof_create_return',
                  'proof_write_call',
                  'proof_write_return',
                  'proof_close_call',
                  'proof_close_return',
                  'exit']}
OFFSETS={'entry': 0,
 'input_call': 24,
 'input_return': 26,
 'data_create_call': 115,
 'data_create_return': 117,
 'data_write_call': 163,
 'data_write_return': 165,
 'data_close_call': 194,
 'data_close_return': 196,
 'reopen_call': 213,
 'reopen_return': 215,
 'full_call': 261,
 'full_return': 263,
 'seek_call': 459,
 'seek_return': 461,
 'short_call': 514,
 'short_return': 516,
 'eof_call': 704,
 'eof_return': 706,
 'read_close_call': 838,
 'read_close_return': 840,
 'proof_ready': 1123,
 'proof_create_call': 1139,
 'proof_create_return': 1141,
 'proof_write_call': 1186,
 'proof_write_return': 1188,
 'proof_close_call': 1216,
 'proof_close_return': 1218,
 'exit': 1242}
WINDOWS={'entry': 'e8000000005d',
 'input_call': 'cd210fb6c03c',
 'input_return': '0fb6c03c610f',
 'data_create_call': 'cd210f829704',
 'data_create_return': '0f8297040000',
 'data_write_call': 'cd210f823104',
 'data_write_return': '0f8231040000',
 'data_close_call': 'cd210f824804',
 'data_close_return': '0f8248040000',
 'reopen_call': 'cd210f823504',
 'reopen_return': '0f8235040000',
 'full_call': 'cd210f82e103',
 'full_return': '0f82e1030000',
 'seek_call': 'cd210f821b03',
 'seek_return': '0f821b030000',
 'short_call': 'cd210f82e402',
 'short_return': '0f82e4020000',
 'eof_call': 'cd210f822602',
 'eof_return': '0f8226020000',
 'read_close_call': 'cd210f82c401',
 'read_close_return': '0f82c4010000',
 'proof_ready': '8d9566050000',
 'proof_create_call': 'cd210f829700',
 'proof_create_return': '0f8297000000',
 'proof_write_call': 'cd210f825600',
 'proof_write_return': '0f8256000000',
 'proof_close_call': 'cd210f824a00',
 'proof_close_return': '0f824a000000',
 'exit': 'cd218b9d7c05'}
LAYOUT={'data_name': 1375, 'result_name': 1387, 'payload_a': 1433, 'payload_b': 1450, 'saved_counts': 1421, 'proof': 1481, 'full': 1644, 'short': 1724, 'eof': 1756}
BUFFERS={'full': 64, 'short': 16, 'eof': 16}
ROLES=['entry','input_call','input_return','data_create_call','data_create_return',
 'data_write_call','data_write_return','data_close_call','data_close_return',
 'reopen_call','reopen_return','full_call','full_return','seek_call','seek_return',
 'short_call','short_return','eof_call','eof_return','read_close_call','read_close_return',
 'proof_ready','proof_create_call','proof_create_return','proof_write_call','proof_write_return',
 'proof_close_call','proof_close_return','exit']
GUARD=bytes.fromhex('a55aa55a3cc33cc3')
NAMES={'data':b'DATA    BIN','result':b'RESULT  BIN','ok':b'KEYOK   TXT','fail':b'KEYFAIL TXT','returned':b'RETURN  TXT'}
EXPECTED={'ok':b'BW-FILE-EXIT-0\r\n','returned':b'BW-FILE-SHELL-RETURN\r\n'}
def data(key):
 if key=='a':return bytes((37*i+17)&255 for i in range(17))
 if key=='b':return bytes((53*i+167)&255 for i in range(31))
 raise ValueError('fixed case')
def proof(key):
 payload=data(key);n=len(payload)
 return b'BWFR1'+bytes([ord(key),n,n,5,0,165])+payload+b'\xcc'*(64-n)+payload[-5:]+b'\xcc'*11+b'\xcc'*16+GUARD*6
RESULT={key:proof(key).hex() for key in ['a','b']}
def need(value,reason):
 if not value:raise ValueError(reason)
def integer(v):return type(v)is int and 0<=v<=2**53-1
def equal(a,b):
 if type(a)is not type(b):return False
 if isinstance(a,dict):return a.keys()==b.keys() and all(equal(a[k],b[k]) for k in a)
 if isinstance(a,list):return len(a)==len(b) and all(equal(x,y) for x,y in zip(a,b))
 return a==b
def duration(x):return type(x)in (int,float) and math.isfinite(x) and x>=0
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
 need(type(region['diskBytes'])is int and region['diskBytes']==10653696 and re.fullmatch('[0-9a-f]{64}',region['diskSha256']),'disk shape')
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
 screens=report['screens'];need(type(screens)is list and len(screens)==4,'four original screens');need([x['role'] for x in screens]==['boot','ready','response','final'],'screen roles')
 lines={}
 for s in screens:
  exactkeys(s,{'role','step','hex','regions'} if raws is None else {'role','elapsedNs','file','sha256','rows','regions'},'closed screen capture')
  if raws is None:raw=bytes.fromhex(s['hex'])
  else:
   need(s['file']=='vga-'+s['role']+'.bin','literal VGA role/file join')
   raw=raws[s['file']];need(SHA(raw)==s['sha256'] and text(raw)==s['rows'],'QEMU raw VGA join')
  lines[s['role']]=text(raw)
 need(any(x.strip()=='BW-LE-FILE-READY' for x in lines['ready']),'completed readiness')
 for name in ['boot','response','final']:need(prompt(lines[name]),'current shell prompt')
 cuts={s['role']:region_files(s['regions']) for s in screens}
 need(all(v is None for v in cuts['boot'].values()) and all(v is None for v in cuts['ready'].values()),'boot/ready files absent')
 need(cuts['response']['returned'] is None and cuts['response']['fail'] is None and cuts['response']['ok']==EXPECTED['ok'] and cuts['response']['data']==data(report['key']) and cuts['response']['result']==proof(report['key']),'response before separate VERIFY')
 need(cuts['final']=={'data':data(report['key']),'result':proof(report['key']),'ok':EXPECTED['ok'],'fail':None,'returned':EXPECTED['returned']},'final original data/proof/exit/return consistency')
 need(any(x.strip()=='BW-LE-FILE-CLOSED' for x in lines['response']),'closed response visible')
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

def exactkeys(obj,keys,reason):
 need(type(obj)is dict and set(obj)==set(keys),reason)
def u32(value):return type(value)is int and 0<=value<=0xffffffff
def frame(row,role,entry):
 core={'role','step','linear','eip','cr0','cs','csBase','csLimit','csDefault32','ds','dsSelector','dsBase','dsLimit','dsDefault32','codeHex','eax','ebx','ecx','edx','esi','edi','ebp','esp','eflags'}
 extras={'payloadHex'} if role=='entry' else {'buffer'} if role.startswith(('full_','short_','eof_')) else {'proofHex','savedCountsHex','proofLinear','savedCountsLinear'} if role=='proof_ready' else set()
 exactkeys(row,core|extras,'closed owned witness '+role)
 need(row['role']==role and integer(row['step']),'owned role/step')
 need(all(u32(row[k]) for k in core-{'role','step','codeHex','csDefault32','dsDefault32'}),'original register types')
 need(row['cs']<=65535 and row['ds']<=65535 and row['dsSelector']==row['ds'] and type(row['dsDefault32'])is bool,'segment identity')
 need(row['cr0']&1 and not(row['cr0']&0x80000000) and row['csDefault32'] is True,'PE/CS.D nonpaged')
 need(row['csBase']+row['eip']==row['linear']<=0xffffffff and row['eip']+5<=row['csLimit'],'original CS-derived code address')
 need(row['cs']==entry['cs'] and row['csBase']==entry['csBase'] and row['csLimit']==entry['csLimit'] and row['linear']==entry['linear']+OFFSETS[role],'literal owned code identity')
 need(row['codeHex']==WINDOWS[role],'literal opcode window')
 if role!='entry':need(entry['eip']<=0xfffffffa and row['ebp']==entry['eip']+5,'original CALL/POP EBP anchor')
 need(row['ds']==entry['ds'] and row['dsBase']==entry['dsBase'] and row['dsLimit']==entry['dsLimit'],'stable original data segment')

def pointer(row,entry,label,length,guarded=False):
 offset=LAYOUT[label];linear=entry['linear']+offset
 need(row['ebp']+offset>=5 and row['ebp']+offset-5==row['edx']<=0xffffffff,'original EBP-relative pointer derivation')
 need(row['dsBase']+row['edx']==linear<=0xffffffff,'original DS:EDX target')
 start=row['edx']-(8 if guarded else 0);end=row['edx']+length+(8 if guarded else 0)-1
 need(0<=start<=end<=row['dsLimit'] and row['dsBase']+end<=0xffffffff,'original DS descriptor extent')
 need(0<=offset-(8 if guarded else 0) and offset+length+(8 if guarded else 0)<=4096,'owned fixed extent')
 return linear

def buffer(row,name,entry,expected):
 b=row['buffer'];exactkeys(b,{'linear','prefixHex','dataHex','suffixHex'},'closed actual buffer')
 need(u32(b['linear']) and b['linear']==entry['linear']+LAYOUT[name] and len(expected)==BUFFERS[name],'actual fixed buffer address')
 need(b['prefixHex']==GUARD.hex() and b['suffixHex']==GUARD.hex() and b['dataHex']==expected.hex(),'actual buffer/guards/tail')

def target(report,key):
 need(CLIENT!='0'*64 and PAYLOAD_SHA!='0'*64 and set(OFFSETS)==set(WINDOWS)==set(ROLES),'independent generator goldens not yet admitted')
 exactkeys(report,{'schema','key','firstFailure','events','witnesses','screens','stage','steps','readyStep','pending','files','diskSha256','initialDiskSha256','clientSha256','inputHashes','final','ordinaryStep'},'closed target report')
 need(report['inputHashes']=={'bios':'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac','vga':'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1','floppy':'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'},'target fixed inputs')
 need(report['schema']=='bw.le-file.target.v1' and report['key']==key and report['firstFailure'] is None,'target status')
 need(report['stage']=='done' and integer(report['pending']) and report['pending']==0 and report['ordinaryStep'] is True and integer(report['steps']) and report['steps']<120000000,'target completion')
 exactkeys(report['final'],{'eax','cycles','shutdown'},'target final CPU')
 need(u32(report['final']['eax']) and integer(report['final']['cycles']) and report['clientSha256']==CLIENT and report['final']['shutdown'] is False,'client/CPU')
 screens=screen_roles(report);steps=[s['step'] for s in screens]
 need(all(integer(x) for x in steps) and all(a<b for a,b in zip(steps,steps[1:])) and integer(report['readyStep']) and report['readyStep']==steps[1],'screen order')
 need(region_files(screens[2]['regions'])['data']==data(key) and region_files(screens[2]['regions'])['result']==proof(key),'original response data/proof')
 w=report['witnesses'];need(type(w)is list and len(w)==len(ROLES),'complete original calls/returns')
 entry=w[0]
 for row,role in zip(w,ROLES):frame(row,role,entry)
 need(SHA(bytes.fromhex(entry['payloadHex']))==PAYLOAD_SHA and len(bytes.fromhex(entry['payloadHex']))==4096,'whole initial owned payload identity')
 need(all(a['step']<b['step'] for a,b in zip(w,w[1:])),'original call/return order')
 by={x['role']:x for x in w};n=len(data(key))
 need(by['input_call']['eax']==0x800 and by['input_return']['eax']&255==ord(key),'real input service/key')
 handles={}
 for prefix,service,label in [('data_create',0x3c00,'data_name'),('reopen',0x3d00,'data_name'),('proof_create',0x3c00,'result_name')]:
  call,ret=by[prefix+'_call'],by[prefix+'_return'];need(call['eax']==service,'original create/open service')
  if service==0x3c00:need(call['ecx']==0,'ordinary create attributes')
  pointer(call,entry,label,12 if label=='data_name' else 14)
  need(not(ret['eflags']&1) and ret['eax']<=65535,'actual successful handle result');handles[prefix]=ret['eax']
 for prefix,handle,label,count in [('data_write',handles['data_create'],'payload_'+key,n),('proof_write',handles['proof_create'],'proof',155)]:
  call,ret=by[prefix+'_call'],by[prefix+'_return'];need(call['eax']==0x4000 and call['ebx']==handle and call['ecx']==count,'original write handle/service/count')
  pointer(call,entry,label,count);need(not(ret['eflags']&1) and ret['eax']==count,'full original checked write return')
 for prefix,handle in [('data_close',handles['data_create']),('read_close',handles['reopen']),('proof_close',handles['proof_create'])]:
  call,ret=by[prefix+'_call'],by[prefix+'_return'];need(call['eax']==0x3e00 and call['ebx']==handle and not(ret['eflags']&1),'original live close and result')
 counts=[]
 for name,requested,returned,post in [('full',n,n,data(key)+b'\xcc'*(64-n)),('short',8,5,data(key)[-5:]+b'\xcc'*11),('eof',1,0,b'\xcc'*16)]:
  call,ret=by[name+'_call'],by[name+'_return'];need(call['eax']==0x3f00 and call['ebx']==handles['reopen'] and call['ecx']==requested,'original read service/reopened handle/request')
  pointer(call,entry,name,BUFFERS[name],True);buffer(call,name,entry,b'\xcc'*BUFFERS[name]);buffer(ret,name,entry,post)
  need(not(ret['eflags']&1) and ret['eax']==returned,'full original read return before narrowing');counts.append(ret['eax'])
 call,ret=by['seek_call'],by['seek_return'];need(call['eax']==0x4200 and call['ebx']==handles['reopen'] and call['ecx']==0 and call['edx']==n-5,'original seek service/handle/origin/offset')
 need(not(ret['eflags']&1) and ret['eax']==n-5 and ret['edx']==0,'full original returned seek position')
 p=by['proof_ready'];need(u32(p['proofLinear']) and u32(p['savedCountsLinear']) and p['proofLinear']==entry['linear']+LAYOUT['proof'] and p['savedCountsLinear']==entry['linear']+LAYOUT['saved_counts'],'owned proof/count snapshot addresses')
 need(p['savedCountsHex']==struct.pack('<III',*counts).hex() and p['proofHex']==proof(key).hex(),'actual saved full count/proof join')
 need(list(bytes.fromhex(p['proofHex'])[7:10])==counts and region_files(screens[2]['regions'])['result'].hex()==p['proofHex'],'original postcall/header/file causality')
 need(by['exit']['eax']==0x4c00,'zero exit original register')
 need(by['input_call']['step']<=steps[1]<by['input_return']['step']<by['exit']['step']<steps[2]<steps[3]<=report['steps'],'readiness/input/response/return fences')
 events=report['events'];need(type(events)is list and len(events)<=512,'event cap')
 for e in events:
  exactkeys(e,{'step','stage','scan','key','phase','accepted'},'closed hardware event');need(type(e['accepted'])is bool and integer(e['step']) and type(e['scan'])is int and 0<=e['scan']<=255,'original hardware event')
 keytable=dict(zip([30,48,46,32,18,33,34,35,23,36,37,38,50,49,24,25,16,19,31,20,22,47,17,45,21,44],'abcdefghijklmnopqrstuvwxyz'));keytable.update({42:'shift',43:'\\',52:'.',28:'\r',39:':'})
 for e in events:
  need(e['key']==keytable.get(e['scan']&127) and e['phase']==('break' if e['scan']&128 else 'make') and type(e['key'])is str,'original key phase/type')
 need(all(a['step']<b['step'] for a,b in zip(events,events[1:])),'offered order')
 accepted=[e for e in events if e['accepted']];need(all(b['step']-a['step']>=65536 for a,b in zip(accepted,accepted[1:])),'accepted spacing')
 for i,e in enumerate(events):
  if not e['accepted']:
   following=next((x for x in events[i+1:] if x['accepted']),None);need(following is not None and (e['scan'],e['stage'])==(following['scan'],following['stage']),'refused input retries same byte')
 stages={name:[e for e in accepted if e['stage']==name] for name in ['boot','client','response','shell']}
 need(all(e['stage'] in stages for e in events),'closed input stages')
 need([e['scan'] for e in stages['boot']] in [scans('n\r'),scans('\r')+scans('n\r')],'finite boot input')
 for stage,command in [('client','c:\\runfile.bat\r'),('response',key),('shell','c:\\verify.bat\r')]:need([e['scan'] for e in stages[stage]]==scans(command),'fixed hardware command '+stage)
 need(stages['boot'][-1]['step']<=steps[0]<=stages['client'][0]['step'] and stages['client'][-1]['step']<steps[1],'launch input fences')
 challenge,verify=stages['response'],stages['shell'];need(steps[1]<=challenge[0]['step']<by['input_return']['step'] and challenge[-1]['step']<steps[2]<=verify[0]['step']<verify[-1]['step']<steps[3],'real key/release and later separate VERIFY')
 return True

def oracle(report,key,raws):
 exactkeys(report,{'schema','key','profile','command','events','screens','firstFailure','initialDiskSha256','pid','groupEmpty','exitCode','cpuSeconds','reaped','files','diskSha256','elapsedSeconds','secondary','quitObservation'},'closed oracle report')
 need(type(report['profile'])is str and duration(report['elapsedSeconds']) and report['elapsedSeconds']<=600 and duration(report['cpuSeconds']),'oracle observed durations')
 need(type(report['secondary'])is list and report['secondary']==[],'oracle cleanup secondary')
 quit=report['quitObservation'];exactkeys(quit,{'kind','detail'},'closed QEMU quit observation')
 need((quit['kind']=='ack' and quit['detail'] is None) or (quit['kind']=='disconnect' and type(quit['detail'])is str and quit['detail'] in ['EOFError','BrokenPipeError','ConnectionResetError','QMP reply extent']),'QEMU quit observation')
 need(report['schema']=='bw.le-file.oracle.v1' and report['key']==key and report['firstFailure'] is None and type(report['exitCode'])is int and report['exitCode']==0 and report['reaped'] is True and report['groupEmpty'] is True,'oracle process')
 need(type(report['command'])is list and len(report['command'])==28 and all(type(x)is str and '\0' not in x and '\n' not in x for x in report['command']),'closed QEMU argv')
 need(report['command'][9:13]==['-display','none','-nic','none'] and report['command'][19:23]==['-no-reboot','-boot','order=a','-drive'] and report['command'][24]=='-drive' and report['command'][26]=='-qmp','closed QEMU profile switches')
 need(re.fullmatch(r'file=.+,if=floppy,index=0,format=raw,readonly=on',report['command'][23]) and re.fullmatch(r'file=.+/disk.raw,if=ide,index=0,format=raw,cache=directsync',report['command'][25]) and re.fullmatch(r'unix:.+/scratch/qmp.sock,server=on,wait=off',report['command'][27]),'QEMU original input/output routes')
 need(report['command'][1:10]==['-accel','tcg','-machine','pc','-cpu','486','-m','4','-display'],'explicit QEMU compatibility profile')
 screens=screen_roles(report,raws);need(region_files(screens[2]['regions'])['result']==bytes.fromhex(RESULT[key]),'QEMU response original result');times=[s['elapsedNs'] for s in screens];need(all(integer(t) for t in times) and all(a<b for a,b in zip(times,times[1:])),'QEMU screen order')
 es=report['events'];need(type(es)is list and len(es)<=5,'QMP event cap')
 for e in es:exactkeys(e,{'role','elapsedNs','completedElapsedNs','textHex','qcodes'},'closed QMP event')
 need([e['role'] for e in es if e['role'] not in ['menu','decline']]==['run','challenge','verify'],'QEMU input phases')
 need(sum(e['role']=='decline' for e in es)==1 and sum(e['role']=='menu' for e in es)<=1,'finite QEMU boot policy')
 def qcodes(command):
  mapping={':':['shift','semicolon'],'\\':['backslash'],'.':['dot'],'\r':['ret']}
  return [mapping[c] if c in mapping else [c] for c in command]
 expected={'decline':'n\r','menu':'\r','run':'c:\\runfile.bat\r','challenge':key,'verify':'c:\\verify.bat\r'}
 for e in es:
  need(e['role'] in expected and e['textHex']==expected[e['role']].encode().hex() and e['qcodes']==qcodes(expected[e['role']]),'fixed QMP command')
  need(integer(e['elapsedNs']) and integer(e['completedElapsedNs']) and e['elapsedNs']<e['completedElapsedNs'],'completed QMP input')
 need(all(a['completedElapsedNs']<b['elapsedNs'] for a,b in zip(es,es[1:])),'QMP input order')
 run=next(e for e in es if e['role']=='run');need(times[0]<run['elapsedNs']<run['completedElapsedNs']<times[1],'QMP launch after boot before readiness')
 ch=next(e for e in es if e['role']=='challenge');verify=next(e for e in es if e['role']=='verify')
 need(ch['textHex']==key.encode().hex() and ch['qcodes']==[[key]] and times[1]<ch['elapsedNs']<ch['completedElapsedNs']<times[2]<verify['elapsedNs']<verify['completedElapsedNs']<times[3],'QMP after readiness/response')
 return True

def resources(row):
 need(set(row)=={'cpu.max','memory.max','memory.swap.max','memory.events','affinity','cgroup'},'resource keys')
 need(type(row['cgroup'])is str and row['cgroup'].startswith('/') and '..' not in row['cgroup'].split('/'),'observed cgroup route')
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
 before=decode(packet['source-before.json']);after=decode(packet['source-after.json']);exactkeys(before,{'head','files','census'},'closed source census')
 need(type(before['head'])is str and re.fullmatch('[0-9a-f]{40}',before['head']) and type(before['census'])is str and type(before['files'])is dict and len(before['files'])<=1000,'source census shape')
 for path,row in before['files'].items():
  exactkeys(row,{'bytes','sha256'},'source row');need(type(path)is str and not path.startswith('/') and '..' not in path.split('/') and integer(row['bytes']) and row['bytes']<=4<<20 and re.fullmatch('[0-9a-f]{64}',row['sha256']),'source original row')
 need(equal(before,after) and len(before['files'])>=1,'source unchanged')
 runtime=decode(packet['runtime-before.json']);exactkeys(runtime,{'node','python3','git','qemu-system-i386','bios-256k.bin','vgabios-stdvga.bin'},'closed runtime identities')
 for name,row in runtime.items():
  exactkeys(row,{'path','bytes','sha256'} if name.endswith('.bin') else {'path','bytes','sha256','version'},'closed runtime row')
  need(type(row['path'])is str and row['path'].startswith('/') and integer(row['bytes']) and row['bytes']>0 and re.fullmatch('[0-9a-f]{64}',row['sha256']),'runtime original identity')
  if 'version' in row:need(type(row['version'])is str and bool(row['version']),'runtime version observation')
 need(equal(runtime,decode(packet['runtime-after.json'])) and runtime['node']['version']=='v22.23.3','runtime unchanged')
 need(CLIENT_META and equal(decode(packet['client.json']),CLIENT_META) and CLIENT_META['sha256']==CLIENT,'literal authored client metadata identity')
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
  need(files['data']==data(key) and files['result']==proof(key) and files['fail'] is None and all(files[k]==v for k,v in EXPECTED.items()),'independent guest files')
  need(r['initialDiskSha256']==initial['diskSha256'] and r['diskSha256']==region['diskSha256'],'original region capture joins')
  need(r['files']=={k:None if v is None else v.hex() for k,v in files.items()},'file report join')
  p=decode(packet[prefix+'process.json']);exactkeys(p,{'argv','pid','exitCode','reaped','groupEmpty','firstFailure','secondary','wallSeconds','cpuSeconds','resourceBefore','resourceAfter'},'closed child process')
  need(p['secondary']==[] and duration(p['wallSeconds']) and duration(p['cpuSeconds']),'original process durations/errors')
  need(type(p['exitCode'])is int and p['exitCode']==0 and p['firstFailure'] is None and p['reaped'] is True and p['groupEmpty'] is True and 0<=p['wallSeconds']<=600,'child status')
  need(packet[prefix+'stderr']==b'','unexpected child stderr')
  need(integer(p['pid']) and p['pid']>0,'owned PID')
  argv=p['argv'];suffix='/scripts/i80386-dos32a-file-readback/'+('probe.mjs' if engine=='target' else 'oracle.py')
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
  need(official['jobName']=='actual' and official['eventAction']=='labeled' and official['workflowPath']=='.github/workflows/i80386-dos32a-file-readback.yml' and official['workflowSha256']==before['files'][official['workflowPath']]['sha256'],'official workflow binding')
  need(official['requiredSteps']=={'Bounded four fresh applications':'success','Owned controller terminal and empty':'success','Retain original evidence':'success'},'official step conclusions')
  need(official['conclusion']=='success' and official['event']=='pull_request' and official['label']=='x86-dos32a-file-readback-actual' and official['head']==before['head'] and official['repository']=='CrispStrobe/bw-board' and official['enclosingCleanupSuccess'] is True,'official original admission')
  need(equal(before,external['source']) and equal(runtime,external['runtime']),'external source/runtime admission')
  need(equal(external['roles'],{n:{'bytes':len(b),'sha256':SHA(b)} for n,b in packet.items()}),'external original role admission')
  qualified=True
 return {'schema':'bw.le-file.audit.v1','reportedConsistencyPass':True,'finiteFileReadbackPass':qualified,'wholeDiskByteProof':False,'strict386DX':False,'fullOS':False,'installedGUI':False,'missingGates':[] if qualified else ['independently admitted official job/controller cleanup/source/runtime/original role identities']}
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
 if a.external:need(a.external.is_file() and not a.external.is_symlink() and a.external.stat().st_size<=4<<20,'external input cap/type')
 print(json.dumps(audit(roles,decode(a.external.read_bytes()) if a.external else None),sort_keys=True))

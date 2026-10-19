#!/usr/bin/env python3
"""Git/live census and finite four-child hosted controller, not an acceptance reader."""
import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import signal
import stat
import subprocess
import sys
import time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
PINS={'scripts/i80386-dos32a-owned/oracle.py':'0e03f3fe484d76e4b7c8479fea79f99328a0fcf6aeba0d29157c817ee9533765','scripts/i80386-dos32a-owned/media.mjs':'886383bdaaf72dc4b31b1a38b429b9959eb69510aac06be914f6c44be6f750ad','scripts/i80386-dos32a-owned/keyboard.mjs':'3698a2ad2cb79aab2e7aa2a5f565817c0ae83019125cf34b7c31056e6a858b4b','scripts/i80386-dos32a-owned/acquire.py':'31fc586e3aaaf4098cd36a3ec2a73a6f1c8c367a63a1ebcc40b8125c1b9524f8','scripts/lib/i80386-free-bios-fat16.mjs':'c6b2bd6f13d264b07b64f517e1dcd6b385e3a71016d1b871dfbadf3855b30cd3','scripts/i80386-dos32a-input/source.py':'972809cbfda402e9e0842183751dbe7b2ad4ba532e11e101e25067f654b8d15e'}
sha=lambda b:hashlib.sha256(b).hexdigest()
def git(*args):return subprocess.check_output(['git','--no-replace-objects',*args],cwd=ROOT,timeout=10)
def inventory(head):
 if git('rev-parse','HEAD').decode().strip()!=head:raise ValueError('source head')
 names=git('ls-files','-z').decode().split('\0'); names=sorted(n for n in names if n and (n.startswith(('src/','scripts/i80386-dos32a-file-readback/','roms/free-at-bios/')) or n in PINS or n in ['package.json','scripts/lib/i80386-free-bios-fat16.mjs','test/i80386-dos32a-file-readback.test.mjs','.github/workflows/i80386-dos32a-file-readback.yml']))
 if not set(PINS).issubset(names) or len(names)>1000:raise ValueError('source closure')
 rows={}
 for n in names:
  p=ROOT/n
  if p.is_symlink() or not p.is_file() or p.stat().st_size>4<<20:raise ValueError('source role')
  raw=p.read_bytes();blob=git('show',head+':'+n)
  if raw!=blob:raise ValueError('source drift '+n)
  rows[n]={'bytes':len(raw),'sha256':sha(raw)}
 for n,h in PINS.items():
  if rows[n]['sha256']!=h:raise ValueError('immutable helper '+n)
 return {'head':head,'files':rows,'census':'conservative all tracked src plus runtime metadata, new namespace, selected immutable helpers and firmware'}
def regions(raw,initial_fat):
 if len(raw)!=10653696:raise ValueError('disk extent')
 if type(initial_fat)is not bytes or len(initial_fat)!=20992:raise ValueError('frozen initial FAT extent')
 fat=raw[9216:30208];fat2=raw[30208:51200];root=raw[51200:67584]
 if fat!=fat2:raise ValueError('FAT mirror')
 selected={}; owners={}; selected_clusters=[]
 for i in range(512):
  row=root[i*32:i*32+32]
  if row[0]==0:break
  if row[0]==229:continue
  if row[11]!=32:raise ValueError('unexpected root kind')
  c=int.from_bytes(row[26:28],'little');n=int.from_bytes(row[28:32],'little');seen=set()
  if n>32768:raise ValueError('root file cap')
  for _ in range((n+1023)//1024):
   if not 2<=c<=10339 or c in seen or c in owners:raise ValueError('FAT crosslink')
   seen.add(c);owners[c]=row[:11];c=int.from_bytes(fat[c*2:c*2+2],'little')
  if n and c<65528:raise ValueError('FAT EOC')
 for i in range(512):
  row=root[i*32:i*32+32]
  if row[0]==0:break
  if row[:11] in [b'DATA    BIN',b'RESULT  BIN',b'KEYOK   TXT',b'KEYFAIL TXT',b'RETURN  TXT']:
   cluster=int.from_bytes(row[26:28],'little');size=int.from_bytes(row[28:32],'little')
   if size>1024 or cluster<2 or cluster>10339:raise ValueError('selected result extent')
   if initial_fat[cluster*2:cluster*2+2]!=b'\0\0':raise ValueError('selected cluster initially allocated')
   selected_clusters.append(cluster)
 # Admit every selected cluster before copying any selected file bytes.
 for cluster in selected_clusters:
  at=67584+(cluster-2)*1024;selected[str(cluster)]=raw[at:at+1024].hex()
 return {'fatHex':fat.hex(),'fat2Hex':fat2.hex(),'rootHex':root.hex(),'clusters':selected,'diskSha256':sha(raw),'diskBytes':len(raw)}
def held():
 path=ROOT/'scripts/i80386-dos32a-input/source.py'
 info=path.lstat();name=str(path.relative_to(ROOT))
 if not stat.S_ISREG(info.st_mode) or info.st_size!=12225:raise ValueError('held lifecycle regular extent')
 raw=path.read_bytes()
 if sha(raw)!=PINS[name] or raw!=git('show','HEAD:'+name):raise ValueError('held lifecycle helper')
 spec=importlib.util.spec_from_file_location('held_file_lifecycle',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def run(inputs,out,head):
 out=Path(out);out.mkdir();scratch=Path(inputs['scratch']);scratch.mkdir();before=inventory(head)
 h=held()
 from build import build
 (out/'source-before.json').write_text(json.dumps(before,sort_keys=True)+'\n');rb=h.runtime();(out/'runtime-before.json').write_text(json.dumps(rb,sort_keys=True)+'\n')
 client,meta=build();(scratch/'client.le').write_bytes(client);(out/'client.json').write_text(json.dumps(meta,sort_keys=True)+'\n');(scratch/'client.json').write_text(json.dumps(meta))
 node=rb['node']['path'];python=rb['python3']['path'];probe=str(ROOT/'scripts/i80386-dos32a-file-readback/probe.mjs')
 subprocess.run([node,probe,'media',inputs['extender'],str(scratch/'client.le'),inputs['license'],str(scratch/'initial.raw')],check=True,timeout=20)
 admitted={}
 for name,path,size,digest in [('bios',inputs['bios'],65536,'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'),('vga',inputs['vga'],38400,'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'),('floppy',inputs['floppy'],1228800,'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'),('extender',inputs['extender'],27504,'d189be603e72f79d3c2f68114eb34d0cab8bd9744ef0f327497d57bcd8e16817'),('license',inputs['license'],1821,'116fded3b2c68e4884dae6cdfe420d5df03807cc2e06bd888a3a74f02e5975b0')]:
  p=Path(path);data=p.read_bytes()
  if p.is_symlink() or not p.is_file() or len(data)!=size or sha(data)!=digest:raise ValueError('fixed media '+name)
  admitted[name]={'bytes':size,'sha256':digest}
 (out/'input-admission.json').write_text(json.dumps(admitted,sort_keys=True)+'\n')
 shutil.copyfile(inputs['license'],out/'DOS32A-LICENSE.txt');(out/'DOS32A-ACKNOWLEDGMENT.txt').write_text('This product uses DOS/32 Advanced DOS Extender technology.\n')
 shutil.copyfile(ROOT/'roms/free-at-bios/LICENSE',out/'free-bios-LICENSE.txt');shutil.copyfile(ROOT/'roms/free-at-bios/README.md',out/'free-bios-README.txt')
 initial=(scratch/'initial.raw').read_bytes();initial_fat=initial[9216:30208]
 (out/'initial-regions.json').write_text(json.dumps(regions(initial,initial_fat))+'\n')
 # All four receive the same immutable initial bytes; each engine owns its fresh copy.
 prior=h.resource_state()
 for engine,key in [('target','a'),('oracle','a'),('target','b'),('oracle','b')]:
  observation=h.resource_state();h.no_oom(prior,observation)
  name=engine+'-'+key;case=out/name;case.mkdir();work=scratch/name;work.mkdir()
  inp={**inputs,'disk':str(scratch/'initial.raw'),'diskSha256':sha(initial),'key':key,'client':str(scratch/'client.le'),'clientSha256':sha(client),'metadata':str(scratch/'client.json'),'qemu':rb['qemu-system-i386']['path'],'oracleBios':rb['bios-256k.bin'],'oracleVga':rb['vgabios-stdvga.bin']}
  ip=work/'input.json';ip.write_text(json.dumps(inp));command=[node,'--max-old-space-size=512',probe,'target',str(ip),str(work)] if engine=='target' else [python,'-B',str(ROOT/'scripts/i80386-dos32a-file-readback/oracle.py'),str(ip),str(work)]
  primary=None;retention=[]
  try:prior=h.child(command,case)
  except BaseException as e:primary=e
  try:outputs=list(work.iterdir())
  except BaseException as e:
   outputs=[]
   if primary is None:primary=e
   else:retention.append('output enumeration: '+str(e))
  for p in outputs:
   try:
    if p.is_file() and p.name not in ['disk.raw','input.json'] and p.stat().st_size<=4<<20:shutil.copyfile(p,case/p.name)
   except BaseException as e:
    if primary is None:primary=e
    else:retention.append(str(e))
  try:
   if (work/'disk.raw').exists():(case/'disk-regions.json').write_text(json.dumps(regions((work/'disk.raw').read_bytes(),initial_fat))+'\n')
  except BaseException as e:
   if primary is None:primary=e
   else:retention.append(str(e))
  if primary:
   try:(out/'failure.json').write_text(json.dumps({'case':name,'firstFailure':str(primary),'retentionSecondary':retention})+'\n')
   except BaseException as e:retention.append('failure receipt: '+str(e))
   for note in retention:
    try:primary.add_note('retention: '+note)
    except BaseException:pass
   raise primary
  if sha((scratch/'initial.raw').read_bytes())!=sha(initial):raise ValueError('initial media mutated')
 after=inventory(head);ra=h.runtime();(out/'source-after.json').write_text(json.dumps(after,sort_keys=True)+'\n');(out/'runtime-after.json').write_text(json.dumps(ra,sort_keys=True)+'\n')
 if before!=after or rb!=ra:raise ValueError('source/runtime drift')
if __name__=='__main__':
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='mode',required=True);a=sub.add_parser('inventory');a.add_argument('head');a.add_argument('output');a=sub.add_parser('run');a.add_argument('input');a.add_argument('output');a.add_argument('head');a=p.parse_args()
 if a.mode=='inventory':Path(a.output).write_text(json.dumps(inventory(a.head),sort_keys=True)+'\n')
 else:run(json.loads(Path(a.input).read_text()),a.output,a.head)

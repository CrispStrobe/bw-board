from pathlib import Path
import json,hashlib,subprocess
P=Path(__file__).parent;W=Path('/mnt/volume1/tmp-astra/worktrees/bw-board-386-owned-span-parity-results-20261002');load=lambda f:json.loads((P/f).read_bytes());sha=lambda b:hashlib.sha256(b).hexdigest()
b=load('baseline.json');r=b['reference'];i=load('invocation.json');e=load('exit.json');e={k:(v['value'] if isinstance(v,dict) and set(v)=={'value'} else v)for k,v in e.items()};checks=0
def ck(v):
 global checks
 assert v;checks+=1
ck(e['exitCode']==0 and not e['timedOut']);ck(i['sourceBefore']==e['sourceAfter'] and i['gitBefore']==e['gitAfter'] and i['helpersBefore']==e['helpersAfter']);ck(i['headBefore']==e['headAfter']=='60a9b11ab480531e692dbac70ecbb35430cf425d');ck(i['statusBefore']==e['statusAfter']=='');ck(not(P/'stderr').read_bytes());ck(sha((P/'baseline.json').read_bytes())=='92e2fd339115d97e84eae28d09f00f1a4a4d5c1178fad38ada17ab79b8eec8ce');ck(b['sourceBefore']==b['sourceAfter']);ck(len(b['sourceBefore']['hashes'])==48)
for f,h in b['sourceBefore']['hashes'].items():ck(sha(subprocess.check_output(['git','show',b['sourceBefore']['revision']+':'+f],cwd=W))==h)
ck(i['cpuSeconds']==15 and i['wallSeconds']==30 and i['heapMiB']==128 and i['fileBytes']==8<<20 and i['coreBytes']==0 and i['niceIncrement']==10);ck(set(i['blankEnvironment'].values())=={''})
ck(r['q']==316562 and len(r['ports'])==16475 and len(r['cuts'])==15);last=0
outvals={0x0d:{0},0xda:{0},0xd4:{0},0xd6:{0xc0},0x70:{15},0x71:{0},0x43:{0x34},0x40:{0},0x80:{0},0x64:{0xaa,0xab}}
for n,p in enumerate(r['ports'],1):
 ck(p['ordinal']==n and last<=p['q']<=r['q'] and p['cycles']==4+6*(p['q']-1) and p['width']==8);last=p['q'];ck(0<=p['value']<=255)
 ck((p['dir']=='out' and(p['port']==0x402 or p['value'] in outvals.get(p['port'],set())))or(p['dir']=='in' and p['port']in[0x71,0x64,0x60]))
ck([(p['dir'],p['port'],p['value'])for p in r['ports'] if p['port']==0x64 and p['dir']=='out' or p['port']==0x60 and p['dir']=='in']==[('out',100,170),('in',96,85),('out',100,171),('in',96,0)])
for rec,(site,width,count,dest,value) in zip(r['reps'],[(0xe0c4,2,128,0x400,0),(0x9daf,4,120,0,0xf000ff53),(0x9e3a,2,16,0x180,0),(0x9e44,4,136,0x1e0,0)]):
 ck(rec['siteEip']==site and len(rec['elements'])==count and rec['exit']['q']-rec['entry']['q']==count);c=rec['entry']['cpu'];ck(c['cs']==0xf000 and c['es']==0 and c['ecx']&65535==count and c['edi']&65535==dest and(c['eax']&65535 if width==2 else c['eax'])==value and not c['eflags']&0x400)
 for n,el in enumerate(rec['elements']):ck(el['q']==rec['entry']['q']+n+1 and el['cx']==count-n-1 and el['di']==dest+(n+1)*width and el['address']==dest+n*width and el['afterBytes']==list(value.to_bytes(width,'little')) and el['eip']==(site if n+1<count else site+(2 if width==2 else 3)))
for c in r['cuts']+[r['final']]:ck(c['cpu']['cycles']==c['q'] and c['board']['cycles']==4+6*c['q'] and not c['cpu']['halted'] and not c['cpu']['eflags']&0x200 and c['board']['a20Enabled'])
ck(r['final']['cpu']['cs']==0xf000 and r['final']['cpu']['eip']==0xe16 and r['final']['board']['debt']==0);ck(r['final']['ramSha256']=='c188c7153084dc45e45a503fc2b5e0e3ab0b81dcbc7a1ef59cfd1c5a3b4de5d2');ck(len(r['codePages'])==5);ck(r['final']['board']['pic1']['irr']==1 and r['final']['board']['pic1']['isr']==0 and r['final']['board']['pic1']['imr']==0 and r['final']['board']['pic1']['intActive']);ck('# pass 8' in(P/'stdout.txt').read_text())
out={'status':'PASS_INDEPENDENT_AUTHENTICATED_JS_COLD_BASELINE_ONLY','checks':checks,'sourceInputs':48,'quanta':r['q'],'ports':len(r['ports']),'repElements':400,'namedCuts':15,'scope':'Ordinary JS only; raw RAM hash attested by private oracle, full RAM bytes not retained here; no native/reset-normalization/performance claim.'};(P/'independent-audit.json').write_text(json.dumps(out,indent=2)+'\n');print(out)

import pathlib,json,hashlib,re,subprocess
P=pathlib.Path(__file__).parent;W=pathlib.Path('/tmp/bw-board-386-native-hot-packed-scalar-20261001');sha=lambda b:hashlib.sha256(b).hexdigest();d=json.loads((P/'derivation.json').read_text());checks=0;inventory={}
def eq(a,b,label):
 global checks
 assert a==b,(label,a,b);checks+=1
for label,x in d['children'].items():
 original=(W/x['originalPath']).read_bytes();generated=pathlib.Path(x['generatedPath']).read_bytes();eq(sha(original),x['originalSha256'],'original '+label);eq(original,subprocess.check_output(['git','show',d['revision']+':'+x['originalPath']],cwd=W),'original historical '+label);eq(sha(generated),x['generatedSha256'],'generated '+label)
 restored=generated.decode()
 for c in reversed(x['reversibleExactChanges']):eq(restored.count(c['new']),c['occurrences'],'inverse seam '+label);restored=restored.replace(c['new'],c['old'])
 eq(restored,original.decode(),'exact restored '+label)
 roots=[c['new'] for c in x['reversibleExactChanges'] if c['old'].startswith('const root=')];eq(roots,['const root="'+str(W)+'",'],'fixed original root '+label)
 s=original.decode();seeds=re.search(r"for\(const p of (\[[^\n]+?\])\)visit\(p\)",s).group(1);paths=set()
 def visit(p):
  if p in paths:return
  paths.add(p);raw=(W/p).read_bytes();eq(raw,subprocess.check_output(['git','show',d['revision']+':'+p],cwd=W),'input '+p)
  if p.endswith(('.mjs','.js')):
   for dep in re.findall(r"(?:from\s+|import\s*)['\"](\.[^'\"]+)['\"]",raw.decode()):visit(str((W/p).parent.joinpath(dep).resolve().relative_to(W)))
 for p in json.loads(seeds.replace("'",'"')):visit(p)
 eq(len(paths),55 if label=='H3' else 61,'inventory census '+label);inventory[label]={'count':len(paths),'hashes':{p:sha((W/p).read_bytes()) for p in sorted(paths)}}
eq(sha((P/'derive.py').read_bytes()),d['generatorSha256'],'generator binding')
r=(P/'run.py').read_bytes();eq(sha(r),'6a0da47b76592237a1dfdaf61f8304d8a6774097adc811addf6a3dfba6049142','parent helper hash')
text=r.decode()
for literal in ['for index in range(9):','warmup\':index<2','meanCpuReduction>=0.10 and all(x[\'H4\']<x[\'H3\'] for x in cpuPairs)','assert {name:sha((P/name).read_bytes()) for name in externalBefore}==externalBefore','assert sha(pathlib.Path(__file__).read_bytes())==helperBefore']:eq(literal in text,True,'parent policy '+literal)
report={'status':'CPU_HELPER_SOURCE_ONLY_AUDIT_PASS_NO_EXECUTION','checks':checks,'revision':d['revision'],'parentSha256':sha(r),'generatorSha256':d['generatorSha256'],'inventories':inventory,'metricScope':'process-wide all-thread user+system microseconds around actual resume/scheduler loop, includes small timing overhead, excludes startup/settlement/serialization; not pure engine','criterion':'two warmups then seven alternating pairs; ratio of mean CPU totals at least10% lower and every H4 CPU pair lower','sourceDelta':'absolute import relocation/fixed original root, captured cpuUsage initialization, execution start/end and timing metadata only; exact reverse to original drivers verified'}
(P/'independent-helper-audit.json').write_text(json.dumps(report,indent=2)+'\n');print('PASS',checks)

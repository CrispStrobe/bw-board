from pathlib import Path
from collections import Counter
import json,hashlib
P=Path(__file__).resolve().parent;H=Path('/mnt/volume1/tmp-astra/native-owned-baseline-profile-analysis-prepared-20261002');j=lambda p:json.loads(p.read_bytes());h=lambda p:hashlib.sha256(p.read_bytes()).hexdigest();A=j(H/'approved-bindings.json');x=j(P/'analysis.json');checks=0
def ck(v):
 global checks
 assert v;checks+=1
ck(h(H/'approved-bindings.json')=='fb38167b447165802f8782dc88b6ebfeed98f7a3419d8753fdbe2d9ca16605cc');ck(j(H/'actual-before.json')==j(H/'actual-after.json'))
for n,r in A['inputs'].items():ck(h(Path(r['path']))==r['sha256']==x['inputHashes'][n])
for n,v in A['helperHashes'].items():ck(h(H/n)==v)
e=j(H/'actual.exit.json');ck(e['returncode']==0 and not e['timedOut']);ck(all(h(H/('actual.'+s))==v for s,v in e['streams'].items()))
raw=j(Path(A['inputs']['profile']['path']));ph=j(Path(A['inputs']['phases']['path']));nodes={n['id']:n for n in raw['nodes']};parents={}
for n in nodes.values():
 for kid in n.get('children',[]):ck(kid not in parents);parents[kid]=n['id']
url=x['resumeCallsiteUrl'];leaves=Counter();inclusive=Counter();cats=Counter();stacks=Counter();tape=[];selected=[];stamp=raw['startTime']
def key(frame):return tuple(frame[k]for k in ['functionName','url','lineNumber','columnNumber','scriptId'])
def category(frame,anc):
 name=frame['functionName']
 if name in ['(root)','(program)','(garbage collector)','(idle)']:return {'(root)':'unattributed-root','(program)':'program','(garbage collector)':'garbage-collector','(idle)':'idle'}[name]
 if frame['url']:return 'javascript-frame'
 if name=='close'and any(v['functionName']=='resume'and v['url']==url for v in anc):return 'native-shared-invoke-alias-under-resume'
 return 'unattributed-native-or-empty-frame'
for i,(n,d)in enumerate(zip(raw['samples'],raw['timeDeltas'])):
 prev=stamp;stamp+=d;sel=ph['executionBeginUs']<=stamp<=ph['executionEndUs'];tape.append({'index':i,'nodeId':n,'deltaUs':d,'previousTimestampUs':prev,'timestampUs':stamp,'selected':sel,'executionIntersectionUs':max(0,min(stamp,ph['executionEndUs'])-max(prev,ph['executionBeginUs']))})
 if not sel:continue
 selected.append(i);path=[n]
 while path[-1]in parents:path.append(parents[path[-1]])
 frames=[nodes[k]['callFrame']for k in reversed(path)];c=category(frames[-1],frames[:-1]);cats[c]+=1;leaves[(c,*key(frames[-1]))]+=1;stacks[tuple(key(v)for v in frames)]+=1
 for k in set((category(v,frames[:index]),*key(v))for index,v in enumerate(frames)):inclusive[k]+=1
ck(tape==x['sampleTape']);ck(selected==x['selectedIndices']);ck(cats==x['leafCategories']);ck(len(selected)==111 and len(tape)==112);ck(sum(leaves.values())==111)
def decode(rows):return Counter({(r['category'],r['functionName'],r['url'],r['lineNumber'],r['columnNumber'],r['scriptId']):r['samples']for r in rows})
ck(leaves==decode(x['mutuallyExclusiveLeaves']));ck(inclusive==decode(x['inclusiveFunctions']));ck(stacks==Counter({tuple(key(v)for v in r['frames']):r['samples']for r in x['inclusiveStacks']}));ck(all(v<=111 for v in inclusive.values()));ck(x['nodeCallFrames']=={str(n):v['callFrame']for n,v in nodes.items()})
ck([r['samples']for r in x['mutuallyExclusiveLeaves']]==sorted(leaves.values(),reverse=True));ck([r['samples']for r in x['inclusiveFunctions']]==sorted(inclusive.values(),reverse=True))
out={'status':'PASS_INDEPENDENT_RECONSTRUCTION_READONLY_PROFILE_ANALYSIS','checks':checks,'selectedSamples':111,'rawSamples':112,'leafCategories':dict(cats),'analysisSha256':h(P/'analysis.json'),'scope':'Full cumulative sample tape/window/leaf partition/inclusive recursion-dedup and stacks independently reconstructed without analyzer imports; actual inputs/helpers/exit/streams/auth pins unchanged. Shared close alias under exact hosted resume ancestry verified. Qualitative samples only, no all-thread CPU fractions/speed/core-vs-NAPI split.','nextTarget':'Source-only review of NAPI snapshot materialization / resume wrapper is a defensible next hypothesis: shared native invoke alias has28 leaf samples, JS resume15; exact preserved full166 output semantics must remain. Alias cannot distinguish native CPU execution from snapshot construction. Clock dispatch also appears10 leaf samples, but rejected bulk gate remains failed; no presumed gain.'};q=P/'independent-audit.json';assert not q.exists();q.write_text(json.dumps(out,indent=2)+'\n');print(json.dumps(out))

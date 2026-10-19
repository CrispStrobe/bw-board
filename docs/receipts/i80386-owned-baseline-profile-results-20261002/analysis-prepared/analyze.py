"""Prepared read-only Inspector analysis. No Inspector, addon, or guest execution."""
import json,hashlib,pathlib,sys,collections,re
MAX_SAFE=2**53-1

def integer(v,lo=0,hi=MAX_SAFE):
 assert type(v)is int and lo<=v<=hi
 return v

def validate_profile(profile):
 assert type(profile)is dict
 start=integer(profile['startTime']);end=integer(profile['endTime']);assert start<=end
 nodes=profile['nodes'];samples=profile['samples'];deltas=profile['timeDeltas']
 assert type(nodes)is list and 1<=len(nodes)<=100000
 assert type(samples)is list and type(deltas)is list and 0<len(samples)==len(deltas)<=200000
 by_id={};parents={}
 for node in nodes:
  assert type(node)is dict;number=integer(node['id'],1,2**32-1);assert number not in by_id;by_id[number]=node
  frame=node['callFrame'];assert type(frame)is dict
  for key in ['functionName','scriptId','url']:assert type(frame[key])is str and len(frame[key])<=16384
  integer(frame['lineNumber'],-1,2**31-1);integer(frame['columnNumber'],-1,2**31-1)
  children=node.get('children',[]);assert type(children)is list and len(children)<=100000;assert len(set(children))==len(children)
  for child in children:
   integer(child,1,2**32-1);assert child not in parents;parents[child]=number
 for child in parents:assert child in by_id,'dangling child ID'
 roots=set(by_id)-set(parents);assert len(roots)==1,'missing or ambiguous profile root'
 root=next(iter(roots));paths={root:[root]};pending=[root];path_elements=1
 while pending:
  number=pending.pop()
  for child in by_id[number].get('children',[]):
   assert child not in paths,'cycle';assert len(paths[number])<512,'bounded stack depth';path_elements+=len(paths[number])+1;assert path_elements<=1000000,'bounded path storage';paths[child]=paths[number]+[child];pending.append(child)
 assert len(paths)==len(by_id),'cycle or disconnected nodes'
 tape=[];timestamp=start
 for index,(sample,delta)in enumerate(zip(samples,deltas)):
  integer(sample,1,2**32-1);assert sample in by_id,'dangling sample ID';integer(delta);previous=timestamp;timestamp=integer(timestamp+delta);assert timestamp<=end,'sample beyond profile end'
  tape.append({'index':index,'nodeId':sample,'deltaUs':delta,'previousTimestampUs':previous,'timestampUs':timestamp})
 return by_id,paths,tape

def frame_key(frame):return (frame['functionName'],frame['url'],frame['lineNumber'],frame['columnNumber'],frame['scriptId'])
def classify(frame,ancestors,resume_url):
 name=frame['functionName'];url=frame['url']
 if name=='(program)':return 'program'
 if name=='(garbage collector)':return 'garbage-collector'
 if name=='(idle)':return 'idle'
 if name=='(root)':return 'unattributed-root'
 if url:return 'javascript-frame'
 if name=='close'and any(a['functionName']=='resume'and a['url']==resume_url for a in ancestors):return 'native-shared-invoke-alias-under-resume'
 return 'unattributed-native-or-empty-frame'

def analyze(profile,phases,resume_url):
 by_id,paths,tape=validate_profile(profile)
 keys=['setupBeginUs','startCallBeginUs','startCallEndUs','executionBeginUs','executionEndUs','stopCallBeginUs','stopCallEndUs'];values=[integer(phases[k])for k in keys];assert values==sorted(values);begin=phases['executionBeginUs'];end=phases['executionEndUs'];assert begin<end and profile['startTime']<=begin<end<=profile['endTime']
 selected=[];leaves=collections.Counter();inclusive=collections.Counter();stacks=collections.Counter();categories=collections.Counter()
 for sample in tape:
  sample['selected']=begin<=sample['timestampUs']<=end;sample['executionIntersectionUs']=max(0,min(sample['timestampUs'],end)-max(sample['previousTimestampUs'],begin))
  if not sample['selected']:continue
  selected.append(sample['index']);frames=[by_id[n]['callFrame']for n in paths[sample['nodeId']]];category=classify(frames[-1],frames[:-1],resume_url);leaf=(category,*frame_key(frames[-1]));leaves[leaf]+=1;categories[category]+=1
  # Inclusive function identity gets at most one credit per sample, including recursion.
  seen=set()
  for index,frame in enumerate(frames):
   key=(classify(frame,frames[:index],resume_url),*frame_key(frame))
   if key not in seen:inclusive[key]+=1;seen.add(key)
  stacks[tuple(frame_key(f)for f in frames)]+=1
 assert selected,'no execution samples';assert sum(leaves.values())==sum(categories.values())==len(selected)
 def rows(counter):return [{'category':key[0],'functionName':key[1],'url':key[2],'lineNumber':key[3],'columnNumber':key[4],'scriptId':key[5],'samples':count}for key,count in sorted(counter.items(),key=lambda p:(-p[1],p[0]))]
 return {'selectedIndices':selected,'sampleTape':tape,'sampleCount':len(tape),'executionSampleCount':len(selected),'leafCategories':dict(categories),'mutuallyExclusiveLeaves':rows(leaves),'inclusiveFunctions':rows(inclusive),'inclusiveStacks':[{'frames':[{'functionName':k[0],'url':k[1],'lineNumber':k[2],'columnNumber':k[3],'scriptId':k[4]}for k in key],'samples':count}for key,count in sorted(stacks.items(),key=lambda p:(-p[1],p[0]))],'nodeCallFrames':{str(n):node['callFrame']for n,node in by_id.items()},'lineNumberConvention':'Original zero-based Inspector line/column values; no source location invented.','accounting':'Leaf sample counts partition selected samples. Inclusive rows overlap and must not be summed. Interval intersections are timestamp bookkeeping, not attributed CPU time.','limitations':['Qualitative isolate stack samples only; no CPU shares or speed claim.','All process threads, physical RTx, native core versus NAPI snapshot cost are not resolved.','Native shared invoke may be named close under resume; this is not actual close cost.','Unattributed/program/GC/idle remain explicit actual-frame categories.']}

def read_regular(path,cap=32<<20):
 p=pathlib.Path(path);assert p.is_absolute()and not p.is_symlink()and p.is_file()and p.stat().st_size<=cap;return p.read_bytes()
def digest(data):return hashlib.sha256(data).hexdigest()
def main(binding_path):
 binding=json.loads(read_regular(binding_path));assert binding['status']=='ROOT_APPROVED_READONLY_PROFILE_ANALYSIS';P=pathlib.Path(__file__).resolve().parent
 for name,h in binding['helperHashes'].items():assert digest(read_regular(P/name))==h
 raw={};inputs={}
 for name,record in binding['inputs'].items():
  data=read_regular(record['path']);assert digest(data)==record['sha256'];raw[name]=data;inputs[name]=json.loads(data)if name not in ['runner','admission']else data.decode()
 for name in ['profile','phases','alignment','capture','derivation','summary','runner','admission','diagnosticManifest']:assert name in inputs
 profile=inputs['profile'];phases=inputs['phases'];alignment=inputs['alignment'];capture=inputs['capture'];derivation=inputs['derivation'];assert alignment['status']=='NONGUEST_INSPECTOR_HRTIME_DOMAIN_PASS'and alignment['node']=='v22.23.3';assert alignment['toleranceUs']==1000
 for key in ['beforeStart','afterStart','beforeStop','afterStop']:integer(alignment[key])
 assert alignment['beforeStart']<=alignment['afterStart']<=alignment['beforeStop']<=alignment['afterStop'];validate_profile(alignment['profile'])
 assert alignment['beforeStart']-1000<=alignment['profile']['startTime']<=alignment['afterStart']+1000;assert alignment['beforeStop']-1000<=alignment['profile']['endTime']<=alignment['afterStop']+1000
 assert capture['profiling']['phases']==phases and capture['profiling']['samplingIntervalUs']==1000;assert capture['profiling']['derivative']==derivation['identity'];assert derivation['derivedSha256']==digest(raw['runner']);assert capture['source']['revision']=='fe1eff2039520536350922a2164c8bbe29404c68'and len(capture['source']['hashes'])==103
 identity=derivation['identity'];assert identity['sourceRevision']==capture['source']['revision'];manifest=identity['diagnosticManifest'];assert identity['diagnosticManifestSha256']==binding['diagnosticManifestSha256'];assert manifest['alignmentSha256']==digest(raw['alignment']);assert manifest==inputs['diagnosticManifest'] and identity['diagnosticManifestSha256']==digest(raw['diagnosticManifest']);assert inputs['summary']['status']=='ACTUAL_SINGLE_BASELINE_PROFILE_FULL_PARITY_PASS';assert inputs['summary']['captureSha256']==digest(raw['capture'])and inputs['summary']['profileSha256']==digest(raw['profile'])and inputs['summary']['alignmentSha256']==digest(raw['alignment'])and inputs['summary']['derivationSha256']==digest(raw['derivation'])
 # Exact source-owned callsite, not a guessed native export name.
 inverse=inputs['runner']
 for seam in reversed(derivation['seams']):assert inverse.count(seam['after'])==1;inverse=inverse.replace(seam['after'],seam['before'])
 assert digest(inverse.encode())==derivation['originalSha256']==capture['source']['hashes']['scripts/run-i80386-native-owned-in8.mjs']==identity['originalRunnerSha256']
 assert digest(raw['admission'])==identity['admissionSha256']==derivation['admission']['derivedSha256']
 admission_inverse=inputs['admission']
 for before,after in reversed(derivation['admission']['seams']):assert admission_inverse.count(after)==1;admission_inverse=admission_inverse.replace(after,before)
 assert digest(admission_inverse.encode())==derivation['admission']['originalSha256']==capture['source']['hashes']['scripts/bochs-cpu3-native-owned-in8/admission.mjs']
 original_admission_paths=[]
 for seam in derivation['seams']:
  match=re.fullmatch(r'from (".*profile-admission\.mjs")',seam['after'])
  if match:original_admission_paths.append(json.loads(match.group(1)))
 assert len(original_admission_paths)==1
 resume_url=(pathlib.Path(original_admission_paths[0]).parent/'profile-runner.mjs').as_uri();assert 'result=resume(n,q,d)'in inputs['runner']
 result=analyze(profile,phases,resume_url);assert result['selectedIndices']==inputs['summary']['executionSampleIndices'];assert result['executionSampleCount']==inputs['summary']['executionSampleCount'];result.update(status='READONLY_EXECUTION_PROFILE_QUALITATIVE_ANALYSIS_PASS',inputHashes={n:digest(v)for n,v in raw.items()},phases=phases,diagnosticIdentity=identity,resumeCallsiteUrl=resume_url)
 out=pathlib.Path(binding['outputDirectory']);assert out.is_absolute()and not out.exists();out.mkdir();
 with(out/'analysis.json').open('x')as f:json.dump(result,f,indent=2);f.write('\n')
 for name,record in binding['inputs'].items():assert read_regular(record['path'])==raw[name]
 print(json.dumps({'status':result['status'],'selectedSamples':result['executionSampleCount'],'rawSamples':result['sampleCount'],'output':str(out/'analysis.json')}))
if __name__=='__main__':assert len(sys.argv)==2;main(sys.argv[1])

import pathlib,hashlib,json,re,subprocess
W=pathlib.Path('/tmp/bw-board-386-clock-batch-witness-20261002');P=pathlib.Path('/mnt/volume1/tmp-astra');p=W/'scripts/run-i80386-native-hot-clock-fenced.mjs';raw=p.read_text();s=raw;changes=[]
def remove(x):
 global s
 assert s.count(x)==1,x;s=s.replace(x,'');changes.append(x)
remove("import {fenceWriter} from './bochs-cpu3-native-clock-batch-witness/fences.mjs';\n")
s=s.replace("'scripts/run-i80386-native-hot-clock-fenced.mjs'","'scripts/run-i80386-native-hot-packed-scalar.mjs'")
remove("assert.equal(input.hostJournal,true,'fenced capture requires compact journal');assert.equal(input.nativeTrace,true,'fenced capture requires complete native trace');")
remove("const fences=fenceWriter(input.output+'/fences.jsonl',board);fences.record('start',0,reset);\n")
remove("fences.record('stage-irq',resumes,final??reset);")
remove("fences.record('entry',resumes+1,final??reset,{maxNative:600,maxQuanta:Math.min(300,remaining)});")
remove("fences.record('return',resumes+1,final,{reason:final.reason,chargedNativeTicks:final.chargedNativeTicks,chargedQuanta:final.chargedQuanta});")
remove("fences.record('inspect',resumes,final);")
remove("fences.record('settle',resumes,final);")
remove("fences.record('close',resumes,final);const fenceCapture=fences.close();")
remove("fenceCapture,diagnosticOnly:'extra synchronous fence writes exclude timing qualification',")
remove("'scripts/bochs-cpu3-native-clock-batch-witness/contract.md','scripts/bochs-cpu3-native-clock-batch-witness/model.mjs','scripts/bochs-cpu3-native-clock-batch-witness/capture.mjs','scripts/audit-i80386-native-clock-batch-witness.mjs','test/i80386-native-clock-batch-witness.test.mjs',")
original=(W/'scripts/run-i80386-native-hot-packed-scalar.mjs').read_text();assert s==original, '\n'.join(__import__('difflib').unified_diff(original.splitlines(),s.splitlines()));assert original.encode()==subprocess.check_output(['git','show','15631beb63d7c1f17e693de7c86d4ed37b96a768:scripts/run-i80386-native-hot-packed-scalar.mjs'],cwd=W)
sha=lambda b:hashlib.sha256(b).hexdigest();seeds=json.loads(re.search(r'for\(const p of (\[[^\n]+?\])\)visit',raw).group(1).replace("'",'"'));seen=set()
def visit(n):
 if n in seen:return
 seen.add(n);r=(W/n).read_text()
 if n.endswith(('.mjs','.js')):
  for x in re.findall(r"(?:from\s+|import\s*)['\"](\.[^'\"]+)['\"]",r):visit(str((W/n).parent.joinpath(x).resolve().relative_to(W)))
for n in seeds:visit(n)
out={'status':'INDEPENDENT_FENCED_DRIVER_EXACT_DIAGNOSTIC_INVERSE_PASS','originalH4Revision':'15631beb63d7c1f17e693de7c86d4ed37b96a768','originalH4DriverSha256':sha(original.encode()),'fencedDriverSha256':sha(raw.encode()),'diagnosticRemovals':changes,'identitySeedRelabel':'original H4 driver seed becomes actual fenced driver seed','exactOriginalBytesRestored':True,'driverSourceClosureCount':len(seen),'driverSourceHashes':{n:sha((W/n).read_bytes()) for n in sorted(seen)},'noGuestBuildBenchmark':True};(P/'clock-witness-independent-driver-inverse-20261002.json').write_text(json.dumps(out,indent=2)+'\n');print(out['status'],len(seen))

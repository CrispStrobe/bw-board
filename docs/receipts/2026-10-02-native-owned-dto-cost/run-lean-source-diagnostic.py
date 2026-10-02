# Source-only codec/MessageChannel tests: no addon load or CPU guest.
from pathlib import Path
import hashlib,json,subprocess,os
P=Path(__file__).resolve().parent;W=Path('/tmp/bw-board-386-native-owned-dto-20261002');NODE='/tmp/node-v22.23.3-linux-x64/bin/node';sha=lambda b:hashlib.sha256(b).hexdigest()
sourcePaths=['scripts/compare-i80386-owned-dto-codecs.mjs','scripts/bochs-cpu3-native-owned-dto/response.mjs','scripts/bochs-cpu3-native-owned-dto/ipc-response.mjs','scripts/bochs-cpu3-native-owned-dto/board-schema.json','test/i80386-owned-dto-response.test.mjs','test/i80386-owned-dto-message-channel.test.mjs','test/fixtures/i80386-owned-dto-snapshots.json'];sourceHashes={p:sha((W/p).read_bytes()) for p in sourcePaths};helperSha=sha(Path(__file__).read_bytes())
inputPath=Path('/mnt/volume1/tmp-astra/native-owned-clock-cpu-benchmark-20261002/8-ABI3/capture.json');inputSha='246193ed7da4c872df55ddf7593b189f3966f55c45a8e06ef40382efc1b840fe';assert inputPath.is_file() and inputPath.stat().st_size<=16*1024*1024 and sha(inputPath.read_bytes())==inputSha
before={'status':'SOURCE_ONLY_BEFORE_EXECUTION_IDENTITY','sourceHashes':sourceHashes,'helperSha256':helperSha,'input':{'path':str(inputPath),'sha256':inputSha}}
(P/'lean-auth-before.json').write_text(json.dumps(before,indent=2)+'\n');records=[]
commands=[('lean-focused',[NODE,'--max-old-space-size=512','--test','test/i80386-owned-dto-response.test.mjs','test/i80386-owned-dto-message-channel.test.mjs']),('lean-codec',[NODE,'--max-old-space-size=512','scripts/compare-i80386-owned-dto-codecs.mjs',str(inputPath),inputSha,str(P/'lean-codec.json')])]
for label,command in commands:
 for path in sourcePaths:assert (W/path).is_file()
 with (P/(label+'.stdout')).open('xb') as out,(P/(label+'.stderr')).open('xb') as err:r=subprocess.run(command,cwd=W,stdout=out,stderr=err,timeout=60,env={**os.environ,'NODE_OPTIONS':''})
 records.append({'label':label,'command':command,'cwd':str(W),'exitCode':r.returncode,'streams':{k:{'sha256':sha((P/(label+'.'+k)).read_bytes()),'bytes':(P/(label+'.'+k)).stat().st_size} for k in ['stdout','stderr']}});assert r.returncode==0,records[-1]
 assert {p:sha((W/p).read_bytes()) for p in sourcePaths}==sourceHashes and sha(inputPath.read_bytes())==inputSha and sha(Path(__file__).read_bytes())==helperSha
(P/'lean-auth-after.json').write_text(json.dumps(before,indent=2)+'\n');(P/'lean-execution-receipt.json').write_text(json.dumps({'status':'SOURCE_ONLY_DIAGNOSTIC_PASS_NO_NATIVE_GUEST_OR_ADDON_LOAD','beforeAfterIdentity':before,'records':records,'resultSha256':sha((P/'lean-codec.json').read_bytes())},indent=2)+'\n');print('PASS source diagnostics; no native execution')

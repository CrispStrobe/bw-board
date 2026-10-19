import pathlib,hashlib,json,re,subprocess,difflib
P=pathlib.Path(__file__).parent;sha=lambda b:hashlib.sha256(b).hexdigest()
proof={}
for label,name,revision,worktree in [('H4','run-i80386-native-hot-packed-scalar.mjs','15631beb63d7c1f17e693de7c86d4ed37b96a768','/tmp/bw-board-386-native-hot-packed-scalar-20261001'),('H5','run-i80386-native-hot-packed-args.mjs','ef106b4ae3a2ca55e9cc3253597ec66773e07847','/tmp/bw-board-386-native-hot-packed-args-20261001')]:
 W=pathlib.Path(worktree)
 path='scripts/'+name;raw=(W/path).read_bytes();assert raw==subprocess.check_output(['git','show',revision+':'+path],cwd=W);original=raw.decode();text=original;changes=[]
 def replace(old,new,expected=1):
  global text
  assert text.count(old)==expected,(label,old,text.count(old));text=text.replace(old,new);changes.append({'old':old,'new':new,'occurrences':expected})
 for relative in re.findall(r"from '(\.[^']+)'",original):replace("from '"+relative+"'","from '"+str((W/'scripts'/relative).resolve())+"'")
 replace("const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),", "const root="+json.dumps(str(W))+",")
 replace('const executionStart=process.hrtime.bigint();', 'const executionCpuStart=capturedCpuUsage();const executionStart=process.hrtime.bigint();')
 replace(' const executionNs=Number(process.hrtime.bigint()-executionStart);',' const executionNs=Number(process.hrtime.bigint()-executionStart);const executionCpuDelta=capturedCpuUsage(executionCpuStart);const executionCpuUserUs=executionCpuDelta.user,executionCpuSystemUs=executionCpuDelta.system,executionCpuTotalUs=executionCpuUserUs+executionCpuSystemUs;')
 replace('startupNs,executionNs,settlementNs,scope:', "startupNs,executionNs,executionCpuUserUs,executionCpuSystemUs,executionCpuTotalUs,executionCpuScope:'process-wide all-thread CPU delta; start cpuUsage then hrtime, end hrtime then cpuUsage; includes tiny timer/usage overhead; excludes startup and settlement',settlementNs,scope:")
 replace("import assert from 'node:assert/strict';", "import assert from 'node:assert/strict';\nconst capturedCpuUsage=process.cpuUsage.bind(process);")
 # Reverse every admitted substitution to demonstrate exact restoration.
 restored=text
 for c in reversed(changes):assert restored.count(c['new'])==c['occurrences'];restored=restored.replace(c['new'],c['old'])
 assert restored==original
 output=P/(label+'-cpu-child.mjs');output.write_text(text);(P/(label+'-diff.txt')).write_text(''.join(difflib.unified_diff(original.splitlines(True),text.splitlines(True),fromfile=path,tofile=str(output))))
 proof[label]={'originalPath':path,'originalRoot':str(W),'originalRevision':revision,'originalSha256':sha(raw),'generatedPath':str(output),'generatedSha256':sha(output.read_bytes()),'reversibleExactChanges':changes,'restoredOriginalIdentical':True,'identitySeedsUnchanged':True}
(P/'derivation.json').write_text(json.dumps({'criterion':{'minimumMeanCpuReduction':0.03,'allSevenFavorableRequired':True,'warmupPairs':2,'measuredPairs':7},'generatorSha256':sha(pathlib.Path(__file__).read_bytes()),'children':proof,'noExecution':True},indent=2))
print(json.dumps({k:v['generatedSha256'] for k,v in proof.items()}))

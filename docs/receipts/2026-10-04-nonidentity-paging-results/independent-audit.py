import pathlib,json,zipfile,hashlib,subprocess
p=pathlib.Path(__file__).parent;z=zipfile.ZipFile(p/'official-artifact.zip');h=lambda b:hashlib.sha256(b).hexdigest();j=lambda n:json.loads(z.read(n));pre='_temp/nonidentity-paging-execution/'
assert h((p/'official-artifact.zip').read_bytes())=='cd972db5688862feb09001c0b68ec407d69ffa3c46f13de3b30befc52168ee02' and len(z.infolist())==98
for i in z.infolist():
 b=z.read(i);q=p/'selected'/i.filename
 if q.exists():assert q.read_bytes()==b
c=j(pre+'guest/capture.json');assert c['status']=='PASS' and c['cleanup']=={'native':'closed','provider':'closed','javascript':'closed'}
for a,b in [('driverBefore','driverAfter'),('compiledBefore','compiledAfter'),('build','buildAfter'),('configuration','configurationAfter'),('nodeBefore','nodeAfter'),('inputSha256Before','inputSha256After')]:assert c[a]==c[b]
for name in ['fixed','restored']:assert j(pre+name+'-before.json')==j(pre+name+'-after.json')
fixed=j(pre+'fixed-before.json');roots={'tooling':'/tmp/bw-native-nonidentity-paging-hosted-source-20261004','compiled':'/tmp/bw-native-nonidentity-paging-build-source-20261004','driver':'/tmp/bw-native-nonidentity-paging-ready-driver-20261004'};sourcecount=0
for role in roots:
 v=fixed[role];rev=v.get('head',c['compiledBefore']['revision'] if role=='compiled' else c['driverBefore']['revision']);mp=v.get('files',v)
 if 'hashes' in mp:mp=mp['hashes']
 for f,d in mp.items():
  assert h(subprocess.check_output(['git','show',rev+':'+f],cwd=roots[role]))==d,(role,f);sourcecount+=1
assert sourcecount==272
sizes=[20,20,90,30,6];keys=['state','extra','segments','system','debug'];comparable=unmatched=0
for idx,x in enumerate(c['boundaries']):
 n=x['native'];s=x['javascript'];cpu=s['cpu'];assert [len(n[k])for k in keys]==sizes
 for k in keys:assert all(type(v)is int and 0<=v<=0xffffffff for v in n[k])
 fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'];assert n['state'][:16]==[cpu[k]for k in fields];assert n['state'][16:]==[cpu['gdtr']['base'],cpu['gdtr']['limit'],cpu['idtr']['base'],cpu['idtr']['limit']];assert n['extra'][2:5]==[cpu[k]for k in ['es','fs','gs']]
 for i,key in enumerate(['es','cs','ss','ds','fs','gs']):
  row=n['segments'][15*i:15*i+15];cache=cpu['segmentCaches'][str(i)];assert [row[0],row[1],row[10],row[11],row[13],row[6]]==[i,cpu[key],cache['base'],cache['limit'],int(cache['default32']),int(cache['present'])]
 assert n['extra'][5:8]==n['segments'][17:20]
 cache=cpu['segmentCaches']['1'];assert [n['extra'][9],n['extra'][13],n['extra'][14],n['extra'][16]]==[int(cache['present']),cache['base'],cache['limit'],int(cache['default32'])]
 assert (n['segments'][25]+n['state'][8])&0xffffffff==cpu['pc']
 for i,key in enumerate(['ldtr','tr']):
  row=n['system'][15*i:15*i+15];v=cpu[key];assert [row[0],row[1],row[10],row[11],row[6]]==[i+6,v['selector'],v['base'],v['limit'],int(v['present'])]
  if 'type'in v:assert row[9]==v['type']
 assert n['debug']==cpu['debugRegisters'][:4]+cpu['debugRegisters'][6:8] and n['extra'][:2]==cpu['debugRegisters'][6:8]
 assert int(n['successfulQuanta'])==s['q']==x['board']['successfulQuanta'];assert cpu['cr4']==0 and [cpu[k]for k in ['interruptShadow','nmiShadow','debugShadow']]==[0,0,0]
 pages=x['nativeHostPages'];assert set(pages)==set(s['pages']) and len(pages)==7
 for key in pages:assert len(pages[key])==len(s['pages'][key])==4096 and all(type(v)is int and 0<=v<=255 for v in pages[key])
 phase=(idx==0 or x['kind']=='final-inspect' or not cpu['cr0']&0x80000000 or cpu['cs']==24 and cpu['eip']in[0x7001,0x7005,0x700b,0x700f])
 assert x['comparison']['status']==('COMPARABLE_PARITY_PASS'if phase else'UNMATCHED_PHASE')
 if phase:
  comparable+=1;assert x['board']['board']==s['board'];assert pages==s['pages']
  for seg,sel,typ,index in [('cs',24,11,1),('ds',16,3,3)]:
   if cpu[seg]==sel:
    valid=(3 if cpu['eip']==0x7005 else 7 if cpu['eip']>=0x700b else 1)if seg=='ds'and cpu['cs']==24 else 1
    assert n['segments'][index*15:index*15+15]==[index,sel,sel>>3,0,0,valid,1,0,1,typ,0,65535,0,0,0]
  ordinary=[w for w in x['board']['ram']['writes']if w['kind']!='ad'];assert [[w['raw'],w['bytes']]for w in ordinary]==[[w['raw'],w['bytes']]for w in s['stores']]
 else:unmatched+=1
assert len(c['boundaries'])==36 and comparable==34 and unmatched==2
assert [x['q']for x in c['cuts']]==[0,21,23,25,27,29,30,31,32,33,34];assert c['milestones']['comparableCuts']==9 and c['milestones']['unmatchedCuts']==2
assert c['progress']['n']==c['progress']['q']==c['progress']['resumes']==34 and c['progress']['zeroQ']==0
assert c['nativeFinal']['state']['board']==c['javascriptFinal']['board'];assert c['nativeFinal']['pages']==c['javascriptFinal']['pages'];assert c['nativeFinal']['ramSha256']==c['javascriptFinal']['ramSha256']=='b36573f67cf2de4454d97a8c2a04b1fa5980ad47c7207da9f42fb07b5b33cf43'
for k in keys:assert c['finalNative'][k]==c['lastReturnedNative'][k]
events=c['nativeMemoryEvents'];lastn=lastq=0
for i,e in enumerate(events):
 assert e['ordinal']==i and e['direction']in['read','write'] and e['nativeTicks']>=lastn and e['successfulQuanta']>=lastq;lastn=e['nativeTicks'];lastq=e['successfulQuanta'];assert all(0<=v<=255 for v in e['bytes'])
for direction,key in [('read','reads'),('write','writes')]:assert [{k:v for k,v in e.items()if k not in ['direction','ordinal']}for e in events if e['direction']==direction]==c['nativeFinal']['state']['ram'][key]
for snap in [c['lastReturnedNative'],c['finalNative']]:
 for k in ['faults','irqDeliveries','portCommits','haltIdleCuts','repIterations','repPartial']:assert int(snap['execution'][k])==0
 assert all(int(v)==0 for v in snap['fallback'].values())
e=j(pre+'worker.exit.json');assert e['exitCode']==0 and not e['timeout'];assert j(pre+'final-status.json')['status']=='PASS'
r={'status':'PASS_INDEPENDENT_NONIDENTITY_PAGING_CORRECTNESS_AUDIT','runId':37207113095,'artifactId':11304886677,'officialMembers':98,'sourceRolePaths':272,'nativeTicks':34,'quanta':34,'resumes':34,'zeroQ':0,'boundaries':36,'comparableBoundaries':34,'unmatchedBoundaries':2,'cuts':11,'comparableCuts':9,'unmatchedCuts':2,'rawWordsPerBoundary':166,'wholeRawPagesPerBoundary':7,'memoryEvents':len(events),'ramSha256':c['nativeFinal']['ramSha256'],'scope':'Strict represented CPU at all boundaries; full board/seven unmodified pages only at declared comparable phases. PG-enable and entry are raw unmatched phases, never parity PASS. Complete successful native callback chronology retained independently of JS AD order. Cache coherence/live callback ownership source-attested; whole RAM hash only. No faults/IRQs/PIO/OS/speed/adoption qualification.'};(p/'independent-audit.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))

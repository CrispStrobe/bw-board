"""Independent complete-profile source packet reader. Unarmed, stdlib only."""
import json,re,hashlib
TABLE_CAP=65536
DESCRIPTOR_CAP=8192
SNAPSHOT_CAP=65536
ROLE_CAP=100
FILE_CAP=524288
REVIEW_DESCRIPTOR_SHA=None
SOURCE_TABLE_SHA=None
HEAD=re.compile('[0-9a-f]{40}\\Z')
SHA=re.compile('[0-9a-f]{64}\\Z')
class Refusal(ValueError):pass
def need(ok,code):
 if not ok:raise Refusal(code)
def keys(v,names):
 need(type(v)is dict and len(v)==len(names) and all(type(k)is str and len(k)<=240 for k in v),'closed-keys');need(set(v)==set(names),'closed-keys')
def integer(v,low=0,high=2**64-1):need(type(v)is int and low<=v<=high,'integer')
def digest(v):need(type(v)is str and SHA.fullmatch(v)is not None,'sha256')
def head(v):need(type(v)is str and HEAD.fullmatch(v)is not None,'head')
def same(a,b):
 if type(a)is not type(b):return False
 if type(a)is dict:return a.keys()==b.keys()and all(same(a[k],b[k])for k in a)
 if type(a)is list:return len(a)==len(b)and all(same(x,y)for x,y in zip(a,b))
 return a==b
def bounded(v,depth=0,budget=None):
 if budget is None:budget=[5000]
 budget[0]-=1;need(budget[0]>=0 and depth<=8,'json-complexity')
 if v is None or type(v)is bool:return
 if type(v)is int:integer(v);return
 if type(v)is str:need(len(v)<=4096,'json-string');return
 if type(v)is list:
  need(len(v)<=100,'json-array')
  for x in v:bounded(x,depth+1,budget)
  return
 need(type(v)is dict and len(v)<=120 and all(type(k)is str and len(k)<=240 for k in v),'json-object')
 for x in v.values():bounded(x,depth+1,budget)
def load(raw,cap):
 need(type(raw)is bytes and len(raw)<=cap,'json-cap')
 def pairs(rows):
  out={}
  for k,v in rows:need(k not in out,'duplicate-json-key');out[k]=v
  return out
 def forbidden(_):raise Refusal('json-number')
 try:v=json.loads(raw.decode('utf8'),object_pairs_hook=pairs,parse_float=forbidden,parse_constant=forbidden)
 except Refusal:raise
 except (ValueError,UnicodeError,RecursionError):raise Refusal('json-parse')from None
 bounded(v);return v
def path(value):
 need(type(value)is str and 1<=len(value)<=240,'path-shape')
 need(re.fullmatch('[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',value)is not None,'path-shape')
 parts=value.split('/');need(len(parts)<=30 and all(x not in ('.','..')for x in parts),'path-shape')
 return parts
def no_ancestors(paths,including_table=False):
 need(type(paths)is list and len(paths)<=ROLE_CAP+int(including_table) and all(type(x)is str for x in paths),'role-paths')
 seen=set();required_dirs=set()
 for value in paths:
  parts=path(value);need(value not in seen and value not in required_dirs,'role-alias')
  for i in range(1,len(parts)):
   ancestor='/'.join(parts[:i]);need(ancestor not in seen,'role-ancestor');required_dirs.add(ancestor)
  seen.add(value)
 return seen
# Exact descriptor/table/snapshot wire schemas await separately frozen source gate.
def audit_unarmed(*_args):raise Refusal('complete-profile-wire-contract-unset')
HELD_TABLE_SHA='7791576ea6ec741fb287ef1ff3545f3cd48f6f9784a6cf996c1e0524558080a7'
ROLE_KINDS=('inherited','runner','packet','admission','admission-control','executor','executor-control','workflow','config','control','readme')
REQUIRED_NEW_KINDS=('runner','packet','admission','admission-control','executor','executor-control','workflow')
HELD_GIT_BLOBS={'scripts/i80386-djgpp-notice-extractor/README.md': 'bf6c36ac0e6ec1a79551895e088ba6d9ad2345de', 'scripts/i80386-djgpp-notice-extractor/controls.py': '29c76a09ac9e50bda7558dee18c3a9ea548f05a6', 'scripts/i80386-djgpp-notice-extractor/extractor.py': 'a2414e18eaf2e1f6c1464f04afe6d0c103150a01', 'scripts/i80386-full-tree-archive-bridge/README.md': '6cbdde0ea93a9a8a51dfa4748a268eda306c5a2a', 'scripts/i80386-full-tree-archive-bridge/bridge.py': 'b3f342cb11831b616880ccca15d8099202bf6807', 'scripts/i80386-full-tree-archive-bridge/controls.py': '47426d44214d4991bc96427588adc0eef4ad78ed', 'scripts/i80386-full-tree-notice-connection/README.md': '8adb1949d663de44be1a569a5aa5c8eb68131a92', 'scripts/i80386-full-tree-notice-connection/controls.py': '8ecccd485eefd70b649e73542d23085db1923a0b', 'scripts/i80386-full-tree-notice-connection/coordinator.py': '08c47105a5a786a5430a78d0b20b9dc684704349', 'scripts/i80386-full-tree-provisioner/README.md': '3c8bcc4366d1ba0e7b407531caf1e27768ed271d', 'scripts/i80386-full-tree-provisioner/controls.py': 'fb9ada9482555bc91deb3a46d30444e3173712ce', 'scripts/i80386-full-tree-provisioner/manifest.json': '06807fd9952c5cd518e59cef5eff6721dd301a4d', 'scripts/i80386-full-tree-provisioner/provenance.json': 'b923493f0d06e163cbdbd67d5f57a77b2fcd0d36', 'scripts/i80386-full-tree-provisioner/provision.py': 'b11d4ee2e5f64c7d402eabf1f5151fc077d18a5a'}
FLAGS=('profileSourceAdmissionQualified','gitJoinImplemented','continuousSourceOwnershipQualified','inputLeaseQualified','filesystemLeaseQualified','compilerQualified','guestQualified','performanceQualified')
def descriptor(raw):
 v=load(raw,DESCRIPTOR_CAP);keys(v,('schema','status','head','repository','origin','workflow','branch','pr','tablePath','tableBytes','tableSha256','tableGitBlob'))
 need(v['schema']=='bw.full-tree-profile-descriptor.v1' and v['status']=='UNARMED_SOURCE_ONLY','descriptor-schema');head(v['head'])
 need(v['repository']=='CrispStrobe/bw-board'and v['origin']=='https://github.com/CrispStrobe/bw-board.git','own-repository')
 path(v['workflow']);need(v['workflow'].startswith('.github/workflows/')and v['workflow'].endswith('.yml'),'workflow-path')
 need(type(v['branch'])is str and 1<=len(v['branch'])<=120 and re.fullmatch('[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*',v['branch'])is not None,'branch')
 path(v['branch']);integer(v['pr'],1,2**63-1);path(v['tablePath']);integer(v['tableBytes'],1,TABLE_CAP);digest(v['tableSha256']);head(v['tableGitBlob']);return v
def held_table(raw):
 need(type(raw)is bytes and len(raw)<=TABLE_CAP and hashlib.sha256(raw).hexdigest()==HELD_TABLE_SHA,'held-table-seal');v=load(raw,TABLE_CAP)
 need(type(v)is dict and len(v)==14,'held-table')
 for name,row in v.items():path(name);keys(row,('bytes','sha256'));integer(row['bytes'],1,FILE_CAP);digest(row['sha256'])
 return v
def role_table(raw,d,held_raw):
 need(type(raw)is bytes and len(raw)==d['tableBytes']and hashlib.sha256(raw).hexdigest()==d['tableSha256'],'table-seal');need(hashlib.sha1(b'blob '+str(len(raw)).encode('ascii')+b'\0'+raw).hexdigest()==d['tableGitBlob'],'table-git-blob');v=load(raw,TABLE_CAP);keys(v,('schema','inheritedRoleCount','roles'))
 need(v['schema']=='bw.full-tree-profile-role-table.v1','table-schema');integer(v['inheritedRoleCount'],14,14)
 need(type(v['roles'])is dict and 21<=len(v['roles'])<=ROLE_CAP,'role-count');no_ancestors(list(v['roles']))
 need(d['tablePath']not in v['roles'],'table-self-cycle');no_ancestors([*v['roles'],d['tablePath']],including_table=True)
 need(type(ROLE_KINDS)is tuple and len(ROLE_KINDS)<=16 and all(type(x)is str for x in ROLE_KINDS),'role-kind-contract-unset')
 for name,row in v['roles'].items():
  keys(row,('kind','bytes','sha256','gitBlob'));need(type(row['kind'])is str and row['kind']in ROLE_KINDS,'role-kind');integer(row['bytes'],1,FILE_CAP);digest(row['sha256']);head(row['gitBlob'])
 need({name for name,row in v['roles'].items()if row['kind']=='inherited'}==set(HELD_GIT_BLOBS) and set(REQUIRED_NEW_KINDS)<=set(row['kind']for row in v['roles'].values()),'new-profile-kind-closure')
 need(d['workflow']in v['roles']and v['roles'][d['workflow']]['kind']=='workflow','descriptor-workflow-join')
 held=held_table(held_raw)
 for name,row in held.items():need(name in v['roles']and same(v['roles'][name]['bytes'],row['bytes'])and same(v['roles'][name]['sha256'],row['sha256'])and v['roles'][name]['kind']=='inherited'and v['roles'][name]['gitBlob']==HELD_GIT_BLOBS[name],'inherited-role-binding')
 return v

def snapshot(raw,position,d,table,descriptor_digest):
 v=load(raw,SNAPSHOT_CAP);keys(v,('schema','position','head','repository','roleCount','roles','table','descriptorSha256',*FLAGS))
 need(position in ('before','after')and v['position']==position and v['schema']=='bw.full-tree-profile-source.v1','snapshot-version-position')
 head(v['head']);digest(v['descriptorSha256']);need(v['head']==d['head']and v['repository']==d['repository']and v['descriptorSha256']==descriptor_digest,'snapshot-descriptor')
 integer(v['roleCount'],21,ROLE_CAP);need(v['roleCount']==len(table['roles'])and same(v['roles'],table['roles']),'snapshot-role-join')
 expected={'path':d['tablePath'],'bytes':d['tableBytes'],'sha256':d['tableSha256'],'gitBlob':d['tableGitBlob']};need(same(v['table'],expected),'snapshot-table-join')
 need(all(v[k]is False for k in FLAGS),'false-authority-flags');return v

def validate_source_pair(descriptor_raw,table_raw,before_raw,after_raw,held_raw):
 d=descriptor(descriptor_raw);t=role_table(table_raw,d,held_raw);dh=hashlib.sha256(descriptor_raw).hexdigest();before=snapshot(before_raw,'before',d,t,dh);after=snapshot(after_raw,'after',d,t,dh)
 return {'schema':'private.full-tree-profile-source-reader-result.v1','qualification':'MANUFACTURED_FULL_GRAPH_REPORTED_POSITION_CONSISTENCY_ONLY','sourceRoleCount':len(t['roles']),'inheritedRoleCount':14,'separateTableObserved':True,'reportedPositionConsistency':True,**{k:False for k in FLAGS},'originalPacketQualified':False,'officialJobQualified':False,'completeNoticeCoverageQualified':False,'legalClearanceQualified':False,'fullToolchainReady':False}
def audit_source_pair(descriptor_raw,table_raw,before_raw,after_raw,held_raw):
 need(type(REVIEW_DESCRIPTOR_SHA)is str and type(SOURCE_TABLE_SHA)is str,'unsealed-source-only')
 need(type(descriptor_raw)is bytes and len(descriptor_raw)<=DESCRIPTOR_CAP and type(table_raw)is bytes and len(table_raw)<=TABLE_CAP,'sealed-input-cap')
 need(hashlib.sha256(descriptor_raw).hexdigest()==REVIEW_DESCRIPTOR_SHA and hashlib.sha256(table_raw).hexdigest()==SOURCE_TABLE_SHA,'external-seal')
 return validate_source_pair(descriptor_raw,table_raw,before_raw,after_raw,held_raw)

# Independent supervisor extension; inherited full-profile predicates unchanged.
APPROVAL_SHA=None
COMPONENT_FACTS={'gate': {'bytes': 15672, 'sha256': '0901f69f1d2ef8870e1716fd7418da247efee00021a8acf3a348cdb0a445ae1f'}, 'adapter': {'bytes': 15351, 'sha256': '2583a603c356e853c2de3b26f42df65b670143463223b7ff073e31ebb33391d2'}, 'packet': {'bytes': 15411, 'sha256': 'cf6af8db92a6b0722b544171ddfa85060324e322020ab8909eb43e1369316845'}, 'supervisor': {'bytes': 16055, 'sha256': '39e1419b9f1ab67d0f94c17676c8e9878e0ad1e45827bce1cfd7b4fb2495ed61'}, 'executor': {'bytes': 6799, 'sha256': '8862db71951f64179b21704f20b5bca6c7c4595dbe71de39e277d58556a619ac'}}
SUPERVISOR_FLAGS=('actualAcquisitionQualified','profileSourceAdmissionQualified','sourceOwnedQualified','filesystemLeaseQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified')
LIMITS={'cpuSeconds':3,'addressSpaceBytes':134217728,'fileBytes':65536,'fdCount':64,'wallSeconds':5,'stdoutBytes':8192,'stderrBytes':8192,'coreBytes':0}
RAW_LOG_CAP=8192
COMPONENT_PATHS={name:'scripts/i80386-unarmed-supervisor/'+name+'.py'for name in ('gate','adapter','packet','supervisor','executor')}
APPROVAL_CAP=16384
def supervisor_approval(raw):
 v=load(raw,APPROVAL_CAP);keys(v,('schema','status','head','descriptorSha256','tableSha256','components'))
 need(v['schema']=='private.full-tree-supervisor-approval.v1'and v['status']=='UNARMED_OFFLINE_ONLY','approval-schema');head(v['head']);digest(v['descriptorSha256']);digest(v['tableSha256']);keys(v['components'],tuple(COMPONENT_PATHS.values()))
 paths=[]
 for name,relative in COMPONENT_PATHS.items():
  row=v['components'][relative];keys(row,('bytes','sha256'));path(relative);paths.append(relative);integer(row['bytes'],1,FILE_CAP);digest(row['sha256'])
  if name in COMPONENT_FACTS:need(row['bytes']==COMPONENT_FACTS[name]['bytes']and row['sha256']==COMPONENT_FACTS[name]['sha256'],'held-component-binding')
 no_ancestors(paths);return v

def approval_source_joins(approval_raw,descriptor_raw,table_raw,held_raw,before_raw=None,after_raw=None):
 a=supervisor_approval(approval_raw);d=descriptor(descriptor_raw);t=role_table(table_raw,d,held_raw)
 need(a['head']==d['head']and a['descriptorSha256']==hashlib.sha256(descriptor_raw).hexdigest()and a['tableSha256']==hashlib.sha256(table_raw).hexdigest(),'approval-source-join')
 for name,row in a['components'].items():
  need(name in t['roles']and t['roles'][name]['bytes']==row['bytes']and t['roles'][name]['sha256']==row['sha256'],'component-source-role')
 positions={}
 for position,raw in (('before',before_raw),('after',after_raw)):
  if raw is not None:positions[position]=snapshot(raw,position,d,t,a['descriptorSha256'])
 return a,d,t,positions

def raw_log_joins(v,stdout,stderr):
 need(type(stdout)is bytes and type(stderr)is bytes and len(stdout)<=RAW_LOG_CAP and len(stderr)<=RAW_LOG_CAP,'raw-log-cap')
 for prefix,body in (('stdout',stdout),('stderr',stderr)):
  integer(v[prefix+'Bytes'],0,RAW_LOG_CAP);digest(v[prefix+'Sha256']);need(v[prefix+'Bytes']==len(body)and v[prefix+'Sha256']==hashlib.sha256(body).hexdigest(),'raw-log-join')
 # Raw bytes are deliberately not decoded or normalized into fact-log grammar.
 need(type(v['rawLogsComplete'])is bool,'raw-log-completeness');return len(stdout)+len(stderr)

def executor_limits(v):
 need(same(v['limits'],LIMITS),'executor-limit-policy');keys(v['storage'],('minimumFreeBytes','observedFreeBytes','rawLogByteCap'));integer(v['storage']['observedFreeBytes']);need(type(v['storage']['minimumFreeBytes'])is int and v['storage']['minimumFreeBytes']==1048576 and type(v['storage']['rawLogByteCap'])is int and v['storage']['rawLogByteCap']==16384,'storage-policy')
 need(v['executionScope']=='FIXED_MANUFACTURED_STDLIB_CHILD_ONLY'and v['actual']is False,'execution-scope')

def audit_supervisor_unarmed(*_args):raise Refusal('supervisor-wire-and-operational-bindings-unset')
FIRST_CODES=('approval-unarmed','approval-seal','metadata-seal','component-seal','fixed-component','bootstrap-route','bootstrap-file','bootstrap-cap','bootstrap-race','bootstrap-refused','supervisor-reentry','poisoned','manufactured-midstage-refusal','operation-refused','packet-refused','source-after-refused','cleanup-refused','output-route','raw-log-cap','raw-file','raw-write','raw-readback','raw-race')
SECOND_CODES=('source-after-refused','packet-refused','cleanup-refused')
SUP_KEYS=('schema','case','offlineControlPassed','firstFailure','secondaryFailure','sourceBefore','sourceAfter','bootstrapComponentsVerified','execution','packet','cleanupRefused','rawLogsStored','inheritedProjection',*SUPERVISOR_FLAGS)
EXEC_KEYS=('schema','case','exit','signal','wallTimedOut','outputCapRefused','stdoutBytes','stderrBytes','stdoutSha256','stderrSha256','limits','observedLimits','storage','cleanupRefused','rawLogsComplete','executionScope','actual')
OBSERVED_KEYS=('cpuSeconds','addressSpaceBytes','fileBytes','fdCount','coreBytes')
PACKET_CAPS={'source-before.json':65536,'source-after.json':65536,'event.json':4096,'report.json':196608,'control.stdout':8192,'control.stderr':8192,'run.stdout':8192,'run.stderr':8192,'status.txt':1024}
PACKET_ORDER=('event.json','source-before.json','control.stdout','control.stderr','run.stdout','run.stderr','report.json','source-after.json','status.txt')
PACKET_FLAGS=('authenticatedContextQualified','profileSourceAdmissionQualified','originalPacketQualified','filesystemLeaseQualified','sourceOwnedQualified','compilerQualified','guestQualified','performanceQualified')
REPORT_FLAGS_NEG=('reportProfileSourceAdmissionQualified','sourceOwnedQualified','inputLeaseQualified','filesystemLeaseQualified','namespaceModeQualified','completeNoticeCoverageQualified','legalClearanceQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified')
def canonical(v):return (json.dumps(v,sort_keys=True,separators=(',',':'))+'\n').encode('utf8')
def execution_receipt(v,case,stdout,stderr):
 keys(v,EXEC_KEYS);need(v['schema']=='private.full-tree-offline-execution.v1'and v['case']==case,'execution-schema')
 keys(v['storage'],('minimumFreeBytes','observedFreeBytes','rawLogByteCap','storageQuotaQualified'));need(v['storage']['storageQuotaQualified']is False,'storage-quota-flag')
 temp=dict(v);temp['storage']={k:x for k,x in v['storage'].items()if k!='storageQuotaQualified'};executor_limits(temp);raw_log_joins(v,stdout,stderr)
 for k in ('wallTimedOut','outputCapRefused'):need(type(v[k])is bool,'execution-boolean')
 if v['exit']is not None:integer(v['exit'],0,255)
 if v['signal']is not None:integer(v['signal'],1,64)
 need(not(v['exit']is not None and v['signal']is not None),'exit-signal')
 integer(v['cleanupRefused'],0,16)
 observed_expected={k:LIMITS[k]for k in OBSERVED_KEYS}
 if v['observedLimits']is not None:need(same(v['observedLimits'],observed_expected),'child-observed-limits')
 if v['rawLogsComplete']:
  need(not v['wallTimedOut']and not v['outputCapRefused']and v['cleanupRefused']==0 and v['observedLimits']is not None and v['storage']['observedFreeBytes']>=1048576 and v['exit']is not None,'false-complete-capture')
  child=load(stdout,RAW_LOG_CAP);keys(child,('schema','case','limits','offline'));need(child['schema']=='private.fixed-offline-child.v1'and child['case']==case and child['offline']is True and same(child['limits'],observed_expected),'raw-child-limit-observation')
 return v['rawLogsComplete']and v['exit']==0 and v['signal']is None and stderr==b''

def projection(position):
 if position is None:return None
 return {'schema':'bw.full-tree-actual-source.v1','phase':position['position'],'head':position['head'],'roleCount':14,'roles':{name:{'bytes':row['bytes'],'sha256':row['sha256']}for name,row in position['roles'].items()if row['kind']=='inherited'}}
def honest_acquisition_packet(members,before,after):
 need(type(members)is dict and len(members)<=9 and all(type(k)is str and k in PACKET_CAPS for k in members),'packet-members')
 for name,body in members.items():need(type(body)is bytes and len(body)<=PACKET_CAPS[name],'packet-cap')
 need(sum(len(x)for x in members.values())<=524288,'packet-total')
 expected=set(PACKET_CAPS)
 if after is None:expected.remove('source-after.json')
 need(before is not None and set(members)==expected,'negative-packet-closure')
 need(members['status.txt']==b'phase=source-after\nexit=1\n'and members['control.stdout']==members['control.stderr']==members['run.stderr']==b''and members['run.stdout']==b'acquisition=disabled\n','negative-packet-facts')
 for name,pos in (('source-before.json',before),('source-after.json',after)):
  if pos is not None:need(members[name]==canonical(projection(pos)),'derived-projection-bytes')
 event=load(members['event.json'],4096);fixed={'schema':'bw.full-tree-actual-event.v1','event':'pull_request','action':'labeled','repository':'CrispStrobe/bw-board','headRepository':'CrispStrobe/bw-board','pr':1,'head':before['head'],'base':'0'*40,'run':1,'attempt':1,'workflow':'.github/workflows/i80386-full-tree-actual.yml','job':'full-tree-materialization','label':'x86-full-tree-and-selected-notice-materialization','authenticatedContextQualified':False};need(same(event,fixed),'offline-event-context')
 report=load(members['report.json'],196608);keys(report,('schema','boundary','complete','phase','stoppedPhase','parentDepth','firstFailure','secondaryFailure','inputs','coordinator','sourceBefore','sourceAfter','responseCloseAttempted','responseCloseRefused','coordinatorCloseAttempted','coordinatorCloseRefused','sourceAfterQualified','resources',*REPORT_FLAGS_NEG))
 need(report['schema']=='bw.full-tree-actual-report.v1'and report['boundary']=='FINITE_REPORTED_FULL_TREE_AND_SELECTED_NOTICE_CONSISTENCY'and report['complete']is False and report['phase']=='refused'and report['stoppedPhase']=='source-before'and report['firstFailure']=='source-unarmed'and report['secondaryFailure']is None,'honest-acquisition-refusal')
 integer(report['parentDepth'],1,30);need(same(report['inputs'],[])and report['coordinator']is None,'no-actual-inputs-or-coordinator')
 for k in ('responseCloseAttempted','responseCloseRefused','coordinatorCloseAttempted','coordinatorCloseRefused'):integer(report[k],0,0)
 need(same(report['sourceBefore'],projection(before))and same(report['sourceAfter'],projection(after))and report['sourceAfterQualified']is(after is not None),'report-projection-join')
 resource={'ordinaryPerFileContentCap':34200152,'ordinaryAggregateContentCap':258686704,'selectedNoticeContentCap':85182,'plannedAddressSpaceBytes':2147483648,'plannedProcessFileBytes':67108864,'outerHardBoundImplemented':False};need(same(report['resources'],resource)and all(report[k]is False for k in REPORT_FLAGS_NEG),'no-resource-or-authority-promotion')
 return report

def packet_receipt(v,members,before,after):
 keys(v,('schema','phase','closed','firstFailure','fileAttempts','written','closeAttempted','closeRefused','directoryScanCloseRefused','ownedDescriptors','handlesClosedWithoutReportedRefusal','assembly',*PACKET_FLAGS));need(v['schema']=='private.full-tree-packet-status.v1'and v['phase']in('new','written','refused'),'packet-schema')
 need(type(v['closed'])is bool and type(v['handlesClosedWithoutReportedRefusal'])is bool and all(v[k]is False for k in PACKET_FLAGS),'packet-flags');need(v['firstFailure']is None or type(v['firstFailure'])is str and len(v['firstFailure'])<=96 and re.fullmatch('[a-z0-9-]+',v['firstFailure'])is not None,'packet-reason')
 for k,cap in (('fileAttempts',9),('closeAttempted',64),('closeRefused',64),('directoryScanCloseRefused',2),('ownedDescriptors',34)):integer(v[k],0,cap)
 need(v['closeRefused']<=v['closeAttempted']and v['handlesClosedWithoutReportedRefusal']==(v['closed']and v['closeRefused']==0 and v['directoryScanCloseRefused']==0),'packet-close-join');need(not v['closed']or v['ownedDescriptors']==0,'packet-owned-close')
 need(type(v['written'])is list and len(v['written'])<=v['fileAttempts'],'packet-written');seen=[]
 for row in v['written']:
  keys(row,('role','bytes','sha256'));need(type(row['role'])is str and row['role']in members and row['role']not in seen,'packet-written-role');integer(row['bytes'],0,PACKET_CAPS[row['role']]);digest(row['sha256']);need(row['bytes']==len(members[row['role']])and row['sha256']==hashlib.sha256(members[row['role']]).hexdigest(),'packet-written-byte-join');seen.append(row['role'])
 need(seen==[name for name in PACKET_ORDER if name in seen],'packet-written-order')
 if v['assembly']is not None:
  a=v['assembly'];keys(a,('phase','exit','roleCount','eventConsistencyObserved','profileSourceAdmissionQualified','authenticatedContextQualified','controlTranscriptQualified','originalPacketQualified'));need(a['phase']=='source-after','packet-assembly-phase');integer(a['exit'],1,1);integer(a['roleCount'],0,9);need(a['roleCount']==len(members)and a['eventConsistencyObserved']is True and all(a[k]is False for k in ('profileSourceAdmissionQualified','authenticatedContextQualified','controlTranscriptQualified','originalPacketQualified')),'packet-assembly-join')
 clean=v['phase']=='written'and v['closed']and v['firstFailure']is None and v['handlesClosedWithoutReportedRefusal']and v['ownedDescriptors']==0 and v['assembly']is not None and len(v['written'])==len(members)and v['fileAttempts']==len(members)
 if clean:honest_acquisition_packet(members,before,after)
 return clean

def validate_supervisor(receipt_raw,approval_raw,descriptor_raw,table_raw,held_raw,stdout,stderr,members):
 need(type(stdout)is bytes and type(stderr)is bytes and len(stdout)<=8192 and len(stderr)<=8192,'raw-log-cap')
 need(type(members)is dict and len(members)<=9 and all(type(k)is str and k in PACKET_CAPS for k in members),'packet-members')
 for name,body in members.items():need(type(body)is bytes and len(body)<=PACKET_CAPS[name],'packet-cap')
 v=load(receipt_raw,196608);keys(v,SUP_KEYS);need(v['schema']=='private.full-tree-supervisor-result.v1'and v['case']in('success','midstage-refusal'),'supervisor-schema');need(type(v['offlineControlPassed'])is bool and all(v[k]is False for k in SUPERVISOR_FLAGS),'supervisor-flags')
 need(v['firstFailure']is None or v['firstFailure']in FIRST_CODES,'first-code');need(v['secondaryFailure']is None or v['secondaryFailure']in SECOND_CODES,'secondary-code');integer(v['bootstrapComponentsVerified'],0,5);integer(v['cleanupRefused'],0,64)
 a,d,t,positions=approval_source_joins(approval_raw,descriptor_raw,table_raw,held_raw,None if v['sourceBefore']is None else canonical(v['sourceBefore']),None if v['sourceAfter']is None else canonical(v['sourceAfter']))
 if positions:need(v['bootstrapComponentsVerified']==5,'source-before-bootstrap')
 before=positions.get('before');after=positions.get('after');need(after is None or before is not None,'source-order')
 projection_v=v['inheritedProjection'];keys(projection_v,('kind','roleCount','beforeSha256','afterSha256'));need(projection_v['kind']=='INHERITED14_DERIVED_FROM_FULL_PROFILE_POSITIONS','projection-kind');integer(projection_v['roleCount'],14,14)
 for key,pos,name in (('beforeSha256',before,'source-before.json'),('afterSha256',after,'source-after.json')):
  if pos is None:need(projection_v[key]is None,'projection-hash')
  elif projection_v[key]is None:need(not v['offlineControlPassed']and name not in members,'projection-unavailable')
  else:need(projection_v[key]==hashlib.sha256(canonical(projection(pos))).hexdigest(),'projection-hash')
 execution_good=False
 if v['execution']is None:need(stdout==stderr==b'','absent-execution-logs')
 else:execution_good=execution_receipt(v['execution'],v['case'],stdout,stderr)
 need(type(v['rawLogsStored'])is list and len(v['rawLogsStored'])<=2,'stored-logs');seen=[]
 for row in v['rawLogsStored']:
  keys(row,('role','bytes','sha256'));need(type(row['role'])is str and row['role']in('raw-child.stdout','raw-child.stderr')and row['role']not in seen,'stored-log-role');body=stdout if row['role']=='raw-child.stdout'else stderr;integer(row['bytes'],0,8192);digest(row['sha256']);need(row['bytes']==len(body)and row['sha256']==hashlib.sha256(body).hexdigest(),'stored-log-join');seen.append(row['role'])
 need(seen==['raw-child.stdout','raw-child.stderr'][:len(seen)],'stored-log-order')
 packet_good=False
 if v['packet']is None:need(type(members)is dict and members=={},'absent-packet-members')
 else:packet_good=packet_receipt(v['packet'],members,before,after)
 good=v['case']=='success'and v['firstFailure']is None and v['secondaryFailure']is None and before is not None and after is not None and execution_good and packet_good and seen==['raw-child.stdout','raw-child.stderr']and v['cleanupRefused']==0
 if v['offlineControlPassed']:need(good,'false-offline-success')
 else:need(not good and v['firstFailure']is not None,'contradictory-offline-refusal')
 return {'schema':'private.independent-supervisor-consistency.v1','qualification':'REPORTED_OFFLINE_CONTROL_CONSISTENCY_ONLY'if good else'PRESERVED_UNQUALIFIED_SUPERVISOR_REFUSAL','offlineReportedConsistency':good,'firstFailure':v['firstFailure'],'actualAcquisitionQualified':False,'officialContextQualified':False,'officialJobQualified':False,'sourceOwnedQualified':False,'filesystemLeaseQualified':False,'fullToolchainReady':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}

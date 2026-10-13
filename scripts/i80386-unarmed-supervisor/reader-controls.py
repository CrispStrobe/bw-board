"""Manufactured approval/source/raw-byte controls. No producer modules or operations."""
from pathlib import Path
import importlib.util,json,hashlib,copy,unittest
p=Path(__file__).parent;s=importlib.util.spec_from_file_location('independent_supervisor_reader',p/'reader.py');r=importlib.util.module_from_spec(s);s.loader.exec_module(r)
def raw(v):return json.dumps(v,separators=(',',':')).encode()
def sha(b):return hashlib.sha256(b).hexdigest()
def public_component_facts():
 facts={}
 for name in ('gate','adapter','packet','supervisor','executor'):
  with (p/(name+'.py')).open('rb')as f:body=f.read(524289)
  if len(body)>524288:raise AssertionError('component metadata cap')
  fact={'bytes':len(body),'sha256':sha(body)}
  if fact!=r.COMPONENT_FACTS[name]:raise AssertionError('component metadata pin')
  facts[name]=fact
 return facts

class T(unittest.TestCase):
 def setUp(self):
  self.held=(p/'inherited-roles.json').read_bytes();held=json.loads(self.held);rows={name:{'kind':'inherited',**row,'gitBlob':r.HELD_GIT_BLOBS[name]}for name,row in held.items()}
  components={}
  for name,relative in r.COMPONENT_PATHS.items():
   fact=public_component_facts()[name];components[relative]=dict(fact);kind={'gate':'admission','adapter':'config','packet':'packet','supervisor':'runner','executor':'executor'}[name];rows[relative]={'kind':kind,**fact,'gitBlob':'c'*40}
  for kind in ('admission-control','executor-control','workflow'):
   name='.github/workflows/proposed.yml'if kind=='workflow'else'scripts/proposed/'+kind+'.py';rows[name]={'kind':kind,'bytes':1,'sha256':sha(b'x'),'gitBlob':'c'*40}
  self.table={'schema':'bw.full-tree-profile-role-table.v1','inheritedRoleCount':14,'roles':rows};self.tr=raw(self.table)
  self.d={'schema':'bw.full-tree-profile-descriptor.v1','status':'UNARMED_SOURCE_ONLY','head':'a'*40,'repository':'CrispStrobe/bw-board','origin':'https://github.com/CrispStrobe/bw-board.git','workflow':'.github/workflows/proposed.yml','branch':'lane/proposed','pr':1,'tablePath':'scripts/proposed/table.json','tableBytes':len(self.tr),'tableSha256':sha(self.tr),'tableGitBlob':hashlib.sha1(b'blob '+str(len(self.tr)).encode()+b'\0'+self.tr).hexdigest()};self.dr=raw(self.d)
  self.approval={'schema':'private.full-tree-supervisor-approval.v1','status':'UNARMED_OFFLINE_ONLY','head':'a'*40,'descriptorSha256':sha(self.dr),'tableSha256':sha(self.tr),'components':components};self.ar=raw(self.approval)
 def joins(self):return r.approval_source_joins(self.ar,self.dr,self.tr,self.held)
 def test_fixed_approval_fullsource_join(self):
  a,d,t,positions=self.joins();self.assertEqual(a['head'],d['head']);self.assertEqual(len(t['roles']),22);self.assertEqual(positions,{})
 def test_fixed_component_names_not_caller_paths(self):
  for mode in ('extra','foreign','relativePath'):
   a=copy.deepcopy(self.approval)
   if mode=='extra':a['components']['scripts/other.py']={'bytes':1,'sha256':'a'*64}
   elif mode=='foreign':a['components']['scripts/other.py']=a['components'].pop(r.COMPONENT_PATHS['gate'])
   else:a['components'][r.COMPONENT_PATHS['gate']]['relativePath']='scripts/other.py'
   with self.assertRaises(r.Refusal):r.supervisor_approval(raw(a))
 def test_three_held_component_hash_size_types(self):
  for key,value in [('bytes',True),('sha256','0'*64)]:
   a=copy.deepcopy(self.approval);a['components'][r.COMPONENT_PATHS['gate']][key]=value
   with self.assertRaises(r.Refusal):r.supervisor_approval(raw(a))
 def test_external_head_descriptor_table_digest_drift(self):
  for key,value in [('head','b'*40),('descriptorSha256','0'*64),('tableSha256','0'*64)]:
   a=copy.deepcopy(self.approval);a[key]=value;self.ar=raw(a)
   with self.assertRaises(r.Refusal):self.joins()
 def test_raw_bytes_not_fact_log_normalized(self):
  stdout=b'\xff\0raw\n';stderr=b'/private-shaped manufactured path\r\n';v={'stdoutBytes':len(stdout),'stderrBytes':len(stderr),'stdoutSha256':sha(stdout),'stderrSha256':sha(stderr),'rawLogsComplete':False};self.assertEqual(r.raw_log_joins(v,stdout,stderr),len(stdout)+len(stderr))
  for key,value in [('stdoutBytes',True),('stderrSha256','0'*64),('rawLogsComplete',1)]:
   w=v.copy();w[key]=value
   with self.assertRaises(r.Refusal):r.raw_log_joins(w,stdout,stderr)
 def test_log_cap_and_mutable_bytes_refuse(self):
  for body in (b'x'*8193,bytearray(b'x')):
   with self.assertRaises(r.Refusal):r.raw_log_joins({},body,b'')
 def test_limits_deep_types_and_raw_storage_caps(self):
  v={'limits':dict(r.LIMITS),'storage':{'minimumFreeBytes':1048576,'observedFreeBytes':0,'rawLogByteCap':16384},'executionScope':'FIXED_MANUFACTURED_STDLIB_CHILD_ONLY','actual':False};r.executor_limits(v)
  for key,value in [('cpuSeconds',True),('fileBytes',65537)]:
   w=copy.deepcopy(v);w['limits'][key]=value
   with self.assertRaises(r.Refusal):r.executor_limits(w)
 def test_approval_closed_and_bounded(self):
  for body in (self.ar+b' '*(16385-len(self.ar)),b'{"x":1,"x":2}',b'{"x":NaN}'):
   with self.assertRaises(r.Refusal):r.supervisor_approval(body)
 def test_actual_context_wire_unset(self):
  with self.assertRaises(r.Refusal):r.audit_supervisor_unarmed(self.ar)


def manufactured_fixture(case):
 """Pure JSON reports, with public source bytes observed only as metadata."""
 if case not in ('success','midstage-refusal'):raise AssertionError('fixture case')
 base=T('test_fixed_approval_fullsource_join');base.setUp();table=copy.deepcopy(base.table);tr=r.canonical(table);d=copy.deepcopy(base.d)
 d.update(tableBytes=len(tr),tableSha256=sha(tr),tableGitBlob=hashlib.sha1(b'blob '+str(len(tr)).encode()+b'\0'+tr).hexdigest());dr=r.canonical(d);approval=copy.deepcopy(base.approval);approval.update(descriptorSha256=sha(dr),tableSha256=sha(tr))
 positions={pos:{'schema':'bw.full-tree-profile-source.v1','position':pos,'head':d['head'],'repository':d['repository'],'roleCount':len(table['roles']),'roles':copy.deepcopy(table['roles']),'table':{'path':d['tablePath'],'bytes':len(tr),'sha256':sha(tr),'gitBlob':d['tableGitBlob']},'descriptorSha256':sha(dr),**{k:False for k in r.FLAGS}}for pos in ('before','after')}
 before=r.projection(positions['before']);after=r.projection(positions['after'])
 limits={'cpuSeconds':3,'addressSpaceBytes':134217728,'fileBytes':65536,'fdCount':64,'wallSeconds':5,'stdoutBytes':8192,'stderrBytes':8192,'coreBytes':0};observed={k:limits[k]for k in ('cpuSeconds','addressSpaceBytes','fileBytes','fdCount','coreBytes')}
 stdout=json.dumps({'schema':'private.fixed-offline-child.v1','case':case,'limits':observed,'offline':True},sort_keys=True)+'\n';stderr=''if case=='success'else'manufactured-midstage-refusal\n'
 execution={'schema':'private.full-tree-offline-execution.v1','case':case,'exit':0 if case=='success'else 7,'signal':None,'wallTimedOut':False,'outputCapRefused':False,'stdoutBytes':len(stdout.encode()),'stderrBytes':len(stderr.encode()),'stdoutSha256':sha(stdout.encode()),'stderrSha256':sha(stderr.encode()),'limits':limits,'observedLimits':observed,'storage':{'minimumFreeBytes':1048576,'observedFreeBytes':2097152,'rawLogByteCap':16384,'storageQuotaQualified':False},'cleanupRefused':0,'rawLogsComplete':True,'executionScope':'FIXED_MANUFACTURED_STDLIB_CHILD_ONLY','actual':False}
 report={'schema':'bw.full-tree-actual-report.v1','boundary':'FINITE_REPORTED_FULL_TREE_AND_SELECTED_NOTICE_CONSISTENCY','complete':False,'phase':'refused','stoppedPhase':'source-before','parentDepth':2,'firstFailure':'source-unarmed','secondaryFailure':None,'inputs':[],'coordinator':None,'sourceBefore':before,'sourceAfter':after,'responseCloseAttempted':0,'responseCloseRefused':0,'coordinatorCloseAttempted':0,'coordinatorCloseRefused':0,'sourceAfterQualified':True,'resources':{'ordinaryPerFileContentCap':34200152,'ordinaryAggregateContentCap':258686704,'selectedNoticeContentCap':85182,'plannedAddressSpaceBytes':2147483648,'plannedProcessFileBytes':67108864,'outerHardBoundImplemented':False},**{k:False for k in r.REPORT_FLAGS_NEG}}
 event={'schema':'bw.full-tree-actual-event.v1','event':'pull_request','action':'labeled','repository':'CrispStrobe/bw-board','headRepository':'CrispStrobe/bw-board','pr':1,'head':d['head'],'base':'0'*40,'run':1,'attempt':1,'workflow':'.github/workflows/i80386-full-tree-actual.yml','job':'full-tree-materialization','label':'x86-full-tree-and-selected-notice-materialization','authenticatedContextQualified':False}
 members={'event.json':r.canonical(event),'source-before.json':r.canonical(before),'source-after.json':r.canonical(after),'report.json':r.canonical(report),'control.stdout':b'','control.stderr':b'','run.stdout':b'acquisition=disabled\n','run.stderr':b'','status.txt':b'phase=source-after\nexit=1\n'}
 packet={'schema':'private.full-tree-packet-status.v1','phase':'written','closed':True,'firstFailure':None,'fileAttempts':9,'written':[{'role':name,'bytes':len(members[name]),'sha256':sha(members[name])}for name in r.PACKET_ORDER],'closeAttempted':13,'closeRefused':0,'directoryScanCloseRefused':0,'ownedDescriptors':0,'handlesClosedWithoutReportedRefusal':True,'assembly':{'phase':'source-after','exit':1,'roleCount':9,'eventConsistencyObserved':True,'profileSourceAdmissionQualified':False,'authenticatedContextQualified':False,'controlTranscriptQualified':False,'originalPacketQualified':False},**{k:False for k in r.PACKET_FLAGS}}
 receipt={'schema':'private.full-tree-supervisor-result.v1','case':case,'offlineControlPassed':case=='success','firstFailure':None if case=='success'else'manufactured-midstage-refusal','secondaryFailure':None,'sourceBefore':positions['before'],'sourceAfter':positions['after'],'bootstrapComponentsVerified':5,'execution':execution,'packet':packet,'cleanupRefused':0,'rawLogsStored':[{'role':name,'bytes':len(body),'sha256':sha(body)}for name,body in (('raw-child.stdout',stdout.encode()),('raw-child.stderr',stderr.encode()))],'inheritedProjection':{'kind':'INHERITED14_DERIVED_FROM_FULL_PROFILE_POSITIONS','roleCount':14,'beforeSha256':sha(members['source-before.json']),'afterSha256':sha(members['source-after.json'])},**{k:False for k in r.SUPERVISOR_FLAGS}}
 return {'schema':'private.offline-supervisor-manufactured-fixture.v1','case':case,'approval':approval,'descriptor':d,'table':table,'receipt':receipt,'rawStdoutUtf8':stdout,'rawStderrUtf8':stderr,'packetMembersUtf8':{k:v.decode()for k,v in members.items()},'actual':False,'officialContextQualified':False}

class Lifecycle(unittest.TestCase):
 def setUp(self):
  self.v=manufactured_fixture('success');self.held=(p/'inherited-roles.json').read_bytes()
 def check(self,v=None):
  v=self.v if v is None else v
  return r.validate_supervisor(r.canonical(v['receipt']),r.canonical(v['approval']),r.canonical(v['descriptor']),r.canonical(v['table']),self.held,v['rawStdoutUtf8'].encode(),v['rawStderrUtf8'].encode(),{k:x.encode()for k,x in v['packetMembersUtf8'].items()})
 def test_both_manufactured_fixture_cases(self):
  self.assertTrue(self.check()['offlineReportedConsistency']);self.assertFalse(self.check()['actualAcquisitionQualified'])
  v=manufactured_fixture('midstage-refusal');out=self.check(v);self.assertFalse(out['offlineReportedConsistency']);self.assertEqual(out['firstFailure'],'manufactured-midstage-refusal')
 def test_false_success_cleanup_capture_status(self):
  for mutate in ('cleanup','complete','exit','signal','timeout','cap','storage'):
   v=copy.deepcopy(self.v);x=v['receipt']['execution']
   if mutate=='cleanup':v['receipt']['cleanupRefused']=1
   elif mutate=='complete':x['rawLogsComplete']=False
   elif mutate=='exit':x['exit']=7
   elif mutate=='signal':x['signal']=9
   elif mutate=='timeout':x['wallTimedOut']=True
   elif mutate=='cap':x['outputCapRefused']=True
   else:x['storage']['observedFreeBytes']=0
   with self.assertRaises(r.Refusal):self.check(v)
 def test_fixed_policy_and_observed_limits_types(self):
  for key,value in [('cpuSeconds',2),('fdCount',True)]:
   v=copy.deepcopy(self.v);v['receipt']['execution']['limits'][key]=value;v['receipt']['execution']['observedLimits'][key]=value
   with self.assertRaises(r.Refusal):self.check(v)
 def test_raw_log_byte_digest_prefix(self):
  for mutate in ('stdout','stderr','hash','stored'):
   v=copy.deepcopy(self.v)
   if mutate=='stdout':v['rawStdoutUtf8']+='changed'
   elif mutate=='stderr':v['rawStderrUtf8']='original stderr cannot be normalized'
   elif mutate=='hash':v['receipt']['execution']['stdoutSha256']='0'*64
   else:v['receipt']['rawLogsStored'][0]['bytes']=True
   with self.assertRaises(r.Refusal):self.check(v)
 def test_raw_child_observed_limit_body_join(self):
  v=copy.deepcopy(self.v);body=json.loads(v['rawStdoutUtf8']);body['limits']['cpuSeconds']=2;v['rawStdoutUtf8']=json.dumps(body)+'\n';b=v['rawStdoutUtf8'].encode();v['receipt']['execution']['stdoutBytes']=len(b);v['receipt']['execution']['stdoutSha256']=sha(b);v['receipt']['rawLogsStored'][0].update(bytes=len(b),sha256=sha(b))
  with self.assertRaises(r.Refusal):self.check(v)
 def test_full_source_and_component_joins(self):
  for mutate in ('head','table','component','role'):
   v=copy.deepcopy(self.v)
   if mutate=='head':v['receipt']['sourceAfter']['head']='b'*40
   elif mutate=='table':v['receipt']['sourceAfter']['table']['gitBlob']='0'*40
   elif mutate=='component':v['approval']['components'][r.COMPONENT_PATHS['executor']]['sha256']='0'*64
   else:v['receipt']['sourceAfter']['roles'][next(iter(v['receipt']['sourceAfter']['roles']))]['sha256']='0'*64
   with self.assertRaises(r.Refusal):self.check(v)
 def test_projection_not_full_graph_or_live_claim(self):
  for mutate in ('hash','count','kind'):
   v=copy.deepcopy(self.v);x=v['receipt']['inheritedProjection'];x[{'hash':'beforeSha256','count':'roleCount','kind':'kind'}[mutate]]={'hash':'0'*64,'count':True,'kind':'LIVE_SOURCE_OWNED'}[mutate]
   with self.assertRaises(r.Refusal):self.check(v)
 def test_packet_cannot_invent_inputs_or_success(self):
  for key,value in [('inputs',[{'authenticated':True}]),('coordinator',{}),('complete',True),('sourceOwnedQualified',True)]:
   v=copy.deepcopy(self.v);report=json.loads(v['packetMembersUtf8']['report.json']);report[key]=value;body=r.canonical(report);v['packetMembersUtf8']['report.json']=body.decode()
   row=next(x for x in v['receipt']['packet']['written']if x['role']=='report.json');row.update(bytes=len(body),sha256=sha(body))
   with self.assertRaises(r.Refusal):self.check(v)
 def test_packet_written_counts_closed_flags(self):
  for key,value in [('fileAttempts',True),('ownedDescriptors',1),('originalPacketQualified',True),('closeRefused',1)]:
   v=copy.deepcopy(self.v);v['receipt']['packet'][key]=value
   with self.assertRaises(r.Refusal):self.check(v)
 def test_negative_prefix_no_offline_success(self):
  v=manufactured_fixture('midstage-refusal');v['receipt']['offlineControlPassed']=True
  with self.assertRaises(r.Refusal):self.check(v)
 def test_opaque_missing_execution_partial(self):
  v=copy.deepcopy(self.v);x=v['receipt'];x.update(offlineControlPassed=False,firstFailure='operation-refused',execution=None);v['rawStdoutUtf8']='';v['rawStderrUtf8']='';x['rawLogsStored']=[{'role':n,'bytes':0,'sha256':sha(b'')}for n in ('raw-child.stdout','raw-child.stderr')];self.assertFalse(self.check(v)['offlineReportedConsistency'])
 def test_custom_packet_map_refuses_before_hooks(self):
  class Foreign(dict):
   def __contains__(self,_):raise AssertionError('foreign entered')
  with self.assertRaises(r.Refusal):r.validate_supervisor(b'{}',b'{}',b'{}',b'{}',b'{}',b'',b'',Foreign())
if __name__=='__main__':unittest.main()

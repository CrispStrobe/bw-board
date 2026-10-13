"""Manufactured byte packets only; never import or replay producer helpers."""
import copy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import struct
import unittest
from unittest.mock import patch
import zipfile

def module(name,filename):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(filename))
    value=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
r=module('observation_reader','reader.py')
a=module('observation_assembler','assembler.py')
def canonical(value):return(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()
def resource():
    policy=[dict(zip(('name','resource','soft','hard'),row))for row in r.POLICY]
    rows=[{**p,'setReturned':True,'observations':[{'position':position,'shapeValid':True,'soft':p['soft'],'hard':p['hard'],'matchesPolicy':True}for position in('immediate','final')]}for p in policy]
    flags=('namespaceOwnershipQualified','officialHostQualified','aggregateResourceQuotaQualified','diskQuotaQualified','actualResourceSufficiencyQualified','outerTimeoutQualified','bootstrapConnected','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified')
    limits={'schema':'bw.provisioning-pid1-limits.v1','phase':'prepared','closed':True,'prepared':True,'firstFailure':None,'stoppedPhase':None,'eligibility':{k:True for k in('linuxObserved','pid1Observed','rootCredentialsObserved','githubContextObserved')},'policy':policy,'rows':rows,'setAttempted':5,'getAttempted':10,'processLimitsPrepared':True,**{k:False for k in flags}}
    return {'schema':'bw.provisioning-contained-resource.v1','components':{label:{k:r.CHECKED_COMPONENTS[path][k]for k in('bytes','sha256')}for label,path in(('limits','scripts/i80386-provisioning-pid1/limits.py'),('controller','scripts/i80386-full-tree-provisioning-launcher/controller.py'))},'limits':limits,'controllerBootstrapStarted':False,'observerOwnershipQualified':False,'actualAcquisitionQualified':False,'compilerQualified':False,'guestQualified':False}
def full_sources():
    rows={name:{'kind':'inherited',**value}for name,value in r.HELD14.items()}
    for name,value in r.CHECKED_COMPONENTS.items():rows[name]={'kind':'executor',**value}
    for kind in r.REQUIRED_KINDS:
        name='.github/workflows/manufactured.yml'if kind=='workflow'else'fixtures/'+kind+'.py'
        rows[name]={'kind':kind,'bytes':1,'sha256':digest(b'x'),'gitBlob':hashlib.sha1(b'blob 1\0x').hexdigest()}
    table={'schema':'bw.full-tree-profile-role-table.v1','inheritedRoleCount':14,'roles':rows}
    raw=canonical(table)
    descriptor={'schema':'bw.full-tree-profile-descriptor.v1','status':'UNARMED_SOURCE_ONLY','head':'a'*40,'repository':'CrispStrobe/bw-board','origin':'https://github.com/CrispStrobe/bw-board.git','workflow':'.github/workflows/manufactured.yml','branch':'lane/manufactured','pr':1,'tablePath':'config/manufactured-roles.json','tableBytes':len(raw),'tableSha256':digest(raw),'tableGitBlob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()}
    snapshots=[]
    flags=('profileSourceAdmissionQualified','gitJoinImplemented','continuousSourceOwnershipQualified','inputLeaseQualified','filesystemLeaseQualified','compilerQualified','guestQualified','performanceQualified')
    for position in('before','after'):
        snapshots.append({'schema':'bw.full-tree-profile-source.v1','position':position,'head':descriptor['head'],'repository':descriptor['repository'],'roleCount':len(rows),'roles':copy.deepcopy(rows),'table':{'path':descriptor['tablePath'],'bytes':descriptor['tableBytes'],'sha256':descriptor['tableSha256'],'gitBlob':descriptor['tableGitBlob']},'descriptorSha256':digest(canonical(descriptor)),**{k:False for k in flags}})
    return descriptor,table,*snapshots
class Fixture:
    def __init__(self):
        self.d,self.table,self.before,self.after=full_sources()
        self.resource=resource()
        self.body={'stdout.prefix':b'original\x00\xff\r\nPK\x03\x04','stderr.prefix':b'raw-error\r\n','source-before.json':canonical(self.before),'source-after.json':canonical(self.after),'descriptor.json':canonical(self.d),'role-table.json':canonical(self.table),'resources.json':canonical(self.resource)}
        admission={'schema':'bw.provisioning-envelope-admission-facts.v1','closed':True,'ackAttempted':True,'ackSent':True,'ackMayHaveEscaped':True,'historicalHandlesAdmitted':True,'currentUsableHandles':False,'firstFailure':None,'cleanupRefused':0,'resourcePacketSha256':digest(self.body['resources.json']),'kernelLimitRows':[{'name':name,'resource':kind,'observedSoft':soft,'observedHard':hard,'matchesPolicy':True}for name,kind,soft,hard in r.POLICY]}
        lifetime={'schema':'bw.provisioning-envelope-lifetime-facts.v1','phase':'observed','closed':True,'complete':True,'firstFailure':None,'cleanupRefused':0,'stdoutPrefixBytes':len(self.body['stdout.prefix']),'stderrPrefixBytes':len(self.body['stderr.prefix']),'stdoutObservedBytes':len(self.body['stdout.prefix']),'stderrObservedBytes':len(self.body['stderr.prefix']),'stdoutPrefixSha256':digest(self.body['stdout.prefix']),'stderrPrefixSha256':digest(self.body['stderr.prefix']),'stdoutEOF':True,'stderrEOF':True,'outputCapRefused':False,'admissionObserved':True,'historicalHandlesAdmitted':True,'ackAttempted':True,'ackSent':True,'ackMayHaveEscaped':True,'pid1Terminal':True,'launcherReaped':True,'launcherExit':0,'censusCounts':[0,0],'signalAttempted':False,'signalReturned':False,'cleanupObservationsMissing':False,'launchUnobserved':False}
        self.envelope={'schema':'bw.provisioning-observation-envelope.v1','stage':'complete','completeReported':True,'members':{},'context':{'repository':'CrispStrobe/bw-board','sourceHead':'a'*40,'declaredApprovalSha256':None,'declaredRun':None,'declaredJob':None,'declaredArtifact':None},'failure':{'primary':None,'secondary':None,'cleanupUnknown':False},'admission':admission,'lifetime':lifetime,'inheritedProjection':self.projection(),'authority':{k:False for k in r.AUTHORITY}}
    def projection(self):
        result={'kind':'INHERITED14_DERIVED_FROM_REPORTED_FULL_POSITIONS','roleCount':14}
        for source,position in((self.before,'before'),(self.after,'after')):
            result[position+'Sha256']=None if source is None else digest(canonical({'schema':'bw.full-tree-actual-source.v1','phase':position,'head':source['head'],'roleCount':14,'roles':{name:{k:source['roles'][name][k]for k in('bytes','sha256')}for name in r.HELD14}}))
        return result
    def packet(self):
        self.body['status.txt']=('phase='+self.envelope['stage']+'\nexit='+('0'if self.envelope['stage']=='complete'else'1')+'\n').encode()
        self.envelope['members']={name:{'bytes':len(body),'sha256':digest(body)}for name,body in self.body.items()if name!='envelope.json'}
        self.body['envelope.json']=canonical(self.envelope)
        return a.assemble(self.body)
    def negative(self,producer='envelope',code='outer-refused',stage='source-after'):
        self.envelope['stage']=stage
        self.envelope['completeReported']=False
        self.envelope['failure']['primary']={'producer':producer,'code':code,'exceptionType':'Refusal'}
        return self
    def entry(self,producer='envelope',code='unarmed'):
        self.negative(producer,code,'entry')
        self.body={k:v for k,v in self.body.items()if k in('stdout.prefix','stderr.prefix')}
        self.envelope['admission']=self.envelope['lifetime']=self.envelope['inheritedProjection']=None
        self.envelope['context']['sourceHead']=None
        return self

def central_offset(raw):return struct.unpack_from('<I',raw,len(raw)-22+16)[0]
def put(raw,offset,fmt,value):
    raw=bytearray(raw)
    struct.pack_into(fmt,raw,offset,value)
    return bytes(raw)
class T(unittest.TestCase):
    def reject(self,raw):
        with self.assertRaises(r.Refusal):r.audit(raw)
    def test_complete_reported_consistency_all_authority_false(self):
        f=Fixture();result=r.audit(f.packet())
        self.assertTrue(result['diagnosticValid'])
        self.assertTrue(result['completeReportedConsistency'])
        self.assertEqual(result['checkedInheritedRoles'],14)
        self.assertEqual(result['checkedCurrentComponents'],4)
        self.assertTrue(all(result[k]is False for k in r.AUTHORITY))
    def test_canonical_packet_opens_standard_zip_tool(self):
        raw=Fixture().packet()
        with zipfile.ZipFile(io.BytesIO(raw))as z:
            self.assertIsNone(z.testzip())
            self.assertTrue(all(i.date_time==(1980,1,1,0,0,0)and i.compress_type==zipfile.ZIP_STORED for i in z.infolist()))
    def test_partial_entry_binary_prefixes_no_eof_or_success_invented(self):
        f=Fixture().entry();result=r.audit(f.packet())
        self.assertTrue(result['diagnosticValid']);self.assertFalse(result['completeReportedConsistency']);self.assertEqual(result['stdoutPrefixBytes'],len(f.body['stdout.prefix']))
    def test_negative_outer_retains_complete_historical_inner(self):
        f=Fixture().negative();result=r.audit(f.packet())
        self.assertTrue(f.envelope['lifetime']['complete']);self.assertFalse(result['completeReportedConsistency'])
    def test_unit_failures_without_fabricated_resource_handshake(self):
        for producer,code in(('entry','entry-refused'),('limits','limit-readback-refused'),('controller','operation-refused'),('preparation','preparation-refused')):
            f=Fixture().entry(producer,code);self.assertTrue(r.audit(f.packet())['diagnosticValid']);self.assertNotIn('resources.json',f.body)
    def test_original_error_code_not_silently_normalized(self):
        f=Fixture().entry('limits','not-a-known-code');self.reject(f.packet())
    def test_signed_launcher_exit_preserved_negative(self):
        f=Fixture().negative('lifetime','lifetime-refused');life=f.envelope['lifetime'];life.update(complete=False,phase='refused',firstFailure='lifetime-refused',launcherExit=-9,cleanupObservationsMissing=True)
        self.assertTrue(r.audit(f.packet())['diagnosticValid']);self.assertEqual(life['launcherExit'],-9)
    def test_negative_infinity_readonly_row_diagnostic_only(self):
        f=Fixture().negative('admission','observer-refused');adm=f.envelope['admission'];adm.update(ackAttempted=False,ackSent=False,ackMayHaveEscaped=False,firstFailure='observer-refused');adm['kernelLimitRows']=adm['kernelLimitRows'][:1];adm['kernelLimitRows'][0].update(observedSoft=-1,observedHard=-1,matchesPolicy=False);f.envelope['lifetime']=None
        self.assertTrue(r.audit(f.packet())['diagnosticValid'])
        f.envelope.update(stage='complete',completeReported=True);self.reject(f.packet())
    def test_null_partial_readonly_pair_no_invented_values(self):
        f=Fixture().negative('admission','observer-refused');adm=f.envelope['admission'];adm.update(ackAttempted=False,ackSent=False,ackMayHaveEscaped=False,firstFailure='observer-refused');adm['kernelLimitRows']=adm['kernelLimitRows'][:1];adm['kernelLimitRows'][0].update(observedSoft=None,observedHard=None,matchesPolicy=False);f.envelope['lifetime']=None
        self.assertTrue(r.audit(f.packet())['diagnosticValid']);adm['kernelLimitRows'][0]['observedHard']=0;self.reject(f.packet())
    def test_escaped_only_ack_never_completes(self):
        f=Fixture();f.envelope['admission']['ackSent']=False;f.envelope['lifetime']['ackSent']=False;self.reject(f.packet())
    def test_ack_attempt_requires_historical_handles_and_all_readonly_rows(self):
        for mutation in('historical','rows'):
            f=Fixture().negative();f.envelope['lifetime']=None;adm=f.envelope['admission'];adm['ackSent']=False
            if mutation=='historical':adm['historicalHandlesAdmitted']=False
            else:adm['kernelLimitRows']=[]
            self.reject(f.packet())
    def test_signal_attempt_requires_admitted_historical_handles(self):
        f=Fixture().negative('lifetime','lifetime-refused');life=f.envelope['lifetime'];life.update(complete=False,phase='refused',firstFailure='lifetime-refused',signalAttempted=True,admissionObserved=False);self.reject(f.packet())
    def test_successful_closed_consumption_is_not_live_handle_authority(self):
        f=Fixture();self.assertTrue(r.audit(f.packet())['completeReportedConsistency']);f.envelope['admission']['currentUsableHandles']=True;self.reject(f.packet())
    def test_cleanup_unknown_or_refusal_cannot_complete(self):
        for mutation in('outer','lifetime','admission'):
            f=Fixture()
            if mutation=='outer':f.envelope['failure']['cleanupUnknown']=True
            else:f.envelope[mutation]['cleanupRefused']=1
            self.reject(f.packet())
    def test_terminal_reap_census_and_eof_contradictions(self):
        for field,value in(('pid1Terminal',False),('launcherReaped',False),('censusCounts',[0]),('censusCounts',[0,1]),('stdoutEOF',False),('launchUnobserved',True)):
            f=Fixture();f.envelope['lifetime'][field]=value;self.reject(f.packet())
    def test_guard_overflow_keeps_prefix_and_prevents_completion(self):
        f=Fixture().negative('lifetime','lifetime-refused');f.body['stdout.prefix']=b'x'*65536;life=f.envelope['lifetime'];life.update(phase='refused',complete=False,firstFailure='lifetime-refused',stdoutPrefixBytes=65536,stdoutObservedBytes=65537,stdoutPrefixSha256=digest(f.body['stdout.prefix']),stdoutEOF=False,outputCapRefused=True)
        self.assertTrue(r.audit(f.packet())['diagnosticValid']);life['stdoutObservedBytes']=65538;self.reject(f.packet())
    def test_raw_hash_length_observed_and_flag_join(self):
        for field,value in(('stdoutPrefixBytes',1),('stdoutPrefixSha256','0'*64),('stdoutObservedBytes',0),('outputCapRefused',True)):
            f=Fixture();f.envelope['lifetime'][field]=value;self.reject(f.packet())
    def test_boolean_counts_and_literal_core_false_refuse(self):
        f=Fixture();f.envelope['lifetime']['cleanupRefused']=False;self.reject(f.packet())
        f=Fixture();f.resource['limits']['rows'][-1]['observations'][0]['soft']=False;f.body['resources.json']=canonical(f.resource);f.envelope['admission']['resourcePacketSha256']=digest(f.body['resources.json']);self.reject(f.packet())
    def test_missing_after_valid_partial_never_complete(self):
        f=Fixture().negative();del f.body['source-after.json'];f.after=None;f.envelope['inheritedProjection']=f.projection();self.assertFalse(r.audit(f.packet())['completeReportedConsistency'])
        f.envelope.update(stage='complete',completeReported=True);self.reject(f.packet())
    def test_stage_dependencies_and_unknown_roles(self):
        f=Fixture().entry();f.body['source-after.json']=canonical(f.after);self.reject(f.packet())
        f=Fixture();f.body['unknown.txt']=b'x'
        with self.assertRaises(a.Refusal):f.packet()
    def test_full_graph_not_replaced_by_derived14(self):
        f=Fixture();f.body['source-before.json']=canonical({'schema':'bw.full-tree-actual-source.v1','roleCount':14,'roles':r.HELD14});self.reject(f.packet())
    def test_projection_canonical_hash_join(self):
        f=Fixture();f.envelope['inheritedProjection']['beforeSha256']='0'*64;self.reject(f.packet())
    def test_snapshot_boolean_role_bytes_does_not_equal_integer_one(self):
        f=Fixture();name='fixtures/runner.py';f.before['roles'][name]['bytes']=True;f.body['source-before.json']=canonical(f.before);self.reject(f.packet())
    def test_fixed14_and_current_component_pin_changes_refuse(self):
        for name in(next(iter(r.HELD14)),next(iter(r.CHECKED_COMPONENTS))):
            f=Fixture();f.table['roles'][name]['sha256']='0'*64;self.resync(f);self.reject(f.packet())
    def resync(self,f):
        raw=canonical(f.table);f.d.update(tableBytes=len(raw),tableSha256=digest(raw),tableGitBlob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest());f.body['role-table.json']=raw;f.body['descriptor.json']=canonical(f.d)
        for key,source in(('source-before.json',f.before),('source-after.json',f.after)):
            source['roles']=copy.deepcopy(f.table['roles']);source['roleCount']=len(source['roles']);source['table']={'path':f.d['tablePath'],'bytes':f.d['tableBytes'],'sha256':f.d['tableSha256'],'gitBlob':f.d['tableGitBlob']};source['descriptorSha256']=digest(f.body['descriptor.json']);f.body[key]=canonical(source)
        f.envelope['inheritedProjection']=f.projection()
    def test_unknown_inherited_kind_and_workflow_miskind_refuse(self):
        f=Fixture();f.table['roles']['fixtures/runner.py']['kind']='inherited';self.resync(f);self.reject(f.packet())
        f=Fixture();f.table['roles'][f.d['workflow']]['kind']='readme';self.resync(f);self.reject(f.packet())
    def test_source_ancestor_and_table_self_cycle_refuse(self):
        f=Fixture();f.table['roles']['fixtures']=copy.deepcopy(f.table['roles']['fixtures/runner.py']);self.resync(f);self.reject(f.packet())
        f=Fixture();f.d['tablePath']='fixtures';self.resync(f);self.reject(f.packet())
    def test_table_gitblob_and_descriptor_status_not_declared_authority(self):
        f=Fixture();f.d['tableGitBlob']='0'*40;f.body['descriptor.json']=canonical(f.d);self.reject(f.packet())
        f=Fixture();f.d['status']='ARMED';f.body['descriptor.json']=canonical(f.d);self.reject(f.packet())
    def test_declared_metadata_and_matching_sha_do_not_authenticate(self):
        f=Fixture();f.envelope['context'].update(declaredRun=1,declaredJob=2,declaredArtifact=3,declaredApprovalSha256='1'*64);raw=f.packet();result=r.audit(raw,digest(raw));self.assertTrue(result['declaredDigestConsistent']);self.assertFalse(result['officialBindingQualified']);self.assertFalse(result['externalApprovalQualified'])
    def test_raw_cap_and_foreign_input_precede_hash(self):
        for raw in(b'x'*524289,'not-bytes',bytearray(b'x'*22)):
            with patch.object(r,'sha',side_effect=AssertionError('hash reached'))as hasher:
                with self.assertRaises(r.Refusal):r.audit(raw,'0'*64)
                hasher.assert_not_called()
    def test_json_duplicate_float_nonfinite_depth_and_foreign_nested_shapes(self):
        for raw in(b'{"schema":1,"schema":2}',b'{"x":1.5}',b'{"x":NaN}',b'['*34+b'0'+b']'*34):
            f=Fixture().entry();f.packet();f.body['envelope.json']=raw;self.reject(a.assemble(f.body))
        f=Fixture();f.envelope['admission']['kernelLimitRows']=[None];self.reject(f.packet())
    def test_member_byte_rows_cannot_bless_changed_body(self):
        f=Fixture();f.packet();f.body['stderr.prefix']=b'changed';self.reject(a.assemble(f.body))
    def test_stored_framing_rejects_hidden_prefix_tail_and_crc(self):
        raw=Fixture().packet();self.reject(b'x'+raw);self.reject(raw+b'x');self.reject(put(raw,14,'I',0))
    def test_flags_methods_extras_comments_and_zip64_refuse(self):
        raw=Fixture().packet();central=central_offset(raw)
        for offset,fmt,value in((6,'H',1),(6,'H',8),(8,'H',8),(28,'H',1),(central+30,'H',1),(central+32,'H',1),(len(raw)-2,'H',1),(18,'I',0xffffffff)):
            self.reject(put(raw,offset,fmt,value))
    def test_central_offsets_names_modes_dates_and_counts_refuse(self):
        raw=Fixture().packet();central=central_offset(raw)
        for offset,fmt,value in((central+42,'I',1),(central+38,'I',0),(central+38,'I',0o120777<<16),(central+14,'H',0),(len(raw)-12,'H',1)):
            self.reject(put(raw,offset,fmt,value))
        self.reject(put(raw,central+46,'B',ord('x')))
    def test_duplicate_names_and_noncanonical_local_order(self):
        f=Fixture().entry();raw=f.packet()
        # Rename equal-length stderr.prefix to stdout.prefix in both framing tables.
        bad=raw.replace(b'stderr.prefix',b'stdout.prefix');self.reject(bad)
        bodies=f.body;order=['stdout.prefix','envelope.json','stderr.prefix','status.txt'];stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w')as z:
            for name in order:
                info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.external_attr=0o100644<<16;z.writestr(info,bodies[name])
        self.reject(stream.getvalue())
    def test_assembler_caps_and_foreign_containers(self):
        f=Fixture().entry();f.packet();f.body['stdout.prefix']=b'x'*65537
        with self.assertRaises(a.Refusal):a.assemble(f.body)
        class Custom(dict):pass
        with self.assertRaises(a.Refusal):a.assemble(Custom(f.body))
    def test_original_firstfailure_join_not_replaced_by_outer_enum(self):
        f=Fixture().negative('lifetime','lifetime-reentry');f.envelope['lifetime'].update(phase='refused',complete=False,firstFailure='lifetime-refused');self.reject(f.packet())
if __name__=='__main__':unittest.main()

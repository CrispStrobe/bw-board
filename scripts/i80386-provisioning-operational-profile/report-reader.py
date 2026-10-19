"""Independent bounded bytes-only semantic audit of the fixed approval-refusal smoke."""
import hashlib,json
CAPS={'controller-status.json':262144,'entry-status.json':65536,'resource-wire.bin':8192,'resource-observation.json':16384,'lifetime-status.json':32768,'capture-index.json':16384,'official-event.json':8192,'stdout.bin':65536,'stderr.bin':65536,'observation.zip':524288,'observer-diagnostic.bin':65536}
POLICY=(('cpuSeconds',0,180),('addressSpaceBytes',9,2147483648),('fileBytes',1,67108864),('fdCount',7,256),('coreBytes',4,0))
class Refusal(ValueError):pass
def need(ok,code):
    if not ok:raise Refusal(code)
def keys(value,names):
    need(type(value)is dict and all(type(k)is str for k in value)and set(value)==set(names),'closed-shape')
def load(body,cap):
    need(type(body)is bytes and len(body)<=cap,'bytes-cap')
    def pairs(items):
        value={}
        for key,item in items:need(key not in value,'duplicate-json');value[key]=item
        return value
    def bad(_):raise Refusal('json-number')
    try:return json.loads(body.decode(),object_pairs_hook=pairs,parse_float=bad,parse_constant=bad)
    except (ValueError,UnicodeError,RecursionError)as error:raise Refusal('json-refused')from error

def flags(value,names):
    for name in names:need(name in value and value[name]is False,'authority-flag')
def limits(value):
    f=('namespaceOwnershipQualified','officialHostQualified','aggregateResourceQuotaQualified','diskQuotaQualified','actualResourceSufficiencyQualified','outerTimeoutQualified','bootstrapConnected','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified')
    keys(value,('schema','phase','closed','prepared','firstFailure','stoppedPhase','eligibility','policy','rows','setAttempted','getAttempted','processLimitsPrepared',*f))
    need(value['schema']=='bw.provisioning-pid1-limits.v1'and value['phase']=='prepared'and value['closed']is True and value['prepared']is True and value['processLimitsPrepared']is True and value['firstFailure']is None and value['stoppedPhase']is None,'limits-refused')
    flags(value,f);keys(value['eligibility'],('linuxObserved','pid1Observed','rootCredentialsObserved','githubContextObserved'));need(all(v is True for v in value['eligibility'].values()),'eligibility')
    need(type(value['setAttempted'])is int and value['setAttempted']==5 and type(value['getAttempted'])is int and value['getAttempted']==10,'limit-counts')
    need(type(value['policy'])is list and type(value['rows'])is list and len(value['policy'])==len(value['rows'])==5,'policy-count')
    for expected,policy,row in zip(POLICY,value['policy'],value['rows']):
        name,kind,amount=expected
        keys(policy,('name','resource','soft','hard'));keys(row,('name','resource','soft','hard','setReturned','observations'))
        for item in (policy,row):
            need(item['name']==name and all(type(item[k])is int for k in ('resource','soft','hard'))and(item['resource'],item['soft'],item['hard'])==(kind,amount,amount),'policy')
        need(row['setReturned']is True and type(row['observations'])is list and len(row['observations'])==2,'limit-observations')
        for position,obs in zip(('immediate','final'),row['observations']):
            keys(obs,('position','shapeValid','soft','hard','matchesPolicy'))
            need(obs['position']==position and obs['shapeValid']is True and obs['matchesPolicy']is True and type(obs['soft'])is int and type(obs['hard'])is int and obs['soft']==obs['hard']==amount,'readback')

def captures(records,names,members):
    keys(records,names)
    for name,record in records.items():
        keys(record,('state','attempts','rolePresent','contentComplete','closeCertain','reason','bytes','sha256'))
        need(record['state']=='captured'and type(record['attempts'])is int and record['attempts']==1 and all(record[k]is True for k in ('rolePresent','contentComplete','closeCertain'))and record['reason']is None,'capture-uncertain')
        need(name in members and type(record['bytes'])is int and record['bytes']==len(members[name])and record['sha256']==hashlib.sha256(members[name]).hexdigest(),'capture-body')

def audit(members,observer_exit,outer_overflow):
    need(type(members)is dict and all(type(k)is str for k in members)and set(members)<=set(CAPS),'members')
    for name,body in members.items():need(type(body)is bytes and len(body)<=CAPS[name],'role-cap')
    need(sum(map(len,members.values()))<=1572864,'decoded-cap')
    need(type(observer_exit)is int and type(outer_overflow)is bool,'outer-status')
    result={'schema':'bw.provisioning-operational-smoke-result.v1','diagnosticValid':True,'finiteFixturePass':False,'materializationComplete':False,'semanticUnsupported':False,'firstAuditFailure':None,'actualAcquisitionQualified':False,'profileSourceAdmissionQualified':False,'sourceOwnedQualified':False,'filesystemLeaseQualified':False,'namespaceQualified':False,'hardDeadlineQualified':False,'fullToolchainReady':False,'compilerQualified':False,'guestQualified':False,'performanceQualified':False}
    try:
        index=load(members['capture-index.json'],16384)
        keys(index,('schema','mode','roles','childCapture','parentCapture','observerExit','outerDiagnosticBytes','outerDiagnosticOverflow','outerCaptureError','outerCleanupRefused','reviewDigest','hostTools','observationAbsentReason','finiteFixturePass','materializationComplete','actualAcquisitionQualified','compilerQualified'))
        need(index['schema']=='bw.provisioning-operational-capture.v1'and index['mode']=='limits-ack-approval-refusal'and index['finiteFixturePass']is False and index['materializationComplete']is False,'capture-mode')
        flags(index,('actualAcquisitionQualified','compilerQualified'))
        need(type(index['roles'])is dict and set(index['roles'])==set(members)-{'capture-index.json'},'inventory-closure')
        for name,body in members.items():
            if name=='capture-index.json':continue
            row=index['roles'][name];keys(row,('bytes','sha256'));need(type(row['bytes'])is int and row['bytes']==len(body)and row['sha256']==hashlib.sha256(body).hexdigest(),'inventory-digest')
        need(type(index['observerExit'])is int and index['observerExit']==observer_exit and type(index['outerDiagnosticBytes'])is int and index['outerDiagnosticBytes']==len(members['observer-diagnostic.bin'])and index['outerDiagnosticOverflow']is outer_overflow and index['outerCaptureError']is None and type(index['outerCleanupRefused'])is int and index['outerCleanupRefused']==0 and index['observationAbsentReason']=='child-before-group-absent','outer-index')
        need(type(index['reviewDigest'])is str and len(index['reviewDigest'])==64 and all(x in '0123456789abcdef'for x in index['reviewDigest']),'review-reference')
        keys(index['hostTools'],('/usr/bin/python3','/usr/bin/timeout','/usr/bin/unshare','/usr/bin/git'))
        for row in index['hostTools'].values():
            keys(row,('bytes','sha256'));need(type(row['bytes'])is int and 0<row['bytes']<=16777216 and type(row['sha256'])is str and len(row['sha256'])==64 and all(x in '0123456789abcdef'for x in row['sha256']),'tool-observation')
        child=index['childCapture'];keys(child,('schema','records','primaryType','captureErrors','observationAbsentReason','actualAcquisitionQualified','compilerQualified'))
        need(child['schema']=='bw.provisioning-contained-capture.v1'and child['primaryType']=='Refusal'and type(child['captureErrors'])is list and child['captureErrors']==[] and child['observationAbsentReason']=='child-before-group-absent','child-capture-refused')
        flags(child,('actualAcquisitionQualified','compilerQualified'))
        captures(child['records'],('resource-wire.bin','controller-status.json','entry-status.json'),members)
        captures(index['parentCapture'],('observer-diagnostic.bin','official-event.json'),members)
        event=load(members['official-event.json'],8192)
        keys(event,('schema','event','action','repository','headRepository','pr','head','base','run','attempt','workflow','job','mode','authenticatedContextQualified'))
        need(event['schema']=='bw.provisioning-operational-event.v1'and event['event']=='pull_request'and event['action']=='opened'and event['headRepository']=='CrispStrobe/bw-board'and type(event['pr'])is int and event['pr']>0 and type(event['base'])is str and len(event['base'])==40 and all(x in '0123456789abcdef'for x in event['base'])and event['workflow']=='.github/workflows/i80386-provisioning-operational-profile.yml'and event['job']=='operational-smoke'and event['repository']=='CrispStrobe/bw-board'and event['mode']=='limits-ack-approval-refusal'and event['authenticatedContextQualified']is False and type(event['head'])is str and len(event['head'])==40 and all(x in '0123456789abcdef'for x in event['head'])and type(event['run'])is int and event['run']>0 and type(event['attempt'])is int and event['attempt']==1,'event-context')
        required={'controller-status.json','entry-status.json','resource-wire.bin','resource-observation.json','lifetime-status.json','stdout.bin','stderr.bin'}
        need(required<=set(members)and 'observation.zip'not in members,'missing-or-fabricated-roles')
        c=load(members['controller-status.json'],262144)
        if type(c)is dict and c.get('firstFailure')not in (None,'approval-unarmed'):result['semanticUnsupported']=True
        cf=('actualAcquisitionQualified','profileSourceAdmissionQualified','sourceOwnedQualified','inputLeaseQualified','filesystemLeaseQualified','namespaceModeQualified','completeNoticeCoverageQualified','legalClearanceQualified','fullToolchainReady','compilerQualified','guestQualified','performanceQualified')
        # Bind exact held schema, not arbitrary all-false report shapes.
        keys(c,('schema','phase','closed','complete','firstFailure','secondaryFailure','bootstrapComponentsVerified','sourceBefore','sourceAfter','inheritedProjection','transport','coordinator','cleanupRefused','outerHardBoundImplemented',*cf))
        need(c['schema']=='bw.provisioning-controller-result.v1'and c['phase']=='refused'and c['closed']is True and c['complete']is False and c['firstFailure']=='approval-unarmed'and c['secondaryFailure']is None,'controller-refusal')
        need(type(c['bootstrapComponentsVerified'])is int and c['bootstrapComponentsVerified']==0 and type(c['cleanupRefused'])is int and c['cleanupRefused']==0,'controller-work-after-refusal')
        need(all(c[k]is None for k in ('sourceBefore','sourceAfter','transport','coordinator')),'invented-source-or-acquisition')
        keys(c['inheritedProjection'],('kind','before','after'));need(c['inheritedProjection']=={'kind':'INHERITED14_DERIVED_FROM_FULL_PROFILE_POSITIONS','before':None,'after':None},'inherited-projection');flags(c,(*cf,'outerHardBoundImplemented'))
        e=load(members['entry-status.json'],65536)
        ef=('observerOwnershipQualified','outerTimeoutQualified','officialHostQualified','resourceSufficiencyQualified','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified')
        keys(e,('schema','phase','closed','complete','firstFailure','stoppedPhase','cleanupRefused','resourceFacts','handshakeSent','ackReceived','controllerLoaded','sourceControllerResultState','controllerStatusCapture',*ef))
        need(e['schema']=='bw.provisioning-contained-entry.v1'and e['phase']=='refused'and e['closed']is True and e['complete']is False and e['firstFailure']=='entry-refused'and e['stoppedPhase']=='controller'and type(e['cleanupRefused'])is int and e['cleanupRefused']==0,'entry-refusal')
        need(e['handshakeSent']is True and e['ackReceived']is True and e['controllerLoaded']is True and e['sourceControllerResultState']=='absent','entry-issue');flags(e,ef)
        capture=e['controllerStatusCapture'];keys(capture,('state','attempts','rolePresent','contentComplete','closeCertain','reason','bytes','sha256'));need(capture=={'state':'captured','attempts':1,'rolePresent':True,'contentComplete':True,'closeCertain':True,'reason':None,'bytes':len(members['controller-status.json']),'sha256':hashlib.sha256(members['controller-status.json']).hexdigest()},'controller-capture')
        wire=load(members['resource-wire.bin'],8192);keys(wire,('schema','components','limits','controllerBootstrapStarted','observerOwnershipQualified','actualAcquisitionQualified','compilerQualified','guestQualified'))
        need(wire['schema']=='bw.provisioning-contained-resource.v1','wire-schema');flags(wire,('controllerBootstrapStarted','observerOwnershipQualified','actualAcquisitionQualified','compilerQualified','guestQualified'))
        keys(wire['components'],('limits','controller'))
        for key,size,digest in (('limits',5805,'829872fee3f1565ec8a67c57e74a7caba8c202b027ea6260f184425e888455d4'),('controller',19661,'9cb7cb6411694b65a9fe18a318967e04b3e24f5d9f86d4f59e48797fd19a43dd')):
            row=wire['components'][key];keys(row,('bytes','sha256'));need(type(row['bytes'])is int and row['bytes']==size and row['sha256']==digest,'component-pin')
        limits(wire['limits']);need(e['resourceFacts']==wire['limits'],'entry-original-resource')
        o=load(members['resource-observation.json'],16384)
        of=('namespaceOwnershipQualified','continuousPIDLeaseQualified','outerTimeoutQualified','officialHostQualified','resourceSufficiencyQualified','aggregateQuotaQualified','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified')
        keys(o,('schema','sourceSchema','phase','closed','admissionObserved','firstFailure','cleanupRefused','kernelLimitRows','handlesAdmitted','ownedDescriptors','ackAttempted','ackSent','ackMayHaveEscaped','resourceWireReference',*of))
        need(o['schema']=='bw.provisioning-operational-resource-observation.v1'and o['sourceSchema']=='bw.provisioning-observer-admission.v1'and o['phase']=='closed'and o['closed']is True and o['firstFailure']is None,'observer-final')
        need(all(o[k]is True for k in ('admissionObserved','handlesAdmitted','ackAttempted','ackSent','ackMayHaveEscaped'))and type(o['ownedDescriptors'])is int and o['ownedDescriptors']==0 and type(o['cleanupRefused'])is int and o['cleanupRefused']==0,'observer-facts');flags(o,of)
        need(o['resourceWireReference']=={'bytes':len(members['resource-wire.bin']),'sha256':hashlib.sha256(members['resource-wire.bin']).hexdigest()},'wire-reference')
        need(type(o['kernelLimitRows'])is list and len(o['kernelLimitRows'])==5,'kernel-rows')
        for row,(name,kind,amount)in zip(o['kernelLimitRows'],POLICY):
            keys(row,('name','resource','observedSoft','observedHard','matchesPolicy'));need(row['name']==name and all(type(row[k])is int for k in ('resource','observedSoft','observedHard'))and(row['resource'],row['observedSoft'],row['observedHard'])==(kind,amount,amount)and row['matchesPolicy']is True,'kernel-readback')
        l=load(members['lifetime-status.json'],32768)
        lf=('namespaceOwnershipQualified','continuousLeaseQualified','outerHardDeadlineQualified','officialHostQualified','resourceSufficiencyQualified','actualAcquisitionQualified','compilerQualified','guestQualified','performanceQualified')
        keys(l,('schema','phase','closed','complete','firstFailure','cleanupRefused','stdoutPrefixBytes','stderrPrefixBytes','stdoutObservedBytes','stderrObservedBytes','stdoutPrefixSha256','stderrPrefixSha256','stdoutEOF','stderrEOF','outputCapRefused','admissionObserved','historicalHandlesAdmitted','ackAttempted','ackSent','ackMayHaveEscaped','pid1Terminal','launcherReaped','launcherExit','censusCounts','signalAttempted','signalReturned','cleanupObservationsMissing','launchUnobserved',*lf))
        need(l['schema']=='bw.provisioning-observer-lifetime.v1'and l['phase']=='observed'and l['closed']is True and l['complete']is True and l['firstFailure']is None and type(l['cleanupRefused'])is int and l['cleanupRefused']==0,'lifetime-final');flags(l,lf)
        need(all(l[k]is True for k in ('stdoutEOF','stderrEOF','admissionObserved','historicalHandlesAdmitted','ackAttempted','ackSent','ackMayHaveEscaped','pid1Terminal','launcherReaped'))and all(l[k]is False for k in ('outputCapRefused','signalAttempted','signalReturned','cleanupObservationsMissing','launchUnobserved')),'lifetime-observations')
        need(type(l['launcherExit'])is int and l['launcherExit']==0 and type(l['censusCounts'])is list and len(l['censusCounts'])==2 and all(type(n)is int and n==0 for n in l['censusCounts']),'terminal-census')
        for prefix in ('stdout','stderr'):
            body=members[prefix+'.bin'];need(type(l[prefix+'PrefixBytes'])is int and type(l[prefix+'ObservedBytes'])is int and l[prefix+'PrefixBytes']==l[prefix+'ObservedBytes']==len(body)and l[prefix+'PrefixSha256']==hashlib.sha256(body).hexdigest(),'raw-prefix')
        need(observer_exit==0 and outer_overflow is False,'outer-refusal')
        result['finiteFixturePass']=True
    except (Refusal,KeyError,TypeError,RecursionError)as error:result['diagnosticValid']=False;result['firstAuditFailure']=str(error)if type(error)is Refusal else'closed-shape'
    return result


def audit_zip(raw):
    """Closed gapless STORED companion; no decompression or producer imports."""
    import struct,zlib
    need(type(raw)is bytes and 22<=len(raw)<=2097152,'zip-cap')
    sig,disk,central_disk,n1,n2,size,offset,comment=struct.unpack_from('<4s4H2IH',raw,len(raw)-22)
    need(sig==b'PK\x05\x06'and disk==central_disk==comment==0 and n1==n2 and 1<=n1<=11 and offset+size==len(raw)-22,'zip-eocd')
    position=offset;local=0;members={}
    for _ in range(n1):
        need(position+46<=len(raw)-22,'central-cap')
        row=struct.unpack_from('<4s6H3I5H2I',raw,position)
        signature,made,needed,flags_,method,clock,date,crc,compressed,decoded,nlen,xlen,clen,disk_,internal,external,local_offset=row
        need(signature==b'PK\x01\x02'and made==788 and needed==20 and flags_==method==clock==xlen==clen==disk_==internal==0 and date==33 and compressed==decoded and local_offset==local and (external>>16)==0o100600 and (external&65535)==0,'central-fields')
        namebytes=raw[position+46:position+46+nlen]
        try:name=namebytes.decode('ascii')
        except UnicodeError:raise Refusal('zip-name')from None
        need(name in CAPS and name not in members and decoded<=CAPS[name],'zip-role')
        need(local+30<=offset,'local-cap')
        header=struct.unpack_from('<4s5H3I2H',raw,local)
        need(header==(b'PK\x03\x04',needed,flags_,method,clock,date,crc,compressed,decoded,nlen,0),'local-central')
        need(raw[local+30:local+30+nlen]==namebytes,'local-name')
        start=local+30+nlen;end=start+decoded;need(end<=offset,'body-cap')
        body=raw[start:end];need(zlib.crc32(body)&0xffffffff==crc,'body-crc');members[name]=body
        local=end;position+=46+nlen
    need(position==offset+size and local==offset,'zip-hidden-bytes')
    need(sum(len(b)for b in members.values())<=1572864,'zip-decoded')
    index=load(members.get('capture-index.json',b''),16384)
    return audit(members,index.get('observerExit',-255),index.get('outerDiagnosticOverflow',True))

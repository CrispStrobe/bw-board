"""Manufactured byte/mock packet controls, no producer or emulator imports."""
import copy,hashlib,json,struct,importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location("reader",Path(__file__).with_name("reader.py"));reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)
H = lambda b: hashlib.sha256(b).hexdigest()
J = lambda x: json.dumps(x, separators=(',',':')).encode()
# Separate literal scan table for the fixed script alphabet, not reader.scan_codes.
CODES = {'n':49,'e':18,'c':46,'h':35,'o':24,' ':57,'b':48,'w':17,'-':12,
         'd':32,'p':25,'r':19,'s':31,'i':23,'t':20,'k':37,'\\':43,'.':52,'x':45,'y':21,'\r':28}
def scans(text):
    out=[]
    for c in text:
        if c=='\x1d':continue
        if c in '>:':out.extend([42,52 if c=='>' else 39,(52 if c=='>' else 39)|128,170])
        else:out.extend([CODES[c],CODES[c]|128])
    return out
COMMAND = {'enter':'\r','decline':'n\r','write':'echo bw-hdd-persist-ok>c:\\bwkeep.txt\r','read':'type c:\\bwkeep.txt\r','quit':'\x1d'}
OPEN=bytes.fromhex('1b5b3f31303439681b5b3f32356c1b5b3f31303033681b5b3f31303036681b5b3f3130303468')
CLOSE=bytes.fromhex('1b5b3f313030336c1b5b3f313030366c1b5b3f313030346c1b5b3f3235681b5b3f313034396c')
TOP = 'schema executionRevision sourceSha256 inputs steps stop refusal cpu machineCycles nativeStats code16WasmStats code16LoadExecutions delivered serial ramSha256 diskSha256 textRam vga hddOutput'.split()

def pack(fixture):
    raw=OPEN
    ends=[]
    for frame in fixture['frames']:
        rows=(frame['rows']+['']*25)[:25]
        raw+=b'\x1b[H\x1b[2J'+(f"386 AT  step {frame['step']}/120000000  text RAM  Ctrl-] quit  Ctrl-L redraw\n"+'\n'.join(row.ljust(80) for row in rows)).encode()+b'\x1b[0m'
        ends.append(len(raw))
    raw+=CLOSE
    ledger=copy.deepcopy(fixture['ledger'])
    for offer in ledger['offers']:
        offer['rawBytesSeen']=ends[offer['frameOrdinal']-1]
    return raw,J(fixture['report']),J(ledger)

def make(writer=True,menu=False,interrupt=None):
    frames=[];offers=[];delivered=[];step=0
    def frame(rows):frames.append({'step':step,'rows':rows})
    def offer(name):
        offers.append({'offerOrdinal':len(offers)+1,'frameOrdinal':len(frames),'frameStep':step,
                       'rawBytesSeen':0,'elapsedNs':len(offers)*1000000000,
                       'bytesHex':COMMAND[name].encode().hex(),'writtenBytes':len(COMMAND[name])})
        return scans(COMMAND[name])
    def deliver(codes):
        nonlocal step
        for code in codes:
            step=(step//1024+1)*1024
            delivered.append({'step':step,'type':'live-key','code':code,'accepted':True})
        step+=1024
    if menu:
        frame(['Select from Menu']);deliver(offer('enter'))
    frame(['Do you want to proceed [Y,N]?']);deliver(offer('decline'))
    frame(['The installation of FreeDOS 1.4 has been aborted.','A:\\>'])
    if writer:
        deliver(offer('write'))
        rows=['A:\\>echo bw-hdd-persist-ok>c:\\bwkeep.txt','A:\\>']
        frame(rows);step+=1500000
        if interrupt=='write':frame(['changed']);step+=1
        frame(rows)
    deliver(offer('read'))
    rows=['A:\\>type c:\\bwkeep.txt','bw-hdd-persist-ok','A:\\>']
    frame(rows);step+=1500000
    if interrupt=='read':frame(['changed']);step+=1
    frame(rows);offer('quit')
    inp={'bios':'a'*64,'vga':'b'*64,'hdd':'0'*64,'geometry':[306,4,17],'cmosType':47,
         'floppy':{'opaque':True},'expandedGroupedAdmission':False,'registerStackAdmission':False,
         'nativeBlocks':False,'code16Loads':False,'code16Wasm':False,'cmosEquipment':5,
         'events':H(b'[]'),'mouseEnabled':True,'dosboxConfig':None}
    geometry={'cylinders':306,'heads':4,'sectors':17}
    out={'schema':'bw.i80386-master-hdd-output.v1','drive':'master',
         'input':{'sha256':'0'*64,'byteLength':10653696,'geometry':geometry},
         'output':{'sha256':'1'*64,'byteLength':10653696,'geometry':geometry,'boundary':{'cpuCycles':1,'machineCycles':6}},
         'complete':True,'guestCompletionQualified':False}
    report=dict(zip(TOP,[None]*len(TOP)))
    report.update(schema='bw.i80386-at-console.v1',executionRevision='a'*40,sourceSha256={},inputs=inp,
                  steps=step+50000,stop='user-quit',refusal=None,cpu={'finiteFloatOpaque':.5},machineCycles=6,
                  nativeStats=None,code16WasmStats=None,code16LoadExecutions=0,delivered=delivered,
                  serial={},ramSha256='2'*64,diskSha256='1'*64,textRam=[],vga={},hddOutput=out)
    return {'writer':writer,'frames':frames,'ledger':{'schema':'bw.hdd-session-input.v1','writer':writer,'offers':offers},'report':report}

import struct
initial=bytearray(306*4*17*512)
# Independent authored-byte construction; no verifier header/layout helper call.
initial[446:462]=bytes.fromhex('80010100060351311100000037510000')
initial[510:512]=b'\x55\xaa';v=17*512
initial[v:v+11]=b'\xeb\x3c\x90ASTRA386'
for o,val in [(11,512),(14,1),(17,512),(19,20791),(22,41),(24,17),(26,4)]:struct.pack_into('<H',initial,v+o,val)
initial[v+13]=2;initial[v+16]=2;initial[v+21]=0xf8;struct.pack_into('<I',initial,v+28,17)
initial[v+36]=0x80;initial[v+38]=0x29;struct.pack_into('<I',initial,v+39,0x386d0019)
initial[v+43:v+54]=b'FREEBIOSHD ';initial[v+54:v+62]=b'FAT16   ';initial[v+510:v+512]=b'\x55\xaa'
for base in [18*512,59*512]:struct.pack_into('<HHH',initial,base,65528,65535,65535)
root=100*512;data=132*512;old=b'FREE-BIOS 386 C: MOUNT OK\r\n';initial[root:root+11]=b'CMOUNTOKTXT';initial[root+11]=32;struct.pack_into('<HI',initial,root+26,2,len(old));initial[data:data+len(old)]=old
initial=bytes(initial);exported=bytearray(initial);slot=root+32;cluster=71
exported[slot:slot+11]=b'BWKEEP  TXT';exported[slot+11]=32;struct.pack_into('<HI',exported,slot+26,cluster,19)
exported[slot+13:slot+20]=bytes.fromhex('01020304050607');exported[slot+22:slot+26]=bytes.fromhex('08090a0b')
for base in [18*512,59*512]:struct.pack_into('<H',exported,base+2*cluster,65528)
payload=data+(cluster-2)*1024;exported[payload:payload+19]=b'bw-hdd-persist-ok\r\n';exported=bytes(exported)


def packet_fixture():
    packet={'initial.img':initial,'first.img':exported,'second.img':exported}
    head='a'*40;tree='b'*40
    cmap={'../src/f%02d.js'%i:H(str(i).encode()) for i in range(79)}
    src={'schema':'bw.hdd-cli-source.v1','head':head,'tree':tree,'rows':[{'path':'src/f%02d.js'%i,'gitBlob':'c'*40,'byteLength':i,'sha256':cmap['../src/f%02d.js'%i]} for i in range(79)]}
    common_paths=['scripts/i80386-hdd-export/'+n for n in ['probe.mjs','probe.py','reader.py','controls.py','README.md']]+['.github/workflows/i80386-hdd-export.yml','scripts/lib/i80386-free-bios-fat16.mjs','scripts/lib/i80386-source-inventory.mjs','package.json']
    for name in common_paths:src['rows'].append({'path':name,'gitBlob':'d'*40,'byteLength':100,'sha256':H(name.encode())})
    src['rows'].sort(key=lambda x:x['path'])
    pro={'repository':'CrispStrobe/bw-board','head':head,'workflowPath':'.github/workflows/i80386-hdd-export.yml','workflowBlob':'d'*40,'runId':1,'runAttempt':1,'jobId':2,'runnerName':'authored','runnerImageOS':'ubuntu24','runnerImageVersion':'authored',**reader.ACTIONS}
    runtime={'schema':'bw.hdd-cli-runtime.v2','profile':'hosted-observed-runtime-identity.v1','provenance':pro,'rows':[{'role':role,'path':path,'realpath':'/authored/'+role,'byteLength':100,'sha256':H(role.encode()),'version':'v22.23.3' if role=='node' else 'authored'} for role,path in [('node','runtime/bin/node'),('python','/usr/bin/python3'),('git','/usr/bin/git')]],'sourceBuildAuthenticityQualified':False,'completeElfStdlibClosureQualified':False}
    for name,value in [('source-before.json',src),('source-after.json',src),('runtime-before.json',runtime),('runtime-after.json',runtime)]:packet[name]=J(value)
    admission={'schema':'bw.hdd-cli-admission.v1','sourceHead':head,'sourceTree':tree,**{k:'e'*64 for k in ['consoleMapSha256','commonMapSha256','mediaReviewSha256','resourcePolicySha256','protocolSha256','runtimeIdentityPolicySha256']},'inputGeometry':reader.GEOMETRY,'childGuestSteps':120000000,'stableStepCalls':1500000,'childWallSeconds':600,'outerWallSeconds':1250,'secondExportsReadback':True,'authority':'external-reviewed-inputs-required','runtimeProfile':'hosted-observed-runtime-identity.v1'}
    admission['consoleMapSha256']=H(json.dumps(cmap,sort_keys=True,separators=(',',':'),ensure_ascii=True).encode());admission['commonMapSha256']=H(json.dumps({name:H(name.encode()) for name in common_paths},sort_keys=True,separators=(',',':'),ensure_ascii=True).encode())
    admission.update({'resourcePolicySha256':'972033e74a72326a9cd62aae27c3ecfafab4177d39654644d5c57b73c3038dba','runtimeIdentityPolicySha256':'44e2e9586ba0e16010242e0fd32b031a7b04f30071cb80cfd7a62abeeedf70ce','protocolSha256':'dc805d09aaff86c28bfd407df9d28570a551a02aaa4d9ce7818ce0c58c57138e'})
    admission['mediaReviewSha256']='93a1119016e7e9d2a963ce4491199698e852739f9d20b3b7b0f5fdfe10c41795';packet['admission.json']=J(admission)
    for stage in ['before','between','after']:
        rows=[]
        for name in ['bios','vga','floppy','initial']+([] if stage=='before' else ['first'])+(['second'] if stage=='after' else []):
            size,h=reader.FIXED_MEDIA.get(name,(reader.SIZE,H(exported)))
            rows.append({'role':name,'byteLength':size,'sha256':h,'regular':True})
        packet['media-'+stage+'.json']=J({'schema':'bw.hdd-cli-media.v1','stage':stage,'rows':rows})
    resource={'cgroupRole':'/system.slice/bw-hdd-export-1-1.service','cpuMax':'100000 100000','memoryMaxBytes':1073741824,'swapMaxBytes':0,'affinityCpus':[0],'memoryEvents':dict.fromkeys(['low','high','max','oom','oom_kill','oom_group_kill'],0)}
    for child,writer in [(1,True),(2,False)]:
        f=make(writer);report=f['report'];inp=H(initial if writer else exported)
        report.update(executionRevision=head,sourceSha256=cmap,cpu=dict(cs=0,eip=0,cr0=0,cr3=0,cr4=0,eflags=2,cycles=1,instructionSnapshot={}),serial={'bytes':0,'text':''},textRam=['']*25,vga={'registers':{},'planeSha256':['0'*64]*4,'snapshotPath':None})
        report['inputs'].update(bios=reader.FIXED_MEDIA['bios'][1],vga=reader.FIXED_MEDIA['vga'][1],hdd=inp,floppy={'sha256':reader.FIXED_MEDIA['floppy'][1],'byteLength':1228800,'geometry':{'cylinders':80,'heads':2,'sectors':15,'bytesPerSector':512},'drive':0,'cmosDriveType':32,'bootOrder':33})
        report['hddOutput']['input']['sha256']=inp;report['hddOutput']['output']['sha256']=H(exported);report['diskSha256']=H(exported)
        raw,rep,ledger=pack(f)
        prefix=f'child{child}/';packet.update({prefix+'pty.bin':raw,prefix+'report.json':rep,prefix+'offers.json':ledger,prefix+'stderr.bin':b''})
        # Independently construct offsets from authored emitted blocks, not reader parsing.
        frames=[];cursor=len(OPEN)
        for fr in f['frames']:
            rows=(fr['rows']+['']*25)[:25]
            body=(f"386 AT  step {fr['step']}/120000000  text RAM  Ctrl-] quit  Ctrl-L redraw\n"+'\n'.join(row.ljust(80) for row in rows)).encode()
            block=b'\x1b[H\x1b[2J'+body+b'\x1b[0m'
            assert raw[cursor:cursor+len(block)]==block
            frames.append({'frameOrdinal':len(frames)+1,'frameStep':fr['step'],'stepLimit':120000000,'frameStartRawOffset':cursor,'endRawOffset':cursor+len(block),'textBodySha256':H(body.split(b'\n',1)[1])})
            cursor+=len(block)
        packet[prefix+'frames.json']=J({'schema':'bw.hdd-cli-frames.v1','child':child,'stepDomain':'console-machine-step-calls','frames':frames})
        argv=['runtime/bin/node','source/scripts/run-i80386-at-console.mjs','--hdd-image','inputs/initial.img' if writer else 'outputs/first.img','--geometry','306,4,17','--floppy-image','inputs/floppy.img','--steps','120000000','--live','--hdd-output','outputs/first.img' if writer else 'outputs/second.img']
        env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','TZ':'UTC','TERM':'xterm','AT_BIOS_ROM':'inputs/bios.bin','AT_BIOS_SHA256':reader.FIXED_MEDIA['bios'][1],'VGA_BIOS_ROM':'inputs/vga.bin','VGA_BIOS_SHA256':reader.FIXED_MEDIA['vga'][1],'AT_HDD_SHA256':inp,'AT_FLOPPY_SHA256':reader.FIXED_MEDIA['floppy'][1],'AT_CONSOLE_REPORT':f'outputs/child{child}-report.json','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'}
        events=[]
        def event(kind,phase,**kw):
            row=dict(ordinal=len(events)+1,kind=kind,phase=phase,pid=123,pgid=123,signal=None,inputOrdinal=None,status=None,errorCode=None,elapsedNs=(events[-1]['elapsedNs']+1000000 if events else 0),attemptedBytes=None,writtenBytes=None,bytesHex=None);row.update(kw);events.append(row)
        event('spawn','running')
        for offer in json.loads(ledger)['offers']:event('input-write','running',elapsedNs=max(events[-1]['elapsedNs']+1,offer['elapsedNs']),inputOrdinal=offer['offerOrdinal'],attemptedBytes=offer['writtenBytes'],writtenBytes=offer['writtenBytes'],bytesHex=offer['bytesHex'])
        for kind,phase in [('exit-observed-wnowait','exited-unreaped'),('pty-eof','exited-unreaped'),('stderr-eof','exited-unreaped'),('wait4-reap','reaped'),('group-empty-query','reaped'),('close','closed')]:event(kind,phase,status=0 if kind=='wait4-reap' else None)
        life={'schema':'bw.hdd-cli-lifecycle.v1','child':child,'argv':argv,'environment':env,'pid':123,'pgid':123,'operationalWallLimitSeconds':600,'cleanupLimitSeconds':5,'exitCode':0,'primaryFailure':None,'secondaryFailures':[],'timeout':False,'reaped':True,'ptyEof':True,'stderrEof':True,'groupEmpty':True,'cleanupUncertain':False,'events':events,'wait4Usage':{'userSeconds':1.0,'systemSeconds':0.1,'maxRssKiB':1024},'resourceBefore':copy.deepcopy(resource),'resourceAfter':copy.deepcopy(resource),'cwdRole':'session-root','ownedProcessIdentity':{'pid':123,'exeRealpath':'/authored/node','exeByteLength':100,'exeSha256':H(b'node'),'argv':argv,'observedElapsedNs':1000}}
        packet[prefix+'lifecycle.json']=J(life)
    packet['result.json']=J({'schema':'bw.hdd-cli-result.v1','byteProofPass':False,'session1Pass':False,'session2Pass':False,'finitePersistencePass':False,'firstFailure':None,'secondaryFailures':[],'fullOsQualified':False,'crashDurabilityQualified':False,'installedGuiQualified':False})
    return reindex(packet)

def reindex(packet):
    packet['index.json']=J({'schema':'bw.hdd-cli-index.v1','roles':[{'name':n,'state':'present','byteLength':len(packet[n]),'sha256':H(packet[n])} for n in reader.PACKET_CAPS if n!='index.json']})
    return packet

def mutate_json(packet,name,fn):
    value=json.loads(packet[name]);fn(value);packet[name]=J(value)

count=0
def check(name,edit=None,positive=False):
    global count
    packet=packet_fixture()
    if edit:edit(packet)
    reindex(packet)
    result=reader.verify_packet(packet)
    assert result['reportedConsistencyPass'] is positive,(name,result)
    assert result['fullAcceptanceQualified'] is False and result['finitePersistencePass'] is False
    count+=1;print(name,'PASS' if positive else result['failure'])

check('full-manufactured-packet',positive=True)
for name,edit in [
 ('boundary-mismatch',lambda p:mutate_json(p,'child1/report.json',lambda x:x['hddOutput']['output']['boundary'].update(cpuCycles=2))),
 ('event-float-pid',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x['events'][0].update(pid=123.0))),
 ('cross-session-affinity',lambda p:mutate_json(p,'child2/lifecycle.json',lambda x:(x['resourceBefore'].update(affinityCpus=[1]),x['resourceAfter'].update(affinityCpus=[1])))),
 ('console-map-digest',lambda p:mutate_json(p,'admission.json',lambda x:x.update(consoleMapSha256='f'*64))),
 ('common-map-digest',lambda p:mutate_json(p,'admission.json',lambda x:x.update(commonMapSha256='f'*64))),
 ('fixed-policy',lambda p:mutate_json(p,'admission.json',lambda x:x.update(protocolSha256='f'*64))),
 ('unexpected-source-row',lambda p:[mutate_json(p,n,lambda x:x['rows'].append({'path':'zzz','gitBlob':'d'*40,'byteLength':1,'sha256':'f'*64})) for n in ['source-before.json','source-after.json']]),
 ('between-session-oom',lambda p:mutate_json(p,'child2/lifecycle.json',lambda x:(x['resourceBefore']['memoryEvents'].update(oom=1,oom_kill=1),x['resourceAfter']['memoryEvents'].update(oom=1,oom_kill=1)))),
 ('between-session-counter-regression',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x['resourceAfter']['memoryEvents'].update(high=1))),
 ('stderr',lambda p:p.update({'child2/stderr.bin':b'error'})),
 ('wrong-source',lambda p:mutate_json(p,'child1/report.json',lambda x:x.update(executionRevision='f'*40))),
 ('source-drift',lambda p:mutate_json(p,'source-after.json',lambda x:x['rows'][0].update(sha256='f'*64))),
 ('runtime-drift',lambda p:mutate_json(p,'runtime-after.json',lambda x:x['rows'][0].update(sha256='f'*64))),
 ('node-version',lambda p:[mutate_json(p,n,lambda x:x['rows'][0].update(version='v20.20.2')) for n in ['runtime-before.json','runtime-after.json']]),
 ('media-drift',lambda p:mutate_json(p,'media-between.json',lambda x:x['rows'][0].update(sha256='f'*64))),
 ('timeout-exit0-userquit',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x.update(timeout=True))),
 ('cleanup-unknown',lambda p:mutate_json(p,'child2/lifecycle.json',lambda x:x.update(cleanupUncertain=True))),
 ('wrong-argv',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x['argv'].append('--native-blocks'))),
 ('loader-env',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x['environment'].update(NODE_OPTIONS='bad'))),
 ('process-exe',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x['ownedProcessIdentity'].update(exeSha256='f'*64))),
 ('oom-delta',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x['resourceAfter']['memoryEvents'].update(oom=1))),
 ('frame-ledger',lambda p:mutate_json(p,'child1/frames.json',lambda x:x['frames'][0].update(frameStep=1))),
 ('missing-register',lambda p:mutate_json(p,'child1/report.json',lambda x:x['cpu'].pop('eip'))),
 ('bool-counter',lambda p:mutate_json(p,'child1/report.json',lambda x:x['cpu'].update(cycles=True))),
 ('input-floppy',lambda p:mutate_json(p,'child1/report.json',lambda x:x['inputs']['floppy'].update(bootOrder=0))),
 ('guest-writer-reader',lambda p:mutate_json(p,'child2/offers.json',lambda x:x.update(writer=True))),
 ('parent-error',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x.update(primaryFailure='wall'))),
 ('missing-reap',lambda p:mutate_json(p,'child1/lifecycle.json',lambda x:x.update(reaped=False))),
]:check(name,edit)
check('pressure-observed-not-speedgate',lambda p:(mutate_json(p,'child1/lifecycle.json',lambda x:(x['resourceBefore']['memoryEvents'].update(high=2,max=3),x['resourceAfter']['memoryEvents'].update(high=4,max=5))),mutate_json(p,'child2/lifecycle.json',lambda x:(x['resourceBefore']['memoryEvents'].update(high=4,max=5),x['resourceAfter']['memoryEvents'].update(high=6,max=7)))),True)
# Source emits Latin-1 text RAM as strict UTF-8, with character-width rows.
for name,char,accepted in [('latin1', '\u00a0',True),('above-ff','\u0100',False),('control','\u0080',False)]:
    raw=pack(make())[0];raw=raw.replace(b' '*80,(char+' '*79).encode('utf-8'),1)
    try:reader.parse_frames(raw)
    except reader.Refusal:assert not accepted,name
    else:assert accepted,name
    count+=1
raw=pack(make())[0].replace(b' '*80,b'\xff'+b' '*79,1)
try:reader.parse_frames(raw)
except reader.Refusal as error:assert str(error)=='frame-utf8'
else:raise AssertionError('malformed UTF-8 accepted')
count+=1
# External originals bind the same bytes; a matching declaration alone is not approval.
p=packet_fixture();src=json.loads(p['source-before.json']);rt=json.loads(p['runtime-before.json'])
external={'roleSha256':{n:H(b) for n,b in p.items()},'sourceInventory':src,'runtimeInventory':rt,'consoleMap':json.loads(p['child1/report.json'])['sourceSha256'],'official':{k:rt['provenance'][k] for k in ['repository','head','runId','runAttempt','jobId','workflowPath','workflowBlob']}}
external['official'].update(artifactSha256='e'*64,artifactByteLength=1000,conclusion='success',event='pull_request',eventAction='labeled',actualLabel='x86-hdd-export-actual',jobConclusion='success')
result=reader.verify_packet(p,external);assert result['reportedConsistencyPass'] and not result['finitePersistencePass'];count+=1
for name,edit in [('external-role',lambda x:x['roleSha256'].update({'first.img':'f'*64})),('official-head',lambda x:x['official'].update(head='f'*40)),('official-attempt-bool',lambda x:x['official'].update(runAttempt=True)),('official-failed',lambda x:x['official'].update(conclusion='failure'))]:
    bad=copy.deepcopy(external);edit(bad);result=reader.verify_packet(p,bad)
    assert not result['reportedConsistencyPass'],(name,result)
    count+=1;print(name,result['failure'])
# Whole artifact entrypoint: independently admitted bytes plus official metadata.
import io,zipfile,warnings

def archive(packet,extra=None,duplicate=False,symlink=False):
    out=io.BytesIO()
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',UserWarning)
        with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
            for name,body in packet.items():
                if symlink and name=='child1/pty.bin':
                    info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=(0o120777<<16);z.writestr(info,body)
                else:z.writestr(name,body)
            if extra:z.writestr(extra,b'not a role')
            if duplicate:z.writestr('result.json',packet['result.json'])
    return out.getvalue()

def sealed(packet,body):
    e=copy.deepcopy(external);e['roleSha256']={n:H(b) for n,b in packet.items()}
    e['official'].update(artifactSha256=H(body),artifactByteLength=len(body))
    return e

p=packet_fixture();body=archive(p);e=sealed(p,body)
result=reader.verify_artifact(body,e)
assert result['finitePersistencePass'] and result['reportedConsistencyPass'] and result['artifactOriginalJoined']
assert not result['fullAcceptanceQualified'] and not result['installedGuiQualified'];count+=1;print('artifact-valid PASS finite-only')
for name,body in [('extra-role',archive(p,extra='unexpected')),('duplicate-role',archive(p,duplicate=True)),('symlink-role',archive(p,symlink=True)),('traversal-role',archive(p,extra='../unexpected'))]:
    result=reader.verify_artifact(body,sealed(p,body));assert not result['finitePersistencePass'],(name,result)
    count+=1;print('artifact-'+name,result['failure'])
bad=copy.deepcopy(p);mutate_json(bad,'child1/report.json',lambda x:x['cpu'].pop('eip'));reindex(bad);body=archive(bad)
result=reader.verify_artifact(body,sealed(bad,body));assert not result['finitePersistencePass'] and result['failure']=='packet:cpu-fields';count+=1;print('artifact-rehashed-semantic-role',result['failure'])
bad=copy.deepcopy(p);mutate_json(bad,'child2/lifecycle.json',lambda x:(x['resourceBefore']['memoryEvents'].update(oom=1,oom_kill=1),x['resourceAfter']['memoryEvents'].update(oom=1,oom_kill=1)));reindex(bad);body=archive(bad)
result=reader.verify_artifact(body,sealed(bad,body));assert not result['finitePersistencePass'] and result['failure']=='packet:cross-session-oom-gap';count+=1;print('artifact-rehashed-between-session-oom',result['failure'])
body=archive(p);bad=bytearray(body);central=bad.index(b'PK\x01\x02');struct.pack_into('<I',bad,central+24,0xffffffff);bad=bytes(bad)
result=reader.verify_artifact(bad,sealed(p,bad));assert not result['finitePersistencePass'];count+=1;print('artifact-advertised-oversize',result['failure'])
for name,edit in [('raw-hash',lambda e:e['official'].update(artifactSha256='f'*64)),('raw-extent',lambda e:e['official'].update(artifactByteLength=1)),('event',lambda e:e['official'].update(event='push')),('label',lambda e:e['official'].update(actualLabel='other')),('job',lambda e:e['official'].update(jobConclusion='failure'))]:
    e=sealed(p,body);edit(e);result=reader.verify_artifact(body,e);assert not result['finitePersistencePass'],(name,result)
    count+=1;print('artifact-'+name,result['failure'])
# Exact original-file helper preserves primary across close and caps before reading.
from types import SimpleNamespace
original_os=reader.os
primary=RuntimeError('authored-first-read');secondary=RuntimeError('authored-close');closed=[]
def raise_primary(*a):raise primary
def raise_secondary(fd):closed.append(fd);raise secondary
reader.os=SimpleNamespace(O_RDONLY=0,O_NONBLOCK=0,open=lambda *a:37,fstat=raise_primary,close=raise_secondary)
try:
    try:reader.read_original('authored',10)
    except RuntimeError as error:assert error is primary and closed==[37]
    else:raise AssertionError('first error lost')
finally:reader.os=original_os
count+=1
closed=[];calls=[];st=SimpleNamespace(st_mode=0o100600,st_size=11,st_nlink=1,st_dev=1,st_ino=2)
reader.os=SimpleNamespace(O_RDONLY=0,O_NONBLOCK=0,open=lambda *a:37,fstat=lambda *a:st,read=lambda *a:calls.append(a),close=lambda fd:closed.append(fd))
try:
    try:reader.read_original('authored',10)
    except reader.Refusal as error:assert str(error)=='original-file-extent-type' and not calls and closed==[37]
    else:raise AssertionError('oversize preallocation accepted')
finally:reader.os=original_os
count+=1
closed=[];parts=[b'abc',b''];st=SimpleNamespace(st_mode=0o100600,st_size=3,st_nlink=1,st_dev=1,st_ino=2)
reader.os=SimpleNamespace(O_RDONLY=0,O_NONBLOCK=0,open=lambda *a:37,fstat=lambda *a:st,stat=lambda *a,**kw:st,read=lambda *a:parts.pop(0),close=raise_secondary)
try:
    try:reader.read_original('authored',10)
    except RuntimeError as error:assert error is secondary and closed==[37]
    else:raise AssertionError('close-only failure accepted')
finally:reader.os=original_os
count+=1
print('PASS',count,'manufactured packet controls; no guest/producer/official acceptance')


def authored_runner_controls():
    # Producer import is test-only. The independent reader imports no producer.
    import importlib.util,pathlib,unittest,unittest.mock as mock,time,os,sys,textwrap
    P=pathlib.Path(__file__).with_name('probe.py')
    spec=importlib.util.spec_from_file_location('authored_probe',P);p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
    def frame(step=0,char=' '):
     return p.FRAME+(f'386 AT  step {step}/120000000  text RAM  Ctrl-] quit  Ctrl-L redraw\n'+'\n'.join([char*80]*25)).encode()+p.END
    def resource():return {'cgroupRole':'authored','cpuMax':'100000 100000','memoryMaxBytes':1073741824,'swapMaxBytes':0,'affinityCpus':[0],'memoryEvents':dict.fromkeys(['low','high','max','oom','oom_kill','oom_group_kill'],0)}
    class Controls(unittest.TestCase):
     def test_split_latin1(self):
      b=p.OPEN+frame(char='é')+p.CLOSE;q=p.Frames()
      for x in b:q.feed(bytes([x]))
      q.finish();self.assertEqual(q.frames[0]['lines'][0],'é'*80);self.assertEqual(q.frames[0]['end'],len(b)-len(p.CLOSE))
     def test_char_refusals(self):
      for char in ['\x9f','Ā','\x01']:
       with self.subTest(char=repr(char)),self.assertRaises(p.Refusal):p.Frames().feed(p.OPEN+frame(char=char))
      with self.assertRaises(p.Refusal):p.Frames().feed(p.OPEN+frame().replace(b' '*80,b'\xff'+b' '*79,1))
     def test_all_scan_counts(self):
      self.assertEqual([len(p.scans(p.COMMANDS[n]))for n in ['decline','write','read','quit']],[4,78,40,0])
     def test_stale_echo(self):
      i=p.Inputs();i.raw_seen=100;f={'ordinal':1,'step':0,'lines':['A:\\>echo bw-hdd-persist-ok>c:\\bwkeep.txt']}
      with self.assertRaises(p.Refusal):i.offer(p.COMMANDS['write'],f,'write-prompt')
     def test_whole_drain(self):
      q=p.Frames();raw=bytearray();parts=[p.OPEN+frame(0),frame(100),BlockingIOError()]
      def read(*_):
       v=parts.pop(0)
       if isinstance(v,BaseException):raise v
       return v
      with mock.patch.object(p.os,'read',side_effect=read):frames,end=p.drain_pty(99,q,raw,time.monotonic()+1)
      self.assertEqual(len(frames),2);self.assertIsNone(end)
     def test_timeout_is_not_success(self):
      # Genuine tiny child, no emulator or firmware. A timeout stays a failure even
      # when termination happens to produce a clean process status.
      with mock.patch.object(p,'resource_observation',return_value={'x':1}),mock.patch.object(p,'need_no_oom'),mock.patch.object(p,'child_environment',return_value={'PATH':'/usr/bin:/bin'}),mock.patch.object(p,'child_limits'),mock.patch.object(p,'owned_identity',return_value={}),mock.patch.object(p,'watch_report_cap'):
       r=p.run_session(['/usr/bin/python3','-c','import time;time.sleep(5)'],pathlib.Path.cwd(),1,time.monotonic()+.08)
      self.assertEqual(r['lifecycle']['primaryFailure'],'wall-limit');self.assertTrue(r['lifecycle']['reaped']);self.assertTrue(r['lifecycle']['groupEmpty'])
     def test_genuine_interactive_capture(self):
      script=r"""
    import os,tty,time
    OPEN=%r;CLOSE=%r;FRAME=%r;END=%r
    tty.setraw(0)
    def show(step,lines):
     rows=[x.ljust(80)for x in lines]+[' '*80]*(25-len(lines))
     os.write(1,FRAME+(f'386 AT  step {step}/120000000  text RAM  Ctrl-] quit  Ctrl-L redraw\n'+'\n'.join(rows)).encode()+END)
    def command(expected):
     data=b''
     while len(data)<len(expected):data+=os.read(0,len(expected)-len(data))
     assert data==expected
    os.write(1,OPEN);show(0,['Do you want to proceed'])
    command(b'n\r');show(1024,['The installation of FreeDOS 1.4 has been aborted.','A:\\>'])
    command(b'echo bw-hdd-persist-ok>c:\\bwkeep.txt\r')
    lines=['A:\\>echo bw-hdd-persist-ok>c:\\bwkeep.txt','A:\\>'];show(100000,lines);time.sleep(.06);show(1600000,lines)
    command(b'type c:\\bwkeep.txt\r')
    lines=['A:\\>type c:\\bwkeep.txt','bw-hdd-persist-ok','A:\\>'];show(1700000,lines);time.sleep(.06);show(3200000,lines)
    command(b'\x1d');os.write(1,CLOSE)
    """%(p.OPEN,p.CLOSE,p.FRAME,p.END)
      with mock.patch.object(p,'resource_observation',return_value={'x':1}),mock.patch.object(p,'need_no_oom'),mock.patch.object(p,'child_environment',return_value={'PATH':'/usr/bin:/bin'}),mock.patch.object(p,'child_limits'),mock.patch.object(p,'owned_identity',return_value={}),mock.patch.object(p,'watch_report_cap'):
       r=p.run_session(['/usr/bin/python3','-c',textwrap.dedent(script)],pathlib.Path.cwd(),1,time.monotonic()+3)
      self.assertIsNone(r['lifecycle']['primaryFailure']);self.assertEqual(len(r['offers']['offers']),4);self.assertTrue(r['lifecycle']['reaped']);self.assertTrue(r['lifecycle']['groupEmpty'])
     def test_immediate_exit_eofs(self):
      # Exercises the selector/waitid ordering with a real immediate tiny exit.
      with mock.patch.object(p,'resource_observation',return_value={'x':1}),mock.patch.object(p,'need_no_oom'),mock.patch.object(p,'child_environment',return_value={'PATH':'/usr/bin:/bin'}),mock.patch.object(p,'child_limits'),mock.patch.object(p,'owned_identity',return_value={}),mock.patch.object(p,'watch_report_cap'):
       for _ in range(4):
        r=p.run_session(['/usr/bin/python3','-c','pass'],pathlib.Path.cwd(),1,time.monotonic()+2)
        e=r['lifecycle']['events'];names=[x['kind']for x in e];exitpos=names.index('exit-observed-wnowait')
        self.assertTrue(r['lifecycle']['reaped']);self.assertTrue(r['lifecycle']['ptyEof']);self.assertTrue(r['lifecycle']['stderrEof'])
        self.assertGreater(names.index('pty-eof'),exitpos);self.assertGreater(names.index('stderr-eof'),exitpos)
        self.assertFalse(any(x['kind']=='group-signal'and x['phase']=='reaped'for x in e))
     def test_capture_primary_precedes_partial_export_save(self):
      import tempfile
      prior=os.getcwd()
      try:
       with tempfile.TemporaryDirectory(prefix='authored-hdd-capture-')as directory:
        d=pathlib.Path(directory);(d/'originals').mkdir();(d/'outputs').mkdir();(d/'outputs/first.img').write_bytes(b'partial')
        rows=[{'path':f'role{i}','sha256':'a'*64}for i in range(79)];source={'head':'b'*40,'tree':'c'*40,'rows':rows}
        (d/'originals/source-before.json').write_text(json.dumps(source));(d/'source-map.json').write_text(json.dumps({'consoleMap':{f'key{i}':f'role{i}'for i in range(79)},'commonPaths':[]}))
        life={'primaryFailure':'wall-limit','secondaryFailures':['earlier-owned-cleanup-fact']};captured={'lifecycle':life,'raw':b'original-partial-terminal','stderr':b'original-error','offers':{'schema':'bw.hdd-session-input.v1','writer':True,'offers':[]},'framesInternal':[]}
        runtime={'provenance':{},'rows':[]}
        with mock.patch.object(p,'source_after',return_value=source),mock.patch.object(p,'runtime_inventory',return_value=runtime),mock.patch.object(p,'provenance',return_value={}),mock.patch.object(p,'resource_observation',return_value={}),mock.patch.object(p,'media_inventory',return_value={}),mock.patch.object(p,'run_session',return_value=captured)as run:
         with self.assertRaisesRegex(p.Refusal,'^wall-limit$'):p.run_packet(d,'b'*40,'93a1119016e7e9d2a963ce4491199698e852739f9d20b3b7b0f5fdfe10c41795')
        result=json.loads((d/'originals/result.json').read_text());self.assertEqual(result['firstFailure'],'wall-limit');self.assertEqual(result['secondaryFailures'],['earlier-owned-cleanup-fact','regular-byte-role']);self.assertEqual(run.call_count,1)
        self.assertEqual((d/'originals/child1/pty.bin').read_bytes(),captured['raw']);self.assertEqual(json.loads((d/'originals/child1/lifecycle.json').read_text()),life);self.assertFalse((d/'originals/child2').exists());self.assertFalse(result['session1Pass']);self.assertFalse(result['finitePersistencePass'])
      finally:os.chdir(prior)
     def test_gap_oom_prevents_second_child(self):
      import tempfile
      prior=os.getcwd()
      try:
       with tempfile.TemporaryDirectory(prefix='authored-hdd-gap-')as directory:
        d=pathlib.Path(directory);(d/'originals/child1').mkdir(parents=True);(d/'originals/child1/report.json').write_text('{}')
        rows=[{'path':f'role{i}','sha256':'a'*64}for i in range(79)];source={'head':'b'*40,'tree':'c'*40,'rows':rows}
        (d/'originals/source-before.json').write_text(json.dumps(source));(d/'source-map.json').write_text(json.dumps({'consoleMap':{f'key{i}':f'role{i}'for i in range(79)},'commonPaths':[]}))
        node={'sha256':'d'*64,'byteLength':10,'realpath':'/authored/node'};runtime={'provenance':{},'rows':[node]};identity={'exeSha256':node['sha256'],'exeByteLength':10,'exeRealpath':node['realpath']}
        before=resource();after=resource();gap=resource();gap['memoryEvents']['oom']=1
        captured={'lifecycle':{'primaryFailure':None,'secondaryFailures':[],'ownedProcessIdentity':identity,'resourceAfter':after}}
        with mock.patch.object(p,'source_after',return_value=source),mock.patch.object(p,'runtime_inventory',return_value=runtime),mock.patch.object(p,'provenance',return_value={}),mock.patch.object(p,'resource_observation',side_effect=[before,gap]),mock.patch.object(p,'media_inventory',return_value={}),mock.patch.object(p,'save_child'),mock.patch.object(p,'validate_session'),mock.patch.object(p,'run_session',return_value=captured)as run:
         with self.assertRaisesRegex(p.Refusal,'^oom-observed$'):p.run_packet(d,'b'*40,'93a1119016e7e9d2a963ce4491199698e852739f9d20b3b7b0f5fdfe10c41795')
        result=json.loads((d/'originals/result.json').read_text());self.assertEqual(result['firstFailure'],'oom-observed');self.assertEqual(run.call_count,1);self.assertTrue(result['session1Pass']);self.assertFalse(result['session2Pass'])
      finally:os.chdir(prior)
     def test_monotonic_events_allow_pressure(self):
      a=resource();b=copy.deepcopy(a);a['memoryEvents']['high']=2;b['memoryEvents']['high']=3;p.need_no_oom(a,b)
      b['memoryEvents']['high']=1
      with self.assertRaisesRegex(p.Refusal,'resource-counter-regression'):p.need_no_oom(a,b)
    outcome=unittest.TextTestRunner(stream=sys.stdout,verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Controls))
    assert outcome.wasSuccessful(),'authored transport controls failed'

authored_runner_controls()

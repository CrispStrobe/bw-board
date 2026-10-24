"""Byte-only AT read16 paired original reader. Imports no producer/helpers."""
import base64
import hashlib
import json
import math
from pathlib import Path
import re
import statistics

CAP=2097152
ROWS_SHA='0b0c856983519a32e04f1c61d1317bb72184fb6f558780019d9bc0fa44bc4b2f'
BASE_HEAD='1312250f5ef06ecd96b0e40e2926e87312d8f414'
BASE_TREE='04839d8ebe47645a452d80e7a532c14dd91e0b3e'
NODE_SHA='fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48'
COMMON=('package.json','scripts/i80386-at-profile/fixture.mjs','scripts/i80386-read16-paired/fixture.mjs','scripts/i80386-read16-paired/run.py','scripts/i80386-read16-paired/reader.py','scripts/i80386-read16-paired/controls.py','scripts/i80386-read16-paired/source-rows.json','scripts/i80386-read16-paired/README.md','test/i80386-read16-ordered-pair.test.mjs','.github/workflows/i80386-read16-paired.yml')
ORDERS=('AB','BA','AB','BA','BA','AB','BA')
SCHEDULE=tuple([(i,'warmup',None,a) for i,a in enumerate('ABAB')]+[(4+p*2+i,'measured',p,a) for p,order in enumerate(ORDERS) for i,a in enumerate(order)])
class Refusal(ValueError):pass
def need(value,reason):
    if not value:raise Refusal(reason)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def canonical(value):return (json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)+'\n').encode()
def unique(items):
    value={}
    for key,item in items:
        need(key not in value,'duplicate key');value[key]=item
    return value
def parse(raw,cap):
    need(type(raw) is bytes and 0<len(raw)<=cap,'bounded original bytes')
    return json.loads(raw,object_pairs_hook=unique,parse_constant=lambda _:(_ for _ in ()).throw(Refusal('nonfinite JSON')))
def exact(value,wanted,role):
    need(type(value) is type(wanted),role+' type')
    if type(wanted) is dict:
        need(set(value)==set(wanted),role+' fields')
        for k,v in wanted.items():exact(value[k],v,role+'.'+k)
    elif type(wanted) is list:
        need(len(value)==len(wanted),role+' length')
        for a,b in zip(value,wanted):exact(a,b,role)
    else:need(value==wanted,role+' value')
def fields(value,names,role):need(type(value) is dict and set(value)==set(names.split()),role+' fields')
def digest(value):need(type(value) is str and re.fullmatch('[0-9a-f]{64}',value),'SHA256')
def positive(value,cap,role):need(type(value) is int and 0<value<=cap,role)
def unbase(value,cap):
    need(type(value) is str and len(value)<=4*((cap+2)//3),'base64 cap')
    raw=base64.b64decode(value,validate=True);need(len(raw)<=cap and base64.b64encode(raw).decode()==value,'canonical base64');return raw

def source_rows(raw):
    need(sha(raw)==ROWS_SHA,'source35 manifest pin');rows=parse(raw,16384)
    fields(rows,'A B','source arms');need(len(rows['A'])==len(rows['B'])==35,'source35 census')
    need([n for n in rows['A'] if rows['A'][n]!=rows['B'][n]]==['src/experimental/i80386.js'],'only CPU source differs')
    return rows

def request(raw):
    value=parse(raw,65536);need(canonical(value)==raw,'canonical selected request')
    fields(value,'schema repository head tree baseHead baseTree workflowHead workflowRef pullRequest sourceBranch label eventName attempt sourceRowsSha256 commonFiles workflowSha256','request')
    exact(value['schema'],'bw.read16-paired-request.v1','request schema')
    exact(value['repository'],'CrispStrobe/bw-board','repository')
    for key in ('head','tree','workflowHead'):need(type(value[key]) is str and re.fullmatch('[0-9a-f]{40}',value[key]) and value[key]!='0'*40,'exact '+key)
    exact(value['baseHead'],BASE_HEAD,'base head');exact(value['baseTree'],BASE_TREE,'base tree')
    positive(value['pullRequest'],10**9,'selected PR')
    exact(value['workflowRef'],'CrispStrobe/bw-board/.github/workflows/i80386-read16-paired.yml@refs/pull/'+str(value['pullRequest'])+'/merge','executing workflow ref')
    exact(value['sourceBranch'],'lane/386-read16-ordered-pair-source-20261024','selected source branch')
    exact(value['label'],'x86-read16-paired-v1','one new label')
    exact(value['eventName'],'pull_request','event type');exact(value['attempt'],1,'first attempt')
    exact(value['sourceRowsSha256'],ROWS_SHA,'rows SHA')
    need(type(value['commonFiles']) is dict and set(value['commonFiles'])==set(COMMON),'closed common source')
    for row in value['commonFiles'].values():
        fields(row,'bytes sha256','common row');positive(row['bytes'],131072,'common size');digest(row['sha256'])
    exact(value['workflowSha256'],value['commonFiles']['.github/workflows/i80386-read16-paired.yml']['sha256'],'workflow join')
    return value

def child(raw,arm,rows):
    value=parse(raw,32768)
    fields(value,'schema arm sourceFiles semantic setupNanoseconds executionLoopNanoseconds warmupSteps warmupDoesNotContributeToMeasuredState physical386TimingCalibrated','child')
    exact(value['schema'],'bw.read16-paired-child.v1','child schema');exact(value['arm'],arm,'arm');exact(value['sourceFiles'],rows[arm],'child source35')
    exact(value['warmupSteps'],25000,'disposable warmup');exact(value['warmupDoesNotContributeToMeasuredState'],True,'fresh measured state');exact(value['physical386TimingCalibrated'],False,'scope')
    for key in ('setupNanoseconds','executionLoopNanoseconds'):
        need(type(value[key]) is str and value[key].isdigit() and 0<int(value[key])<=60000000000,'bounded '+key)
    s=value['semantic'];fields(s,'schema kind steps charges cpuCycles state ifEnabled interrupts ordinarySettings devices','semantic')
    for key,wanted in {'schema':'bw.at-profile-child.v1','kind':'at','steps':1000000,'charges':6000000,'cpuCycles':1000000,'state':{'ax':65534,'bx':65535,'ip':0,'word':65535},'ifEnabled':False,'interrupts':0,'ordinarySettings':{'translationCache':True,'deliverFaults':True,'cpuProfile':'compatibility'}}.items():exact(s[key],wanted,'authored '+key)
    d=s['devices'];fields(d,'machineCycles debt deadline appliedClocks pitFraction pitCounters pics rtc cga keyboard','devices')
    for key,wanted in {'machineCycles':6000000,'debt':5310,'deadline':16000,'appliedClocks':5994690}.items():exact(d[key],wanted,key)
    f=d['pitFraction'];need(type(f) in (int,float) and math.isfinite(f) and abs(f-0.262723749965744)<=1e-9,'authored PIT recurrence')
    exact(d['pitCounters'],[{'mode':0,'rw':0,'reload':0,'ce':0,'out':0,'armed':False,'nullCount':True,'gate':g} for g in (1,1,0)],'unprogrammed PIT')
    exact(d['pics'],[{'irr':0,'isr':0,'imr':0,'vectorBase':0,'intActive':False}]*2,'masked IF PIC')
    exact(d['rtc'],{'cyclePhase':5994690,'periodicPhase':10562560,'registerB':2,'registerC':64},'RTC pending without delivered IRQ')
    exact(d['cga'],{'cycles':5994690,'frameCount':22,'lastVretrace':0},'CGA')
    exact(d['keyboard'],{'commandByte':0,'queue':[{'value':170,'keyboard':True}],'scheduled':0},'keyboard BAT')
    return value

def position(value,unit,parent,child_pid=None,cpu=None):
    fields(value,'unit membership observerPid affinity limits pids descendants dyingDescendants populated tasksCurrent memoryEvents','resource position')
    exact(value['unit'],unit,'owned unit');exact(value['membership'],'/system.slice/'+unit,'owned cgroup')
    exact(value['observerPid'],parent if child_pid is None else child_pid,'observer')
    exact(value['limits'],{'cpu.max':'100000 100000','memory.max':'1073741824','memory.swap.max':'0','pids.max':'64'},'enforced limits')
    a=value['affinity'];need(type(a) is list and len(a)==1 and type(a[0]) is int and a[0]>=0,'one CPU')
    if cpu is not None:exact(a,cpu,'same CPU')
    exact(value['pids'],[parent] if child_pid is None else sorted([parent,child_pid]),'direct process census')
    exact(value['descendants'],0,'no nested groups');exact(value['dyingDescendants'],0,'no dying groups');exact(value['populated'],1,'populated owned group')
    need(type(value['tasksCurrent']) is int and len(value['pids'])<=value['tasksCurrent']<=64,'bounded task census')
    e=value['memoryEvents'];need(type(e) is dict and {'max','oom','oom_kill'}<=set(e) and all(type(v) is int and v==0 for v in e.values()),'no memory pressure/OOM events')
    return a

def audit(original_raw,cleanup_raw,request_raw,event_raw,expected):
    fields(expected,'schema head tree workflowHead workflowRef pullRequest runId jobId artifactId requestSha256 eventSha256 originalSha256 originalBytes cleanupSha256 cleanupBytes workflowSha256 conclusion','external expectation')
    exact(expected['schema'],'bw.read16-paired-expectation.v1','external schema')
    for key,raw in [('original',original_raw),('cleanup',cleanup_raw)]:
        digest(expected[key+'Sha256']);exact(sha(raw),expected[key+'Sha256'],key+' hash');exact(len(raw),expected[key+'Bytes'],key+' bytes')
    positive(expected['jobId'],10**15,'official job');positive(expected['artifactId'],10**15,'official artifact');need(expected['conclusion'] in ('success','failure'),'official conclusion')
    need(type(expected['runId']) is str and expected['runId'].isdigit() and 0<int(expected['runId'])<10**15,'official run')
    exact(sha(request_raw),expected['requestSha256'],'selected request hash');exact(sha(event_raw),expected['eventSha256'],'selected event hash')
    req=request(request_raw);event=parse(event_raw,262144)
    pr=event.get('pull_request',{});body=pr.get('body');marker='BW_READ16_PAIRED_REQUEST_SHA256'
    need(type(body) is str and len(body.encode())<=65536 and body.casefold().count(marker.casefold())==1 and re.findall(r'<!-- BW_READ16_PAIRED_REQUEST_SHA256=([0-9a-f]{64}) -->',body)==[sha(request_raw)],'event-frozen single request SHA marker')
    h=pr.get('head',{});base=pr.get('base',{})
    need(event.get('action')=='labeled' and type(event.get('number')) is int and event['number']==req['pullRequest'] and type(pr.get('number')) is int and pr['number']==req['pullRequest'],'selected labeled PR')
    need(event.get('repository',{}).get('full_name')==req['repository'] and event['repository'].get('fork') is False and event.get('sender',{}).get('login')=='CrispStrobe','owner nonfork event')
    need(pr.get('state')=='open' and pr.get('merged') is False and base.get('ref')=='master' and base.get('repo',{}).get('full_name')==req['repository'],'open own base')
    need(h.get('sha')==req['head'] and h.get('ref')==req['sourceBranch'] and h.get('repo',{}).get('full_name')==req['repository'] and h['repo'].get('fork') is False and h['repo'].get('owner',{}).get('login')=='CrispStrobe','exact own head')
    need(event.get('label',{}).get('name')==req['label'] and type(pr.get('labels')) is list and sum(x.get('name')==req['label'] for x in pr['labels'])==1,'one selected label')
    for key in ('head','tree','workflowHead','workflowRef','pullRequest','workflowSha256'):exact(req[key],expected[key],'external '+key)
    value=parse(original_raw,CAP);need(canonical(value)==original_raw,'canonical original')
    fields(value,'schema requestBase64 eventBase64 source runtime context children failure','original')
    exact(value['schema'],'bw.read16-paired-original.v1','original schema')
    exact(unbase(value['requestBase64'],65536),request_raw,'request readback');exact(unbase(value['eventBase64'],262144),event_raw,'event readback')
    rows=source_rows(unbase(value['source']['rowsBase64'],16384))
    exact(value['source'],{'schema':'bw.read16-paired-source.v1','head':req['head'],'tree':req['tree'],'baseHead':BASE_HEAD,'baseTree':BASE_TREE,'rowsBase64':value['source']['rowsBase64'],'commonFiles':req['commonFiles'],'arms':rows,'workflowSource':{'head':req['workflowHead'],'ref':req['workflowRef'],'fileBytes':req['commonFiles']['.github/workflows/i80386-read16-paired.yml']['bytes'],'fileSha256':req['workflowSha256']}},'source/Git join')
    source_sha=sha(canonical(value['source']))
    exact(value['runtime'],{'nodeVersion':'22.23.3','nodeBytes':124827920,'nodeSha256':NODE_SHA,'nodePath':'/opt/hostedtoolcache/node/22.23.3/x64/bin/node','measurement':'whole child including preexec; wait4 user+system and matched monotonic wall'},'runtime')
    c=value['context'];fields(c,'workflowHead workflowRef actor repository head pullRequest sourceBranch eventName eventSha256 requestSha256 runId attempt job parentPid unit','context')
    positive(c['parentPid'],2**31,'parent PID');unit='bw-read16-paired-'+expected['runId']+'-1.service'
    exact(c,{'workflowHead':req['workflowHead'],'workflowRef':req['workflowRef'],'actor':'CrispStrobe','repository':'CrispStrobe/bw-board','head':req['head'],'pullRequest':req['pullRequest'],'sourceBranch':req['sourceBranch'],'eventName':'pull_request','eventSha256':sha(event_raw),'requestSha256':sha(request_raw),'runId':expected['runId'],'attempt':1,'job':'paired','parentPid':c['parentPid'],'unit':unit},'official context')
    need(type(value['children']) is list and len(value['children'])==18,'eighteen fresh children')
    pairs={};affinity=None;pids=set()
    for record,wanted in zip(value['children'],SCHEDULE):
        fields(record,'sequence phase pair arm stdoutBase64 stderrBase64 usage resource','record')
        for key,item in zip(('sequence','phase','pair','arm'),wanted):exact(record[key],item,'schedule '+key)
        stdout=unbase(record['stdoutBase64'],32768);stderr=unbase(record['stderrBase64'],8192)
        child(stdout,record['arm'],rows);exact(stderr,b'','empty stderr')
        u=record['usage'];fields(u,'pid exitCode reaped timedOut userSeconds systemSeconds cpuSeconds wallSeconds maxRSSKiB stdoutBytes stderrBytes primary secondary','usage')
        positive(u['pid'],2**31,'child PID');need(u['pid'] not in pids and u['pid']!=c['parentPid'],'fresh child PID');pids.add(u['pid'])
        for key in ('userSeconds','systemSeconds','cpuSeconds','wallSeconds'):
            need(type(u[key]) in (int,float) and math.isfinite(u[key]) and (u[key]>0 if key in ('cpuSeconds','wallSeconds') else u[key]>=0),'finite timing')
        exact(u['cpuSeconds'],u['userSeconds']+u['systemSeconds'],'whole child CPU sum');need(u['wallSeconds']<=60 and u['cpuSeconds']<=60,'child deadline')
        need(type(u['maxRSSKiB']) is int and 0<=u['maxRSSKiB']<=1048576,'RSS bound')
        for key,item in {'exitCode':0,'reaped':True,'timedOut':False,'stdoutBytes':len(stdout),'stderrBytes':0,'primary':None,'secondary':[]}.items():exact(u[key],item,'child '+key)
        r=record['resource'];fields(r,'before preexec after sourceBeforeSha256 sourceAfterSha256 runtimeBeforeSha256 runtimeAfterSha256','child joins')
        for key in ('sourceBeforeSha256','sourceAfterSha256'):exact(r[key],source_sha,key)
        for key in ('runtimeBeforeSha256','runtimeAfterSha256'):exact(r[key],NODE_SHA,key)
        before=position(r['before'],unit,c['parentPid'],cpu=affinity)
        if affinity is None:affinity=before
        position(r['preexec'],unit,c['parentPid'],u['pid'],affinity);position(r['after'],unit,c['parentPid'],cpu=affinity)
        if record['phase']=='measured':pairs.setdefault(record['pair'],{})[record['arm']]=u
    ratios=[pairs[i]['A']['cpuSeconds']/pairs[i]['B']['cpuSeconds'] for i in range(7)]
    walls=[pairs[i]['B']['wallSeconds']/pairs[i]['A']['wallSeconds'] for i in range(7)]
    passed=statistics.median(ratios)>=1.03 and min(ratios)>1 and statistics.median(walls)<=1.02
    exact(value['failure'],None if passed else {'phase':'gate','reason':'strict paired performance gate failed'},'gate retained')
    exact(expected['conclusion'],'success' if passed else 'failure','official gate conclusion')
    clean=parse(cleanup_raw,65536)
    fields(clean,'schema runId attempt unit beforeShowExit beforeShowStdoutBase64 beforeShowStderrBase64 stopExit stopStdoutBase64 stopStderrBase64 showExit showStdoutBase64 showStderrBase64 cgroupAbsent remainingPids nestedGroups errors','outside cleanup')
    for key,item in {'schema':'bw.read16-paired-cleanup.v1','runId':expected['runId'],'attempt':1,'unit':unit,'cgroupAbsent':True,'remainingPids':[],'nestedGroups':[],'errors':[]}.items():exact(clean[key],item,'cleanup '+key)
    for key,cap in [('stopStdoutBase64',4096),('stopStderrBase64',2048),('showStderrBase64',2048),('beforeShowStderrBase64',2048)]:unbase(clean[key],cap)
    need(type(clean['beforeShowExit']) is int and clean['beforeShowExit']==0,'before stop status')
    terminal={}
    for line in unbase(clean['beforeShowStdoutBase64'],4096).decode().splitlines():
        k,v=line.split('=',1);need(k not in terminal,'unique before stop status');terminal[k]=v
    need(set(terminal)=={'LoadState','ActiveState','ControlGroup','Result','ExecMainPID','ExecMainCode','ExecMainStatus'},'retained terminal service fields')
    need(terminal['ExecMainPID'] in ('0',str(c['parentPid'])) and terminal['ControlGroup'] in ('','/system.slice/'+unit),'retained owned terminal PID/group')
    if passed:
        need(terminal['LoadState'] in ('loaded','not-found') and terminal['ActiveState']=='inactive' and terminal['ControlGroup']=='' and terminal['Result']=='success' and terminal['ExecMainStatus']=='0' and terminal['ExecMainCode'] in ('0','1'),'successful service terminal facts')
    else:
        need(terminal['LoadState']=='loaded' and terminal['ActiveState']=='failed' and terminal['Result']=='exit-code' and terminal['ExecMainStatus']=='1' and terminal['ExecMainCode']=='1','failed gate service terminal facts')
    show=unbase(clean['showStdoutBase64'],4096).decode();pairs={}
    for line in show.splitlines():
        k,v=line.split('=',1);need(k not in pairs,'unique outside status');pairs[k]=v
    need(set(pairs)=={'LoadState','ActiveState','ControlGroup','ExecMainPID'} and pairs['ActiveState']=='inactive' and pairs['ControlGroup']=='' and pairs['ExecMainPID']=='0','inactive unit readback')
    need(type(clean['showExit']) is int,'show exit type')
    need((type(clean['stopExit']) is int and clean['stopExit']==0 and clean['showExit']==0 and pairs['LoadState'] in ('loaded','not-found')) or (type(clean['stopExit']) is int and clean['stopExit']==5 and clean['showExit']==0 and pairs['LoadState']=='not-found'),'stop/show status')
    return {'schema':'bw.read16-paired-reader.v1','semanticPassed':True,'performancePassed':passed,'medianCPUSpeedup':statistics.median(ratios),'minimumCPUSpeedup':min(ratios),'medianWallRatio':statistics.median(walls),'cpuRatios':ratios,'wallRatios':walls,'workload':'AUTHORED_ORDINARY_AT_FIVE_OP_1M','sourceHead':req['head'],'sourceTree':req['tree'],'officialRunId':expected['runId'],'officialJobId':expected['jobId'],'officialArtifactId':expected['artifactId'],'officialMetadataAuthenticated':False,'adoptionQualified':False,'coreSpeedupQualified':False,'physicalRTxQualified':False,'fullOSQualified':False}

def main():
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--original',required=True);p.add_argument('--cleanup',required=True);p.add_argument('--request',required=True);p.add_argument('--event',required=True);p.add_argument('--expected',required=True);a=p.parse_args()
    def read(path,cap):
        import os,stat
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        try:
            s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_nlink==1 and 0<s.st_size<=cap,'ordinary bounded reader input')
            raw=b''
            while len(raw)<=cap:
                block=os.read(fd,min(65536,cap+1-len(raw)))
                if not block:break
                raw+=block
            t=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
            facts=lambda v:(v.st_dev,v.st_ino,v.st_size,v.st_mode,v.st_nlink,v.st_mtime_ns)
            need(len(raw)==s.st_size and facts(s)==facts(t)==facts(named),'held input drift');return raw
        finally:os.close(fd)
    print(json.dumps(audit(read(a.original,CAP),read(a.cleanup,65536),read(a.request,65536),read(a.event,262144),parse(read(a.expected,8192),8192)),sort_keys=True))
if __name__=='__main__':main()

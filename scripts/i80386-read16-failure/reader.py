"""Offline, failure-only audit of the historical read16 paired attempt.

This module never executes the historical reader or a producer. Its predicates
are a frozen copy of the historical input and child checks; the only different
terminal outcome is the explicitly retained failed service after a zero stop.
"""
import base64
import hashlib
import json
import math
from pathlib import Path
import re
import statistics
import io
import os
import stat
import zipfile

CAP=2097152
OLD_READER_SHA='d5fcd80edf2faee16be48d9c4d970a5ec32be2fdf50e20208f16b63196ba2b31'
OLD_HEAD='55917c48dffe0c7c743388024481ef0a47a7c76c'
OLD_TREE='086b7f33399b8a7af3fbc1c37ab4be2603b930e4'
OLD_WORKFLOW_HEAD='4fa530a0d5412507e2e863d437ef8728696f4e1d'
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
    exact(req['head'],OLD_HEAD,'historical source head')
    exact(req['tree'],OLD_TREE,'historical source tree')
    exact(req['workflowHead'],OLD_WORKFLOW_HEAD,'historical executing head')
    exact(req['commonFiles']['scripts/i80386-read16-paired/reader.py'],
          {'bytes':19750,'sha256':OLD_READER_SHA},'reviewed historical reader source row')
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
    need(not passed,'failure-only audit requires failed strict performance gate')
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
    exact(pairs,{'LoadState':'loaded','ActiveState':'failed','ControlGroup':'','ExecMainPID':str(c['parentPid'])},'stale failed unit readback')
    exact(clean['showExit'],0,'show exit')
    exact(clean['stopExit'],0,'zero stop exit')
    return {'schema':'bw.read16-failed-attempt-audit.v1','classification':'failed-attempt-only','historicalReaderRefusal':'inactive unit readback','semanticPassed':True,'performancePassed':False,'medianCPUSpeedup':statistics.median(ratios),'minimumCPUSpeedup':min(ratios),'medianWallRatio':statistics.median(walls),'cpuRatios':ratios,'wallRatios':walls,'workload':'AUTHORED_ORDINARY_AT_FIVE_OP_1M','sourceHead':req['head'],'sourceTree':req['tree'],'officialRunId':expected['runId'],'officialJobId':expected['jobId'],'officialArtifactId':expected['artifactId'],'officialMetadataAuthenticated':False,'adoptionQualified':False,'coreSpeedupQualified':False,'guestQualified':False,'physicalRTxQualified':False,'fullOSQualified':False}

def official(run_raw,jobs_raw,artifacts_raw,artifact_raw,log_raw,
             original_raw,cleanup_raw,request_raw,event_raw,expected,binding):
    """Join retained official metadata and archive to an externally reviewed binding.

    The binding is an input for independent review, never proof of its own origin.
    """
    fields(binding,'schema auditorCommit auditorTree auditorFileSha256 historicalReaderSha256 historicalHead historicalTree historicalWorkflowHead runId jobId artifactId artifactBytes artifactSha256 jobLogBytes jobLogSha256 requestSha256 eventSha256 originalSha256 cleanupSha256 runSha256 jobsSha256 artifactsSha256','external audit binding')
    exact(binding['schema'],'bw.read16-failed-attempt-binding.v1','binding schema')
    for key in ('auditorCommit','auditorTree','historicalHead','historicalTree','historicalWorkflowHead'):
        need(type(binding[key]) is str and re.fullmatch('[0-9a-f]{40}',binding[key]) and binding[key]!='0'*40,'reviewed '+key)
    need(binding['auditorCommit'] not in (OLD_HEAD,OLD_WORKFLOW_HEAD) and
         binding['auditorTree']!=OLD_TREE,'independent auditor source identity')
    for key in ('auditorFileSha256','historicalReaderSha256','artifactSha256','jobLogSha256','requestSha256','eventSha256','originalSha256','cleanupSha256','runSha256','jobsSha256','artifactsSha256'):digest(binding[key])
    exact(binding['historicalReaderSha256'],OLD_READER_SHA,'historical reader pin')
    exact(binding['historicalHead'],OLD_HEAD,'historical H')
    exact(binding['historicalTree'],OLD_TREE,'historical tree')
    exact(binding['historicalWorkflowHead'],OLD_WORKFLOW_HEAD,'historical W')
    for key,raw in (('request',request_raw),('event',event_raw),('original',original_raw),('cleanup',cleanup_raw),('run',run_raw),('jobs',jobs_raw),('artifacts',artifacts_raw),('artifact',artifact_raw),('jobLog',log_raw)):
        exact(binding[key+'Sha256'],sha(raw),'external '+key+' SHA')
    exact(binding['artifactBytes'],len(artifact_raw),'external archive bytes')
    exact(binding['jobLogBytes'],len(log_raw),'external log bytes')
    for key in ('runId','jobId','artifactId'):exact(binding[key],expected[key],'selected '+key)
    run=parse(run_raw,262144); jobs=parse(jobs_raw,1048576); artifacts=parse(artifacts_raw,262144)
    req=request(request_raw)
    need(type(run) is dict and type(jobs) is dict and type(artifacts) is dict,'official object types')
    rid=int(expected['runId'])
    for key,item in {'id':rid,'run_attempt':1,'head_sha':OLD_HEAD,'head_branch':req['sourceBranch'],'event':'pull_request','status':'completed','conclusion':'failure','path':'.github/workflows/i80386-read16-paired.yml'}.items():exact(run.get(key),item,'official run '+key)
    repo=run.get('repository'); head_repo=run.get('head_repository')
    need(type(run.get('actor')) is dict and run['actor'].get('login')=='CrispStrobe' and
         type(run.get('triggering_actor')) is dict and run['triggering_actor'].get('login')=='CrispStrobe','official owned actor')
    need(type(repo) is dict and type(head_repo) is dict and
         type(repo.get('id')) is int and repo['id']>0 and
         repo.get('id')==head_repo.get('id') and
         repo.get('full_name')==head_repo.get('full_name')==req['repository'] and
         repo.get('fork') is False and head_repo.get('fork') is False,'official owned repository')
    prs=run.get('pull_requests')
    need(type(prs) is list and len(prs)==1,'sole official PR')
    pr=prs[0];need(type(pr) is dict and type(pr.get('head')) is dict and type(pr.get('base')) is dict,'official PR object')
    exact(pr.get('number'),req['pullRequest'],'official PR number')
    exact(pr['head'].get('sha'),OLD_HEAD,'official PR head')
    exact(pr['head'].get('ref'),req['sourceBranch'],'official PR branch')
    exact(pr['base'].get('ref'),'master','official PR base')
    need(type(jobs.get('total_count')) is int and jobs['total_count']==2 and type(jobs.get('jobs')) is list and len(jobs['jobs'])==2,'exact two official jobs')
    by_name={}
    for row in jobs['jobs']:
        need(type(row) is dict and type(row.get('name')) is str and row['name'] not in by_name,'unique official jobs')
        for key,item in {'run_id':rid,'run_attempt':1,'head_sha':OLD_HEAD,'status':'completed'}.items():exact(row.get(key),item,'job '+key)
        positive(row.get('id'),10**15,'job ID');by_name[row['name']]=row
    need(set(by_name)=={'paired','source-controls'},'closed job roster')
    exact(by_name['paired']['id'],expected['jobId'],'selected job ID')
    exact(by_name['paired'].get('conclusion'),'failure','selected job failure')
    exact(by_name['source-controls'].get('conclusion'),'skipped','declared skipped job')
    exact(by_name['source-controls'].get('steps'),[],'skipped job steps')
    steps=by_name['paired'].get('steps')
    need(type(steps) is list and 0<len(steps)<=32,'finite steps')
    numbers=[]; names={}
    for step in steps:
        need(type(step) is dict,'raw step object')
        number=step.get('number');positive(number,64,'raw step number');numbers.append(number)
        need(type(step.get('name')) is str and 0<len(step['name'])<=256 and step['name'] not in names,'raw step name')
        exact(step.get('status'),'completed','terminal raw step')
        need(step.get('conclusion') in ('success','failure','skipped'),'bounded raw step conclusion')
        names[step['name']]=step['conclusion']
    need(numbers==sorted(set(numbers)),'ordered unique step numbers')
    for name,conclusion in {'Admit exact request, event and all selected Git bytes before runtime setup':'success','Fixed eighteen-child ordinary AT paired capture':'failure','Independent outside service stop and cgroup readback':'success','Retain exact originals, including failed attempts':'success'}.items():exact(names.get(name),conclusion,'critical source step')
    need(sum(x=='failure' for x in names.values())==1,'sole work failure')
    need(type(artifacts.get('total_count')) is int and artifacts['total_count']==1 and type(artifacts.get('artifacts')) is list and len(artifacts['artifacts'])==1,'sole artifact')
    art=artifacts['artifacts'][0];need(type(art) is dict,'artifact row')
    exact(art.get('id'),expected['artifactId'],'artifact ID')
    exact(art.get('name'),'read16-paired-'+expected['runId']+'-1','artifact name')
    exact(art.get('size_in_bytes'),len(artifact_raw),'artifact extent')
    exact(art.get('digest'),'sha256:'+sha(artifact_raw),'artifact digest')
    exact(art.get('expired'),False,'artifact retained')
    wr=art.get('workflow_run');need(type(wr) is dict,'artifact workflow row')
    exact(wr.get('id'),rid,'artifact run join')
    exact(wr.get('head_sha'),OLD_HEAD,'artifact head join')
    exact(wr.get('head_branch'),req['sourceBranch'],'artifact branch join')
    exact(wr.get('repository_id'),repo['id'],'artifact repository join')
    exact(wr.get('head_repository_id'),repo['id'],'artifact head repository join')
    prefix='read16-paired-'+expected['runId']+'-1/'
    with zipfile.ZipFile(io.BytesIO(artifact_raw)) as archive:
        names=archive.namelist();need(len(names)==106 and len(set(names))==106,'physical archive census')
        need(all(n.startswith(('read16-admission-'+expected['runId']+'-1/',prefix)) and not n.startswith('/') and '..' not in n.split('/') for n in names),'archive role roots')
        need(sum(info.file_size for info in archive.infolist())<=16777216 and all(info.file_size<=CAP for info in archive.infolist()),'bounded physical archive expansion')
        for name,raw in ((prefix+'paired.original.json',original_raw),(prefix+'cleanup.original.json',cleanup_raw),(prefix+'request.original.json',request_raw),(prefix+'event.original.json',event_raw)):
            need(name in names,'required physical role')
            info=archive.getinfo(name);need(info.file_size==len(raw) and info.file_size<=CAP,'bounded physical role')
            exact(archive.read(info),raw,'physical role bytes')
    return {'officialRunId':rid,'officialJobId':expected['jobId'],'officialArtifactId':expected['artifactId'],'officialMetadataAuthenticated':False,'externalBindingReviewedByAuditor':False}

def read_local(path,cap):
    """Read one regular held file once; a close failure is never hidden."""
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    primary=None;result=None;secondary=[]
    try:
        first=os.fstat(fd)
        need(stat.S_ISREG(first.st_mode) and first.st_nlink==1 and 0<first.st_size<=cap,'ordinary bounded reader input')
        chunks=[];used=0
        while used<=cap:
            block=os.read(fd,min(65536,cap+1-used))
            if not block:break
            used+=len(block);chunks.append(block)
        last=os.fstat(fd);named=os.stat(path,follow_symlinks=False)
        facts=lambda v:(v.st_dev,v.st_ino,v.st_size,v.st_mode,v.st_nlink,v.st_mtime_ns)
        need(used==first.st_size and facts(first)==facts(last)==facts(named),'held input drift')
        result=b''.join(chunks)
    except (OSError,Refusal) as error:primary=error
    try:os.close(fd)
    except OSError as error:secondary.append(error)
    if primary is not None:
        if secondary:primary.add_note('secondary close failure: '+type(secondary[0]).__name__)
        raise primary
    if secondary:raise secondary[0]
    return result

def audit_bundle(inputs):
    fields(inputs,'original cleanup request event expected binding run jobs artifacts artifact jobLog historicalReader auditorSource','bounded offline inputs')
    for key in ('historicalReader','auditorSource'):need(type(inputs[key]) is bytes,'local reviewed source bytes')
    binding=parse(inputs['binding'],8192)
    exact(canonical(binding),inputs['binding'],'canonical external binding')
    exact(sha(inputs['historicalReader']),OLD_READER_SHA,'reviewed old reader bytes')
    exact(sha(inputs['auditorSource']),binding.get('auditorFileSha256'),'externally reviewed new auditor bytes')
    expected=parse(inputs['expected'],8192)
    exact(canonical(expected),inputs['expected'],'canonical historical expectation')
    report=audit(inputs['original'],inputs['cleanup'],inputs['request'],inputs['event'],expected)
    report.update(official(inputs['run'],inputs['jobs'],inputs['artifacts'],inputs['artifact'],inputs['jobLog'],inputs['original'],inputs['cleanup'],inputs['request'],inputs['event'],expected,binding))
    return report

def main(argv=None):
    import argparse
    p=argparse.ArgumentParser(description='Offline failed-attempt classification only')
    caps={'original':CAP,'cleanup':65536,'request':65536,'event':262144,'expected':8192,'binding':8192,'run':262144,'jobs':1048576,'artifacts':262144,'artifact':33554432,'jobLog':33554432,'historicalReader':32768}
    for key in caps:p.add_argument('--'+key.replace('_','-'),required=True)
    a=p.parse_args(argv)
    try:
        data={key:read_local(getattr(a,key),cap) for key,cap in caps.items()}
        data['auditorSource']=read_local(__file__,262144)
        print(json.dumps(audit_bundle(data),sort_keys=True))
        return 0
    except (OSError,Refusal,ValueError,KeyError,UnicodeError,zipfile.BadZipFile) as error:
        print(json.dumps({'schema':'bw.read16-failed-attempt-audit.v1','classification':'refused','reason':type(error).__name__+': '+str(error)[:256],'secondary':[str(x)[:128] for x in getattr(error,'__notes__',[])[:2]],'adoptionQualified':False,'coreSpeedupQualified':False,'guestQualified':False,'physicalRTxQualified':False,'fullOSQualified':False},sort_keys=True))
        return 2
if __name__=='__main__':raise SystemExit(main())

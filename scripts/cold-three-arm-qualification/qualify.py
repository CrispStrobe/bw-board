"""Exactly three fresh semantic arms. No paired timing gate or rebuild."""
import sys
sys.dont_write_bytecode=True
import json,os,platform,signal,subprocess,urllib.request,urllib.parse,zipfile
from pathlib import Path
from admission import HERE,ROOT,WORKSPACE,ROLES,U,T,R,ORDER,COMPILED,NODE_SHA,fingerprint,read_json,git,source_identity,validate_contract,validate_source_packets,validate_worker_locks
from policy import require,identity_sha,validate_worker_receipt
from lifecycle import write,bounded_child,host_context,interrupted,HOOKS

def artifact_origin(url):
    p=urllib.parse.urlsplit(url);require(p.scheme=='https' and p.hostname and p.username is None and p.password is None,'HTTPS credential-safe origin');port=443 if p.port is None else p.port;require(1<=port<=65535,'HTTPS port domain');return (p.scheme,p.hostname.lower(),port)
class ArtifactRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,req,fp,code,msg,headers,newurl):
        before,after=artifact_origin(req.full_url),artifact_origin(newurl);result=super().redirect_request(req,fp,code,msg,headers,newurl)
        if result is not None and before!=after:result.remove_header('Authorization')
        return result
def download(descriptor,out):
    out.mkdir();token=os.environ.get('GH_TOKEN');require(token,'read-only official API credential')
    url='https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/'+str(descriptor['artifactId']);headers={'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};opener=urllib.request.build_opener(ArtifactRedirect())
    with opener.open(urllib.request.Request(url,headers=headers),timeout=30) as r:raw=r.read(1<<20)
    require(len(raw)<1<<20,'metadata bound');(out/'official-metadata.json').write_bytes(raw);m=json.loads(raw)
    require(m['id']==descriptor['artifactId'] and m['size_in_bytes']==descriptor['zipBytes'] and m['workflow_run']['id']==descriptor['runId'] and m['workflow_run']['head_sha']==descriptor['head'],'exact official artifact/run/head')
    require(not m['expired'] and m['digest']=='sha256:'+descriptor['zipSha256'],'official digest/expiry')
    p=out/'official-artifact.zip';count=0
    with opener.open(urllib.request.Request(url+'/zip',headers=headers),timeout=60) as r,p.open('xb') as f:
        while chunk:=r.read(65536):count+=len(chunk);require(count<=descriptor['zipBytes'],'ZIP cap');f.write(chunk)
    require(fingerprint(p)=={'bytes':descriptor['zipBytes'],'sha256':descriptor['zipSha256']},'lossless official download');return p
def capture_from_zip(path,c,out):
    a=c['captureArtifact']
    with zipfile.ZipFile(path) as z:
        matches=[i for i in z.infolist() if i.filename==a['member']];require(len(matches)==1,'unique genuine capture member');i=matches[0];require(not i.is_dir() and not i.flag_bits&1 and i.file_size==a['captureBytes'],'ordinary bounded capture member')
        data=z.read(i)
    p=out/'capture.json';p.write_bytes(data);require(fingerprint(p)=={'bytes':a['captureBytes'],'sha256':a['captureSha256']},'exact raw successful capture');return p
def run_setup(command,cwd,folder,bounds):
    e=bounded_child(command,cwd,folder,bounds);require(e['exitCode']==0 and not e['timedOut'] and not e['interrupted'],'setup failed; no next stage');return e
def materialize_source(root,revision,files):
    require(git(root,'rev-parse','HEAD').decode().strip()==revision,'exact checkout before sparse')
    subprocess.run(['git','-C',str(root),'sparse-checkout','set','--no-cone','--stdin'],input=''.join('/'+p+'\n' for p in sorted(files)).encode(),check=True,timeout=30)
    subprocess.run(['git','-C',str(root),'restore','--source=HEAD','--worktree','--',*files],check=True,timeout=30)
    return source_identity(root,revision,files)
def setup(c,out,node,report):
    for kind,revision,files in [('compiled',COMPILED,c['compiledFiles']),('driver',c['driver']['revision'],c['driver']['files']),*[(k,w['revision'],w['files']) for k,w in c['workers'].items()]]:materialize_source(ROLES[kind],revision,files)
    validate_worker_locks(c)
    report['sourceBeforeArtifactRestore']=source_context(c,node);write(out/'source-before-artifact-restore.json',report['sourceBeforeArtifactRestore'])
    require(not os.path.lexists(U) and not os.path.lexists(T) and not os.path.lexists(R),'exclusive original restoration roles')
    for i,command in enumerate([['git','init',str(U)],['git','-C',str(U),'remote','add','origin','https://github.com/bochs-emu/Bochs.git'],['git','-C',str(U),'fetch','--depth=1','--no-tags','origin',c['bochsRevision']],['git','-C',str(U),'checkout','--detach','FETCH_HEAD']]):run_setup(command,ROOT,out/('upstream-'+str(i)),c['bounds'])
    build_zip=download(c['buildArtifact'],out/'build-artifact');capture_zip=download(c['captureArtifact'],out/'capture-artifact');capture=capture_from_zip(capture_zip,c,out);audit=out/'independent-audit.json';audit.write_bytes((HERE/c['independentAudit']['file']).read_bytes());require(fingerprint(audit)=={'bytes':c['independentAudit']['bytes'],'sha256':c['independentAudit']['sha256']},'exact audited prerequisite')
    d=c['driver'];restore={'zip':str(build_zip),'compiledRoot':str(ROLES['compiled']),'upstreamRoot':str(U),'driverRoot':str(ROLES['driver']),'driverRevision':d['revision'],'driverFiles':d['files'],'driverAuth':d['auth'],'driverAuthSha256':d['authSha256'],'driverIdentitySha256':d['sourceSha256'],'node':str(node),'output':str(out/'materialization')};write(out/'restore-binding.json',restore)
    report['immutableInputsBeforeRestore']=restore_input_snapshot(out);write(out/'immutable-inputs-before-restore.json',report['immutableInputsBeforeRestore'])
    run_setup([sys.executable,'-B',str(ROOT/'scripts/cold-native-restore/restore.py'),str(out/'restore-binding.json')],ROOT,out/'restore-child',c['bounds'])
    configuration=out/'guest-source.bochsrc';identity=ROLES['compiled']/'scripts/bochs-cpu3-native-cold-bios/identity.mjs';script='import {canonicalConfiguration,authenticateConfiguration} from '+json.dumps(identity.as_uri())+';import fs from "node:fs";fs.writeFileSync(process.argv[1],canonicalConfiguration(process.argv[2]),{flag:"wx"});console.log(JSON.stringify(authenticateConfiguration(process.argv[1])));'
    run_setup([str(node),'--max-old-space-size=128','--input-type=module','-e',script,str(configuration),str(out/'bochs.log')],ROLES['compiled'],out/'configuration-child',c['bounds'])
    native=read_json(R/'static-input.json');require(set(native)=={'addon','sha256','preparedManifest','preparedManifestSha256','buildReceipt','buildReceiptSha256'},'genuine original native artifact input');require(native['sha256']==c['addonSha256'],'same actual qualified DSO')
    native.update(compiledRoot=str(ROLES['compiled']),compiledRevision=COMPILED,configuration=str(configuration))
    return {'capture':{'path':str(capture),'sha256':c['captureArtifact']['captureSha256']},'independentAudit':{'path':str(audit),'sha256':c['independentAudit']['sha256']},'targetN':c['targetN'],'targetQ':c['targetQ'],'configuredClockHz':6000000,'node':{'path':str(node),'sha256':NODE_SHA},'nativeInput':native,'compiledFiles':{p:r['sha256'] for p,r in c['compiledFiles'].items()},'workers':{k:{**w,'files':{p:r['sha256'] for p,r in w['files'].items()}} for k,w in c['workers'].items()}}
def tooling_identity():
    revision=git(ROOT,'rev-parse','HEAD').decode().strip();require(not git(ROOT,'status','--porcelain'),'clean tooling checkout')
    paths=[p for p in HERE.rglob('*') if p.is_file()];paths += [ROOT/'package.json',ROOT/'.github/workflows/i80386-cold-three-arm-qualification.yml',ROOT/'test/i80386-cold-three-arm-source.test.mjs']
    paths += [ROOT/'scripts/cold-native-restore'/n for n in ('admission.py','archive.py','restore.py','frozen-members.json','prepared-members.json','official-members.json')]
    files={str(p.relative_to(ROOT)):fingerprint(p) for p in paths};return source_identity(ROOT,revision,files)
def source_context(c,node):
    return {'tooling':tooling_identity(),'node':fingerprint(node),'compiled':source_identity(ROLES['compiled'],COMPILED,c['compiledFiles']),'driver':source_identity(ROLES['driver'],c['driver']['revision'],c['driver']['files']),'workers':{k:source_identity(ROLES[k],w['revision'],w['files']) for k,w in c['workers'].items()}}
def restore_input_snapshot(out):
    paths=[out/'capture.json',out/'independent-audit.json',out/'restore-binding.json']
    paths += [p for d in ('build-artifact','capture-artifact') for p in (out/d).rglob('*') if p.is_file()]
    return {str(p):fingerprint(p) for p in paths}
def immutable_snapshot(c,b,node,out):
    result=source_context(c,node)
    validate_source_packets(c);validate_worker_locks(c)
    paths=[p for p in R.rglob('*') if p.is_file()];paths += [T/p for p in read_json(ROOT/'scripts/cold-native-restore/prepared-members.json')];paths += [T/'bochs/bw_direct.node',out/'capture.json',out/'independent-audit.json',out/'guest-source.bochsrc',out/'restore-binding.json']
    paths += [p for d in ('materialization','build-artifact','capture-artifact') for p in (out/d).rglob('*') if p.is_file()]
    result['artifactPins']={str(p):fingerprint(p) for p in paths};return result
def child_input(arm,b,out):
    kind='plainJs' if arm=='plain-JS' else 'native';w=b['workers'][kind];data={k:b[k]['path'] for k in ('capture','independentAudit')};data.update(output=str(out),workerRevision=w['revision'],workerSourceSha256=w['sourceSha256'],nodeSha256=NODE_SHA)
    if kind=='native':data.update(b['nativeInput']);data['mode']='oneQ' if arm=='native-oneQ' else 'batched'
    return data
def main(mode):
    require(mode in ('disabled','enabled'),'explicit manual enabled/disabled')
    if mode=='disabled':print('Semantic qualification disabled; no setup/download/restore/worker');return
    c=validate_contract(read_json(HERE/'contract.json'));validate_source_packets(c) # BEFORE subprocess/setup.
    require(os.environ.get('GITHUB_EVENT_NAME')=='workflow_dispatch','manual only');require(ROOT==WORKSPACE/'runtime','fixed tooling role')
    for k in HOOKS:require(not os.environ.get(k),'blank parent hooks')
    node=Path(os.environ['BW_COLD_NODE']);require(fingerprint(node)['sha256']==NODE_SHA,'exact Node before setup');require(platform.machine()=='x86_64' and platform.libc_ver()[1]=='2.39','qualified original Ubuntu24 loader ABI')
    out=Path(os.environ['BW_COLD_QUALIFICATION_OUTPUT']);require(out.is_absolute() and out.resolve()==out and out.parent.is_dir() and not os.path.lexists(out),'canonical exclusive output')
    for root in [ROOT,*ROLES.values(),U,T,R]:require(out!=root and root not in out.parents and out not in root.parents,'disjoint fixed roles')
    out.mkdir();report={'schema':'bw.cold-three-arm.qualification-result.v1','status':'FAIL','arms':{},'scope':'Exactly three semantic children; no paired gate/speed/adoption claim'};initial=None;setup_binding=None;primary=None;final_error=None
    try:
        tool=tooling_identity();require(tool['revision']==os.environ['GITHUB_SHA'],'exact manual tooling head');write(out/'tooling-before-setup.json',tool);write(out/'host-before.json',host_context());write(out/'contract.json',c)
        setup_binding=setup(c,out,node,report);initial=immutable_snapshot(c,setup_binding,node,out);write(out/'before-arms.json',initial);capture=read_json(setup_binding['capture']['path']);require(capture['status']=='CLOSED_COLD_BIOS_BOCHS_RESET_MODEL_JS_DIAGNOSTIC_PASS' and capture['input']['compiledRevision']==COMPILED and capture['progress']['n']==c['targetN'] and capture['progress']['q']==c['targetQ'],'actual diagnostic prerequisite')
        for arm in ORDER:
            before=immutable_snapshot(c,setup_binding,node,out);require(before==initial,'exact immutable pre-child context');ns=out/arm;inp=out/(arm+'-input.json');data=child_input(arm,setup_binding,ns/'receipt');write(inp,data);input_pin=fingerprint(inp);kind='plainJs' if arm=='plain-JS' else 'native';w=c['workers'][kind];write(out/(arm+'-before.json'),before);write(out/(arm+'-host.json'),host_context())
            lifecycle=bounded_child([str(node),'--max-old-space-size=128',str(ROLES[kind]/w['entry']),str(inp)],ROLES[kind],ns,c['bounds']);report['arms'][arm]={'child':lifecycle,'input':data,'inputPinBefore':input_pin}
            after=None
            try:after=immutable_snapshot(c,setup_binding,node,out);write(ns/'after-authentication.json',after)
            except BaseException as error:write(ns/'after-authentication-unavailable.json',{'error':repr(error)})
            require(lifecycle['exitCode']==0 and not lifecycle['timedOut'] and not lifecycle['interrupted'],'first worker failure stops remaining arms; no retry');require(after==before and fingerprint(inp)==input_pin,'exact immutable post-child source/artifact/input')
            raw=ns/'receipt/receipt.json';r=read_json(raw);require(r['inputSha256Before']==r['inputSha256After']==input_pin['sha256'],'worker actual input authentication');metrics=validate_worker_receipt(r,arm,data,setup_binding,capture)
            if kind=='plainJs':require(r['result']['beforeSettle']['cpu']==capture['cuts'][-1]['javascript']['cpu'],'explicit pre-settle CPU phase')
            report['arms'][arm].update(rawReceipt=str(raw),rawReceiptPin=fingerprint(raw),terminalParity=True,executionSelfReports=metrics);write(ns/'terminal-validation.json',report['arms'][arm])
        report['status']='THREE_ARM_SEMANTIC_CHILDREN_PASS_REQUIRES_INDEPENDENT_AUDIT'
    except BaseException as error:primary=error;report['error']=repr(error);raise
    finally:
        try:
            report['toolingAfter']=tooling_identity()
            if 'sourceBeforeArtifactRestore' in report:
                report['sourceAfterArtifactRestore']=source_context(c,node);require(report['sourceAfterArtifactRestore']==report['sourceBeforeArtifactRestore'],'source context after restore or setup failure')
            if 'immutableInputsBeforeRestore' in report:
                report['immutableInputsAfterRestore']=restore_input_snapshot(out);require(report['immutableInputsAfterRestore']==report['immutableInputsBeforeRestore'],'immutable download/restore inputs after setup or child failure')
            if initial is not None:
                final=immutable_snapshot(c,setup_binding,node,out);write(out/'after-arms.json',final);require(final==initial,'final immutable source/artifact authentication')
            else:require(False,'setup incomplete; no complete final qualification authentication')
        except BaseException as error:final_error=error;report['finalizationError']=repr(error);report['status']='FAIL'
        write(out/'host-after.json',host_context());write(out/'result.json',report)
        if final_error is not None and primary is None:raise final_error
    # An independent review of these actual raw records is a separate prerequisite.
    # No armQualificationAudit is synthesized or accepted to authorize this run.
if __name__=='__main__':
    for s in (signal.SIGINT,signal.SIGTERM):signal.signal(s,interrupted)
    require(len(sys.argv)==2,'one explicit manual mode');main(sys.argv[1])

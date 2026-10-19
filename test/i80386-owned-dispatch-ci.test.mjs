/** Nonguest source-only controls; reconstruction uses an owned index/worktree, never native code. */
import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync}from 'node:child_process';import {fileURLToPath}from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
test('portable BASE/DISPATCH/config/admission exact inverse and nonguest syntax',()=>{const result=spawnSync('python3',['-B','-c',`import sys,pathlib,tempfile,subprocess,json,hashlib,re
sys.path.insert(0,${JSON.stringify(root+'scripts/owned-dispatch-ci')})
from portable import configuration,runner,admission
p=pathlib.Path(${JSON.stringify(root+'scripts/owned-dispatch-ci')});node=${JSON.stringify(process.execPath)}
original=(p/'guest.bochsrc').read_text();token=re.search(r'^romimage: file=([^\\s,]+)',original,re.M)[1]
modified=original.replace(token,token+', address=0xf0000',1)
config,proof=configuration(modified,'/tmp/compiled','/tmp/log');assert proof['inverseExact']and ', address=0xf0000'in config
f=json.loads((p/'frozen-source.json').read_text());base=(p/'base-runner-source.mjs').read_text();source=(p/'base-admission-source.mjs').read_text()
assert hashlib.sha256(base.encode()).hexdigest()==f['compiled']['hashes']['scripts/run-i80386-native-owned-in8.mjs']
assert hashlib.sha256(source.encode()).hexdigest()==f['compiled']['hashes']['scripts/bochs-cpu3-native-owned-in8/admission.mjs']
generated={};derived,proof=admission(source,'/tmp/compiled',hashlib.sha256(config.encode()).hexdigest());assert proof['inverseExact'];generated['admission']=derived
for arm,source in [('BASE',base),('DISPATCH',(p/'payload/scripts/run-i80386-native-owned-dispatch.mjs').read_text())]:
 derived,proof=runner(source,'/tmp/'+arm,'/tmp/admission');assert proof['inverseExact'];assert 'result=resume(n,q,d)'in derived;generated[arm]=derived
with tempfile.TemporaryDirectory(prefix='owned-dispatch-syntax-')as tmp:
 for name,text in generated.items():
  file=pathlib.Path(tmp)/(name+'.mjs');file.write_text(text);subprocess.run([node,'--check',str(file)],check=True,timeout=30)
for fn,args in [(runner,(base+'\\n','/tmp/BASE','/tmp/admission')),(admission,((p/'base-admission-source.mjs').read_text()+'\\n','/tmp/compiled','0'*64)),(configuration,(original+original,'/tmp/compiled','/tmp/log'))]:
 try:fn(*args)
 except AssertionError:pass
 else:raise AssertionError('bad source/seam admitted')
print(json.dumps({'generatedSha256':{name:hashlib.sha256(text.encode()).hexdigest()for name,text in generated.items()},'configurationSha256':hashlib.sha256(config.encode()).hexdigest(),'noAddonLoad':True}))
`],{encoding:'utf8',timeout:120000});assert.equal(result.status,0,result.stderr);console.log(result.stdout.trim());});
test('raw commits and payloads bind full frozen source revisions and tree metadata',()=>{const r=spawnSync('python3',['-B','-c',`import pathlib,json,hashlib
p=pathlib.Path(${JSON.stringify(root+'scripts/owned-dispatch-ci')});f=json.loads((p/'frozen-source.json').read_text());assert len(f['runtime']['hashes'])==112 and len(f['compiled']['hashes'])==103
for file in (p/'payload').rglob('*'):
 if file.is_file():assert hashlib.sha256(file.read_bytes()).hexdigest()==f['runtime']['hashes'][str(file.relative_to(p/'payload'))]
for rev,parent in [('e7a6a4ab7f2bed32a5f6d0c81e35c04e1d16d759','fe1eff2039520536350922a2164c8bbe29404c68'),('2c688e69cae516b9749d70a126a3b474707d5cb7','e7a6a4ab7f2bed32a5f6d0c81e35c04e1d16d759')]:
 data=(p/(rev+'.commit.txt')).read_bytes();assert hashlib.sha1(b'commit '+str(len(data)).encode()+b'\\0'+data).hexdigest()==rev;assert data.split(b'\\n')[1]==('parent '+parent).encode()
`],{encoding:'utf8',timeout:120000});assert.equal(r.status,0,r.stderr);});
test('exact reconstruction and malformed payload refusal without shared index edits',()=>{const r=spawnSync('python3',['-B','-c',`import pathlib,tempfile,sys,subprocess,shutil
sys.path.insert(0,${JSON.stringify(root+'scripts/owned-dispatch-ci')});from reconstruct import reconstruct
p=pathlib.Path(${JSON.stringify(root+'scripts/owned-dispatch-ci')});repo=pathlib.Path(${JSON.stringify(root)})
with tempfile.TemporaryDirectory(prefix='owned-dispatch-git-')as tmp:
 t=pathlib.Path(tmp);proof=reconstruct(repo,p,t/'candidate',t/'index');assert proof['runtimeRevision']=='2c688e69cae516b9749d70a126a3b474707d5cb7'
 subprocess.run(['git','-C',str(repo),'worktree','remove',str(t/'candidate')],check=True)
 bad=t/'bad';shutil.copytree(p,bad);file=bad/'payload/scripts/bochs-cpu3-native-owned-dispatch/provider.mjs';file.write_bytes(file.read_bytes()+b'\\n')
 try:reconstruct(repo,bad,t/'rejected',t/'bad-index')
 except AssertionError:pass
 else:raise AssertionError('modified source admitted')
 assert not(t/'rejected').exists()
`],{encoding:'utf8',timeout:120000});assert.equal(r.status,0,r.stderr);});

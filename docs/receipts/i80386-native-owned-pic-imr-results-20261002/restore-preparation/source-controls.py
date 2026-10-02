"""Pure extracted-source controls; never runs restoration main or loads native code."""
import ast,hashlib,json,pathlib,tempfile,tarfile,io,shutil
P=pathlib.Path(__file__).resolve().parent;source=(P/'restore.py').read_text();tree=ast.parse(source)
sha=lambda b:hashlib.sha256(b).hexdigest();derivation=json.loads((P/'derivation.json').read_text());inverse=source
for seam in reversed(derivation['restoreSeams']):assert inverse.count(seam['after'])==1;inverse=inverse.replace(seam['after'],seam['before'])
assert inverse==(P/'original-restore.py').read_text();assert sha(source.encode())==derivation['derivedRestoreSha256']
extract=next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name=='extract');scope={'pathlib':pathlib,'tarfile':tarfile,'shutil':shutil};exec(ast.get_source_segment(source,extract),scope);checks=['exact full helper inverse']
with tempfile.TemporaryDirectory(prefix='bw-pic-restore-source-')as temp:
 root=pathlib.Path(temp)
 def archive(name,member):
  path=root/(name+'.tar.gz')
  with tarfile.open(path,'w:gz')as f:f.addfile(member,io.BytesIO(b'abc')if member.isfile()and member.size==3 else None)
  return path
 good=tarfile.TarInfo('bochs/source.cc');good.size=3;dest=root/'good';dest.mkdir();scope['extract'](archive('good',good),dest);assert(dest/'bochs/source.cc').read_bytes()==b'abc';checks.append('ordinary file positive')
 for name,member in [('parent',tarfile.TarInfo('../escape')),('absolute',tarfile.TarInfo('/escape')),('symlink',tarfile.TarInfo('link')),('hardlink',tarfile.TarInfo('hard'))]:
  if name=='symlink':member.type=tarfile.SYMTYPE;member.linkname='/escape'
  if name=='hardlink':member.type=tarfile.LNKTYPE;member.linkname='bochs/source.cc'
  dest=root/name;dest.mkdir()
  try:scope['extract'](archive(name,member),dest)
  except AssertionError:checks.append(name+' denied')
  else:raise AssertionError(name+' admitted')
 dest=root/'overwrite';dest.mkdir();(dest/'bochs').mkdir();(dest/'bochs/source.cc').write_bytes(b'keep')
 try:scope['extract'](archive('overwrite',good),dest)
 except FileExistsError:assert(dest/'bochs/source.cc').read_bytes()==b'keep';checks.append('exclusive no overwrite')
 else:raise AssertionError('overwrite admitted')
Profile=next(n for n in tree.body if isinstance(n,ast.Assert)and ast.get_source_segment(source,n).startswith("assert M['profile']=="));actual=json.loads((P/'plan.json').read_text())['profile'];statement=ast.get_source_segment(source,Profile)
exec(statement,{'M':{'profile':actual}});checks.append('actual complete seven-field profile positive')
for label,mutate in [('dropstatus',lambda p:p.pop('status')),('witness',lambda p:p.__setitem__('expectedPicWitness',[0,255])),('ROM',lambda p:p.__setitem__('romSha256','0'*64)),('count',lambda p:p.__setitem__('sourceCount',103)),('extra',lambda p:p.__setitem__('extra',True))]:
 profile=dict(actual);mutate(profile)
 try:exec(statement,{'M':{'profile':profile}})
 except AssertionError:checks.append(label+' profile denied')
 else:raise AssertionError(label+' profile admitted')
assert json.loads((P/'binding-template.json').read_text())['ci']['runId']is None
print(json.dumps({'status':'PURE_SOURCE_RESTORE_CONTROLS_PASS_NO_RESTORE_OR_NATIVE_EXECUTION','checks':checks,'count':len(checks)}))

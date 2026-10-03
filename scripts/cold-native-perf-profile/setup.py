"""Unprivileged setup: call only the exact held setup-entry, never pairs."""
import sys
sys.dont_write_bytecode=True
import subprocess,json,os,importlib.util
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import profile

def main(node):
 c=profile.guard();profile.authenticate_sources(c)
 require=profile.require;require(os.geteuid()!=0,'setup remains unprivileged')
 own=profile.source_map();head=subprocess.check_output(['git','-C',str(profile.ROOT),'rev-parse','HEAD'],text=True).strip();require(head==os.environ['GITHUB_SHA'] and not subprocess.check_output(['git','-C',str(profile.ROOT),'status','--porcelain']),'exact clean dispatched source')
 for n,h in own.items():require(profile.hashlib.sha256(subprocess.check_output(['git','-C',str(profile.ROOT),'show',head+':'+n])).hexdigest()==h,'own current/Git '+n)
 require(subprocess.check_output(['git','-C',str(profile.PAIRED),'rev-parse','HEAD'],text=True).strip()==c['pairedRevision'] and not subprocess.check_output(['git','-C',str(profile.PAIRED),'status','--porcelain']),'held paired clean HEAD')
 for n,h in c['pairedFiles'].items():require(profile.hashlib.sha256(subprocess.check_output(['git','-C',str(profile.PAIRED),'show',c['pairedRevision']+':'+n])).hexdigest()==h,'held paired current/Git '+n)
 p=profile.paired_module(c);base=profile.SETUP.parent;require(not os.path.lexists(base),'exclusive original setup role');base.mkdir();p.write(base/'profile-source.json',{'revision':head,'hashes':own,'pairedRevision':c['pairedRevision'],'uid':os.getuid(),'gid':os.getgid(),'environment':{k:os.environ[k] for k in ('HOME','USER','LOGNAME','PATH','LANG','LC_ALL','TMPDIR','XDG_CONFIG_HOME','XDG_CACHE_HOME') if k in os.environ}})
 spec=importlib.util.spec_from_file_location('held_hosted',profile.PAIRED/'scripts/cold-performance-paired/hosted.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);contract,_=m.pending_guard()
 primary=None;report={'status':'FAIL'}
 try:
  result=p.bounded_child([sys.executable,'-B',str(profile.PAIRED/'scripts/cold-performance-paired/setup-entry.py'),str(profile.SETUP),node],profile.PAIRED,base/'profile-setup-child',m.setup_bounds(contract),permit_api_token=True)
  require(result['exitCode']==0 and not result['timedOut'] and not result['interrupted'],'first restoration failure; no profile retry')
  require(p.read_json(profile.SETUP/'setup-result.json')['status']=='SETUP_STATIC_AUTHENTICATION_PASS_NO_ARMS_EXECUTED','held static setup proof')
  require(profile.source_map()==own,'profile sources unchanged after setup')
  report['status']='SETUP_STATIC_PASS_NO_ARMS'
 except BaseException as e:primary=e;report['error']=repr(e);raise
 finally:
  final=None
  try:
   after=profile.source_map();p.write(base/'profile-source-after.json',after);require(after==own,'own source unchanged on setup failure or success')
   require(subprocess.check_output(['git','-C',str(profile.ROOT),'rev-parse','HEAD'],text=True).strip()==head and not subprocess.check_output(['git','-C',str(profile.ROOT),'status','--porcelain']),'own HEAD clean unchanged')
   profile.authenticate_sources(c)
  except BaseException as e:final=e;report['status']='FAIL';report['finalizationError']=repr(e)
  p.write(base/'profile-setup-result.json',report)
  if final is not None and primary is None:raise final
if __name__=='__main__':
 profile.require(len(sys.argv)==2,'one actual Node path');main(sys.argv[1])

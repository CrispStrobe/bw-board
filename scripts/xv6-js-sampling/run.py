#!/usr/bin/env python3
"""Bounded xv6 V8 diagnostic, not an adoption or timing benchmark."""
from __future__ import annotations
import argparse, copy, hashlib, importlib.util, json, stat, subprocess, sys, zipfile
from pathlib import Path

HERE=Path(__file__).resolve().parent
HARNESS_FILES=(
 '.github/workflows/x86-xv6-js-sampling.yml',
 'scripts/xv6-js-sampling/README.md',
 'scripts/xv6-js-sampling/derive.mjs',
 'scripts/xv6-js-sampling/derive-control.mjs',
 'scripts/xv6-js-sampling/profile.py',
 'scripts/xv6-js-sampling/profile-control.py',
 'scripts/xv6-js-sampling/run.py',
 'scripts/xv6-js-sampling/run-control.py',
)
QUALIFIED='22ca742ed60e1350ed96110986a09b2ce84620ac'
HISTORICAL_ZIP_SHA='9dbe478782e2a0ddbbc75d19ec6c2389a55473cc9517908d376b476e39740330'
HISTORICAL_RUN=37627659600
QUALIFIED_HELPERS={
 'scripts/xv6-js-acceptance/run.py':'9286b1d3702995d02c6d5ef702f0b7c200418d1ef86d43c4d214e2af58fb2a0a',
 'scripts/xv6-js-acceptance/policy.py':'d0cdb22838ac7ef740def52e603046f81da112b2bf1c1b97256e41e014a4ae00',
 'scripts/build-xv6-stock-4m.mjs':'258149dbc13b28944669bb363894345b05e2fac6327d0c45abf5fe15758f0f3c',
}

def fail(condition,message):
 if not condition: raise ValueError(message)

def admit_harness(root:Path,head:str):
 fail(len(head)==40 and all(c in '0123456789abcdef' for c in head),'exact harness SHA')
 root=root.resolve(strict=True)
 fail(root==HERE.parents[1],'runner outside harness checkout')
 fail(subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==head,
      'wrong harness checkout head')
 fail(not subprocess.check_output(['git','-C',str(root),'status','--porcelain','--untracked-files=all']),
      'dirty harness checkout')
 hashes={}
 for role in HARNESS_FILES:
  file=root/role;info=file.lstat()
  fail(stat.S_ISREG(info.st_mode) and not file.is_symlink() and 0<info.st_size<=4*1024*1024,
       'ordinary bounded harness role')
  body=subprocess.check_output(['git','-C',str(root),'--no-replace-objects','show',f'{head}:{role}'])
  fail(file.read_bytes()==body,'harness differs from exact Git blob')
  hashes[role]=hashlib.sha256(body).hexdigest()
 return hashes

def admitted_qualified(root:Path):
 root=root.resolve(strict=True)
 fail(not subprocess.check_output(['git','-C',str(root),'for-each-ref','--format=%(refname)','refs/replace'],
                                  text=True).strip(),'qualified checkout has replace refs')
 fail(subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip()==QUALIFIED,
      'wrong qualified source head')
 fail(not subprocess.check_output(['git','-C',str(root),'status','--porcelain','--untracked-files=all']),
      'qualified checkout not clean before derivative')
 for role,expected in QUALIFIED_HELPERS.items():
  file=root/role;info=file.lstat()
  fail(stat.S_ISREG(info.st_mode) and not file.is_symlink() and
       hashlib.sha256(file.read_bytes()).hexdigest()==expected,
       'exact qualified helper bytes')
  body=subprocess.check_output(['git','-C',str(root),'--no-replace-objects','show',f'{QUALIFIED}:{role}'])
  fail(body==file.read_bytes(),'qualified helper differs from immutable Git object')
 return root

def generated_only(root:Path,expected_sha:str):
 generated=root/'scripts/probe-xv6-stock-profile.mjs'
 info=generated.lstat()
 fail(stat.S_ISREG(info.st_mode) and not generated.is_symlink() and
      0<info.st_size<=4*1024*1024 and
      hashlib.sha256(generated.read_bytes()).hexdigest()==expected_sha,
      'exact generated sibling')
 state=subprocess.check_output(['git','-C',str(root),'status','--porcelain','--untracked-files=all'],text=True)
 fail(state=='?? scripts/probe-xv6-stock-profile.mjs\n','only one generated sibling in qualified checkout')

def historical_reference(path:Path,accepted,source_inventory:dict):
 info=path.lstat()
 fail(stat.S_ISREG(info.st_mode) and not path.is_symlink() and 0<info.st_size<=1024*1024 and
      accepted.sha_file(path)==HISTORICAL_ZIP_SHA,'exact original official xv6 ZIP')
 with zipfile.ZipFile(path) as archive:
  names=archive.namelist()
  fail(len(names)==len(set(names))==89 and all(not name.startswith('/') and
       '..' not in Path(name).parts and not name.endswith('/') for name in names),
       'bounded original ZIP names')
  inventory=json.loads(archive.read('file-inventory.json'))['files']
  fail(type(inventory)==dict and len(inventory)==86 and
       set(names)==set(inventory)|{'file-inventory.json','parent.stdout','parent.stderr'},
       'complete original packet inventory')
  for name,entry in inventory.items():
   metadata=archive.getinfo(name)
   fail(0<=metadata.file_size<=4*1024*1024 and metadata.file_size==entry['bytes'] and
        hashlib.sha256(archive.read(name)).hexdigest()==entry['sha256'],
        'original packet member digest')
  binding=json.loads(archive.read('binding.json'))
  old_media=binding['mediaSha256']
  fail(binding['head']==QUALIFIED and binding['sourceInventoryEntries']==len(source_inventory) and
       binding['sourceInventorySha256']==accepted.sha256_json(source_inventory),
       'original source identity differs')
  old_report=json.loads(archive.read('pair-00-ordinary/stdout.json'))
  from policy import validate_report
  old_projection=validate_report(old_report,'ordinary',QUALIFIED,old_media)
  fail(old_report['sourceSha256']==source_inventory,'original reported source differs')
  return {'binding':binding,'report':old_report,'projection':old_projection}

def compare_historical(old:dict,new:dict,media:dict,accepted):
 old_media=old['binding']['mediaSha256'];same_media=old_media==media
 from policy import validate_report
 historical=copy.deepcopy(old['projection'])
 current=copy.deepcopy(validate_report(new,'ordinary',QUALIFIED,media))
 for projection in (historical,current):
  for field in ('image','slaveImage','rom'):
   projection[field]['path']='[different hosted checkout path]'
 return {'originalRunId':HISTORICAL_RUN,'originalZipSha256':HISTORICAL_ZIP_SHA,
   'sourceHeadSame':old['binding']['head']==QUALIFIED,
   'nodeVersionOriginal':old['binding']['hostBefore']['node'],
   'hostCpuOriginal':old['binding']['hostBefore']['cpuModel'],
   'guestProfileOriginal':old['report']['profile'],
   'originalMediaSha256':old_media,'freshMediaSha256':media,
   'mediaSame':same_media,'stepsOriginal':old['report']['steps'],
   'stepsFresh':new['steps'],'semanticEqualIfSameMedia':historical==current if same_media else None}

def main():
 parser=argparse.ArgumentParser()
 for arg in ('harness','qualified','image-dir','output'):
  parser.add_argument('--'+arg,required=True,type=Path)
 parser.add_argument('--head',required=True)
 parser.add_argument('--historical-zip',required=True,type=Path)
 args=parser.parse_args()
 output=args.output.resolve()
 output.mkdir(mode=0o700,exist_ok=False)
 completed=[]
 try:
  harness=args.harness.resolve(strict=True)
  harness_hashes=admit_harness(harness,args.head)
  qualified=admitted_qualified(args.qualified)
  sys.path.insert(0,str(qualified/'scripts/xv6-js-acceptance'))
  import run as accepted
  from policy import validate_report,compare_reports,sha256_json
  # Import this local parser without importing the untrusted sampled JSON as code.
  profile_spec=importlib.util.spec_from_file_location('xv6_profile_parser',HERE/'profile.py')
  profiler=importlib.util.module_from_spec(profile_spec)
  profile_spec.loader.exec_module(profiler)
  media=accepted.check_media(qualified,args.image_dir.resolve(strict=True))
  accepted.ordinary_file(args.image_dir/'kernel',20*1024*1024)
  original_source=accepted.expected_source_inventory(qualified,QUALIFIED)
  historical=historical_reference(args.historical_zip.resolve(strict=True),accepted,original_source)
  generated=qualified/'scripts/probe-xv6-stock-profile.mjs'
  derivative=json.loads(subprocess.check_output(['node',str(harness/'scripts/xv6-js-sampling/derive.mjs'),
      str(qualified),str(generated)],text=True))
  generated_only(qualified,derivative['generatedSha256'])
  accepted.write_json(output/'binding.json',{'schema':'bw.xv6-js-sampling-binding.v1',
    'harnessHead':args.head,'qualifiedHead':QUALIFIED,'qualifiedSourceSha256':sha256_json(original_source),
    'qualifiedSourceEntries':len(original_source),'harnessSha256':harness_hashes,
    'qualifiedHelpersSha256':QUALIFIED_HELPERS,
    'derivative':derivative,'mediaSha256':media,
    'kernelSha256':accepted.sha_file(args.image_dir/'kernel'),
    'hostBefore':accepted.host_metadata(),
    'workload':{'profile':'4m','command':'forktest\\r','lean':True,'fullRamHash':True,
                'stepLimit':40000000,'unprofiledReferences':2,'sampledPerArm':2},
    'historicalActual':{'runId':HISTORICAL_RUN,'officialZipSha256':HISTORICAL_ZIP_SHA,
                        'sourceHead':QUALIFIED,'comparison':'read-only official packet admitted'}})
  # Fresh unprofiled ordinary and dispatch reference first. All later children
  # must equal this same-media semantic projection before a sample is read.
  schedule=[('reference','ordinary'),('reference','dispatch'),
            ('sample-1','ordinary'),('sample-1','dispatch'),
            ('sample-2','dispatch'),('sample-2','ordinary')]
  reference={};baseline_semantic=None;sample_summaries=[]
  for phase,arm in schedule:
   generated_only(qualified,derivative['generatedSha256'])
   child=output/f'{phase}-{arm}'
   env=accepted.clean_child_env(args.image_dir.resolve(strict=True),arm)
   sampled=phase!='reference'
   if sampled:env['XV6_PROFILE_OUT']=str(child/'cpu.cpuprofile')
   script='scripts/probe-xv6-stock-profile.mjs' if sampled else 'scripts/probe-xv6-stock.mjs'
   metrics=accepted.run_bounded(['node','--max-old-space-size=768',script],qualified,env,child,arm)
   report=accepted.load_json(child/'stdout.json')
   semantic=validate_report(report,arm,QUALIFIED,media)
   fail(report['sourceSha256']==original_source,'reported source closure differs from preflight')
   accepted.check_source_inventory(qualified,original_source)
   sem_hash=sha256_json(semantic)
   if baseline_semantic is None:baseline_semantic=semantic
   fail(semantic==baseline_semantic,'sampled or cross-arm guest state differs from fresh reference')
   if phase=='reference':reference[arm]=report
   else:
    summary=profiler.summarize(child/'cpu.cpuprofile',qualified,original_source,
                               derivative['generatedSha256'])
    accepted.write_json(child/'profile-summary.json',summary)
    sample_summaries.append({'phase':phase,'arm':arm,'summary':summary})
   receipt={'phase':phase,'arm':arm,'sampled':sampled,'semanticSha256':sem_hash,
     'rawReportSha256':accepted.sha_file(child/'stdout.json'),
     'metrics':metrics,'profileSha256':accepted.sha_file(child/'cpu.cpuprofile') if sampled else None}
   accepted.write_json(child/'admission.json',receipt)
   completed.append({'phase':phase,'arm':arm,'semanticSha256':sem_hash})
  compare_reports(reference['ordinary'],reference['dispatch'],QUALIFIED,media)
  historical_comparison=compare_historical(historical,reference['ordinary'],media,accepted)
  generated_only(qualified,derivative['generatedSha256'])
  fail(accepted.expected_source_inventory(qualified,QUALIFIED)==original_source,'qualified source changed')
  fail(admit_harness(harness,args.head)==harness_hashes,'harness changed')
  accepted.write_json(output/'result.json',{'schema':'bw.xv6-js-sampling.v1','result':'SEMANTIC_PASS',
    'scope':'six-child V8 diagnostic; no adoption timing or CPU cost share',
    'qualifiedHead':QUALIFIED,'harnessHead':args.head,'semanticSha256':sha256_json(baseline_semantic),
    'completedChildren':completed,'sampleSummaries':sample_summaries,
    'historicalComparison':historical_comparison,
    'hostAfter':accepted.host_metadata()})
  accepted.snapshot_inventory(output)
  accepted.snapshot_inventory(output.parent)
  print(json.dumps({'result':'SEMANTIC_PASS','children':len(completed),'profiles':len(sample_summaries)}))
 except BaseException as error:
  try:
   (output/'failure.json').write_text(json.dumps({'type':type(error).__name__,
      'message':str(error),'completedChildren':completed})+'\n')
  except Exception:pass
  try:
   from importlib import import_module
   sys.path.insert(0,str(args.qualified.resolve(strict=True)/'scripts/xv6-js-acceptance'))
   accepted_runner=import_module('run')
   accepted_runner.snapshot_inventory(output)
   accepted_runner.snapshot_inventory(output.parent)
  except Exception:pass
  raise

if __name__=='__main__':main()

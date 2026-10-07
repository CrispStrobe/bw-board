#!/usr/bin/env python3
"""Source-only original-packet and semantic comparison controls."""
import argparse,copy,hashlib,importlib.util,json,subprocess,sys,tempfile
from pathlib import Path

parser=argparse.ArgumentParser()
parser.add_argument('--qualified',type=Path,required=True)
parser.add_argument('--historical-zip',type=Path,required=True)
args=parser.parse_args()
qualified=args.qualified.resolve(strict=True)
sys.path.insert(0,str(qualified/'scripts/xv6-js-acceptance'))
import run as accepted
from policy import validate_report
here=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('sample_parent',here/'run.py')
parent=importlib.util.module_from_spec(spec);spec.loader.exec_module(parent)

inventory=accepted.expected_source_inventory(qualified,parent.QUALIFIED,verify_live=False)
old=parent.historical_reference(args.historical_zip.resolve(strict=True),accepted,inventory)
fresh=copy.deepcopy(old['projection'])
for field in ('image','slaveImage','rom'):
 fresh[field]['path']='/a/new/host/path'
same=parent.compare_historical(old,old['report'],old['binding']['mediaSha256'],accepted)
assert same['sourceHeadSame'] and same['mediaSame'] and same['semanticEqualIfSameMedia']
changed=copy.deepcopy(old);changed['projection']=fresh
same_path=parent.compare_historical(changed,old['report'],old['binding']['mediaSha256'],accepted)
assert same_path['semanticEqualIfSameMedia']
changed['projection']['steps']+=1
assert not parent.compare_historical(changed,old['report'],old['binding']['mediaSha256'],accepted)['semanticEqualIfSameMedia']
different_media=copy.deepcopy(old['binding']['mediaSha256']);different_media['image']='0'*64
other_report=copy.deepcopy(old['report']);other_report['image']['sha256']='0'*64
assert parent.compare_historical(old,other_report,different_media,accepted)['semanticEqualIfSameMedia'] is None
with tempfile.TemporaryDirectory() as directory:
 copy=Path(directory)/'wrong.zip';copy.write_bytes(args.historical_zip.read_bytes()+b'x')
 try: parent.historical_reference(copy,accepted,inventory)
 except ValueError: pass
 else: raise AssertionError('unbound original packet admitted')
print('run-control PASS: original packet/source, normalized hosted paths, media/mismatch bounds')

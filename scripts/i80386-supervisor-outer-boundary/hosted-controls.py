"""Hosted privileged fixed synthetic fixtures only; never invoke on other hosts."""
import hashlib,importlib.util,json,os
from pathlib import Path
HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location('hosted_outer',HERE/'boundary.py');b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
def write_raw(path,body):
 if type(body)is not bytes or len(body)>32768:raise b.Refusal('retention-cap')
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o644);primary=None
 try:
  offset=0
  while offset<len(body):
   count=os.write(fd,body[offset:])
   if type(count)is not int or count<=0 or count>len(body)-offset:raise b.Refusal('retention-write')
   offset+=count
 except BaseException as error:primary=error
 finally:
  try:os.close(fd)
  except BaseException as error:
   if primary is None:primary=error
 if primary is not None:raise primary
def main():
 if os.geteuid()!=0 or os.environ.get('GITHUB_ACTIONS')!='true':raise b.Refusal('hosted-only')
 destination=Path('outer-boundary-results');destination.mkdir(mode=0o755)
 for case in b.CASES:
  result=b.hosted_case(case)
  for role in ('stdout','stderr','diagnostic'):
   body=result.pop(role);write_raw(destination/(case+'.'+role),body);result[role+'Bytes']=len(body);result[role+'Sha256']=hashlib.sha256(body).hexdigest()
  encoded=(json.dumps(result,sort_keys=True)+'\n').encode();write_raw(destination/(case+'.json'),encoded)
  print(encoded.decode(),end='',flush=True)
  if not result['controlPassed']:raise SystemExit(1)
if __name__=='__main__':main()

"""Exact finite control-source admission only; never imports control producers."""
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import stat
import subprocess
import time

BASE = '9329da5b683563d85c6548f848a5f1f7141d5a6f'
FIXED = {'scripts/i80386-cwsdpmi-compile-root-routes/root-routes.py': '59f1a023b08b2e199dd8d464d47224f6beaeef972e281c0fb73ec68c31f78848', 'scripts/i80386-cwsdpmi-compile-root-routes/root-routes-control.py': '556a4cbfc79ec12ab2095383b0f7ed3a310389a57ac814bf5f346ffcc8cc4406', 'scripts/i80386-cwsdpmi-compile-root-routes/README.md': '89d50151ec9b696949507814d2c2b41f6fc64f21cf452d4603cb0a4be0586655', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/evidence-owner.py': 'af4550c1097289d31e569ad599c56e734fea2b2d4e99650ae4f617b43537b2a6', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/evidence-owner-control.py': '5be8652118c7eccde0706db3bc2e2a3d87ea67fbb4807c8efcdb751b3fe9fa2d', 'scripts/i80386-cwsdpmi-evidence-descriptor-writer/README.md': '2cec6c0a04849d5bc058f4eec96f6a4646b12f7ceb906d96be4fb3ef3a82cc48', 'scripts/i80386-cwsdpmi-workspace-creator/workspace.py': '1c6ac3af4db5eb49a9dbb3dc44140d8ef74b88112ce30f8f5b6b78401950a2f7', 'scripts/i80386-cwsdpmi-workspace-creator/workspace-control.py': '4d5ab1be1381a647c02b1725a1ba08c591b6d7a44d803dc0fceac390106f34ad', 'scripts/i80386-cwsdpmi-workspace-creator/README.md': 'd3ced6e366c5659b5f1ab30453f6ad87a2ecac576f24c4c749b23c2bfca2b10a', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/README.md': '57726203614a16f94ab2a9d2dcae5586e197cb11db5773b0663be32b711154f5', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/owner-control.py': '0bfbefb24989588038e5c13e6e2971b238a14238de54bd379be63e00945400a9', 'scripts/i80386-cwsdpmi-owned-workspace-evidence/owner.py': '103db42253d9ced7d9c7e617d83955879c9a7144bb124dcbb6520ac34de4579b', 'scripts/i80386-cwsdpmi-retained-tool-observer/README.md': '1adcc589304801cdf18382ac5fc9dc2dcab835a73de86e392c3c4a40f94c65fa', 'scripts/i80386-cwsdpmi-retained-tool-observer/observer-control.py': 'b5f8321520ba5d533a9581ff483caefc13915d2f1c79ca520339bda771c1b9ea', 'scripts/i80386-cwsdpmi-retained-tool-observer/observer.py': '53d295bca750edce8d2b3496498195c8f735528dd15bff6eba26127b55558312', 'scripts/i80386-cwsdpmi-retained-tool-materializer/materialize.py': 'da0dee52d70b47381f9673272411d5441530186d4f2c85fe18cf2e3d4063e08b', 'scripts/i80386-cwsdpmi-retained-tool-materializer/materialize-control.py': '31abd734fa8b4278af8aa69f4e9e29afb7330814fcfb766212d5583e7a0f806e', 'scripts/i80386-cwsdpmi-retained-tool-materializer/README.md': '80a6946c618cabdeb75d39855d47c704386228a0bed728f80573250db775e9fb', 'scripts/i80386-cwsdpmi-fixed-alias-materializer/materialize.py': '7a687a916d65fd6614bb3a3676d2ca32c7f2a375deabc8d690f2ad1bb2e2ccf6', 'scripts/i80386-cwsdpmi-fixed-alias-materializer/materialize-control.py': '4b11c45b7a81e68d309ebf78c232a614e7518adbeac4ebfec913f0f08f64f25e', 'scripts/i80386-cwsdpmi-fixed-alias-materializer/README.md': '6b84e12fed4912b644dbdb23ad7b7eea7df989f1c7ba7a75acbcf3571ee305be', 'scripts/i80386-cwsdpmi-fixed-archive-materialization/run.py': 'c686e8255cab401bc6b7d67ebf0878b1b2f2084111fae78fbc5b2d2b8cf2b978', 'scripts/i80386-cwsdpmi-fixed-archive-materialization/run-control.py': '5869bb85015ee99826469cd2c4ae30d654e5071e32ebfd86ee1b26fd7d637799', 'scripts/i80386-cwsdpmi-fixed-archive-materialization/README.md': 'f86e78b1a00ac5b05b0b7848ba0c58f9012077b5005cb0d6e3e0fd07194a46a3', 'scripts/i80386-cwsdpmi-compile-tool-boundary/compile.py': '2a1a3e84a4244100a8f0fe5c8d806d46721425970e4b65b516fdf58fed67b31a', 'scripts/i80386-fixed-archive-acquisition/acquire.py': '7a7a104177c565b6f119ce69d2278eddc4f17be2be00ff59297ff3b803ce4ff2', 'scripts/i80386-fixed-archive-acquisition/acquire-control.py': '05f85abdd5bcf49880756f25cacb84f2b7b3deceb57eca851897bf4dee142ab0', 'scripts/i80386-fixed-archive-acquisition/README.md': '1b7ed2249406c21357ae97103eff22ac95d176cfc4fa0ead3c497953d86082bc'}
PROFILE = ('scripts/i80386-fixed-archive-materialization-hosted/admit.py', 'scripts/i80386-fixed-archive-materialization-hosted/execute.py', 'scripts/i80386-fixed-archive-materialization-hosted/README.md', '.github/workflows/i80386-fixed-archive-materialization.yml')
MAX_SOURCE = 65536

class Refusal(ValueError):
    pass

def need(ok):
    if not ok:
        raise Refusal('source-admission-refused')

def git(args):
    proc = subprocess.Popen(['git', '--no-replace-objects', *args], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    output = bytearray()
    selector = selectors.DefaultSelector()
    try:
        os.set_blocking(proc.stdout.fileno(), False)
        selector.register(proc.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + 10
        while selector.get_map():
            need(time.monotonic() <= deadline)
            for key, unused in selector.select(0.05):
                block = os.read(key.fileobj.fileno(), 65536)
                if not block:
                    selector.unregister(key.fileobj)
                else:
                    need(len(output) + len(block) <= 1 << 20)
                    output.extend(block)
        need(proc.wait(timeout=1) == 0)
        return bytes(output)
    finally:
        selector.close()
        proc.stdout.close()
        if proc.poll() is None:
            proc.kill()
        proc.wait(timeout=2)

def live(path):
    prior = os.lstat(path)
    need(stat.S_ISREG(prior.st_mode) and prior.st_nlink == 1 and prior.st_size <= MAX_SOURCE)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
        need(identity(prior) == identity(opened))
        raw = bytearray()
        while len(raw) <= MAX_SOURCE:
            block = os.read(fd, min(65536, MAX_SOURCE + 1 - len(raw)))
            if not block:
                break
            raw.extend(block)
        need(len(raw) <= MAX_SOURCE and len(raw) == opened.st_size)
        need(identity(opened) == identity(os.fstat(fd)) == identity(os.lstat(path)))
        return bytes(raw)
    finally:
        os.close(fd)

OUT = 'fixed-archive-materialization'
LABEL = 'x86-fixed-archive-materialization'
def pairs(rows):
    result={}
    for key,value in rows:
        need(key not in result);result[key]=value
    return result

def encode(row,cap):
    raw=(json.dumps(row,sort_keys=True,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
    need(len(raw)<=cap);return raw

def write(name,raw):
    fd=os.open(OUT+'/'+name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
    try:
        count=0
        while count<len(raw):
            n=os.write(fd,raw[count:]);need(0<n<=len(raw)-count);count+=n
    finally:os.close(fd)

def event(head,mode):
    path=os.environ.get('GITHUB_EVENT_PATH');need(type(path)is str and 0<len(path)<=4096)
    raw=live(path);need(len(raw)<=65536)
    row=json.loads(raw,object_pairs_hook=pairs,parse_constant=lambda unused:need(False))
    need(type(row)is dict and type(row.get('pull_request'))is dict)
    pr=row['pull_request'];action=row.get('action');number=row.get('number')
    need(type(number)is int and 0<number<2**53 and pr.get('number')==number and type(pr.get('number'))is int)
    need(type(action)is str and action in ('opened','synchronize','reopened','labeled'))
    def repo(node):
        need(type(node)is dict and type(node.get('repo'))is dict)
        name=node['repo'].get('full_name');need(type(name)is str and name=='CrispStrobe/bw-board');return name
    need(type(pr.get('head'))is dict and pr['head'].get('sha')==head and type(pr['head'].get('sha'))is str)
    headrepo=repo(pr['head']);baserepo=repo(pr.get('base'))
    label=None
    if mode=='controls':need(action in ('opened','synchronize','reopened'))
    else:
        need(action=='labeled' and type(row.get('label'))is dict)
        label=row['label'].get('name');need(type(label)is str and label==LABEL)
    run=os.environ.get('GITHUB_RUN_ID');need(type(run)is str and re.fullmatch('[1-9][0-9]{0,19}',run)is not None)
    need(int(run)<2**64)
    return {'schema':'bw.fixed-archive-event.v1','action':action,'pr':number,'head':head,'headRepository':headrepo,'baseRepository':baserepo,'repository':'CrispStrobe/bw-board','run':int(run),'attempt':1,'label':label}

def admit(mode):
    need(mode in ('controls','actual-before','actual-after'))
    head=os.environ.get('EXPECTED_HEAD')
    need(type(head)is str and re.fullmatch('[0-9a-f]{40}',head)is not None)
    need(os.environ.get('GITHUB_RUN_ATTEMPT')=='1' and os.environ.get('GITHUB_EVENT_NAME')=='pull_request')
    need(os.environ.get('GITHUB_REPOSITORY')=='CrispStrobe/bw-board' and os.environ.get('PR_HEAD_REPOSITORY')=='CrispStrobe/bw-board')
    context=event(head,mode)
    need(git(['rev-parse','HEAD']).decode('ascii').strip()==head)
    git(['merge-base','--is-ancestor',BASE,head])
    changed=git(['diff','--name-only','-z',BASE,head]).decode('utf-8').split('\0');need(changed[-1]=='');changed=changed[:-1]
    need(len(changed)==len(set(changed)) and set(changed)<=set(PROFILE)|{'LANES.md'})
    roles={}
    for path in (*FIXED,*PROFILE):
        committed=git(['show',head+':'+path]);need(len(committed)<=MAX_SOURCE)
        digest=hashlib.sha256(committed).hexdigest();need(path not in FIXED or digest==FIXED[path]);need(live(path)==committed);roles[path]=digest
    report={'schema':'bw.fixed-archive-hosted-source.v1','head':head,'base':BASE,'fixedRoles':28,'roles':roles,'event':context,'mode':mode,'qualification':'SOURCE_ADMISSION_ONLY_NO_RUNTIME_AUTHORITY'}
    if mode=='actual-after':
        prior=json.loads(live(OUT+'/source-before.json'),object_pairs_hook=pairs)
        need(type(prior)is dict and set(prior)==set(report) and prior.get('schema')==report['schema'] and prior.get('base')==BASE and type(prior.get('fixedRoles'))is int and prior['fixedRoles']==28 and prior.get('qualification')==report['qualification'])
        need(prior.get('roles')==roles and prior.get('head')==head and prior.get('mode')=='actual-before' and encode(prior.get('event'),4096)==encode(context,4096))
        saved=json.loads(live(OUT+'/event.json'),object_pairs_hook=pairs);need(encode(saved,4096)==encode(context,4096))
        write('source-after.json',encode(report,32768))
    else:
        write('event.json',encode(context,4096));write('source-before.json',encode(report,32768))

if __name__=='__main__':
    import sys
    try:
        need(len(sys.argv)==2);admit(sys.argv[1])
    except BaseException:
        print('source-admission-refused');raise SystemExit(1) from None

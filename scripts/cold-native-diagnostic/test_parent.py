import copy
import json
from pathlib import Path
import unittest
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from setup import checkout
from archive import digest
from parent import validate_contract,main,bounded,ArtifactRedirect,https_origin
from resources import memory_events,memory_delta
class Controls(unittest.TestCase):
    def test_both_checkout_roles_follow_validated_contract(self):
        c=json.loads((Path(__file__).parent/'contract.json').read_text());validate_contract(c)
        workflow=(Path(__file__).resolve().parents[2]/'.github/workflows/i80386-cold-native-diagnostic.yml').read_text()
        self.assertIn("compiled='+c['compiledRevision']",workflow)
        self.assertIn("driver='+c['driverRevision']",workflow)
        self.assertIn('ref: ${{ steps.pins.outputs.compiled }}\n          path: publication',workflow)
        self.assertIn('ref: ${{ steps.pins.outputs.driver }}\n          path: driver',workflow)
        self.assertNotIn('ref: a6fae61',workflow)
    def test_setup_current_git_maps_reject_wrong_head_and_missing_input(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)/'role';root.mkdir()
            def git(*args):
                return subprocess.check_output(['git','-C',str(root),*args],stderr=subprocess.PIPE,env={**os.environ,'GIT_AUTHOR_NAME':'Fixture','GIT_AUTHOR_EMAIL':'fixture@example.invalid','GIT_COMMITTER_NAME':'Fixture','GIT_COMMITTER_EMAIL':'fixture@example.invalid'}).decode().strip()
            git('init','--quiet');(root/'input').write_bytes(b'fixed source\n');git('add','input');git('commit','--quiet','-m','first');first=git('rev-parse','HEAD')
            records={'input':{'bytes':13,'sha256':digest(b'fixed source\n')}}
            checkout(root,first,records)
            git('commit','--allow-empty','--quiet','-m','different identity')
            with self.assertRaises(ValueError):checkout(root,first,records)
            current=git('rev-parse','HEAD');checkout(root,current,records)
            (root/'input').unlink()
            with self.assertRaises(ValueError):checkout(root,current,records)
    def test_disabled_never_downloads(self):main('disabled')
    def test_unfrozen_contract_refuses(self):
        c=json.loads((Path(__file__).parent/'contract.json').read_text())
        c['driverRevision']=None
        with self.assertRaises(ValueError):validate_contract(c)
    def test_nested_session_timeout_cleanup(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d);pid=out/'nested.pid'
            code="import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-S','-c','import time; time.sleep(60)'],start_new_session=True);open(sys.argv[1],'w').write(str(p.pid));time.sleep(60)"
            r=bounded([sys.executable,'-B','-S','-c',code,str(pid)],out,out,'synthetic-timeout',cpu=2,wall=3,file_bytes=1<<20)
            print(json.dumps({'syntheticTimeout':r,'nestedPidPresent':pid.exists(),'childStderr':(out/'synthetic-timeout.stderr').read_text()}))
            self.assertTrue(r['timedOut']);self.assertIn(int(pid.read_text()),r['terminatedPids'])
            path=Path('/proc')/pid.read_text()/'stat'
            if path.exists():self.assertEqual(path.read_text().split(') ')[1].split()[0],'Z')
    def test_redirect_credentials_and_https(self):
        req=urllib.request.Request('https://api.github.com/original',headers={'Authorization':'Bearer SYNTHETIC_NOT_A_CREDENTIAL','Accept':'application/octet-stream'})
        handler=ArtifactRedirect()
        foreign=handler.redirect_request(req,None,302,'redirect',{},'https://storage.example.invalid/signed')
        self.assertIsNone(foreign.get_header('Authorization'));self.assertEqual(foreign.get_header('Accept'),'application/octet-stream')
        same=handler.redirect_request(req,None,302,'redirect',{},'https://api.github.com:443/other')
        self.assertEqual(same.get_header('Authorization'),'Bearer SYNTHETIC_NOT_A_CREDENTIAL')
        other_port=handler.redirect_request(req,None,302,'redirect',{},'https://api.github.com:8443/other')
        self.assertIsNone(other_port.get_header('Authorization'))
        for url in ('https://api.github.com:0/file','http://storage.example.invalid/file','file:///tmp/blob','https://user:password@storage.example.invalid/file'):
            with self.assertRaises(ValueError):handler.redirect_request(req,None,302,'redirect',{},url)
        self.assertEqual(req.get_header('Authorization'),'Bearer SYNTHETIC_NOT_A_CREDENTIAL')
    def test_fixed_artifact_and_mode(self):
        c=json.loads((Path(__file__).parent/'contract.json').read_text())
        c.update(driverRevision='1'*40,driverSourceIdentitySha256='2'*64,driverAuthSha256='3'*64,driverFiles={c['driverAuth']:{'sha256':'3'*64,'bytes':1},c['runner']:{'sha256':'4'*64,'bytes':1}})
        validate_contract(c)
        for key,value in [('artifactId',1),('compiledRevision','f'*40),('zipSha256','0'*64),('nativeTrace',True),('guestEnabledByDefault',True),('driverAuthSha256',None)]:
            bad=copy.deepcopy(c);bad[key]=value
            with self.assertRaises(ValueError):validate_contract(bad)
    def test_wait4_records_real_child_resources_and_cpu_signal(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d)
            finite=bounded([sys.executable,'-S','-c','sum(i*i for i in range(100000))'],out,out,'finite',cpu=2,wall=5,file_bytes=1<<20)
            self.assertEqual(finite['returncode'],0);self.assertFalse(finite['timedOut']);self.assertGreater(finite['wait4']['userSeconds']+finite['wait4']['systemSeconds'],0);self.assertGreater(finite['wait4']['maxRssKiB'],0)
            cpu=bounded([sys.executable,'-S','-c','while True: pass'],out,out,'cpu-stop',cpu=1,cpu_hard=2,wall=5,file_bytes=1<<20)
            self.assertEqual(cpu['returncode'],-24);self.assertFalse(cpu['timedOut']);self.assertGreaterEqual(cpu['wait4']['userSeconds']+cpu['wait4']['systemSeconds'],.9)
    def test_memory_event_domains_and_deltas_are_explicit(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'memory.events';p.write_text('low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\n');before=memory_events(p);self.assertTrue(before['available']);p.write_text('low 0\nhigh 0\nmax 1\noom 1\noom_kill 1\n');after=memory_events(p);delta=memory_delta(before,after);self.assertEqual(delta['events']['oom_kill'],1);self.assertFalse(memory_delta(after,before)['available']);self.assertFalse(memory_events(Path(d)/'missing')['available']);p.write_text('oom 1\n');self.assertFalse(memory_events(p)['available'])
if __name__=='__main__':unittest.main()

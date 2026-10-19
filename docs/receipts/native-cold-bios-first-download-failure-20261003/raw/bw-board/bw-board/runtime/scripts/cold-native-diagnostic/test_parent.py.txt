import copy
import json
from pathlib import Path
import unittest
import os
import subprocess
import sys
import tempfile
import time
from parent import validate_contract,main,bounded
class Controls(unittest.TestCase):
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
    def test_fixed_artifact_and_mode(self):
        c=json.loads((Path(__file__).parent/'contract.json').read_text())
        c.update(driverRevision='1'*40,driverSourceIdentitySha256='2'*64,driverAuthSha256='3'*64,driverFiles={c['driverAuth']:{'sha256':'3'*64,'bytes':1},c['runner']:{'sha256':'4'*64,'bytes':1}})
        validate_contract(c)
        for key,value in [('artifactId',1),('compiledRevision','f'*40),('zipSha256','0'*64),('nativeTrace',True),('guestEnabledByDefault',True),('driverAuthSha256',None)]:
            bad=copy.deepcopy(c);bad[key]=value
            with self.assertRaises(ValueError):validate_contract(bad)
if __name__=='__main__':unittest.main()

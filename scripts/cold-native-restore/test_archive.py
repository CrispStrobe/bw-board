import io
from pathlib import Path
import tarfile
import tempfile
import subprocess
import os
import json
import unittest
import zipfile
from admission import disjoint_roles, driver_identity, evidence_equal
from archive import digest, exclusive_tree, tar_members, zip_members

def record(b): return {'bytes': len(b), 'sha256': digest(b)}

def tar(entries):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w:gz') as a:
        for n, kind in entries:
            e = tarfile.TarInfo(n); e.type = kind
            if kind == tarfile.REGTYPE:
                e.size = 1; a.addfile(e, io.BytesIO(b'x'))
            else: e.linkname = 'outside'; a.addfile(e)
    return out.getvalue()

class Controls(unittest.TestCase):
    def test_empty_git_metadata_directories(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); original=root/'original'
            subprocess.run(['git','init','--quiet',str(original)],check=True)
            def git(*args, data=None):
                return subprocess.run(['git','-C',str(original),*args],input=data,capture_output=True,check=True,env={**os.environ,'GIT_AUTHOR_NAME':'Fixture','GIT_AUTHOR_EMAIL':'fixture@example.invalid','GIT_COMMITTER_NAME':'Fixture','GIT_COMMITTER_EMAIL':'fixture@example.invalid','GIT_AUTHOR_DATE':'2000-01-01T00:00:00Z','GIT_COMMITTER_DATE':'2000-01-01T00:00:00Z'}).stdout.strip()
            blob=git('hash-object','-w','--stdin',data=b'pinned object\n')
            tree=git('mktree',data=b'100644 blob '+blob+b'\twitness\n')
            head=git('commit-tree',tree.decode(),data=b'detached fixture\n')
            (original/'.git/HEAD').write_bytes(head+b'\n')
            metadata=original/'.git'
            files={str(p.relative_to(metadata)):p.read_bytes() for p in metadata.rglob('*') if p.is_file()}
            directories=[str(p.relative_to(metadata)) for p in metadata.rglob('*') if p.is_dir()]
            self.assertIn('refs',directories)
            broken=root/'broken'; broken.mkdir(); exclusive_tree(broken/'.git',files)
            self.assertNotEqual(subprocess.run(['git','-C',str(broken),'rev-parse','--git-dir'],capture_output=True).returncode,0)
            restored=root/'restored'; restored.mkdir(); exclusive_tree(restored/'.git',files,directories)
            result=subprocess.run(['git','-C',str(restored),'rev-parse','--git-dir'],capture_output=True)
            self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(subprocess.check_output(['git','-C',str(restored),'rev-parse','HEAD']).strip(),head)
            self.assertEqual(subprocess.check_output(['git','-C',str(restored),'show','HEAD:witness']),b'pinned object\n')
            if os.environ.get('BW_METADATA_CONTROL_RECEIPT'):
                Path(os.environ['BW_METADATA_CONTROL_RECEIPT']).write_text(json.dumps({'directories':sorted(directories),'files':{n:record(b) for n,b in sorted(files.items())},'head':head.decode(),'blob':blob.decode(),'fileOnlyRecognized':False,'directoryPreservingHeadAndObjectRead':True},indent=2)+'\n')
            self.assertEqual({str(p.relative_to(restored/'.git')):p.read_bytes() for p in (restored/'.git').rglob('*') if p.is_file()},files)
            with self.assertRaises(ValueError): exclusive_tree(root/'bad',files,['../escape'])
    def test_tar_admission(self):
        expected = {'a': record(b'x')}
        self.assertEqual(tar_members(tar([('a', tarfile.REGTYPE)]), expected), {'a': b'x'})
        for entries in [[('../a',tarfile.REGTYPE)], [('a',tarfile.SYMTYPE)], [('a',tarfile.LNKTYPE)], [('a',tarfile.REGTYPE),('a',tarfile.REGTYPE)]]:
            with self.assertRaises(ValueError): tar_members(tar(entries), expected)
        with self.assertRaises(ValueError): tar_members(tar([('a',tarfile.REGTYPE)]), {'a':record(b'y')})
    def test_zip_digest_and_members(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a.zip'
            with zipfile.ZipFile(p,'w') as z: z.writestr('a',b'x')
            raw=p.read_bytes(); expected={'a':record(b'x')}
            self.assertEqual(zip_members(p,expected,digest(raw),len(raw)),{'a':b'x'})
            with self.assertRaises(ValueError): zip_members(p,expected,'0'*64,len(raw))
            with self.assertRaises(ValueError): zip_members(p,{},digest(raw),len(raw))
    def test_incomplete_driver_and_changed_evidence(self):
        files={'auth.mjs':record(b'a'),'runner.mjs':record(b'r')}
        actual={'revision':'1'*40,'hashes':{k:v['sha256'] for k,v in files.items()}}
        driver_identity(actual,'1'*40,files)
        with self.assertRaises(ValueError): driver_identity(actual,'1'*40,{'auth.mjs':files['auth.mjs']})
        with self.assertRaises(ValueError): evidence_equal({'prepare.json':b'changed'},{'prepare.json':b'original'})
    def test_role_overlap(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError): disjoint_roles([d,str(Path(d)/'inside')])
            with self.assertRaises(ValueError): disjoint_roles(['relative',str(Path(d)/'other')])
    def test_existing_and_dangling_roles(self):
        with tempfile.TemporaryDirectory() as d:
            t=Path(d)/'target'; t.symlink_to(Path(d)/'missing')
            with self.assertRaises(ValueError): exclusive_tree(t,{'a':b'x'})
            t.unlink(); exclusive_tree(t,{'a':b'x'}); self.assertEqual((t/'a').read_bytes(),b'x')
            with self.assertRaises(ValueError): exclusive_tree(t,{'a':b'y'})
            self.assertEqual((t/'a').read_bytes(),b'x')

if __name__ == '__main__': unittest.main()

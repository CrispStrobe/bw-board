import io
from pathlib import Path
import tarfile
import tempfile
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

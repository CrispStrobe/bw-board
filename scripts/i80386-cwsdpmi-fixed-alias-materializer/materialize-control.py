"""Manufactured archives/filesystems only; never fetch or execute tools."""
import bz2
from contextlib import ExitStack
import hashlib
import importlib.util
import io
import json
import os
import stat
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('manufactured_fixed_alias',Path(__file__).with_name('materialize.py'))
alias=importlib.util.module_from_spec(spec);spec.loader.exec_module(alias)
m=alias.base
UNIT_CLASS=alias.FixedAliasMaterializer
PATHS={role:path for role,(path,digest) in m.SELECTED.items()}
DATA={role:('manufactured-'+role).encode() for role in PATHS}
PINS={role:(path,m.sha(DATA[role])) for role,path in PATHS.items()}
TARGET_DATA={target:next((DATA[r] for r in PATHS if PATHS[r]==target),('manufactured-target-'+str(i)).encode()) for i,target in enumerate(alias.TARGETS)}
TARGET_PINS={target:(len(raw),m.sha(raw)) for target,raw in TARGET_DATA.items()}
ORIGINS={'include/dpmi.h':'dpmi.h','include/sys/farptr.h':'farptr.h','lib/crt0.o':'crt0.o','lib/libc.a':'libc.a'}

def default_entries():
    return [(PATHS[r],DATA[r],tarfile.REGTYPE) for r in PATHS]+[(target,raw,tarfile.REGTYPE) for target,raw in TARGET_DATA.items() if target not in PATHS.values()]+[(name,b'',tarfile.LNKTYPE,target) for name,target in alias.ALIASES.items()]

def tar(entries=None):
    output=io.BytesIO()
    with tarfile.open(fileobj=output,mode='w',format=tarfile.USTAR_FORMAT) as archive:
        for entry in default_entries() if entries is None else entries:
            name,data,kind=entry[:3]
            row=tarfile.TarInfo(name);row.type=kind;row.linkname=entry[3] if len(entry)==4 else ''; row.mode=0o755;row.size=len(data) if kind==tarfile.REGTYPE else 0
            archive.addfile(row,io.BytesIO(data) if row.size else None)
    return bz2.compress(output.getvalue())

def z(entries):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as archive:
        for name,data in entries:archive.writestr(name,data)
    return output.getvalue()

def sources():return (z([(n,DATA[r]) for n,r in ORIGINS.items()]),z([('COPYING',b'fixture notice\f\n')]),z([('COPYING',b'fixture notice\n')]))

class Controls(unittest.TestCase):
    def run_fixture(self,tool=None,src=None,callback=None):
        tool=tar() if tool is None else tool;src=sources() if src is None else src
        source={name:(len(raw),m.sha(raw)) for name,raw in zip(m.SOURCE,src)}
        with tempfile.TemporaryDirectory() as parent, ExitStack() as stack:
            for target,attr,value in ((m,'TOOL_BYTES',len(tool)),(m,'TOOL_SHA',m.sha(tool)),(m,'SOURCE',source),(m,'SELECTED',PINS),(m.observer_module,'SELECTED',PINS),(alias,'TARGETS',TARGET_PINS)):
                stack.enter_context(patch.object(target,attr,value))
            owner=UNIT_CLASS(parent)
            try:
                if callback:return callback(owner,(tool,*src))
                return owner.materialize(tool,*src)
            finally:owner.close()
    def test_complete_synthetic_nine(self):
        status=self.run_fixture();self.assertEqual(status['writtenRoles'],list(PINS));self.assertEqual(status['runtimeOriginJoins'],4)
        self.assertTrue(status['cleanupQualified']);self.assertEqual(status['observer']['observationAttempts'],2)
        self.assertFalse(status['fullToolchainReady']);self.assertFalse(status['compilerQualified']);json.dumps(status)
    def test_all_auth_before_prepare(self):
        def cb(o,args):
            for index in range(4):
                current=o if index==0 else UNIT_CLASS(o._observer._owner._parent)
                bad=list(args);bad[index]=bad[index]+b'!'
                with patch.object(current._observer,'prepare') as prepare,patch.object(current,'_tar') as parser:
                    with self.assertRaises(m.Refusal):current.materialize(*bad)
                    prepare.assert_not_called();parser.assert_not_called()
                current.close()
        self.run_fixture(callback=cb)
    def test_wrong_source_hash_auth_no_parser(self):
        def cb(o,args):
            bad=list(args);bad[2]=bytes([args[2][0]^1])+args[2][1:]
            with patch.object(o,'_tar') as parser:
                with self.assertRaisesRegex(m.Refusal,'input-refused'):o.materialize(*bad)
                parser.assert_not_called()
        self.run_fixture(callback=cb)
    def test_bad_paths(self):
        for name in ('../bad','/bad','foo//','foo/c:bad','foo\\bad'):
            with self.subTest(name=name),self.assertRaises(m.Refusal):self.run_fixture(tar([(name,b'x',tarfile.REGTYPE)]))
    def test_parent_conflicts_both_orders(self):
        for rows in ([('foo',b'x',tarfile.REGTYPE),('foo/bar',b'x',tarfile.REGTYPE)],[('foo/bar',b'x',tarfile.REGTYPE),('foo',b'x',tarfile.REGTYPE)]):
            with self.assertRaisesRegex(m.Refusal,'archive-path'):self.run_fixture(tar(rows))
    def test_duplicates_and_special_types(self):
        for rows in ([('foo',b'x',tarfile.REGTYPE),('./foo',b'x',tarfile.REGTYPE)], [('foo',b'',tarfile.SYMTYPE)], [('foo',b'',tarfile.LNKTYPE)], [('foo',b'',tarfile.FIFOTYPE)]):
            with self.assertRaises(m.Refusal):self.run_fixture(tar(rows))
    def test_missing_and_wrong_selected(self):
        rows=[(PATHS[r],DATA[r],tarfile.REGTYPE) for r in PATHS]
        for bad in (rows[:-1],[(n,b'wrong' if i==0 else d,k) for i,(n,d,k) in enumerate(rows)]):
            with self.assertRaisesRegex(m.Refusal,'selected-refused|archive-type'):self.run_fixture(tar(bad))
    def test_concatenated_and_truncated(self):
        raw=tar()
        for bad in (raw+bz2.compress(b'zeros'),raw[:-3]):
            with self.assertRaises(m.Refusal):self.run_fixture(bad)
    def test_decoded_headers_padding_tail_cap(self):
        raw=tar();decoded=len(bz2.decompress(raw))
        with patch.object(m,'MAX_DECODED',decoded-1),self.assertRaisesRegex(m.Refusal,'archive-cap'):self.run_fixture(raw)
    def test_selected_reserved_before_content(self):
        with patch.object(m,'MAX_SELECTED',1),self.assertRaisesRegex(m.Refusal,'selected-refused'):self.run_fixture()
    def test_zip_duplicates_parent_conflicts(self):
        for rows in ([('foo',b'x'),('./foo',b'x')],[('foo/bar',b'x'),('foo',b'x')]):
            src=list(sources());src[1]=z(rows)
            with self.assertRaises(m.Refusal):self.run_fixture(src=src)
    def test_source_origin_join(self):
        src=list(sources());src[0]=z([(name,b'wrong' if i==0 else DATA[r]) for i,(name,r) in enumerate(ORIGINS.items())])
        with self.assertRaisesRegex(m.Refusal,'source-origin-refused'):self.run_fixture(src=src)
    def test_notice_omission_and_no_raw_text(self):
        src=list(sources());src[1]=z([('COPYING3',b'x'*(m.MAX_NOTICE+1))])
        status=self.run_fixture(src=src);self.assertEqual(status['noticeOmitted'],1);self.assertNotIn('fixture notice',json.dumps(status))
    def test_consumed_no_retry(self):
        def cb(o,args):
            with self.assertRaises(m.Refusal):o.materialize(args[0]+b'!',*args[1:])
            with patch.object(o,'_tar') as parser,patch.object(o._observer,'prepare') as prepare:
                with self.assertRaises(m.Refusal):o.materialize(*args)
                parser.assert_not_called();prepare.assert_not_called()
        self.run_fixture(callback=cb)
    def test_zero_write_original_error_and_cleanup(self):
        error=OSError('manufactured')
        def cb(o,args):
            with patch.object(m.os,'write',side_effect=error):
                with self.assertRaises(OSError) as raised:o.materialize(*args)
            self.assertIs(raised.exception,error);self.assertEqual(o.status()['firstFailure'],'filesystem-refusal');self.assertTrue(o.status()['cleanupQualified'])
        self.run_fixture(callback=cb)
    def test_reentry_mkdir_stops(self):
        def cb(o,args):
            real=m.os.mkdir;calls=[]
            def mkdir(*a,**k):
                calls.append(a);result=real(*a,**k)
                try:o.status()
                except m.Refusal:pass
                return result
            with patch.object(m.os,'mkdir',side_effect=mkdir):
                with self.assertRaises(ValueError):o.materialize(*args)
            self.assertEqual(len(calls),1);self.assertEqual(o.status()['firstFailure'],'materializer-reentry');self.assertEqual(o.status()['writtenRoles'],[])
        self.run_fixture(callback=cb)
    def test_reentry_pread_stops(self):
        def cb(o,args):
            real=m.os.pread;calls=[]
            def pread(*a):
                calls.append(a);result=real(*a)
                try:o.status()
                except m.Refusal:pass
                return result
            with patch.object(m.os,'pread',side_effect=pread):
                with self.assertRaises(ValueError):o.materialize(*args)
            self.assertEqual(len(calls),1);self.assertEqual(o.status()['firstFailure'],'materializer-reentry')
        self.run_fixture(callback=cb)
    def test_auth_swallowed_reentry_no_parser(self):
        def cb(o,args):
            real=m.sha;calls=[]
            def digest(raw):
                calls.append(raw)
                try:o.status()
                except m.Refusal:pass
                return real(raw)
            with patch.object(m,'sha',side_effect=digest),patch.object(o,'_tar') as parser,patch.object(o._observer,'prepare') as prepare:
                with self.assertRaises(m.Refusal):o.materialize(*args)
                parser.assert_not_called();prepare.assert_not_called()
            self.assertEqual(len(calls),1)
        self.run_fixture(callback=cb)
    def test_zip_mode_and_directory_coherence(self):
        output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as archive:
            row=zipfile.ZipInfo('ordinary');row.external_attr=(0o040700<<16);archive.writestr(row,b'x')
        src=list(sources());src[1]=output.getvalue()
        with self.assertRaisesRegex(m.Refusal,'archive-type'):self.run_fixture(src=src)
    def test_zip_trailing_stream_and_caps(self):
        src=list(sources());src[1]+=b'junk'
        with self.assertRaisesRegex(m.Refusal,'archive-refused'):self.run_fixture(src=src)
        with patch.object(m,'MAX_MEMBERS',1),self.assertRaisesRegex(m.Refusal,'archive-cap'):self.run_fixture()
        with patch.object(m,'MAX_FILE',1),self.assertRaisesRegex(m.Refusal,'archive-cap'):self.run_fixture()
    def test_changed_readback_same_extent(self):
        def cb(o,args):
            real=m.os.pread
            def pread(fd,length,offset):
                raw=real(fd,length,offset)
                return bytes([raw[0]^1])+raw[1:] if raw else raw
            with patch.object(m.os,'pread',side_effect=pread):
                with self.assertRaisesRegex(m.Refusal,'output-refused'):o.materialize(*args)
            self.assertEqual(o.status()['writtenRoles'],[])
        self.run_fixture(callback=cb)
    def test_original_write_error_before_close_uncertainty(self):
        original=OSError('manufactured write');real_close=os.close;fds=[]
        def cb(o,args):
            def close(fd):
                fds.append(fd);raise OSError('manufactured close')
            with patch.object(m.os,'write',side_effect=original),patch.object(m.os,'close',side_effect=close):
                with self.assertRaises(OSError) as raised:o.materialize(*args)
            self.assertIs(raised.exception,original)
            status=o.status();self.assertEqual(status['firstFailure'],'filesystem-refusal');self.assertFalse(status['cleanupQualified'])
        try:self.run_fixture(callback=cb)
        finally:
            for fd in set(fds):
                try:real_close(fd)
                except OSError:pass
    def test_nested_writer_cleanup_uncertainty(self):
        def cb(o,args):
            original=o._observer.terminal;real_close=os.close;uncertain=[]
            def terminal(phase):
                def close(fd):
                    if stat.S_ISREG(os.fstat(fd).st_mode):
                        uncertain.append(fd);raise OSError('manufactured output close')
                    return real_close(fd)
                with patch.object(m.os,'close',side_effect=close):return original(phase)
            try:
                with patch.object(o._observer,'terminal',side_effect=terminal):
                    with self.assertRaises(ValueError):o.materialize(*args)
                self.assertFalse(o.status()['cleanupQualified']);self.assertGreater(o.status()['observer']['workspace']['writer']['closeRefused'],0)
            finally:
                for fd in uncertain:
                    try:real_close(fd)
                    except OSError:pass
        self.run_fixture(callback=cb)
    def test_selected_reservation_before_body_read(self):
        reads=[];real=m._BZ2Reader.exact
        def exact(reader,n):reads.append(n);return real(reader,n)
        with patch.object(m,'MAX_ROLE',1),patch.object(m._BZ2Reader,'exact',exact):
            with self.assertRaisesRegex(m.Refusal,'selected-refused'):self.run_fixture()
        self.assertEqual(reads,[512])
    def test_no_output_eof_still_checks_trailing(self):
        class Decoder:
            eof=False;needs_input=True;unused_data=b''
            def decompress(self,raw,max_length):
                self.eof=True;self.unused_data=b'trailing';return b''
        with patch.object(m.bz2,'BZ2Decompressor',Decoder):
            with self.assertRaisesRegex(m.Refusal,'archive-refused'):m._BZ2Reader(b'fixture').read(1)
    def test_zip_eocd_count_mismatch(self):
        src=list(sources());raw=bytearray(src[1]);raw[-14:-10]=b'\x00\x00\x00\x00';src[1]=bytes(raw)
        with self.assertRaisesRegex(m.Refusal,'archive-cap'):self.run_fixture(src=src)
    def test_directory_payload_refused(self):
        src=list(sources());src[1]=z([('ordinary/',b'x')])
        with self.assertRaisesRegex(m.Refusal,'archive-type'):self.run_fixture(src=src)
    def test_directory_local_header_name_checked(self):
        src=list(sources());raw=bytearray(z([('ordinary/',b'')]))
        raw[30]=ord('X');src[1]=bytes(raw)
        with self.assertRaises(zipfile.BadZipFile):self.run_fixture(src=src)
    def test_zero_length_zip_open_swallowed_reentry_no_read(self):
        src=list(sources());src[1]=z([('ordinary',b'')])
        def cb(o,args):
            original=zipfile.ZipFile.open;reads=[]
            class Stream:
                def __init__(self,inner):self.inner=inner
                def __enter__(self):return self
                def __exit__(self,*args):self.inner.close()
                def read(self,n):reads.append(n);return self.inner.read(n)
            def opened(archive,row,*a,**kw):
                stream=original(archive,row,*a,**kw)
                if row.filename=='ordinary':
                    try:o.status()
                    except m.Refusal:pass
                    return Stream(stream)
                return stream
            with patch.object(zipfile.ZipFile,'open',opened),patch.object(o._observer,'prepare') as prepare:
                with self.assertRaises(m.Refusal):o.materialize(*args)
                prepare.assert_not_called()
            self.assertEqual(reads,[]);self.assertEqual(o.status()['firstFailure'],'materializer-reentry')
        self.run_fixture(src=src,callback=cb)
    def test_close_before_materialize_no_auth_or_parse(self):
        def cb(o,args):
            o.close();self.assertTrue(o.status()['closed'])
            with patch.object(m,'sha') as digest,patch.object(o,'_tar') as tar_parser,patch.object(o,'_zip') as zip_parser,patch.object(o._observer,'prepare') as prepare:
                with self.assertRaisesRegex(m.Refusal,'phase-order'):o.materialize(*args)
                digest.assert_not_called();tar_parser.assert_not_called();zip_parser.assert_not_called();prepare.assert_not_called()
        self.run_fixture(callback=cb)
    def test_repeated_close_no_cleanup_or_source_calls(self):
        def cb(o,args):
            o.close()
            with patch.object(o,'_cleanup') as cleanup,patch.object(m,'sha') as digest,patch.object(o,'_tar') as tar_parser,patch.object(o._observer,'prepare') as prepare:
                o.close();o.close()
                cleanup.assert_not_called();digest.assert_not_called();tar_parser.assert_not_called();prepare.assert_not_called()
        self.run_fixture(callback=cb)
    def inventory_refuses_before_prepare(self,entries):
        def cb(o,args):
            with patch.object(o._observer,'prepare') as prepare:
                with self.assertRaises(m.Refusal):o.materialize(*args)
                prepare.assert_not_called()
            self.assertEqual(o.status()['writtenRoles'],[])
        self.run_fixture(tool=tar(entries),callback=cb)
    def test_all13_valid_no_physical_aliases(self):
        def cb(o,args):
            created=[];real_open=m.os.open
            def opened(name,flags,*a,**kw):
                if flags&os.O_CREAT:created.append(name)
                return real_open(name,flags,*a,**kw)
            with patch.object(m.os,'link') as link,patch.object(m.os,'symlink') as symlink,patch.object(m.os,'open',side_effect=opened):
                status=o.materialize(*args);link.assert_not_called();symlink.assert_not_called()
            self.assertFalse(set(created)&{name.rsplit('/',1)[-1] for name in alias.ALIASES})
            self.assertEqual(status['validatedAliasCount'],13);self.assertEqual(status['validatedAliasTargetCount'],11)
            self.assertFalse(status['physicalAliasesMaterialized']);self.assertFalse(status['rawArchiveCompatibilityQualified'])
            self.assertFalse(status['fullToolchainReady']);self.assertFalse(status['compilerQualified'])
            facts=o._observer._reports[0]['roles']
            self.assertEqual(len(facts),9)
            self.assertTrue(all(row['before']['links']==1 for row in facts.values()))
            self.assertNotIn('manufactured-target',json.dumps(status))
        self.run_fixture(callback=cb)
    def test_each_missing_alias_refuses(self):
        for name in alias.ALIASES:
            with self.subTest(name=name):self.inventory_refuses_before_prepare([r for r in default_entries() if r[0]!=name])
    def test_each_duplicate_alias_refuses(self):
        for name,target in alias.ALIASES.items():
            with self.subTest(name=name):self.inventory_refuses_before_prepare(default_entries()+[(name,b'',tarfile.LNKTYPE,target)])
    def test_extra_alias_refuses(self):
        self.inventory_refuses_before_prepare(default_entries()+[('djgpp/bin/extra',b'',tarfile.LNKTYPE,next(iter(alias.TARGETS)))])
    def test_each_wrong_target_refuses(self):
        for name in alias.ALIASES:
            entries=[(r[0],r[1],r[2],'djgpp/bin/wrong') if r[0]==name else r for r in default_entries()]
            with self.subTest(name=name):self.inventory_refuses_before_prepare(entries)
    def test_forward_targets_and_alias_chain_refuse(self):
        name,target=next(iter(alias.ALIASES.items()));link=(name,b'',tarfile.LNKTYPE,target)
        self.inventory_refuses_before_prepare([link]+[r for r in default_entries() if r[0]!=name])
        other=next(n for n in alias.ALIASES if n!=name)
        self.inventory_refuses_before_prepare([(r[0],r[1],r[2],other) if r[0]==name else r for r in default_entries()])
    def test_alias_wrong_types_selected_conflicts(self):
        name=next(iter(alias.ALIASES))
        for kind in (tarfile.SYMTYPE,tarfile.DIRTYPE,tarfile.REGTYPE):
            self.inventory_refuses_before_prepare([(r[0],b'',kind) if r[0]==name else r for r in default_entries()])
        self.inventory_refuses_before_prepare([(PATHS['compiler'],b'',tarfile.LNKTYPE,PATHS['linker'])]+default_entries())
    def test_target_wrong_hash_extent_or_directory(self):
        for target in TARGET_DATA:
            for replacement in ((target,b'wrong',tarfile.REGTYPE),(target,bytes([TARGET_DATA[target][0]^1])+TARGET_DATA[target][1:],tarfile.REGTYPE),(target,b'',tarfile.DIRTYPE)):
                with self.subTest(target=target,kind=replacement[2]):self.inventory_refuses_before_prepare([replacement if r[0]==target else r for r in default_entries()])
    def test_nonzero_hardlink_extent_refuses_before_prepare(self):
        raw=bytearray(bz2.decompress(tar()));offset=0;found=False
        while offset<len(raw):
            header=raw[offset:offset+512]
            if header[156:157]==b'1':
                header[124:136]=b'00000000001\x00';header[148:156]=b'        ';checksum=sum(header);header[148:156]=('%06o\x00 '%checksum).encode();raw[offset:offset+512]=header;found=True;break
            extent=int(header[124:136].strip(b' \x00') or b'0',8);offset+=512+((extent+511)//512)*512
        self.assertTrue(found)
        def cb(o,args):
            with patch.object(o._observer,'prepare') as prepare:
                with self.assertRaises(m.Refusal):o.materialize(*args)
                prepare.assert_not_called()
        self.run_fixture(tool=bz2.compress(raw),callback=cb)
    def test_target_extent_refuses_before_content(self):
        reads=[];original=m._BZ2Reader.exact
        def exact(reader,n):reads.append(n);return original(reader,n)
        first=default_entries()[0];entries=[(first[0],first[1]+b'x',first[2])]+default_entries()[1:]
        with patch.object(m._BZ2Reader,'exact',exact):self.inventory_refuses_before_prepare(entries)
        self.assertEqual(reads,[512])
    def test_alias_target_traversal_absolute_and_trailing(self):
        name=next(iter(alias.ALIASES))
        for target in ('../djgpp/file','/djgpp/file',alias.ALIASES[name]+'/'):
            self.inventory_refuses_before_prepare([(r[0],r[1],r[2],target) if r[0]==name else r for r in default_entries()])

if __name__=='__main__':unittest.main()

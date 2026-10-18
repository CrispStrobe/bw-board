"""Manufactured immutable archives and filesystems only; no actual tools."""
import ast
import bz2
from contextlib import ExitStack
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('manufactured_runner',Path(__file__).with_name('run.py'))
r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
a=r.alias;m=a.base
PATHS={role:path for role,(path,digest) in m.SELECTED.items()}
DATA={role:('manufactured-'+role).encode() for role in PATHS}
PINS={role:(path,m.sha(DATA[role])) for role,path in PATHS.items()}
TARGET_DATA={target:next((DATA[role] for role in PATHS if PATHS[role]==target),('target-'+str(i)).encode()) for i,target in enumerate(a.TARGETS)}
TARGET_PINS={target:(len(raw),m.sha(raw)) for target,raw in TARGET_DATA.items()}
ORIGINS={'include/dpmi.h':'dpmi.h','include/sys/farptr.h':'farptr.h','lib/crt0.o':'crt0.o','lib/libc.a':'libc.a'}

def fixtures():
    stream=io.BytesIO()
    rows=[(PATHS[role],DATA[role],tarfile.REGTYPE,'') for role in PATHS]
    rows += [(name,data,tarfile.REGTYPE,'') for name,data in TARGET_DATA.items() if name not in PATHS.values()]
    rows += [(name,b'',tarfile.LNKTYPE,target) for name,target in a.ALIASES.items()]
    with tarfile.open(fileobj=stream,mode='w',format=tarfile.USTAR_FORMAT) as archive:
        for name,data,kind,target in rows:
            row=tarfile.TarInfo(name);row.type=kind;row.mode=0o755;row.linkname=target;row.size=len(data)
            archive.addfile(row,io.BytesIO(data) if data else None)
    tool=bz2.compress(stream.getvalue());sources=[]
    for entries in ([(n,DATA[role]) for n,role in ORIGINS.items()],[('COPYING',b'fixture\n')],[('COPYING',b'fixture\n')]):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as archive:
            for name,data in entries:archive.writestr(name,data)
        sources.append(stream.getvalue())
    return (tool,*sources)

class Controls(unittest.TestCase):
    def exercise(self,callback):
        inputs=fixtures();source={name:(len(raw),m.sha(raw)) for name,raw in zip(m.SOURCE,inputs[1:])}
        with tempfile.TemporaryDirectory() as parent,ExitStack() as stack:
            for module,key,value in ((m,'TOOL_BYTES',len(inputs[0])),(m,'TOOL_SHA',m.sha(inputs[0])),(m,'SOURCE',source),(m,'SELECTED',PINS),(m.observer_module,'SELECTED',PINS),(a,'TARGETS',TARGET_PINS)):
                stack.enter_context(patch.object(module,key,value))
            runner=r.MaterializationRunner(parent)
            try:return callback(runner,inputs)
            finally:runner.close()
    def test_success_closed_packet_two_source_owned_observations(self):
        def cb(runner,inputs):
            packet=runner.materialize(*inputs)
            self.assertEqual(packet['wrapper']['phase'],'complete');self.assertTrue(packet['wrapper']['hasPacket'])
            self.assertEqual(packet['materializeStatus']['writtenRoles'],list(PINS));self.assertEqual(packet['materializeStatus']['runtimeOriginJoins'],4)
            self.assertEqual(packet['materializeStatus']['validatedAliasCount'],13);self.assertEqual(packet['materializeStatus']['validatedAliasTargetCount'],11)
            rows=packet['observerReceipts'];self.assertEqual(len(rows),2);self.assertEqual([x['phase'] for x in rows],['before-probes','failure-final'])
            self.assertEqual(rows[0]['session'],rows[1]['session']);self.assertTrue(all(x['complete'] and len(x['roles'])==9 for x in rows))
            self.assertEqual(rows[0]['roles'],rows[1]['roles']);self.assertTrue(packet['closeStatus']['closed']);self.assertTrue(packet['closeStatus']['cleanupQualified'])
            self.assertEqual(packet['wrapper']['closeAttempted'],1);self.assertFalse(packet['readonlyModesObserved']);self.assertFalse(packet['physicalNamespaceObserved'])
            for key in ('fullToolchainReady','compilerQualified','guestQualified','sourceOwnedQualified','inputFilesystemLeaseQualified','performanceQualified'):self.assertFalse(packet[key])
            self.assertLessEqual(len(json.dumps(packet,separators=(',',':')).encode()),r.MAX_PACKET)
            packet['observerReceipts'][0]['roles'].clear();self.assertEqual(len(runner.report()['observerReceipts'][0]['roles']),9)
        self.exercise(cb)
    def test_all_four_authentication_failures_before_parser(self):
        def cb(runner,inputs):
            parent=runner._materializer._observer._owner._parent
            for index in range(4):
                current=runner if index==0 else r.MaterializationRunner(parent);bad=list(inputs);bad[index]+=b'!'
                with patch.object(current._materializer,'_tar') as parser,patch.object(current._materializer._observer,'prepare') as prepare:
                    with self.assertRaises(m.Refusal):current.materialize(*bad)
                    parser.assert_not_called();prepare.assert_not_called()
                packet=current.report();self.assertEqual(packet['wrapper']['firstFailure'],'input-refused');self.assertEqual(packet['observerReceipts'],[])
                self.assertEqual(len(packet['materializeStatus']['authenticatedArchives']),index);self.assertEqual(current.status()['closeAttempted'],1)
                current.close()
        self.exercise(cb)
    def test_no_caller_structures_or_input_replay(self):
        def cb(runner,inputs):
            with self.assertRaises(m.Refusal):runner.materialize(bytearray(inputs[0]),*inputs[1:])
            with patch.object(runner._materializer,'materialize') as call:
                with self.assertRaises(r.Refusal):runner.materialize(*inputs)
                call.assert_not_called()
            self.assertEqual(runner.report()['wrapper']['firstFailure'],'input-refused')
        self.exercise(cb)
    def test_close_before_materialize_and_repeated_close(self):
        def cb(runner,inputs):
            runner.close()
            with patch.object(runner._materializer,'materialize') as call,patch.object(runner._materializer,'close') as close:
                with self.assertRaises(r.Refusal):runner.materialize(*inputs)
                runner.close();runner.close();call.assert_not_called();close.assert_not_called()
            self.assertIsNone(runner.report());self.assertEqual(runner.status()['closeAttempted'],1)
        self.exercise(cb)
    def test_first_original_write_error_preserved(self):
        original=OSError('manufactured')
        def cb(runner,inputs):
            with patch.object(m.os,'write',side_effect=original):
                with self.assertRaises(OSError) as raised:runner.materialize(*inputs)
            self.assertIs(raised.exception,original);packet=runner.report();self.assertEqual(packet['wrapper']['firstFailure'],'filesystem-refusal')
            self.assertEqual(packet['materializeStatus']['writtenRoles'],[]);self.assertEqual(packet['observerReceipts'],[])
            self.assertTrue(packet['closeStatus']['cleanupQualified'])
        self.exercise(cb)
    def test_original_error_survives_secondary_status_and_close_errors(self):
        original=OSError('first');secondary=OSError('secondary')
        def cb(runner,inputs):
            with patch.object(runner._materializer,'materialize',side_effect=original),patch.object(runner._materializer,'status',side_effect=secondary),patch.object(runner._materializer,'close',side_effect=secondary) as close:
                with self.assertRaises(OSError) as raised:runner.materialize(*inputs)
                self.assertIs(raised.exception,original);self.assertEqual(close.call_count,1)
            packet=runner.report();self.assertIsNone(packet['materializeStatus']);self.assertIsNone(packet['closeStatus']);self.assertEqual(packet['wrapper']['firstFailure'],'filesystem-refusal')
            self.assertEqual(packet['wrapper']['secondary'],'evidence-refused')
        self.exercise(cb)
    def test_outer_reentry_immediately_poison_active_inner(self):
        def cb(runner,inputs):
            original=m.os.mkdir;calls=[]
            def mkdir(*args,**kw):
                calls.append(args);value=original(*args,**kw)
                try:runner.status()
                except r.Refusal:pass
                return value
            with patch.object(m.os,'mkdir',side_effect=mkdir):
                with self.assertRaises(ValueError):runner.materialize(*inputs)
            self.assertEqual(len(calls),1);self.assertEqual(runner.status()['firstFailure'],'runner-reentry')
            self.assertTrue(runner._materializer._observer._reentered);self.assertEqual(runner.status()['closeAttempted'],1)
            self.assertEqual(runner.report()['observerReceipts'],[])
        self.exercise(cb)
    def test_foreign_session_receipt_refuses_but_raw_facts_preserved(self):
        def cb(runner,inputs):
            original=runner._materializer.materialize
            def materialize(*args):
                result=original(*args);runner._materializer._observer._reports[-1]['session']='f'*64;return result
            with patch.object(runner._materializer,'materialize',side_effect=materialize):
                with self.assertRaises(r.Refusal):runner.materialize(*inputs)
            packet=runner.report();self.assertEqual(packet['wrapper']['firstFailure'],'evidence-refused')
            self.assertEqual(len(packet['observerReceipts']),2);self.assertEqual(packet['observerReceipts'][-1]['session'],'f'*64)
        self.exercise(cb)
    def test_order_and_phase_receipt_refusals(self):
        def cb(runner,inputs):
            parent=runner._materializer._observer._owner._parent
            for key,value in (('sequence',1),('phase','after-link')):
                current=runner if key=='sequence' else r.MaterializationRunner(parent);original=current._materializer.materialize
                def materialize(*args):
                    result=original(*args);current._materializer._observer._reports[-1][key]=value;return result
                with patch.object(current._materializer,'materialize',side_effect=materialize):
                    with self.assertRaises(ValueError):current.materialize(*inputs)
                self.assertEqual(current.report()['wrapper']['firstFailure'],'evidence-refused');current.close()
        self.exercise(cb)
    def test_copy_cap_types_depth_and_aliasing(self):
        for bad in ({'huge':'x'*257},{'float':1.0},{'signed':-1},{'big':2**64},list(range(65)),{1:'not-string'},object()):
            with self.assertRaises(r.Refusal):r._copy(bad)
        row=[];row.append(row)
        with self.assertRaises(r.Refusal):r._copy(row)
        with patch.object(r,'MAX_SECTION',1):
            with self.assertRaises(r.Refusal):r._copy({'closed':True})
    def test_packet_cap_refuses_no_success_packet(self):
        def cb(runner,inputs):
            with patch.object(r,'MAX_PACKET',1):
                with self.assertRaises(r.Refusal):runner.materialize(*inputs)
            self.assertIsNone(runner.report());self.assertEqual(runner.status()['firstFailure'],'evidence-refused')
            self.assertEqual(runner.status()['closeAttempted'],1)
        self.exercise(cb)
    def test_disabled_compiler_hash_and_ast_never_execute(self):
        facts=r._disabled_source();self.assertTrue(facts['unconditionalRefusalInspected']);self.assertFalse(facts['importedOrExecuted'])
        with patch.object(r,'_source',return_value=(None,b'import os\nprint("bad")\nraise RuntimeError("compile-tool-boundary-production-disabled")\n')):
            with self.assertRaises(r.Refusal):r._disabled_source()
        with patch.object(r,'DISABLED_COMPILE_SHA','0'*64):
            with self.assertRaises(r.Refusal):r._disabled_source()
        tree=ast.parse(Path(__file__).with_name('run.py').read_text())
        self.assertFalse(any(isinstance(node,(ast.Import,ast.ImportFrom)) and 'compile_tool' in ast.dump(node) for node in ast.walk(tree)))
    def test_partial_written_prefix_is_historical_not_observer_output(self):
        original=OSError('fourth write')
        def cb(runner,inputs):
            real=m.os.write;calls=[]
            def write(fd,raw):
                if raw.startswith(b'manufactured-'):
                    calls.append(raw)
                    if len(calls)==4:raise original
                return real(fd,raw)
            with patch.object(m.os,'write',side_effect=write):
                with self.assertRaises(OSError) as raised:runner.materialize(*inputs)
            self.assertIs(raised.exception,original);packet=runner.report()
            self.assertEqual(packet['materializeStatus']['writtenRoles'],list(PINS)[:3]);self.assertEqual(packet['observerReceipts'],[])
            self.assertEqual(packet['wrapper']['firstFailure'],'filesystem-refusal');self.assertTrue(packet['closeStatus']['cleanupQualified'])
        self.exercise(cb)
    def test_matching_authenticated_truncated_archive_refusal(self):
        def cb(runner,inputs):
            bad=(inputs[0][:-2],*inputs[1:])
            with patch.object(m,'TOOL_BYTES',len(bad[0])),patch.object(m,'TOOL_SHA',m.sha(bad[0])):
                with self.assertRaises(m.Refusal):runner.materialize(*bad)
            packet=runner.report();self.assertEqual(len(packet['materializeStatus']['authenticatedArchives']),4)
            self.assertEqual(packet['wrapper']['firstFailure'],'archive-truncated');self.assertEqual(packet['observerReceipts'],[])
        self.exercise(cb)
    def test_output_close_uncertainty_not_success(self):
        uncertain=[];real_close=m.os.close
        def cb(runner,inputs):
            def close(fd):
                import stat
                if stat.S_ISREG(os.fstat(fd).st_mode):
                    uncertain.append(fd);raise OSError('manufactured uncertain outputclose')
                return real_close(fd)
            with patch.object(m.os,'close',side_effect=close):
                with self.assertRaises(ValueError):runner.materialize(*inputs)
            packet=runner.report();self.assertEqual(packet['wrapper']['firstFailure'],'cleanup-refusal')
            self.assertFalse(packet['materializeStatus']['cleanupQualified']);self.assertFalse(packet['closeStatus']['cleanupQualified'])
            self.assertGreater(packet['materializeStatus']['closeRefused'],0);self.assertEqual(packet['wrapper']['closeAttempted'],1)
        try:self.exercise(cb)
        finally:
            for fd in uncertain:
                try:real_close(fd)
                except OSError:pass
    def test_raw_receipt_cap_before_json_decode(self):
        def cb(runner,inputs):
            observer=runner._materializer._observer;original=observer._serialize;calls=[]
            def serialize(row):
                calls.append(row)
                if runner._materializer._phase=='complete':return b'x'*(r.MAX_SECTION+1)
                return original(row)
            with patch.object(observer,'_serialize',side_effect=serialize):
                with self.assertRaises(r.Refusal):runner.materialize(*inputs)
            self.assertEqual(len(calls),3) # two source writer serializations, one runner copy
            self.assertEqual(runner.report()['observerReceipts'],[]);self.assertEqual(runner.status()['firstFailure'],'evidence-refused')
        self.exercise(cb)
    def test_report_and_close_busy_poison_then_cleanup_only(self):
        def cb(runner,inputs):
            parent=runner._materializer._observer._owner._parent
            for name in ('report','close'):
                current=runner if name=='report' else r.MaterializationRunner(parent);real=m.os.mkdir;calls=[]
                def mkdir(*args,**kw):
                    calls.append(args);value=real(*args,**kw)
                    try:getattr(current,name)()
                    except r.Refusal:pass
                    return value
                with patch.object(m.os,'mkdir',side_effect=mkdir):
                    with self.assertRaises(ValueError):current.materialize(*inputs)
                self.assertEqual(len(calls),1);self.assertEqual(current.status()['firstFailure'],'runner-reentry')
                self.assertTrue(current._materializer._observer._reentered);current.close()
        self.exercise(cb)
    def test_closed_status_extra_key_and_boolean_alias_refuse(self):
        def cb(runner,inputs):
            value=runner._materializer.status()
            for changed in ({**value,'extra':True},{**value,'compilerQualified':0},{**value,'guestQualified':True}):
                with self.assertRaises(r.Refusal):r._status_copy(changed)
        self.exercise(cb)
    def test_status_notice_copy_cap_refuses_without_recapture(self):
        def cb(runner,inputs):
            original=runner._materializer.status;calls=[]
            def status():
                value=original()
                if runner._materializer._phase=='complete':
                    calls.append(True);value['noticeHashes']=[{'bytes':1,'sha256':'0'*64}]*65
                return value
            with patch.object(runner._materializer,'status',side_effect=status):
                with self.assertRaises(r.Refusal):runner.materialize(*inputs)
            self.assertEqual(len(calls),2) # materializer's own final status and sole runner copy
            self.assertIsNone(runner.report()['materializeStatus']);self.assertEqual(runner.report()['observerReceipts'],[])
            self.assertEqual(runner.status()['firstFailure'],'evidence-refused')
        self.exercise(cb)
    def test_dropped_reports_cannot_make_complete_packet(self):
        def cb(runner,inputs):
            parent=runner._materializer._observer._owner._parent
            for keep in (0,1):
                current=runner if keep==0 else r.MaterializationRunner(parent);original=current._materializer.materialize
                def materialize(*args):
                    value=original(*args);current._materializer._observer._reports=current._materializer._observer._reports[:keep];return value
                with patch.object(current._materializer,'materialize',side_effect=materialize):
                    with self.assertRaises(r.Refusal):current.materialize(*inputs)
                packet=current.report();self.assertEqual(packet['wrapper']['phase'],'refused');self.assertEqual(len(packet['observerReceipts']),keep)
                self.assertEqual(current.status()['closeAttempted'],1);current.close()
        self.exercise(cb)
    def test_changed_completion_facts_cannot_make_complete_packet(self):
        def cb(runner,inputs):
            parent=runner._materializer._observer._owner._parent
            for index,(key,bad) in enumerate((('runtimeOriginJoins',3),('validatedAliasCount',12),('validatedAliasTargetCount',10),('writtenRoles',list(PINS)[:8]),('selectedNineMaterialized',1),('cleanupQualified',False))):
                current=runner if index==0 else r.MaterializationRunner(parent);original=current._materializer.status
                def status():
                    value=original()
                    if current._materializer._phase=='complete':value[key]=bad
                    return value
                with patch.object(current._materializer,'status',side_effect=status):
                    with self.assertRaises(r.Refusal):current.materialize(*inputs)
                self.assertEqual(current.report()['wrapper']['phase'],'refused');self.assertEqual(current.status()['closeAttempted'],1);current.close()
        self.exercise(cb)
    def test_changed_record_hash_cannot_make_complete_packet(self):
        def cb(runner,inputs):
            original=runner._materializer.materialize
            def materialize(*args):
                value=original(*args)
                runner._materializer._observer._reports[1]['roles']['compiler']['sha256']='0'*64
                return value
            with patch.object(runner._materializer,'materialize',side_effect=materialize):
                with self.assertRaises(ValueError):runner.materialize(*inputs)
            self.assertEqual(runner.report()['wrapper']['phase'],'refused');self.assertEqual(len(runner.report()['observerReceipts']),1)
        self.exercise(cb)

if __name__=='__main__':unittest.main()

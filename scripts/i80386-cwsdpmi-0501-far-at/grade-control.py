#!/usr/bin/env python3
"""CPU-free adversaries for the bounded far-attribution report grader."""

import copy
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("far_grade", Path(__file__).with_name("grade.py"))
grade = importlib.util.module_from_spec(spec)
spec.loader.exec_module(grade)


def context(*, pe=True, retained=False, cs=0x28, eip=0x120):
    code_cache = dict.fromkeys(grade.CACHE_FIELDS)
    code_cache.update(base=0x100000, limit=0xffffffff, default32=True,
                      present=True, code=True, readable=True, writable=False,
                      dpl=0, conforming=False, access=0x9a, address=0)
    stack_cache = dict.fromkeys(grade.CACHE_FIELDS)
    stack_cache.update(base=0x120000, limit=0xffffffff, default32=True,
                       present=True, code=False, readable=True, writable=True,
                       dpl=0, conforming=False, access=0x92, address=0,
                       expandDown=False)
    return {"cs": cs, "eip": eip, "ss": 0x10, "esp": 0x400,
            "cr3": 0, "rawCr0": 1 if pe else 0, "rawFlags": 0x202,
            "trSelector": 0x38, "trType": 11, "trBase": 0x700,
            "trLimit": 0x67, "trPresent": True, "cpl": 0,
            "protectedMode": pe, "vm86": False, "nt": False,
            "retainedRealCs": retained,
            "mode": "protected" if pe else "pe-clear",
            "codeCache": code_cache, "stackCache": stack_cache}


def task_context(tr):
    return {"cs": 0x28, "eip": 0x120, "ss": 0x10, "esp": 0x400,
            "cr3": 0, "trSelector": tr, "trType": 11,
            "trBase": 0x700, "trLimit": 0x67, "trPresent": True,
            "cpl": 0, "vm86": False, "nt": False,
            "protectedMode": True}


def fixture():
    first_before = context(eip=0x120)
    first_after = context(pe=False, eip=0x120)
    second_before = context(pe=False, eip=0x136)
    second_after = context(pe=True, retained=True, eip=0x140)
    far_before = copy.deepcopy(second_after)
    far_after = context(pe=True, retained=False, eip=0x105)
    operation = {"kind": "decoded-direct-far-cs-reload",
                 "source": "ea-immediate", "operandWidth": 16,
                 "instructionStart": 0x140, "selector": 0x28,
                 "target": 0x105, "afterCs": 0x28,
                 "after": copy.deepcopy(far_after)}
    tape = [
        {"step": 47, "before": first_before, "after": first_after,
         "operation": {"kind": "decoded-mov-cr0", "source": "0f-22-cr0",
                       "instructionStart": 0x120, "beforeCr0": 1, "afterCr0": 0},
         "enclosingStepCommitted": True},
        {"step": 442, "before": second_before, "after": second_after,
         "operation": {"kind": "decoded-mov-cr0", "source": "0f-22-cr0",
                       "instructionStart": 0x136, "beforeCr0": 0, "afterCr0": 1},
         "enclosingStepCommitted": True},
        {"step": 443, "before": far_before, "after": far_after,
         "operation": operation, "enclosingStepCommitted": True},
    ]
    mode = {"schema": grade.MODE_SCHEMA, "phase": "invalid",
            "frameReturnQualified": False, "activeSteps": 450,
            "truncated": False,
            "transitions": [
                {"step": 20, "kind": "jmp", "selector": 0x34,
                 "source": {**task_context(0x30), "savedEip": 0x190},
                 "post": task_context(0x34), "outcome": "core-return",
                 "enclosingStepCommitted": True},
                {"step": 22, "kind": "jmp", "selector": 0x38,
                 "source": {**task_context(0x34), "savedEip": 0x190},
                 "post": task_context(0x38), "outcome": "core-return",
                 "enclosingStepCommitted": True}],
            "modeChanges": tape}
    return {"schema": grade.TASK_SCHEMA, "passed": False,
            "frameReturnQualified": False,
            "firstFailure": "task-switch-during-owned-frame",
            "strictFrame": {"firstFailure": "task-switch-during-owned-frame",
                            "modeArmed": True,
                            "strict": {"phase": "invalid",
                                       "failure": "task-switch-during-owned-frame",
                                       "entry": {"vector": 0x31},
                                       "returned": None}},
            "taskMode": {"frameReturnQualified": False,
                         "committedOutgoing": True,
                         "observation": mode}}


class GradeControl(unittest.TestCase):
    def test_source_issued_case_and_ff5_32bit(self):
        self.assertEqual(grade.grade(fixture())["source"], "ea-immediate")
        task = fixture()
        op = task["taskMode"]["observation"]["modeChanges"][2]["operation"]
        op["source"] = "ff-far-indirect"
        op["operandWidth"] = 32
        self.assertEqual(grade.grade(task)["operandWidth"], 32)

    def test_mutations_fail_closed(self):
        def change(task, key, value):
            tape = task["taskMode"]["observation"]["modeChanges"]
            if key == "operation":
                tape[2]["operation"] = value
            elif key == "duplicate":
                tape.append(copy.deepcopy(tape[2]))
            elif key == "outgoing":
                task["taskMode"]["observation"]["transitions"][0]["step"] = value
            elif key == "strict":
                task["strictFrame"]["strict"]["returned"] = value
            else:
                tape[2][key] = value
        cases = [
            ("operation", None),
            ("operation", {"kind": "task-core-return"}),
            ("duplicate", None),
            ("outgoing", 450),
            ("strict", {"eip": 0x105}),
            ("step", 442),
            ("enclosingStepCommitted", False),
        ]
        for key, value in cases:
            with self.subTest(key=key, value=value):
                task = fixture()
                change(task, key, value)
                with self.assertRaises(grade.Refusal):
                    grade.grade(task)
        for key, value in [
            ("kind", "decoded-mov-cr0"), ("source", "call-gate"),
            ("operandWidth", 8), ("selector", 0x2b),
            ("target", 0x106), ("instructionStart", 0x141),
            ("afterCs", 0x29), ("after", {"forged": True})
        ]:
            with self.subTest(operation=key):
                task = fixture()
                task["taskMode"]["observation"]["modeChanges"][2]["operation"][key] = value
                with self.assertRaises(grade.Refusal):
                    grade.grade(task)
        for key, value in [("trSelector", 0x40), ("cr3", 0x1000),
                           ("rawFlags", 0x246), ("esp", 0x3fc),
                           ("stackCache", {"base": 7})]:
            with self.subTest(context=key):
                task = fixture()
                task["taskMode"]["observation"]["modeChanges"][2]["after"][key] = value
                with self.assertRaises(grade.Refusal):
                    grade.grade(task)
        for mutation in (
            lambda task: task.update(passed=True),
            lambda task: task["taskMode"]["observation"]["modeChanges"][2].update(step=444),
            lambda task: task["taskMode"]["observation"]["modeChanges"][2]["before"].update(eip=0x141),
            lambda task: task["taskMode"]["observation"]["modeChanges"][1]["after"].update(cr3=0x1000),
            lambda task: task["taskMode"]["observation"]["modeChanges"][0]["operation"].update(source="invented"),
            lambda task: task["taskMode"]["observation"]["transitions"][0].update(enclosingStepCommitted=False),
            lambda task: task["taskMode"]["observation"]["transitions"][1]["post"].update(trSelector=0x40),
        ):
            task = fixture()
            mutation(task)
            with self.assertRaises(grade.Refusal):
                grade.grade(task)

    def test_absent_report_and_duplicate_or_nonfinite_json_preserve_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            absent = grade.main(root / "absent.json", root / "absent-grade.json")
            self.assertFalse(absent["attributionQualified"])
            self.assertEqual(absent["passed"], False)
            for i, raw in enumerate((b'{"a":1,"a":2}', b'{"a":1e999}',
                                     b'{"a":NaN}', b'{"a":1} trailing')):
                source = root / f"invalid-{i}.json"
                source.write_bytes(raw)
                receipt = grade.main(source, root / f"grade-{i}.json")
                self.assertFalse(receipt["attributionQualified"])
                self.assertIsNotNone(receipt["firstFailure"])
                self.assertEqual(receipt["sourceReport"]["bytes"], len(raw))

    def test_original_json_is_unchanged_and_separate_grade_binds_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "task-mode.json"
            raw = (json.dumps(fixture(), sort_keys=True) + "\n").encode()
            source.write_bytes(raw)
            result = grade.main(source, root / "far-attribution.json")
            self.assertTrue(result["attributionQualified"])
            self.assertFalse(result["passed"])
            self.assertEqual(source.read_bytes(), raw)
            self.assertEqual(result["sourceReport"]["bytes"], len(raw))


if __name__ == "__main__":
    unittest.main()

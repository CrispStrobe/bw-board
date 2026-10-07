#!/usr/bin/env python3
"""Bounded synthetic controls; no guest, compiler, or network access."""

from __future__ import annotations

import unittest

from policy import (COMMON_KEYS, EXPECTED_SERIAL, HISTORICAL_GUEST_STEPS, ROM_SHA,
                    compare_reports, summarize_pairs, validate_report)


REVISION = "a" * 40
MEDIA = {"image": "b" * 64, "slaveImage": "c" * 64}


def report(arm: str) -> dict:
    base = {
        "executionRevision": REVISION,
        "sourceSha256": {"./probe-xv6-stock.mjs": "d" * 64},
        "expandedGroupedAdmission": False,
        "registerStackAdmission": False,
        "profile": "4m", "clockHz": 16_000_000,
        "functionalInstructionCycles": 1,
        "machineCycles": 100, "virtualSeconds": 0.00000625,
        "lean": True, "ramSha256": "e" * 64,
        "diskSha256": "f" * 64, "filesystemDiskSha256": "0" * 64,
        "firmware": "bochs",
        "rom": {"path": "roms/free-at-bios/BIOS-bochs-legacy", "sha256": ROM_SHA},
        "image": {"path": "guest/xv6.img", "sha256": MEDIA["image"]},
        "slaveImage": {"path": "guest/fs.img", "sha256": MEDIA["slaveImage"]},
        "steps": HISTORICAL_GUEST_STEPS, "first32": 1,
        "serial": EXPECTED_SERIAL,
        "inputSent": [{"step": index + 5, "byte": byte}
                      for index, byte in enumerate(b"forktest\r")],
        "interrupts": [{"step": 2, "irq": 14}],
        "postBootInterrupts": [{"step": 3, "irq": 4}],
        "lapicIdReads": [], "milestones": {}, "userModeEntries": [],
        "screen": [""] * 25,
        "lapic": {"svr": 0, "timer": 0, "initialCount": 0},
        "ioapic": {"id": 0, "version": 0, "ideLow": 0,
                   "ideHigh": 0, "idePending": 0},
        "cpu": {"cs": 8, "eip": 1, "eflags": 2, "cr0": 1, "cr3": 0,
                "cr4": 0x10, "cycles": 100, "instructionSnapshot": {}},
    }
    assert set(base) == COMMON_KEYS
    if arm == "dispatch":
        base.update(sharedRam=True, nativeDispatch=True,
                    nativeStats={"instructions": 1, "blockCalls": 1})
    return base


def pairs() -> list[dict]:
    return [{"index": index,
             "order": (["ordinary", "dispatch"] if index % 2 == 0
                       else ["dispatch", "ordinary"]),
             "semanticSha256": "1" * 64,
             "children": {
                 arm: {"arm": arm, "semanticSha256": "1" * 64,
                       "cpuSeconds": (10.0 if arm == "ordinary" else 8.0),
                       "wallSeconds": (12.0 if arm == "ordinary" else 10.0)}
                 for arm in ("ordinary", "dispatch")}}
            for index in range(9)]


class PolicyControls(unittest.TestCase):
    def test_exact_report_projection(self):
        result = compare_reports(report("ordinary"), report("dispatch"),
                                 REVISION, MEDIA)
        self.assertEqual(result["nativeInstructions"], 1)
        self.assertEqual(len(result["semanticSha256"]), 64)

    def test_each_architectural_surface_must_match(self):
        for field, mutation in (
            ("cpu", lambda r: r["cpu"].__setitem__("eip", 2)),
            ("ramSha256", lambda r: r.__setitem__("ramSha256", "a" * 64)),
            ("diskSha256", lambda r: r.__setitem__("diskSha256", "a" * 64)),
            ("filesystemDiskSha256", lambda r: r.__setitem__("filesystemDiskSha256", "a" * 64)),
            ("serial", lambda r: r.__setitem__("serial", r["serial"] + "!")),
            ("inputSent", lambda r: r["inputSent"][0].__setitem__("step", 7)),
            ("interrupts", lambda r: r["interrupts"].append({"step": 4, "irq": 7})),
            ("lapic", lambda r: r["lapic"].__setitem__("timer", 1)),
            ("ioapic", lambda r: r["ioapic"].__setitem__("idePending", 1)),
            ("screen", lambda r: r["screen"].__setitem__(0, "x")),
            ("machineCycles", lambda r: r.__setitem__("machineCycles", 101)),
        ):
            with self.subTest(field=field):
                changed = report("dispatch")
                mutation(changed)
                with self.assertRaises(ValueError):
                    compare_reports(report("ordinary"), changed, REVISION, MEDIA)

    def test_unknown_and_missing_fields_denied(self):
        for mutation in (
            lambda r: r.__setitem__("unreviewedField", 0),
            lambda r: r.pop("ramSha256"),
            lambda r: r.pop("cpu")["instructionSnapshot"],
        ):
            changed = report("ordinary")
            mutation(changed)
            with self.assertRaises(ValueError):
                validate_report(changed, "ordinary", REVISION, MEDIA)

    def test_identity_and_mode_denied(self):
        for field, value in (("executionRevision", "b" * 40),
                             ("profile", "14m"), ("lean", False),
                             ("steps", 0),
                             ("expandedGroupedAdmission", True)):
            changed = report("ordinary")
            changed[field] = value
            with self.assertRaises(ValueError):
                validate_report(changed, "ordinary", REVISION, MEDIA)
        native = report("dispatch")
        native["nativeStats"]["instructions"] = 0
        with self.assertRaises(ValueError):
            validate_report(native, "dispatch", REVISION, MEDIA)

    def test_fresh_build_step_count_may_differ_but_must_match_both_arms(self):
        ordinary, native = report("ordinary"), report("dispatch")
        ordinary["steps"] = native["steps"] = HISTORICAL_GUEST_STEPS + 1
        self.assertEqual(len(compare_reports(ordinary, native, REVISION, MEDIA)
                             ["semanticSha256"]), 64)
        native["steps"] += 1
        with self.assertRaises(ValueError):
            compare_reports(ordinary, native, REVISION, MEDIA)

    def test_source_and_media_denied(self):
        ordinary, native = report("ordinary"), report("dispatch")
        native["sourceSha256"]["./probe-xv6-stock.mjs"] = "e" * 64
        with self.assertRaises(ValueError):
            compare_reports(ordinary, native, REVISION, MEDIA)
        ordinary["image"]["sha256"] = "a" * 64
        with self.assertRaises(ValueError):
            validate_report(ordinary, "ordinary", REVISION, MEDIA)

    def test_pair_schedule_and_gate(self):
        summary = summarize_pairs(pairs())
        self.assertTrue(summary["adoptionGatePass"])
        self.assertEqual(summary["favorableCpuPairs"], 7)
        changed = pairs()
        changed[2]["children"]["dispatch"]["cpuSeconds"] = 10.1
        self.assertFalse(summarize_pairs(changed)["adoptionGatePass"])
        changed[2]["order"].reverse()
        with self.assertRaises(ValueError):
            summarize_pairs(changed)

    def test_nonfinite_or_declarative_semantics_denied(self):
        for invalid in (0, float("nan"), float("inf"), -1):
            changed = pairs()
            changed[2]["children"]["dispatch"]["cpuSeconds"] = invalid
            with self.assertRaises(ValueError):
                summarize_pairs(changed)
        changed = pairs()
        changed[2]["children"]["dispatch"]["semanticSha256"] = "2" * 64
        with self.assertRaises(ValueError):
            summarize_pairs(changed)
        changed = pairs()
        changed[2]["semanticSha256"] = "2" * 64
        changed[2]["children"]["ordinary"]["semanticSha256"] = "2" * 64
        changed[2]["children"]["dispatch"]["semanticSha256"] = "2" * 64
        with self.assertRaises(ValueError):
            summarize_pairs(changed)


if __name__ == "__main__":
    unittest.main()

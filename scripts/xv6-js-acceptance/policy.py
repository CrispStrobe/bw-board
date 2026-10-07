"""Pure admission and comparison policy for the stock xv6 JavaScript gate.

The runner authenticates files and measures processes; this module never runs a
guest and never treats a self-declared semantic flag as evidence.
"""

from __future__ import annotations

import hashlib
import json
import math
from statistics import mean


SCHEMA = "bw.xv6-js-acceptance.v1"
HISTORICAL_GUEST_STEPS = 24_338_279
EXPECTED_SERIAL = (
    "\fxv6...\ncpu0: starting 0\n"
    "sb: size 1000 nblocks 941 ninodes 200 nlog 30 logstart 2 "
    "inodestart 32 bmap start 58\n"
    "init: starting sh\n$ forktest\nfork test\nfork test OK\n$ "
)
ROM_SHA = "6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac"

COMMON_KEYS = frozenset({
    "executionRevision", "sourceSha256", "expandedGroupedAdmission",
    "registerStackAdmission", "profile", "clockHz",
    "functionalInstructionCycles", "machineCycles", "virtualSeconds",
    "lean", "ramSha256", "diskSha256", "filesystemDiskSha256",
    "firmware", "rom", "image", "slaveImage", "steps", "first32",
    "serial", "inputSent", "interrupts", "postBootInterrupts",
    "lapicIdReads", "milestones", "userModeEntries", "screen",
    "lapic", "ioapic", "cpu",
})
NATIVE_KEYS = frozenset({"sharedRam", "nativeDispatch", "nativeStats"})
SEMANTIC_KEYS = COMMON_KEYS - {"sourceSha256", "executionRevision"}
HEX64 = set("0123456789abcdef")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_json(value: object) -> str:
    data = json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("ascii")
    return hashlib.sha256(data).hexdigest()


def _sha(value: object, name: str) -> str:
    require(isinstance(value, str) and len(value) == 64 and
            all(char in HEX64 for char in value), f"invalid {name} SHA-256")
    return value


def validate_report(report: object, arm: str, revision: str,
                    media: dict[str, str]) -> dict:
    require(arm in {"ordinary", "dispatch"}, "unknown arm")
    require(isinstance(report, dict), "guest report must be an object")
    expected = COMMON_KEYS | (NATIVE_KEYS if arm == "dispatch" else frozenset())
    require(report.keys() == expected,
            f"{arm} report has missing or unknown fields: "
            f"missing={sorted(expected - report.keys())}, "
            f"extra={sorted(report.keys() - expected)}")
    require(report["executionRevision"] == revision, "wrong execution revision")
    source = report["sourceSha256"]
    require(isinstance(source, dict) and source, "missing source inventory")
    for key, value in source.items():
        require(isinstance(key, str) and key.startswith(("./", "../")) and
                "\\" not in key and "\x00" not in key, "invalid source role")
        _sha(value, f"source {key}")
    require(report["profile"] == "4m" and report["firmware"] == "bochs" and
            report["lean"] is True and report["expandedGroupedAdmission"] is False and
            report["registerStackAdmission"] is False, "wrong xv6 profile")
    require(isinstance(report["steps"], int) and not isinstance(report["steps"], bool) and
            0 < report["steps"] <= 40_000_000 and
            report["serial"] == EXPECTED_SERIAL, "forktest terminal outcome differs")
    require(isinstance(report["ramSha256"], str), "missing full RAM digest")
    _sha(report["ramSha256"], "full RAM")
    for key in ("diskSha256", "filesystemDiskSha256"):
        _sha(report[key], key)
    require(isinstance(report["rom"], dict) and
            report["rom"].get("sha256") == ROM_SHA, "wrong free BIOS")
    for field in ("image", "slaveImage"):
        require(isinstance(report[field], dict) and
                report[field].get("sha256") == media[field], f"wrong {field}")
    sent = report["inputSent"]
    require(isinstance(sent, list) and len(sent) == len("forktest\r") and
            [item.get("byte") for item in sent if isinstance(item, dict)] ==
            list(b"forktest\r") and
            all(isinstance(item, dict) and isinstance(item.get("step"), int) and
                0 <= item["step"] < report["steps"] for item in sent) and
            [item["step"] for item in sent] == sorted(item["step"] for item in sent),
            "command input incomplete or reordered")
    require(isinstance(report["cpu"], dict) and
            set(report["cpu"]) == {"cs", "eip", "eflags", "cr0", "cr3", "cr4",
                                   "cycles", "instructionSnapshot"} and
            isinstance(report["screen"], list) and len(report["screen"]) == 25,
            "missing CPU or screen state")
    for field in ("interrupts", "postBootInterrupts", "lapicIdReads"):
        require(isinstance(report[field], list), f"missing {field}")
    require(isinstance(report["lapic"], dict) and
            set(report["lapic"]) == {"svr", "timer", "initialCount"},
            "missing LAPIC state")
    require(isinstance(report["ioapic"], dict) and
            set(report["ioapic"]) == {"id", "version", "ideLow", "ideHigh", "idePending"},
            "missing IOAPIC state")
    if arm == "dispatch":
        require(report["nativeDispatch"] is True and report["sharedRam"] is True and
                isinstance(report["nativeStats"], dict) and
                isinstance(report["nativeStats"].get("instructions"), int) and
                report["nativeStats"]["instructions"] > 0,
                "native dispatch did not retire guest instructions")
    return {key: report[key] for key in sorted(SEMANTIC_KEYS)}


def compare_reports(ordinary: dict, dispatch: dict, revision: str,
                    media: dict[str, str]) -> dict:
    a = validate_report(ordinary, "ordinary", revision, media)
    b = validate_report(dispatch, "dispatch", revision, media)
    require(ordinary["sourceSha256"] == dispatch["sourceSha256"],
            "source inventories differ")
    require(a == b, "ordinary and dispatch guest outcomes differ")
    return {"semanticSha256": sha256_json(a), "sourceSha256":
            sha256_json(ordinary["sourceSha256"]),
            "nativeInstructions": dispatch["nativeStats"]["instructions"]}


def summarize_pairs(pairs: list[dict]) -> dict:
    """Consume independently validated paired child measurements.

    Each pair must already carry the same authenticated semantic digest. The
    runner validates each child's actual receipt and measurements before this.
    """
    require(isinstance(pairs, list) and len(pairs) == 9, "need 2 warmups and 7 pairs")
    measured = []
    series_semantic = None
    for index, pair in enumerate(pairs):
        require(isinstance(pair, dict) and pair.get("index") == index,
                "pair index mismatch")
        expected_order = ["ordinary", "dispatch"] if index % 2 == 0 else ["dispatch", "ordinary"]
        require(pair.get("order") == expected_order, "pair order mismatch")
        semantic = _sha(pair.get("semanticSha256"), "pair semantic")
        if series_semantic is None:
            series_semantic = semantic
        require(semantic == series_semantic, "guest outcome changed across pairs")
        children = pair.get("children")
        require(isinstance(children, dict) and set(children) == set(expected_order),
                "pair children mismatch")
        for arm in expected_order:
            child = children[arm]
            require(isinstance(child, dict) and child.get("arm") == arm and
                    child.get("semanticSha256") == pair.get("semanticSha256"),
                    "child semantic proof mismatch")
            for metric in ("cpuSeconds", "wallSeconds"):
                value = child.get(metric)
                require(isinstance(value, (int, float)) and not isinstance(value, bool) and
                        math.isfinite(value) and 0 < value <= 181,
                        f"invalid {arm} {metric}")
        if index >= 2:
            measured.append(pair)
    ordinary = [p["children"]["ordinary"]["cpuSeconds"] for p in measured]
    dispatch = [p["children"]["dispatch"]["cpuSeconds"] for p in measured]
    ordinary_wall = [p["children"]["ordinary"]["wallSeconds"] for p in measured]
    dispatch_wall = [p["children"]["dispatch"]["wallSeconds"] for p in measured]
    ratio = mean(dispatch) / mean(ordinary)
    return {"schema": SCHEMA, "measuredPairs": 7,
            "ordinaryCpuSeconds": ordinary, "dispatchCpuSeconds": dispatch,
            "ordinaryWallSeconds": ordinary_wall, "dispatchWallSeconds": dispatch_wall,
            "meanCpuRatioDispatchOverOrdinary": ratio,
            "meanWallRatioDispatchOverOrdinary": mean(dispatch_wall) / mean(ordinary_wall),
            "favorableCpuPairs": sum(b < a for a, b in zip(ordinary, dispatch)),
            "adoptionGatePass": ratio <= 0.90 and all(b < a for a, b in zip(ordinary, dispatch))}

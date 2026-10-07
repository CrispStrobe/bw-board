"""Pure paired policy for the ordinary-JS instruction snapshot experiment."""

from __future__ import annotations

import math
from statistics import mean


ARMS = ("before", "after")
MEASURED_PAIRS = 7
WARMUP_PAIRS = 2


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def summarize(pairs: list[dict]) -> dict:
    require(len(pairs) == WARMUP_PAIRS + MEASURED_PAIRS,
            "need two warmups and seven measured pairs")
    semantic = None
    for index, pair in enumerate(pairs):
        order = list(ARMS if index % 2 == 0 else reversed(ARMS))
        require(pair.get("index") == index and pair.get("order") == order,
                "pair order/index differs")
        require(set(pair.get("children", {})) == set(ARMS), "pair child missing")
        digest = pair.get("semanticSha256")
        require(isinstance(digest, str) and len(digest) == 64 and
                all(char in "0123456789abcdef" for char in digest),
                "invalid semantic digest")
        if semantic is None:
            semantic = digest
        require(digest == semantic, "guest outcome changed across pairs")
        for arm in ARMS:
            child = pair["children"][arm]
            require(child.get("arm") == arm and child.get("semanticSha256") == digest and
                    child.get("exitCode") == 0 and
                    child.get("timedOut") is False and
                    child.get("rssExceeded") is False and
                    child.get("processGroupEmptyAfterExit") is True,
                    "child outcome or semantic proof differs")
            for field in ("cpuSeconds", "wallSeconds"):
                value = child.get(field)
                require(type(value) in (float, int) and math.isfinite(value) and
                        0 < value <= 181, f"invalid {arm} {field}")
    measured = pairs[WARMUP_PAIRS:]
    cpu = {arm: [p["children"][arm]["cpuSeconds"] for p in measured]
           for arm in ARMS}
    wall = {arm: [p["children"][arm]["wallSeconds"] for p in measured]
            for arm in ARMS}
    cpu_ratio = mean(cpu["after"]) / mean(cpu["before"])
    wall_ratio = mean(wall["after"]) / mean(wall["before"])
    favorable = sum(a < b for a, b in zip(cpu["after"], cpu["before"]))
    return {
        "schema": "bw.xv6-js-snapshot-paired.v1",
        "warmupPairs": WARMUP_PAIRS,
        "measuredPairs": MEASURED_PAIRS,
        "semanticSha256": semantic,
        "wholeChildCpuSeconds": cpu,
        "wholeChildWallSeconds": wall,
        "meanCpuRatioAfterOverBefore": cpu_ratio,
        "meanWallRatioAfterOverBefore": wall_ratio,
        "favorableCpuPairs": favorable,
        "adoptionGatePass": cpu_ratio <= 0.98 and favorable == MEASURED_PAIRS and
                            wall_ratio <= 1.02,
    }

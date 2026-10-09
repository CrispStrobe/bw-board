#!/usr/bin/env python3
"""Grade one source-owned EA/FF5 mode ticket from the retained AT report.

This does not execute or replay the guest. A passing attribution is narrower
than a returned AX=0501 frame, a completed client, or an OS qualification.
"""

import hashlib
import json
import math
import os
import stat
import sys
from pathlib import Path

SCHEMA = "bw.cwsdpmi-0501-far-at.grade.v1"
TASK_SCHEMA = "bw.cwsdpmi-0501-task-mode.at-source.v1"
MODE_SCHEMA = "bw.i80386-owned-0501.task-mode-diagnostic.v1"
LIMIT = 5 << 20
MAX_CHANGES = 32


class Refusal(ValueError):
    pass


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise Refusal("duplicate JSON key")
        result[key] = value
    return result


def finite_float(token):
    value = float(token)
    if not math.isfinite(value):
        raise Refusal("nonfinite JSON value")
    return value


def ordinary(path):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= LIMIT:
        raise Refusal("task report is not bounded ordinary data")
    identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or (
            opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns
        ) != identity:
            raise Refusal("task report changed before read")
        data = bytearray()
        while len(data) <= LIMIT:
            block = os.read(fd, min(1 << 20, LIMIT + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        after = os.fstat(fd)
        named = path.lstat()
        if len(data) != before.st_size or len(data) > LIMIT or not all(
            stat.S_ISREG(item.st_mode) and
            (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns) == identity
            for item in (after, named)
        ):
            raise Refusal("task report changed during read")
        return bytes(data)
    finally:
        os.close(fd)


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def record(value, name):
    if type(value) is not dict:
        raise Refusal(name + " shape")
    return value


def required(condition, reason):
    if not condition:
        raise Refusal(reason)


def context(value, name):
    value = record(value, name)
    for key, maximum in (("cs", 0xffff), ("eip", 0xffffffff),
                         ("ss", 0xffff), ("esp", 0xffffffff),
                         ("cr3", 0xffffffff), ("rawCr0", 0xffffffff),
                         ("rawFlags", 0xffffffff), ("trSelector", 0xffff),
                         ("trType", 15), ("trBase", 0xffffffff),
                         ("trLimit", 0xffffffff), ("cpl", 3)):
        required(integer(value.get(key), 0, maximum), name + " " + key)
    for key in ("protectedMode", "vm86", "retainedRealCs", "trPresent"):
        required(type(value.get(key)) is bool, name + " " + key)
    required(type(value.get("stackCache")) is dict, name + " stack cache")
    return value


def grade(task):
    task = record(task, "task report")
    required(task.get("schema") == TASK_SCHEMA and task.get("passed") is False and
             task.get("firstFailure") == "task-switch-during-owned-frame" and
             task.get("frameReturnQualified") is False,
             "retained task report boundary")
    strict = record(task.get("strictFrame"), "strict frame wrapper")
    frame = record(strict.get("strict"), "strict CPU frame")
    required(strict.get("firstFailure") == "task-switch-during-owned-frame" and
             frame.get("phase") == "invalid" and
             frame.get("failure") == "task-switch-during-owned-frame" and
             frame.get("entry") is not None and frame.get("returned") is None and
             strict.get("modeArmed") is True,
             "original strict frame refusal")
    mode = record(task.get("taskMode"), "task mode result")
    observation = record(mode.get("observation"), "CPU mode observation")
    required(mode.get("frameReturnQualified") is False and
             mode.get("committedOutgoing") is True and
             observation.get("schema") == MODE_SCHEMA and
             observation.get("frameReturnQualified") is False and
             observation.get("phase") in ("invalid", "candidate") and
             type(observation.get("truncated")) is bool and
             observation["truncated"] is False,
             "task mode diagnostic boundary")
    transitions = observation.get("transitions")
    changes = observation.get("modeChanges")
    required(type(transitions) is list and 1 <= len(transitions) <= 32 and
             type(changes) is list and 3 <= len(changes) <= MAX_CHANGES,
             "bounded transition and mode tape")
    outgoing = record(transitions[0], "outgoing task transition")
    required(outgoing.get("enclosingStepCommitted") is True and
             outgoing.get("outcome") == "core-return" and
             integer(outgoing.get("step"), 1, 1_000_000),
             "committed outgoing task source")
    active = observation.get("activeSteps")
    required(integer(active, 3, 1_000_000), "mode active-step bound")
    steps = []
    for change in changes:
        change = record(change, "mode change")
        step = change.get("step")
        required(integer(step, 1, active) and
                 (not steps or step > steps[-1]) and
                 change.get("enclosingStepCommitted") is True,
                 "mode order/commit")
        steps.append(step)
        context(change.get("before"), "mode before")
        context(change.get("after"), "mode after")
    required(outgoing["step"] < steps[0], "outgoing predecessor order")
    first, second, selected = changes[:3]
    first_operation = record(first.get("operation"), "first MOV CR0")
    second_operation = record(second.get("operation"), "second MOV CR0")
    required(all(operation.get("kind") == "decoded-mov-cr0" and
                 operation.get("source") == "0f-22-cr0" and
                 operation.get("instructionStart") == change["before"]["eip"] and
                 operation.get("beforeCr0") == change["before"]["rawCr0"] and
                 operation.get("afterCr0") == change["after"]["rawCr0"] and
                 change["before"]["rawFlags"] == change["after"]["rawFlags"]
                 for operation, change in ((first_operation, first),
                                           (second_operation, second))) and
             first["before"]["protectedMode"] is True and
             first["after"]["protectedMode"] is False and
             second["before"]["protectedMode"] is False and
             second["after"]["protectedMode"] is True and
             second["after"]["retainedRealCs"] is True,
             "decoded predecessor mode sequence")
    operation = record(selected.get("operation"), "far operation")
    before = selected["before"]
    after = selected["after"]
    width = operation.get("operandWidth")
    selector = operation.get("selector")
    target = operation.get("target")
    required(operation.get("kind") == "decoded-direct-far-cs-reload" and
             operation.get("source") in ("ea-immediate", "ff-far-indirect") and
             type(width) is int and width in (16, 32) and
             integer(selector, 1, 0xffff) and
             (selector & 3) <= before["cpl"] and
             integer(target, 0, 0xffff if width == 16 else 0xffffffff) and
             operation.get("instructionStart") == before["eip"] and
             operation.get("target") == after["eip"] and
             operation.get("afterCs") == after["cs"] and
             after["cs"] == ((selector & 0xfffc) | before["cpl"]) and
             operation.get("after") == after and
             before["protectedMode"] is True and
             after["protectedMode"] is True and
             before["vm86"] is False and after["vm86"] is False and
             before["retainedRealCs"] is True and
             after["retainedRealCs"] is False and
             before["cpl"] == after["cpl"] == 0 and
             all(before[key] == after[key] for key in
                 ("rawCr0", "rawFlags", "ss", "esp", "cr3", "trSelector",
                  "trType", "trBase", "trLimit", "trPresent", "stackCache")),
             "source-issued far reload continuity")
    required(not any(record(change.get("operation"), "later operation").get(
        "kind") == "decoded-direct-far-cs-reload" for change in changes[3:]),
        "ambiguous duplicate far reload")
    return {"attributionQualified": True, "modeStep": selected["step"],
            "source": operation["source"], "operandWidth": width,
            "instructionStart": before["eip"], "selector": selector,
            "target": target, "beforeCs": before["cs"],
            "afterCs": after["cs"], "modeChangeCount": len(changes),
            "outgoingTaskStep": outgoing["step"]}


def main(source, output):
    receipt = {"schema": SCHEMA, "passed": False,
               "scope": "decoded source-owned far reload only; strict AX=0501 frame remains refused",
               "attributionQualified": False, "frameReturnQualified": False,
               "firstFailure": None, "sourceReport": None}
    try:
        raw = ordinary(Path(source))
        receipt["sourceReport"] = {"bytes": len(raw),
                                   "sha256": hashlib.sha256(raw).hexdigest()}
        task = json.loads(raw.decode("utf-8"), object_pairs_hook=object_pairs,
                          parse_float=finite_float,
                          parse_constant=lambda _: (_ for _ in ()).throw(
                              Refusal("nonfinite JSON value")))
        receipt.update(grade(task))
    except (OSError, UnicodeError, ValueError, TypeError, KeyError) as error:
        receipt["firstFailure"] = (str(error) if isinstance(error, Refusal)
                                   else "malformed or unavailable task report")[:160]
    with Path(output).open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, indent=2, sort_keys=True, allow_nan=False)
        stream.write("\n")
    return receipt


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: grade.py task-mode.json far-attribution.json")
    main(sys.argv[1], sys.argv[2])

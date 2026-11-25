#!/usr/bin/env python3
"""Two-pass assembler for the MCS-48 instructions used by monitor.asm."""

import argparse
import ast
import hashlib
import json
import operator
import re
from pathlib import Path


FIXED = {
    "NOP": 0x00, "DIS I": 0x15, "EN TCNTI": 0x25,
    "DIS TCNTI": 0x35, "STRT T": 0x55, "STOP TCNT": 0x65,
    "CLR A": 0x27, "CPL A": 0x37, "CLR C": 0x97, "CPL C": 0xA7,
    "INC A": 0x17, "DEC A": 0x07, "RL A": 0xE7, "RLC A": 0xF7,
    "RR A": 0x77, "RRC A": 0x67, "SWAP A": 0x47,
    "RET": 0x83, "RETR": 0x93, "SEL RB0": 0xC5, "SEL RB1": 0xD5,
    "MOV A,T": 0x42, "MOV T,A": 0x62,
    "IN A,P1": 0x09, "IN A,P2": 0x0A,
    "OUTL P1,A": 0x39, "OUTL P2,A": 0x3A,
    "MOVP A,@A": 0xA3, "MOVP3 A,@A": 0xE3, "JMPP @A": 0xB3,
}
BRANCH = {
    "JC": 0xF6, "JNC": 0xE6, "JZ": 0xC6, "JNZ": 0x96,
    "JTF": 0x16, **{f"JB{i}": 0x12 + i * 0x20 for i in range(8)},
}
FAMILIES = {
    ("MOV", "A", "R"): 0xF8, ("MOV", "R", "A"): 0xA8,
    ("MOV", "A", "@R"): 0xF0, ("MOV", "@R", "A"): 0xA0,
    ("MOV", "A", "#"): 0x23, ("MOV", "R", "#"): 0xB8, ("MOV", "@R", "#"): 0xB0,
    ("MOVX", "A", "@R"): 0x80, ("MOVX", "@R", "A"): 0x90,
    ("INC", "R"): 0x18, ("INC", "@R"): 0x10, ("DEC", "R"): 0xC8,
    ("XCH", "A", "R"): 0x28, ("XCH", "A", "@R"): 0x20,
}
for operation, immediate, indirect in [
    ("ADD", 0x03, 0x60), ("ADDC", 0x13, 0x70),
    ("ORL", 0x43, 0x40), ("ANL", 0x53, 0x50), ("XRL", 0xD3, 0xD0),
]:
    FAMILIES[operation, "A", "#"] = immediate
    FAMILIES[operation, "A", "@R"] = indirect
    FAMILIES[operation, "A", "R"] = indirect + 8
for operation, opcode in [("ORL", 0x89), ("ANL", 0x99)]:
    for port in (1, 2):
        FAMILIES[operation, f"P{port}", "#"] = opcode + port - 1


def evaluate(expression, symbols, unknown=False):
    """Evaluate integer literals, symbol names and simple assembler arithmetic."""
    def visit(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, int):
            return node.value
        if isinstance(node, ast.Name):
            if unknown and node.id not in symbols:
                return 0
            return symbols[node.id]
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -visit(node.operand)
        if isinstance(node, ast.BinOp):
            calculate = {
                ast.Add: operator.add, ast.Sub: operator.sub,
                ast.BitAnd: operator.and_,
            }[type(node.op)]
            return calculate(visit(node.left), visit(node.right))
        raise ValueError(f"unsupported expression {expression}")

    return visit(ast.parse(expression, mode="eval").body)


def assemble(source):
    lines = source.read_text(encoding="utf-8").splitlines()
    symbols = {}

    def run(first_pass):
        output = bytearray([0xFF] * 2048)
        occupied = set()
        addr = 0

        def evaluate_here(expression):
            return evaluate(expression, symbols, first_pass)

        def emit(*data):
            nonlocal addr
            for byte in data:
                if not first_pass and (addr in occupied or not 0 <= addr < len(output)):
                    raise ValueError(f"overlapping or out-of-range address 0x{addr:03x}")
                if not -128 <= byte <= 255:
                    raise ValueError(f"invalid byte {byte} at 0x{addr:03x}")
                if not first_pass:
                    output[addr] = byte & 0xFF
                occupied.add(addr)
                addr += 1

        def branch(opcode, expression):
            target = evaluate_here(expression)
            if not first_pass and target >> 8 != (addr + 1) >> 8:
                raise ValueError(f"page branch at 0x{addr:03x} crosses to 0x{target:03x}")
            emit(opcode, target & 0xFF)

        for number, line in enumerate(lines, 1):
            line = line.partition(";")[0].strip()
            if not line:
                continue
            try:
                label, separator, rest = line.partition(":")
                if separator:
                    if first_pass:
                        if label in symbols:
                            raise ValueError(f"duplicate symbol {label}")
                        symbols[label] = addr
                    line = rest.strip()
                    if not line:
                        continue
                if "=" in line:
                    name, expression = map(str.strip, line.split("="))
                    if first_pass:
                        if name in symbols:
                            raise ValueError(f"duplicate symbol {name}")
                        symbols[name] = evaluate(expression, symbols)
                    continue

                op, _, operands = line.partition(" ")
                parts = [part.strip() for part in operands.split(",")] if operands else []
                canonical = " ".join([op, ",".join(parts)]).strip()
                if op == ".org":
                    addr = evaluate(operands, symbols)
                elif op == ".byte":
                    emit(*(evaluate_here(part) for part in parts))
                elif op == ".targets":
                    emit(*(evaluate_here(part) & 0xFF for part in parts))
                    if not first_pass:
                        for part in parts:
                            target = evaluate_here(part)
                            if target >> 8 != (addr - 1) >> 8:
                                raise ValueError(f"dispatch target {part} is off page")
                elif op in ("LD", "ST"):
                    emit(0xB8, evaluate_here(operands), {"LD": 0xF0, "ST": 0xA0}[op])
                elif canonical in FIXED:
                    emit(FIXED[canonical])
                elif op in BRANCH:
                    branch(BRANCH[op], operands)
                elif op == "DJNZ":
                    branch(0xE8 + int(parts[0][1]), parts[1])
                elif op in ("JMP", "CALL"):
                    target = evaluate_here(operands)
                    if not first_pass and not 0 <= target < 2048:
                        raise ValueError(f"absolute jump to invalid address 0x{target:03x}")
                    emit((0x04 if op == "JMP" else 0x14) + ((target >> 8) << 5), target & 0xFF)
                else:
                    keys = [op]
                    register = 0
                    literal = None
                    for part in parts:
                        if re.fullmatch(r"@R[01]|R[0-7]", part):
                            register = int(part[-1])
                            keys.append(part[:-1])
                        elif part.startswith("#"):
                            keys.append("#")
                            literal = evaluate_here(part[1:])
                        else:
                            keys.append(part)
                    opcode = FAMILIES[tuple(keys)] + register
                    if literal is None:
                        emit(opcode)
                    else:
                        emit(opcode, literal)
            except (KeyError, ValueError, SyntaxError) as error:
                raise ValueError(f"{source}:{number}: {line}: {error}") from error
        return output

    run(True)
    return bytes(run(False)), symbols


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default=Path("build"), type=Path)
    args = parser.parse_args()
    rom, symbols = assemble(Path(__file__).with_name("monitor.asm"))
    digest = hashlib.sha1(rom).hexdigest()
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "cp1-monitor.bin").write_bytes(rom)
    (args.output / "cp1-monitor.sha1").write_text(f"{digest}  cp1-monitor.bin\n", encoding="utf-8")
    debug = {
        "rom_sha1": digest,
        "pre_command": symbols["pre_command"],
        "monitor_idle": symbols["monitor_idle"],
        "error_ready": symbols["error_ready"],
        "teaching_pc": symbols["PC"],
        "accumulator_high": symbols["ACCH"],
        "accumulator_low": symbols["ACCL"],
        "comparison": {"address": symbols["COMPARE"], "mask": 0x01},
        "error": {"address": symbols["ERROR"], "mask": 0x07},
        "display": {"address": symbols["FRAME"], "length": 6, "segment_mask": 0x7F},
        "symbols": symbols,
    }
    (args.output / "cp1-monitor.symbols.json").write_text(
        json.dumps(debug, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{digest}  {args.output / 'cp1-monitor.bin'}")


if __name__ == "__main__":
    main()

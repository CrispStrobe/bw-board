/** Common protected 80286 ISA oracle against an exact clean PCjs checkout. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ProtectedI80286 from "../src/experimental/i80286-protected.js";

const PIN = "c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70",
  root = process.env.PCJS_ROOT;
if (!root) throw new Error("Set PCJS_ROOT to the pinned, clean PCjs checkout");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("PCjs must match the exact clean oracle pin");
const moduleURL = (name) =>
  pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ["x86func", "x86help", "x86mods", "x86op0f", "x86ops"])
  await import(moduleURL(name));
const { default: CPU } = await import(moduleURL("cpux86")),
  { default: Bus } = await import(moduleURL("bus")),
  { default: Memory } = await import(moduleURL("memory")),
  { default: X86 } = await import(moduleURL("x86"));
class QuietBus extends Bus {
  printf() {
    return 0;
  }
}
const put = (write, address, bytes) =>
  bytes.forEach((value, i) => write(address + i, value));
const hash = (data) => createHash("sha256").update(data).digest("hex");
function install(write) {
  put(
    write,
    0,
    [0x0f, 1, 0x16, 0, 1, 0xb8, 1, 0, 0x0f, 1, 0xf0, 0xea, 0, 0, 8, 0],
  );
  put(write, 0x100, [0x1f, 0, 0, 2, 0]);
  const descriptor = (at, base, access) =>
    put(write, at, [
      0xff,
      0xff,
      base & 255,
      (base >> 8) & 255,
      (base >> 16) & 255,
      access,
      0,
      0,
    ]);
  descriptor(0x208, 0x100000, 0x9a);
  descriptor(0x210, 0x120000, 0x92);
  descriptor(0x218, 0x130000, 0x92);
  put(
    write,
    0x100000,
    [
      0xb8, 0x10, 0, 0x8e, 0xd8, 0xb8, 0x18, 0, 0x8e, 0xd0, 0xbc, 0, 2, 0xb8,
      0x2c, 1, 0xbb, 10, 0, 0xf7, 0xe3, 0xba, 0, 0, 0xbb, 3, 0, 0xf7, 0xf3,
      0x6b, 0xcb, 0xfe, 0x60, 0xb8, 0, 0, 0x61, 0xbd, 0x80, 1, 0xc8, 4, 0, 0,
      0xc9, 0xbb, 0x20, 0, 0xb0, 2, 0xd7, 0xf4,
    ],
  );
  put(write, 0x120022, [0x5a]);
}
const snapshot = (cpu, halted) => ({
  ax: (cpu.ax ?? cpu.regEAX) & 0xffff,
  bx: (cpu.bx ?? cpu.regEBX) & 0xffff,
  cx: (cpu.cx ?? cpu.regECX) & 0xffff,
  dx: (cpu.dx ?? cpu.regEDX) & 0xffff,
  bp: (cpu.bp ?? cpu.regEBP) & 0xffff,
  sp: (cpu.sp ?? cpu.getSP()) & 0xffff,
  cs: (cpu.cs ?? cpu.getCS()) & 0xffff,
  ds: (cpu.ds ?? cpu.getDS()) & 0xffff,
  ip: (cpu.ip ?? cpu.getIP()) & 0xffff,
  flags: (cpu.flags ?? cpu.getPS()) & 0x7f01,
  halted,
});
function actual() {
  const memory = new Uint8Array(1 << 24),
    cpu = new ProtectedI80286({
      read: (a) => memory[a],
      fetch: (a) => memory[a],
      write: (a, v) => (memory[a] = v),
    });
  install((a, v) => (memory[a] = v));
  Object.assign(cpu, { cs: 0, ip: 0, ss: 0, sp: 0, flags: 2 });
  for (let i = 0; i < 28; i++) cpu.step();
  return snapshot(cpu, cpu.halted);
}
function reference() {
  const cpu = new CPU({ id: "common.cpu", model: 80286 }),
    bus = new QuietBus({ id: "common.bus", busWidth: 24 }, cpu);
  if (!bus.addMemory(0, 1 << 24, Memory.TYPE.RAM))
    throw new Error("PCjs memory allocation failed");
  cpu.bus = bus;
  install((a, v) => bus.setByteDirect(a, v));
  cpu.setCS(0);
  cpu.setIP(0);
  cpu.setDS(0);
  cpu.setES(0);
  cpu.setSS(0);
  cpu.setSP(0);
  cpu.setPS(2);
  for (let i = 0; i < 28; i++) cpu.stepCPU(0);
  return snapshot(cpu, !!(cpu.intFlags & X86.INTFLAG.HALT));
}
const expected = reference(),
  observed = actual(),
  mutation = process.env.COMMON_ISA_ORACLE_MUTATION ?? null,
  differences = [];
if (mutation !== null && mutation !== "ax")
  throw new Error(`unknown COMMON_ISA_ORACLE_MUTATION: ${mutation}`);
const completion = {
  ax: 0x035a,
  bx: 0x20,
  cx: 0xfffa,
  dx: 0,
  bp: 0x180,
  sp: 0x200,
  cs: 8,
  ds: 0x10,
  halted: true,
};
for (const [engine, state] of Object.entries({
  PCjs: expected,
  owned: observed,
}))
  for (const [key, value] of Object.entries(completion))
    if (state[key] !== value)
      throw new Error(
        `${engine} guest incomplete: ${key}=${state[key].toString(16)}`,
      );
if (mutation === "ax") observed.ax ^= 1;
for (const key of Object.keys(expected))
  if (JSON.stringify(expected[key]) !== JSON.stringify(observed[key]))
    differences.push({
      field: key,
      reference: expected[key],
      actual: observed[key],
    });
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("PCjs provenance changed during comparison");
const sources = [
  "./compare-pcjs-protected286-common-isa.mjs",
  "../src/i8086.js",
  "../src/experimental/i80286-protected.js",
];
console.log(
  JSON.stringify(
    {
      oracle: "PCjs",
      revision: PIN,
      node: process.version,
      scope:
        "owned ring-0 MUL/DIV/immediate-IMUL/PUSHA/POPA/ENTER/LEAVE/XLAT guest; architectural state only",
      sourceHashes: Object.fromEntries(
        sources.map((path) => [
          path,
          hash(readFileSync(new URL(path, import.meta.url))),
        ]),
      ),
      mutation,
      status: differences.length ? "fail" : "pass",
      reference: expected,
      actual: observed,
      differences,
    },
    null,
    2,
  ),
);
process.exitCode = differences.length ? 1 : 0;

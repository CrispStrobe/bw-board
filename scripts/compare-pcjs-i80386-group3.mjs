/** Compare bounded non-faulting group-3 arithmetic with a pinned PCjs 80386. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import I80386 from "../src/experimental/i80386.js";

const PIN = "c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70";
const root = process.env.PCJS_ROOT;
if (!root) throw new Error("Set PCJS_ROOT to the pinned, clean PCjs checkout");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("PCjs must match the exact clean oracle pin");
const moduleURL = (name) =>
  pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ["x86func", "x86help", "x86mods", "x86op0f", "x86ops"])
  await import(moduleURL(name));
const { default: CPU } = await import(moduleURL("cpux86"));
const { default: Bus } = await import(moduleURL("bus"));
const { default: Memory } = await import(moduleURL("memory"));
class QuietBus extends Bus {
  printf() {
    return 0;
  }
}

const cases = [
  { name: "mul8", bytes: [0xf6, 0xe3], eax: 0xff, ebx: 2, flagMask: 0x801 },
  {
    name: "imul32",
    bytes: [0x66, 0xf7, 0xeb],
    eax: 0x80000000,
    ebx: 0xffffffff,
    flagMask: 0x801,
  },
  { name: "div16", bytes: [0xf7, 0xf3], eax: 0x101, ebx: 2, edx: 0 },
  {
    name: "idiv32",
    bytes: [0x66, 0xf7, 0xfb],
    eax: 0xfffffff9,
    ebx: 2,
    edx: 0xffffffff,
  },
  { name: "neg16", bytes: [0xf7, 0xd8], eax: 0x8000, flagMask: 0x8d5 },
];

function result(cpu, getFlags, flagMask) {
  const value = {
    eax: cpu.eax >>> 0,
    ebx: cpu.ebx >>> 0,
    edx: cpu.edx >>> 0,
  };
  if (flagMask !== undefined) value.flags = getFlags() & flagMask;
  return value;
}

function runLocal(spec) {
  const cpu = new I80386({
    read: (address) => spec.bytes[address] ?? 0,
    fetch: (address) => spec.bytes[address] ?? 0,
  });
  cpu.eax = spec.eax >>> 0;
  cpu.ebx = spec.ebx >>> 0;
  cpu.edx = (spec.edx ?? 0) >>> 0;
  cpu.step();
  return result(cpu, () => cpu.eflags, spec.flagMask);
}

function runPCjs(spec) {
  const cpu = new CPU({ id: `group3.${spec.name}`, model: 80386 });
  const bus = new QuietBus({ id: `group3.bus.${spec.name}`, busWidth: 32 }, cpu);
  if (!bus.addMemory(0, 0x10000, Memory.TYPE.RAM))
    throw new Error("PCjs memory allocation failed");
  cpu.bus = bus;
  spec.bytes.forEach((value, address) => bus.setByteDirect(address, value));
  cpu.setCS(0);
  cpu.setIP(0);
  cpu.setDS(0);
  cpu.setES(0);
  cpu.setSS(0);
  cpu.setSP(0x100);
  cpu.setPS(2);
  cpu.regEAX = spec.eax | 0;
  cpu.regEBX = spec.ebx | 0;
  cpu.regEDX = (spec.edx ?? 0) | 0;
  for (let steps = 0; cpu.getIP() < spec.bytes.length && steps < 3; steps++)
    cpu.stepCPU(0);
  if (cpu.getIP() !== spec.bytes.length)
    throw new Error(`PCjs did not complete ${spec.name}`);
  return result(
    { eax: cpu.regEAX, ebx: cpu.regEBX, edx: cpu.regEDX },
    () => cpu.getPS(),
    spec.flagMask,
  );
}

const observations = Object.fromEntries(
  cases.map((spec) => [
    spec.name,
    { reference: runPCjs(spec), actual: runLocal(spec) },
  ]),
);
const mutation = process.env.I386_GROUP3_ORACLE_MUTATION ?? null;
if (mutation === "quotient") observations.div16.actual.eax ^= 1;
else if (mutation) throw new Error(`unknown mutation ${mutation}`);
const differences = Object.entries(observations)
  .filter(([, value]) => JSON.stringify(value.reference) !== JSON.stringify(value.actual))
  .map(([name, value]) => ({ case: name, ...value }));
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("PCjs provenance changed during comparison");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sources = ["./compare-pcjs-i80386-group3.mjs", "../src/experimental/i80386.js"];
console.log(JSON.stringify({
  oracle: "PCjs",
  revision: PIN,
  executionRevision: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim(),
  scope:
    "non-faulting F6/F7 MUL/IMUL/DIV/IDIV/NEG register cases; only architecturally defined flags are graded",
  sourceHashes: Object.fromEntries(sources.map((path) => [
    path,
    hash(readFileSync(new URL(path, import.meta.url))),
  ])),
  mutation,
  status: differences.length ? "fail" : "pass",
  observations,
  differences,
}, null, 2));
process.exitCode = differences.length ? 1 : 0;

/** Compare original-386 VERR/VERW selector queries with pinned PCjs. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import I80386 from "../src/experimental/i80386.js";

const PIN = "c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70";
const root = process.env.PCJS_ROOT;
if (!root) throw new Error("Set PCJS_ROOT to the pinned, clean PCjs checkout");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const verifyPin = () => {
  if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
    throw new Error("PCjs must match the exact clean oracle pin");
};
verifyPin();
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localPathspecs = [
  "scripts/compare-pcjs-i80386-verr.mjs",
  "src/experimental/i80386.js",
];
const verifyLocal = () =>
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...localPathspecs], {
    cwd: repositoryRoot,
  });
verifyLocal();
const executionRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
const hash = data => createHash("sha256").update(data).digest("hex");
const sources = ["./compare-pcjs-i80386-verr.mjs", "../src/experimental/i80386.js"];
const sourceHashes = Object.fromEntries(
  sources.map(path => [path, hash(readFileSync(new URL(path, import.meta.url)))]),
);
const moduleURL = name =>
  pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ["x86func", "x86help", "x86mods", "x86op0f", "x86ops"])
  await import(moduleURL(name));
const { default: CPU } = await import(moduleURL("cpux86"));
const { default: Bus } = await import(moduleURL("bus"));
const { default: Memory } = await import(moduleURL("memory"));
const { default: X86 } = await import(moduleURL("x86"));
class QuietBus extends Bus { printf() { return 0; } }

const mutation = process.env.I386_VERR_ORACLE_MUTATION ?? null;
if (mutation !== null && mutation !== "zf" && mutation !== "budget")
  throw new Error(`unknown mutation ${mutation}`);
const stepLimit = mutation === "budget" ? 8 : 40;
const put = (write, at, bytes) =>
  bytes.forEach((value, index) => write(at + index, value));
const descriptor = (write, at, base, limit, access) =>
  put(write, at, [
    limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
    (limit >>> 16) & 15, base >>> 24,
  ].map(value => value & 255));

function install(write) {
  put(write, 0, [
    0x0f, 0x01, 0x16, 0x00, 0x01, // LGDT [0100]
    0xb8, 0x01, 0x00,             // MOV AX,1
    0x0f, 0x01, 0xf0,             // LMSW AX
    0xea, 0x00, 0x00, 0x08, 0x00, // JMP 0008:0000
  ]);
  put(write, 0x100, [0x27, 0x00, 0x00, 0x02, 0x00, 0x00]);
  descriptor(write, 0x208, 0x1000, 0xffff, 0x9a); // ring-0 code
  descriptor(write, 0x210, 0, 0xffff, 0x12);      // P=0 readable/writable data
  descriptor(write, 0x218, 0, 0xffff, 0x98);      // execute-only code
  descriptor(write, 0x220, 0, 0xffff, 0x82);      // system LDT descriptor
  put(write, 0x1000, [
    0x68, 0x17, 0x08, 0x9d,
    0xb8, 0x10, 0x00, 0x0f, 0x00, 0xe0, 0x9c, 0x5b,
    0x0f, 0x00, 0xe8, 0x9c, 0x59,
    0xb8, 0x13, 0x00, 0x0f, 0x00, 0xe0, 0x9c, 0x5a,
    0xb8, 0x18, 0x00, 0x0f, 0x00, 0xe0, 0x9c, 0x5e,
    0xb8, 0x20, 0x00, 0x0f, 0x00, 0xe0, 0x9c, 0x5f,
    0xb8, 0x00, 0x00, 0x0f, 0x00, 0xe8, 0x9c, 0x5d,
    0xf4,
  ]);
}

function result(cpu) {
  const local = !!cpu.segmentCaches;
  return {
    ax: cpu.eax & 0xffff,
    bx: cpu.ebx & 0xffff,
    cx: cpu.ecx & 0xffff,
    dx: cpu.edx & 0xffff,
    si: cpu.esi & 0xffff,
    di: cpu.edi & 0xffff,
    bp: cpu.ebp & 0xffff,
    cs: local ? cpu.cs : cpu.getCS(),
    eip: local ? cpu.eip : cpu.getIP(),
    halted: local ? cpu.halted : !!(cpu.intFlags & X86.INTFLAG.HALT),
  };
}
function runLocal() {
  const memory = new Uint8Array(0x2000);
  const cpu = new I80386({
    read: address => memory[address],
    fetch: address => memory[address],
    write: (address, value) => { memory[address] = value; },
  });
  install((address, value) => { memory[address] = value; });
  cpu.sp = 0x800;
  for (let steps = 0; steps < stepLimit && !cpu.halted; steps++) cpu.step();
  return result(cpu);
}
function runPCjs() {
  const cpu = new CPU({ id: "verr386.cpu", model: 80386 });
  const bus = new QuietBus({ id: "verr386.bus", busWidth: 32 }, cpu);
  if (!bus.addMemory(0, 0x2000, Memory.TYPE.RAM))
    throw new Error("PCjs memory allocation failed");
  cpu.bus = bus;
  install((address, value) => bus.setByteDirect(address, value));
  cpu.setCS(0); cpu.setIP(0); cpu.setDS(0); cpu.setES(0);
  cpu.setSS(0); cpu.setSP(0x800); cpu.setPS(2);
  for (let steps = 0; steps < stepLimit && !(cpu.intFlags & X86.INTFLAG.HALT); steps++)
    cpu.stepCPU(0);
  return result({
    eax: cpu.regEAX, ebx: cpu.regEBX, ecx: cpu.regECX, edx: cpu.regEDX,
    esi: cpu.regESI, edi: cpu.regEDI, ebp: cpu.regEBP,
    getCS: () => cpu.getCS(), getIP: () => cpu.getIP(), intFlags: cpu.intFlags,
  });
}

const reference = runPCjs();
const actual = runLocal();
if (mutation === "zf") actual.bx ^= 0x40;
const expected = {
  ax: 0, bx: 0x857, cx: 0x857, dx: 0x817,
  si: 0x817, di: 0x817, bp: 0x817,
  cs: 8, eip: 0x32, halted: true,
};
const differences = [];
for (const field of Object.keys(expected)) {
  if (reference[field] !== expected[field])
    differences.push({ field: `reference.${field}`, expected: expected[field], actual: reference[field] });
  if (actual[field] !== expected[field])
    differences.push({ field: `actual.${field}`, expected: expected[field], actual: actual[field] });
}
verifyPin();
verifyLocal();
if (
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim() !== executionRevision ||
  sources.some(path => hash(readFileSync(new URL(path, import.meta.url))) !== sourceHashes[path])
) throw new Error("local execution sources changed during comparison");
console.log(JSON.stringify({
  oracle: "PCjs", revision: PIN, executionRevision,
  scope: "owned ring-0 VERR/VERW queries of P=0 accessible data, RPL privilege rejection, execute-only code, system and null selectors; exact non-ZF flags and HLT completion",
  sourceHashes, mutation, expected,
  status: differences.length ? "fail" : "pass",
  reference, actual, differences,
}, null, 2));
process.exitCode = differences.length ? 1 : 0;

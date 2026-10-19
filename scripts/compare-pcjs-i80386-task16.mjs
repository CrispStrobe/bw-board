/** Compare an owned 286-format TSS CALL/IRET roundtrip with pinned PCjs. */
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

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const paths = ["scripts/compare-pcjs-i80386-task16.mjs", "src/experimental/i80386.js"];
const verifyLocal = () => execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...paths], { cwd: repo });
verifyLocal();
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const hash = data => createHash("sha256").update(data).digest("hex");
const sources = ["./compare-pcjs-i80386-task16.mjs", "../src/experimental/i80386.js"];
const sourceHashes = Object.fromEntries(sources.map(path => [path, hash(readFileSync(new URL(path, import.meta.url)))]));
const moduleURL = name => pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ["x86func", "x86help", "x86mods", "x86op0f", "x86ops"])
  await import(moduleURL(name));
const { default: CPU } = await import(moduleURL("cpux86"));
const { default: Bus } = await import(moduleURL("bus"));
const { default: Memory } = await import(moduleURL("memory"));
const { default: X86 } = await import(moduleURL("x86"));
class QuietBus extends Bus { printf() { return 0; } }

const mutation = process.env.I386_TASK16_ORACLE_MUTATION ?? null;
if (![null, "result", "budget"].includes(mutation)) throw new Error(`unknown mutation ${mutation}`);
const budget = mutation === "budget" ? 8 : 40;
const put = (write, address, bytes) => bytes.forEach((value, index) => write(address + index, value & 0xff));
const word = (write, address, value) => put(write, address, [value, value >>> 8]);
const descriptor = (write, address, base, limit, access) => put(write, address, [
  limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
  (limit >>> 16) & 15, base >>> 24,
]);

function install(write) {
  put(write, 0, [0x0f,0x01,0x16,0x80,0,0xb8,1,0,0x0f,0x01,0xf0,0xea,0,1,8,0]);
  put(write, 0x80, [0x27,0,0,2,0,0]);
  descriptor(write, 0x208, 0, 0xffff, 0x9a);
  descriptor(write, 0x210, 0, 0xffff, 0x92);
  descriptor(write, 0x218, 0x400, 0x2b, 0x81);
  descriptor(write, 0x220, 0x500, 0x2b, 0x81);
  put(write, 0x100, [
    0xb8,0x10,0, 0x8e,0xd0, 0x8e,0xd8, 0x8e,0xc0, 0xbc,0,8,
    0xb8,0x18,0, 0x0f,0x00,0xd8, 0x9a,0,0,0x20,0, 0xf4,
  ]);
  put(write, 0x180, [0xcf]);
  for (const [offset, value] of [
    [0x0e,0x180],[0x10,2],[0x12,0x1111],[0x14,0x2222],[0x16,0x3333],
    [0x18,0x4444],[0x1a,0x900],[0x1c,0x5555],[0x1e,0x6666],[0x20,0x7777],
    [0x22,0x10],[0x24,8],[0x26,0x10],[0x28,0x10],[0x2a,0],
  ]) word(write, 0x500 + offset, value);
}

const result = (cpu, read, local) => ({
  halted: local ? cpu.halted : !!(cpu.intFlags & X86.INTFLAG.HALT),
  cs: local ? cpu.cs : cpu.getCS(),
  eip: local ? cpu.eip : cpu.getIP(),
  tr: local ? cpu.tr.selector : cpu.segTSS.sel,
  cr3: local ? cpu.cr3 : cpu.regCR3 >>> 0,
  ax: local ? cpu.eax & 0xffff : cpu.regEAX & 0xffff,
  oldBusy: read(0x21d) & 15,
  newBusy: read(0x225) & 15,
  backlink: read(0x500) | (read(0x501) << 8),
});

function runLocal() {
  const memory = new Uint8Array(0x1000);
  const cpu = new I80386({ read: address => memory[address], fetch: address => memory[address], write: (address, value) => memory[address] = value });
  install((address, value) => memory[address] = value);
  for (let step = 0; step < budget && !cpu.halted; step++) cpu.step();
  return result(cpu, address => memory[address], true);
}

function runPCjs() {
  const cpu = new CPU({ id: "task16.cpu", model: 80386 });
  const bus = new QuietBus({ id: "task16.bus", busWidth: 32 }, cpu);
  if (!bus.addMemory(0, 0x1000, Memory.TYPE.RAM)) throw new Error("PCjs memory allocation failed");
  cpu.bus = bus;
  install((address, value) => bus.setByteDirect(address, value));
  cpu.setCS(0); cpu.setIP(0); cpu.setDS(0); cpu.setES(0); cpu.setSS(0); cpu.setSP(0x800); cpu.setPS(2);
  const trail = [];
  for (let step = 0; step < budget && !(cpu.intFlags & X86.INTFLAG.HALT); step++) {
    trail.push(`${cpu.getCS().toString(16)}:${cpu.getIP().toString(16)}`);
    try {
      cpu.stepCPU(0);
    } catch (error) {
      throw new Error(`PCjs abort at ${trail.at(-1)} raw=${String(error)} trail=${trail.join(",")}`);
    }
  }
  return result(cpu, address => bus.getByteDirect(address), false);
}

const reference = runPCjs();
const actual = runLocal();
if (mutation === "result") actual.ax ^= 1;
const expected = { halted: true, cs: 8, eip: 0x118, tr: 0x18, cr3: 0, ax: 0x18,
  oldBusy: 3, newBusy: 1, backlink: 0x18 };
const differences = [];
for (const field of Object.keys(expected)) {
  const observations = [["reference", reference[field]], ["actual", actual[field]]];
  for (const [side, value] of observations.filter(([, value]) => value !== expected[field]))
    differences.push({ field: `${side}.${field}`, expected: expected[field], actual: value });
}
verifyPin(); verifyLocal();
if (execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim() !== revision ||
    sources.some(path => hash(readFileSync(new URL(path, import.meta.url))) !== sourceHashes[path]))
  throw new Error("execution sources changed");
console.log(JSON.stringify({ oracle: "PCjs", revision, pcjsRevision: PIN,
  scope: "owned 286-format TSS CALL, nested IRET, CR3 preservation, busy/backlink and exact old-task HLT completion",
  sourceHashes, mutation, status: differences.length ? "fail" : "pass",
  expected, reference, actual, differences }, null, 2));
process.exitCode = differences.length ? 1 : 0;

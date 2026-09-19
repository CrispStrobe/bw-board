/** Compare bounded ring-0 LLDT/LTR/SLDT/STR and LDT lookup with pinned PCjs. */
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
  "scripts/compare-pcjs-i80386-system-selectors.mjs",
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
const hash = (data) => createHash("sha256").update(data).digest("hex");
const sources = ["./compare-pcjs-i80386-system-selectors.mjs", "../src/experimental/i80386.js"];
const sourceHashes = Object.fromEntries(
  sources.map((path) => [path, hash(readFileSync(new URL(path, import.meta.url)))]),
);
const moduleURL = (name) => pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ["x86func", "x86help", "x86mods", "x86op0f", "x86ops"])
  await import(moduleURL(name));
const { default: CPU } = await import(moduleURL("cpux86"));
const { default: Bus } = await import(moduleURL("bus"));
const { default: Memory } = await import(moduleURL("memory"));
class QuietBus extends Bus { printf() { return 0; } }

const put = (write, at, bytes) => bytes.forEach((value, index) => write(at + index, value));
const descriptor = (write, at, base, limit, access, flags = 0) => put(write, at, [
  limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
  ((limit >>> 16) & 15) | flags, base >>> 24,
].map((value) => value & 255));
function install(write) {
  put(write, 0, [0x0f,0x01,0x16,0x00,0x01,0xb8,1,0,0x0f,0x01,0xf0,0xea,0,0,8,0]);
  put(write, 0x100, [0x1f,0,0,2,0,0]);
  descriptor(write, 0x208, 0x1000, 0xffff, 0x9a);
  descriptor(write, 0x210, 0x300, 0x0f, 0x82);
  descriptor(write, 0x218, 0x400, 0x67, 0x89);
  descriptor(write, 0x308, 0x500, 0xffff, 0x92);
  put(write, 0x1000, [
    0xb8,0x10,0,0x0f,0x00,0xd0,0x0f,0x00,0xc3,
    0xb8,0x18,0,0x0f,0x00,0xd8,0x0f,0x00,0xc9,
    0xb8,0x0c,0,0x8e,0xd8,0xf4,
  ]);
}
function result(cpu, memory) {
  return {
    ax: cpu.eax & 0xffff, bx: cpu.ebx & 0xffff, cx: cpu.ecx & 0xffff, ds: cpu.ds & 0xffff,
    dsBase: cpu.segmentCaches?.[3]?.base ?? cpu.segDS.base,
    busyAccess: memory(0x21d),
  };
}
function runLocal() {
  const memory = new Uint8Array(0x2000);
  const cpu = new I80386({ read:a=>memory[a], fetch:a=>memory[a], write:(a,v)=>{memory[a]=v;} });
  install((a,v)=>{memory[a]=v;});
  for (let steps = 0; steps < 20 && !cpu.halted; steps++) cpu.step();
  return result(cpu, (a) => memory[a]);
}
function runPCjs() {
  const cpu = new CPU({ id:"system386.cpu", model:80386 });
  const bus = new QuietBus({ id:"system386.bus", busWidth:32 }, cpu);
  if (!bus.addMemory(0, 0x2000, Memory.TYPE.RAM)) throw new Error("PCjs memory allocation failed");
  cpu.bus=bus; install((a,v)=>bus.setByteDirect(a,v));
  cpu.setCS(0); cpu.setIP(0); cpu.setDS(0); cpu.setES(0); cpu.setSS(0); cpu.setSP(0x800); cpu.setPS(2);
  for (let steps = 0; steps < 20 && !cpu.flags.halt; steps++) cpu.stepCPU(0);
  return result({eax:cpu.regEAX,ebx:cpu.regEBX,ecx:cpu.regECX,ds:cpu.getDS(),segDS:cpu.segDS}, (a)=>bus.getByteDirect(a));
}
const reference = runPCjs();
const actual = runLocal();
const mutation = process.env.I386_SYSTEM_ORACLE_MUTATION ?? null;
if (mutation === "busy") actual.busyAccess ^= 2;
else if (mutation) throw new Error(`unknown mutation ${mutation}`);
const differences = Object.keys(reference).filter((field) => reference[field] !== actual[field]).map((field) => ({ field, reference:reference[field], actual:actual[field] }));
verifyPin();
verifyLocal();
if (
  execFileSync("git", ["rev-parse", "HEAD"], { cwd:repositoryRoot, encoding:"utf8" }).trim() !== executionRevision ||
  sources.some((path) => hash(readFileSync(new URL(path, import.meta.url))) !== sourceHashes[path])
) throw new Error("local execution sources changed during comparison");
console.log(JSON.stringify({ oracle:"PCjs", revision:PIN, executionRevision, scope:"owned ring-0 LLDT/LTR/SLDT/STR plus one LDT data load; no task switch or privilege transition", sourceHashes, mutation, status:differences.length?"fail":"pass", reference, actual, differences }, null, 2));
process.exitCode = differences.length ? 1 : 0;

/** Same-ring 80386 interrupt/trap-gate comparison against pinned PCjs. */
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

const CODE = 0x100000,
  STACK = 0x120000;
const hash = (data) => createHash("sha256").update(data).digest("hex");
const put = (write, at, bytes) =>
  bytes.forEach((value, index) => write(at + index, value));
const descriptor = (base, access) => [
  0xff,
  0xff,
  base & 255,
  (base >>> 8) & 255,
  (base >>> 16) & 255,
  access,
  0xcf,
  (base >>> 24) & 255,
];
const gate = (type) => [0x00, 0x01, 0x08, 0x00, 0, 0x80 | type, 0, 0];

function install(write, type, fault = false) {
  put(
    write,
    0,
    [
      0x0f, 0x01, 0x16, 0x00, 0x01, 0x0f, 0x01, 0x1e, 0x06, 0x01, 0x0f, 0x20,
      0xc0, 0x66, 0x83, 0xc8, 1, 0x0f, 0x22, 0xc0, 0x66, 0xea, 0, 0, 0, 0, 8, 0,
    ],
  );
  put(write, 0x100, [0x17, 0, 0, 2, 0, 0, 0xff, 7, 0, 3, 0, 0]);
  put(write, 0x208, descriptor(CODE, 0x9a));
  put(write, 0x210, descriptor(STACK, 0x92));
  put(write, 0x300 + (fault ? 13 : 0x20) * 8, gate(type));
  put(write, CODE, [
    0xb8,
    0x10,
    0,
    0,
    0,
    0x8e,
    0xd0,
    0x8e,
    0xd8,
    0xbc,
    0,
    4,
    0,
    0,
    ...(fault ? [0x2e, 0x89, 0x03, 0xf4] : [0xcd, 0x20, 0xf4]),
  ]);
  put(write, CODE + 0x100, [fault ? 0xf4 : 0xcf]);
}

function snapshot(cpu, read) {
  const esp = (cpu.esp ?? cpu.regESP) >>> 0;
  const dword = (address) =>
    (read(address) |
      (read(address + 1) << 8) |
      (read(address + 2) << 16) |
      (read(address + 3) * 0x1000000)) >>>
    0;
  return {
    cs: (cpu.cs ?? cpu.getCS()) & 0xffff,
    eip: (cpu.eip ?? cpu.getIP()) >>> 0,
    esp,
    flags: (cpu.eflags ?? cpu.getPS()) & 0x10300,
    frame: [0, 4, 8, 12].map((delta) => dword(STACK + esp + delta)),
  };
}

function runLocal(type, fault = false) {
  const memory = new Uint8Array(1 << 24);
  const cpu = new I80386(
    {
      read: (a) => memory[a],
      fetch: (a) => memory[a],
      write: (a, v) => {
        memory[a] = v;
      },
    },
    { deliverFaults: true },
  );
  install(
    (a, v) => {
      memory[a] = v;
    },
    type,
    fault,
  );
  for (
    let steps = 0;
    steps < 30 && !(cpu.cs === 8 && cpu.eip === 0x100);
    steps++
  ) {
    if (cpu.cs === 8 && cpu.eip === 14) {
      cpu.eflags |= 0x300;
      cpu.ebx = 0x20;
    }
    cpu.step();
  }
  const entry = snapshot(cpu, (a) => memory[a]);
  if (fault) return { entry };
  cpu.step();
  return { entry, returned: snapshot(cpu, (a) => memory[a]) };
}

function runPCjs(type, fault = false) {
  const cpu = new CPU({ id: `fault386.${type}`, model: 80386 });
  const bus = new QuietBus({ id: `fault386.bus.${type}`, busWidth: 32 }, cpu);
  if (!bus.addMemory(0, 1 << 24, Memory.TYPE.RAM))
    throw new Error("PCjs memory allocation failed");
  cpu.bus = bus;
  install((a, v) => bus.setByteDirect(a, v), type, fault);
  cpu.setCS(0);
  cpu.setIP(0);
  cpu.setDS(0);
  cpu.setES(0);
  cpu.setSS(0);
  cpu.setSP(0);
  cpu.setPS(2);
  for (
    let steps = 0;
    steps < 30 && !(cpu.getCS() === 8 && cpu.getIP() === 0x100);
    steps++
  ) {
    if (cpu.getCS() === 8 && cpu.getIP() === 14) {
      cpu.setPS(cpu.getPS() | 0x300);
      cpu.regEBX = 0x20;
    }
    try {
      cpu.stepCPU(0);
    } catch (error) {
      if (!(
        fault &&
        error === 13 &&
        cpu.getCS() === 8 &&
        cpu.getIP() === 0x100
      ))
        throw error;
    }
  }
  const view = {
    get cs() {
      return cpu.getCS();
    },
    get eip() {
      return cpu.getIP();
    },
    get esp() {
      return cpu.getSP();
    },
    get eflags() {
      return cpu.getPS();
    },
  };
  const entry = snapshot(view, (a) => bus.getByteDirect(a));
  if (fault) return { entry };
  cpu.stepCPU(0);
  return { entry, returned: snapshot(view, (a) => bus.getByteDirect(a)) };
}

const cases = {};
for (const [name, type] of [
  ["interrupt32", 14],
  ["trap32", 15],
])
  cases[name] = { reference: runPCjs(type), actual: runLocal(type) };
cases.generalProtection = {
  reference: runPCjs(14, true),
  actual: runLocal(14, true),
};
const mutation = process.env.I386_FAULT_ORACLE_MUTATION ?? null;
if (mutation === "frame") cases.interrupt32.actual.entry.frame[0] ^= 1;
else if (mutation === "if") cases.trap32.actual.entry.flags ^= 0x200;
else if (mutation)
  throw new Error(`unknown I386_FAULT_ORACLE_MUTATION: ${mutation}`);
const differences = [];
for (const [name, value] of Object.entries(cases)) {
  const reference = structuredClone(value.reference);
  const actual = structuredClone(value.actual);
  if (name === "generalProtection") {
    reference.entry.frame[3] &= ~0x10000;
    actual.entry.frame[3] &= ~0x10000;
  }
  if (JSON.stringify(reference) !== JSON.stringify(actual))
    differences.push({ case: name, ...value });
}
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("PCjs provenance changed during comparison");
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sources = [
  "./compare-pcjs-protected386-faults.mjs",
  "../src/experimental/i80386.js",
];
console.log(
  JSON.stringify(
    {
      oracle: "PCjs",
      revision: PIN,
      executionRevision: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: repositoryRoot,
        encoding: "utf8",
      }).trim(),
      node: process.version,
      scope:
        "same-ring ring-0 80386 32-bit interrupt/trap gates, IRET, and #GP restart/error frame; architectural state only",
      knownOracleLimitations: {
        resumeFlag: {
          graded: false,
          pcjsObserved: cases.generalProtection.reference.entry.frame[3] >>> 0,
          intel386Expected: "RF set in the saved EFLAGS image for a fault",
          localObserved: cases.generalProtection.actual.entry.frame[3] >>> 0,
        },
      },
      sourceHashes: Object.fromEntries(
        sources.map((path) => [
          path,
          hash(readFileSync(new URL(path, import.meta.url))),
        ]),
      ),
      mutation,
      status: differences.length ? "fail" : "pass",
      cases,
      differences,
    },
    null,
    2,
  ),
);
process.exitCode = differences.length ? 1 : 0;

/** Bounded original-386 paging comparison against pinned PCjs. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import I80386 from "../src/experimental/i80386.js";

const PIN = "c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70",
  root = process.env.PCJS_ROOT;
if (!root) throw new Error("Set PCJS_ROOT to the pinned, clean PCjs checkout");
const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("PCjs pin/clean check failed");
const url = (name) =>
  pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${name}.js`)).href;
for (const name of ["x86func", "x86help", "x86mods", "x86op0f", "x86ops"])
  await import(url(name));
const { default: CPU } = await import(url("cpux86"));
const { default: Bus } = await import(url("bus"));
const { default: Memory } = await import(url("memory"));
class QuietBus extends Bus {
  printf() {
    return 0;
  }
}

const CODE = 0x100000,
  STACK = 0x120000;
const put = (write, at, bytes) =>
  bytes.forEach((value, index) => write(at + index, value & 255));
const dword = (read, at) =>
  (read(at) |
    (read(at + 1) << 8) |
    (read(at + 2) << 16) |
    (read(at + 3) * 0x1000000)) >>>
  0;
const putDword = (write, at, value) =>
  put(write, at, [value, value >>> 8, value >>> 16, value >>> 24]);
const descriptor = (base, access) => [
  0xff,
  0xff,
  base,
  base >>> 8,
  base >>> 16,
  access,
  0xcf,
  base >>> 24,
];

function install(write) {
  put(
    write,
    0,
    [
      0x0f, 0x01, 0x16, 0, 1, 0x0f, 0x01, 0x1e, 6, 1, 0x0f, 0x20, 0xc0, 0x66,
      0x83, 0xc8, 1, 0x0f, 0x22, 0xc0, 0x66, 0xea, 0, 0, 0, 0, 8, 0,
    ],
  );
  put(write, 0x100, [0x1f, 0, 0, 2, 0, 0, 0xff, 7, 0, 3, 0, 0]);
  put(write, 0x208, descriptor(CODE, 0x9a));
  put(write, 0x210, descriptor(STACK, 0x92));
  put(write, 0x218, descriptor(0, 0x92));
  put(write, 0x300 + 14 * 8, [0x00, 0x01, 0x08, 0, 0, 0x8e, 0, 0]);
  put(
    write,
    CODE,
    [
      0xb8, 0x10, 0, 0, 0, 0x8e, 0xd0, 0xb8, 0x18, 0, 0, 0, 0x8e, 0xd8, 0xbc, 0,
      4, 0, 0, 0xb8, 0, 0x10, 0, 0, 0x0f, 0x22, 0xd8, 0xb8, 1, 0, 0, 0x80, 0x0f,
      0x22, 0xc0, 0xbb, 0, 0, 0x30, 0, 0x8b, 0x03, 0x89, 0xc2, 0xb8, 0, 0x40, 0,
      0, 0x0f, 0x22, 0xd8, 0x8b, 0x0b, 0xbb, 0, 0x80, 0, 0, 0x8b, 0x03,
    ],
  );
  put(write, CODE + 0x100, [0xf4]);
  for (const [directory, table, data] of [
    [0x1000, 0x2000, 0x600000],
    [0x4000, 0x5000, 0x700000],
  ]) {
    putDword(write, directory, table | 7);
    for (let page = 0; page < 0x200; page++)
      if (page !== 8) putDword(write, table + page * 4, (page * 0x1000) | 7);
    putDword(write, table + 0x300 * 4, data | 7);
  }
  putDword(write, 0x600000, 0x11223344);
  putDword(write, 0x700000, 0x55667788);
}

function snap(cpu, read) {
  const esp = (cpu.esp ?? cpu.getSP()) >>> 0;
  return {
    edx: (cpu.edx ?? cpu.regEDX) >>> 0,
    ecx: (cpu.ecx ?? cpu.regECX) >>> 0,
    cr2: (cpu.cr2 ?? cpu.regCR2) >>> 0,
    eip: (cpu.eip ?? cpu.getIP()) >>> 0,
    esp,
    frame: [0, 4, 8, 12].map((n) => dword(read, STACK + esp + n)),
  };
}
function local() {
  const memory = new Uint8Array(1 << 24),
    cpu = new I80386(
      {
        read: (a) => memory[a],
        fetch: (a) => memory[a],
        write: (a, v) => {
          memory[a] = v;
        },
      },
      { deliverFaults: true },
    );
  install((a, v) => {
    memory[a] = v;
  });
  for (let n = 0; n < 50 && cpu.eip !== 0x100; n++) cpu.step();
  return snap(cpu, (a) => memory[a]);
}
function reference() {
  const cpu = new CPU({ id: "paging386.cpu", model: 80386 }),
    bus = new QuietBus({ id: "paging386.bus", busWidth: 32 }, cpu);
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
  for (let n = 0; n < 50 && cpu.getIP() !== 0x100; n++)
    try {
      cpu.stepCPU(0);
    } catch (error) {
      if (!(error === 14 && cpu.getIP() === 0x100)) throw error;
    }
  return snap(
    {
      get edx() {
        return cpu.regEDX;
      },
      get ecx() {
        return cpu.regECX;
      },
      get cr2() {
        return cpu.regCR2;
      },
      get eip() {
        return cpu.getIP();
      },
      get esp() {
        return cpu.getSP();
      },
    },
    (a) => bus.getByteDirect(a),
  );
}
const referenceState = reference(),
  actualState = local(),
  mutation = process.env.I386_PAGING_ORACLE_MUTATION ?? null;
if (mutation === "cr2") actualState.cr2 ^= 0x1000;
else if (mutation) throw new Error(`unknown mutation ${mutation}`);
const comparedReference = structuredClone(referenceState),
  comparedActual = structuredClone(actualState);
comparedReference.frame[3] &= ~0x10000;
comparedActual.frame[3] &= ~0x10000;
const differences = Object.keys(comparedReference)
  .filter(
    (key) =>
      JSON.stringify(comparedReference[key]) !==
      JSON.stringify(comparedActual[key]),
  )
  .map((field) => ({
    field,
    reference: referenceState[field],
    actual: actualState[field],
  }));
const expected = {
  edx: 0x11223344,
  ecx: 0x55667788,
  cr2: 0x8000,
  eip: 0x100,
  esp: 0x3f0,
};
for (const [engine, state] of [
  ["pcjs", referenceState],
  ["local", actualState],
]) {
  for (const [field, value] of Object.entries(expected))
    if (state[field] !== value)
      differences.push({
        field: `completion:${engine}:${field}`,
        reference: value,
        actual: state[field],
      });
  if (JSON.stringify(state.frame.slice(0, 3)) !== JSON.stringify([0, 59, 8]))
    differences.push({
      field: `completion:${engine}:frame`,
      reference: [0, 59, 8],
      actual: state.frame.slice(0, 3),
    });
}
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("PCjs provenance changed during comparison");
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sources = [
  "./compare-pcjs-protected386-paging.mjs",
  "../src/experimental/i80386.js",
];
const hash = (data) => createHash("sha256").update(data).digest("hex");
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
        "owned ring-0 4KiB paging guest: CR3 remap, reads, delivered #PF/CR2/frame; no timing/TLB claim",
      knownOracleLimitations: {
        resumeFlag: {
          graded: false,
          pcjsObserved: referenceState.frame[3],
          intel386Expected: "RF set in saved EFLAGS for #PF",
          localObserved: actualState.frame[3],
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
      reference: referenceState,
      actual: actualState,
      differences,
    },
    null,
    2,
  ),
);
process.exitCode = differences.length ? 1 : 0;

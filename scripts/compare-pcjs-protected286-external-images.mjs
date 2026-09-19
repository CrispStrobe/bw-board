/** Differential execution of unchanged, pinned JA1UMI 80286 boot sectors. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ACCEPTED_IMAGES,
  DIAGNOSTIC_IMAGES,
  loadPinnedImages,
  runInt4TaskGateDiagnostic,
  runImage,
} from "./lib/protected286-external-images.mjs";
import { createOwnedExternal286Engine } from "./lib/protected286-owned-engine.mjs";

const PCJS_PIN = "c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70";
const pcjsRoot = process.env.PCJS_ROOT;
if (!pcjsRoot)
  throw new Error("Set PCJS_ROOT to the pinned, clean PCjs checkout");
const git = (...args) =>
  execFileSync("git", args, { cwd: pcjsRoot, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== PCJS_PIN || git("status", "--porcelain"))
  throw new Error("PCjs must match the exact clean oracle pin");
const moduleURL = (name) =>
  pathToFileURL(resolve(pcjsRoot, `machines/pcx86/modules/v2/${name}.js`)).href;
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

const flagsMask = 0x7fd7;
export function pcjsEngine(id) {
  const cpu = new CPU({ id: `${id}.cpu`, model: 80286 });
  const bus = new QuietBus({ id: `${id}.bus`, busWidth: 24 }, cpu);
  if (!bus.addMemory(0, 1 << 24, Memory.TYPE.RAM))
    throw new Error("PCjs memory allocation failed");
  cpu.bus = bus;
  return {
    memorySize: 1 << 24,
    clear: () => {},
    read: (address) => bus.getByteDirect(address),
    write: (address, value) => bus.setByteDirect(address, value),
    range: (address, length) =>
      Buffer.from(
        Array.from({ length }, (_, index) =>
          bus.getByteDirect(address + index),
        ),
      ),
    video: () =>
      Buffer.from(
        Array.from({ length: 4000 }, (_, index) =>
          bus.getByteDirect(0xb8000 + index),
        ),
      ),
    textRow: (row) =>
      String.fromCharCode(
        ...Array.from({ length: 80 }, (_, column) =>
          bus.getByteDirect(0xb8000 + (row * 80 + column) * 2),
        ),
      ),
    setRetraceInput: (handler) => bus.addPortInputNotify(0x3da, 0x3da, handler),
    boot: () => {
      cpu.setCS(0);
      cpu.setIP(0x7c00);
      cpu.setDS(0);
      cpu.setES(0);
      cpu.setSS(0);
      cpu.setSP(0x8000);
      cpu.setPS(2);
    },
    step: () => cpu.stepCPU(0),
    pc: () => (cpu.segCS.base + cpu.getIP()) & 0xffffff,
    tr: () => cpu.segTSS.sel,
    snapshot: () => ({
      ax: cpu.regEAX & 0xffff,
      bx: cpu.regEBX & 0xffff,
      cx: cpu.regECX & 0xffff,
      dx: cpu.regEDX & 0xffff,
      sp: cpu.getSP() & 0xffff,
      bp: cpu.regEBP & 0xffff,
      si: cpu.regESI & 0xffff,
      di: cpu.regEDI & 0xffff,
      cs: cpu.getCS() & 0xffff,
      ds: cpu.getDS() & 0xffff,
      es: cpu.getES() & 0xffff,
      ss: cpu.getSS() & 0xffff,
      ip: cpu.getIP() & 0xffff,
      flags: cpu.getPS() & flagsMask,
      cpl: cpu.nCPL,
      tr: cpu.segTSS.sel & 0xffff,
      ldtr: cpu.segLDT.sel & 0xffff,
      msw: cpu.regCR0 & 0xf,
    }),
  };
}

const fixtures = loadPinnedImages();
const reference = {};
const observed = {};
const sectorByteDifferences = {};
for (const name of ACCEPTED_IMAGES) {
  const bytes = fixtures.images.get(name);
  const referenceEngine = pcjsEngine(`external.${name}`);
  const observedEngine = createOwnedExternal286Engine();
  reference[name] = runImage(referenceEngine, name, bytes);
  observed[name] = runImage(observedEngine, name, bytes);
  sectorByteDifferences[name] = [];
  const referenceSector = referenceEngine.range(0x7c00, 512);
  const observedSector = observedEngine.range(0x7c00, 512);
  for (let offset = 0; offset < 512; offset++)
    if (referenceSector[offset] !== observedSector[offset])
      sectorByteDifferences[name].push({
        offset,
        reference: referenceSector[offset],
        actual: observedSector[offset],
      });
  reference[name].inputSha256 = observed[name].inputSha256 =
    fixtures.manifest.images.find((entry) => entry.file === name).sha256;
}
const ownedDiagnostic = runInt4TaskGateDiagnostic(
  createOwnedExternal286Engine(),
  fixtures.images.get("int4_tgate.img"),
);
const mutation = process.env.EXTERNAL286_ORACLE_MUTATION ?? null;
if (
  mutation !== null &&
  !["video", "taskreturn", "fixturehash", "sector", "taskstate"].includes(
    mutation,
  )
)
  throw new Error(`unknown EXTERNAL286_ORACLE_MUTATION: ${mutation}`);
if (mutation === "video") observed["hellop.img"].videoSha256 = "0".repeat(64);
if (mutation === "taskreturn")
  observed["tasksw.img"].trSequence[
    observed["tasksw.img"].trSequence.length - 1
  ] ^= 8;
if (mutation === "fixturehash")
  observed["ptr_validn.img"].inputSha256 = "0".repeat(64);
if (mutation === "sector") {
  observed["hellop.img"].sectorSha256 = "0".repeat(64);
  sectorByteDifferences["hellop.img"].push({
    offset: 0,
    reference: 0xea,
    actual: 0,
  });
}
if (mutation === "taskstate") observed["tasksw.img"].taskState.task1.sp ^= 2;

for (const engine of [reference, observed])
  if (engine["cgatep.img"].sp !== 0x7d2e)
    throw new Error(
      "cgatep.img: RETF 2 did not restore the pre-call ring-3 SP",
    );

const knownOracleDifferences = [
  {
    images: ["callgate.img", "cgatep.img"],
    fields: ["ds", "es"],
    reference: { ds: 0x10, es: 0x28 },
    actual: { ds: 0, es: 0 },
    reason:
      "PCjs omits the 286 outer-RETF invalidation of inaccessible data segments",
  },
  {
    images: ["tasksw.img", "taskgate.img"],
    field: "flags",
    reference: 0x0046,
    actual: 0x3046,
    reason: "PCjs drops IOPL=3 while loading the dispatcher TSS FLAGS image",
  },
  {
    images: ["tasksw.img", "taskgate.img"],
    field: "taskState and sector bytes",
    reference: "sets NT in outgoing tasks and saves phantom 82f8/81fc stacks",
    actual: "clears outgoing NT and saves unchanged task stacks 8300/8200",
    reason:
      "Intel 286 task-return state saves have no inter-task stack frame and clear outgoing NT",
  },
];
const expectedTaskState = {
  dispatcher: { backlink: 0, flags: 0x3046, sp: 0x83fe },
  task1: { backlink: 0x38, flags: 0x0046, sp: 0x8300 },
  task2: { backlink: 0x38, flags: 0x0046, sp: 0x8200 },
  descriptorAccess: {
    initial: 0xe1,
    dispatcher: 0xe3,
    task1: 0xe1,
    task2: 0xe1,
  },
};
const expectedSectorDifferences = {
  "tasksw.img": [
    [0xa0, 0x00, 0x30],
    [0xcc, 0x40, 0x00],
    [0xd5, 0xf8, 0x00],
    [0xd6, 0x82, 0x83],
    [0xf8, 0x40, 0x00],
    [0x101, 0xfc, 0x00],
    [0x102, 0x81, 0x82],
  ],
  "taskgate.img": [
    [0xb8, 0x00, 0x30],
    [0xe4, 0x40, 0x00],
    [0xed, 0xf8, 0x00],
    [0xee, 0x82, 0x83],
    [0x110, 0x40, 0x00],
    [0x119, 0xfc, 0x00],
    [0x11a, 0x81, 0x82],
  ],
};
const unexpectedDifferences = [];
for (const name of ACCEPTED_IMAGES) {
  const expected = reference[name];
  const actual = observed[name];
  for (const key of Object.keys(expected)) {
    if (["steps", "taskState"].includes(key)) continue;
    if (["tasksw.img", "taskgate.img"].includes(name) && key === "sectorSha256")
      continue;
    if (
      ["callgate.img", "cgatep.img"].includes(name) &&
      ["ds", "es"].includes(key)
    )
      continue;
    if (["tasksw.img", "taskgate.img"].includes(name) && key === "flags")
      continue;
    if (JSON.stringify(expected[key]) !== JSON.stringify(actual[key]))
      unexpectedDifferences.push({
        image: name,
        field: key,
        reference: expected[key],
        actual: actual[key],
      });
  }
}
for (const name of ACCEPTED_IMAGES.filter(
  (name) => !["tasksw.img", "taskgate.img"].includes(name),
))
  if (sectorByteDifferences[name].length)
    unexpectedDifferences.push({ image: name, field: "sectorByteDifferences" });
for (const name of ["callgate.img", "cgatep.img"])
  if (
    reference[name].ds !== 0x10 ||
    reference[name].es !== 0x28 ||
    observed[name].ds !== 0 ||
    observed[name].es !== 0
  )
    unexpectedDifferences.push({
      image: name,
      field: "known outer-RETF data invalidation",
    });
for (const name of ["tasksw.img", "taskgate.img"]) {
  const compact = sectorByteDifferences[name].map(
    ({ offset, reference, actual }) => [offset, reference, actual],
  );
  if (
    reference[name].flags !== 0x0046 ||
    observed[name].flags !== 0x3046 ||
    JSON.stringify(observed[name].taskState) !==
      JSON.stringify(expectedTaskState) ||
    JSON.stringify(compact) !== JSON.stringify(expectedSectorDifferences[name])
  )
    unexpectedDifferences.push({
      image: name,
      field: "known task-state oracle differences",
    });
}
if (git("rev-parse", "HEAD") !== PCJS_PIN || git("status", "--porcelain"))
  throw new Error("PCjs provenance changed during comparison");
const hash = (path) =>
  createHash("sha256")
    .update(readFileSync(new URL(path, import.meta.url)))
    .digest("hex");
const sourcePaths = [
  "./compare-pcjs-protected286-external-images.mjs",
  "./lib/protected286-external-images.mjs",
  "./lib/protected286-owned-engine.mjs",
  "../src/i8086.js",
  "../src/experimental/i80286-protected.js",
];
console.log(
  JSON.stringify(
    {
      oracle: "PCjs",
      revision: PCJS_PIN,
      inputRevision: fixtures.manifest.revision,
      manifestSha256: fixtures.manifestSha256,
      node: process.version,
      scope:
        "seven unchanged 512-byte protected-286 boot sectors; terminal-loop or repeated task-return semantic completion; architectural state, complete text VRAM, and mutated sector state",
      acceptedImages: ACCEPTED_IMAGES,
      diagnosticImages: DIAGNOSTIC_IMAGES.map((name) => ({
        name,
        ownedAccepted: true,
        ownedResult: ownedDiagnostic,
        referenceAccepted: false,
        reason:
          "PCjs resets with numeric -1 during the cross-privilege task-gate path",
      })),
      knownOracleDifferences,
      sectorByteDifferences,
      sourceHashes: Object.fromEntries(
        sourcePaths.map((path) => [path, hash(path)]),
      ),
      mutation,
      status: unexpectedDifferences.length
        ? "fail"
        : "pass-with-known-oracle-differences",
      reference,
      observed,
      unexpectedDifferences,
    },
    null,
    2,
  ),
);
process.exitCode = unexpectedDifferences.length ? 1 : 0;

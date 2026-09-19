import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../test/fixtures/ja1umi-286",
);
export const TASK_TR_SEQUENCE = [
  0x30, 0x38, 0x40, 0x38, 0x48, 0x38, 0x40, 0x38,
];
export const FINITE_EXPECTATIONS = Object.freeze({
  "hellop.img": "Hello, Protected World!",
  "callgate.img": "Hello from ring (3) via Call Gate !",
  "cgatep.img": "Hello from ring (3) via Call Gate !",
  "ptr_validn.img": "RPL adjusted to 3.",
  "stakp.img": "Hello, Protected World!",
});
export const ACCEPTED_IMAGES = Object.freeze([
  ...Object.keys(FINITE_EXPECTATIONS),
  "tasksw.img",
  "taskgate.img",
]);
export const DIAGNOSTIC_IMAGES = Object.freeze(["int4_tgate.img"]);
const EXPECTED_REPOSITORY = "https://github.com/ja1umi/80286_programming";
const EXPECTED_REVISION = "3ee4c6f1178e71db8926caf999416af7f4e340b3";
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

export function loadPinnedImages(root = ROOT) {
  const manifestBytes = readFileSync(resolve(root, "manifest.json"));
  const manifest = JSON.parse(manifestBytes);
  const expectedNames = [...ACCEPTED_IMAGES, ...DIAGNOSTIC_IMAGES].sort();
  const actualNames = manifest.images.map((entry) => entry.file).sort();
  if (
    manifest.schemaVersion !== 1 ||
    manifest.repository !== EXPECTED_REPOSITORY ||
    manifest.revision !== EXPECTED_REVISION ||
    manifest.license !== "MIT" ||
    JSON.stringify(actualNames) !== JSON.stringify(expectedNames) ||
    new Set(actualNames).size !== actualNames.length
  )
    throw new Error("fixture manifest identity or complete image set mismatch");
  const images = new Map();
  for (const entry of manifest.images) {
    const bytes = readFileSync(resolve(root, entry.file));
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256)
      throw new Error(`${entry.file}: pinned fixture hash/length mismatch`);
    images.set(entry.file, bytes);
  }
  const license = readFileSync(resolve(root, "LICENSE"));
  if (sha256(license) !== manifest.licenseSha256)
    throw new Error("pinned fixture license hash mismatch");
  return { manifest, manifestSha256: sha256(manifestBytes), images };
}

export function bootImage(engine, bytes) {
  engine.clear();
  bytes.forEach((value, index) => engine.write(0x7c00 + index, value));
  engine.boot();
}

const samePrefix = (actual, expected) =>
  actual.length <= expected.length &&
  actual.every((value, index) => value === expected[index]);

export function runImage(engine, name, bytes, { maxSteps = 50000 } = {}) {
  bootImage(engine, bytes);
  const trSequence = [];
  const taskFrames = [];
  let previousTr = 0;
  let retraceReads = 0;
  engine.setRetraceInput(() => (++retraceReads & 1 ? 0 : 8));
  for (let steps = 0; steps < maxSteps; steps++) {
    if (
      name in FINITE_EXPECTATIONS &&
      engine.read(engine.pc()) === 0xeb &&
      engine.read(engine.pc() + 1) === 0xfe
    ) {
      const snapshot = engine.snapshot();
      const text = engine.textRow(0);
      if (!text.startsWith(FINITE_EXPECTATIONS[name]))
        throw new Error(
          `${name}: terminal loop reached with incomplete video output`,
        );
      return {
        name,
        kind: "finite",
        steps,
        retraceReads,
        text,
        videoSha256: sha256(engine.video()),
        sectorSha256: sha256(engine.range(0x7c00, 512)),
        ...snapshot,
      };
    }
    engine.step();
    if (name === "tasksw.img" || name === "taskgate.img") {
      const tr = engine.tr() & 0xffff;
      if (tr && tr !== previousTr) {
        previousTr = tr;
        trSequence.push(tr);
        if (!samePrefix(trSequence, TASK_TR_SEQUENCE))
          throw new Error(
            `${name}: unexpected task dispatch sequence ${trSequence.join(",")}`,
          );
        if (tr === 0x38 && trSequence.length >= 4)
          taskFrames.push(Buffer.from(engine.video()));
      }
      if (trSequence.length === TASK_TR_SEQUENCE.length) {
        const snapshot = engine.snapshot();
        if (taskFrames.length !== 3)
          throw new Error(`${name}: incomplete task return history`);
        assertTaskFrames(name, taskFrames);
        return {
          name,
          kind: "tasks",
          steps: steps + 1,
          retraceReads,
          trSequence,
          taskFrameHashes: taskFrames.map(sha256),
          taskState: taskState(engine, name),
          videoSha256: sha256(engine.video()),
          sectorSha256: sha256(engine.range(0x7c00, 512)),
          ...snapshot,
        };
      }
    }
  }
  throw new Error(
    `${name}: semantic completion not reached in ${maxSteps} steps`,
  );
}

function taskState(engine, name) {
  const bases =
    name === "tasksw.img"
      ? { dispatcher: 0x8f, task1: 0xbb, task2: 0xe7 }
      : { dispatcher: 0xa7, task1: 0xd3, task2: 0xff };
  const byte = (offset) => engine.read(0x7c00 + offset);
  const word = (offset) => byte(offset) | (byte(offset + 1) << 8);
  const tss = (base) => ({
    backlink: word(base),
    flags: word(base + 0x10),
    sp: word(base + 0x1a),
  });
  return {
    dispatcher: tss(bases.dispatcher),
    task1: tss(bases.task1),
    task2: tss(bases.task2),
    descriptorAccess: {
      initial: byte(0x3a),
      dispatcher: byte(0x42),
      task1: byte(0x4a),
      task2: byte(0x52),
    },
  };
}

export function runInt4TaskGateDiagnostic(
  engine,
  bytes,
  { maxSteps = 1000 } = {},
) {
  bootImage(engine, bytes);
  engine.setRetraceInput(() => 0);
  const expectedTr = [0x30, 0x38, 0x30, 0x38, 0x30];
  const expectedCpl = [0, 0, 3, 0, 3];
  const trSequence = [];
  const cplSequence = [];
  let previousTr = 0;
  for (let steps = 0; steps < maxSteps; steps++) {
    engine.step();
    const tr = engine.tr() & 0xffff;
    if (tr && tr !== previousTr) {
      previousTr = tr;
      trSequence.push(tr);
      cplSequence.push(engine.snapshot().cpl);
      if (
        !samePrefix(trSequence, expectedTr) ||
        !samePrefix(cplSequence, expectedCpl)
      )
        throw new Error(
          "int4_tgate.img: unexpected task/CPL transition sequence",
        );
      if (trSequence.length === expectedTr.length) {
        const text = engine.textRow(0);
        if (!text.startsWith("INTO"))
          throw new Error(
            "int4_tgate.img: repeated task return lacked guest output",
          );
        return {
          name: "int4_tgate.img",
          accepted: true,
          referenceComparison: false,
          steps: steps + 1,
          trSequence,
          cplSequence,
          text,
          videoSha256: sha256(engine.video()),
          sectorSha256: sha256(engine.range(0x7c00, 512)),
          ...engine.snapshot(),
        };
      }
    }
  }
  throw new Error(
    `int4_tgate.img: two backlink returns not reached in ${maxSteps} steps`,
  );
}

function assertTaskFrames(name, frames) {
  const cell = (frame, row, column) => [
    frame[(row * 80 + column) * 2],
    frame[(row * 80 + column) * 2 + 1],
  ];
  for (let column = 0; column < 3; column++) {
    if (cell(frames[0], 0, column).join() !== [0xdb, 0x14].join())
      throw new Error(`${name}: first task did not paint red row-0 cells`);
    if (cell(frames[1], 1, column).join() !== [0xdb, 0x12].join())
      throw new Error(`${name}: second task did not paint green row-1 cells`);
    if (cell(frames[2], 0, column).join() !== [0xdb, 0x14].join())
      throw new Error(
        `${name}: resumed first task did not repaint row-0 cells`,
      );
  }
}

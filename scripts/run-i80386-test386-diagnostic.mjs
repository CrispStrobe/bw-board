/** Run the pinned external test386 capture ROM to the first bounded blocker. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import I80386, { UnsupportedI80386 } from "../src/experimental/i80386.js";

const PROFILES = {
  capture64: {
    bytes: 65536,
    sha256: "3c4859cac2235f6ef5e8dbf3d706d8226ad860e2a624be3f9751981fadca4067",
    errorOffsets: [0xfe7f, 0xfe86],
    completionPcOffset: 0xfe7d,
  },
  rom128: {
    bytes: 131072,
    sha256: "168acf93a07cd637ad24e4bd21aacc890d9ebcdfc8a56f564b2193978104fca8",
    errorOffsets: [0x1ff53, 0x1ff5a],
    completionPcOffset: 0x1ff51,
  },
};
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((value, i, all) =>
      value.startsWith("--") ? [value.slice(2), all[i + 1]] : null,
    )
    .filter(Boolean),
);
if (!args.rom || !args.provenance || !args.source || !args.out) {
  throw new Error("usage: --rom FILE --provenance FILE --source DIR --out FILE [--profile capture64|rom128] [--budget N]");
}
const profileName = args.profile ?? "capture64";
const profile = PROFILES[profileName];
if (!profile) throw new Error("--profile must be capture64 or rom128");
const budget = args.budget === undefined ? 2_000_000 : Number(args.budget);
if (!Number.isSafeInteger(budget) || budget < 1 || budget > 30_000_000) {
  throw new Error("--budget must be a positive integer no greater than 30000000");
}
const hash = (data) => createHash("sha256").update(data).digest("hex");
const rom = readFileSync(resolve(args.rom));
const provenanceBytes = readFileSync(resolve(args.provenance));
const provenance = JSON.parse(provenanceBytes);
if (
  rom.length !== profile.bytes ||
  hash(rom) !== profile.sha256 ||
  provenance.binarySha256 !== profile.sha256 ||
  provenance.revision !== "cfd052d1e64d5375dea5a681c1eadeed64ceda2c"
) {
  throw new Error("test386 input provenance mismatch");
}
const sourceRoot = resolve(args.source);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localSources = ["./run-i80386-test386-diagnostic.mjs", "../src/experimental/i80386.js"];
const localPathspecs = [
  "scripts/run-i80386-test386-diagnostic.mjs",
  "src/experimental/i80386.js",
];
const localSourceHashes = Object.fromEntries(
  localSources.map((path) => [
    path,
    hash(readFileSync(new URL(path, import.meta.url))),
  ]),
);
const git = (cwd, ...gitArgs) =>
  execFileSync("git", gitArgs, { cwd, encoding: "utf8" }).trim();
const verifyLocalClean = () =>
  execFileSync("git", ["diff", "--quiet", "HEAD", "--", ...localPathspecs], {
    cwd: repositoryRoot,
  });
verifyLocalClean();
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: sourceRoot,
  encoding: "utf8",
}).trim();
const sourceStatus = execFileSync("git", ["status", "--porcelain"], {
  cwd: sourceRoot,
  encoding: "utf8",
});
if (sourceRevision !== provenance.revision || sourceStatus !== "") {
  throw new Error("test386 source checkout is not clean at the pinned revision");
}
const executionRevision = git(repositoryRoot, "rev-parse", "HEAD");
const ram = new Map();
const post = [];
const output = [];
const topRomBase = 0x100000000 - rom.length;
const lowRomBase = 0x100000 - rom.length;
const read = (address) => {
  address >>>= 0;
  if (address >= topRomBase) return rom[address - topRomBase];
  if (address >= lowRomBase && address < 0x100000) return rom[address - lowRomBase];
  return ram.get(address) ?? 0;
};
const cpu = new I80386(
  {
    read,
    fetch: read,
    write: (address, value) => ram.set(address >>> 0, value & 255),
    outPort(port, value, width) {
      if (port === 0x80) post.push({ value, width });
      if (port === 0xe9) output.push(value & 255);
    },
  },
  { hardwareReset: true, deliverFaults: true },
);
let steps = 0;
let blocker = null;
const recentInstructions = [];
const traceState = () => ({
  step: steps,
  cs: cpu.cs & 0xffff,
  eip: cpu.eip >>> 0,
  physical: cpu.pc,
  opcode: read(cpu.pc),
  eflags: cpu.eflags >>> 0,
  eax: cpu.eax >>> 0,
  ebx: cpu.ebx >>> 0,
  ecx: cpu.ecx >>> 0,
  edx: cpu.edx >>> 0,
  esp: cpu.esp >>> 0,
  ss: cpu.ss & 0xffff,
});
try {
  while (steps < budget && !cpu.halted && !cpu.shutdown) {
    const state = traceState();
    recentInstructions.push(state);
    if (recentInstructions.length > 32) recentInstructions.shift();
    const romOffset = state.physical >= topRomBase
      ? state.physical - topRomBase
      : state.physical >= lowRomBase && state.physical < 0x100000
        ? state.physical - lowRomBase
        : -1;
    if (profile.errorOffsets.includes(romOffset)) {
      blocker = {
        name: "GuestAssertionFailure",
        message:
          romOffset === profile.errorOffsets[0]
            ? "pinned test386 entered its error routine"
            : "pinned test386 entered its ring-3 error loop",
        ...state,
        recentInstructions,
      };
      break;
    }
    cpu.step();
    steps++;
  }
} catch (error) {
  if (!(error instanceof UnsupportedI80386)) throw error;
  blocker = {
    name: error.constructor.name,
    message: error.message,
    cs: cpu.cs,
    eip: cpu.eip,
    physical: cpu.pc,
    opcode: read(cpu.pc),
  };
}
if (!blocker && cpu.halted) {
  const finalCandidate =
    post.at(-1)?.value === 0xff &&
    (cpu.pc === topRomBase + profile.completionPcOffset ||
      cpu.pc === lowRomBase + profile.completionPcOffset);
  blocker = {
    name: finalCandidate ? "CompletionCandidate" : "GuestHaltBoundary",
    message: finalCandidate
      ? "pinned test386 emitted POST FF and executed its terminal HLT; output acceptance remains ungraded"
      : "pinned test386 executed an intermediate HLT before final POST FF",
    ...traceState(),
    recentInstructions,
  };
}
if (!blocker && !cpu.halted) {
  blocker = cpu.shutdown
    ? {
        name: "CpuShutdown",
        message: "architectural exception delivery entered shutdown",
        cs: cpu.cs,
        eip: cpu.eip,
        physical: cpu.pc,
        opcode: read(cpu.pc),
      }
    : {
        name: "BudgetBoundary",
        message: "bounded diagnostic reached " + budget + " instructions",
        cs: cpu.cs,
        eip: cpu.eip,
        physical: cpu.pc,
        opcode: read(cpu.pc),
      };
}
if (git(sourceRoot, "rev-parse", "HEAD") !== sourceRevision ||
    git(sourceRoot, "status", "--porcelain") !== "") {
  throw new Error("test386 source provenance changed during execution");
}
if (
  hash(readFileSync(resolve(args.rom))) !== profile.sha256 ||
  hash(readFileSync(resolve(args.provenance))) !== hash(provenanceBytes) ||
  git(repositoryRoot, "rev-parse", "HEAD") !== executionRevision ||
  localSources.some(
    (path) =>
      hash(readFileSync(new URL(path, import.meta.url))) !== localSourceHashes[path],
  )
) {
  throw new Error("test386 input or local execution source changed during execution");
}
verifyLocalClean();
const report = {
  schema: "astra.i80386-test386-diagnostic.v1",
  accepted: false,
  status: blocker ? "bounded-blocker" : "guest-halted", fullRomPass: false,
  scope:
    `unchanged pinned test386 ${profileName} ROM; diagnostic progress only, no full-ROM or hardware-timing claim`,
  node: process.version, steps, post, output: Buffer.from(output).toString("latin1"), blocker,
  executionRevision,
  instructionBudget: budget,
  input: {
    bytes: rom.length,
    sha256: hash(rom),
    provenanceSha256: hash(provenanceBytes),
    revision: sourceRevision,
    sourceClean: true,
    profile: profileName,
  },
  sourceHashes: localSourceHashes,
};
writeFileSync(resolve(args.out), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

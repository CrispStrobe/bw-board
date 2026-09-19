/** Run the pinned external test386 capture ROM to the first bounded blocker. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import I80386, { UnsupportedI80386 } from "../src/experimental/i80386.js";

const EXPECTED = "3c4859cac2235f6ef5e8dbf3d706d8226ad860e2a624be3f9751981fadca4067";
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((value, i, all) =>
      value.startsWith("--") ? [value.slice(2), all[i + 1]] : null,
    )
    .filter(Boolean),
);
if (!args.rom || !args.provenance || !args.source || !args.out) {
  throw new Error("usage: --rom FILE --provenance FILE --source DIR --out FILE [--budget N]");
}
const budget = args.budget === undefined ? 2_000_000 : Number(args.budget);
if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10_000_000) {
  throw new Error("--budget must be a positive integer no greater than 10000000");
}
const hash = (data) => createHash("sha256").update(data).digest("hex");
const rom = readFileSync(resolve(args.rom));
const provenanceBytes = readFileSync(resolve(args.provenance));
const provenance = JSON.parse(provenanceBytes);
if (
  rom.length !== 65536 ||
  hash(rom) !== EXPECTED ||
  provenance.binarySha256 !== EXPECTED ||
  provenance.revision !== "cfd052d1e64d5375dea5a681c1eadeed64ceda2c"
) {
  throw new Error("test386 input provenance mismatch");
}
const sourceRoot = resolve(args.source);
const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const localSources = ["./run-i80386-test386-diagnostic.mjs", "../src/experimental/i80386.js"];
const localSourceHashes = Object.fromEntries(
  localSources.map((path) => [
    path,
    hash(readFileSync(new URL(path, import.meta.url))),
  ]),
);
const git = (cwd, ...gitArgs) =>
  execFileSync("git", gitArgs, { cwd, encoding: "utf8" }).trim();
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
const read = (address) => {
  address >>>= 0;
  if (address >= 0xffff0000) return rom[address & 0xffff];
  if (address >= 0xf0000 && address < 0x100000) return rom[address - 0xf0000];
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
try {
  while (steps < budget && !cpu.halted && !cpu.shutdown) {
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
  hash(readFileSync(resolve(args.rom))) !== EXPECTED ||
  hash(readFileSync(resolve(args.provenance))) !== hash(provenanceBytes) ||
  git(repositoryRoot, "rev-parse", "HEAD") !== executionRevision ||
  localSources.some(
    (path) =>
      hash(readFileSync(new URL(path, import.meta.url))) !== localSourceHashes[path],
  )
) {
  throw new Error("test386 input or local execution source changed during execution");
}
const report = {
  schema: "astra.i80386-test386-diagnostic.v1",
  accepted: false,
  status: blocker ? "bounded-blocker" : "guest-halted", fullRomPass: false,
  scope:
    "unchanged pinned test386 capture ROM; diagnostic progress only, no full-ROM or hardware-timing claim",
  node: process.version, steps, post, output: Buffer.from(output).toString("latin1"), blocker,
  executionRevision,
  instructionBudget: budget,
  input: {
    bytes: rom.length,
    sha256: hash(rom),
    provenanceSha256: hash(provenanceBytes),
    revision: sourceRevision,
    sourceClean: true,
  },
  sourceHashes: localSourceHashes,
};
writeFileSync(resolve(args.out), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

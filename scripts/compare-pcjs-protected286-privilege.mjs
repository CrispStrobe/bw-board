/** Ring transition/LDT/TSS oracle against an exact clean PCjs checkout. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ProtectedI80286 from "../src/experimental/i80286-protected.js";
const PIN = "c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70",
  root = process.env.PCJS_ROOT;
if (!root) throw new Error("Set PCJS_ROOT");
const git = (...a) =>
  execFileSync("git", a, { cwd: root, encoding: "utf8" }).trim();
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("unclean PCjs oracle");
const url = (n) =>
  pathToFileURL(resolve(root, `machines/pcx86/modules/v2/${n}.js`)).href;
for (const n of ["x86func", "x86help", "x86mods", "x86op0f", "x86ops"])
  await import(url(n));
const { default: CPU } = await import(url("cpux86")),
  { default: Bus } = await import(url("bus")),
  { default: Memory } = await import(url("memory")),
  { default: X86 } = await import(url("x86"));
class QuietBus extends Bus {
  printf() {
    return 0;
  }
}
const put = (w, a, b) => b.forEach((v, i) => w(a + i, v)),
  hash = (d) => createHash("sha256").update(d).digest("hex");
function install(w) {
  put(
    w,
    0,
    [
      0x0f, 1, 0x16, 0, 1, 0x0f, 1, 0x1e, 5, 1, 0xb8, 1, 0, 0x0f, 1, 0xf0, 0xea,
      0, 0, 8, 0,
    ],
  );
  put(w, 0x100, [0x37, 0, 0, 2, 0, 0xff, 1, 0, 3, 0]);
  const d = (a, b, l, x) =>
    put(w, a, [
      l & 255,
      l >> 8,
      b & 255,
      (b >> 8) & 255,
      (b >> 16) & 255,
      x,
      0,
      0,
    ]);
  d(0x208, 0x100000, 0xffff, 0x9a);
  d(0x210, 0x120000, 0xffff, 0x92);
  d(0x218, 0x130000, 0xffff, 0x92);
  d(0x220, 0x400, 15, 0x82);
  d(0x228, 0x500, 0x2b, 0x81);
  d(0x230, 0x180000, 0xffff, 0xf2);
  d(0x400, 0x160000, 0xffff, 0xfa);
  d(0x408, 0x170000, 0xffff, 0xf2);
  put(w, 0x502, [0, 3, 0x18, 0]);
  for (const [v, o] of [
    [0x30, 0x100],
    [0x31, 0x120],
  ])
    put(w, 0x300 + v * 8, [o & 255, o >> 8, 8, 0, 0, 0xe6, 0, 0]);
  put(
    w,
    0x100000,
    [
      0xb8, 0x18, 0, 0x8e, 0xd0, 0xbc, 0, 4, 0xb8, 0x20, 0, 0x0f, 0, 0xd0, 0xb8,
      0x28, 0, 0x0f, 0, 0xd8, 0x68, 0x33, 0, 0x68, 0, 1, 0x68, 2, 2, 0x68, 7, 0,
      0x68, 0, 0, 0xcf,
    ],
  );
  put(w, 0x100100, [0xcf]);
  put(w, 0x100120, [0xf4]);
  put(
    w,
    0x160000,
    [0xb8, 0x0f, 0, 0x8e, 0xd8, 0xa1, 0, 0, 0xcd, 0x30, 0xcd, 0x31],
  );
  put(w, 0x170000, [0x34, 0x12]);
}
const word = (r, a) => r(a) | (r(a + 1) << 8),
  finish = (cpu, r, halted) => ({
    ax: (cpu.ax ?? cpu.regEAX) & 0xffff,
    cs: (cpu.cs ?? cpu.getCS()) & 0xffff,
    ds: (cpu.ds ?? cpu.getDS()) & 0xffff,
    ss: (cpu.ss ?? cpu.getSS()) & 0xffff,
    sp: (cpu.sp ?? cpu.getSP()) & 0xffff,
    ip: (cpu.ip ?? cpu.getIP()) & 0xffff,
    cpl: cpu.cpl ?? (cpu.cs ?? cpu.getCS()) & 3,
    halted,
    frame: [0x2f6, 0x2f8, 0x2fa, 0x2fc, 0x2fe].map((a) =>
      word(r, 0x130000 + a),
    ),
  });
function local() {
  const m = new Uint8Array(1 << 24),
    c = new ProtectedI80286(
      { read: (a) => m[a], fetch: (a) => m[a], write: (a, v) => (m[a] = v) },
      { deliverProtectedFaults: true },
    );
  install((a, v) => (m[a] = v));
  Object.assign(c, { cs: 0, ip: 0, ds: 0, es: 0, ss: 0, sp: 0x100, flags: 2 });
  let frame;
  for (let i = 0; i < 100 && !c.halted; i++) {
    c.step();
    if (!frame && c.cpl === 0 && c.ip === 0x100)
      frame = [0x2f6, 0x2f8, 0x2fa, 0x2fc, 0x2fe].map((a) =>
        word((x) => m[x], 0x130000 + a),
      );
  }
  const out = finish(c, (a) => m[a], c.halted);
  out.firstFrame = frame;
  return out;
}
function reference() {
  const c = new CPU({ id: "priv.cpu", model: 80286 }),
    b = new QuietBus({ id: "priv.bus", busWidth: 24 }, c);
  if (!b.addMemory(0, 1 << 24, Memory.TYPE.RAM)) throw new Error("memory");
  c.bus = b;
  install((a, v) => b.setByteDirect(a, v));
  c.setCS(0);
  c.setIP(0);
  c.setDS(0);
  c.setES(0);
  c.setSS(0);
  c.setSP(0x100);
  c.setPS(2);
  let frame;
  for (let i = 0; i < 100 && !(c.intFlags & X86.INTFLAG.HALT); i++) {
    c.stepCPU(0);
    if (!frame && c.getCS() === 8 && c.getIP() === 0x100)
      frame = [0x2f6, 0x2f8, 0x2fa, 0x2fc, 0x2fe].map((a) =>
        word((x) => b.getByteDirect(x), 0x130000 + a),
      );
  }
  const out = finish(
    c,
    (a) => b.getByteDirect(a),
    !!(c.intFlags & X86.INTFLAG.HALT),
  );
  out.firstFrame = frame;
  return out;
}
const referenceState = reference(),
  actual = local(),
  mutation = process.env.PRIVILEGE_ORACLE_MUTATION ?? null,
  differences = [];
if (mutation !== null && mutation !== "frame")
  throw new Error(`unknown mutation ${mutation}`);
const completion = {
  ax: 0x1234,
  cs: 8,
  ds: 0x0f,
  ss: 0x18,
  sp: 0x2f6,
  ip: 0x121,
  cpl: 0,
  halted: true,
  firstFrame: [10, 7, 0x202, 0x100, 0x33],
};
for (const [e, s] of Object.entries({ PCjs: referenceState, owned: actual }))
  for (const [k, v] of Object.entries(completion))
    if (JSON.stringify(s[k]) !== JSON.stringify(v))
      throw new Error(`${e} incomplete ${k}: ${JSON.stringify(s[k])}`);
if (mutation === "frame") actual.firstFrame[0] ^= 1;
for (const k of Object.keys(referenceState))
  if (JSON.stringify(referenceState[k]) !== JSON.stringify(actual[k]))
    differences.push({
      field: k,
      reference: referenceState[k],
      actual: actual[k],
    });
if (git("rev-parse", "HEAD") !== PIN || git("status", "--porcelain"))
  throw new Error("PCjs provenance changed");
const sources = [
  "./compare-pcjs-protected286-privilege.mjs",
  "../src/i8086.js",
  "../src/experimental/i80286-protected.js",
];
console.log(
  JSON.stringify(
    {
      oracle: "PCjs",
      revision: PIN,
      node: process.version,
      scope:
        "owned LLDT/LTR, outer IRET to ring 3, LDT data, TSS ring-0 INT frame and return; no task switch",
      sourceHashes: Object.fromEntries(
        sources.map((p) => [
          p,
          hash(readFileSync(new URL(p, import.meta.url))),
        ]),
      ),
      mutation,
      status: differences.length ? "fail" : "pass",
      reference: referenceState,
      actual,
      differences,
    },
    null,
    2,
  ),
);
process.exitCode = differences.length ? 1 : 0;

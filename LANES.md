2026-09-19 Harris route evidence documentation — DONE, Codex Sol. Isolated worktree
`/mnt/volume1/code/wt/astra-harris-route-docs`, branch `lane/harris-route-docs`.
Owns documentation-only corrections in `docs/HARRIS-COMPILED-NETS.md` and
`docs/SST286-RUNNER.md`: distinguish reference/compiled wired DOS, Harris semantic
and hybrid routes, and independent fast286 evidence. No implementation, package
pin, private transcript, or new software-proof claim.
Corrected the dated compiled-DOS status without rewriting its history; added a
five-route evidence table, exact public receipts and local DOS input provenance.

# Who is doing what in bw-board — claim before you start, release when you finish

2026-09-20 DONE (candidate) — `/root` (Codex): explicit Shockley-NPN collector series
resistance, isolated worktree `/mnt/volume1/code/wt/bwb-nmos-gamma-phi-ac`,
branch `lane/npn-collector-resistance`, exact base
`dced14205a0c7e8914dcb18435ac1d726ab778fa`. Owns only the strict NPN
operating-point parameter boundary in `src/board.js`, the explicit Ebers-Moll
intrinsic-collector topology/readback in `src/mna.js`, its matching small-signal
topology in `src/ac.js`, focused additions to `test/npn-operating-point.test.mjs`
and `test/npn-ac-small-signal.test.mjs`, and this row. Add optional finite
`rc >= 0` as a real resistor between the public collector terminal and the
intrinsic Ebers-Moll collector, prove DC and AC against self-authored ngspice 42
witnesses, and keep omitted/zero RC byte-for-behaviour unchanged. Excludes IKF,
CJE/CJC/TF, PNP, generic BJT, solver/tolerances, CUI/corpus/package pins, x86,
and every unrelated model or path.
The implementation creates a hidden intrinsic collector only for explicit
positive RC, stamps the physical resistor in both the DC and small-signal
systems, evaluates Vbc at the intrinsic node, and reports public-terminal
currents with signed KCL intact. Independent ngspice 42 DC and AC witnesses
agree on all terminal voltages/currents and the complex AC response; omitted
and explicit zero RC are identical, and negative/non-finite RC refuses by
name. The affected DC/AC/BJT/routing/source-honesty surface passes 36/36.
Mutating the authored RC to zero makes both independent witnesses red. The
ADI-v2 attribution shows all 550 refused NPN instances also carry
CJC/CJE/IKF/TF, so this bounded upstream topology is not itself a corpus-row
admission claim; those remaining laws and CUI exact-card admission stay
separate follow-on lanes.

2026-09-20 DONE (candidate) — `/root` (Codex): exact grounded-bulk Level-1 NMOS
GAMMA/PHI small-signal body transconductance, isolated worktree
`/mnt/volume1/code/wt/bwb-nmos-gamma-phi-ac`, branch
`lane/nmos-gamma-phi-ac`, exact base
`5b3c0ba1071406d875e704b8cdcd01282f1e4978`. Owns only the exact-NMOS
branch in `src/ac.js`, focused additions to `test/nmos-ac-small-signal.test.mjs`,
and this row. Extend the already-qualified Level-1 AC Jacobian only when
`bulkAtGround:true` and finite `gamma >= 0`, finite `phi > 0` are declared as
a pair. Linearise the same DC threshold law at the converged bias and stamp
the resulting body transconductance from grounded bulk to source; preserve
the zero/default-body-effect path byte-for-behaviour and keep generic MOS,
PMOS, source-tied/third bulk, capacitances, solver/tolerances and every x86
path outside scope. The exact DC threshold derivative now contributes
`gmb = gm*gamma/(2*sqrt(phi+Vsb))` for positive grounded-bulk Vsb and stamps
its equal-and-opposite source coefficient. A live ngspice 42 source-degenerated
witness agrees at drain and source within 1 microvolt; declared zero GAMMA is
exactly equal to the absent-body path, incomplete pairs refuse by name, and the
focused AC/DC/body-effect surface passes 30/30 without adopting the bias point.
Dropping the body Jacobian makes the live witness red; dropping pair validation
makes the refusal proof red. Downstream CUI AC admission and the exact 350-row
OP+AC replay remain separate after this upstream qualification.

2026-09-20 DONE (candidate) — bwcx: exact grounded-bulk Level-1 NMOS body-effect public
operating-point domain, isolated worktree
`/mnt/volume1/code/wt/bwb-nmos-gamma-phi-op`, branch
`lane/nmos-gamma-phi-op`, exact base
`88d960eecb566db3939710b844ca03a36e5ea8c1`. Owns only the `BoardImpl.operatingPoint`
NMOS parameter preflight in `src/board.js`, focused public NMOS operating-point
tests, and this row. Admit finite nonnegative GAMMA plus finite positive PHI only
as a pair on the already-qualified grounded-bulk Level-1 NMOS law; source-tied
bulk, partial/invalid fields and every extra parameter remain refused. A live
ngspice witness agrees on gate/drain/source voltage within 1 microvolt and drain
current within 10 nA; the focused MOS surface passes 46/46. Removing the new
allowlist makes that witness red, while removing either pair completeness or the
grounded-bulk restriction makes the named refusal proof red. No stamp, AC/gmb,
solver/tolerance, CUI/pin, PMOS, x86, workflow, or unrelated engine change.
Initial exact-head CI `35478520574` ran 5,614 tests with one stale source-bulk
expectation: it expected GAMMA to be globally outside the domain rather than the
new stricter pair-completeness refusal. This forward test-only correction names
the actual retained refusal; Harris `35478520595` and every non-test CI job were green.

2026-09-19 DONE — bwcx: Level-1 MOS reverse-VDS channel symmetry, isolated
worktree `/mnt/volume1/code/wt/bwb-mos-reverse-vds-symmetry`, branch
`lane/mos-reverse-vds-symmetry`, exact base
`d128b384a9f9df986ae38db72bc7dae33a6b092e`. Owns only the bounded MOS channel
bias/stamp/region/current readers in `src/mna.js`, one focused self-authored
reverse-terminal test, and this row. Prove ngspice source/drain-role agreement
for negative authored VDS while preserving explicit bulk topology and ordinary
positive-VDS behavior. The shared channel-bias transform now selects the
effective source for stamping, body effect, region choice and current readback;
the physical bulk junctions stay on their authored terminals, and an unplaced
bulk remains on its refusal path. Self-authored reverse NMOS and PMOS currents
match ngspice 42 within 1 pA; restoring the old no-swap choice makes both red.
The focused MOS surface passes 76/76. A direct read-only replay of the four
GMIN-stable ADI-v2 residuals moves each to within 0.5 microvolt of ngspice,
while the two separately classified GMIN-sensitive rows do not move. Exact
candidate `ae6f929e89f5eecdb237663e77985a2964c17344` passed CI `35477084087`
and Harris/native qualification `35477083986`, then fast-forwarded master.
Excludes junction constants, tolerance/solver policy, CUI/corpus/pins, PMOS
model broadening, GAMMA/PHI admission and x86 work.

2026-09-19 DONE — bwcx: exact Level-1 MOS bulk-junction default-temperature
alignment, isolated worktree `/mnt/volume1/code/wt/bwb-mos-bulk-temperature`,
branch `lane/mos-bulk-temperature`, exact base
`3cd5927ba84977d472b7ed75f2075c478800b526`. Owns only the MOS bulk-junction
thermal constant/metadata in `src/mna.js`, a focused self-authored regression
test, and this row. Board's MOS body diode now uses ngspice 42's 27 C default
thermal voltage (0.025864925786 V); diode, zener and BJT families retain their
existing fixed 0.02585 V contract. The public self-authored witness executes a
strict ngspice reference and agrees within 0.23 microvolt; restoring 0.02585 V
makes it fail by 380 microvolts. Focused MOS/bulk coverage passes 67/67 and the
broader affected surface passes 147/147. The complete 7,410-row ADI v2 replay,
paired with the bounded instance-geometry oracle correction, closes seven
comparison failures and passes 1,444,717/1,444,717 observations without moving
importer/native/not-run counts or tolerances. Exact-head CI `35467635421` and
Harris `35467635420` are green at `7ef25d725087baa4fa75768617b1395e5891ba6e`.
No channel law, other junction family, solver, tolerance, CUI, x86, workflow,
or private payload changed.

2026-09-19 CLAIM — Astra coordinator, two Sol implementers: AT boot and CPU
exception continuation toward 386DX, Windows and Doom. Integration worktree
`/mnt/volume1/code/wt/astra-x86-tasks`, branch `lane/astra-x86-at-boot`, base
`220b22b9db5326732c86f549877259d8acbcbb9d`. Owns x86 experimental CPU,
AT reset/device/boot integration, focused guest tests/harnesses, qualification
and source-bound notes. First parallel tasks: protected exception/trap recovery
and genuine AT reset/BIOS boot investigation and implementation. Subsequent
386 and application work follows measured prerequisites. Excludes analog,
FPGA, schematics and unrelated UI; no full compatibility claim without guest
acceptance. External proprietary media stays outside public source/artifacts.

2026-09-20 DONE (qualified and landed) — Astra/Sol application persistence and demo completion.
Windows3.0 Notepad creates and saves OWNED.TXT via real keyboard input, then
opens its exact 17 bytes after fresh reset/remount. Independent FAT and frame
audits verify the file, source revisions and writer/reader image linkage.
The key harness rejects malformed scripts and parent-media provenance before
execution and records every accepted event. Original Doom1.9 repeats E1M1
movement/fire on the final Windows CPU/device implementation. A separate
ordinary 110-byte owned demo file loads through DOS, renders E1M1, completes
24 gametics and returns to C:\>; full demo1 remains incomplete at 500M.
No original EXE/WAD/media bytes are committed. The optional FAT file builder
validates names/capacity and independently reproduces both pinned image hashes.
Focused 452 pass,2 optional skips; actionlint and diff checks pass.
Receipt: `docs/receipts/2026-09-20-x86-application-persistence.json`.
Windows enhanced mode, Doom save/load/sound/all levels and complete physical
386 behavior remain outside these bounded application milestones.
Initial candidate9d64209a failed the sampled386 zero-skip assertion because
the coordinator put an optional external-report test in that subset. The
forward workflow correction removes that optional entry and retains the
zero-skip assertion; actual-report acceptance and mutations passed locally.
General CI also caught missing census registration for the optional report.
The new doom-short-report fixture row makes absence explicit; census14/14 pass.
Exact 74c47bbe passed CI35490696573, CPU35490696554 and native35490696525,
then fast-forwarded master. Tag: milestones/x86-windows-persistence-doom-demo-20260920.

2026-09-20 DONE (qualified and landed) — Astra/Sol Windows desktop and Doom interaction.
Autonomous ATA intersector pacing now covers the observed Windows chained IRQ0
service with 8192 functional cycles; no arbitrary-handler or mechanical timing
claim. Original Windows3.0 reaches Program Manager, and real Set-1 Enter opens
File Manager with C:\WINDOWS and free space. Strict observed planar decoding
independently reproduces the audited frame hashes. Original Doom1.9 E1M1
movement and pistol fire are accepted at exact9eeca326; a combined-source
replay is still running and supplies no acceptance yet. Fresh DOS write/reboot
and BIOS two-sector write/read pass at863cc769 with exact input/source hashes.
Focused tests:399 pass,2 optional skips; shared platform/checkpoint/VGA49 pass.
The full test386 diagnostic retains its documented VM86 16-bit gate/manual
disagreement; it is not a full-ROM pass. Actionlint and diff checks pass.
Receipt: `docs/receipts/2026-09-20-x86-windows-doom-gameplay.json`.
Exact8172a3bf passed CI35488705735, CPU35488705876 and native35488705795,
then fast-forwarded master. Tag: milestones/x86-windows300-doom-gameplay-20260920.
Parent claim continues through Windows edit/save/reopen and completed Doom demo;
experimental defaults and other lanes remain unchanged.

2026-09-20 DONE (qualified and landed) — Astra/Sol hidden segment caches, keyboard F3,
and original Doom level entry. Real DS/ES reloads retain large hidden limits
following PE exit; pinned PCjs agrees on a guest bootstrap and 65,540-byte copy,
while the pre-fix executor faults. Result, cache and budget controls reject.
The configured AT keyboard extension models F3 parameter/ACK state and exact
ACK deadlines, scan suppression, reset and checkpoint restoration; automatic
repeat generation remains outside scope. Original Doom reaches E1M1 graphics
through a single Esc/Enter sequence. Windows reaches a real graphical disk-error
dialog, not the desktop. Six fresh DOS/FreeDOS write/reboot executions at frozen
30475e6f reproduce their original command sequences, counts and output images.
Focused checks: 462 pass, 2 optional skips; actionlint and diff checks pass.
Exact 36e459d0fa62c3c89264d0a32d1a2f819cb1b3ba passed CI 35487847024,
CPU 35487846991 and native 35487846948, then fast-forwarded master.
Tag: milestones/x86-unreal-keyboard-doom-level-20260920. Receipt:
`docs/receipts/2026-09-20-x86-unreal-keyboard-doom-level.json`.
The ongoing parent claim covers the next Windows disk-transfer fix and Doom
movement/firing acceptance; other lanes remain outside scope.

2026-09-20 DONE (qualified and landed) — Astra/Sol DOS loader fixes.
The original PC DOS MBR exercises byte Group1 opcode82; the executor now handles
it with byte semantics even under66. Pinned PCjs agrees on CMP memory and ADC
carry/flags/high-register preservation; result and budget controls reject.
The next actual PBR failure was BIOS INT13 reset returning AH05 because ATA SRST
reported error0 instead of diagnostic01. Cold and software reset now publish01;
IRQ and transfer-cancellation checks remain green. The untouched external disk
reaches HIMEM and SMARTDrive after the fix. Windows desktop remains unaccepted.
Fresh source-bound DOS write/reboot and284 focused tests pass (2 optional skips).
Doom report serialization now survives short CGA/VGA smoke runs; atomic progress
snapshots and opt-in detailed tracing avoid losing long runs to final-report errors.
The previous320M VGA execution lost its report and supplies no acceptance.
Receipt: `docs/receipts/2026-09-20-386-dos-loader-reset.json`.
Ongoing Windows/Doom work retains the parent claim and does not touch other lanes.
Exact a6a5b483bf87d281cc64bdee0152ff676816a1ed passed CI 35485712895,
CPU 35485712931 and native 35485712883, then fast-forwarded master.
Tag: milestones/x86-dos-loader-ata-reset-20260920.

2026-09-20 DONE (qualified and landed) — Astra/Sol VM86 TSS.
32-bit tasks now enter VM86, use user paging, and return from protected task-gate
handlers through NT IRET. Independent QEMU TCG 486 execution exposed and fixed
an actual far-JMP EIP overwrite; both engines now emit the exact owned guest
sequence BHV. Result and budget mutations reject. The separate pinned-PCjs
reset remains a failing reference disagreement, not accepted oracle evidence.
Root replayed DOS write and fresh reboot at frozen 79617dfc with identical
media and instruction counts. VGA Doom reaches R_Init through genuine reset,
SeaVGABIOS, FreeDOS and original EXE/WAD; a separate 500M-step CGA run continues
without refusal. Neither establishes rendered gameplay. Windows input has been
verified and execution is under investigation in the CPU lane. Receipt:
`docs/receipts/2026-09-20-386-vm-task.json`. Debug task traps and page-straddling
TSS remain bounded refusals. Ongoing Windows/Doom work retains the parent claim.
Exact e40abd64a7c283401ac58433d633eb0d3b2549c6 passed CI35484387534,
CPU35484387526 and native35484387522, then fast-forwarded master.
Tag: milestones/x86-386-vm-task-20260920. The 500M Doom trace also records
sound, HUD and status-bar initialization before the screen clears at299M;
this advances the observed initialization frontier but does not prove graphics.

2026-09-20 DONE (qualified and landed) — Astra/Sol 286-format TSS support in the 386.
Adds 16-bit task images to direct CALL/JMP, task gates and nested IRET;
implements 286 privilege-stack fields and word task error frames. Mixed-format
switches preserve exactly the appropriate outgoing dynamic bytes and retain
static fields, including CR3/LDT; an incoming 286 image leaves CR3 selected.
Directed tests distinguish precommit incoming-image faults from postcommit
selector page faults, and verify IOPL denial without port callbacks. Pinned
PCjs agrees on an all-286 CALL/IRET round trip with exact HLT/busy/backlink
state; result and truncated-budget mutations reject. Upper general-register
halves and FS/GS follow explicitly bounded deterministic policies and are not
hardware-graded by this oracle. Fresh frozen-source 386 DOS write/reboot tests
pass with unchanged steps and media bytes. Focused surface:326 pass,2 optional
skips. VM86 task entry, debug trap, page-straddling TSS images, Windows and
full compatibility remain outside this increment. Receipt:
`docs/receipts/2026-09-20-386-task16.json`.
Exact `b74387f5d5b20cda2978a816eb48e6a9f737084c` passed CI `35483322404`,
CPU `35483322421`, native `35483322406`, then fast-forwarded master.
Tag: `milestones/x86-386-task16-20260920`.

2026-09-20 DONE (qualified and landed) — Astra/Sol 386 protected entry and VGA services.
Preserves visible real-mode CS and starts CPL0 when MOV CR0/LMSW enables PE;
checks direct/conforming, segment, interrupt, return and task paths. Adds INTO
with pinned-PCjs next-IP/frame agreement and two rejecting negative controls.
8042 FF is a no-line pulse. Adds opt-in planar VGA memory and external C000h
option-ROM mapping; SeaVGABIOS option POST and INT10 mode13 execute in the
emulator, followed by an owned two-byte VRAM comparison. The INT10 guest is
installed by the diagnostic harness after POST, not booted as an operating
system. Grading requires actual service entry, mode state and guest marker.
All six DOS/FreeDOS write-and-fresh-reboot regressions have been genuinely
rerun with matching historical guest steps and media bytes. Doom's original
shareware executable reaches DPMI allocation, WAD loading and R_Init within
150 million machine steps; no game frame, Windows, complete VGA addressing,
ROM shadow-write or timing acceptance. The 16-bit TSS continuation is separate.
Focused affected surface: 317 pass, 2 optional skips. Receipt:
`docs/receipts/2026-09-20-386-protected-entry-vga.json`.
Exact `43ad9762fd426dc148ca5ef68c1ab0297b208c20` passed CI `35482976575`,
CPU `35482976574`, native `35482976578`, then fast-forwarded master.
Tag: `milestones/x86-386-protected-entry-vga-20260920`.

2026-09-20 DONE (qualified and landed) — Astra/Sol
386 compiler instructions and autonomous multi-sector ATA. Adds ENTER/LEAVE,
BT/BTS/BTR/BTC, BSF/BSR, BCD adjustment and privileged CLTS; VM86 ENTER
checks page-write permission. Corrects the physical comparator to reconstruct
unchanged registers from the published final-state delta. All 596 selected
386EX cases pass; unchanged EAX and CR0.TS mutations are now rejected.
All published CLTS inputs have TS already clear; the clearing transition is
covered by directed tests only. ATA exposes a scheduled 256-functional-clock
inter-sector BSY phase, independent of status polling, and rearms its device
deadline after I/O. Coordinator fca2badd genuinely boots IBM BIOS/DOS2,
writes and freshly reboots/reads the same12-byte file, and separately completes
an owned two-sector INT13 write/read with distinct data and a poisoned buffer.
Focused surface:286 pass,2 optional skips. Doom now enters its correctly
relocated real-mode stub and reaches the unsupported8042 FF command; full MZ
comparison retains18 differences, with the recorded subset near the startup
stack; this is not zero-difference acceptance.
No protected extender, game, Windows, NPX or hardware timing acceptance.
Receipt: `docs/receipts/2026-09-20-386-compiler-ata-multisector.json`.
Exact `6cf8e4042a66ed7f4cf2372f5acab166b79bcd03` passed CI `35481716140`,
CPU `35481716139`, native `35481716137`, then fast-forwarded master.
Tag: `milestones/x86-386-compiler-ata-20260920`.

2026-09-20 DONE (qualified and landed) — Astra/Sol
386 32-bit task switching, RET immediate and explicit AT floppy media rates.
The commit containing this row freezes audited TSS CALL/JMP/NT IRET, task
gates, exact CR3 mapping, original selector-fault classes and postcommit page
faults; task-gate unused fields are ignored and EXT never alters #PF bits.
The pinned PCjs CALL/IRET oracle and both targeted negative controls pass;
268 focused checks pass with two optional skips. Real DOS2 write/reboot on
both CPUs and unchanged FreeDOS on functional286 were rerun against changed
sources; all six runs preserve earlier step counts and disk hashes. The
explicit 1.2MB floppy profile fixes BIOS 360K misclassification through CCR
checks, without changing legacy profile behavior. FreeDOS386 reaches its
shell and HDD DIR; the DOOM command is invoked but extender/game execution
is not yet attributed or accepted. Receipt:
`docs/receipts/2026-09-20-386-task-media-rate.json`. Original ROM128 stops on
its 16-bit VM86-gate expectation before task tests. No full CPU, Windows,
Doom, x87 or timing acceptance; compiler/BCD continuation remains separate.
Initial hosted CI/native passed, while CPU qualification caught one stale
BIOS-service DOS toolchain receipt. A fresh run on d90d3a95 preserves all
1,111,040 steps and output bytes; its source-bound receipt is refreshed with
the historical run retained, and the affected tests pass 10/10. Exact corrected
revision `3726c9f063e3aa97a062bb3743f211552ebf2341` passed CI `35480541673`,
CPU `35480541674`, and native `35480541732`, then fast-forwarded master; tag
`milestones/x86-386-task-media-rate-20260920`.

2026-09-20 DONE (qualified and landed) — Astra/Sol
386 genuine AT DOS boot and BIOS HDD roundtrip. Exact candidate/landing
`5b3c0ba1071406d875e704b8cdcd01282f1e4978` freezes expand-down segment/privilege-stack admission, absent-NPX WAIT/ESC,
XLAT and CBW/CWDE/CWD/CDQ. Coordinator replay on combined source
`72f56ab1a5a4606e17d821bed2bb1e3ac36a998e` passes actual reset/POST/INT19,
DOS shell write and fresh-machine TYPE persistence (25,652,224 / 25,567,232
steps; identical media hash to the worker). Separate BIOS HDD boot-program
acceptance passes at 70,579,183 steps with native 16-bit PIO and all 512 read
bytes poisoned then compared by the guest. This is not an HDD OS boot.
Focused 386 checks: 204 pass, two optional skips, zero failures; actionlint
passes. Fixture source hashes and five tamper controls prevent stale DOS proof.
Receipt: `docs/receipts/2026-09-20-386-at-dos-hdd.json`. Windows, Doom,
386 FreeDOS, task switching, x87 and full CPU compatibility remain unaccepted.
Exact candidate CI `35479044402` passed (5,630 pass, 272 skips, zero failures),
CPU `35479044552` and native `35479044390` passed. Latest NMOS upstream
changes are preserved. Guarded normal push advanced master from `4a39744`
to that exact qualified candidate; tag `milestones/x86-386-at-dos-hdd-20260920`.

2026-09-20 DONE (qualified and landed) — Astra/Sol
386 VM86, BIOS/compiler ISA and experimental disk continuation. Candidate and
landing: `88d960eecb566db3939710b844ca03a36e5ea8c1`; receipt preserves actual execution SHAs.
VM86 entry/interrupt/IRETD, BOUND, VERR/VERW, ARPL, LAR/LSL, immediate IMUL,
SETcc, double shifts, TEST, AAM/AAD and interruptible INS/OUTS are implemented.
Coordinator audit corrected VM privileges, original selector-query semantics,
real REP interrupt/fault witnesses, ATA command/IRQ/reset behavior and complete
BIOS disk readback grading. Snapshot-only BIOS median speedup is 5.19x on the
recorded host; functional pacing six passes the RTC UIP regression. Focused
checks: 191 pass, two optional skips, zero failures. New hardware profiles
add 81 bounded 386EX cases to the prior362; hosted exact candidate refreshes all.
Pinned PCjs VM86 and selector comparisons pass declared fields; targeted
negative controls reject. BIOS progresses through processor checks and RTC
polling but no386DOS boot is yet accepted. ATA BIOS roundtrip and open VGA ROM
remain prepared inputs. Receipt: `docs/receipts/2026-09-20-386-vm-isa-platform.json`.
No tasking, full386DX, x87, Windows, Doom or silicon timing claim. Expand-down
and absent-NPX work continue separately after this freeze.
Exact candidate CI `35477928736` passed (5,614 pass,272skip,zero fail),
CPU `35477928733` and native `35477928839` passed. Guarded normal push
advanced master from `62160e7` to the exact qualified candidate. Tag:
`milestones/x86-386-vm-isa-platform-20260920`.

2026-09-19 DONE (qualified and landed) — Astra/Sol
FreeDOS persistence and bounded 386 AT platform. Candidate and landing are
`d128b384a9f9df986ae38db72bc7dae33a6b092e`; platform diagnostic source is `46f1d04`. Unchanged official
FreeDOS 1.4 boots through IBM AT BIOS, declines installation, writes FDBOOT.TXT,
and reads its exact bytes after a fresh machine remount. The two actual source
revisions and media hashes are retained in the tracked evidence fixture.
The 386 adapter adds explicit functional four-clock instruction pacing and an
opt-in 4MiB installed-RAM profile with matching CMOS sizes/checksum. Pacing tests
exercise real IRQ wake, idle and architectural fault delivery. Twelve focused
checks pass. A 6M-step source-bound BIOS diagnostic proves increasing 64KiB test
addresses, not full 386 POST or DOS boot. Receipt:
`docs/receipts/2026-09-19-at-freedos-386-platform.json`. No VM86, tasking,
Windows, Doom or silicon timing claim. Snapshot copying is a measured future
performance target, not a speedup included in this stage.
Exact candidate CI `35476376757` passed (5,559 pass, 272 skip, zero fail),
CPU `35476376774` and native `35476376827` passed. Guarded normal push
advanced master from `14d5908` to this exact candidate. Tag:
`milestones/x86-freedos-386-platform-20260919`.

2026-09-19 DONE (qualified and landed) — Astra/Sol
386 ring, far-control and I/O continuation. Candidate and landing are
`14d59084f14fdde5dba158e5ac2a3b25884e56e0`; executed source is
`f87a3b42cdd90b1866f9204273c1c1720d212bbb`.
Adds inner-ring interrupt stacks, outer IRET, protected far CALL/JMP/RETF,
16/32-bit call gates with copied parameters, conforming targets and TSS scalar
I/O permissions. Coordinator audit corrected fault ordering, mixed stack
widths, execute-only pointer admission, null-SS exception types and inclusive
bitmap bounds. Focused 386 tests: 133 pass, two optional skips, zero fail.
Pinned PCjs protection comparison passes its declared checks; conforming
stack selection and saved RF remain explicit reference differences. Eight
negative controls reject. Unchanged test386 reaches POST21/VM86 IRET after
805,601 steps, not full-ROM acceptance. Source-bound receipt:
`docs/receipts/2026-09-19-386-protection.json`. No full 386DX, Windows, Doom,
physical bus or timing claim. FreeDOS persistence, functional device pacing,
VM86 and larger-memory platform work remain outside this freeze.
Exact candidate CI `35475646953` passed (5,554 pass, 272 skip, zero fail),
CPU `35475646987` passed and native `35475647084` passed. Guarded normal
push advanced master from `c0711d2` to the exact qualified candidate. Tag:
`milestones/x86-386-protection-20260919`.

2026-09-19 DONE (qualified; landing record below) — Astra/Sol
386 system and stack continuation. Candidate is `68b6aa92d76ac9416451d9f0dc48db24c5254035`;
source `a797266` adds LLDT/LTR/SLDT/STR, LDT lookup, SMSW/LMSW, SGDT/SIDT,
LEA, segment PUSH/POP, POP r/m and PUSH imm8. Coordinator rejected a broad
real-stack wrapping change; only selector-specific word transfers remain.
362 bounded physical 386EX samples and five PCjs comparisons pass; ten
mutations reject, including exact completion/budget and busy-bit controls.
111 focused CPU/adapter/parser tests pass across the recorded runs after a
stale unloaded-LDT expectation was corrected to #GP(4). SGDT's high byte and
POP fault/EA rules document PCjs support and hardware-evidence limits.
Unchanged test386 reaches POST20 then unsupported outer IRET. The separate
386 BIOS reaches POST2A but enters firmware CLI/HLT error handling; neither
is acceptance. Source-bound receipt: `docs/receipts/2026-09-19-386-system-stack.json`.
286 DOS2 persistence retains unchanged dependency hashes. Ring transitions,
FreeDOS shell acceptance and further platform fixes remain outside this freeze.
No full 386DX, Windows, Doom, physical bus or timing claim.
Candidate `68b6aa92d76ac9416451d9f0dc48db24c5254035` passed CI
`35473644024` (5,527 pass, 272 skip, zero fail), CPU `35473644021`
(full fast/Harris corpora, 362 bounded 386 samples and PCjs), and native
`35473644044`. The landing preserves upstream `a95a4c6`'s unrelated analog
lane claim; only that ledger row and qualification documentation differ from
the qualified candidate. This follows the lean ledger-only integration rule.

2026-09-19 DONE (qualified; landing record below) — Astra/Sol
386 REP/ISA and RTC continuation. Frozen integration worktree
`/mnt/volume1/code/wt/astra-x86-rep-rtc-land`, branch
`lane/astra-x86-rep-rtc-land`; candidate is the commit containing this row.
Adds restartable REP, XCHG, near indirect/far real control, far-pointer loads,
complete basic ALU families, PUSHA/POPA, moffs and rotates. Root audit corrected
PUSHAD saved ESP and nonzero full-circle rotate carry; 386EX POPAD upper-ESP
behavior and undefined-OF sample exclusions are explicit. Source `a6de545`
passes 91 focused CPU/adapter tests, 266 bounded physical samples, four PCjs
comparisons and eight rejecting controls. Exact pinned test386 reaches LLDT
at POST09 setup (POST08 last emitted), not full-ROM acceptance. The separate
opt-in 386 AT adapter proves bus/reset/IRQ/NMI/HLT wiring, not an OS boot.
RTC calendar writes/SET/modes/checkpoints now admit the observed FreeDOS BIOS
writes. Untouched FreeDOS reaches the FreeCom startup display at 40M steps;
no shell acceptance. Fresh DOS2 write/fresh-remount TYPE at `439560e` both
pass with identical 12-byte output and linked image SHA, all 15 executed source
hashes matching this tree; earlier c5 evidence remains historical. AT/device/
acceptance focused tests pass. Later system-register and 386 BIOS runner work
stays outside this freeze. No full 386DX, Windows, Doom or timing claim.
Candidate `3fa9afacbca4fb8b9ba02c59ab9003f8f56bf03d` passed CI
`35472633235` (5,507 pass, 272 skip, zero fail), CPU qualification
`35472633257` (full fast/Harris corpora, 266 bounded 386 samples and PCjs
oracles), and native `35472633215`. The landing adds only this qualification
record and its documentation status to that exact candidate.

2026-09-19 DONE (qualified; landing record below) — Astra/Sol functional
AT DOS disk boot and 386 paging/reset/ISA stage; candidate is the commit carrying
this row. Two source-bound genuine-reset IBM Rev1 boots execute DOS 2.00 and
Command 2.02: keyboard ECHO/TYPE writes 12 exact bytes, fresh-remount TYPE reads
them without recreating the file, both end at A>. Exact DMA boot transfer,
input/output SHA linkage, all 15 CPU/device/harness source hashes, and rejecting
file/output/DMA/keyboard/media mutations are checked in. Explicit 640KiB RAM/CMOS
fixes the owned IO.SYS relocation beyond the original 512KiB profile. BIOS and
media remain external. 386 adds original 4KiB paging with precise CR2/error/restart
state, reset at FFFFFFF0h, port I/O, flag privilege, exact group3 arithmetic,
segment-selector admission and scalar strings. 90 fixed hardware samples pass;
46 additional segment-profile exception inputs are excluded, not passes. Audit
resolved 66/8C upper-word behavior with 386EX capture and fixed selector null/TI
and conforming-read checks. PCjs bootstrap/fault/paging/group3 comparisons pass
with rejecting mutations and the recorded saved-RF oracle limitation. Focused
CPU/acceptance tests 48/48, DOS toolchain 7/7 and platform/acceptance 11/11 pass.
Unchanged external test386 reaches POST00..04, then explicitly refuses REP;
`fullRomPass:false`. REP continuation stays outside this freeze. Latest upstream
MOS changes are preserved. Hosted exact-head CI/CPU/native qualification gates
landing. No full 386DX, Windows, Doom, complete peripherals or timing claim.
Pre-landing audit superseded candidate `a59f7a0`: LGDT/LIDT bypassed the
execute-only source-segment read check. The exact old LGDT counterexample
performed six forbidden reads; fixed source `bf3fea0` raises #GP(0) before
all operand reads and preserves GDTR. A crossing-page regression checks
ascending operand reads and CR2. Queued runs `35470133473`, `35470133428`,
and `35470133415` were canceled as superseded, not counted as passes.
The corrected candidate refreshes all bounded 386 receipts and qualifications.
Corrected candidate `155b779aebbe7c4718edc73091673e392336976d` passed hosted
CI `35471008880` (5,462 pass, 272 skip, zero fail), CPU `35471008892`
(fast/Harris full corpora and bounded 386 oracle/sample jobs), and native
`35471008891`. The landing contains only that qualified candidate and this
qualification record; later REP/RTC/386-adapter work remains separate.

2026-09-19 DONE (qualified; landed at `28911b2`) — Astra/Sol bounded 386
and AT keyboard POST milestone; exact candidate is the commit carrying this row.
Adds opt-in native 32-bit execution, prefixes/SIB/aliases/stack widths, same-ring
interrupt and trap gates, restartable admitted faults, IRET, RF/SS/NMI boundaries,
and 386 double-fault classification. Pinned PCjs bootstrap/frame comparisons
pass; the documented PCjs #GP RF omission is explicitly ungraded and Intel-tested.
Exactly 84 admitted real-mode hardware samples pass; 888/2600/3111 exception
cases are excluded by the three sample profiles, not counted as passes. Adds
strict parser, stray-write comparison, rejecting frame/IF/RAM/write mutations,
and hosted evidence jobs. AT keyboard scheduling, keylock state and host-command
enable fixes let the unchanged external IBM Rev1 BIOS complete keyboard checks
and reach POST43/INT19 without displayed POST errors. The 30M-step diagnostic
later enters an unexpected-interrupt handler; full disk boot remains unproven.
Fresh real DOS MASM/LINK/EXE2BIN guest succeeds on the separate BIOS-service
machine. Combined focused CPU/AT/DOS: 35/35; device/checkpoint: 55/55. Receipts
bind actual inputs and source hashes. Full hosted CI, 286 fast/Harris corpora,
native contracts and new bounded 386 jobs gate landing. Continuation claim above
remains active for AT disk diagnosis, paging, privilege and application work.
No full 386DX, Windows, Doom or physical-timing claim; external media stays external.
Initial candidate `f6f85cc` passed CPU qualification `35467798134` and native
qualification `35467798125`; CI `35467798130` had one failure: the new optional
MOO parser test lacked its external-input census row (5429 pass, 272 skip).
The corrected candidate registers the exact pinned corpus with explicit-env
discovery matching both consumers. Focused census checks and required-input
present/absent checks pass. Corrected candidate `d284b40` passed CI
`35468118560` (5430 pass, 272 skip, zero fail), CPU `35468118562` (fast and
Harris each 1,477,997 pass, three revoked; bounded 386 jobs green), and native
`35468118561`. Landing `28911b2` preserves upstream `eaa56d0` README/isolated
LabWired benchmark changes; qualified x86, workflow and test blobs are unchanged.
Tag `milestones/x86-386-core-at-keyboard-20260919` records that qualification.
Continuation below/above retains later AT disk boot, paging and ISA work.

2026-09-19 DONE (qualified and landed at `3cd5927`) — Astra/Sol AT reset and 286 recovery milestone;
exact candidate is the commit carrying this row. The active continuation claim
above remains for firmware disk boot, 386 and versioned application acceptance.
Adds opt-in hardware reset and AT boot profile, warm CPU reset preserving board
state, timed 8042 responses, primary/secondary DMA register diagnostics, refresh
status and seeded CMOS. Unmodified external IBM AT Rev1 reaches its protected
memory test from physical FFFFF0; this is diagnostic progression, not full POST
or DOS boot. Adds 286 contributory-fault escalation, #DF task entry, shutdown/
NMI/reset recovery, TF/SS/STI boundaries and inactive-NPX exception handling.
Root audit corrected reset-cache identity and fault/trap transition defects.
Focused combined CPU/AT/DOS regression: 159/159; six owned PCjs comparisons pass,
seven external images have zero unexpected differences under the published
known-reference-difference contract. Current-source BIOS and DOS receipts and
final affected checks (32/32), checkpoint regression (38/38) and both rejecting
BIOS grader mutations accompany this candidate. Full hosted CI, real-mode fast/
Harris corpora and native contracts are the landing gate. No complete AT, 386,
Windows, Doom or physical-timing claim. External BIOS/media remain external.

2026-09-19 DONE — bwcx: exact explicit-NPN Ebers–Moll small-signal AC,
isolated worktree `/mnt/volume1/code/wt/bwb-npn-ac-level1`, branch
`lane/npn-ac-ebers-moll`, exact base `aec83d458ed5f638728148f9b389178e85716745`.
Owns the exact-NPN branch in `src/ac.js`, the minimum operating-point data
handoff in `src/board.js`, reuse/export of the existing Ebers–Moll parameter
and Jacobian authority in `src/mna.js`, one focused AC test, and this row.
Measured family: 160 ADI-v5 common-emitter AC rows, each with one exact
`NPN(IS=3n BF=200 VAF=130 RB=10)`. Bypassing CUI's guard on current master
executes all rows but all 160 disagree: 40,490/130,240 observations fail and
the largest complex-node error is 0.143111 V, because AC substitutes the old
knee/beta model and omits both junctions, Early effect and intrinsic-base RB.
Allocate an internal AC base only for explicit positive RB, linearise the same
converged Ebers–Moll law, and preserve generic NPN/PNP byte-for-behavior. Prove
the exact Jacobian/RB path, unchanged public DC state, and isolated old-model,
RB-bypass and Early-effect mutations. No capacitance invention, CUI/importer,
PMOS/MOS, generic transistor, tolerance, grid, workflow, or unrelated MNA work.
Implemented at `19579ac`: AC reuses the exact DC Ebers–Moll parameter/Jacobian
authority, reconstructs the converged intrinsic-base bias from the public
positive-into-terminal current convention, and allocates a hidden AC base only
for positive RB. The self-authored ngspice witness agrees within 20 nV; the
focused AC/source/DC surface passes 32/32, and isolated old-model, RB-bypass and
no-Early-effect mutations all fail the named witness. The exact 160-row replay
passes native, oracle and comparison for every row and 130,240/130,240
observations at unchanged tolerances (baseline: 40,490 failures), run
`f2a043e4...`, raw CIFS SHA-256 `766c35c0...`. Generic NPN/PNP compatibility
and the public DC operating point remain unchanged.

2026-09-19 DONE — bwcx: exact grounded-bulk Level-1 NMOS small-signal AC,
replayed worktree `/mnt/volume1/code/wt/bwb-nmos-ac-level1-v2`, branch
`lane/nmos-ac-level1-v2`, exact base `4bf004e1f5d4fca7f94427d793cc94c6b39b2876`.
Owns only the exact-NMOS branch of `src/ac.js`, one focused AC model test, and
this ledger entry. Current measurement: bypassing CUI's deliberate
semiconductor qualification guard executes all 160 exact ADI-v5 NMOS AC rows,
but every AC analysis fails (62,628 of 130,240 combined OP/AC observations)
because AC still uses legacy generic `k=0.5` plus flat `gds` instead of the DC
Level-1 `KP*W/(2L)`, triode, lambda, and threshold laws. Reuse the exported DC
model helpers at the converged bias for explicit `model:'level1'` grounded-bulk
NMOS with the corpus' zero/default body effect; keep the legacy generic MOS and
PMOS paths unchanged. Prove complex node response against self-authored
ngspice in saturation and triode, unchanged DC/public state, and isolated
legacy-k/flat-gds mutations. Implemented at `0b419df`: exact grounded-bulk
Level-1 NMOS now linearises the converged DC law in saturation or triode,
including `KP*W/(2L)`, lambda and the physical region boundary; generic
interactive MOS and PMOS retain their compatibility path. Focused AC/source/DC
surface passes 28/28; both isolated mutations are red. The exact 160-row replay
passes native and oracle OP+AC for every row and all 130,240/130,240 observations
at unchanged tolerances (baseline: 62,628 failures), raw CIFS SHA-256
`be655b6f...`, run `a27c2ec0...`. Exact-head qualification at `6014c04` passed
CI `35461265154` and Harris `35461265165`; replayed source/test blobs are
identical and only the intervening protected-ISA ledger claim differs. CUI
admission follows separately. No importer, tolerance, grid, oracle, Newton,
capacitance invention, richer MOS fields, workflow, or unrelated AC change.

2026-09-19 DONE — bwcx: exact Level-1 MOS triode/saturation boundary, isolated
worktree `/mnt/volume1/code/wt/bwb-mos-region-boundary`, branch
`lane/mos-region-boundary-exact`, exact base `6cb3c4d05ccbc6791b30c1d820dbe25844ef4dd3`.
Owns only the MOS region decision in `src/mna.js`, focused boundary coverage in
`test/nmos-operating-point.test.mjs`, and this ledger entry. The sole residual
after the exact 121-row NMOS replay is ADI-v5 row 1328: physical Vds is 1.6%
below Vov, but the historical 5% FSM band selects the saturation equation,
moving source/drain by 11.9/81.0 microvolts. The triode and saturation laws now
meet in value and first derivative, so measure replacing branch-changing
hysteresis with the exact physical boundary while preserving cutoff, declared
VDMOS soft-plus, body/bulk behavior, PMOS symmetry, and historical latch
convergence. Prove the exact common-gate ngspice witness and a mutation that
restores the 0.95/1.05 band. Implemented at `4ec2e5fe55fb79f8b62e2e56c55e2dc87e8e05ec`:
the state still exposes a branch change to Newton, but its value now comes from
the exact physical `Vds < Vov` boundary. The focused MOS/current/latch surface
passes 64/64. Restoring the 0.95/1.05 band makes the named common-gate witness
red at 11.9 microvolts on source; the candidate agrees with strict ngspice to
0.25 picovolt on source, 1.8 picovolts on drain, and 0.12 femtoampere on supply.
The provenance-qualified private replay closes the final row and passes 9/9
observations at unchanged tolerances: run `f54f42bf...`, raw CIFS SHA-256
`e5308b06...`. No tolerance, Newton budget, importer/CUI/corpus, other device,
workflow, or unrelated solver change.

2026-09-19 DONE — bwcx: explicit NPN base resistance, isolated worktree
`/mnt/volume1/code/wt/bw-board-npn-rb`, branch `lane/npn-base-resistance`, base
`5eb1f3013747c6f291b989b76afe5428269607c8`. Owns only the Ebers-Moll NPN
internal-base/resistor stamp and current extraction in `src/mna.js`, strict
public `rb` admission/profile metadata in `src/board.js`, focused exact-ngspice
coverage in `test/npn-operating-point.test.mjs`, and this ledger row. Allocate
an intrinsic base node only for an explicit finite `rb > 0`; omitted/zero RB
must retain the prior path and digits. Prove terminal-current KCL, public-state
non-mutation, invalid/extra refusal, and removal/current-reader mutations. No
PNP admission, other Gummel-Poon fields, CUI/Lite/corpus, tolerance, workflow,
or unrelated MNA refactor. Implemented one hidden intrinsic-base MNA node only
for explicit positive RB and the exact resistor terminal-current reader; the
public node map does not expose solver state. The ADI-derived RB=10 bench agrees
with ngspice for both node voltages, both source currents, all three transistor
terminal currents and KCL; omitted and explicit zero RB are deeply identical.
Focused surface 19/19, with isolated missing-stamp, wrong-current-reader and
missing-public-admission mutations all red by name. Full-suite qualification
is recorded on the final candidate rather than by a second source commit.

2026-09-19 DONE — bwcx: exact Level-1 PMOS operating-point and explicit bulk
terminal, isolated worktree `/mnt/volume1/code/wt/bwb-pmos-explicit-bulk`, branch
`lane/pmos-explicit-bulk-op`. Owns only the MOS bulk state/stamp/current path in
`src/mna.js`, strict public PMOS admission and structural preflight in
`src/board.js`, the minimum type/validation surface needed for an optional
fourth `bulk` terminal, focused PMOS operating-point tests, and this ledger row.
Measured target: 136 ADI v4 PMOS Differential Pair rows / 23 unique decks / 272
devices; every card is exact Level 1 with exact W/L and every bulk is a distinct
node tied to one explicit grounded 5–12 V source. Preserve all three-terminal
MOS behavior and default paths byte-for-behavior; do not infer bulk voltage,
alias bulk to source/ground, edit CUI/Lite/corpus repos, alter tolerances, or
broaden to richer MOS models. Board first; downstream import/replay follows only
after exact upstream qualification. Implemented optional explicit-bulk state,
two junction stamps and terminal-current extraction while retaining the existing
three-terminal source/ground cases. Strict public PMOS admission requires the
complete five-parameter Level-1 card and all four connected terminals. Focused
surface 101/101; self-authored saturation and forward body-junction witnesses
match ngspice, including bulk/source rail current and four-terminal KCL. Three
isolated mutations (drop explicit junction path, drop explicit current reader,
drop public admission) red by name. The first hosted candidate correctly found
two stale exact-scope assertions; the forward test-only repair is part of the
final qualified head. No CUI, Lite, corpus, richer MOS or tolerance change.

2026-09-14 DONE — root Codex: current-contract convergence, isolated worktree
`/mnt/volume1/code/wt/bwb-current-contract-root`, branch `lane/current-contract-root`.
Owns mixed-kind MNA extraction, public-current/cache consistency and affected
engine consumers; integrates bwlang `4ec189e` corrections with waveform master.
Raw/public terminal currents become positive out of part; operatingPoint keeps
its explicit positive-into-terminal API via one exhaustive boundary conversion.
James owns independent net-KCL/oracle acceptance; Zeno audits downstream signed
consumers and remains the guarded CI reader. Waveform numerical promotion paused.
No blind sign changes to storage histories, LED clamps, DRC or sweep consumers.
Guarded fast-forward landed implementation `d390df2ca486906c751aa3563532e95a0108b2a5`.
Exact CI `34858025634` and qualification `34858025656` succeeded. Current-reader
suite: 542/542; expanded OP-domain/scope gate: 30/30. Independent private receipt
`7d775996be1cb4710b96d0874b529d31320481f6` covers production-equivalent `d141b46`:
36 applicable phases pass, 12 explicit OP-domain refusals, 16 signed references;
nonlinear BJT/MOS witnesses establish direction only, not magnitude agreement.
Old-L and missing-cache-conversion mutations fail as intended. CUI consumes
the exact implementation package; separate waveform accuracy failures stay open.

2026-09-14 The MOSFET was two numerical conveniences, not a model — lego-ac.

Found by pointing the oracle at a FOREIGN corpus for the first time (ADI2005
v3, 12,471 valued decks, 15,587 M elements). Shipped gallery unchanged:
2,114 of 2,163 before and after, no circuit changed side. Suite 5,396 / 0.

**A 1 kOhm RESISTOR ACROSS EVERY CONDUCTING CHANNEL.** `gds` was a flat
`0.001 * taper^2`, put there for Newton stability. On an ADI cascode
(LEVEL=1, VTO=1, KP=1e-4, W/L=20, Vgs=1.8) the channel sources 640 uA and that
1 kOhm passed 3.4 mA beside it: ngspice 655 uA and V(out) 11.40 V, engine
4.56 mA and 7.85 V. `mosGds` now returns the MODEL's slope — `LAMBDA * Id`,
LAMBDA defaulting to SPICE's 0 — over a GMIN-scale floor (`MOS_GDS_FLOOR`
1e-7 S = 10 MOhm, four orders below the 1 kOhm it replaces).

**AND THE READER LEFT IT OUT.** The saturation extraction returned only the
VCCS term, so `branchCurrent` did not equal what the solve passed and KCL
failed AT THE PART: M2's drain read 1.395 mA while the 910 Ohm in series with
it carried 4.556 mA. Two ammeter positions, two answers.

**THE TRIODE LAW WAS MISSING ITS SECOND TERM.** `gOn = 2K*Vov` is the
small-Vds limit; the law is `K*(2*Vov*Vds - Vds^2)`, and at the saturation
boundary the dropped term is HALF the current. At Vov = 0.35 V into 36k the
engine passed 240 uA against 125, and the collapsed drain then held the device
in triode so it never recovered — a wrong model that also picks the wrong
region. Now the full law, with `Vds` as a second Newton variable (the same
shape as the BJT's second junction) and clamped at the boundary, so triode and
saturation MEET at `Vds = Vov` instead of stepping.

`lambda` joins the electrical schema. Channel-length modulation needs no extra
state: level-1 saturation is LINEAR in Vds, so `lambda * Id` stamped as the
drain-source conductance reproduces `Id*(1 + LAMBDA*Vds)` exactly.

On the cascode bench, cumulative: V(out) 0.0188 V -> 11.4037 V against
ngspice's 11.40361, and V(casc) 4.8032 against 4.803472.


2026-09-14 Full Ebers-Moll for the BJT, and the generic PNP — LANDED, lego-ac.

**`stampNPN` and `stampPNP` now reach an exponential path.** Not a translated
diode — that was measured and rejected — but full Ebers-Moll in transport form:
both junctions, a reverse beta, saturation falling out of the model instead of
being clamped. The same routing switch the diodes use gates it
(`JUNCTION_ROUTING.mode = 'shockley'` or `params.model`), so **the shipped
default is the knee and no corpus number moves**. Suite 5,396 / 0.

Measured on the saturated motor bench (5 V, 10 Ohm winding, base from 4.898 V
through 1k, 2N2222), against ngspice on the deck our own exporter writes:

    model        V(base)     V(collector)
    ngspice      0.815259    0.147347
    piecewise    0.741564    0.067245     <- never enters saturation
    Ebers-Moll   0.814789    0.147254     <- 0.5 mV and 0.1 mV

`test/junction-knee-classes.test.mjs` said the day a BJT reached an exponential
path it would fail and the decision would get made on purpose. **It did not
fail**, and that is the second finding: it scanned for three NAMES and
Ebers-Moll arrived under a fourth. A refusal by name needs the reachable set,
and nobody has that for a name not yet written. The zener's exclusion is now
driven rather than scanned, and the BJT's is a stated decision.

**A BARE TRANSISTOR WAS EXPORTED AS A DIFFERENT DEVICE THAN IT WAS SOLVED AS.**
bw-circuit-ui's symbol table falls back to a NAMED part number for an un-carded
transistor — `2N2222` for npn, `2N2907` for pnp — and both carry Bf = 200 while
the solver's default is 100. On `10-motor-speed` the engine put the collector at
0.912 V (active at Bf = 100) and ngspice at 0.147 V (saturated at Bf = 200): a
15.8 % split on supply current across 15 circuits, and NOT a model gap. Added
`Q_DEFAULT_PNP`, the mirror of `Q_DEFAULT`, so an exporter has a generic card to
resolve to instead of a part number that is not the device on the bench.

`classDefaults` gained `npn`/`pnp`/`tip120` with `is`, `beta`, `br` and `n`.
`br` (reverse beta) is new and is SPICE's own default of 1 — no card carried
one, so the choice is stated in the one authority rather than as a literal in
the stamp.


2026-09-13 `deviceCompanions`: a part with no card must not vanish — lego-ac.
**Corrected the same day after review: it returns `{converged, timeNs, records}`,
not a bare list, and it is a SNAPSHOT of the board's live solve — not a DC
operating point.** The first comment said "DC linearisation at the converged
operating point" and both halves were wrong: `_solveMNA(false)` is the
instantaneous solve (a charged capacitor is a conductance and a source, not an
open), and convergence was neither checked nor reported. A consumer must not be
able to take the records without the two facts that qualify them, so the two
facts are in the return.


`BoardImpl.deviceCompanions(partId)` returns the companion elements the board's
CURRENT solve stamped for a part — the same records the generic terminal-current
extraction is already derived from, and the same solve `nodeVoltage` and
`branchCurrent` report.

  {kind: 'cond',    tA, tB, g}        conductance between two terminals
  {kind: 'norton',  t, g, vth}        Thevenin vth behind 1/g, to ground
  {kind: 'between', tP, tN, g, vth}   the same, floating between two pins
  {kind: 'inject',  t, amps}          a current pushed into a terminal

**WHY AN EXPORTER NEEDS IT.** A part a target format has no card for was
dropped, and a dropped part does not make a deck smaller — it makes it a
DIFFERENT CIRCUIT, which the foreign simulator then answers about with total
confidence. Measured against ngspice on the shipped corpus: a `74hc595` dropped
this way left eight LED branches at 0 V against the engine's 1.842233 V, and a
`buzzer` dropped this way left its node at the full 5 V rail against the
engine's 4.0 (5 x 100/125). **42 kinds present the engine an impedance or a
source and have no SPICE card, in 1,250 of the 2,163 corpus circuits.**

`button`, `switch` and `buzzer` are built-ins rather than registered devices, so
they record their own single `cond`. A CLOSED button dropped from a deck is an
open circuit — the opposite of what the engine solved.

What it is NOT: a model. It is one operating point's linearisation, valid only
at that bias, and a consumer must label it as such. In the SPICE exporter these
cases are `original-adapted`, never `original-direct`: the device's own DC
behaviour is taken as given while every OTHER element stays independently
judged.

Cost: the accessor copies its records, so a caller cannot edit what the solve
stamped.


2026-09-13 Two sources on one terminal, and a board that fights its own rail
— LANDED, lego-ac. Both found by the ngspice corpus sweep, neither by a test.
No node voltage in the 5,352-test suite moved.

**IF YOUR MODEL DECLARES `state.drives`, IT MUST NOT ALSO `ctx.thevenin` THAT
TERMINAL.** `stampDevice` stamps every drives entry as a Norton and THEN calls
`model.stamp`, so a model doing both put two identical Nortons in parallel: the
declared source impedance HALVED and the terminal current DOUBLED. Nine kinds
did it — `battery_9v`, `battery_coin`, `solar_cell`, `usb_a`, `arduino_nano`,
`arduino_uno`, `arduino_mega`, `pi_pico`, `eater6502`. A 9 V battery had 0.5 Ohm
internal resistance, not the 1.0 its own model declares. `src/ac.js` collapses
drives and `ctx.thevenin` to output conductance the same way, so small-signal
output impedance was halved too: one root, both solvers.

It had been diagnosed once already. `battery_aa` carries the comment "A
simultaneous state.drives source would put a second Norton in parallel, halve
the declared internal resistance, and incorrectly reference pos to ground" — a
correct account, applied to the one part where it was noticed. A rule about one
call site is not a rule about the mechanism. `test/device-sources-once.test.mjs`
now asks the question once per REGISTERED KIND, from the registry.

**AN IDEAL `vcc` RAIL OUTRANKS A FINITE-IMPEDANCE DEVICE DRIVE ON ITS NET.** A
`vcc` part is a voltage-source ROW: it pins its node exactly. A Pico's VBUS, a
battery's `pos`, a usb_a's VBUS in parallel with it cannot move that node by a
microvolt — every amp returns through the ideal source — so the drive's only
effect was to invent a circulating current between two sources. Measured: a Pico
with VBUS on a 3.3 V bench rail read 17 A on that pin against ngspice's 0, and
VSYS (4.7 V) read -3 A into a 5 V rail. **595 of the 2,163 corpus circuits wire a
dev-board supply pin to a `vcc` part**, and in every one of them the other supply
IS a `vcc` part, so that is the whole measured population.

Suppression changes NO node voltage, by construction; it changes exactly two
readings, the suppressed pin's own current and the rail's. It is also the right
physics: a board's VBUS/VSYS/5V pin is a source only when nothing else powers
that net — wire a bench supply to it and it is an INPUT. Only drives the MODEL
owns (`_staticDrives`) are outranked; a GPIO driving low into VCC is still a real
short and board.js still reports it.

Named, not done: a WARNING when the suppressed drive disagrees with the rail by
more than a diode drop (a Pico VBUS at 5.0 on a 3.3 V rail is user error the
bench should surface). Sized but unmeasured for noise, so left out of this
change rather than reded across 595 circuits.

**The junction-knee exclusion gate was reading prose.** It scans `stampNPN` for
the exponential path and fired on a COMMENT recording why the exponential B-E
junction was tried and REVERTED. Now comment-stripped, and sliced to the next
top-level `function` instead of a fixed 4,000 characters — `stampNPN` is 3,620
long, so the window was already reading its neighbour and would have named the
wrong function in its own failure message.


2026-09-13 Junction authority: zener split, half-read bulk, device-scaled knee
— LANDED, lego-ac. Follow-on to the vf-convention entry below, and mostly a
record of what THAT fix made findable. Suite 14 -> 0, 29 tests added, every
moved expectation re-derived against ngspice rather than relaxed.

**If you export, solve, or oracle a ZENER, re-read your bulk resistance.**
`junctionRd` branched on `kind === 'diode'` while `junctionOpts` read
`classDefaults`, so led and diode agreed and zener did not: a zener is silicon
(0.568) and the else-branch handed it 10. An 18x split between the model we
solve and the model we export. The gate that should have caught it pinned one
CONSTANT against one CARD — true of the two kinds it named, blind to the third.
`junctionRd` now reads the table and the gate enumerates kinds through the
FUNCTION the solver calls; `SILICON_RD` is deleted, having lost its last code
reader.

`junctionRd` also read only `params.rd`, and cards store `rs` — so `1N4001`'s
0.045 reached the exponential path and was invisible to the piecewise one.
`LED_RED` hid it by carrying both spellings.

**The PWL knee's blend band is no longer an absolute voltage.** `PWL_KNEE_EPS`
was a flat 0.025 V, but the knee's scale is `i_rated*rd`: 0.2 V for an LED (8x
the band) and 0.01136 V for a 1N4148 (0.45x — inside it). Silicon never reached
its linear segment at its own rated current, so 5 V through 150 R, which IS the
rated bias by definition of `vf`, read 20.0176 mA against 20.0000 and an
effective bulk of 0.4356 against 0.568. Now `min(0.025, 0.5*i_rated*rd)`: **LED
operating points are bit-identical, so this half costs the corpus nothing**;
silicon becomes exact. It was unreachable while every kind shared rd = 10.

**A LIMIT I RECORDED AS HARD IS NOT, AND THIS CHANGES WHAT THE CORPUS CAN
COVER.** I wrote that ngspice's silent 1e-28 IS clamp makes every LED above
~2.86 V unrepresentable and that such parts must be left out. The clamp belongs
to the DIODE MODEL. A behavioural source has none, and solves the identical
device with ngspice's own Newton and limiting. Validated against `.model D` on a
part both express — 5e-6 relative at three operating points — then used to
measure blue, white, UV and a vf=3.5 bench, all previously unmeasurable. Seven
of the eight colours agree with our engine to 0.0000 %; the eighth is infrared,
the one the router leaves on the walker, showing the 4.18 % shape gap exactly
where `MNA_HEADROOM_V` says it should. **Before excluding a circuit from the
sweep as "ngspice cannot represent this", re-check it against the behavioural
form** — the exclusion list was built on the D-model limit. Blue's golden is
still recorded AT the clamp and can now be re-derived: named, not done.

**ngspice decks need BOTH `.options temp=X tnom=X`.** `temp` alone leaves a flat
+0.686 mV at every current, because IS is rescaled from the TNOM=27 default via
the bandgap law. I had recorded the ngspice floor as VT_25C vs 300.15 K — same
root cause, but the fix is `tnom`, and with it the floor is not 0.04 %, it is
zero. Our spot currents then match ngspice to 2e-7 V over four decades.

`bw-circuit-ui` PR #21's bench is now oracle-exact: 1.748000 V against ngspice's
1.748004, from 1.879795 (130.8 mV out).

Derivation and reproduction for every number:
`test/measurements/JUNCTION-AUTHORITY-2026-09-13.md` and
`test/measurements/repro/`.


2026-09-13 E1.3b vf convention + per-kind bulk resistance — LANDED, lego-ac.
`vf` now means the DATASHEET total drop at the rated current in BOTH junction
paths; it previously meant the knee in the piecewise one, so the two paths
disagreed by 6.67 % at the rated bias (18.7500 mA against 20.0000 mA) and the
piecewise path was -7/-9/-14 % against ngspice. Bulk resistance is now per kind
(`SILICON_RD = 0.568` from our own D1N4148 reference) because sharing the LED's
rd = 10 made the correction a REGRESSION for silicon: 0.5446 V where the
unchanged code gave 0.7426 and ngspice gives 0.6532. Zener and BJT are
deliberately excluded and PINNED by `test/junction-knee-classes.test.mjs` with
the reasons (one path, no rated current, 0.7 IS the knee number for silicon);
the optocoupler's hard-coded rd = 50 is a separate decision, untouched.

**READ THIS BEFORE BUMPING LITE'S bw-board PIN PAST `fe17d7c`.** Nothing in the
shipped app changes until someone bumps, because lite consumes the engine at a
pin. When you do — these are the MEASURED two-pass numbers, and they replace an
earlier algebraic estimate of mine that was wrong in both directions:
**313 of 2,739 LED readings move, median +5.05 %, and the MAXIMUM IS +39.6 %,
not the +10 % I first wrote.** Most corpus LEDs are off at the sampled moment
and read identically; the long tail is dimmed LEDs — a pot or dropper cuts the
headroom across the junction, and a fixed 0.2 V correction is proportionally
larger the smaller that headroom is (`41-pot-as-dimmer` x1.386,
`disp-bargraph` onboard x1.396). **Zero lit/dark crossings**, which is the
claim that mattered. If you are re-deriving a claim on a DIMMED LED, expect
tens of percent, not single digits. Lite's
lesson-bench and claim suites carry numeric brightness expectations that WILL
move by that amount. **Re-derive them in the same commit — do not widen
tolerances.** The 232-bench / 2,635-claim pass belongs to that bump, not to
this lane, and is the bump's deliverable.

Derivation, every table and its falsifier:
`test/measurements/E13B-CALIBRATION-REDERIVED.md`. 22 suite expectations were
re-derived against ngspice where a deck was representable; the single exception
(the loaded-pot wiper, 1.8485) is labelled CHARACTERISED not oracled in its own
file and needs a deck before it can be defended.


2026-09-12 R2 cooperative hybrid execution — IMPLEMENTED/LOCALLY QUALIFIED, Codex root. User explicitly
requested continued performance coding and remote default-branch merge after
qualification. Integration `feat/harris-hybrid-cpu-integration` now includes
upstream `536eb19`. Dedicated workers own `harris-cooperative-transactions`
(host runner/tests) and `harris-native-ci` (native workflow/contracts); root owns
sustained ROM benchmark, real-board event tests, census, docs and merge checks.
No branch deletion, app deployment or implicit backend promotion is requested.
Worker lanes are complete; source candidate `c42ed96` passes 171 local tests
without skips and frozen Chromium qualification. Final hosted qualification and
authorized remote master merge are tracked in engine PR5. Receipts and remaining
scope: HARRIS-HYBRID-COOPERATIVE-EXECUTION.md. No full-native/capacity completion.

2026-09-12 R1 hybrid CPU integration — DONE (bounded R1 only), Codex root, user-requested actual
wired execution/performance coding. Isolated `feat/harris-hybrid-cpu-integration`
from upstream `6e4327c393ae6f57beb09d345a3aa91be1393729`; adapter worker owns
`feat/harris-native-memory-board-r1`, CPU worker owns
`feat/harris-boot-cpu-batching`, both from `7fbdfa9`. Root owns differential
integration tests, benchmark and docs. Adapter `52b23fb`, CPU `270f88b`, browser
oracle `a835ff6`, final validation `718ba08`: 151 targeted tests, zero skips;
frozen Chromium accepted. HARRIS-HYBRID-CPU-IMPLEMENTATION.md and receipts record
scope and remaining full-native/peripheral/capacity work. Both worker sublanes
are complete. No app pin/default/merge/deploy change.

Created 2026-09-04, at `lego-47`'s request, because the fleet's 8086 work now
runs across a dozen worktrees and the claims had nowhere in THIS repo to live.
This file is the canonical registry for `bw-board`; Brickwright Lite's
`LANES.md` is the long-form protocol. Cross-repository work claims each affected
repository by its path/package boundary rather than creating a rival global
registry.

### Repository role — upstream first, independent of landing speed

`bw-board` is the source-of-truth engine. Shared engine behavior lands here
with its behavior tests before Brickwright Lite consumes it. Lite now installs
this repository from the exact git SHA recorded in its `vendor-pins.json`; it
does not carry a tracked bw-board source tree in which an unreviewed downstream
fork can hide. Lite's package specifications and lockfile are tested derivations
of that pin.

The lean qualification rule below changes only how many times an identical
commit waits for CI. It does not permit a Lite-only reimplementation, a moving
branch dependency, an implicit pin bump, or a skipped upstream behavior proof.
Engine change first; its package is then consumed directly at a reproducible
identity downstream. One lane owner carries that chain; do not copy source or
create a manual handoff loop. Brickwright Lite's `docs/VENDORING-REGIME.md` is
the canonical cross-repository statement.

**1. One session, one isolated worktree, one active task. Before implementation,
look.** Fetch the canonical default branch, read recent branches and the CLAIMS
table below, and compare scopes by overlapping paths or package boundary.

**2. A claim is not a lock until its claim-only commit is merged to the remote
default branch.** Record owner/session, worktree, exact scope, base SHA and
status. If two claims race, the rejected writer fetches and rereads the ledger;
if the competing scope is occupied, abandon it rather than rebasing a duplicate
claim through. An expired claim requires an explicit takeover. Preserve dirty
or in-flight work and resolve its ownership before its next implementation
step—never reset, force-move or overwrite it.

Move the row to DONE in the implementation commit. The commit containing that
row is its non-self-referential result identity (`git log -- LANES.md`); include
focused test and CI links already available. Do not add a separate receipt
commit unless a failure or substantial risk needs a durable account.

### Lean qualification rule (2026-09-13)

The claim prevents duplicate work; the tests prove the change. Do not turn the
ledger itself into a second implementation lane:

- Keep the remotely merged claim, isolated worktree, explicit path envelope,
  focused behaviour tests, and a meaningful negative or mutation proof where it
  applies. Before the ONE hosted qualification, make the candidate final: move
  its row to DONE in that same head and include every receipt already available.
- One automatic exact-head qualification set is enough. When it is green and
  the remote default branch is still the candidate's parent, re-check both shas
  and fast-forward normally. Never force-push and never dispatch a duplicate.
- Moving an already-qualified identical sha to the default branch does not need
  another blocking wait. Verify that the remote points at the intended sha;
  automatic post-push runs remain alarms that must be acted on if red, but their
  completion is not a second landing gate.
- If the default branch moved, requalify when executable paths overlap or the
  combined behaviour may have changed. For a provably disjoint documentation or
  ledger-only move, preserve the lane diff byte-for-byte, verify ancestry and
  focused tests, then let the automatic default-branch run test the combined
  tree. Do not spend a full hosted cycle proving prose commutes with code.
- A real failure still stops the lane. Do not rerun an unchanged failure, relax
  its gate, or bury it in the ledger. Batch status checks and poll GitHub no more
  than once per minute.
- Five minutes from claim to landing is the target for a small bounded edit, not
  permission to skip relevant checks or land known corruption. ABI, persistent
  state, scheduler, destructive and other semantic-risk changes require
  proportionately broader proof.
- One owner carries the task through landing. Use guarded non-force pushes or a
  single landing queue; do not manufacture peer handoff ping-pong. When sending
  screen/tmux coordination, submit the text with a separate carriage-return
  delivery call so it does not sit unsubmitted.

This replaces the fleet habit of separately qualifying the implementation,
then a CLAIM-to-DONE-only successor, then waiting on the identical post-push
sha. Those repetitions supplied no new behavioural evidence and repeatedly
turned minute-sized patches into multi-hour landing sequences.

**3. ONE WORKER PER TREE, and an agent counts as a worker. PATH SCOPING IS NOT
ENOUGH.** Commit by explicit path, never `-A` or `.`, in a tree you did not
create — but understand what that buys you, because on 2026-09-04 it twice did
not save anyone. **Path scoping limits which FILES you sweep, not which
AUTHORS' changes within a file.** The support-chip lane committed `ROADMAP.md`
by path and still swept another session's uncommitted survey into its commit
(`4560d78`), because both sets of hunks were in the one file. And `lego-47`
destroyed its own uncommitted fix with `git checkout --` on a SINGLE FILE —
path-scoped, still lost. The two forms that actually hold:

- **Commit before you mutate.** An uncommitted edit in a shared tree is not
  yours, it is ambient.
- **Or copy the file out first**, and re-apply after.

And if you find another author's hunks intermixed with yours in a file you are
about to commit: revert YOURS, tell them to land theirs, re-apply after. That
is what happened on the second pass of `4560d78` and it worked.

**4. Check the SHAPE of your tree before pushing a ledger edit**, not just your
diff: `git ls-tree HEAD | wc -l`. A single entry means your tree is a DELETION.

**5. A roadmap item asserting a gap must be re-checked against the tree on the
day it is ACTED ON.** Two of §E6.8's nine items were stale within twenty-four
hours of being written, by work that landed while the survey was being drafted:
the CI vector grader already existed (sim3's R1) and the bootable MS-DOS image
already booted, down two independent paths. The rule earned itself twice more
the same day — the support-chip lane found its own EXTRACTOR IRQ gap closed on
the day it was written down. **At this fleet's current rate a gap claim has a
shelf life measured in hours**, so the check is not diligence, it is the only
thing standing between a claim and a day spent re-doing finished work.

**6. A CONCLUSION FROM A REMOTE-TRACKING REF MUST BE RE-DERIVED, OR PINNED TO
AN EXPLICIT SHA, BEFORE IT IS ACTED ON — AND ABOVE ALL BEFORE IT IS BROADCAST.**

We are **sixteen worktrees of one `.git`**. One object store, one set of
`origin/*` refs. A peer's `fetch` or `push` in their worktree rewrites *your*
remote-tracking refs, with no action of yours.

Measured, 2026-09-04. `git diff --stat origin/master origin/feat/i8086-support-chips`
reported **40,584 deletions across 106 files** — `rom/bios.asm`, `i8086-asm.js`,
`VERIFICATION.md`, all apparently destroyed by a peer's branch. It was a clean
`master+5`: **848 insertions, 1 deletion.** The branch ref had moved six times
(`13dc7f3 <- 5e8e313 <- cfd7317 <- 2925f23 <- 3233b1b <- c293a5c`) and had been
replaced *between two of the reader's own commands*, with no fetch in between.

**The diff was not wrong. It was true when made and false when used.**

That makes it a distinct failure family from the others in this file, and worse
in two ways:

- **The wrong answer is confident and alarming.** "Your branch deletes 40,584
  lines" is not a subtle miscount; it is the kind of claim that gets acted on
  within a minute of being received.
- **It has no symptom.** Every other trap here leaves something visibly odd — a
  suspiciously round count, a green case and a red case failing together, a
  suite that finishes too fast. A stale remote ref simply answers, promptly and
  wrongly.

The check that dissolved it took one command:

    git merge-base --is-ancestor origin/master origin/their-branch

Use it, or `git rev-parse` the sha and diff against that, before you believe a
cross-branch diff — and never send one you have not re-derived.

---

**7. RE-DERIVE IDENTITY BEFORE YOU BROADCAST IT — AND VERIFY A CORRECTION AS
HARD AS THE CLAIM IT CORRECTS.**

**This rule previously said something false, and the way it went wrong IS the
rule.** It recorded that two sessions wrongly concluded `lego-47` was gone while
`lego-47` was receiving everything. That is not what happened.

What happened, 2026-09-04:

1. Repeated `Failed to send` to `lego-47`. Reported as unreachable. **This was
   correct.**
2. A session replied *"I am lego-47 and I am reachable — address me by that
   name."* Written with authority, and it explained the symptom.
3. That correction was accepted, propagated to a third session, and written
   into this file as a rule — **without re-running the one command that
   settles it.**
4. `ListAgents` lists `lego-47 [40a375]` (idle, 1d) and `lego-be [61a550]`
   (busy, 1h) as **two separate rows**. The replying session was `lego-be`. It
   had cached an earlier `ListAgents` reading of its own identity, true when
   made, and never re-derived it.

So a correct report was withdrawn in favour of an incorrect correction, and the
error was then durably recorded. Two failures, and the second is the worse one:

- **A cached identity is a stale remote ref with a friendlier name.** Rule 6 is
  about `origin/*`; this is the same mechanism applied to *who you are* and *who
  you are talking to*. The 40,584 number makes people check a diff. **Nothing
  makes anyone check who they are speaking to.** Re-derive identity and location
  before broadcasting them, not only diffs.
- **A correction is a claim.** It arrives with the authority of a fix and the
  social weight of someone admitting fault, which is exactly why it slides past
  the scrutiny the original got. The original report here had been verified two
  ways — failed sends *and* an `ListAgents` row. It was abandoned on an
  assertion. **Verify a correction at least as hard as what it corrects,
  especially when it is flattering to accept.**

The surviving true part: **cross-session sends can fail, and a failure is
"unreceived" — never consent, never absence.** But do not infer a peer is gone
from send failures alone; check `ListAgents`, and if a row says they are alive,
that is disconfirming evidence rather than noise to explain away.

**8. PUBLISHING TO `master` IS THE OWNER'S CALL, NOT A PEER'S.** A peer can
review, verify, clear a merge order, and say a branch is ready. None of that is
authorisation to push to `master`. The boundary is about **who authorises
publishing, not whether the change is good** — a change can be correct,
reviewed, and green, and still not be yours to publish. Stated by `lego-ef`,
upheld by `lego-47` in both directions on 2026-09-04.

**9. "TOUCHES NO SHARED FILES" IS NOT "CHANGES NOTHING FOR THE PENDING
MERGES."** Only the first is checkable from a diff.

2026-09-04: a commit landed on `master` touching exactly two files that no
pending branch touched — genuinely orthogonal **by content**. It was not
orthogonal **by base**: it staled the base of *both* branches in a merge order
that was still being negotiated, and forced a re-rebase in a required sequence
(theirs, then mine) to avoid replaying one lane's commits under the other's
shas.

A diff can prove file-level independence. **Nothing can tell you what is
pending except knowing what is pending.** So before pushing to a shared branch,
ask who is mid-merge — and remember that **being authorised to push is not the
same as it being the right moment**.

---

**10. A MESSAGE THAT FAILS TO SEND LEAVES NO TRACE ON THE RECEIVING END.** When
your send fails, the recipient does not know you tried. They see silence
identical to your never having written.

This asymmetry is the entire argument for putting anything load-bearing in a
**file in their tree** rather than a message: a commit is durable, addressable,
and does not depend on a channel working in the direction you assumed. On
2026-09-04 a lane that could not be reached by five separate attempts was
finally warned by a commit to `LANES.md` in its own repository.

And when relaying something you have not checked, **mark it unverified**.
Passing on a second-hand report as fact makes you the next link in a chain
nobody has confirmed — which is exactly how a phantom "40,584 deletions"
(rule 6) nearly travelled to three sessions.

**AMENDED 2026-09-05: A FAILED-SEND REPORT CAN BE A FALSE NEGATIVE.** A send
to lego-ac returned `Failed to send to lego-ac` -- an explicit failure, not a
timeout -- and the message had already arrived. Retrying on the strength of
the rule above then delivered it twice. So the report is evidence the message
MAY not have arrived, not that it did not, and the two failure modes need
different handling:

- treat the peer as possibly uninformed, so retry rather than assume silence
- but SAY IT IS A RETRY in the first line, because the cost of a duplicate is
  paid by the reader, and one sentence turns "read this whole thing again to
  find out if it is new" into a glance

**MECHANISM FOUND, later the same day, and it makes the retry advice WORSE
than useless in one common case.** A `Failed to send to X` is what this tool
reports when the message was actually **HELD FOR THE RECIPIENT USER'S
APPROVAL**. It is not a failure at all; it is a queue. Three sends to the
kerotakis sessions reported failure, and the delivery notices then arrived:

```
  held for the recipient user's approval ... not delivered yet
  approved and released to that session
```

So the first copy was never lost, and the retry did not recover a dropped
message -- **it added a second copy to a queue that already held the first.**
Retrying on a failure report does not merely RISK duplication when the peer's
user gates inbound messages: it GUARANTEES it. I did this to kerotakis-59
within ten minutes of writing the paragraph above.

**The corrected rule:**

- A `Failed to send` means UNKNOWN, and the most likely cause is a held
  message rather than a lost one. Say the thing once.
- Do not retry on that report alone. Wait for a delivery notice, which does
  arrive and does distinguish held / approved / released.
- If you retry anyway -- because the content is time-critical and a duplicate
  is cheaper than silence -- label it, and say plainly that it may be a
  duplicate rather than a correction. Mine said "discard if you already have
  it", which is the only reason the duplicate cost the reader one line.
- NEVER escalate to a third channel on two failure reports. I relayed a
  decline through a sibling session on the strength of two "failures", both of
  which had already been delivered; that relay is now a third copy of a message
  its recipient did not need.

The underlying error is the day's error at one more remove: trusting a report
ABOUT the send instead of the send. Here the report was not merely unreliable,
it was WRONG IN A SPECIFIC DIRECTION -- it named as failure the one outcome
that most needed patience -- and acting on it produced exactly the harm the
first version of this rule was written to avoid.

**11. THE MACHINE LAYER IS VENDORED INTO `brickwright-lite` AND ALL THREE FILES
ARE DIVERGED IN BOTH DIRECTIONS.** Your change here does not reach lite, and
lite has changes that do not reach here.

Measured 2026-09-05 against `ec1272a`, versus
`lite/overlay/scratch-gui/src/lib/bw-board/`:

```
                      lite AHEAD    lite BEHIND
i8086-machine.js         171            59
z80-machine.js            88            33
m6502-machine.js          75            28
```

With `CircuitDesigner.jsx` (19 ahead / 46 behind, found by lego-be) that is
**four files**, three of them the machine layer. The general form, theirs:

> A vendored file that is BEHIND is an inconvenience. One that is AHEAD is a
> fork nobody declared. One that is **both** cannot be resolved by any tool,
> because no tool can know which of two changes was intended.

**The corollary the count adds: this is not an accident that happened twice.
With four, it is the steady state of any vendored directory both sides edit.**

**The AHEAD content is a subsystem, not drift.** Lite has an entire
`machine-checkpoint.js` — `MACHINE_CHECKPOINT_SCHEMA`, `checkpointSupport`,
`checkpointTopology`, `checkpointRefusal`, `validateCheckpointEnvelope` — wired
into `z80-machine.js` and `m6502-machine.js`, and absent from bw-board
entirely. A sync from here **deletes a whole feature and nothing fails**: the
machines construct, checkpointing just stops existing. Same shape as lite's
`displayRevision` repaint optimisation.

**So: do not sync either direction wholesale.** `sync-bw-board` already refuses
on a stale checkout, and `--check` reports differing files while stating it
cannot tell direction. Both correct, neither sufficient. Graft your own hunks
by hand and verify the other side's survive.

**AND ONE HAZARD THAT IS SPECIFIC AND SILENT.** The `_advanceChips` schedule
cache is two pieces that must travel together:

1. `this._advList = null` in the constructor, `_buildAdvanceList()`, the flat
   loop — the visible part, and the reason anyone would port it;
2. `this._advList = null` in **`attachDevice`** — one line, easy to miss.

Port (1) without (2) and any device attached after the first `step()` silently
never ticks: no exception, no wrong value, nothing red. **Lite has no
`machine-contract` test**, so the guard that catches this
("a device attached AFTER stepping still gets advanced", asserted for all three
machines and verified by deleting the invalidation until all three go red)
does not exist in the repo where such a graft would happen. Port the test with
the cache, or do not port the cache — lite's machines are correct as they are.

**12. `cmd | grep` REPORTS GREP'S STATUS, SO `&& git commit` COMMITS ON A RED
SUITE.** This is a shell mechanism, not a lapse in attention.

Every test run in this repo gets filtered — `node --test test/ | grep -E "^# (pass|fail)"`
— because the raw TAP output is thousands of lines. A pipeline's exit status is
its **last** command's, so the chain gates on whether *grep matched*, never on
whether the *tests passed*:

```
  (echo "# pass 5"; exit 1) | grep -E "^# pass"          -> exit 0
  set -o pipefail; same                                   -> exit 1
```

The left side failed. Without `pipefail` the chain proceeds and commits.

**Written as a rule about shell rather than about care, because the discipline
version demonstrably does not work.** It is in this file already as "a failed
patch step does not stop a commit unless you chain it" (rule 3's neighbour),
and the author of that line then pushed a red test twice in the same day. Two
sessions hit it today; one caught it once. When a rule has been written twice
and violated twice by the person who wrote it, the fault is in the mechanism.

**The fixes, cheapest first:**

- `set -o pipefail` at the top of any command that chains on a filtered result.
- Or drop the pipe when the result gates something: run the suite unfiltered
  into a file, `grep` the file for display, and chain on the run's own status.
- Or simply do not chain. Run the gate, LOOK at it, then commit as a separate
  command — which is what "verify, then act" means when the verification is
  a program rather than a claim.

**The tell, when it has already happened:** a red line scrolled above a
successful push in the same output block. If a commit and a test result appear
in one command's output, the commit did not depend on the test.

**13. A VERIFICATION MEASURES SOMETHING ADJACENT TO THE QUESTION UNLESS YOU
SAY WHICH THING IT MEASURES.** Three times on 2026-09-05, across two sessions,
a check was run whose number was real, honestly obtained, and about something
next to what was being asked:

```
  question                        what got measured            verdict
  does the core double-fetch?     busTrace entries             "no"      WRONG
  do jobs cluster at the cap?     run duration                 "no"      WRONG
  does the vendor gate hold?      the INCOMING file            "yes"     WRONG
```

Every one of these passed its own local checks. The method was sound, the
tool worked, the output was accurate. The error is entirely in the gap between
the quantity and the question, and **that gap is invisible from inside the
check** — nothing about counting trace entries announces that the bus is a
different thing from the trace.

**The prefix case is the clean specimen.** `busTrace` is a MODEL of the bus;
`read()` is the bus. A bare `this.read()` pushes no trace entry, so the peek
was silent in the trace BY CONSTRUCTION. Verifying the fix through the trace
could not have failed, whatever the code did. The verification was not weak,
it was structurally incapable of detecting the defect — and it was written by
the same commit that introduced it, which is how it crossed a pin before a
downstream test caught it.

**The rule:** before a check counts as verification, state the substitution
out loud — "I am measuring X to answer about Y" — and then ask what would make
X and Y disagree. If X is a model, a proxy, a log, a cache, or a summary of Y,
measure Y. If you cannot measure Y, say the result is about X.

**The tell:** you are about to report a NEGATIVE result ("no duplicate", "no
clustering", "no leak") from an instrument built by the same work that would
have caused the positive. A negative from a proxy is the weakest evidence
there is, and it is the one we keep believing.

**THE SAME RULE WITH THE SAMPLE IN PLACE OF THE INSTRUMENT**, added
2026-09-05 after two more instances in one hour. A check cannot contradict you
when you chose what it looks at:

```
  general claim written              what it was checked against       verdict
  "EOT=18, 360K unaffected"          47 tests I picked myself          WRONG
  "failures have an ODD start"       only the cases that failed        WRONG
```

The first: 47 disk tests passed, so the claim went into the ROM and the
roadmap. The full suite failed three, and they were the tests that PIN the
behaviour being changed -- `test/bios-fdc.test.mjs:245` requires the head
switch at EOT=9 on a 9-sector medium. A subset chosen by the person changing
the behaviour is selected, however honestly, for not containing the objection.

The second: every failing read had an odd start sector (s9, s11, s13, s15,
s17), so "odd" went in as the predicate. s1, s3, s5 and s7 are odd too and
read correctly -- the predicate was "reaches sector 9", the declared EOT. A
pattern read off the failures alone has nothing to disagree with it.

**Both fixes are the same move:** run the cases that could refute you before
writing the general claim -- the tests that pin the behaviour you are
changing, and the cases that PASSED. If you cannot name what would have
falsified the sentence, it is not a finding yet.

**WHAT NAMING A FAILURE MODE ACTUALLY BUYS YOU**, added 2026-09-08 after
committing this one four times in a single file, twice AFTER writing it down:
naming a failure mode buys the ability to CATCH it, not to avoid it
(lego-ac's phrasing). All four were caught, and two of them by the run's own
output contradicting itself — which is only possible because the evidence was
printed beside the conclusion. Print the measurement next to the sentence it
supports, and a wrong sentence has something to disagree with.

**Corollary for tests:** a test guarding a proxy-invisible property must not
use the proxy. `test/i8086-prefix-fetch.test.mjs` deliberately does not look
at `busTrace` and counts `read()` invocations instead, and its injection reach
was verified by running it against the unfixed core (3 of 4 fail, with the
addresses printed) rather than assumed from its passing.

**14. A PEER MUST NOT SUPPLY A USER TURN IN SOMEONE ELSE'S SESSION, AND NO
AUTHORISATION CAN MAKE THAT WORK.** On 2026-09-07 lego-ac could see an owner
instruction typed but never submitted in lego-a4's input box, held an explicit
owner authorisation — given in lego-ac's OWN session — to press Enter on such
pending lines, and did. It did not arrive; lego-a4 held and did not start the
work. Both sessions then agreed the mechanism was wrong independently of
whether it worked.

**Why it is wrong even when the peer is right about what the owner wants.** A
user turn is the one signal a session cannot obtain from outside itself, and
that is its entire value. Manufacture it and the receiving session gets
something INDISTINGUISHABLE from its owner typing — so it cannot tell an
authorised affirmation from an invented instruction, and neither can the owner
reading the transcript back later. The boundary is not a lock to be opened by
someone with the key; it is a property of where the message came from, and a
mechanism that satisfies it from outside destroys the thing it is respecting.

**An authorisation is scoped to the session it was given in.** lego-ac's
permission was real. It made them free to act in their own lane; it could not
make them a channel for another user's intent in another lane. This is rule 8
("publishing to master is the OWNER'S call") one level down: there, a peer
cannot consent on the owner's behalf; here, a peer cannot SPEAK on it.

**What to do instead, which costs one sentence:** tell the owner the
instruction is typed and unsubmitted, and let them send it. Both sessions
reported exactly that and the line was unblocked without anyone pretending to
be anyone.

**The part worth copying is what lego-ac did after:** they said plainly what
they had done, rather than letting a mysterious instruction appear. A peer who
reaches into your session and TELLS you leaves you able to refuse. That is the
difference between an error and a trap, and it is why this rule is written
without blame attached to it.

**15. A STEADY-STATE INVARIANT IS SILENTLY FALSE AT INITIALISATION.** Found
2026-09-08 in brickwright-lite's stage container, and it is the reason I argued
twice against the fix that turned out to be the fix.

The measurement was correct: the Scratch stage's size is a pure function of two
props the component's `shouldComponentUpdate` gates on, so **every size change
already reaches the resize path** and an observer would guard a case that
cannot occur. A pane resize confirmed it — the stage moved sideways, x 1285 to
846, and kept its 240x180.

**All true, of every change AFTER the stage has a size. False of the first
one.** The 0 -> 480 transition is driven by no gated prop, so nothing in the
update path can see it, and that transition is the entire defect.

```
  the rule            "every size change comes through a gated prop"
  where it holds      once the component is in its working state
  where it fails      the transition INTO that state
  what it cost        two wrong fixes and two arguments against the right one
```

**The general shape: the code that ESTABLISHES a state is exactly the code the
state's invariants cannot describe.** An invariant is a statement about a
system that is already running. Initialisation is the interval in which it is
not yet true, and reasoning that treats the two as one place will be confidently
wrong about the interval — while being right about everything else, which is
what makes it persuasive.

**The tell:** an argument of the form "X always happens, therefore we need not
handle the case where it has not happened yet". The second clause is about a
time the first clause does not cover.

**And the fixes fail the same way.** Sizing the buffer at mount was a no-op
because at mount the container has no box — a repair that looks EXACTLY like
the bug it is meant to fix, and would have shipped as done by anyone who did
not measure afterwards.

**WHAT SETTLED IT WAS AN EXPERIMENT, NOT AN ARGUMENT** — lego-ac's, who asked
for the measurement rather than accepting my reasoning, and who says they would
not have predicted the answer either. That is the method: when two people
reason to opposite conclusions from the same correct measurement, the
disagreement is about which regime the rule covers, and only a run tells you.

## OPERATIONAL — archiving to /mnt/storage, 2026-09-05

**THE CIFS SHARE CANNOT STORE SYMLINKS, AND A PLAIN COPY DROPS THEM SILENTLY.**

`/mnt/storage` is a symlink to `/mnt/akademie_storage`: one CIFS share, 5 TB,
mounted `nounix` **without `mfsymlinks`**. Creating a symlink there fails:

```
ln -s /tmp /mnt/storage/probe
  -> ln: failed to create symbolic link: Input/output error
```

So `cp -a` of a tree containing symlinks **succeeds overall** while omitting
every link, and reports only a line per failure in stderr that is easy to lose
in a long run. Measured:

```
mbit-fw-src            117 symlinks   bytes DIFFER after copy
mbit-fw-build          175
bw-bundle              171
wt-spike-fw-firmware    10
brickwright-sdcc-o2      1
bw-pages, sdcc-git       0            bytes MATCH — safe to copy plainly
```

**This is not cosmetic.** The lost links in `mbit-fw-src` and
`wt-spike-fw-firmware` include `nuttx/include/arch` and `nuttx/Make.defs` —
load-bearing build symlinks. The archive looked successful; the restored tree
would not build, and nobody would find out until they tried.

**So: choose the method by whether the tree contains symlinks.**

```
find TREE -type l | wc -l
  > 0   ->  tar -czf on CIFS, symlink the original path at the .tgz
  = 0   ->  rsync -a to CIFS, symlink the original path at the directory
```

**And verify BYTES, not file counts, before deleting anything.** `mbit-fw-src`
copied 79,114 files against 79,114 in the source — a perfect count match — and
was still wrong by two symlinks. The byte total is what caught it.

**Two more things that bit during this cleanup:**

- **Check `lsof` at the moment you act, not when you plan.** `crisp-flutter-sdk`
  showed 0 open handles in the survey and 25 when the copy reached it, and was
  skipped automatically. `clean-checkout-1XQqF8` had 14 handles despite being
  the same age as five idle siblings that were safe to delete — age alone would
  have destroyed a live tree under another session.
- **mtime recency misreads a fresh clone as hot.** `retro-corpus-8086` reported
  1,348 files modified in 7 days; it was cloned on the 3rd, so *every* file is
  recent. Cloning is not editing.

## OPERATIONAL — the box, 2026-09-05

**Written here because cross-session sends are FAILING.** Three warnings to
three lanes were refused within a minute of each other, after hours of working
sends. A failed send leaves no trace on the receiving end (rule 10), so this is
the channel that still works.

**Measured 11:27, nine sessions busy at once:**

```
load average    71.72          (18 an hour earlier)
memory          172 MB free, 646 MB available
swap            12,285 of 12,287 MB used  ->  2 MB FREE
disk /          97%, 2.4 GB free
node processes  16
```

**Swap is exhausted.** At 2 MB the next sizeable allocation OOM-kills
something, and not necessarily the process that asked for it.

**Hold, until this clears:** a full `npm test`, the 646,000-vector grind, and
`audit-clean-checkout --all` — the last archives the whole tree per invocation,
and `--integrate` adds a populate step on top of that. Single test files are
fine. `free -m` before anything expensive; abort below ~600 MB available, which
is roughly where we are now.

**AND IF YOU SEE THESE FOUR FAILURES, THEY ARE THE BOX, NOT YOUR CHANGE:**

```
Digital parity: 74LS157   74LS107   74HC138   74HC283
```

`test/sap1-digital-parity.test.mjs` says so in its own assertion, and it is the
best-behaved failure message in this repository:

> *"74157: ENVIRONMENT, NOT THE CIRCUIT — the Digital JVM was killed after
> 120s. A bare invocation on this box takes about 5s, so a failure at the cap
> means the machine was loaded, not that the truth table disagreed. Check
> `free -m` AND `swapon --show` before chasing this, and re-run the file
> alone."*

It names its likeliest cause **without asserting it**, gives the discriminator
(5 s against a 120 s cap), and says what evidence settles it. Checked: it was
right. Do not chase them.

**Combined master at `d95d597` is otherwise green:** 3,846 tests, 3,796 pass,
46 skipped, 4 environment-limited. That is the whole fleet's work today — the
8086 REP cycle fix, the census derivation guard, the NE2000 and port-conflict
check, the WAIT/STP tests and the two new census rows — verified together
rather than each against the master it branched from.

## CLAIMS — work in progress

| lane | owner/session | worktree | exact scope | base SHA | status |
| --- | --- | --- | --- | --- | --- |
| exact Level-1 NMOS source-tied-bulk DC operating point | `/root` (Codex) | `/mnt/volume1/code/wt/bwb-nmos-source-bulk-op`, branch `lane/nmos-source-bulk-operating-point` | `src/board.js`, the source-tied current-reader branch in `src/mna.js`, new focused `test/nmos-source-bulk-operating-point.test.mjs`, and this row. Extend the strict public NMOS OP admission from proven grounded bulk to the already implemented exact source-tied-bulk case only: explicit `model:'level1'`, finite `vth`, positive finite `kp/w/l`, nonnegative finite `lambda`, `bulkOnSource:true`, inert model name, and all three connected terminals. Prove the drain-bulk junction, signed currents/KCL, state non-mutation, and exact ngspice agreement at both normal and forward-biased drain-bulk conditions; mutation removing source-bulk admission or drain-junction current reading must red. Current master already contains the cutoff lane's qualified one-sided C1 implementation; this touches only its disjoint bulk-current reader block and no existing cutoff test. No CUI/parser/pin, GAMMA/PHI/body-effect Jacobian, third/floating bulk, PMOS, default/gallery MOS, tolerance, workflow, corpus payload, AC/transient, or unrelated solver change. | `4e95b488ca00784aa23a7bf3c2ce029f987a3167` | **DONE candidate 2026-09-19.** Private exact census at `97a25ed` measured 363 self-contained v2 rows with precisely this model/geometry/topology; the other 500 GAMMA/PHI rows and 57 missing/malformed models remain separate/refused. Focused source/ground bulk, body-effect and junction surface is 46/46 green against live ngspice. Removing source-bulk admission reds the ordinary-channel witness; dropping the drain-junction return current reds the forward-bias KCL witness. Existing grounded-bulk metadata and behavior remain green. |
| Level-1 NMOS exact cutoff with one-sided C1 threshold transition | `/root` (Codex bwcx) | `/mnt/volume1/code/wt/bwb-nmos-threshold-cutoff-v2`, branch `lane/nmos-threshold-cutoff-v2`, replayed from current master `10a95eec` after the earlier candidate lost its implementation in an unrelated merge | `src/mna.js`, `test/nmos-operating-point.test.mjs`, `test/mosfet-body-effect.test.mjs`, and this row only. The exact 1,670-row ADI-v5 model-default replay left 174 numerical failures; a representative nominal cutoff had VGS=VTO yet the symmetric blend manufactured 156.25 nA (`K=0.1`, effective overdrive 1.25 mV). The no-`ksubthres` path now uses a one-sided cubic that is exactly zero at/below threshold and joins the exact square law C1 at the existing 5 mV boundary; declared VDMOS soft-plus is unchanged. No CUI/corpus/pin, PMOS contract broadening, tolerance, iteration budget, generic convergence, workflow or unrelated solver change. | `613cefbd2ab98f69359e61bef81627809bf8a8a4` | **DONE candidate 2026-09-19.** The replayed three production/test blobs are byte-identical to exact-head-qualified candidate `d8360bbe` and the focused Level-1/body-effect/VDMOS/latch surface passes 34/34 on the new base. Restoring the symmetric blend, corrupting its analytic slope, or bypassing declared VDMOS soft-plus each reds the named consequence. A provenance-qualified replay of all 174 former failures closes 53 circuits; all 174 native/oracle stages pass, with 53 comparisons green and 121 retaining 138 smaller numerical failures (1,243/1,381 observations pass, largest residual 0.343 mV) at unchanged tolerances. Raw CIFS receipt `adi-v5-nmos-threshold-174-v2.jsonl`, SHA-256 `a3ea4e6c...`, run `2a363a48...`. Those 121 are a separately measured strict-oracle-convergence mechanism, not hidden in this fix. The replay head requires one fresh exact-head qualification before guarded landing. |
| protected 286 ISA, call gates, task switching and existing binary | Astra coordinator / two Sol workers, astra-x86-tasks | `/mnt/volume1/code/wt/astra-x86-tasks` and isolated workers | Remaining common protected instructions and far procedures; call gates and 286 task switches with architectural fault tests; pinned independent oracle and existing protected-mode binary execution. Tests, harnesses, receipts and qualification. No analog/FPGA/UI/package changes; preserve other lanes. | `aa8b3a8df82bea8e66f2e90bc7d3d6e9d17bac29` | **DONE 2026-09-19**; common ISA/far procedures, call gates, staged 286 task switches and eight unchanged external images implemented and audited. Local: 166 passed, one optional Turbo C skip; six owned PCjs comparisons; seven external comparisons with exact documented oracle differences and zero unexpected mismatches; five external mutations rejected. Combined source and receipts frozen for hosted qualification before landing; links retained in milestone tag. No full AT/386/Windows/Doom or speed claim. |
| protected 286 restart, privilege and AT devices | Astra coordinator / up to two Sol agents, astra-x86-protection-at | `/mnt/volume1/code/wt/astra-x86-protection-at` and isolated worker trees | Restartable protected strings and common ISA; protected system registers, LDT/TSS and bounded privilege transitions; fuller opt-in AT keyboard/interrupt/RTC contracts. Owned guests, pinned PCjs, exact-source receipts and hosted qualification. Preserve production core throughput, upstream DOS/input work and other lanes. No FPGA, analog, UI/package pins or unproved full AT/386/application claim. | `69f052d16a0a17959234918e4539f8daaea5d861` | **DONE 2026-09-19**; implementation and audit complete: restartable strings/common ISA, bounded LDT/TSS privilege transitions, AT keyboard/PIC/RTC, exact restore and interrupt arbitration. 93 focused tests passed; five pinned PCjs guests passed; strict REP/privilege mutations rejected; DOS toolchain and source-bound receipts refreshed. Frozen combined head is subject to hosted qualification before landing; run links retained in milestone tag. Full task switching/AT boot/386 remain outside this increment. |
| protected 286 instruction breadth and AT memory/A20 | Astra coordinator / two Sol agents, astra-x86-memory-isa | `/mnt/volume1/code/wt/astra-x86-memory-isa` plus separate CPU and machine worker trees | Experimental protected decoder: 16-bit ModR/M, arithmetic/flags and bounded control flow, independent PCjs guests. Machine: explicit extended-memory/A20 capability, guarded word access, checkpoint/reset contracts and owned guest checks; scoped qualification/docs/receipts. Preserve default machine behavior and existing DOS/input work. No FPGA, analog/SPICE/ASC, UI/package pins or full PC/AT/386 claim. | `028a387a48b119f023b13aaad7ebe324f72839b1` | **DONE 2026-09-19**; two Sol implementations integrated and audited: protected ModR/M/arithmetic/control, CPU-only A20 and bounded 8042, high-memory machine guest, explicit protected-checkpoint refusal. Source-bound ISA/AT/IDT/DOS receipts refreshed; exact-head hosted qualification required before guarded landing. No speed, full AT, Windows/Doom or Lite-pin claim. |
| strict NMOS drain/source DC-preflight connectivity | `/root` (Codex bwcx) | `/mnt/volume1/code/wt/bwb-nmos-ds-preflight`, branch `lane/nmos-ds-preflight` | `src/board.js`, focused NMOS operating-point tests, and this row only. For the already admitted explicit grounded-bulk Level-1 NMOS domain, make floating-net preflight reflect only the drain/source conductance that `stampNMOS` always stamps (`MOS_GDS_FLOOR` even in cutoff). Prove Wilson mirror, cascode amplifier and cascode mirror families reach the existing solver and match ngspice; preserve unconnected-gate refusal and never treat gate/body as conductive. Replay the identical 678-row private selection downstream after Board qualification. No equation/current/sparse change, PMOS/fourth-terminal admission, GMIN/tolerance relaxation, default/gallery MOS behavior, CUI/parser/package, workflow or raw corpus payload. | `6a367af05115ade4caf9e0e1479a19bff9f666e6` | **DONE candidate 2026-09-19.** Floating-net preflight now adds exactly the drain/source edge already guaranteed by the admitted Level-1 stamp; gate/body remain insulating. Self-authored two- and three-device cascode chains and a Wilson mirror reach the unchanged solver and match ngspice node voltages within 1 microvolt, while a connected singleton gate still refuses by name. Focused OP/current/sparse surface is 31/31. Removing the drain/source edge makes the channel-chain witness red; adding a gate/source edge makes the singleton-gate witness red. Prior exact replay measured the affected boundary as 173 false structural refusals across those three families plus 12 genuine unconnected-gate refusals; the identical downstream replay remains the post-Board adoption evidence gate, with unchanged tolerances. |
| protected 286 same-ring IDT delivery | Astra coordinator / two Sol agents, astra-x86-idt-sept19 | `/mnt/volume1/code/wt/astra-x86-idt` plus separate worker trees | Opt-in protected CPU only: ring-0 interrupt/trap gates, INT/IRET and supported fault delivery with atomic stack preflight; focused negative tests and independent pinned-PCjs guest comparisons; x86 qualification branch/job and scoped docs/receipts. No production decoder hot-path changes, privilege/task switching, FPGA, SPICE/ASC, UI or package pins. | `4e080099a908f77f1f97da0b4088db48bc47d259` | **DONE 2026-09-19 in the commit containing this row; exact-head hosted qualification remains the landing gate.** Optional same-ring interrupt/trap gates, INT/IRET and #UD/#NP/#SS/#GP delivery implemented with atomic frame preflight, correct flags/error/restart state and explicit unsupported boundaries. Protected tests 21/21; combined focused checks 41/41 and merged DOS/gamepad/CLI checks 15/15. Pinned PCjs agrees on interrupt/trap entry and IRET plus owned #GP handler return to HLT; three comparator negative controls reject exact affected cases. Known selector-RPL and stack-wrap oracle limitations remain explicit and ungraded. DOS source receipt refreshed after upstream machine changes; source-bound IDT receipt and roadmap included. No full-protection/386/Windows/Doom claim. |
| strict explicit Level-1 NMOS public DC operating-point domain | `/root` (Codex bwcx) | `/mnt/volume1/code/wt/bwb-nmos-op-domain`, branch `lane/nmos-operating-point-domain` | `src/board.js`, `src/mna.js`, `src/sparse.js`, one focused NMOS operating-point test, focused sparse-refactor coverage, affected exact-scope/current assertions, and this row. Admit only three connected terminals plus explicit `model:'level1'`, finite `vth`, positive finite `kp`/`w`/`l`, nonnegative finite `lambda`, `bulkAtGround:true`, and inert model-name metadata. Preserve default/gallery MOS behavior and all live state. Prove node voltages, signed currents/KCL against self-authored ngspice Level-1 active/triode benches, strict extra-field/bulk/connectivity refusals, and caller-consequence mutations. The measured numerical repairs are bounded: use the smoothing derivative as channel-length-modulation activation so it is exactly one outside the threshold blend, and preserve structural zero fill during sparse numeric reuse so a later nonlinear stamp cannot create an unrepresented LU fill. Qualification later replays exactly the 678 historical ADI-v4 NMOS rows at unchanged comparison tolerances. No PMOS/fourth-terminal invention, CUI/parser/package, workflow, default model, global tolerance, raw corpus payload, or unrelated solver work. | `348bde0937bae6744b9e9266bbaea4961afd76a8` | **DONE 2026-09-19.** Census: 678 rows / 1338 M cards use one explicit grounded-bulk Level-1 NMOS; the 136-row PMOS/fourth-bulk family remains excluded. The active ngspice bench exposed and now closes two independent pre-existing defects: the old overdrive ratio suppressed stated LAMBDA (drain 4.032979 V versus 4.032561 V), and zero-valued first-iteration fill made sparse refactor violate a source row by 6.964 mA. Focused semiconductor/sparse surface is 158/158; exact boundary subset 36/36. Isolated mutants for removing NMOS routing, restoring the old LAMBDA taper, and restoring zero-fill omission all fail by named consequence. The full local repository run reached 5,484 pass / 164 documented skip / 1 unrelated or as-yet-unattributed failure after 6m44s; hosted exact-head qualification is authoritative for that final failure name. |
| strict explicit-NPN public DC operating-point domain | `/root` (Codex bwcx) | `/mnt/volume1/code/wt/bwb-bjt-op-domain`, branch `lane/bjt-operating-point-domain` | `src/board.js`, one focused NPN operating-point test, and the existing operating-point, diode-scope and OP/live-current whole-domain assertions plus this row. Admit only three connected terminals and explicit `model:'shockley'`, finite `is>0`, `beta>0`, optional finite `br>0`/`n>0`/`vaf>0`, plus inert source-model naming metadata; preserve the default/gallery knee path and all live state. Self-authored active/saturated, signed terminal currents/KCL, exact ngspice conditions, strict refusals and caller-consequence mutations are required. Qualification then replays the exact 851-row historical ADI v4 NPN family at unchanged comparison tolerances. No PNP/MOS, CUI/parser/package, workflow, default interactive model, global tolerance, or unrelated solver work. | `2064764995455109ca56dced3939e036462dfaf4` | **DONE candidate 2026-09-19.** The strict public domain admits only explicit complete NPN cards. At calibrated ngspice 42 `TEMP=TNOM=26.826895261366076`, its active and saturated nodes, signed terminal currents and KCL agree at nanovolt/picoamp scale while `operatingPoint()` leaves all live state untouched. The default interactive knee path is unchanged and no `src/mna.js` change was needed. Focused Board tests are 25/25 green. Removing NPN routing, admitting undeclared `IKF`, or skipping collector connectivity each makes the focused contract red independently. Hosted red `35443181470` exposed two stale whole-domain sentinels; the forward repair updates the literal scope and adds a genuinely biased NPN branch to the OP/live signed-current matrix rather than only changing its expected list. Exact-head hosted qualification and the separately pinned 851-row downstream replay remain landing gates; comparison tolerances will not be widened. |
| strict zener public DC operating-point domain | `/root` (Codex bwcx) | `/mnt/volume1/code/wt/bwb-zener-op-domain`, branch `lane/zener-operating-point-domain` | `src/board.js`, `src/mna.js`, focused zener operating-point/breakdown tests, and this row. Admit only explicit complete Shockley zener cards: use the existing Shockley forward junction and characterised breakdown law in both stamp and current reader, while preserving the legacy no-model/gallery piecewise path byte-for-behaviour. Preserve observational state, explicit refusals, and unchanged tolerances. Qualification includes the fixed 470-row ADI v4 historical zener family through the downstream private runner. No CUI/parser/package/workflow or other semiconductor family. | `4926e93cd0133dd038b929f8506318d0da320b3b` | DONE candidate 2026-09-19: 44/44 focused checks pass, including live ngspice forward/breakdown, signed-current KCL, strict refusals and unchanged legacy knee; allowlist, forward-stamp and current-reader mutations each red independently. Exact-head hosted qualification and the separately pinned 470-row downstream replay remain landing gates. |
| x86 continuation: real DOS software and 286 protection | Astra coordinator / two Sol agents, astra-x86-next-sept19 | `/mnt/volume1/code/wt/astra-x86-next` with separate agent worktrees | x86 CPU/machine and guest harness only: extend real DOS tests to fast 286, exercise local tool binaries, implement audited bounded protected-mode milestones, measured Harris performance follow-ups, exact-source receipts and roadmap. Excludes FPGA, analog/SPICE/ASC/import/export and their workflows. No downstream pin until upstream qualification. | `acb68f2` | **DONE 2026-09-19 in the commit containing this row; hosted qualification is the landing gate.** Real DOS persistence and MASM/LINK/EXE2BIN guest build/run on fast286; bounded opt-in protected decoder with pinned PCjs bootstrap comparison, independent caches and explicit unsupported boundaries; 286 HMA word-alias fix; native unchanged-writer suppression with 33/33 focused contracts and 25/25 mutation rejection. Local combined DOS/CPU tests and PCjs comparison pass. Timing remains inconclusive. Exact-source receipts, pinned guest/oracle CI and staged roadmap in docs/X86-LANE.md; full protection, PC/AT, 386DX, Windows and Doom remain future milestones. |
| bw-board PR #11 integration | `/root` (2026-09-19) | `/mnt/volume1/code/wt/bwb-pr11-zener-20260919` | Audit current PR #11 checks, mergeability, and land `lane/zener-ibv-default-and-ideality`; no unrelated source changes | `b9efb2e` (`origin/master`) | DONE; PR #11 merged at `b9efb2e`; focused zener test 10/10 and hosted gates green |

The earlier Lite PR #194 and Harris/native rows from the preceding claim commit
are superseded and removed here: Lite is already covered by the canonical Lite
LANES claim and Harris qualification is already present on `origin/master`.

Native 286 memory bus component (P7-R1 prerequisite): delegated Codex subagent,
2026-09-12, isolated `feat/native-286-memory-bus` from `63359b8`. Owned standalone
C/JS sequencer, portable differential helper and optional tests; no phase-circuit
edits, full runner, backend registration, default change, push or deployment.
Component implementation complete; parent owns review/integration and remaining
P7 work. Details: `docs/HARRIS-NATIVE-BUS-SEQUENCER.md`.
Follow-on same-instance memory bus fixture is also implemented in this isolated
lane, using phase ABI 2; root owns combined validation and producer-frontier
writer adaptation. Still no CPU/full machine or capacity claim. Details:
`docs/HARRIS-NATIVE-BUS-CIRCUIT.md`.

| lane | who | started | what |

| --- | --- | --- | --- |
| i8086 machine-layer perf: deadline-batched chip advance (E6.8.4 side-finding) | `8086 coverage testing materials` | `lane/i8086-chip-advance-batching` off master `a4d1b85` | **DONE 2026-09-17.** Profile-first, as E6.8.4 demands. `_advanceChips` (run every instruction) measured at 30 percent of the machine workload under `--prof` (bench-i8086 MIX, 4-chip PCXT) -- more than the CPU core -- while `_serviceInterrupts` did not sample at all (its answer is the cached `intActive` flag), so the ROADMAP two candidates split cleanly: chip advance real, interrupt poll a red herring. Fix: DEADLINE-BATCHED advance. Cycles a chip has not been charged accrue in `_chipDebt` and apply in one batch when the nearest chip event is due, reusing the `nextWake`/`_wakeHorizon` horizon that already drives HLT; a chip is caught up lazily on any read (`_in`/`_out`) or snapshot (`saveState`), reset on `loadState`, so nothing observes a stale chip. Equivalent to per-instruction advance because chips do not change between events. A correctness bug the safety net caught during dev: `_out` recomputed the deadline BEFORE applying the write, leaving it stale when a write loaded a PIT counter -- split into catch-up-before / re-arm-after. VALIDATED: 790/0 across the full i8086 + chip + checkpoint + video + speaker suite (plus cycle-timing, DMA/FDC boot, DOS, ELKS). WIN: `_advanceChips` 30 percent -> negligible under re-profile; bench machine/core ratio 0.31 -> 0.79. One file, +61/-3. Envelope: `src/i8086-machine.js`, this row. First push failed CI on machine-contract (attachDevice did not re-arm the deadline); fixed in `01947c5`. Exact-head CI green at `01947c5`: run `35278289447` and Harris `35278289396` both success; landed to master by fast-forward. |
| i8237 DMA stored-but-ignored behaviour coverage (temp register + sense inversion) | `8086 coverage testing materials` | `lane/i8237-stored-ignored-behavior` off master `9ef0227` | **DONE 2026-09-17.** The controller surfaces its unmodelled command bits BY NAME (tested), but the BEHAVIOUR behind two was unchecked: the temporary register that a mem-to-mem transfer would use reads back zero (0Dh read; 0Dh write is master clear, so the read side is easy to miss), and DREQ/DACK sense inversion (command bits 6/7) is stored but IGNORED -- a request asserts on its raw level. Two tests, ground-truthed against the core: 0Dh reads 0 (and stays 0 after a master-clear write); and a low DREQ under both sense-inversion bits stays low (an inverting chip would read it as a request) while a high one asserts identically with or without them. Mutation (temp read returns non-zero) reddens the first; the sense test carries a passing HRQ control so its low-under-inversion case is non-vacuous. Devices are outside SingleStepTests -- ungraded. i8237 suite 38/0 (was 36). Test-only; no source change. Envelope: `test/i8237.test.mjs`, this row. Exact-head CI green at `4ddc56e`: run `35270249413` and Harris `35270249395` both success; landed to master by fast-forward. |
| i8251 USART sync-mode warning coverage (derived diagnostic + checkpoint) | `8086 coverage testing materials` | `lane/i8251-sync-warning-coverage` off master `aa42ac3` | **DONE 2026-09-17.** The USART deliberately does not model sync mode and warns rather than mismodel silently; the test file checked the message but never the two actionable halves `_setModeWarning` builds. Added two tests: the sync-mode warning carries its PORT (`modeWarningAt` = 1, the control port) and its SYMPTOM (the receiver never enters hunt / reports SYNDET), with an async mode carrying none of it; and the warning is DERIVED across a checkpoint, not remembered — a chip loaded from a sync-configured snapshot reconstructs the warning (message, port, symptom) though it never saw the mode write, while an async snapshot conjures none. Ground-truthed against the core; mutations (wrong `modeWarningAt`, and a restore that drops the `this._sync ? this.mode : null` derivation) each redden the right test. Devices are outside SingleStepTests, so this is ungraded surface. i8251 suite 14/0 (was 12). Test-only; no source change. Envelope: `test/i8251.test.mjs`, this row. Exact-head CI green at `3a3370b`: run `35269318082` and Harris `35269318021` both success; landed to master by fast-forward. |
| i8086 80186 shift/rotate count-masking coverage (the parts no oracle grades) | `8086 coverage testing materials` | `lane/i8086-186-shift-mask-coverage` off master `39e3612` | **DONE 2026-09-17.** `test/i8086-186.test.mjs` pinned the 186 shift-count masking with SHL only, though the core masks the whole group-2 (D0-D3) once (`i8086.js` `byCl ? (this._is186 ? this.cl & 31 : this.cl) : 1`) and the file itself calls masking the variant's defining behaviour that nothing else checks. Added three tests: the whole group (SHR/SAR plus the rotate-through-carry pair RCL/RCR, whose period 9 does NOT divide 32) masks cl=33 to 1 on the 186 and each differs from the unmasked 8086; a count of 32 masks to 0 as a total no-op on the 186 (operand and CF untouched) versus a full wipe on the 8086; and ROL/ROR mask INVISIBLY because their period 8 divides 32, asserted equal across variants to mark that boundary. Covers BOTH operand paths: the 8-bit D2 forms and the 16-bit D3 forms plus the C1 word-immediate (masked on the 186, a near RET on the 8086); the rotate-through-carry period is 9 for bytes and 17 for words, neither dividing 32, so RCL/RCR stay visible while ROL/ROR mask invisibly. Ground-truthed against the core; mutation removing the count `& 31` (both the CL and the immediate site) reddens the masking tests, not the ROL/ROR ones. All these counts are v20-grind-excluded (over 31), so genuinely ungraded surface. Also completes the reg=6 SETMO-vs-second-SHL variant decision for the word (D1) and by-CL (D2/D3) forms the file covered only for D0. i8086-186 suite 32/0 (was 24). Envelope: `test/i8086-186.test.mjs`, this row. Exact-head CI green at `4253898`: run `35266531958` (all jobs incl. corpus + the vectors/vectors186 grinds) and Harris `35266531950` both success; landed to master by fast-forward. |
| debug bridges: the shared INPUT-ADMISSION unit (dedup the ASK/TELL + injectable clock + era gate + uncaptured-input predicate across z80/m6502-debug) | `8086 coverage testing materials` (owner-authorized) | `lane/debug-input-admission` at exact base `367bbaa`, forward-merged to master `3e219cc` (docs-only, no code overlap) | **DONE 2026-09-17, impl `10fa670`.** New `src/debug-input-admission.js` factors the input-admission machinery both bridges carried a copy of — built identical, then drifted into the A/B soundness fixes each applied to both bridges twice. Per-CPU differences are parameters (domain base, admit label, signatureOf, reason text); m6502 keeps its `emit(producer,payload,time)` TELL shape as a thin wrapper over `admission.tell`. BEHAVIOUR-PRESERVING, proven by the suites that pin this machinery going green unchanged: bridge-admission-ordering (the R1-R9 matrix) 26/0, z80/m6502-replay-input 26 and 30, unlogged-board-inputs 18/0, debug-replay-contract 30/0, injectable-replay-clock 21/0, code-breakpoint-bounds 4/0, the adopt suites; 264 debug-subsystem tests plus a new 8-case module unit test. Net -37 lines across the two bridges. injectable-replay-clock's seed-site source-scan is parameterised per target (z80/m6502 seed via `admission.seed(`; i8086 is NOT extracted and still uses `observedInputs.set(` minus its in-file dedup write). i8086 deliberately out of scope. Envelope: `src/debug-input-admission.js`, `src/z80-debug.js`, `src/m6502-debug.js`, `test/debug-input-admission.test.mjs`, `test/injectable-replay-clock.test.mjs`, this row. Exact-head CI green at `9af0b7f`: run `35256272502` (all jobs incl. corpus) and Harris `35256272462` both success; landed to master by fast-forward. |
| debug bridges: the shared CHECKPOINT/REPLAY methods (debugTime + captureCheckpoint + restoreCheckpoint + replayInstruction across z80/m6502-debug) | `8086 coverage testing materials` (owner-authorized) | `lane/debug-checkpoint-methods` STACKED on `lane/debug-input-admission` at `9af0b7f` (base lane, off master `367bbaa` + docs merges); lands AFTER the base lane, re-stacked on the then-current master | **DONE 2026-09-17, impl `a53aacd`.** Follow-up to the INPUT-ADMISSION lane: the checkpoint half had the SAME copy-paste drift — `debugTime`/`captureCheckpoint`/`restoreCheckpoint` were byte-identical across both bridges (diff: only comment prose differed) and the uncaptured-input checkpoint refusal (fix B) had two homes. New `createCheckpointMethods({machine, admission, isHalted, haltReason, notRetiredReason, resetWatch})` in `debug-input-admission.js` owns all four; it reads the SAME `admission` the input side owns, so a checkpoint and a debug input fact carry one event clock and the uncaptured gate has one home. `replayInstruction` is the only genuinely per-CPU method and only in three places (halt predicate `cpu.halted` vs `cpu.stopped or cpu.waiting`, two reason strings) — parameters. BEHAVIOUR-PRESERVING: 327/0 across 44 blast-radius suites (every suite importing either bridge or the module); 5 new `createCheckpointMethods` unit cases pin the direct contract (per-CPU reasons, the inverted `!result` epoch-open convention, the watch-latch reset incl. the throwing finally), and 2 mutations (inverted `!result`, dropped finally reset) were confirmed to redden them. Net -130 lines across the two bridges. i8086 stays out of scope — MEASURED divergent contract (`hasUncapturedInputState` = `adapter.step` OR `unloggedBoardInputs`; `replayInstruction` gates on `machine.canCheckpoint` not `checkpointSupport`), not a mechanical extraction. Envelope: `src/debug-input-admission.js`, `src/z80-debug.js`, `src/m6502-debug.js`, `test/debug-input-admission.test.mjs`, this row. Exact-head CI green at `b40d594`: run `35258297490` and Harris `35258297613` both success; landed to master by fast-forward. |
| strict source-analysis AC excitation/grid/regularization contract | `/root/zenodo_access_diagnosis` (Codex Sol), worktree `/mnt/volume1/code/wt/bw-board-ac-source-contract-sol` | `lane/ac-source-contract-sol` at exact base `2c92d52fcd6a893316aad3d51287b2dc8d0a09b6` | **DONE 2026-09-14 at `ef10493fdbd0094bfda68130016869e3b9f57868`.** Exact grids, differential voltage-source constraints, signed current-source excitation, authored-DC bias and explicit zero regularization landed without changing the legacy interactive grid/default regularization. Focused AC/OP/source regression 50/50; mutation killed; self-authored Twin-T matched ngspice at 50 Hz below 1e-12. Public CI `34881573175` and Harris qualification `34881573033` both green. Independent downstream replay closed all six duplicated ADI v4 failures: each AC 401 points plus OP passed, and 50 Hz real differed from ngspice by 4e-16. Claim released. |
| bounded transient execution efficiency and deterministic work budgets | `/root/zenodo_access_diagnosis` (Codex Sol), worktree `/mnt/volume1/code/wt/bwb-waveform-efficiency-sol` | 2026-09-14, `lane/waveform-efficiency-sol`, exact base `d25376cb4150335fe3cf28a26e63994b6b96a03f` | **DONE.** Algebraic-direct implementation `7bb750b83bda168863372a945fa9248d8ba1e5ab` / first closure `b45a7ce9874332602e89d10a5e88c12c3c71adcc`; observable-aware LTE follow-up `b42fb5202d3ebd5382f019e0e690adf2a6f4ff6c`. The follow-up compares accepted public node voltages between the full and two-half-step solutions as well as C/L storage state, using the unchanged precision-v1 absolute/relative scales. Si7li train5100 RL/SINE error against the independent closed form fell from 1.586 uV to 0.695 uV (unchanged 1.494 uV acceptance threshold), at a measured 14% solve increase over the sampled schedule. Exact candidate CI `34871197827` and Harris `34871197664` succeeded; independent Board acceptance was 38/38, including the corpus-identical row5100 fixture. Stateless row5929 remains algebraic-direct; true adaptive rows3525/5290 remain deterministic budget refusals rather than approximations. Current conventions, initialization and public profile values are unchanged. |
| waveform transient accuracy and breakpoint control | `/root/zenodo_access_diagnosis` (Codex Sol) | 2026-09-14, `lane/waveform-accuracy-sol`, exact base `3e5478b` | **DONE.** Implementation `59715493833e50bda319c4dc929a26d9cd353082`; exact CI `34862804769` and Harris qualification `34862804913` succeeded. Added fixed interactive/precision profiles, cumulative work and sticky local-error/convergence qualification, final-endpoint barrier selection, and feature-bounded BE restarts. Analytic fixtures cover the current train158 low-pass and test300/train5961/train7772 high-pass narrow-edge families plus the older row271 smooth-SINE family. The older row5434 algebraic mismatch was isolated from Board integration error; refined-reference qualification remains the private oracle lane. Uniform positive-out raw currents and positive-into `operatingPoint()` results are unchanged. |
| broad source-waveform transient semantics | `/root/zenodo_access_diagnosis` (Codex Sol), worktree `/mnt/volume1/code/wt/bw-board-waveforms-sol` | `lane/waveform-transient-sol` at exact base `e11fcbd8600e73581b885f10c6e4aeebad35a385` | **DONE 2026-09-14.** Exact implementation `77d75ba`, closure `3e76e68`; landed into the later current-contract and waveform-accuracy closures. Added strict PWL/EXP/PULSE/SINE voltage/current source semantics, source-corner scheduling and explicit waveform-time-zero initialization provenance without startup/IC approximation. |
| explicit non-UIC transient initialization | `/root/zenodo_access_diagnosis` (Codex Sol), worktree `/mnt/volume1/code/wt/bw-board-nonuic-transient-sol` | `lane/nonuic-transient-sol` at exact base `4b40a0ed3ff6977fc75e5d42c1c1e23c47346ea9` | **DONE 2026-09-14 at `7636104`.** Added atomic `BoardImpl.initializeTransientFromOperatingPoint()` for the strict grounded static R/C/L/D/V/I/E/G operating-point domain. It adopts capacitor voltage and signed ideal-inductor current into a fresh time-zero transient, restarts with backward Euler, and leaves state unchanged on advanced-time, precharged, waveform, explicit-IC, conflict/nonconvergence, floating or indeterminate refusals. Corrected the public transient inductor-current terminal sign without changing the companion equation. Self-authored positive/negative RCL cases agree with ngspice 42 for node voltage and signed inductor current. Exact-head CI run `34843679440` and qualify run `34843679442` succeeded; vectors-full remained a workflow-design skip. Startup ramp, ASC/ASY parsing, MOS/BJT equations, and GMIN policy remain outside this lane. |
| exact ideal-inductor DC operating point | `/root/zenodo_access_diagnosis` (Codex Sol), worktree `/mnt/volume1/code/wt/bw-board-inductor-op-sol` | `lane/inductor-op-sol` at exact base `b8606c9efd488466ecbbc8cbdd812c993ff42082` | **DONE 2026-09-13 at `9fe7ced`.** `BoardImpl.operatingPoint()` now accepts a native two-terminal inductor with only explicit finite `henrys > 0`. In the observational snapshot it lowers L to the existing exact 0 V ideal-source primitive on cloned parts/nets and maps signed current back to `a`/`b`; ordinary live DC's historical 1 mΩ regularization and all transient BE/trapezoidal equations/state remain unchanged. L anchors OP-only DC connectivity. Disconnected/self-shorted L, unknown IC/Rser/coupling fields, and parallel L/L or L/ideal-0V constraints refuse because individual branch current is indeterminate. Self-authored ±2 V/1 kΩ ngspice `.op` agrees on exact zero drop and ±2 mA; source-current's remaining 2 pA is explicitly the engine node GMIN. Nonzero stored inductor current/voltage/energy, time, controls, parts and nets remain identity- and deep-value unchanged. Focused OP/transient/package proof: 39/39. Candidate exact-head runs `34785828886`/`34785828890` reached SUCCESS at 2026-09-13T22:09:46Z before canonical fast-forward; vectors-full was skipped by workflow design. MOS remains unimplemented for public OP: the existing engine is three-terminal, lacks bulk/body diode/body effect/lambda, approximates triode, and carries a stability gds, so no four-terminal or Level-1 claim follows. |
| explicit Shockley diode DC operating point | `/root/zenodo_access_diagnosis` (Codex Sol), worktree `/mnt/volume1/code/wt/bw-board-diode-op-sol` | `lane/diode-op-sol` at exact base `041d82d457c80e3dee45e6ef17e45dd4ba6a16c1` | **DONE 2026-09-13 at `daf090c`.** The public native API accepts only explicit `model:'shockley'`, finite `is>0`, `n>0`, `rs>=0`, two connected terminals and an independently R/V-anchored DC component. Default/PWL, LED/zener/BV, temperature/dynamic/unknown fields refuse. The shared exported thermal voltage is unchanged at 0.02585 V; equations and diode-current sign are unchanged. Self-authored arbitrary-parameter forward/reverse R-D-V ngspice checks, signed currents/KCL, wrong-N/RS mutations, non-convergence, strict refusals, and identity plus deep state non-mutation pass. Full local gate: 5,233 pass, 0 fail, 154 environment skips; tightened post-review OP/package gate: 23/23. **Process note:** implementation was fast-forwarded to canonical master before hosted CI was terminal (not a guarded candidate landing); exact-head runs `34784413706`/`34784413707` subsequently reached SUCCESS at 2026-09-13T21:41:05Z. Importer model-field/temperature loss guards are required before CUI adoption; this is native API support, not importer or vendor-model coverage. |
| exact seven-argument SPICE PULSE voltage waveform | schematic_corpus_import (Codex), worktree `/mnt/volume1/code/wt/bw-board-spice-pulse` | `lane/spice-pulse-vsource` at exact base `51c3c9154e0def15b1a0f6772f92ec942a133172` | **DONE in candidate 2026-09-13.** Added the distinct `wave: 'spice-pulse'` engine primitive for voltage sources with explicit finite `{v1,v2,td,tr,tf,pw,per}` values. The safe domain requires positive rise/fall/period, non-negative delay/width, and `tr+pw+tf <= per`; zero-edge SPICE default semantics, omitted arguments, expressions, overlap, and current-source waveforms are explicit refusals. The established native frequency/duty `wave: 'pulse'` behavior is unchanged and public operating-point analysis still refuses every time-varying source. Exact envelope: new `src/source-waveforms.js`; only `sourceVoltage` dispatch/import/docs in `src/mna.js`; only SPICE-PULSE corner alignment/import in `src/board.js`; new `test/spice-pulse-source.test.mjs`; and this row. Focused proof is 7/7, including analytic asymmetric/negative/repeated samples, a real Board RC transient, strict invalid/refusal and legacy controls, plus 16 source/RC observations from an independently solved self-authored ngspice transient. Related transient/source/OP regression proof is 41/41. Swapping the unequal rise/fall denominators makes the named analytic test red. No CUI/importer, Lite pin, or corpus-result edits. Corpus scale is contextual only: 1,549/1,748 exact-seven ASC occurrences are finite-literal candidates before timing constraints and other circuit blockers; this lane makes no whole-circuit or numerical-pass count claim. |
| ngspice oracle sweep: >95% coverage of the simulatable corpus | lego-ac / bwlang (this session), worktrees `/mnt/volume1/code/wt/ac-bwb-e13b-cand` (bw-board) and `/mnt/volume1/code/wt/ac-cui-oracle-sweep` (bw-circuit-ui) | `lane/parts-library-kinds` at exact base `878e333`; `lane/oracle-sweep` at exact base `8387d3a` | **CLAIM 2026-09-13.** Approved plan `/home/claudeuser/.claude/plans/witty-soaring-panda.md`. **THE PROBLEM, MEASURED:** ~107 circuits have ever been compared to ngspice against ~1,673 runnable — about 6 % — and only 14 run per push. `circuit-oracle-corpora/results/A.jsonl`/`B.jsonl` (1,921 rows) is OUR ENGINE VS OUR ENGINE across a version bump, not an oracle; `harness/compare.mjs` and `harness/solve-corpus.mjs` contain zero references to ngspice. **THE EXTERNAL CORPUS CANNOT CLOSE IT, STRUCTURALLY:** of 6,286 fetched decks, 4,270 LTspice `.net` reference proprietary vendor `.sub` (`LTM4700`, `AD8031`) that are not in the corpus and not licensable, and 1,034 KiCad `.cir` are symbol-name netlists with topology and NO VALUES (`R1 net1 net2 R`, `D_Small`, `KEYSW`); ~136 are salvageable. Inventing values would make the oracle compare two guesses. So 95 % is measured against a SIMULATABLE corpus: ours plus the CC-BY generator. **THE MECHANISM:** a Thevenin freeze — at a DC operating point any part presenting a driven pin becomes a source behind a resistance, which `pad-drive-parity.test.mjs` already does by hand for an MCU pad (`R_STRONG=25`, `R_QUASI_PULLUP=21700`). Generalised, it makes the analog subnetwork of ANY circuit emittable. Classifying our 254 examples by kind: **207 (81 %) are emittable today**, and the 47 blocked reduce to ~10 adapters (memories/displays/gates/keypad freeze; seven-segment and matrix DECOMPOSE INTO REAL LEDs; opamp gets a real model). This checks the ANALOG SOLVER given the same boundary conditions; it deliberately does not check digital emulation, which emu8051/avr8js oracles already cover better. **ENVELOPE — bw-board:** a shared `parseOp`/deck module extracted from `test/lcapy/to-ngspice.mjs` so the CLI and the test import one copy, plus any solver fix the sweep finds (each such fix is semantic-risk and gets its own proof, not a fast-path edit). **ENVELOPE — bw-circuit-ui:** `src/model/exporters/spice.js` (freeze), `bin/bwc.mjs` (new `oracle` verb beside `convert`), the part adapters, focused tests. **ENVELOPE — circuit-oracle-corpora: WITHDRAWN 2026-09-13** by a user-authorised lane split; `/root/sol_lane_coordination` is sole writer for that repo's manifest, ingestion and oracle harness, and for `docs/STANDARD-PARTS-PROGRAMME.md`. I made no commit there; my only interaction was read-only measurement, and the findings were handed over in `/tmp/bwlang-corpus-lane-split-ack.md`. **NO PIN BUMPS DURING THIS LANE, forward or back** — all repos stay at current pins until the landing sequence, which is bw-board, then bw-circuit-ui, then one Lite bump taking both together. **OVERHEAD RULE, stated so it is not re-litigated:** the oracling IS the double-check. No parallel assertion suite is written for anything the sweep covers; a circuit inside tolerance needs no hand-written expectation and one outside it is a defect to fix, not a number to record. **FALSIFYING CONDITION, stated before measuring:** if the first sweep's disagreements are dominated by the EMITTER rather than the solver, the freeze is wrong and this lane stops to fix the emitter before touching `mna.js` — a wrong emitter produces plausible numbers, which is exactly how ngspice's 7-significant-figure `.op` table looked like a 3.8e-6 solver error. The first 20 disagreements are read by hand before any solver change. **REGISTRY GAP, surfaced not filled:** `bw-circuit-ui` has no `LANES.md`, so its half is claimed here by path envelope rather than by creating a rival registry there; `/root/sol_lane_coordination` is the docs landing owner if it should have one. |
| Kaluma `--blink`: is the `rom_table_lookup` wall still there after the version-byte fix? | lego-a4 (this session), worktree `/mnt/volume1/code/wt/bw-i8086-186` | `lane/kaluma-blink-lookup-wall` at exact base `878e333` | **DONE 2026-09-17 in the commit containing this row** (`git log -1 -- LANES.md` for its non-self-referential identity). **THE CLAIM'S OWN PREMISE WAS FALSE AND THAT IS THE RESULT.** This row said `--blink` "loads a program rather than typing lines — a different entry path that can reach lookups the REPL never issues". It does not. Lite's `scripts/probe-pico-kaluma.mjs` at `origin/main` sends `pinMode(25, OUTPUT); digitalWrite(25, HIGH);\r` down the REPL transport and watches `rp2040.gpio[25]` with a listener — the same entry path and the same observation as this repo's `--pin` flag. I asserted a distinction that does not exist, wrote it into a merged claim, and asked two peers to plan around it. Reading the script first would have closed the lane without opening it. Measured with that exact line at `c0073ef`: GPIO25 -> 1 `outputEnable=true`; 14 lookup codes asked and 14 answered, none returning 0, none spinning; `0x1000463f` — the caller lite's comment names as passing a garbage table/code — never appears; 0 jumps to address zero. The busy-loop was the `0x13` version byte, so both halves of R3 were one byte. **The pre-registered falsifier did not fire** (no spin, no code returning 0), but the hypothesis survives on weaker footing than it looks: `--blink` and the REPL being one path means this re-measured rather than independently tested it, and a loaded-program entry into the bootrom — what I wrongly thought `--blink` was — stays genuinely unmeasured. Envelope as claimed minus the code: `ROADMAP.md` R3 and this row; `scripts/probe-sf-unaligned.mjs` needed no change and `src/rp2040-bootrom.js` was never in it. Lite's N11 row's "dodges the wall" premise is dead and its isolation argument survives — surfaced to lego-38, not edited here. Originally: CLAIM 2026-09-13, released by lego-ac, who confirms no claim of theirs on it; no prior row in either registry. ROADMAP R3 recorded Kaluma's first GPIO call hanging and a `rom_table_lookup` busy-loop behind `--blink`. The GPIO half is settled: at master, every lookup Kaluma issues SUCCEEDS (12 distinct codes, `'SF'` returning `0x0a88`, none spinning), boot reaches a REPL, `2.5+1.0` is `3.5`, and `pinMode`/`digitalWrite` drive GP25 to `value=1 outputEnable=true` with 0 jumps to address zero. **THAT WAS MEASURED ON THE REPL PATH AND NOT ON `--blink`, WHICH LOADS A PROGRAM RATHER THAN TYPING LINES — a different entry path that can reach lookups the REPL never issues.** So "the wall is gone" is established for boot and GPIO via REPL and is OPEN for `--blink`; this lane closes that gap and records the lookup trace either way. **Falsifying condition, stated before measuring:** if a `--blink` run spins in `rom_table_lookup`, or issues any code that returns 0, the wall is NOT gone and my hypothesis that null double-shims fed it is dead — the busy-loop then has its own cause and this row says so rather than being quietly narrowed. A run that completes and drives the pin settles it the other way. **Consequence for Lite's N11 row**, surfaced not edited (lite's registry is not mine; `/root/sol_lane_coordination` is the docs landing owner): its Pico C image "jumps at the boot vector, never touches the incomplete bootrom — dodges the Kaluma `rom_table_lookup` wall". If the wall is gone, that sentence's prose survives as an ISOLATION argument — a compiled-C differential should not depend on our ROM, or oracle and subject share a failure mode — but its stated PREMISE is dead, and the two reasons rule out different Door 2 designs. **Envelope:** `scripts/probe-sf-unaligned.mjs`, at most one focused test, `ROADMAP.md` R3, and this row. `src/rp2040-bootrom.js` is NOT in the envelope: if the measurement turns up a ROM defect, that is a semantic-risk change that leaves the fast path and gets its own claim. No Lite files, no workflows, no pins. |
| A loaded program discovers and calls the bootrom the documented way; the fixed-point conversions get a RUNTIME caller | lego-a4 (this session), worktree `/mnt/volume1/code/wt/bw-i8086-186` | `lane/guest-abi-and-fixed-point` at exact base `64850bc` | **DONE 2026-09-17 in the commit containing this row.** New `test/rp2040-bootrom-guest-abi.test.mjs`, 3 cases, 56/56 across the rp2040 set. **(a) THE ABI WORKS FROM GUEST CODE.** A 24-halfword Thumb program loaded into SRAM reads the u16 at `0x16`, reads `rom_table_lookup` at `0x18`, `blx`es it with the code `'S' + ('F' << 8)`, loads an entry from the returned table and `blx`es that — the documented sequence, executed by the core rather than assembled in JavaScript. It reaches every conversion and agrees with `Math.fround`. **(b) THE SIX FIXED-POINT CONVERSIONS NOW HAVE A RUNTIME CALLER**: `fix2float`, `ufix2float`, `int2float`, `uint2float`, `float2fix`, `float2ufix`, driven through that guest path against the oracle the graded tests already use — deliberately the same expression, since two oracles that drift disagree about the code rather than the answer. **The falsifying condition did not fire:** no wrong register convention, no unusable table pointer, no Thumb-bit error. The existing green was not a harness artefact. **MUTATION, and its reason measured rather than assumed:** asking for `"XF"` instead of `"SF"` makes the lookup miss; the guest still returns and still writes — 220 steps against the clean run's 134 — and publishes **0**, because a null `blx` lands in the ROM's zeros and slides, leaving `r0` at 0. That is the same null-slide signature that made R3 present as `2.5+1.0 == 0`. The assertion stays "not the right answer" rather than "exactly 0", since 0 is a property of where the slide ends and would be brittle against layout changes — but the reason is recorded, because a pass nobody has looked at is a pass for an unknown reason. Envelope as claimed: one new test and this row; `src/rp2040-bootrom.js` untouched. Originally: CLAIM 2026-09-17. Two gaps named when the `--blink` lane closed, both left visible rather than covered by its green. **(a) NO TEST EXERCISES THE LOOKUP ABI FROM GUEST CODE.** Measured: `test/rp2040-bootrom.test.mjs` contains zero uses of `loadProgram`/`bootFromFlash`; every case reads the table in JavaScript and sets PC straight at the entry, so the documented sequence a real consumer performs — read the u16 at `0x14`/`0x16`, read `rom_table_lookup` at `0x18`, call it, `blx` the returned pointer — has never been executed BY the guest. Kaluma does perform it, but only through a REPL line; nothing proves a loaded program can. **(b) THE FIXED-POINT CONVERSIONS HAVE NO RUNTIME CALLER.** `fix2float`, `float2fix`, `uint2float`, `float2uint`, `ufix2float`, `float2ufix` are implemented and graded bit-exact against `Math.fround`, but every runtime that has ever booted here uses doubles or never asks: graded is not exercised, and the two diverge exactly where an ABI detail is wrong. **Falsifying condition, stated before measuring:** if a guest program performing the documented sequence cannot reach a working conversion — wrong register convention, a table pointer the guest cannot use, a Thumb-bit error the JS harness masked by setting PC directly — then the existing green is a harness artefact and the ABI is broken for real consumers; this row records that rather than being narrowed to whatever the harness already proves. A guest program that looks up `'SF'` itself and gets conversion results agreeing with `Math.fround` settles it the other way. **Envelope:** one new focused test under `test/`, and this row. `src/rp2040-bootrom.js` is NOT in it — if the guest path exposes a ROM defect, that is semantic risk, leaves the fast path, and gets its own claim. No Lite files, no workflows, no pins. |
| The SF table has no runtime consumer; and open claims whose owner has left | lego-a4 (this session), worktree `/mnt/volume1/code/wt/bw-i8086-186` | `lane/sf-consumer-and-stale-claims` at exact base `b8faec5` | **DONE 2026-09-17 in the commit containing this row.** (a) recorded in `ROADMAP.md` above the SF status, deliberately ABOVE it so a reader meets the consumer question before the completeness number: the table is CORRECT, CALLABLE and UNCALLED, and Payne-Hanek to lift the trig domain limit is speculative until someone names a caller. (b) recorded here and surfaced to live sessions; NOT acted on — I did not touch the ngspice row, did not take the scope, and did not add an expiry rule to the protocol text, which is `/root/sol_lane_coordination`'s to write and not mine. Originally: CLAIM 2026-09-17. Two records, no behaviour change. **(a) NOTHING CALLS THE SOFT-FLOAT TABLE.** Measured at `b8faec5` across a full Kaluma 1.2.1 boot AND `2.5+1.0`: the only bootrom code reached is `clz32` (x244), `rom_table_lookup`, and the flash no-ops. Not one of the 18 implemented SF operators is invoked — Kaluma looks up `'SF'`, receives a valid table, and never calls an entry, because JerryScript uses doubles and its double shims are its own flash routines. The table is CORRECT, CALLABLE (proved by `test/rp2040-bootrom-guest-abi.test.mjs`) and UNCALLED by the only firmware booted here. Recording it because it is a fact about my own recent work that nobody else is placed to notice, and because the open follow-on it bears on — Payne-Hanek to lift the trig domain limit at 2^16 — is speculative until a consumer exists. **(b) RETRACTED 2026-09-17, SAME DAY, BY ME.** I claimed the ngspice row's owner had departed. The evidence says otherwise: a held-delivery notice for my message to `oracle-coverage-ngspice-gate [b6ddaf]` named recipient socket `uds:/tmp/cc-socks/554255.sock` — the exact address every `lego-ac` message in my session arrived from. That name resolves to lego-ac's socket, and the name describes the very lane lego-ac claimed. **The owner is almost certainly present under a new name, not gone.** What I verified was that no session is LISTED as `lego-ac`; what I concluded was that the owner had left. A rename makes the first true and the second false, and I did not consider rename as a hypothesis at all. This is the same defect I spent the week naming in other people's work — a literal measurement whose conclusion acquired a scope it had not earned — committed by me, in the record, within an hour of catching a peer's version of it. The limit I attached (that the list shows only Claude sessions, so Codex rows are invisible) was the right INSTINCT aimed at the wrong gap: I bounded who the list could not see, and never asked whether what it did show could be the same session wearing another label. The original text follows, kept because the retraction is the useful part. Treat the takeover hazard below as UNSUPPORTED unless someone confirms it independently. Original claim: AN OPEN CLAIM'S OWNER IS GONE. `lego-ac / bwlang` holds the `ngspice oracle sweep` row, CLAIM 2026-09-13, envelope spanning bw-board and bw-circuit-ui. It is absent from this machine's session list, as is `lego-38`. The protocol requires an explicit takeover for an expired claim but nothing DETECTS expiry, so a departed owner silently holds a scope. Two live sessions named `oracle-coverage-ngspice-gate` exist, so the collision is plausible rather than hypothetical. **LIMIT ON (b), stated because it bounds the claim:** the session list shows CLAUDE sessions on this box. Rows owned by Codex (`bwcx`, `sim2cx`, `Codex`) would not appear there at all, so I can say nothing about whether those owners are live and do not. Only `lego-ac` is a session I corresponded with directly and can now see is absent. I am NOT taking the ngspice scope over — it is analog-solver work, not mine; this records the hazard for whoever adjudicates. **Envelope:** `ROADMAP.md`, this row. No code, no tests. |
| RP2040 bootrom: a reset that boots the flash image instead of spinning | lego-a4 (this session), worktree `/mnt/volume1/code/wt/bw-i8086-186` | `lane/rom-reset-boots-flash` at exact base `147e1f7` | **DONE 2026-09-17 in the commit containing this row.** New `test/rp2040-bootrom-reset.test.mjs`, 3 cases; 94/94 across the ten rp2040 suites, census 14/14, and Kaluma 1.2.1 still boots to a REPL and answers `2.5+1.0` = 3.5 with 0 jumps to address zero. **Every clause of the stated proof standard was met:** a valid image boots from `core.reset()` with the host assigning no PC (the image's first instruction executes and the boot SP `0x20042000` is installed); an erased device spins inside the ROM instead of sliding; and the erased check is mutation-verified — patching its `beq` to a NOP makes the erased device leave the ROM, so the branch is what holds it and the happy-path test is not carrying that claim on its own. **The falsifying condition did not fire:** no existing suite reds on the new reset behaviour, which is consistent with the pre-claim measurement that nothing asserts the reset vector targets `spin` and that `resetToProgram()` overwrites PC after `core.reset()`. **What this does NOT become:** silicon-faithful boot. There is still no boot2 copy to SRAM and no CRC check; the handler enters XIP at `FLASH_BASE`, which is what rp2040js serves and what `bootFromFlash()` already did deliberately. Envelope as claimed: the reset handler in `src/rp2040-bootrom.js`, one focused test, this row. **THE DISSENT IS WITHDRAWN 2026-09-17, SAME DAY: THERE IS A NAMED CONSUMER AND IT IS IN THIS REPO'S OWN ROADMAP.** R1, *"`machine.reset()` freezes the rp2040 adapter instead of rebooting"*, reported by lego-ac and triaged here on 2026-09-06, carries a DEFINITION OF DONE agreed with them whose first clause is a test that calls `machine.reset()` and *"asserts the machine REBOOTS — PC back through the bootrom, banner again"*. A bootrom whose reset vector is `b .` cannot satisfy that clause; this handler is what makes a bootrom-mediated reboot POSSIBLE. **Corrected same day:** it is not on R1's current path — `machine.reset()` reaches the adapter's watchdog hook, which parks the core and hands a request to the host without ever fetching the reset vector, and `resetToProgram()` overwrites PC right after its `core.reset()`. So this is an option a whole-SoC replacement may take, not a clause already satisfied. I over-claimed while withdrawing a dissent, and tried to settle it with a 15-minute emulator run that was killed at its timeout when two greps over the adapter answered it in seconds. I argued the lane was speculative and was overruled, and the person overruling me was right: the consumer was written down in a file I maintain, and I did not look. **WHAT THIS DOES NOT DO, so the withdrawal is not an overclaim:** R1 is NOT closed by it. Its triage found that a narrow reset callback already produced a second MicroPython banner and `main.py` still did not run, because peripheral and controller state survives — the remaining work is whole-SoC replacement with host USB/GPIO rebinding, which this lane does not touch. This supplies one prerequisite clause, not the feature. **The lesson I would keep:** "I know of no consumer" is a claim about my own search, and I stated it as a property of the world without running `grep` over the roadmap that would have refuted it in one command. Originally: CLAIM 2026-09-17. SEMANTIC RISK — off the fast path by the protocol's own list, so the proof is stated before the code.** Today the reset vector points at `spin` (`b .`), documented as *"we boot from flash, and this exists so the vector table is not a pointer to zero"*. A host must therefore set PC by hand; `core.reset()` alone hangs. This lane makes the ROM's reset handler do what `bootFromFlash` already does deliberately — set the boot SP and enter the image at `FLASH_BASE` — so a reset boots. **NOT A CLAIM OF SILICON FIDELITY, stated so it cannot be read as one:** real RP2040 boot copies the 256-byte second stage into SRAM and runs it after a CRC check; rp2040js serves XIP without that setup, which is why the adapter enters at `FLASH_BASE` directly. This replicates the ADAPTER's documented entry in ROM. A faithful boot2 path is a different, larger lane. **THE HAZARD THIS MUST NOT CREATE:** an unconditional jump to flash would, on an ERASED device (`0xff` fill), execute `0xffff` forever — the NOP-slide the adapter's comment records as a 298 MB log flood. So the handler tests the first flash word and spins if it reads erased, and that branch is proved by a test rather than assumed. **Proof standard:** a valid image boots from `core.reset()` with no host PC assignment; an erased device spins instead of sliding; the erased check is mutation-verified by removing it and showing the slide returns. Blast radius measured first — no test asserts the reset vector targets `spin`, and `resetToProgram()` overwrites PC after `core.reset()`, so existing callers are unaffected. **Falsifying condition:** if any existing rp2040 suite reds on the new reset behaviour, the ROM's reset is load-bearing for a consumer I did not find and this lane stops rather than adjusting that consumer. **Envelope:** `src/rp2040-bootrom.js` (the reset handler only), one focused test, this row. No adapter change, no Lite files, no workflows, no pins. **Recorded dissent:** I advised against this lane as speculative — the one potential consumer, Door 2, bypasses the bootrom on purpose — and was asked to do it anyway. Noting it so the record shows the judgement, not to relitigate it. |
| R1's frozen-step probe, committed and reproducing | lego-a4 (this session), worktree `/mnt/volume1/code/wt/bw-i8086-186` | `lane/r1-reset-probe` at exact base `3e219cc` | **DONE 2026-09-17 in the commit containing this row.** `scripts/probe-pico-reset.mjs` landed; exit status is the verdict (non-zero while R1 stands), all three firmware guards fired on purpose before being trusted — the mismatch against a genuinely different build, the Kaluma UF2, not a synthetic corruption. Deterministic across three runs. **Reconciled anchor:** the park is at absolute instruction **1,240,679**; my claim below said "388,155 from prompt" and the probe first printed "119,993" — both correct, measured from the REPL prompt and from `import machine`, which is exactly how a loosely labelled number becomes a wrong anchor, so the probe now prints the absolute count too. **The falsifying condition did not fire:** the park reproduces at the pinned sha, so the numbers are not an artefact of my worktree. The run loop bounds ITERATIONS as well as simulated time, which is the fix for the defect that cost me a wrong "capacity" entry in the roadmap earlier today — a nanosecond cap needs ~250M iterations to trip on a parked core and looks like a hang until it does. `src/rp2040js-adapter.js` stayed out, as claimed: R1 is not fixed and this does not fix it. Originally: CLAIM 2026-09-17. R1's DoD bullet 2 asks for a frozen-step probe that reproduces RED before the fix and green after; none is committed here, and the triage's anchor (2,184,488 instructions across eight idle budgets) measures budgets running out AFTER the freeze rather than the freeze itself. Measured now, deterministic (identical counts across two runs): REPL prompt at **852,524**, `import machine` at **1,120,686**, then `machine.reset()` fires `onWatchdogTrigger` **exactly once** with `{cause:"watchdog", entryPC:0x10000000, entrySP:0x20042000}`, `takeResetRequest()` returns it, the core parks (`waiting: true`, PC `0x1002ec7c`) and no second banner appears — **388,155 instructions from prompt to park**, whole cycle about a second. **THE SEAM WORKS; WHAT IS MISSING IS A CONSUMER.** The adapter parks and hands off by design, and nothing constructs the replacement SoC. **Envelope:** one new `scripts/probe-pico-reset.mjs` following the firmware discipline already used by `probe-sf-unaligned.mjs` (path from an env var, sha256 checked and printed, refuses by name, never fetches), the R1 numbers in `ROADMAP.md`, and this row. **NOT in the envelope:** `src/rp2040js-adapter.js`. Whole-SoC replacement is the fix and it is a DESIGN decision about where the boundary sits — the adapter's comment assigns it to "a browser or runner" — so it is R1's owner's to make, not mine to settle by writing code into the gap. This lane makes the defect reproducible on demand; it does not fix it. **Falsifying condition:** if the probe cannot reproduce the park on a clean checkout at the pinned firmware sha, the numbers above are an artefact of my worktree and the lane fails rather than being adjusted to whatever it does produce. |
| R1 fix: whole-SoC replacement on a watchdog reset | lego-a4 (this session), worktree `/mnt/volume1/code/wt/bw-i8086-186` | `lane/r1-soc-replacement` at exact base `1d57bd6` | **DONE 2026-09-17 in the commit containing this row.** `replaceSoC(previous, opts)` landed with `test/rp2040-soc-replacement.test.mjs` (5 cases). Every clause of the stated proof met: the probe's exit status flipped non-zero -> **0**, MicroPython re-enumerates USB at 1,644,989 and reaches a live `>>>` on the replacement; flash survives while core registers, SRAM and the parked flag do not; and the flash copy is mutation-verified — a SoC built without it comes up at `0xffff` and loses the program. rp2040 99/99, census 14/14. **THE FALSIFYING CONDITION FIRED AND THE FALSIFIER WAS WRONG, which is worth more than if it had passed quietly.** I had written "if no second banner appears, peripheral state is not the only thing keeping it parked". No banner appeared — because `mp_hal_stdout_tx_strn` drops output until DTR, so the banner is gone on a machine that enumerates later, a trap lite's own probe documents. The first boot in my own probe proved life by knocking and waiting for `>>>`; I used the weaker banner test for the second reading and got a FALSE NEGATIVE about my own fix. Condition replaced with the instrument the first reading already used, and the reason recorded in the probe. **STILL OPEN, a DoD clause:** bullet 1 wants `deployMainPy` + `machine.reset()` + `main.py` demonstrably running afterwards. I proved the REBOOT; I did not drive `deployMainPy` and did not assert a deployed program runs. Flash survival makes it likely, and likely is not measured. Originally: CLAIM 2026-09-17. SEMANTIC RISK — off the fast path, so the design decision and the proof are stated before the code.** R1 is reproducible (`scripts/probe-pico-reset.mjs`, park at absolute instruction 1,240,679) and the diagnosis is that the seam fires and nothing consumes it. **THE BOUNDARY DECISION, made explicitly rather than smuggled in.** The adapter's comment assigns the replacement to "a browser or runner", and I previously declined to settle where it lives. Authorised to proceed, I am splitting it rather than taking all of it: the FLASH-PRESERVING RECONSTRUCTION goes in `src/rp2040js-adapter.js` as a module-level `replaceSoC(previous, opts)` — generic, testable here, and the same for every host — while the USB/GPIO REBINDING stays with the host, because the host owns those objects and the adapter cannot reach them. That is the smallest split that makes the reusable half reusable without pretending the host-specific half is generic. **Why a new adapter rather than an in-place reset:** `createRp2040jsAdapter` closes over its `RP2040`, so a genuine power-on cannot be faked by poking fields — the triage already found that a narrow callback clearing core state produced a banner but left peripheral state alive. Flash is 16 MiB and is copied out and back, which is what makes it survive while everything else returns to power-on. **Proof standard:** the probe's exit status flips from non-zero to zero — MicroPython reboots after `machine.reset()` and a SECOND banner appears; a focused test asserts flash survives the replacement while core/peripheral state does not; and the replacement is mutation-verified by skipping the flash copy, which must lose the program. **Falsifying condition:** if a second banner still does not appear after the host rebinds, then peripheral state is not the only thing keeping it parked and this lane reports that rather than widening until something passes. **Envelope:** `src/rp2040js-adapter.js`, one focused test, the probe's host-side rebinding, this row. No Lite files, no workflows, no pins. |
| probe-sf-unaligned's idle cap cannot bound a parked core | lego-a4 (this session), worktree `/mnt/volume1/code/wt/bw-i8086-186` | `lane/idle-cap-iterations` at exact base `aa42ac3` | **DONE 2026-09-17 in the commit containing this row.** Both halves of the stated proof met. **The bound fires:** injecting `core.waiting = true` before the first `run()` makes it return `idle (core parked, not executing) at instruction 0` instead of spinning — the bad state was CONSTRUCTED rather than waited for, in a temp copy that was deleted. My first injection matched ZERO lines and I caught it only because I printed the count; a mutation that fails to apply looks exactly like a guard that works. **The passing run is unchanged:** enumerate 968,980, prompt 3,370,335, `2.5+1.0` = 3.5, 0 jumps to address zero — identical to today's earlier readings, which matters because a cap that alters a PASSING run is a regression wearing the same diff as the fix. Envelope as claimed. Originally: CLAIM 2026-09-17. Diagnosed earlier today and fixed in only one of the two places it lives. `scripts/probe-sf-unaligned.mjs` caps idle by SIMULATED NANOSECONDS (`state.idleNanos > idleCapNanos`); with no alarm pending each tick advances ~8 ns, so a 2-second cap needs ~250 MILLION iterations to trip and presents as a hang for tens of seconds first. `scripts/probe-pico-reset.mjs` already bounds ITERATIONS instead; this propagates that. **LATENT, NOT FIRING — stated so the fix is not oversold:** Kaluma reaches a prompt and does not park indefinitely, so the cap is not currently reached. It is a loaded gun rather than a live defect, and it is exactly the one that cost 15 minutes and a false "blocked on box capacity" roadmap entry when the same loop was copied WITHOUT any cap. **Envelope:** `scripts/probe-sf-unaligned.mjs` and this row. **Proof:** the new bound is fired on purpose against a deliberately parked core, and the probe's normal Kaluma reading is unchanged — 2.5+1.0 still 3.5, same instruction counts, since a cap that alters a passing run is a different change from a cap that bounds a hanging one. |
| wired-286-dos-boot | Codex | 2026-09-09 | Wired DOS boot, pinned oracle harness and iterative compiled-wired performance toward the documented 4.77 MHz-equivalent capacity gate. Keep reference/default gates; no deploy or media hosting. Plans: WIRED-X86-PERFORMANCE-PLAN.md and X86-ORACLE-STRATEGY.md. **2026-09-12 integration milestone:** user authorized complete lab publication to upstream; candidate 69583a8 merges pinned master fa20bb8, hosted push jobs green, final native suite 66/66. Details and explicit skip/coverage limits: docs/X86-UPSTREAM-INTEGRATION.md. This completes integration, not the still-unmet 4.77 MHz optimization plan. |
| machine-checkpoint contract + its three machine consumers (complete capability) | this session (Lane A, assigned + audited by lego-ac) | `converge/machine-checkpoint-contract` at exact base `38de2e6` | **LOCAL CANDIDATE 2026-09-10.** New `src/machine-checkpoint.js` (self-contained, no outward imports) + the checkpoint methods `checkpointSupport`/`checkpointTopology`/`captureCheckpoint`/`restoreCheckpoint` on `m6502`/`z80`/`i8086` machines. **The methods are NOT separable from the state serialisation under them:** `captureCheckpoint` calls `saveState`, `restoreCheckpoint` calls `loadState`, and upstream had only a simpler `saveState`/`loadState` (m6502/z80 without devices+pinLevels+statePair; i8086 a v1 `{variant,cpu,cycles,mem,chips}`). So the enhanced `saveState`/`loadState`/`CPU_STATE` go up with the methods — measured round-trip-compatible (every existing upstream `saveState`/`loadState` test asserts LOCKSTEP, not format or version; `machine-contract` 26/26 unchanged). **FINDING, named not fixed-in-passing (third instance today after `_buildAdvanceList` and the marker retraction):** that enhanced serialisation was an UNDECLARED divergence — no ledger `contains` for `saveState`/`CPU_STATE`/`statePair`; the 12 entries pinned method SIGNATURES and nothing pinned the state format they depend on. A file declared divergent for reason X silently carried divergence Y; that is a gap in the ledger's coverage, its own lane. **Decision — throw-vs-skip (asked explicitly):** `saveState` stays BEST-EFFORT (upstream's deliberate, essay-documented contract in `machine-contract.test.mjs`: walk the chip map, skip a chip with no state codec, a separate structural test catches gaps); completeness REFUSAL lives in the contract — `checkpointSupport` reports it and `captureCheckpoint` refuses before ever calling `saveState`, so the no-silent-drop safety holds at the correct layer. i8086's old `saveState`-level throw was NOT ported. **Decision — wrapped-vs-raw:** i8086 stored component state WRAPPED (`{api,state}` via bespoke `_saveComponent`), m6502/z80 store RAW via the shared `statePair`; `machine-contract` asserts the raw form and that all three discover state identically, so i8086 CONVERGED onto `statePair` (its bespoke `_saveComponent`/`_loadComponent`/`_cloneCheckpointValue` dropped, `_snapshotTopology` kept). i8086 goes v1→v2 (complete state: topology+devices+machine pin state+intShadow/repInterrupted); `test/i8086-186.test.mjs`'s variant test updated to read the variant from `topology` and to reflect that v1 payloads are refused. Debug bridges deliberately OUT of scope (they carry replay/input divergence beyond checkpoint). Tests: new `test/machine-checkpoint.test.mjs` (13 — three machines: complete envelope, capture→restore lockstep, schema + topology fail-closed, incomplete-machine refusal); full machine+savestate+checkpoint sweep GREEN (only `i8086-debug`/`dos-bios-cursor` skip — pre-existing missing `avr8js` dep, fails identically on master). No-strangers: `git diff origin/master..HEAD --name-only` is exactly the six lane files + this row. Merged forward onto `ff9b324` (no rebase). Retires the 12 contract entries + i8086's helper entries (~16). Handing the branch to lego-ac to audit + land, then the Lite pin bump + ledger retirements. **AUDITED + EXTENDED BY lego-ac 2026-09-10, two commits appended (`12835d4`, `1239668`); the claim above stands except where corrected here.** (1) **A DEFECT WAS FOUND IN THE wrapped→raw HALF AND FIXED, NOT WAIVED.** Converging i8086 onto `statePair` dropped every check on the state BODY: `restoreCheckpoint` validated the ENVELOPE and handed the state to `loadState`, whose `this.mem.set(s.mem)` accepts a SHORT image and leaves the tail as the destination machine had it. Measured into a machine pre-filled `0x5a`: a one-byte-short image, a 7-element bare Array and a string were all ACCEPTED; only the over-long case refused, with the engine's own `offset is out of bounds`. m6502 refused all four by name. The comment at the site asserted the check "lives in the contract layer, as it does for m6502/z80" — it lived in those two machines' own `restoreCheckpoint` and nowhere else. (2) **THE COMMON CLAUSES NOW LIVE IN THE MODULE** as `validateCheckpointState` (state version, memory image type AND exact length, CPU field set, chip/device name sets, optional shape), with `details.reason` naming which clause fired; `sameCheckpointShape` moved out of m6502, which was its only home. Each machine keeps what is genuinely its own (m6502's cycle counter and pin levels; z80's tape, ULA and 128K banking). **z80 deliberately passes no `shape`** — its chip state legitimately reshapes between captures — and that abstention is now asserted in both directions. (3) **FOUR CLAUSES WERE UNHELD BY ANY TEST** (version, missing CPU field, null CPU record, wrong component set: each neutered, nothing red across seven suites), so the parameterised loop gained a case per clause. Suite 13 → **22**. Seven mutations, seven red. (4) **`cycles` in `I8086Machine.CPU_STATE` is KEPT and documented, not dropped.** It looks like a duplicate of `machine.cycles` and is not: `reset()` adds 4 to the machine while the core's reset zeroes it, and `step()` short-circuits on `cpu.halted`, advancing the machine by the wake horizon without calling `cpu.step()` at all (+25,000 machine cycles against +0 core cycles over five parked steps). `machine.cycles` is the authoritative simulation time; both are restored, neither is derived. (5) **Corrections to the claim above:** merged forward onto master `c8d7101`, not `ff9b324` (elapsed-without-retire landed under the lane; before the forward-merge the no-strangers diff read NINE files, two of them deletions of landed work). `i8086-debug` is **39/39 green** here — its `avr8js ERR_MODULE_NOT_FOUND` was a bare worktree with no `node_modules`, not a missing dependency. Full sweep is **87 machine/state/checkpoint/debug suites, 0 failures**. (6) **Accepted with a note:** `_snapshotTopology()` is a second builder of the same kind of value alongside the shared `checkpointTopology()` (155 chars vs 73, different inputs). Both directions of disagreement fail closed, so it stands — recorded here as a known double-source because a rename has as many sites as builders. (7) The undeclared-serialisation finding is correctly named-not-folded and is now its own lane with a falsifying threshold stated before measurement. |
| emu8051 reset-aware time domain + cycle-provider truth | this session (`8086 coverage testing materials`), root audits/promotes | `lane/emu8051-contract2-time-cycle` at exact base `5ada87b2` | **LOCAL CANDIDATE 2026-09-10**, commit `98c41a6`. Contract 2 of the emu8051-debug decomposition (after bwcx's exact-address run-to): the reset-aware time domain and the cycle-boundary truth, moved up from the Lite fork as one unit. `debugTime()`/`target.time()` reports `ticks` in oscillator cycles when a usable `clockHz` is supplied and native nanoseconds otherwise, with a `domain` string carrying a reset epoch so two runs of one program never read as one monotonic series. `cycleProvider()` publishes a recorded, resumable oscillator boundary that promises nothing it cannot deliver — `signals: []` (this ABI has no ALE/PSEN/address/data bus; clients must not synthesize a waveform) and `checkpoint: false` (architectural reads omit in-flight and peripheral state); it reads its `timeDomain` from `debugTime`, not a second copy of the clock-vs-ns rule, so a recorded cycle fact and the declared boundary can never disagree on the clock. ONE numeric authority: `NS_PER_S` (spelled as in `labwired-adapter.js`) drives the tick⇄ns scale, not a per-use literal. `test/emu8051-time-cycle.test.mjs`, 11 cases, each red by NAMED CONSEQUENCE (mutation-verified: wrong ns/s scale, dropped half-up bias, an inlined domain string drifting from `debugTime` across a reset, a non-empty `signals`, a true `checkpoint`, and a missing reset-epoch bump each reproduce as targeted reds; baseline restores to 11/11). Envelope: `src/emu8051-debug.js`, one focused test, this row. Full emu8051 suite green locally. **`target.time()` — KEPT, decided:** contract 2 promises reset-epoch MONOTONICITY ("emitted facts keep monotonic meaning across resets"), which is a property of the tick VALUE — `cycleProvider().timeDomain` is a string and cannot express it, nor can it test the cycles-vs-ns conversion or the `NS_PER_S` rounding, both observable only through `time()`. This is the FIRST public `time()` in bw-board; the recommendation is that other targets adopt a `time()`/`now()` surface when they publish reset-aware timestamps — a decided precedent, not an accidental one. **Hold released 2026-09-10** (bwcx's Lite pin + four lanes landed); MERGED FORWARD onto master `3a18a8c` (no rebase). `git diff master..HEAD` is exactly these 60 lines + test + this row; master's ci.yml `branches:['**']`, `scripts/probe-sf-unaligned.mjs`, and the `emu8051-adapter.js` post-reset pin-mode fix are carried, not reverted. Pushed for auto-triggered CI; handing the merged head to lego-ac to audit and land. |
| emu8051 exact code address + run-to descriptor | bwcx (Codex), root audits/promotes | `converge/emu8051-exact-runto` at exact base `8deff2a2f` | **CLAIM 2026-09-09.** One 16-bit maximum drives the emu8051 code-breakpoint guard, its refusal text, and the established synchronous-before-address `runTo` descriptor. This replaces `bp.addr & 0xffff`, which let a high address silently arm a different byte. Focused caller-facing evidence must prove the published maximum is accepted, its first successor is refused without reaching WASM, malformed numbers refuse, deleting the guard reintroduces the wrong-byte arm by name, and descriptor/guard drift reds by name. Envelope: `src/emu8051-debug.js`, one focused test, this row. Branch CI may run, but master landing is held until sim2cx's Lite RP2040 retirement lands. Baseline CI `34303655233`: 3917/3782/0/135; expected candidate +5 tests = 3922/3787/0/135, with vectors and 525-program corpus unchanged. |
| RP2040 truthful run-to capability descriptor convergence | sim2cx (Codex), root audits/promotes | `converge/rp2040-runto-descriptor` at exact base `bc0928222` | **LOCAL CANDIDATE 2026-09-09.** RP2040 becomes upstream's second run-to publisher after AVR, using AVR's exact descriptor vocabulary. One named architectural maximum now drives metadata, enforcement, and the unchanged refusal sentence; the focused test reads the published maximum, sets it, and proves the next even address is refused. The descriptor makes no mapped-memory claim. Deletion, an inclusive-guard off-by-one, and metadata drift each red the caller-facing named test; focused RP2040/AVR/STM32/conformance proof is 53/53. This closes one of five run-to descriptors that Lite has and upstream lacks; emu8051, i8086, m6502 and z80 remain inside larger declared units. AVR's triplicated bound is recorded as follow-on and untouched. Exact-base CI test census is 3917/3782/0/135; the strengthened existing test changes no denominator, so candidate predicts the same. No Lite pin work, other targets, workflow, or shared docs; exact-head CI pending. |
| debug-session wall-budget convergence | bwcx (Codex), root audits/promotes | `converge/debug-session-wall-budget` at base `8deaf1ea6` | Upstream the general opt-in session primitive from Lite: a bounded host-wall-time pump carries simulated-time debt instead of freezing the browser or dropping program time. The default path remains one whole `runFor` call per pump when `wallBudgetMs` is absent; Lite's only current opt-in is the i8086 host. Envelope: `src/debug-session.js`, one focused test, this row. |

## DONE

| ideal controlled-source DC operating point | `/root/schematic_corpus_import` (Codex Sol) | 2026-09-13 | **DONE in `f13b0b8`**, after remotely merged claim `01558ef` and docs-envelope amendment `14f0ba3`. The VCVS allocator now creates a row when either output terminal is live, fixing grounded-`outp` polarity. `BoardImpl.operatingPoint()` now accepts only explicit finite-gain ideal VCVS and finite-`gm` ideal VCCS alongside its existing R/C/V/I/GND/VCC domain; capacitors stay DC-open. Only the VCVS output pair propagates a DC anchor. Missing/floating terminals, same-net VCVS output, non-finite/unknown parameters, rails, output resistance and current limits refuse explicitly. Result currents are positive into terminals (VCCS is normalized only at this API boundary); live `branchCurrent` is unchanged. Both polarities match self-authored ngspice `.op` node voltages and E/G source currents and satisfy KCL. Success, repetition, non-convergence and refusal preserve live time/cache/parts/reactive/device/control state. Focused controlled/OP/AC/source suites: 39/39 green; allocator and VCCS-sign mutations each make a named regression red. Exact-head CI `34776389605` green. No bwlang `deviceCompanions`, rail-policy, CUI or Lite changes. |
| explicit automatic-supply fallback policy | `/root/schematic_corpus_import` (Codex Sol) | 2026-09-13 | **DONE in `76e5bc2`**, after remotely merged claim `54cf72a`. Registered physical battery, solar, ground and GPIO drives now keep their actual source currents when an ideal rail fixes the voltage; only board-model terminals explicitly opted in as automatic positive-supply fallbacks (`5v`/`3v3`/`vbus`/`vsys`) yield. The valid one-Norton-per-drive correction remains. A self-authored 9 V / 1 ohm battery held at 5 V reports 4 A and matches ngspice; solar, ground and GPIO conflicts have signed controls; opted-in Pico VBUS still yields and still powers a load when unpinned. Focused suites: 48/48 green; reverting to blanket `_staticDrives` suppression makes the battery regression fail at 0 A. Exact-head CI `34776822269` and Harris qualification `34776822271` green. The bwlang companion worktree/API remains untouched; no CUI or Lite changes. |
| BJT junction-exclusion sentinel repair | `/root/schematic_corpus_import` (Codex Sol) | 2026-09-13 | **DONE in the implementation commit containing this row**, after remotely merged claim `783fa09`. The exclusion remains valid: NPN/PNP execute the three-argument piecewise B-E companion; drive-derived Ebers-Moll Vce(sat) is not a Shockley junction counterpart. The sentinel now extracts each exact top-level stamp body, strips comments, and checks executable calls instead of an arbitrary 4,000-character slice that mistook a reverted-experiment comment for live code. `src/mna.js` is unchanged. Focused junction/BJT/source suites: 23/23 green; transiently adding a Shockley option to NPN makes the named sentinel red. Full two-junction Ebers-Moll remains the documented model gap. |
| static OP same-net nonzero voltage-source guard | `/root/schematic_corpus_import` (Codex Sol) | 2026-09-13 | **DONE in the implementation commit containing this row**, after remotely merged claim `c489646`. `BoardImpl.operatingPoint()` now refuses an inconsistent nonzero fixed ideal vsource whose `pos` and `neg` resolve to the same engine net before solving, while a zero-volt redundant same-net source with an additional resistor node remains converged and non-mutating. No `runAc`, transient/runtime or MNA allocation behavior changes. Focused OP/AC tests: 14/14 green; disabling the guard makes the named regression red with “Missing expected exception.” |
| standard-parts corpus evidence update | `/root/sol_lane_coordination` (Codex Sol) | 2026-09-13 | **DONE in the documentation commit containing this row**, after remotely merged claim `6ebc882`. The public programme now records the private 93-ID/eight-tag discovery snapshot, the date-bounded 81-modern/7-legacy KiCad reconstruction, the separate five-schematic EAGLE replacement, and the fixed ADI 85-body/255-case/1,785-finite-comparison qualification. It distinguishes discovery from acquisition/coverage/rights, public native R/C/V/I operating-point support from private controlled-E projection, and records that the full hosted per-case artifact was not retained. Docs-only envelope and `git diff --check` pass. |
| static native DC operating point API | `/root/schematic_corpus_import` (Codex Sol) | 2026-09-13 | **DONE in `2d22e42`.** `BoardImpl.operatingPoint()` returns independent capacitor-open DC node voltages, normalized positive-into-terminal currents, convergence/conflict status, and exact analysis metadata for grounded static native R/C/V/I/GND/VCC. Dynamic/current-limited sources, nonlinear/registered/stateful parts, L/transformer and DC-floating networks refuse by name. `runAc` reuses the same capacitor-open solve bridge; no result is adopted and live time, cache, parts, reactive state, probes, device state, controls and listeners stay unchanged on success, repetition and refusal. Self-authored RC `.op` matches ngspice; positive/negative V-source and I-source orientations satisfy KCL; explicit contradictory-source non-convergence is retained. Focused engine/AC/source suites: 36/36 pass. |
| grounded-positive independent voltage source MNA row | `/root/sol_lane_coordination` (Codex/Sol) | 2026-09-13 | **DONE in the implementation commit containing this row**, after remotely merged claim `b7257d2`. Independent vsource allocation now admits either non-reference terminal, matching its already-symmetric stamp. A two-orientation regression proves +5 V and -5 V are non-vacuous, current signs and live-node KCL; the zero-volt ground-ground negative case proves no spurious row. Focused source tests: 10/10 green; reverting the OR predicate reproduces the named grounded-pos failure. The existing nonzero ground-ground inconsistency remains a separate explicit-invalid-constraint problem and is not counted as a valid oracle pass. |
| standard-parts corpus/oracle programme correction | `/root/sol_lane_coordination` (Codex) | 2026-09-13 | **DONE in the documentation commit containing this row**, after remotely merged claim `e76a5ba`. The programme now separates original-direct, adapted, transformed-topology, import-only and unsupported evidence; retires the unmeasured ~12,200 extrapolation and thousands-before-first-landing rule; fixes model, manifest, finite-observable, rights and bounded-landing boundaries; and keeps bwlang's part/model implementation distinct from the private corpus harness. Docs-only validation: changed-path envelope is `LANES.md` plus `docs/STANDARD-PARTS-PROGRAMME.md`; `git diff --check` green. |

| remote-first fast-lane protocol | `/root/sol_lane_coordination` (Codex) | 2026-09-13 | **DONE in the documentation commit containing this row** (use `git log -1 -- LANES.md` for its exact non-self-referential commit identity), after remotely merged claim `0a2f02c`. Canonical per-repository registry, isolated one-task worktrees, remote-before-implementation claims, race-loser/explicit-takeover rules, upstream package ownership, proportional five-minute fast path, single landing owner and submitted-CR peer messages are now explicit. Docs-only validation: changed-path envelope is exactly `LANES.md`, `git diff --check` green, and root tree shape preserved. Matching Lite protocol landed in its own claimed lane. |

| z80 code-breakpoint bound convergence | sim2cx (Codex) | 2026-09-13 | DONE: landed candidate `8eeb16e867beb8d277b5778bc6d6c7b609e381e1`; hosted CI `34744438972` and Harris `34744438971` green; focused 17/17 and three named mutants red including wrong-address guard sensitivity. |

| m6502 code-breakpoint bound convergence | sim2cx (Codex) | 2026-09-13 | DONE: replayed onto `51e750decc007704a228c7765a0ce0fba81e39c4`; accepted candidate `cb1d36435860571b4c2e51496632d1c55e346c8b`, hosted CI `34740086533` and Harris `34740086634` green; focused 25 pass/1 documented skip and three named mutation reds. |

| AVR code-breakpoint bound deduplication | sim2cx (Codex) | 2026-09-13 | DONE: landed `ea11bf930f64ec8a74d12bff9ae26df07c9c9a18`; automatic CI `34736624121` and Harris qualification `34736624077` green. Focused proof 47/47 with 0 skipped; three isolated caller-consequence mutations red by name. |

Execution policy P2 contract: Codex engine_policy, 2026-09-12, branch
`feat/execution-policy-contract` from `5804fff`. Dependency-free admission seam,
reviewed adapter-owned catalog, no built-in backend claims, direct package export,
9 synthetic positive/negative tests. Existing factories/defaults unchanged.
Local integration handoff only; no push or deployment. See
`docs/EXECUTION-POLICY-API.md`.

286 DMA register prerequisite: source `cdbf18a` on `feat/x86-backend-lab`,
2026-09-09. Optional channel-2 register/XT-style page bridge uses physical
byte lanes and I/O strobes, private unchanged I8237 register core, no callbacks
or transfers. Address/count shared pointer, strict modes/masks, page/reset,
floating undefined reads and DREQ/software-request refusals tested. Owned
guest programs 7C00h/01FFh/page04h/mode46h and reads registers back with PIC,
PIT and FDC connected. Seven new tests plus one CLI test; expanded targeted
suite with I8237 core 475/475 pass, no skips. --dma-mode registers is explicit;
default none, dma capability remains false, FDC data commands still refuse.
HOLD/HLDA, bus ownership and terminal count are NOT implemented; those are
the next functional gate before sectors. Details HARRIS-286-DMA.md. No new
long POST/DOS boot, full vectors/CI/browser, app pins/defaults, merge/deploy
or media. CPU/SST hashes unchanged. Claim released.

286 FDC control/IRQ6 bridge: source `6b18924` on `feat/x86-backend-lab`,
2026-09-09. Explicit optional DOR/MSR/FIFO byte-lane wiring and FDC IRQ6 net
to PIC; private unchanged UPD765 core admits only control commands. Data/DMA/
PIO commands refuse before core admission, no media API or transfer callback.
Owned guest programs PIC, pulses DOR, receives vector 0Eh via two physical
INTA pulses, sends EOI/IRET, drains four reset replies into wired RAM, then
SPECIFY/HLT. Tests cover gates, port conflicts, control replies, reset, READY,
missing wires and refusal boundaries. Ten FDC tests plus one probe CLI test;
targeted suite including unchanged FDC core 431/431 pass, zero skips. Optional
--fdc-mode control probe metadata/provenance added; default none. No new long
POST run or DOS boot claim. Next: wired DMA channel 2, bus ownership and TC,
owned sector transfers before admitting data commands; larger normal POST
probe separately. Details HARRIS-286-FDC.md. CPU/SST hashes unchanged; no new
full vectors/CI/browser, app pins/defaults, merge/deploy or media. Claim released.

286 static net-layout resolver: source `e6fbc0d`, extended probe receipt/docs
`aa95abe`, on `feat/x86-backend-lab`, 2026-09-08. Precompute fixed membership,
canonical roots and driver order; still resolve every current level and settle
normally. Three differential tests; targeted suite 371/371 pass, zero skips.
Pinned synthetic benchmark measures 3.0–5.9x resolver-only improvement, not
overall emulator/RT speed. New configured 64 KiB/110,000-clock probe matches
old 48k/50k/64k checkpoints and ends at F000:0453, 7,511 retired, still banner
dispatch. Budget-exhausted/accepted:false, no next fault or POST/DOS completion.
Historical receipts preserved. Next functional task: FDC control-port/IRQ6
bridge and owned microguest tests, then larger normal POST probe; reject data
transfers until physical DMA exists. CPU/SST hashes unchanged. No new full
vector run, full CI/browser, app defaults/pins, merge/deploy or media hosting.
Claim released.

286 net-read optimization / longer POST diagnostic: source `c658507` on
`feat/x86-backend-lab`, 2026-09-08. Internal scalar reads avoid defensive
diagnostic copies; inspection, net resolution and physical bus behavior stay
unchanged. Three differential tests plus broader regression: 368/368 pass,
zero skips. Probe provenance now includes digital-circuit.js. Original-code
64 KiB/65,000-clock run passes screen clear into banner handling, ending at
F000:0447 with 3,293 retired, budget-exhausted/accepted:false. Historical source
hashes and new receipt preserved in HARRIS-286-BIOS-BANNER-REPORT.json. No next
peripheral fault, complete POST, DOS boot or end-to-end speedup claimed. Next:
larger normal POST budget, then physical FDC reset/IRQ6 and DMA acceptance gates
documented in HARRIS-286-BIOS-POST.md. CPU/SST hashes unchanged. No new full
vector run, full CI/browser, app pins/defaults, merge/deploy or media hosting.
Claim released.

286 BIOS POST configuration: source `de39245` on `feat/x86-backend-lab`,
2026-09-08. Full 640 KiB baseline reaches actual PIC ICW4=09h refusal at
F000:00F9 after 13,543 completed clocks/1,516 retired. Explicit source-level
single-unbuffered BIOS build changes only the ICW4 byte; original default ROM
remains hash-identical and PIC guards unchanged. Configured 640 KiB probe
initializes PIC/timer, reaches text-memory REP clear, exhausts 20,000 clocks
with 1,763 retired; accepted:false, no POST/DOS completion or next-fault claim.
Reusable bounded CLI, profile/provenance tests and two-run hashed receipt in
docs/HARRIS-286-BIOS-POST*. Five new tests; suite including existing BIOS ROM/
floppy tests 345/345 pass, no skips. CPU/SST hashes unchanged; no new full-vector
run, full CI/browser, app pins, default changes, merge/deploy or media hosting.
Claim released; continue configured POST toward disk/peripheral prerequisites.

286 conventional/text memory map: source `b301310` on `feat/x86-backend-lab`,
2026-09-08. Explicit 64–640 KiB conventional RAM and optional B8000h text RAM
use additional registered chip pairs/full latched-address decoders. Defaults
and saved recipe remain 64 KiB. Ten new tests cover chip isolation, boundaries,
READY/partial faults, holes and owned code relocation/far call at 9000:0200
with an upper-memory stack and text-memory write. Targeted run 274/274, no skips.
Unmodified BIOS probe: 6,000 clocks/747 retired, budget exhausted in IVT setup
at F000:0073, zero PIC writes; accepted:false, no POST/DOS boot claim.
CPU/SST hashes unchanged; no new full-vector run, full CI/browser, app pins,
merge/deploy or media hosting. Claim released; longer BIOS probe/peripheral
gates in docs/HARRIS-286-MEMORY-MAP.md. BIOS ICW4=09h mismatch is source-audited,
not yet the observed runtime stop; PPI/video/FDC/DMA wiring remains pending.

286 wired programmable timer: source `1d9ab7c` on `feat/x86-backend-lab`,
2026-09-08. Default-off counter-0 binary modes 0/2/even-3 subset with independent
ideal divider, resolved CLK/GATE/OUT0-to-PIC-IR0 and port/lane wiring. Separate
pin-clocked counter preserves visible pulses; production I8254 unchanged.
Sixteen owned tests cover waveform/count/load/latch/gate/guards and actual
guest periodic IRQ0/EOI/IRET/HLT, READY stalls, mask/unmask and disconnected nets.
Targeted suite including production PIC/PIT tests: 264/264 pass, zero skips.
CPU/SST adapter/runner hashes unchanged from SST286-INTR-REPORT.json; no new
full-vector run, hardware oracle, full CI/browser or wired DOS boot claim.
No app pin/default changes, merge/deploy or media hosting. Claim released;
storage/BIOS/memory-map boot prerequisites next in docs/HARRIS-286-TIMER.md.

286 wired programmable PIC: source `25d39dd` on `feat/x86-backend-lab`,
2026-09-08. Explicit I/O/controller gate and PIC+decoder/byte-lane adapter
reuse the existing unchanged I8259 core. Guest IN/OUT initialization, masks,
ISR/IRR, paired INTA vectors, HLT/IRET and EOI; fixed-priority single edge-mode
subset only. Cascade, auto-EOI, level/rotation/special modes explicitly refused.
Fifteen new owned tests; targeted run including PIC core tests 218/218, no skips.
CPU/SST adapter/runner hashes unchanged from SST286-INTR-REPORT.json; prior
1,477,997-pass receipt retained, no new full-vector run or hardware oracle claim.
No app pin/default changes, full CI/browser, merge/deploy or media hosting.
Claim released; timer/IRQ0 guest gate next in docs/HARRIS-286-PIC.md.

286 wired INTR integration: source `14549f0` on `feat/x86-backend-lab`,
2026-09-08. Opt-in controller INTA outputs and independent READY gate connect
the CPU's paired acknowledgement to an external part/vector-net connector.
IF/STI/SS blocking, qualified level requests, NMI priority, HLT wake, IRET and
REP restart tested with an independent lab peer (not a programmed PIC).
Twelve new tests; final targeted run 176/176, no skips. Fresh full pinned SST286
1,477,997 pass, 3 revoked, zero fail/unsupported/budget, exit 0; hashed receipt
SST286-INTR-REPORT.json. SST is not an asynchronous/bus oracle. PIC ports,
timer, cascade, timing/protection and actual wired DOS boot remain pending.
No app pin/default changes, full CI/browser, merge/deploy or media hosting.
Claim released; next programmable PIC/port gate in docs/HARRIS-286-INTR.md.

286 INTA sequencer foundation: source `5bfe02e` on `feat/x86-backend-lab`,
2026-09-08. Bus-only `intrEnabled:true` enables a paired INTA transaction and
resolved INTR-level observation, not CPU interrupt selection. Five new net-peer
tests verify ignored first data, second-byte vector, six-system-clock gap,
address/BHE release, LOCK, external wait enforcement and RESET cancellation.
Final targeted regressions 164/164, zero skips. CPU/adapter/runner hashes still
match the previous 1,477,997-pass SST286 receipt; no new full-vector run claimed.
Controller/PIC wiring and CPU IF/shadow/priority/HLT/REP integration remain
pending; memory-board INTR remains refused. No app pins/defaults, full CI/browser,
merge/deploy or media changes. Claim released; next gates in HARRIS-286-INTA.md.

286 NMI foundation: source `bbf7cdd` on `feat/x86-backend-lab`, 2026-09-08.
Explicit `nmiEnabled:true` board option samples resolved NMI, qualifies edges,
delivers wired vector 2, supports HLT wake, SS shadow, IRET blocking/coalescing
and REP element-boundary restart. Thirteen new tests; final targeted run
159/159, no skips. Full pinned SST286 remains 1,477,997 pass, 3 revoked,
zero fail/unsupported/budget, exit 0; hashed receipt SST286-NMI-REPORT.json.
SST supplies no NMI inputs: asynchronous evidence is owned wired tests plus
cited manuals, not silicon timing. INTR/INTA, controller, debug/trap priority,
full reset/halt/shutdown and protected mode remain gates. No application
pin/default changes, full CI/browser, merge/deploy or media hosting. Claim
released; next INTR acknowledgement gate in docs/HARRIS-286-NMI.md.

286 system-state prerequisites: source `c38e0d6` on `feat/x86-backend-lab`,
2026-09-08. Real-mode LGDT/LIDT/SGDT/SIDT/SMSW/LMSW(non-PE)/CLTS, protected-only
real-mode faults, IDTR-based INT/IRET and debugger register inspection. Twelve
new owned tests; final targeted run 146/146, no skips. Full pinned SST286 rerun
1,477,997 pass, 3 upstream revoked, zero fail/unsupported/budget, exit 0;
new hashed receipt in `docs/SST286-SYSTEM-STATE-REPORT.json`. System forms lack
SST silicon vectors: cited Intel manual + owned wired/semantic tests only.
PE=1, nested-fault delivery failure, LOADALL and external INTR/NMI stay explicit
limitations. Default-off, no app pins, full CI/browser, merge/deploy or media
hosting changes. Claim released; next gates in HARRIS-286-SYSTEM-STATE.md.

286 real-mode expansion: source `aff6a67` on `feat/x86-backend-lab`, 2026-09-08.
All 326 pinned SST286 files selected: 1,477,997 executed/pass, 3 upstream
revocations, zero fail/unsupported/budget, exit 0; hashed per-file receipt in
`docs/SST286-REAL-MODE-REPORT.json`. Local targeted regression 134/134, no skips,
including wired fault/INT/REP/READY tests, Paterson on 8086/80186/wired 286 and
DOS file persistence on 8086/80186. Semantic vector coverage is not physical
bus/timing or full 80286 acceptance; protected mode, external interrupts,
system instructions outside the suite, devices and wired DOS boot remain.
LOCK bypass and inactive-coprocessor profile are explicit test conditions,
not physical protocol support. Default-off; application pins unchanged; no
full CI/browser acceptance, merge, deployment or new media hosting. Claim
released at this incremental handoff; remaining gates in SST286-RUNNER.md.

286 vectors/private media increment: engine `7b7f92f`, paired Lite docs `15be58905`. Pinned SST286 inventory traversed all 326 files / 1,478,000 vectors: 675,501 matched, 802,496 unsupported (42,341 exception/interrupt cases refused before execution), three revoked, no completed-state mismatches or budget exhaustion; exit 1, NOT full acceptance. Test-only 16 MiB semantic memory drives unchanged boot decoder; no physical-board/timing/protected-mode claim. Added external-only reviewed/hash-checked private media admission, no game downloads/uploads or private repository creation. Fourteen new harness tests and 30 existing Paterson/prerequisite tests passed locally (42 combined before two additional parser/CLI tests, final 14 harness tests green). No app runtime/vendor/production pin change, merge/deploy or full hosted CI. Claim released at incremental handoff; CPU expansion and guest milestones remain pending.

Paterson guest increment: source `f2eeb5964bc1285a6c8f3b1c297d2998833cc56f`, paired Lite `9b5ea89dc55ea0e987591c3db4b6d4d2cf3c7745`. Preserved MIT original/adapted FAT12 routines pass on 8086/80186/wired 286 subset; byte/stack/segment/ALU prerequisites remain experimental. Real DOS shell disk persistence passes on 8086/80186. 71 targeted engine tests passed locally, no skips; Lite preservation/runtime and isolated browser passed. No full 80286 vector run, general 286, accepted ELKS/MINIX boot, games import, DOSBox package support, production pin change, merge or deployment. The five requested milestones remain open in the plans; this bounded implementation/research increment is handed off, claim released.

286 saved profile/debugger session: source `14f2538` on `feat/x86-backend-lab`; strict JSON construction recipe for the fixed latched-memory profile, editable saved wires, fresh-state reload, bank/net inspection, bounded clock/instruction stepping and 24-bit physical code breakpoints. Unsupported parts/backends/live snapshot and mutation operations fail explicitly. 10 new tests; final targeted run 117/117, four suites, no skips. Engine-only, default-off; no full Boundary-D registration, application controls, production defaults/pins, merge or deployment. Full CI/browser/hardware not run. Claim released; application import/export and debugger controls remain next.

286 addressing and loops: source `bf83dac` on `feat/x86-backend-lab`; word ModR/M MOV/ADD/CMP in both directions, register INC/DEC, JE/JNE/JMP/LOOP. Owned ROM fills/sums wired RAM and checks the result in guest code (47 instructions, sum 10; deliberate failure branch also verified). 13 new tests include all 256 ModR/M decoder encodings as a unit check, representative wired accesses and delayed RMW flags/retirement. Final targeted run 107/107, no skips; loop demo passed. Still no general 286, timing/prefetch/protection or editor integration; no production defaults/pins/deployment. Full CI/hardware/browser not run. Claim released; saved circuit/debugger integration remains planned.

286 boot instruction subset: source `8e9d684` on `feat/x86-backend-lab`; generator-resumable real-mode subset fetches owned reset/program ROM through the latched board, retires ten instructions and writes `0x68ac` to wired RAM, then halts. Low ROM alias is explicit board decode, default-off. Assembly sources reproduce ROM bytes; shared-subset results agree with separate 8086 decoder. 15 new tests; final targeted run 94/94, zero skips; demo `cpuExecuted:true`. Still no general 286, prefetch/instruction timing/protection/interrupts, physical HLT signalling, snapshots or editor component. Full CI/hardware/browser not run; no production promotion or deployment. Claim released; broader CPU and Circuit Editor integration remain planned.

286 latched memory bridge: source `5e5c71a` on `feat/x86-backend-lab`; external phase controller and address/control latch feed existing 62256/28C256 update models through an ideal-digital adapter. Write storage changes on command trailing edges, not CPU callbacks; late-bank preflight is staged before commit. 16 new integration tests; final targeted run 79/79, no skips; demo verifies `0x68ac`, zero/one writes before/after edge, `cpuExecuted:false`. No full 82C288, analog solver, instruction CPU, editor integration, production defaults/pin changes, merge or deployment. Full CI/browser/hardware traces not run. Claim released; resumable instruction subset is the next execution gate.

286 bus contract and phase sequencer: source `610a1e3` on `feat/x86-backend-lab`; pinned Harris August 1996 PDF checksum, PLCC/status/lane metadata, reset qualification, active-low READY, waits, split words and write-data hold. 22 new tests; final targeted foundation/electrical memory/8086 machine run 63/63, zero skips. Owned ROM fetch through nets checked without executing instructions. Explicitly non-pipelined system-clock phases, not edge-accurate timing or an instruction CPU; no controller/editor/pin promotion. Full CI/hardware traces/browser not run. Claim released at this incremental handoff; next gates in `docs/HARRIS-80C286-BUS-CONTRACT.md`.

286 circuit foundation: initial partial-M1 milestone at `90467ee` on `feat/x86-backend-lab`. Default-off ideal digital nets and synthetic wired ROM/RAM master, 20 new tests passing; targeted run including electrical memory, 8086 extractor and machine passed 56/56, no skips. Demo verifies wired result with `cpuExecuted:false`; no claim of 286 CPU, pin timing or editor integration. No production exports/defaults or consuming pin changes. Full CI not run for this milestone. Claim released; M0 sign-off, remaining M1 and actual CPU implementation remain planned.

8086 PIT follow-up: engine half complete at `dedfbc8`, full CI `34249782632` green (units, vectors, full vectors, 80186 vectors, corpus). Added callback-time CPU/PIT clock and counter-method observability assertions. No engine runtime changes. Paired Lite branch retains correct candidates default-off and removes the stale-state scheduler implementation; measurements/retention policy live there. Claim released; feature branch only.

8086 device advancement: complete on `perf/i8086-device-advance`, source/test commit `4f72ff4`. Full CI `34246446550` green (units, vectors, full vectors, 80186 vectors, corpus). Added the instruction-boundary observability contract and differential/negative fixtures. Paired Lite experiments reject all four measured device candidates; no production source changes or general deferred scheduling. Feature-branch handoff only, not merged. Claim released.

8086 promotion and sandbox: complete; reconciled engine `4c6ab1a7289db121284a2c0e98435598bd3ef24c` retains tone and W65C51 master changes alongside verified prefix/REP/PIT/RAM optimizations. Full engine CI `34235227257` green; consuming Lite build/corpus/both browser suites `34237479071` green, including isolated GUI comparisons and diagnostic reference-word access. This ledger-only handoff accompanies fast-forward promotion to master; source pin remains the verified runtime commit. Claim released.

8086 fastpaths phase 2: complete on `fable/i8086-fastpaths`, engine `6b7761d210698c8f392e28ce85d02c5d94ee676f`. Dedicated REP MOVS/STOS, guarded RAM words (`fastWords: false` reference option), and unit-correct PIT deadlines integrated into Lite feature branch `perf/i8086-execution` at `911d09104`. Upstream CI `34219643631` passed units, all 646,000 8086 vectors, 80186/V20 and 525-program corpus. Lite experiment log records Chromium acceptance and rejected debugger/batching/decoded/Wasm prototypes; those prototypes are not production paths. No default-branch changes or deployment; claim released.

| lane | who | landed | sha |
| ZX ULA complete snapshot convergence | Codex immutable-inputs session | 2026-09-09 | DONE: PR 4 merged at `fe523c1ae10cb566e2d50862fd0ff0ab593975c0`, exact merged-head CI `34314765284` green (test, vectors, corpus, vectors186). Full keyboard/EAR/audio snapshot ownership and legacy compatibility; all three new tests fail against old source. Lite adoption in `ci/immutable-inputs-wip`. |
| --- | --- | --- | --- |
| the debug-target replay surface: four targets, both halves, hollow-safe | lego-b9, lego-ac audits/lands | 2026-09-10 | `ba902ed` → **`5a0b197`**, seven landings. `src/debug-replay-contract.js` declares a surface four targets already half-implemented; all four now have BOTH halves. **The premise the whole sequence started on was false:** "no target has a `{ticks, domain, hz}` source, `machine.tMs` is milliseconds" — true of `tMs`, and `z80-machine.js:270` is `get tMs() { return this.cycles * 1000 / this.clockHz; }`, so every machine had both operands all along. The exact source had been divided into a float and everyone downstream read the float. **Defects found in audit, none of which green tests caught:** a replay guard that tested the MODE while naming the attached BOARD as its reason (poll-mode replay accepted, then overwritten one run slice later — measured with a control); a round trip that was of the FACT and not the STATE, because every poll test attached a board; a loop over `['poll','push']` whose two iterations ran one state; `this.cycles = s.cycles` in `loadState`, so a restore rewinds the clock and the recorder raises `INVALID_INPUT_ORDER`; rewind detection sitting BEHIND the dedup gate, silently dropping a real post-restore input; a by-name refusal (`z80.serial`) that was simply false — `z80-adapter.js:245` is `sendSerial`; and `applyReplayInput` THROWING on `{machine: {cpu: {}}}` in two targets where the contract requires a return value. **A HOLE IN MUTATION TESTING, worth more than any of the fixes:** the z80 serial test passed before AND after the fix that proved its sentence false, because its FIXTURE built a bare `{machine}` — a true test of a false claim, which no mutation of the source could redden. **The standing test shape for this surface:** read the producer list OUT OF THE SOURCE, assert it equals the payload table's key set, drive every producer against a hollow target with a VALID payload (a malformed one refuses at validation and never reaches the hardware), and check the PREFLIGHT as well as the apply half. `i8086-cycles-reset-N` → `-rewind-N`: that clock ADVANCES on reset. The 8051's `-reset-` suffix is CORRECT for its own mechanism and must not be converged with it. `docs/DEBUG-TARGET-REPLAY-SURFACE.md` carries the contract. |
| rp2040 adapter: `bootFromFlash(image)` entry point (`src/rp2040js-adapter.js` + test) | `8086 coverage testing materials` (lego-ac's N3b) | 2026-09-05 | On `master` at **`ff744c5`**. Encapsulates lite's hand-rolled Pico boot — set `rp2040.flash`, `PC = 0x10000000` — as one adapter call: places a flat flash image at `FLASH_BASE` and enters stage 2 there with `BOOT_SP`, so boot2 runs first and a real image relocates VTOR to `RAM_START` itself. The full VTOR-relocation is proven end to end by lite's `probe-pico-micropython` (re-run both directions in the bootrom review above); the unit test proves the adapter's half — a two-instruction stage-2 stub runs from `0x10000000` (`r0 = 0x20<<24`), which `loadProgram`'s SRAM entry cannot produce. `FLASH_BASE`/`BOOT_SP` exported. lego-ac pins past this in one bump (N3a). |
| rp2040 bootrom: flash ROM functions (`src/rp2040-bootrom.js` + 4 tests) | lego-ac (author); independently reviewed + merged by `8086 coverage testing materials` | 2026-09-05 | Merged to `master` at **`be02550`** (rebased clean onto `be0e881`, 15/15 on the new base). **Reviewed the fleet way — re-ran the oracle, both directions, rather than reading the 15/15.** The oracle is lite's `scripts/probe-pico-micropython.mjs --repl` (pinned MicroPython v1.22.2 UF2, booted in rp2040js against the integrated tree). With the PATCHED bootrom overlaid, MicroPython boots to REPL and `os.statvfs("/")` returns **`4096 352 ok`** — a file written and read back. With the ORIGINAL bootrom restored, same boot, filesystem **`OSError [Errno 19] ENODEV`**. Both boot `print(1+1)`→2; the sole difference is the flash filesystem, which is exactly what the six ROM functions enable. That end-to-end run also exercises the Thumb encodings behaviourally (MicroPython erases/programs flash through them), so a wrong encoding would have failed the write. Lite consumes by pin bump (its task N3a). |
| opcode-coverage — the grind's complement, across two cores | this session (`8086 coverage testing materials`) | 2026-09-05 | On `master`: **`1a74a6f`** WAIT (9B) + **`6711702`** POP CS (0F) — the two opcodes the SingleStepTests 8086 suite omits wholesale, each pinned with an evidence-tier-2c note (no oracle backs them; corpus-exercised is not ground). **`e5cb0eb`** a standing gate (`npm run cov:i8086`) emitting one number — opcodes covered by neither the corpus nor the grind — wired into CI's MAIN job by lego-a4 (`2fe136f`), not the grind job, so it runs where the vectors are absent. **`d1b325a`** STP (DB) on the W65C02 — its analog: STP and WAI are the only two whose WDC-suite vector files are EMPTY, and STP was asserted nowhere. Method (wrap `_exec`, diff fired-set against the suite's documented/empty omissions) also gifted lego-a4 the REP string-op cycle bug (`71cc1ca`) and fixed the ehBASIC ROM reading as a pass when absent (`23619a7`, now an `oracle-census` fixture row of lego-a4's, `e945dfb`). **w65c02 is opcode-complete bar STP/WAI (254/256 ground); a standing w65c02 number is licence-thinner than the 8086's — the most realistic 6502 workload (ehBASIC) is NC and cannot be a CI gate.** |
| E6.8.3 — port and interrupt breakpoints | lego-a4, with the support-chip lane | 2026-09-04 | `e0007e2` on `feat/i8086-186`. **Split lane, built to the machine side's shape rather than mine**: `machine.hooks.onPortAccess`/`.onInterrupt` are theirs (`2c83dcf`, `c837e4f`), the core's software-INT emit sites and the target are mine. `{kind:'port', port, dir?}` and `{kind:'int', vector?, source?}`; hooks attach only while watched and detach on the last clear, so an unwatched machine pays one null check per IN/OUT. **THE DOUBLE-FIRE TRAP, verified not assumed:** the core's public `interrupt(n)` — hardware delivery — routes through the same `_interrupt(n)` funnel the INT opcodes use, so emitting there reports every IRQ twice and "break on INT 21h" trips on the timer tick. The core emits from the OPCODE handlers and the fault sites only; a test asserts `cpu.interrupt(8)` emits nothing from the core. Faults are `source:'exception'`, not `'int'` — raised BY the CPU rather than asked for BY the program, the same argument that separates `int` from `irq`. 646,000/646,000 unchanged, 450/450 across the tier. **Record correction:** `e0007e2` is a MERGE commit. Its message describes E6.8.3 only, but the merge also carries the support-chip lane's E6.8.5a (`cga-card.js`, `test/cga-crtc.test.mjs`) and their `test/i8086-port-trap.test.mjs`. Those are their commits with their own messages and authorship in history; the merge message does not mention them and should have. |
| E6.8.2 — symbols in the debugger | lego-a4 | 2026-09-04 | `3b81970` (disassembler substrate) + `cd1d62d` (the join), on `feat/i8086-186`. **Taken with lego-47's agreement — it holds `src/i8086-debug.js` and handed it over.** The producer and consumer had both existed all along and nothing joined them. New: `labelsFromAssembly(result, {loadSeg})`, `setSymbols`/`symbolAt`, `capabilities().symbols`, and `setBreakpoint({kind:'code', symbol})`. **Three silent-failure modes, each with a test**: an `equ` admitted as an address (a constant renaming whatever lives there — the same bug the disassembler's own regex had); a linear map handed to a disassembler that speaks segment offsets (labels NOTHING on any machine not at segment zero, and renders plain hex rather than raising — mutation-checked, reverting the rebase fails exactly the one test written for it); and a breakpoint on an unknown name silently doing nothing, which lets a program run to completion and produce evidence it never reached the label. 8 new tests, 385/385 across the tier. |
| E6.8.1 — the 80186/80188 instruction variant | lego-a4 | 2026-09-04 | `1f6b3e2` (core) + `0d97728` (disassembler) on `feat/i8086-186`; core merged to `feat/i8086-tier` at `2795d25`. **Graded to the same standard as the 8086 half, not a weaker one:** core `132,532/132,532`, disassembler `172,430/172,430` on TEXT and LENGTH, both against SingleStepTests/v20 (MIT, sparse-checked out at 156 MB of 851). 8086 unchanged at `646,000/646,000` on both grinders; 307/307 tier tests; 18 new. **Where the V20 stops being a 186 the grinders EXCLUDE and REPORT rather than scoring the wrong chip** — 39,898 shift counts above 31 in the core grind (the V20 does not mask, MEASURED: 470/600 masked vs 579/600 unmasked on C0.4+C1.4) and 3,570 REPC/REPNC in both. Counts print even when green. **Three findings worth more than the opcodes.** (1) *OF is defined for every shift count on the later part, and it is the count-of-one rule applied to the LAST iteration, not a new rule* — SHR is the tell, because after two byte shifts nothing is left in the top bit. Bit-identical at count 1, which is why 646,000 holds. (2) *The suite's own disassembler is lossy* — it drops the three-operand IMUL's immediate and hides a segment override on OUTS where it applies; both are behind `v20Syntax: true` so the grinder gets the test convention and the product does not. (3) *The word shift form pads its count to two digits and the byte form does not* — no principle in it, 800 vectors disagreed in one leading zero. **Declared, not hidden:** 0x63-0x67 are undefined on a real 186 and are still rendered and executed as 8086 aliases; nothing grades that. NEXT: a `vectors186:` CI job — the grinds are real now, which is the ordering this repo requires, and the sparse recipe is the same shape the existing `vectors:` job uses. Not started; ask lego-47 first, ci.yml is shared. |
| §E6.8 — the finished-emulator gap survey (emu86, PCjs, XTCE-Blue) | lego-a4 | 2026-09-04 | `4560d78` on `feat/i8086-support-chips`, merged to `feat/i8086-tier` at `fca6b9a`. **Note for the record:** the section was written into a shared tree and swept into another agent's commit by a `git add -A` — see rule 3. No work was lost; the attribution in that commit message is not the whole story. Two premises corrected same-day by `lego-47`; both corrections are recorded in place in §E6.8 rather than edited out. |
| coverage-and-boards — the three self-booting 8086 example firmwares + board fixes | this session (sim2 / `8086 coverage testing materials`) | 2026-09-04 | On `feat/i8086-support-chips`: **`4133114`** TIMERDEMO8086 — the interrupt example (INT 8 tick painting a live counter; first end-to-end proof a running program takes & services a hardware interrupt here: 8254 OUT0 → 8259 IR0 → CPU INT 8 → ISR → B800 → EOI); **`cffca33`** CGADEMO8086 screen example + PCXT8086 CGA video-RAM fix (B8000-BFFFF, matching XTDISK); **`eb8109a`** PCXT8086 `dma:'dma1'` load-bearing-wire comment. On bw-circuit-ui `feat/i8086-ui`: **`afee1de`** Machine-Loader offers all three firmwares, loaded high via `romAt = 0x100000 − length`. E7 step 2 + the EXTRACTOR-IRQ-GAP correction landed in ROADMAP the same push as this row (rule 2). |


## DONE — recent implementation candidates

| lane | owner/session | worktree | exact scope | base SHA | status |
| --- | --- | --- | --- | --- | --- |
| 80286 functional integration and current Harris evidence | Astra coordinator / Sol agents, astra-286-sept19 | `/mnt/volume1/code/wt/astra-286-integration` | Preserves close-gap `76d0b9b` ancestry and current master; static dependency guard replaces false file-size heuristic, sampled fast vectors block failures and incomplete accounting, vector memory is isolated, exact-source full fast/Harris and bounded wired BIOS workflow added with separate manual reference DOS run. | claim `71d19e8` | **IMPLEMENTED 2026-09-19; hosted qualification required before guarded landing.** Focused CPU/guard/runner 51/51, workflow/census/input gates 25/25, guard direct/transitive mutations red, consecutive-case memory regression proven; new workflow actionlint clean. Current 20k-clock BIOS diagnostic reaches PIC/timer setup and CPU/bus transfers without claiming DOS completion. Historical reports retained with explicit source-hash limits; no protected-mode, timing or physical-board promotion. Initial full run at `431acef` exposed 58 fast-core cases; fixes preserve 286 high addresses, completed POP state on destination fault, AAM-zero/divider behavior and grade stray writes. All 45,000 cases in the nine affected files now pass; broad regression 634 pass, 0 fail, 1 optional skip. Current Harris full semantic and reference wired DOS receipts at `431acef` are preserved under docs/receipts with unchanged Harris source hashes; whole initial qualification was not green. The next full run passed 1,477,996 cases and exposed one PUSHA partial-write fault through the stronger write comparator; whole-stack preflight now fixes it (opcode 60: 5,000/5,000; focused 47/47). Final combined full qualification remains the landing gate. |

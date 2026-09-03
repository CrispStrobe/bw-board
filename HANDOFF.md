# bw-board handoff — 2026-08-16

**1883 tests, 0 failures (20 skips — firmware/ROM dependent).** Both branches (master + main) pushed.

## Completed this session (session 12)

### AY-3-8912 PSG (`src/ay-3-8912.js`)
Clean-room from GI datasheet. 16 registers, tone/noise/envelope counters at clock/16, 17-bit LFSR noise, audioTone() per-channel {hz, on, vol}. Wired into Z80Machine on zx128 configs: $FFFD select/read, $BFFD data write. saveState/loadState. 11 tests.

### .z80 128K loading + saving (`src/zx-z80file.js`)
parseZ80 extended: v2 hw 3/4, v3 hw 4/5/6/12 → `{is128, banks[8], port7ffd, ayRegs, aySelected}`. loadZ80 sets all 8 pages, applies _setBank, loads AY registers + selected register. saveZ80 dispatches: 48K→v1 compressed, 128K→v3 with ED-ED compressed banks + AY state. 128K-on-48K refuses. Round-trip test proves banks+AY+banking survive.

### 128K SNA (`src/zx-sna.js`)
131103-byte format: 48K dump + PC + port$7FFD + 5 remaining banks. loadSNA128/saveSNA128 round-trip all 8 banks and banking state. 4 tests.

### TZX container (`src/zx-tzx.js`)
Standard speed data blocks ($10) extract to ZXTape-compatible {flag, data}. Turbo/pure/direct/CSW/generalized blocks REFUSED with named notes. tzxToTape() provides the trap() interface. 7 tests.

### ULA memory contention (`src/zx-ula.js`, `src/z80-machine.js`)
Per-instruction approximation (stated accuracy bound). ULA.contend(frameTs) returns 0-6 wait states from the 8-T-state contention pattern. Machine wraps read/write/in/out when config.contention=true. OFF by default. 48K + 128K frame geometry. 7 tests. Design note: `spec-updates/ula-contention.md` (APPROVED).

### Debug parity: AVR + RP2040 (`src/avr8js-debug.js`, `src/rp2040js-debug.js`)
Step-over/out + TRUE write watchpoints on both targets. AVR: RCALL/CALL/ICALL call detection, SP-depth wait, cpu.writeHooks. RP2040: Thumb BL detection, return-address breakpoint, writeUint8/16/32 wrap. 8 parity tests.

### M6502Machine saveState/loadState (`src/m6502-machine.js`)
CPU registers, cycles, full memory, chip state. W65C22 VIA, TMS9918 VDP, TileVGA hooks. Round-trip lockstep test. 3 tests.

### Z80 ACIA + CTC saveState hooks (`src/mc6850.js`, `src/z80-ctc.js`)
MC6850 rx/control/overrun/IRQ. Z80CTC vector + 4-channel timer state. 3 tests.

### MC6845 enhancements (`src/mc6845.js`)
saveState/loadState (registers only — vram is a live view). opts.charH sets R9, opts.charset flows from Z80Machine config. Extractor accepts rs/rsb for the register-select pin. 4 tests.

### ATtiny88 pin-trace acceptance
Hand-assembled blink (PB0 toggle symmetric at 8 MHz) + button-read (PC3→PC4 mirror). 2 tests.

### tron-on-128K regression
48K game (tron TAP) boots on zx128 in ROM1+lock 48K compatibility mode. Tape trap guard verified through banked bus. 1 test (skips without ROM/TAP).

### Blinkenrocket modem full loop
encodeTextMessage("Hi") → 90504 PCM samples → ATtiny88 ADC6 → firmware demodulates (52869 ADC reads) → FEC-decoded TEXT pattern "Hi" in external EEPROM. The sound-becomes-data proof. 1 test (skips without firmware hex).

### Earlier sessions (8-11) — still in tree
- TWI/SPI transaction bridge, ILI9341 v2+parallel, DFPlayer/ZE08, vcc params.volts, henrys fix regression, dc_motor R alias + windingH, MC6845 CRTC, UART frame devices, controller/datalogger/stimulus extensions.

## Artifact locations

| Artifact | Path |
|----------|------|
| AY-3-8912 PSG | `src/ay-3-8912.js` |
| TZX container | `src/zx-tzx.js` |
| .z80 48K+128K | `src/zx-z80file.js` |
| .SNA 48K+128K | `src/zx-sna.js` |
| ULA contention | `src/zx-ula.js` (contend method) + `src/z80-machine.js` (wrappers) |
| Contention design note | `spec-updates/ula-contention.md` |
| Debug parity AVR/RP2040 | `src/avr8js-debug.js`, `src/rp2040js-debug.js` |
| M6502 saveState | `src/m6502-machine.js` |
| Z80 chip saveState | `src/mc6850.js`, `src/z80-ctc.js` |
| MC6845 CRTC | `src/mc6845.js` |
| Modem encoder | `src/blinkenrocket-modem.js` |
| Modem e2e test | `test/blinkenrocket-modem-e2e.test.mjs` |
| ATtiny88 chip + tests | `src/avr-chips.js` (ATTINY88), `test/avr-attiny88.test.js` |
| ILI9341 SPI+parallel | `src/devices/ili9341.js` |
| TWI/SPI bridge | `src/twi-bridge.js`, `src/spi-bridge.js` |

## In flight / next

| Item | Status | Notes |
|------|--------|-------|
| Campaign escalation duty | Standing/reactive | No findings pending |
| Contention FUSE vectors | Ready to start | Design approved; implement classic FUSE-derived test cases (contended LDIR, border timing loop) with stated tolerance |
| 128K game acceptance | Needs .z80 game file | Boot a 128K .z80 with AY music, verify audioTone reports non-zero |

## Blocked

| Item | Blocker |
|------|---------|
| 128K ROM acceptance tests | 128.ROM not present locally — tests skip |
| tron-on-128K full run | 48.ROM + tron TAP required — test skips |
| vsource PCM via board solver | Adapter readAnalog is stale between advanceTo calls — direct readAnalog stub works; board-level vsource needs adapter-side ADC timing reform |

## Worktree topology — one worker, one tree (2026-09-03)

Set up after a directory-scoped revert in a SHARED worktree destroyed an
agent's uncommitted work. The tree was shared by four workers; the incident
was not bad luck, it was the topology.

| Worker | Tree | Branch |
|---|---|---|
| support chips, cards, presets | `/mnt/volume1/code/bw-board` (main checkout) | `feat/i8086-support-chips` |
| 8086 integration + DOS/debug/corpus (+ its dispatched agents, each in its own throwaway tree — see below) | `/mnt/volume1/code/wt/bw-board-i8086` | `feat/i8086-tier` |
| assembler + MASM oracle | `/mnt/volume1/code/wt/bw-i8086-asm` | `feat/i8086-asm` |
| BIOS ROM + DOS image | `/mnt/volume1/code/wt/bw-i8086-bios` | `feat/i8086-bios` |
| review / verification | `/mnt/volume1/code/wt/bw-i8086-sim3` | `feat/i8086-review` |

A worktree is **8.3 MB** here — `node_modules` is a symlink to the main
checkout's, not a copy — so there is no cost argument for sharing one. To add:

```bash
cd /mnt/volume1/code/bw-board
git worktree add -b <branch> /mnt/volume1/code/wt/<dir> <base>
ln -s /mnt/volume1/code/bw-board/node_modules /mnt/volume1/code/wt/<dir>/node_modules
```

**THE CONSEQUENCE TO PLAN FOR, not to discover: git refuses to check out one
branch in two worktrees.** Separate trees therefore FORCE separate branches,
which turns integration from "we are all already on it" into an explicit merge
by whoever owns `feat/i8086-tier`. That is the cost, and it buys the property
that no lane's uncommitted work is reachable from another lane's `git checkout`,
`git stash` or `git add -A`.

### The rule is one WORKER, not one session — and an agent is a worker

At the moment this table was written `wt/bw-board-i8086` held FOUR workers, not
one: this session and three agents mid-write. Sessions were separated because
sessions were what collided visibly, but the work that was destroyed belonged to
an AGENT, and the mechanism does not care which kind of worker holds the file.
Separating only the sessions fixes the instance and leaves the class.

The structural close is per-agent isolation at dispatch, not another tree in the
table. There are two mechanisms and WHICH ONE IS AVAILABLE DEPENDS ON THE
SESSION, which is worth knowing before relying on either:

- `isolation: "worktree"` on the Agent tool puts each agent in a fresh worktree
  and removes it again if the agent changed nothing. It requires the DISPATCHING
  session's working directory to be inside a git repository. A session whose cwd
  is elsewhere -- the coordinating lane's cwd is `/mnt/volume1/code/lego`, which
  is not a repo -- gets `Cannot create agent worktree: not in a git repository`,
  and no amount of intent fixes it.
- Otherwise the brief must TELL the agent to make its own worktree, as the first
  instruction, with the `git worktree add` + symlink recipe inline. An agent has
  a shell; this is not a lesser mechanism, only a manual one, and it has the
  advantage that the branch name is chosen deliberately rather than generated.

**From here every dispatched agent gets one or the other.** This paragraph was
first written claiming only the first, by a lane that could not actually use it
-- recorded because a rule that names an unavailable mechanism reads exactly
like a rule that is being followed. The named trees in the table stay useful for the LANES —
somewhere for a lane's work to accumulate across several agent rounds — but they
are not what keeps two concurrent agents off each other's files.

The three agents in flight when this was written were left in place rather than
moved: an agent mid-write is exactly what must not be moved, and that is the same
reasoning as the migration rule below. They were committed by path the moment
each reported. That is the transition, and it is a one-time exception with an end
condition, not a standing carve-out.

**Migrating live work: do not move files.** `git diff > /tmp/x.patch` in the old
tree, `git apply` in the new one, and leave untracked files to a plain `cp`.
Better still, let an agent COMMIT what it has before it moves — the hazard being
fixed here is uncommitted work in a shared tree, and carrying uncommitted work
between trees by hand is the same hazard with extra steps.

## Standing rules

- Push both branches (master + main) at every checkpoint
- No positioning in committed content
- `free -m` before anything heavy
- mna.js/board.js core paths are coordinator-only
- Assert the property, not the symptom
- Do NOT deploy Vercel (rate-limited ~24h); GH Pages is the deploy path
- ATtiny85/88: PC masks modulo flash size (d242855) — any 8K-or-smaller part
- **Revert by explicit PATH, never by directory, in a shared worktree.**
  `git checkout -- src/` took an agent's uncommitted assembler work on
  2026-09-03: five workers share this tree, and a directory-scoped revert from
  an unrelated lane is enough to destroy anything uncommitted in it. Git keeps
  no copy. The precaution that had been holding was checking
  `git status --short src/` was clean before each mutation, and it was dropped
  once the mutations became routine — so the rule is the explicit file list,
  not the reminder to be careful.
  - Restore a mutated file by copying a backup over it, not by asking git.
  - Diagnosing this: `git checkout` does NOT rewrite a file whose content
    already matches the index, so a clean file's mtime does not move. A file
    whose mtime lands inside the checkout's window is therefore one git WROTE,
    which means it was dirty. Verified by experiment, twice, independently.
  - **The transferable habit, and it is narrower than it first looked: when a
    timestamp is your evidence, establish what the tool does to an UNTOUCHED
    file before you read anything into the timestamp.** The first account of
    this incident said the reasoning had been "backwards"; that was
    self-reproach rather than a finding, and the other lane corrected it.
    "Inside the window" and "outside the window" are BOTH consistent with
    innocence until you know that git leaves a clean file alone — so the
    reasoning was UNDERDETERMINED, not inverted, and no amount of care would
    have fixed it. One command would. The general form is a habit you can
    follow; "do not argue where you can measure" is only a mood, because it
    does not tell you what to measure.
- **Commit an agent's work the moment it reports, by path.** The work above was
  exposed only because it was being allowed to accumulate while its agent
  finished. `git add -A` is the other half of the same hazard: it swept one
  agent's work into another's commit message earlier the same day.

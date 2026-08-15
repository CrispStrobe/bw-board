# bw-board handoff — 2026-08-15 (bw-blocks lane, session 11)

**bw-board: 1850 tests, 0 failures (16 skips, all firmware-dependent).**
**sb3-creator: 469 tests (25 oracle + 400 corpus + 44 gallery-e2e), 0 failures, 0 skips.**

## bw-blocks lane: what was done this session

### Palette families (bw-board)

- **Controller panel UI layer** (`3f475a7`): `src/controller-extension.js` (Scratch extension, 5 blocks: controllerValue/X/Y/Pressed reporters + setWidget command, dynamic WIDGETS menu, i18n en/de/fr), `src/controller-stage-view.js` (stage-view descriptor for brickwright-lite: render hints, enter/exit lifecycle, serialize/restore), 16 integration tests in `test/controller-integration.test.js`. All exported from `src/index.js`.

- **Datalogger** (`b233494`): `src/datalogger.js` (DataLogger class, named time-series, ring-buffer 10K cap, CSV export single+multi-series with sample-and-hold, JSON persistence), `src/datalogger-extension.js` (7 blocks: log/clearSeries/clearAll/latestValue/entryCount/seriesCount/seriesNames, auto-creates logger on first call, publishes to vm.runtime.dataLogger). 25 tests in `test/datalogger.test.js`.

- **Environment-stimulus** (`b233494`): `src/stimulus-catalogue.js` (STIMULUS_CATALOGUE: 25+ device kinds → world-facing params with labels, ranges, units, mechanism), `src/stimulus-extension.js` (set/get stimulus blocks, dynamic PARTS/PARAMS menus from board parts, routes through setControl or setPartParam). `src/board.js` gained `setPartParam()`/`getPartParam()` public API. 24 tests in `test/stimulus.test.js`.

### Referee vocabulary (sb3-creator)

- **Servo/motor/595** (`bbb3374`): 7 opcodes in KNOWN. New `devices[]` trace channel (servo angle, motor speed/dir, shift_out value+pin edges). `nameInput()` for device-name extraction from type-12 inputs. compareTraces() compares device events. 7 tests.

- **settone** (`7c60379`): `stc12_settone` opcode, new `tones[]` trace channel, ±5 Hz comparator tolerance. 3 tests.

- **String/list/math** (`44ab440`): 12 opcodes — `operator_letter_of`, `operator_length`, `operator_contains`, `operator_mathop` (14 math functions), `operator_random` (deterministic midpoint), 7 list ops (`data_addtolist/deleteoflist/insertatlist/replaceitemoflist/itemoflist/lengthoflist/listcontainsitem`). List state tracked in `trace.lists`. 7 tests.

- **partStimulus timeline** (`44ab440`): `opts.partStimulus` accepts `{tMs, part, param, value}` for sensor world-params (distance, touch, g-vectors). `partStimAt()` lookup. Ready for campaign sensor examples.

### Corpus raise

60 device seeds (12 tone, 15 servo, 12 motor, 23 shift_register) + 57 list seeds across 200 total. All parse clean with no unsupported opcodes.

### Engine bug fix (bw-board)

- **_recordBuzzerEdges** (`2b961fa`): fixed `||` short-circuit that only checked terminal `a` — VCC→a wiring masked the MCU on terminal `b`. Now iterates both terminals. Unblocked 07-buzzer-siren.

### Gallery-e2e skip closures (sb3-creator)

- **08-led-chaser-595 + 20-shift-register-binary**: shift_register added to TERMINALS map. Tests unskipped with real assertions (circuit loads, parts found).
- **07-buzzer-siren**: unskipped after _recordBuzzerEdges fix. Test toggles pin at 440 Hz, asserts buzzerTone reports ~440 Hz.
- **Wired-machine extraction** (`151a662`): 4 new tests — eater6502-bench (zero refusals), eater6502-contention-bug (asserts "bus contention" + named $address), z80-bench (zero refusals), eater6502-vdp-hello (zero refusals).

**Gallery-e2e: 44 pass, 0 fail, 0 skips. BLOCKED dict is empty.**

### Audit resolution (sb3-creator)

- EXPECTED.md updated: pc19 buzzer-DC (now reports {hz:2400, on:true}), pc20 RGB composite (note updated), 33 inductor henrys note removed.
- AUDIT/pc13-pc24.md: escalations E1 (NPN saturation `c378bb0`), E2 (buzzer DC `39b0c10`), E3 (RGB composite `39b0c10`) all marked RESOLVED with commit hashes.
- AUDIT.md: henrys/windingR bug marked RESOLVED (`2e95d6e`).

## Artifact locations

| Artifact | Repo | Path |
|----------|------|------|
| Controller extension | bw-board | `src/controller-extension.js` |
| Controller stage view | bw-board | `src/controller-stage-view.js` |
| Controller binding | bw-board | `src/controller-binding.js` |
| Datalogger engine | bw-board | `src/datalogger.js` |
| Datalogger extension | bw-board | `src/datalogger-extension.js` |
| Stimulus catalogue | bw-board | `src/stimulus-catalogue.js` |
| Stimulus extension | bw-board | `src/stimulus-extension.js` |
| Trace oracle (referee) | sb3-creator | `src/utils/traceOracle.js` |
| Corpus generator | sb3-creator | `test/corpus-generator.test.mjs` |
| Gallery-e2e | sb3-creator | `test/gallery-e2e.test.mjs` |
| Oracle tests | sb3-creator | `test/trace-oracle.test.mjs` |

## Blocked / not started

| Item | Blocker | Notes |
|------|---------|-------|
| Arduino CC0 campaign porting (73 sketches) | Not started | Doctrine in `reference/arduino-cc0-campaign.md`. Referee vocabulary for strings/lists/math/sensors is now ready. |
| ADXL335 / Memsic2125 device models | Coordinator (new device kinds) | Campaign doc says coordinator takes these |
| Orientation/tilt input face | bw-circuit-ui | ONE contract, three consumers (adxl335/memsic2125/mpu6050) |
| Custom-sprite-art → Costumes tab | bw-bundle | UI task, outside bw-board scope. Research done: button at pseudocode-importer.jsx:1059, flow at 1080-1192 |
| partStimulus in corpus generator | Needs device-model examples first | Timeline plumbing ready, no generator seeds yet |

## Standing rules

- Push at every checkpoint. Notify blocked agents by name when you clear their blocker.
- No positioning in committed content. Licence audit names are kept.
- `free -m` before anything heavy. Check `~/.cache/ms-playwright` before installing.
- Assert the property, not the symptom. A check that has never failed has not been shown to work.
- Nothing has run on real silicon. Categories 1/2/3 per `stc/docs/EVIDENCE-CATEGORIES.md`.
- mna.js/board.js core paths are coordinator-only. Helper methods (setPartParam, _recordBuzzerEdges) are ok.

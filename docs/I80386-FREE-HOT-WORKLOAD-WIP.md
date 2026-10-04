# Longer free 386 workload: checked JavaScript baseline

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

This separately owned 64 KiB reset ROM retains the paging, two-fault, PIT/PIC,
REP and eight RAM/A20 witnesses from the earlier fixture. It then masks the
PIC through guest port output and executes 20,000 arithmetic iterations and
4,096 ordinary-RAM counter iterations in protected 16-bit code. Independent
expected results are 200,010,000, 20,001 and 4,096. It emits `RPGH001` and halts.
The previous ROM, native admission rules and 300/600 per-resume caps remain
unchanged. This new ROM is not admitted by the existing native adapter.

Two fresh actual JavaScript-board runs at clean source
`530891c4a4020ff837d359376f1b3496c7ea17a6` bind all 47 measured inputs and
produce byte-identical captures and journals. They complete 100,682 successful
work quanta, 100,684 attempts and 604,096 board clocks, with two page faults,
one IRQ, the original eight witnesses, correct loop checksums and settled
device debt. This is the existing compatibility CPU profile.

The [actual capture](receipts/2026-10-01-i80386-js-hot-baseline-capture.json.gz),
[compact ordered journal](receipts/2026-10-01-i80386-js-hot-baseline-events.jsonl.gz),
[result](receipts/2026-10-01-i80386-js-hot-baseline-result.json) and
[independent root audit](receipts/2026-10-01-i80386-js-hot-baseline-root-independent-audit.json)
retain the evidence. Root authenticates every historical/current input and
assembled ROM, replays all 16,743 writes with A20 decoding into the complete
16 MiB backing, and independently checks arithmetic at every loop entry.
Its 537,996 checks match the complete final RAM hash. The journal contains
117,456 records, 7,048,758 bytes, under an explicit 32 MiB evidence bound.

Ten mandatory tests use hash-pinned, lossless historical actual fixtures with
no external environment requirement. They cover assembly boundaries and six
mutants of the parsed baseline. The test fixtures retain their original f05b156e
capture identity; the final 47-input capture is a separate source-bound run.
Run `node --test --test-concurrency=1 test/i80386-free-combined-hot.test.mjs test/i80386-free-combined-hot-proof.test.mjs` as one command. From a clean
checkout, `node scripts/run-i80386-free-combined-hot.mjs /absolute/new-output`
creates a new actual baseline; the directory must not already exist.

This records selected architectural and whole-board boundary snapshots,
committed-work progression, ordinary writes, PIO and deliveries. It does not
record every instruction fetch or data read, or establish independent CPU
oracle equivalence. Per-step synchronous journal writes add diagnostic cost;
these runs are not throughput measurements. Six functional board clocks per
quantum do not establish physical 16 MHz 386 RTx.

Next is a separately authenticated native hot profile with explicit total
150,000-quanta/160,000-tick limits, while retaining the existing per-resume,
page, typed-span and before-effect guards. Native/JS architectural and RAM
parity, native budget/capture parity, bounded streamed evidence and timer/PIC
checks precede comparable capture-disabled measurements. broader guest, broader game,
unrestricted native execution and production GUI integration remain separate
unfinished work.

The separately admitted [native hot-workload follow-up](I80386-NATIVE-HOT-WORKLOAD-WIP.md) now records actual long-guest parity, trace transport failures and fixes, and equivalent capture-disabled timing. The original short native profile remains unchanged.

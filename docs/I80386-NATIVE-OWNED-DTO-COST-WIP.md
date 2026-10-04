# Native snapshot DTO cost — source-only rejection

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The first saved-data structured-snapshot cost experiment replaces JSON replies with worker-cloned values and a strict descriptor-based validator. It failed the preliminary saved-data cost screen and stopped before native execution. H4 remains the baseline; the earlier [native clock-batching CPU gate](I80386-NATIVE-OWNED-CLOCK-WIP.md) remains failed.

The authenticated input is the already-published ABI3 capture from `cpu/8-ABI3`, SHA `246193ed7da4c872df55ddf7593b189f3966f55c45a8e06ef40382efc1b840fe`. Eight native values (reset, six checkpoints and final) and seven board values passed source-only positive validation. Each of three rounds retains 200 loops over all values; there was no dedicated warmup, no predeclared adoption gate and no discarded round. Round-zero/JIT effects remain visible.

CPU microseconds per payload, with all three rounds retained:

| Payload and operation | Round 0 | Round 1 | Round 2 |
| --- | ---: | ---: | ---: |
| Native JSON serialization + parse | 123.338 | 73.221 | 67.952 |
| Native clone | 56.678 | 52.004 | 47.812 |
| Native clone + strict validation | 313.221 | 251.463 | 237.329 |
| Board JSON serialization + parse | 226.156 | 178.609 | 196.307 |
| Board clone | 151.037 | 124.321 | 132.023 |
| Board clone + strict validation | 829.251 | 773.151 | 767.276 |

This is a local saved-payload comparison on the VPS, excluding actual Worker IPC, queues, native execution and device callbacks. BigInt/typed-byte restoration from saved JSON occurs outside the timed loops, because NAPI already produces those types. Clone alone is cheaper here, but adding full descriptor admission outweighs that saving in every round. These numbers are not guest throughput, a native speed gate or physical-386 RTx.

The original comparison bound its saved input but did not retain execution-time script pins or an exit receipt. Actual stdout matches all eighteen recorded cells and stderr is empty; independent review records contemporary script/schema hashes. Those post-hoc hashes must not be promoted to proof of exact execution bytes. [Lossless local comparison results and the independent audit](receipts/2026-10-02-native-owned-dto-cost/index.json) preserve this limitation.

The following source-only experiment narrowed admission to the actual private Worker receive boundary. A closed producer and structured clone can establish copied data without proxies, functions or accessor descriptors. Clone still preserves sparse holes, cycles and internal aliases and permits some shared/resizable values: exact shape, dense indices, primitive domains, bounded traversal, backing checks and protocol sequencing must remain. A dedicated receive validator can avoid allocating a descriptor object for every array element; it cannot accept arbitrary caller objects or caller-supplied trust brands. Actual MessageChannel controls and a source-pinned cost comparison must precede any complete runtime candidate. No addon, guest, build or paired native benchmark is admitted by this proposal.

## Lighter receiver schema and complete message path

The receiver-only validator passed **39 source controls** (23 strict raw-value controls and 16 actual MessageChannel controls). The later experiment bound scripts, schema, fixture, helper and input before and after execution, retaining commands, successful exits and exact process streams. Its native payload-only JSON costs were 87.278/70.422/66.157 µs versus 107.435/59.851/56.414 µs for clone plus the lighter value schema. Board payloads remained slower in every round. Those local payload timings exclude envelope, ledger, request parsing and actual message delivery.

The next diagnostic included request JSON creation/parsing, sender response encoding, actual same-process MessageChannel delivery and receiver envelope/schema/cap/delta/primitive-ledger checks. It repeated the authentic zero-work terminal snapshot 200 times per protocol in each of three alternating rounds. This is a payload exercise, not guest instruction chronology or full private Worker/factory behavior. All rounds remain, with no dedicated warmup or discarded sample.

| Protocol CPU per message | Round 0 | Round 1 | Round 2 | Mean |
| --- | ---: | ---: | ---: | ---: |
| Existing JSON reply | 281.640 µs | 115.480 µs | 143.590 µs | 180.237 µs |
| Object DTO reply and admission | 310.625 µs | 210.685 µs | 211.690 µs | 244.333 µs |

DTO cost was **35.56% higher overall**, with all three rounds unfavorable. Development stopped before native integration or complete factory/provenance admission; isolated unfinished copies are not published as a backend. This supersedes the tentative payload-only saving as a reason to pursue this particular object format, while making no guest-performance claim.

The subsequent bounded source-only experiment used a fixed-layout packed Uint32Array message, with exact version/kind/length/backing checks and lossless preservation of all existing architecture words, counters, mapping, resume fields and slice bytes. Encode, decode, ledger checks and channel delivery must all enter the cost comparison. The packet itself does not admit caller boards, arbitrary objects, shared/resizable backing or a new native ABI. Source roundtrip and malformed-packet controls must precede any native work.

## Packed packet rejection

The separate packet uses 196 words for a base snapshot and 240 for a resume: five header words, 166 architecture words, native tick/work and mapping/A20 words, all 21 bounded counters, plus resume fields and 160 byte-packed slice bytes. Thirty source controls passed. The final cost comparison included sender primitive-domain checks before narrowing, one domain-checked decoder, reconstructed complete snapshot values, envelope/cap/ledger checks and actual MessageChannel delivery. Before/after source/helper/input identities matched and final snapshot values matched the authentic payload.

| Final comparison CPU per message | Round 0 | Round 1 | Round 2 | Mean |
| --- | ---: | ---: | ---: | ---: |
| JSON | 191.620 µs | 213.600 µs | 177.875 µs | 194.365 µs |
| Object DTO | 347.835 µs | 212.475 µs | 314.810 µs | 291.707 µs |
| Packed packet | 489.990 µs | 803.625 µs | 238.605 µs | 510.740 µs |

Packed packets cost **162.77% more CPU than JSON**, with every round unfavorable. This final source-only comparison retains 200 repeated terminal payloads per protocol per round and excludes real native CPU, private Worker scheduling and board progression. The object DTO numbers here belong to this same three-protocol run; they do not replace or splice into the earlier comparison. Neither transport candidate proceeds to runtime integration or a guest speed gate.

The first packet attempt stopped on JSON property ordering in its parity assertion; lossless decoded values were compared independently of object-key serialization order in the next attempt. That intermediate comparison lacked necessary sender checks before Uint32 narrowing and is not final candidate-cost evidence. Both are preserved separately. The final sender checks reject wraparound aliases. One source limitation remains: the encoder reads a shadowable typed-array slice length, so an artificial own-property shadow can hide a short source slice. The authenticated measured payload has an ordinary exact 160-byte slice and is unaffected, but this prevents claiming general packet admission. No repeat was run to seek a faster result or to relabel changed source.

## Next architectural experiment

The next source-only candidate keeps execution and the fixed-ROM scheduler in a closed fresh child process on its main thread, using the unchanged ABI3 addon and private provider. It removes the internal Worker message path instead of substituting another payload format. Native initializing-thread/environment, singleton, reentry, fault, mapping and clock guards remain; every native snapshot and all six checkpoints still occur. This changes the ownership topology and needs a new proof.

The trusted boundary is an authenticated fresh child entry and import closure, with a pinned launch command/environment and no Node or native preloads. Main-realm lexical closure is not Worker isolation or protection against arbitrary preloaded code. The old worker loader/factory remain unchanged. Separate records must bind the original compiled source/addon and the new JavaScript driver; no old measurement or compilation revision can be relabeled. Source controls and review come first, followed only when admitted by actual native parity/lifecycle checks and a predeclared paired CPU gate. Full AT boot, broader guest/broader game and general CLI/GUI integration remain outside this fixture.

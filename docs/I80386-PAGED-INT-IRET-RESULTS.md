# Paged INT/IRET correctness result

The single owned fixture in [run 37247392133](https://github.com/CrispStrobe/bw-board/actions/runs/37247392133), attempt 1, passed its native/JS differential and independent saved-evidence audit. It enters strict 386 protected mode, enables ordinary 4 KiB paging, executes from a nonidentity code mapping, delivers software `INT 30h` through a same-CPL 16-bit interrupt gate, writes the real six-byte frame through a nonidentity SS stack mapping, executes the handler and returns with `IRET`. It stops before HLT. This finite result does not qualify a general OS loader or establish a speed result.

The [first actual attempt](../scripts/bochs-cpu3-native-paged-int-iret/FIRST-EXECUTION-FAILURE.md) remains FAIL. Bochs initialization was observed, but its final JSON size assertion lost the capture and any original divergence, leaving instruction, parity and native closure extent unknown. The successful run uses the separately reviewed lossless evidence transport. Its complete logical receipt is **23,559,031 bytes**, exceeding the former 16 MiB JSON-file cap; the single-member gzip is **509,752 bytes** and fits the unchanged 16 MiB worker file cap. This retained body does not reconstruct the original missing receipt.

## Frozen source and artifact

| Role | Exact identity |
| --- | --- |
| Hosted source | `d46b68c201628a05f5f9934ada7fdddd3a57e683`; 12 tooling files |
| Driver | `98fb8216aa5bd0fa046cc6388f7ff6c1b22f5750`; 81 authenticated source files |
| Compilation source | `4a4ec3c92a67c4db6d3bd361f9456d2be144a13c`; 208 source files |
| Static build | [run 37218196080](https://github.com/CrispStrobe/bw-board/actions/runs/37218196080), artifact `11309320742`; 820 prepared files |
| Native addon | `92a5121df194c6675303913ebd527e7d0253e29e686b2cbd8dd91fb579489b6f`; 2,074,512 bytes, ABI 4 |
| Official execution artifact | `11319662434`; 101 members; ZIP 10,763,002 bytes, SHA256 `01fe2bd1bd151ad25328d294b7e50f24f7d27c2538994c896964980e578bab69` |
| Compressed receipt | SHA256 `1a8ab0e64d714b0c7868fe91ad1ff50bae1daf74d1a88ba73ff4e16fc7b40024` |
| Decoded logical receipt | SHA256 `8c4a059a86cf393a8dbba7254da2d9db52f6a1dc267a38ff5cd82dccef5d7c3d` |

[Compact records and exact external origins](receipts/2026-10-05-paged-int-iret-results/index.json) retain the official descriptor, raw outcome/exit/streams, saved-audit commands and reports, and a labelled lossless projection of the final CPU and actual memory tapes. The full repeated snapshots and pages remain in the sole official ZIP rather than a second archive in Git. The governing [independent audit](receipts/2026-10-05-paged-int-iret-results/independent-audit.json) has SHA256 `dda45a49db8e68cc1be0d798be11335d26e85c791e59f1097f00688ac7ac7597`.

## Actual coverage

The native run completed **41 N / 41 Q**, 41 resumes and zero zero-Q returns. All **43 returned boundaries** retain complete 166-word native snapshots. Every CPU field represented by the JS model was compared strictly; native-only descriptor/cache fields were retained and separately checked against source-owned expectations. This is not a claim that all 166 native words have JS counterparts.

Of those boundaries, **41 were comparable** and passed full board plus ten complete 4096-byte physical-page equality. The two declared PG-enable/far-jump entry boundaries remain **UNMATCHED**: they retain both boards and all ten pages but compare only the declared phase-independent CPU/NQ state. The 41 staged records likewise remain explicitly unmatched. The fourteen named cuts comprise twelve comparable and two unmatched cuts; no retrospective page-parity label was added to the unmatched records.

At Q 39, the real native interrupt writes were FLAGS `0002` at physical `CFFE`, CS `0018` at `CFFC`, and return IP `7005` at `CFFA`. The resulting physical frame bytes are `05 70 18 00 02 00`. The linear stack uses `D000 → C000`; the `D000` physical alias stays poisoned. `IRET` restored ESP `E000`, CS:EIP `0018:7005` and EFLAGS `00000002`. The handler preserved the upper half of EAX, yielding `8000BEEF`. CS, DS and SS descriptor rows remained strict, including SS.valid `1 → 7` after the first real frame write. The JS MOV SS shadow at Q 33 and its consumption by MOV SP at Q 34 are separately retained; the native inhibition policy is source-attested rather than an ABI claim of identical shadow fields.

The actual provider tape contains **52 successful callbacks: 23 reads and 29 writes**. Its writes are twenty boot stores, three real frame words and six native accessed/dirty updates. The native A/D effects below use the observed pre-return N/Q labels, not guessed instruction retirement order:

| Entry physical address | Before → after | Native pre-return N/Q |
| --- | --- | --- |
| `1000` | `00002003 → 00002023` | 36 / 36 |
| `23C0` | `000F0003 → 000F0023` | 36 / 36 |
| `2000` | `00000003 → 00000023` | 36 / 36 |
| `201C` | `0000A003 → 0000A023` | 37 / 37 |
| `200C` | `00003003 → 00003023` | 38 / 38 |
| `2034` | `0000C003 → 0000C063` | 38 / 38 |

The JS reference has seven A/D updates because it records stack A and D separately; native records one combined stack transition. Native FLAGS/CS/IP push order and JS IP/CS/FLAGS order are independent tapes. The audit checks their real values, resulting pages and frame effects without forcing callback chronology or generation counts to match.

The final settled board and all ten pages matched. Whole physical RAM matched by SHA256 `0110baad6cfc99e56a04d07d0cf5cf9d8d7ab2e85f24721b980226cb79a674a6`; whole RAM bytes are not retained. Page copies are actual host-provider RAM backing, with native cache/ownership coherence enforced by the authenticated source policy. They are not a separate native-memory dump. PIO, external IRQ, faults, fallback and HLT remain outside this fixture; none occurred. Native, provider and JS objects all closed successfully. All six input/source/build/configuration/Node authentication pairs were present and unchanged, as were hosted/restored before/after maps and the original static-build ZIP.

The saved-evidence audit checked official bytes and one complete gzip member with exact decoded/stored lengths and hashes, then applied the unchanged driver parity functions to saved records and the authenticated JS reference. It executed no CPU instructions, restored nothing and loaded no addon. Page-fault error delivery, handler repair and instruction retry remain the next separately reviewed fixture.

# Paged page-fault recovery: private JS source control

The owned strict-386 fixture at `75be9c4aaa9fe08ff2adbffa47ff8cc1335b19d2` now has an independently audited private JS model result. It performs a genuine supervisor-write page fault, repairs the PTE through ordinary instructions, reloads CR3, discards the actual error word, IRETs and retries the same store exactly once. This is a source/model checkpoint. Native page-fault policy, a new build/DSO and differential execution remain unqualified. The prior [native INT/IRET result](I80386-PAGED-INT-IRET-RESULTS.md) is a separate unchanged fixture.

The program uses CPL 0, code16, a present type-6 vector-14 gate, 4 KiB pages and IF clear. Linear code 7000 maps to A000, data 8000 is initially nonpresent and later maps to B000, and stack D000 maps to C000. Poisoned physical aliases remain unchanged. At 18:7003, the first store faults with error 2 and CR2 8000 without changing B000. The genuine eight-byte frame at CFF8 is `02 00 03 70 18 00 02 00`: error, restart IP 7003, CS 18 and flags 2.

The handler installs B003 at PTE 2020, executes a legal strict-386 unchanged CR3 reload, adds 2 to SP to discard the error, then IRETs to the same store. That store commits 1234 once, and the following instruction reads it into CX. The program stops before HLT at 18:700A. INVLPG is absent. CR3 reload is exercised; this nonpresent-page recovery does not establish stale-positive-translation invalidation.

The first external wrapper remains **FAIL**: a negative test-name selection also matched the file ancestor and ran all seven cases rather than its expected six. All seven actual child cases passed, including the genuine program, but no full capture path had been requested. Raw streams, summary and independent review remain intact. This is neither seven assertion failures nor a retrospective wrapper success.

Root separately approved one positive exact-name invocation to retain the genuine program's full capture. Only that one case ran and passed; the six other cases were not repeated. The saved-data audit verified:

- 57 attempts, 56 completed Q, 58 frames and 19 named cuts. The fault attempt at ordinal 50 completed zero Q; completed Q stayed at 49.
- Ten complete 4096-byte physical pages at every frame and the settled frame: 2,416,640 reconstructed byte comparisons.
- 31 boot stores, four genuine frame stores, one ordinary PTE repair, one successful retry store and eleven independently recorded JS A/D updates.
- Real CR3 translation-generation change 5→6, ADD flags 86, restored flags 2 and actual IRET IP/CS/FLAGS reads.
- Final EAX 80001234, CX 1234, EDX 1000, ESP E000 and CS 18:700A; CR2 8000, CR3 1000, CR4 zero and unchanged poison aliases.
- Exact 51 current/Git source paths and tool before/after equality, child exit/wait status zero, no timeout and empty stderr.

The external capture is 5,913,156 bytes, SHA256 `6ea098a534da4681cdbb3bcaadf6918a9ed4a882ab230d87ff16c394e00803c7`. Whole-RAM SHA256 is `041d1251872170fe2369dbcda00cd2959a6cbd13a32091be43f57be65df1bc94`; whole-RAM evidence is hash-only, while the ten copied pages are retained completely. The [compact records](receipts/2026-10-05-paged-pagefault-js-source/index.json) bind both raw outcomes, exact external origins and a labelled selection of actual saved fields. They omit the large full capture.

Profile, oracle and test code remain byte-identical to executed 75be9c4. The [source note](../scripts/bochs-cpu3-native-paged-pagefault/SOURCE.md) describes the fixed encodings, attempt/completion distinction and pending native FAULT/cache phases. The result does not establish native cache behavior, native callback order, broader software compatibility, physical 386 calibration, performance or adoption.

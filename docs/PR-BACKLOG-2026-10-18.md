# PR backlog reconciliation — 2026-10-18

Initial default: `847d1d8aa46c9180bae0f905168577eacdcadd84` (`master`).
The initial inventory contains **87 open drafts**, eight targeting master and
79 targeting other feature branches. They reduce to ten leaf tips: #423, #424,
#425, #427, #445, #454, #506, #525, #557 and #645. No original PR head is an
ancestor of the initial master; this is not an already-merged-PR sweep.

## Integration contract

The user requests consolidation and landing, including retirement of obsolete
work. Compose the dependency tips in isolated branches, preserving their source
history and current master. Review CPU changes separately from inert diagnostic
sources. Use current full CI once per final combined source batch rather than
requalify every intermediate stack. Preserve historical failed originals and
consumed one-shot events; do not rerun experiments, change default runtimes or
activate diagnostics just to close a draft. Source integration does not imply
performance, guest or hardware qualification.

Planned groups:

- Cold/native diagnostic sources: #423/#424/#425/#427. Earlier experiments and
  rejected native performance adoption remain historical; ordinary JS stays the
  default. Review any current-source controls after composition.
- Owned CWSDPMI and fixed-archive tooling: stacks ending at #525, with side tips
  #445/#454. Preserve source bindings, strict refusals and compiler disablement;
  review the opt-in CPU observer delta explicitly against current master.
- Rollback sampler/tool-support sources: stack ending at #506. Preserve all
  baseline failures, inactive adapters and bounded tool/runtime admission.
- Scalar EA candidate #557: actual correctness evidence exists; its declared
  paired performance decision is still outstanding. Do not silently promote it
  as a speed improvement or call it obsolete without an evidenced disposition.
- Ring3 fixture #645: preserve both false activation guards and its outstanding
  runtime/reader/actual-guest gates. Source-only integration must be recorded as
  inactive preparation, never a successful ring transition.

A source integration claim precedes edits. Close each original only after
ancestry/content proof or a documented supersession decision; preserve any
remaining work in this report. Machine paths and private continuation details
belong in gitignored local handoffs.

## Candidate integration (not yet landed)

Claim #649 merged as `27e9f8b34e2bfb2580e415d84946d23a6f22db71`. The isolated
combined branch preserves 86 original PR heads by exact ancestry, using nine
leaf merges; #557 remains separate. This is a candidate, not completed landing
or permission to close the original drafts. Fresh combined-source qualification
is required.

The merge retains all original branches and source commits. The existing CPU observer, two CI workflows and two ledgers change; the
obsolete serial-runner wiring is superseded by current master. Two added unit
entrypoints forward to their unchanged original assertions in fixed retained Git
contexts; other paths are additions. Workflow conflicts keep
both fixed historical source fetches and the current split historical/current
test policy. Ledger conflicts retain both sets of ownership. The current richer
xv6 and DPMI outcome summaries supersede older compile/QEMU-only paragraphs;
the separate QEMU receipt is still retained. The FreeDOS direct-Circuits receipt
was preserved and its old Lite pin explicitly labeled historical.

Existing one-shot labels have not been reapplied, failed experiments have not
been rerun and the ring3 execution guards remain false. No package/consumer pin
or ordinary-JS default is changed. The scalar-EA allocation change is excluded
pending its separate performance decision.

First combined local controls: 275 passed, five failed, zero skipped. Two failures
came from the old cohort planner assuming HEAD still contained its original test
bytes; current master deliberately replaced those inputs with source-context
bridges. The old serial-runner wiring is therefore obsolete. Its complete eight
original controls now run unchanged at retained source `c9a22a1b` instead of
rewiring current CI. The IRQ oracle likewise attests the exact `6fba6812` CPU;
its unchanged original assertion body runs at `8f1be780`, while current CPU
regressions remain separate. The original strict hashes and all negative checks
remain intact. Two other initial failures were caused by editing during a
clean-source test and macOS's `/tmp` alias; final controls require a committed
clean checkout and canonical temporary directory. No native actual is rerun.

## Current qualification follow-up

PR650 is the combined source candidate. The owner's later PR645 checkpoint
`f7d36a07` is also included by normal merge; its 205 inert runner controls and
separate prerequisite/runtime reader controls require Linux qualification.
The macOS runner-control attempt refuses because `os.getresuid` is unavailable;
that is not a passing Linux execution result. Both execution guards and the
additional runtime-inventory guard remain false.

Thirteen historical diagnostic jobs admitted a narrow original PR delta before
running pure mock controls. That source-event admission is not applicable to a
combined branch with current master: the first hosted nursery mock job at
`daa09495` failed its original six-path envelope. Historical admission programs,
original source commits and actual-event paths remain preserved. The current
mock jobs now use `scripts/pr-backlog-current-source.py`, which admits the real
current own-repository PR event and mock job, verifies exact HEAD, refuses dirty
or untracked source, and reads back a bounded inventory of committed source,
tests, workflows and package manifests against Git blob identities. Its distinct
report schema explicitly grants current unit-control evidence only; it cannot
qualify an original event, compiler, native build, CPU run, guest or performance.
All existing mock-control entrypoints/assertions still run. The actual jobs keep
their original source admission and activation conditions; none was enabled.
Six independent refusal/readback controls cover the new boundary.

The user explicitly chose to preserve PR557's performance gate. Twelve address-
decoding correctness tests pass against a local combined-source review, but
that review is not promoted. The separate public code16 fixture result already
recorded in X86-NEXT-LANES does not replace the original private application
workload. Next, locate its original frozen inputs, baseline/candidate and
measurement contract in the ignored local handoff; confirm eligibility without
changing that contract; then obtain and independently audit the original paired
CPU/wall observations. Require median CPU ratio >=1.03, all seven ratios >1,
median wall ratio <=1.02 and exact semantic equality. If the frozen inputs or
qualification are unavailable, leave #557 open and unadopted. Do not substitute
a new microbenchmark, cherry-pick the CPU optimization or describe it as obsolete.

Hosted full CI must pass at the final combined source before landing PR650.
Then recheck live original heads, prove each is an ancestor of remote master,
and retire only incorporated drafts with a backlink and surviving limitations.
Keep any newly advanced owner head open until it too is incorporated.

## Initial PR inventory

Heads and base branches identify the original intake, not future authority.
Refresh exact head/default/checks before merging or closing anything.

| PR | Original base | Original head | Work |
|---|---|---|---|
| [#423](https://github.com/CrispStrobe/bw-board/pull/423) | `master` | `5902e1fca83b7155ef177991d128c2d89ef9424e` | Model cold CPU3 clock authority with separate source and board ledgers |
| [#424](https://github.com/CrispStrobe/bw-board/pull/424) | `master` | `8f1be780b191176ff1d3789b38e2c73e48041198` | Add gated paged IRQ0 native/JS correctness fixture |
| [#425](https://github.com/CrispStrobe/bw-board/pull/425) | `master` | `9198a522965ae35db4aff36aad63655b8a59b6fb` | Add bounded cold direct-RAM inspector diagnostic harness |
| [#427](https://github.com/CrispStrobe/bw-board/pull/427) | `master` | `74ed000b13800725c9f33baa1213ebaf84d3ded6` | Prototype cold direct-RAM empty-journal Map reuse |
| [#439](https://github.com/CrispStrobe/bw-board/pull/439) | `master` | `512501ccdf96ca3f3b05c13d8efdf5fab9cc4aea` | Prepare owned DPMI client and candidate-only dependency inventory |
| [#440](https://github.com/CrispStrobe/bw-board/pull/440) | `lane/386-cwsdpmi-owned-source-20261007` | `eeb95c49ab8dde2a0572f35e90bc41948480c809` | Audit CWSDPMI and DJGPP source and notice candidates |
| [#441](https://github.com/CrispStrobe/bw-board/pull/441) | `lane/386-cwsdpmi-source-notice-20261007` | `86456240558ecf84a3a1d68ccc1306efe68f1633` | Retain missing DJGPP and GCC notice bytes |
| [#442](https://github.com/CrispStrobe/bw-board/pull/442) | `lane/386-cwsdpmi-notice-completion-20261007` | `36124d9231ccc6b750c57c86552fda4f7675dffe` | Add hosted compile-only gate for owned DPMI client |
| [#444](https://github.com/CrispStrobe/bw-board/pull/444) | `lane/386-cwsdpmi-compile-only-20261007` | `64c1cc463ec19d2b8a03df21af2dd4494f7b4497` | Add QEMU-only control for owned CWSDPMI client |
| [#445](https://github.com/CrispStrobe/bw-board/pull/445) | `lane/386-cwsdpmi-qemu-owned-20261007` | `4b493cec8d75ec5a510cf8244c604bec5be566e7` | docs: record owned CWSDPMI QEMU control and AT gate |
| [#446](https://github.com/CrispStrobe/bw-board/pull/446) | `lane/386-cwsdpmi-qemu-owned-20261007` | `e1864c652662667da5098b0171c6b37ffe33449f` | Add source-only CWSDPMI AT loaded-code binding model |
| [#447](https://github.com/CrispStrobe/bw-board/pull/447) | `lane/386-cwsdpmi-at-binding-20261007` | `f5f2996d0b049a5fe6e7c6a369b7ac315676beb6` | Admit fresh CWSDPMI executable and map on hosted CI |
| [#448](https://github.com/CrispStrobe/bw-board/pull/448) | `lane/386-cwsdpmi-at-binding-actual-20261008` | `48d219429492defefd0b2c911bea5e1569e93015` | Model passive AT ordinary-RAM reads for future loaded-code admission |
| [#449](https://github.com/CrispStrobe/bw-board/pull/449) | `lane/386-cwsdpmi-at-loaded-source-20261008` | `b9fc982207e648f8f5b13e69a7ec66d3a6930119` | Record fresh CWSDPMI AT binding parser result |
| [#450](https://github.com/CrispStrobe/bw-board/pull/450) | `docs/386-cwsdpmi-at-binding-result-20261008` | `8ae6ba128b8be2e2a807a5e55530e0d83bae21fb` | Model passive AT loaded-main cut before guest integration |
| [#451](https://github.com/CrispStrobe/bw-board/pull/451) | `lane/386-cwsdpmi-at-loaded-actual-20261008` | `6b7ae1090a6ac23c0ffa66974523c3a5c489aab5` | Add source-bound CWSDPMI AT loaded-main gate |
| [#452](https://github.com/CrispStrobe/bw-board/pull/452) | `lane/386-cwsdpmi-at-loaded-main-gate-20261008` | `052e0b684ca7362300b99b9c609506725347fdf8` | Admit source VGA text route in AT loaded-main gate |
| [#453](https://github.com/CrispStrobe/bw-board/pull/453) | `lane/386-cwsdpmi-at-loaded-main-screen-20261008` | `27ff49068baae8af7c54457c422fbb25a5ecfa2d` | Admit signed CR0 at owned AT loaded-main cut |
| [#454](https://github.com/CrispStrobe/bw-board/pull/454) | `lane/386-cwsdpmi-at-loaded-main-cr0-20261008` | `413b1272f075528e6c71c5ba593060a4d346d776` | Model bounded 80386 interrupt journal transactions |
| [#455](https://github.com/CrispStrobe/bw-board/pull/455) | `lane/386-cwsdpmi-at-loaded-main-cr0-20261008` | `eebec7259b4f6bc5c1ef35982d3affc4dc8c94d4` | Record bounded AT loaded-text mismatch diagnostics |
| [#456](https://github.com/CrispStrobe/bw-board/pull/456) | `lane/386-cwsdpmi-at-loaded-diagnostic-20261008` | `cc5b2ac7a40788f7d0100c4a1b5b5a9996bc2c66` | Prepare bounded owned CWSDPMI AT completion gate |
| [#458](https://github.com/CrispStrobe/bw-board/pull/458) | `lane/386-cwsdpmi-at-completion-actual-20261008` | `6ec767b50008beb53b012dafcf55361de3ffb146` | Add bounded owned high-memory and timer QEMU control |
| [#459](https://github.com/CrispStrobe/bw-board/pull/459) | `lane/386-cwsdpmi-highmem-timer-qemu-20261008` | `41db7ba4a0c96076aa6a5e5c74cd70be2a0ad0d7` | Add source-only high-memory timer AT completion gate |
| [#460](https://github.com/CrispStrobe/bw-board/pull/460) | `lane/386-cwsdpmi-highmem-at-20261008` | `13d82f3116107a1c4d8dff421db747eaa1bfef23` | Add opt-in CPU journal for one owned DPMI allocation frame |
| [#461](https://github.com/CrispStrobe/bw-board/pull/461) | `lane/386-cwsdpmi-0501-frame-journal-source-20261008` | `4457eac39de441fdff93f0eeaf05a4e4a7826b64` | Prepare private 0501 wrapper admission and controller policy |
| [#462](https://github.com/CrispStrobe/bw-board/pull/462) | `lane/386-cwsdpmi-0501-frame-at-controller-20261008` | `8b82bde41f2fffff07279834a333a47bcd8f5a7f` | Connect owned allocation-frame policy to a pinned AT adapter |
| [#463](https://github.com/CrispStrobe/bw-board/pull/463) | `lane/386-cwsdpmi-0501-frame-at-driver-20261008` | `c968428d4d478ae115b8e9cb1065f8a349b7ccbe` | Retain allocation-frame progress and prepare exact hosted gate |
| [#464](https://github.com/CrispStrobe/bw-board/pull/464) | `lane/386-cwsdpmi-0501-frame-at-actual-gate-20261008` | `4c22a574ec50a515fe4954a3fda0ff6a947a5068` | Fix allocation-frame observer for the real CPU cache shape |
| [#465](https://github.com/CrispStrobe/bw-board/pull/465) | `lane/386-cwsdpmi-0501-frame-at-reference-fix-20261008` | `0714159c9875ac17bf5ef5a8e5418f5815fa1608` | Retain bounded AX=0501 delivery rejection facts |
| [#466](https://github.com/CrispStrobe/bw-board/pull/466) | `lane/386-cwsdpmi-0501-frame-delivery-diagnostic-20261008` | `1ecb987b86217c7c549fffc1d3b7ff498898b9dd` | Observe exact mixed-width DPMI 0501 frame |
| [#467](https://github.com/CrispStrobe/bw-board/pull/467) | `master` | `3269cf1f2e0c009d8e0a331aa93bee498863bc2a` | Add bounded xv6 rollback allocation diagnostic |
| [#468](https://github.com/CrispStrobe/bw-board/pull/468) | `lane/386-cwsdpmi-0501-frame-mixed-20261008` | `f3b8b31d6e403020089f1dee31eaece45c06ac25` | Record owned AX=0501 task-switch attempt facts |
| [#469](https://github.com/CrispStrobe/bw-board/pull/469) | `lane/386-xv6-js-rollback-profile-source-20261008` | `f2971d8ae7bd67a30f13baa45b63956790d9b975` | Bound minor GC support control before xv6 sampling |
| [#470](https://github.com/CrispStrobe/bw-board/pull/470) | `lane/386-0501-task-attempt-20261009` | `15afcd6ba9dd1b494c343c6af6307bcf324b0ebd` | Record bounded owned 0501 task-switch core outcomes |
| [#471](https://github.com/CrispStrobe/bw-board/pull/471) | `lane/386-xv6-js-rollback-profile-support-20261009` | `ff2b916e1899d6042f9b1a3e2701ea1ec4f708d7` | Add source-only direct V8 rollback sampling support |
| [#472](https://github.com/CrispStrobe/bw-board/pull/472) | `lane/386-0501-task-outcome-20261009` | `d1ca2763ce30dc91df0c29e888590ab1d8135256` | Stage bounded DPMI task excursion diagnostics |
| [#473](https://github.com/CrispStrobe/bw-board/pull/473) | `lane/386-xv6-js-rollback-direct-v8-source-20261009` | `869c3c72cb40b66c135621f297eb66638166b69d` | Add report-only direct V8 authority preflight |
| [#474](https://github.com/CrispStrobe/bw-board/pull/474) | `lane/386-0501-task-excursion-20261009` | `89eadb8c2449ff769b157ee6a4b78ccb833c3610` | Observe bounded AX=0501 task excursions without frame credit |
| [#475](https://github.com/CrispStrobe/bw-board/pull/475) | `lane/386-xv6-js-rollback-direct-v8-preflight-20261009` | `90c4de590325f59c8d164cefc37fa036740f189a` | Census pinned Node headers after preflight refusal |
| [#476](https://github.com/CrispStrobe/bw-board/pull/476) | `lane/386-0501-task-excursion-at-20261009` | `44087e8f1d19b1f74c6f2742ebca31594f6e7208` | Add bounded 0501 task mode diagnostic source |
| [#477](https://github.com/CrispStrobe/bw-board/pull/477) | `lane/386-xv6-js-rollback-direct-v8-header-census-20261009` | `61fa4800434301843a648f9ad851067366b5525e` | Bound pinned Node header preflight at 64 MiB |
| [#478](https://github.com/CrispStrobe/bw-board/pull/478) | `lane/386-0501-task-mode-diagnostic-20261009` | `f2fb33f921bf99b23d1e88ee889512d5d4ee6318` | Add bounded AX=0501 task-mode AT diagnostic |
| [#479](https://github.com/CrispStrobe/bw-board/pull/479) | `lane/386-xv6-js-rollback-direct-v8-preflight-64m-20261009` | `8ffca01b8ca675fcd2a3980ffd0697665b080771` | Add report-only direct V8 tool census |
| [#480](https://github.com/CrispStrobe/bw-board/pull/480) | `lane/386-0501-task-mode-at-20261009` | `6191a70650142ea46552c2d417eb7eb62aa08e38` | Attribute decoded direct far CS reloads in opt-in task mode |
| [#482](https://github.com/CrispStrobe/bw-board/pull/482) | `lane/386-xv6-js-rollback-direct-v8-tool-census-20261009` | `174767b449b1be4b3e76f41c6e44ffd46ba2edfd` | Observe complete direct V8 tool roster with bounded split output |
| [#483](https://github.com/CrispStrobe/bw-board/pull/483) | `lane/386-0501-task-mode-far-attribution-20261009` | `72d0b32e8bd7d658447745129119e2300ad6bec1` | Connect decoded far reload to bounded AT attribution |
| [#484](https://github.com/CrispStrobe/bw-board/pull/484) | `lane/386-xv6-js-rollback-direct-v8-tool-roster-20261009` | `77fd5fbbc132d48622eb0790c0b2d66a6e66a5a4` | Prepare pinned unloaded direct V8 first-build control |
| [#485](https://github.com/CrispStrobe/bw-board/pull/485) | `lane/386-xv6-js-rollback-direct-v8-first-build-20261009` | `b8ce3eb36d6022eb82415c80fdbcf9b37e23284f` | Add a separately pinned profiler-header build profile |
| [#486](https://github.com/CrispStrobe/bw-board/pull/486) | `lane/386-0501-far-at-20261009` | `33d53542aa4375f9eb4c3c508ecf9bc8b1bba0d9` | Record bounded page-fault delivery outcomes without frame credit |
| [#487](https://github.com/CrispStrobe/bw-board/pull/487) | `lane/386-0501-pf-outcome-source-20261009` | `6c342303f619035b5037426cef335d059628e3dc` | Observe owned AX=0501 page-fault delivery outcome on the admitted AT machine |
| [#488](https://github.com/CrispStrobe/bw-board/pull/488) | `lane/386-xv6-js-rollback-direct-v8-first-build-profiler-header-20261009` | `ff8038de317569de3df8e7f6743a901a1f530c97` | Qualify corrected direct V8 addon with four same-run support cases |
| [#489](https://github.com/CrispStrobe/bw-board/pull/489) | `lane/386-xv6-js-rollback-direct-v8-support-profiler-header-20261009` | `9367cfa9a8f6ffaaee2afaa59be4735e6b494aad` | 386: isolate sampler support allocation site (source only) |
| [#490](https://github.com/CrispStrobe/bw-board/pull/490) | `lane/386-0501-pf-outcome-connected-20261009` | `2fc9d71fd9cbd0585ea50f1b81133f18c150c78c` | 386: correct PF mock arm ordering and qualify controls |
| [#491](https://github.com/CrispStrobe/bw-board/pull/491) | `lane/386-xv6-js-rollback-direct-v8-target-site-20261010` | `989bdf5ffdcb155aef27e426ce0af91aaaff7082` | 386: bind target-site sampler to same-run support profile |
| [#492](https://github.com/CrispStrobe/bw-board/pull/492) | `lane/386-0501-pf-mock-fix-20261010` | `e321e000e6a6bc44e626bbef119febbcac27e73d` | 386: admit separate PF connected profile with qualified mocks |
| [#493](https://github.com/CrispStrobe/bw-board/pull/493) | `lane/386-xv6-js-rollback-direct-v8-target-site-support-20261010` | `79f1f13b6037265785e18342ca06b04eec2ab475` | 386: add separate zero-prior-GC sampler fixture |
| [#494](https://github.com/CrispStrobe/bw-board/pull/494) | `lane/386-0501-pf-connected-mock-fixed-20261010` | `3bd7b09cc01f02bd99f2c3b4d72b982d1f511f77` | 386: add post-PF CPU observer prerequisite |
| [#495](https://github.com/CrispStrobe/bw-board/pull/495) | `lane/sampler-nursery-20261011` | `21eef8f700132f2df90564fbf3661467a2275b64` | 386: prepare separate nursery sampler support profile |
| [#497](https://github.com/CrispStrobe/bw-board/pull/497) | `lane/386-post-pf-cpu-prerequisite-20261011` | `b3abd80ba462f4319c9a635088604a6b9f8421c9` | Add bounded post-PF connected observer source profile |
| [#498](https://github.com/CrispStrobe/bw-board/pull/498) | `lane/386-post-pf-connected-20261011` | `79dfbd223a579bd9aba43be39e8ebdbb046eea5c` | Complete held PF premise in post-PF grade control fixture |
| [#499](https://github.com/CrispStrobe/bw-board/pull/499) | `lane/nursery-support-20261011` | `3a0e595c7b813a753fd79c436bfafe2c20cea690` | Scope pinned Node staging file limit and restore text caps |
| [#500](https://github.com/CrispStrobe/bw-board/pull/500) | `fix/post-pf-connected-grade-fixture-20261011` | `e1f44e70bd21e4f3b146d0c0e00da141eb045182` | Fix frozen-output mutation in post-PF synthetic control |
| [#501](https://github.com/CrispStrobe/bw-board/pull/501) | `fix/sampler-nursery-node-staging-20261011` | `6a546e19350e013d69f7f5b236a7a64c08115a39` | Add unconnected guest snapshot cohort seam |
| [#502](https://github.com/CrispStrobe/bw-board/pull/502) | `fix/post-pf-grade-mutability-20261011` | `f04f4e8dd9d30cc0439e78ed801fb26c3027adf3` | Add unconnected fixed-role tool boundary receipts |
| [#503](https://github.com/CrispStrobe/bw-board/pull/503) | `lane/386-tool-boundary-receipts-20261011` | `4badb1905033d58d14e9e2f19fc589b708259a10` | Prepare disabled compiler boundary phases |
| [#504](https://github.com/CrispStrobe/bw-board/pull/504) | `lane/386-guest-snapshot-cohort-seam-20261011` | `98d4d16a161bf8bf587d45eeed793997b4806fc4` | Prepare synthetic guest-site lifecycle controller |
| [#505](https://github.com/CrispStrobe/bw-board/pull/505) | `lane/386-compile-tool-boundary-source-20261011` | `6f6f1babc5f19a043bb0fe12dc079b3e75830fc5` | Prepare bounded compiler root-route observations |
| [#506](https://github.com/CrispStrobe/bw-board/pull/506) | `lane/386-guest-site-controller-source-20261011` | `2275fc5eb9d0c27a197a5256239cbbefa8d8cabe` | Prepare source-owned guest turn and pressure mechanics |
| [#507](https://github.com/CrispStrobe/bw-board/pull/507) | `lane/386-compile-root-routes-source-20261011` | `26c50cd43a28a8d357206bc9ab2b4ad2b421f00b` | Prepare bounded evidence descriptor writer |
| [#508](https://github.com/CrispStrobe/bw-board/pull/508) | `lane/386-evidence-descriptor-writer-source-20261011` | `a3f4e0c2e6b5132bc91adb161365dcdc49213c5a` | Prepare bounded workspace directory creation |
| [#509](https://github.com/CrispStrobe/bw-board/pull/509) | `lane/386-workspace-creator-source-20261011` | `0c3b43c1e99403d87622748a2171a23824fad5ce` | Add exact-source hosted workspace unit controls |
| [#510](https://github.com/CrispStrobe/bw-board/pull/510) | `lane/386-workspace-source-controls-20261011` | `ffb413624f4814f906d22129b7e0aa85ca145a5b` | Compose retained workspace and evidence ownership |
| [#511](https://github.com/CrispStrobe/bw-board/pull/511) | `lane/386-owned-workspace-evidence-20261012` | `2e185b4b8732957783958500183e3863c8047216` | Qualify retained composition with bounded hosted source controls |
| [#512](https://github.com/CrispStrobe/bw-board/pull/512) | `lane/386-owned-workspace-controls-20261012` | `473b90ea27529e576775ae5864a7fd2a4f3f9237` | Prepare retained-root fixed-role tool observation |
| [#514](https://github.com/CrispStrobe/bw-board/pull/514) | `lane/386-retained-tool-observer-20261012` | `3dd5092128996733f3f71c0ec640f2126010dea8` | Add hosted retained observer source-control profile |
| [#515](https://github.com/CrispStrobe/bw-board/pull/515) | `lane/386-retained-tool-controls-20261012` | `a5fd036bda8b34ed8c50551713b4f0ecca219d20` | Prepare retained selected-role archive materialization |
| [#516](https://github.com/CrispStrobe/bw-board/pull/516) | `lane/386-retained-tool-materializer-20261012` | `5b670bee8a8f2da149f8ab30e825c13370d56762` | Add hosted selected materializer source controls |
| [#517](https://github.com/CrispStrobe/bw-board/pull/517) | `lane/386-retained-materializer-controls-20261012` | `7fcfec51cc4fd25ee5959e54ae4c99a4c3480a7e` | 386: admit fixed reported TAR aliases without alias outputs |
| [#518](https://github.com/CrispStrobe/bw-board/pull/518) | `lane/386-fixed-alias-materializer-20261012` | `5d05e17d6c11cf6a901fce85bf880f13e7eb55ac` | 386: host bounded fixed-alias materializer controls |
| [#519](https://github.com/CrispStrobe/bw-board/pull/519) | `lane/386-fixed-alias-controls-20261012` | `91cc44717820e0b02efd7a31b4384d98b1025590` | 386: retain bounded materialization-only observations |
| [#520](https://github.com/CrispStrobe/bw-board/pull/520) | `lane/386-materialization-witness-20261012` | `bdd2f33545f12e9b9ce8551af42d44a8e7b3ce5d` | 386: host bounded materialization-runner controls |
| [#521](https://github.com/CrispStrobe/bw-board/pull/521) | `lane/386-materialization-runner-controls-20261012` | `9329da5b683563d85c6548f848a5f1f7141d5a6f` | 386: acquire four fixed public archives before materialization |
| [#522](https://github.com/CrispStrobe/bw-board/pull/522) | `lane/386-fixed-archive-acquisition-20261012` | `b281e779266f6d225d91a88750c85a36e858042e` | 386: prepare gated fixed-archive materialization only |
| [#524](https://github.com/CrispStrobe/bw-board/pull/524) | `lane/386-fixed-archive-hosted-20261012` | `e5cbd37186aa9bf834be9fa1a6b4a9011e1acc69` | x86: identify archive refusal rules without changing acceptance |
| [#525](https://github.com/CrispStrobe/bw-board/pull/525) | `lane/386-archive-refusal-diagnostic-20261012` | `c9a22a1b173aa5f2fc41f8edf4a97a8fbfab5cc2` | fix(x86): admit bounded GNU long-name metadata |
| [#557](https://github.com/CrispStrobe/bw-board/pull/557) | `master` | `fc799aef5945014dd1920aded9d60339da3caea8` | Remove decodeEA16 temporary arrays; performance qualification pending |
| [#645](https://github.com/CrispStrobe/bw-board/pull/645) | `master` | `a5054f3a9a6e572cc926d1537991f12ab650be14` | test: add bounded ring3 fixture and hosted runner source |

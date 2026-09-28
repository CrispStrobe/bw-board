# Candidate grammar for a reusable 386 decoded trace

This is a media-neutral analysis of the [source-bound 60M Windows potential-trace receipt](receipts/2026-09-28-i80386-cross-mode-potential-trace.json) and the current [`_stepInstruction` decoder](../src/experimental/i80386.js). The receipt completed the pinned budget with selected guest and source parity and counted 38,839,499 eligible retired ordinals in disjoint runs of at least eight, including 21,739,881 in protected16/VM86. Its model followed successful ordinary execution and actual successors. It is an optimistic opportunity screen, not an executable trace or speed measurement.

The following post hoc groups partition the receipt's `longRunOpcodeCounts` by **primary opcode**. The cumulative column is the count of observed ordinals assigned to these groups, divided by 38,839,499. It is **not** coverage of runs that a partial executor could retire: one unsupported instruction can break an entire run. The observer stripped prefixes from the key and did not preserve ModR/M, SIB, group extension or read/write form, so these groups do not identify executable forms.

| Primary-opcode group | Ordinals in observed ≥8 runs | Share | Cumulative opcode mass |
| --- | ---: | ---: | ---: |
| ALU, TEST, CMP, shifts (`00–3D` ALU forms, `80–85`, `A8–A9`, `C0–C1`, `D0–D3`) | 9,141,007 | 23.54% | 23.54% |
| MOV register/memory/immediate (`88–8B`, `A0–A3`, `B0–BF`, `C6–C7`) | 8,903,890 | 22.92% | 46.46% |
| Conditional branch and LOOP (`70–7F`, `0F80–0F8F`, `E0–E3`) | 6,652,152 | 17.13% | 63.59% |
| Stack and frame (`50–5F`, segment push/pop, `60–61`, `68`, `6A`, `8F`, `9C–9D`, `C8–C9`) | 5,810,660 | 14.96% | 78.55% |
| Direct call/jump/return/IRET (`9A`, `C2–C3`, `CA–CB`, `CF`, `E8–EB`) | 2,450,687 | 6.31% | 84.86% |
| Remaining ordinary opcodes | 2,152,781 | 5.54% | 90.40% |
| Mixed group extensions (`F6–F7`, `FE–FF`, `0FBA`) | 1,858,086 | 4.78% | 95.18% |
| Segment and far-pointer forms (`8C`, `8E`, `C4–C5`) | 822,493 | 2.12% | 97.30% |
| Other `0F` forms | 646,765 | 1.67% | 98.97% |
| Non-I/O string forms (`A4–A7`, `AA–AF`) | 268,529 | 0.69% | 99.66% |
| Port I/O (`6C–6F`, `E4–E7`, `EC–EF`) | 132,449 | 0.34% | 100.00% |

The distribution is concentrated but not on one easy form. `8B`/`89` alone contribute 6,935,194 ordinals (17.86%); `74`/`75` add 4,574,009 (11.78%). The four byte/word MOV opcodes `88–8B` total 7,897,340 (20.33%), but ModR/M may make each a register operation or a RAM access. `A0–A3` account for 233,118 admitted ordinals (0.60%) and necessarily use a memory operand; the receipt cannot determine the full RAM share. `83` contributes 1,435,283 (3.70%), but its `/reg` extension selects different ALU operations and fault/write behavior. `FF` contributes 777,032 (2.00%) across increment, decrement, call, jump and push forms; treating it as one micro-op would be unsound.

| Entry mode | Observed ≥8-run ordinals | Outside prior broad grammar | Control transfers | I/O continuation |
| --- | ---: | ---: | ---: | ---: |
| Real | 5,687,495 | 1,457,847 | 1,602,705 | 30,252 |
| Protected16 | 7,768,863 | 2,150,219 | 2,234,498 | 29,294 |
| VM86 | 13,971,018 | 2,222,759 | 2,785,863 | 0 |
| Protected32 | 11,412,123 | 3,186,113 | 2,787,457 | 72,903 |
| **Total** | **38,839,499** | **9,016,938 (23.22%)** | **9,410,523 (24.23%)** | **132,449 (0.34%)** |

The last three columns overlap each other and the opcode groups. “Outside prior broad grammar” is the old classifier's refusal on an instruction that ordinary execution completed; it is not an independent extra 9.02M opportunity. Port I/O is only 0.34% of long-run ordinals, yet an I/O instruction can split a frequently traversed polling trace. The [owned cross-mode I/O fixture](I80386-CROSS-MODE-IO-EXECUTION-PROOF.md) proves one synchronous port path, not all I/O forms or Windows parity.

## Implementation choice

Build the first reusable *decoder and opt-in executor* around a typed subset of `88–8B` MOV, `39/3A/3B/3C/3D/84/85` CMP/TEST, `80/81/83 /7` CMP, short `70–7F` Jcc, and `EB` jump. Include only forms whose operand and fault semantics are implemented; every other form exits before the instruction. Add arithmetic group extensions only after the form-resolved census identifies their `/reg` and register-versus-memory mix. Keep `E4/E6/EC/EE` byte I/O behind an explicit synchronous helper gate, initially limited to ports whose board ordering and permission path have differential tests. This subset covers high-mass opcode families and the branch + RAM + port-I/O structure already proved by the owned fixture. It deliberately leaves stack, calls/returns, far transfers, strings, shifts and mixed `F6/F7/FF` groups to ordinary execution until their commit and fault order are proved. Their combined opcode mass is large, so a first executable coverage result may still be small.

Before treating that subset as an implementation target for Windows, extend the **observer**, without guest execution changes, to record per-mode `(opcode, prefix signature, operand/address defaults and overrides, ModR/M /reg, mod=3 versus memory, 16-bit EA or 32-bit SIB/disp, read/write width)` counts and replay the proposed admission rules over the same observed ordinal stream. Recompute **disjoint ≥8-run ordinals after splitting at unsupported forms and event exits**, including protected16/VM86 and I/O-dependent shares. The existing receipt cannot answer this because it stores only aggregate opcode histograms, not ordered forms or their joint run composition. This is the next measurement that can reject a narrow grammar before a backend is built; no runtime or gain claim follows from the table above.

A reusable decoder must capture instruction length, exact bytes, prefix effects, operand/address width, segment override, ModR/M and SIB/displacement/immediate fields, 16-bit BP versus DS/SS selection, register byte aliases, flags read/write masks and both branch successors. Its trace key must bind a physical code page and exact bytes to CS descriptor, CPL/VM86, CR0/CR3/CR4, translation generation and effective A20; decode cannot fetch a second code page. At every memory micro-op, compute the effective address from **current** registers and admit only an already valid, permission-correct ordinary RAM translation. Cross-page, missing, clean-write, MMIO/ROM, page-table and code-writing accesses exit before the instruction so ordinary JS performs the walk, A/D update, fault or device effect. Register-only forms do not need this memory gate.

At each instruction boundary, preserve the current board's chip/LAPIC deadline, IRQ/NMI arbitration, TF/debug/shadow and externally scheduled-input order. Commit completed registers, flags, CS:EIP and cycles before any side exit; do not expose a later store after a fault. Conditional links must recheck the observed same-page successor and code identity. A port helper must use the ordered board access, including VM86 TSS permission where applicable, settle chip debt, then recheck code/mapping identity and the next event boundary. Any CPU, DMA or host write to a cached code page or page table must revoke dependent traces. Direct raw `machine.mem` writes need an intercept or an explicit invalidation contract, including a raw PTE-remap test after TLB-slot eviction. The current [dynamic-memory slow-exit contract](I80386-DYNAMIC-MEMORY-SLOW-EXIT.md) and [owned I/O proof](I80386-CROSS-MODE-IO-EXECUTION-PROOF.md) supply focused starting tests; neither is a general fast path.

Only after form-resolved opportunity survives should the executable subset run opt-in full Windows 60M and lean xv6 **guest-state and device-order parity pairs**. The existing draft then requires three serial AB/BA/AB user-CPU pairs with at least 10% mean Windows improvement and every pair favorable before a performance claim. The census and this plan make no speed claim.

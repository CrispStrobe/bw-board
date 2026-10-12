# Owned high-linear-memory and advancing-timer QEMU result

The first [QEMU attempt](https://github.com/CrispStrobe/bw-board/actions/runs/37764261886),
attempt 1, passed at source
[`6ec767b`](https://github.com/CrispStrobe/bw-board/tree/6ec767b50008beb53b012dafcf55361de3ffb146/scripts/i80386-cwsdpmi-highmem-timer).
[PR458](https://github.com/CrispStrobe/bw-board/pull/458) remains a draft.
Root and peer independently audited the original report-only artifact using
standard-library parsing and Git source checks, without importing producer
helpers or replaying the guest. The [selected receipt](receipts/2026-10-08-i80386-highmem-qemu.json)
binds the official source, run and original artifact.

## Observed finite result

The owned DJGPP client ran with the pinned CWSDPMI member on QEMU TCG
`pc`/486, 4 MiB, SeaBIOS/std VGA and FreeDOS 1.4. It reported:

| Predicate | Original observation |
| --- | --- |
| DPMI allocation request | 4,096 bytes; successful status |
| Returned linear address | 4,849,664, strictly above 1 MiB; requested span does not wrap |
| Selector readback | Base 4,849,664; exact byte limit 4,095 through CPU `LSL` |
| Owned far-pointer pattern | 256 bytes; checksum 4,225,408 |
| Simulated BIOS timer | 732,237 to 732,238; delta 1 at poll 1,035 of 262,144 |
| Exit and shell return | Exact owned output, zero-exit file and separate return file; no failure marker |

Client disk observations at screen samples 9/10 agreed; a fresh pre-VERIFY
fence at sample 11 retained the same output and no return file. Separate
return observations at samples 14/15 agreed, with a new command echo and
current prompt. QEMU exited with status zero and an empty owned process group;
the oracle reported matching terminal files after reaping it. No partial FAT
observation occurred. Source-before and source-after receipts matched all
105 bound roles; the ZIP contains 107 members, including 106 inventoried files
and the inventory itself. The exact CWSDPMI license notice is retained.

The oracle interval was 8.081 seconds on a GitHub runner reporting an Intel
Xeon 6973P-C and four logical CPUs. This includes boot, input and observation
work; it is not an emulator RTx measurement or a speed comparison. QEMU was
8.2.2 and SeaBIOS 1.16.3.

## Evidence boundary and next step

The artifact intentionally contains no executable, HDD image, firmware or raw
guest RAM. Independent audits checked retained output bytes/prefixes, hashes,
parsed predicates, ordered milestones and the source-bound observer reports;
they did not independently reread the terminal guest disk. Running-QEMU disk
reads are bounded observations, not atomic snapshots. QMP key offers are not
per-key guest acceptance evidence.

This qualifies this finite owned client on the stated QEMU profile. The address
is **linear**; it does not establish physical placement above 1 MiB. It does
not establish calibrated timer accuracy, `INT 31h` frame/IRET attribution, the
new client's AT completion, broad DPMI/application compatibility, or a CPU
performance improvement. The earlier [AT completion](I80386-DPMI-AT-COMPLETION-RESULTS.md)
used a different client and remains unchanged.

Next, implement the separate AT gate in the
[high-memory/timer contract](I80386-DPMI-HIGHMEM-TIMER-PLAN.md): authenticate the
same client and initial media, declare the new map/owned-code roles, retain the
strict whole-text result separately, and require accepted Set-1 input plus
same-machine disk/current-prompt evidence. Preserve its first actual outcome.

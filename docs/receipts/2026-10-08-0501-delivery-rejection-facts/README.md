# Actual delivery diagnostic: rejected handler code size

[Run 37830225406](https://github.com/CrispStrobe/bw-board/actions/runs/37830225406),
attempt 1 at reviewed source
[`0714159c`](https://github.com/CrispStrobe/bw-board/commit/0714159c9875ac17bf5ef5a8e5418f5815fa1608),
retained the reason for the selected delivery rejection. The run remains a
failure with `unsupported-owned-delivery`; no entry or return was credited.

The post-instruction diagnostic records software `INT 31h`, delivery depth one,
32-bit interrupt gate type 14, no VM86 or error code, and CPL 3 to CPL 3. Its
handler code selector is 43 with 16-bit default operand size; stack selector
175 has 32-bit default size. The same-privilege frame is 12 bytes. The only
failed condition in the frozen compound guard is the handler code-size check.
The owned 80-byte wrapper matched with unchanged fingerprints and references
at step 44,609,991; observation stopped at step 44,610,000 after nine active
CPU steps. The finite client did not finish.

Root and independent peer audited the original packet, official metadata,
196 Git-bound roles and 62 recursive ESM nodes, compiler/client/map, media,
free BIOS/VGA and retained notice bindings. The [derived summary](summary.json)
records original ZIP/log identities and official origins. No producer helper
import or guest replay was used for the audit.

This justifies a separately bounded observer profile for the observed 32-bit
gate/16-bit handler/32-bit stack at the same CPL 3. It must still observe an
actual decoded 32-bit IRET and exact 12-byte frame/return continuity. This
receipt grants no completed frame pair, physical mapping, application,
performance or broader 386 qualification. See the
[frame attribution lane](../../I80386-DPMI-FRAME-ATTRIBUTION-LANE.md).

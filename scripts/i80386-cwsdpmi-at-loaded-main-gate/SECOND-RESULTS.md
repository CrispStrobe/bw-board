# Second AT loaded-main attempt

The second hosted attempt at source `052e0b684ca7362300b99b9c609506725347fdf8`
([run 37738630130](https://github.com/CrispStrobe/bw-board/actions/runs/37738630130))
**failed loaded-text qualification**. Its original report-only
[artifact 11533659864](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11533659864)
is 124,705 bytes with SHA-256
`d31398a13c8caa9f7e8eeb82662e21c654cab2393a19079ed5e9e06615dd55ea`.
Root and independent peer audits accepted the packet integrity and exact source
bindings; the guest result remains a failure.

The guest accepted 34 Set-1 scans and recorded a protected 32-bit `main`
candidate after 44,605,932 ordinary steps. At that pre-step cut, CS was 167,
EIP was 75,168, CS base was 4 MiB, CR3 was 229,376, CR4 was zero, and A20 was
enabled. Raw CR0 was `-2147483639`, the signed JavaScript representation of
the 32-bit value `0x80000009`. The passive reader rejected that representation
as an unsupported paging profile before copying or binding loaded text. Its
recorded CPU, board, RAM, page-classifier, and page-table fingerprints matched
before and after the refused observation.

The correction admits either signed-int32 or unsigned-uint32 representation
for **CR0 alone**, while preserving its raw value and all other profile and
address checks. The CPU, media, guest, workflow, and loaded-text policy remain
unchanged. This correction has source-only controls and requires a separate
hosted run. The candidate is not proof that the first `main` instruction ran;
there is no loaded-text identity, INT 31 service, completed client, strict 386
profile, or performance result from this attempt.

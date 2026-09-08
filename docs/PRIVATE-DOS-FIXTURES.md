# Internal DOS media: external fixtures, not public assets

User decision, 2026-09-08: keep shareware/freeware game archives out of public
repositories and Brickwright's distributable assets. Private testing may use
locally supplied, lawfully obtained copies after reviewing the exact terms.
Private repository visibility is not itself permission to copy or distribute.

Public source contains harnesses, owned synthetic fixtures, compatibility
metadata and reviewed open-source material with notices. An external private
corpus may hold approved exact archives, acquisition provenance, distribution
terms, review records and private results. Do not create/upload a private corpus
until its destination, access policy and archive rights have been established.
No real game archive was downloaded, copied or uploaded for this increment.

## Admission check

Place this manifest and its referenced files in an external directory (or a
separately managed private repository). Placeholder hashes deliberately fail:

```json
{
  "schema": "brickwright-private-guest-v1",
  "id": "owned-or-reviewed-game",
  "version": "exact release",
  "distribution": "private-test-only",
  "source": "https://publisher.example/exact-release",
  "review": {
    "status": "approved-for-internal-testing",
    "reference": "internal review record, reviewer and date"
  },
  "archive": {"file": "original.zip", "sha256": "REPLACE"},
  "terms": {"file": "distribution-terms.txt", "sha256": "REPLACE"}
}
```

```sh
PRIVATE_DOS_FIXTURES=/external/private/corpus/game \
  node scripts/check-private-guest.mjs
```

The checker requires hashes for both archive and terms, an explicit review
record and an external root. It refuses traversal, symlinks, oversized files,
missing files and changed hashes. It neither validates the legal conclusion
nor extracts, executes, downloads or republishes anything. Receipts contain
identifiers and hashes, not archive bytes, private paths or terms text.

## Later private execution lane

Keep original media read-only. Extract only with a bounded, traversal-safe
importer and run inside guest emulation; never execute a DOS package's commands
on the host. Store writable saves separately. Private corpus jobs must not run
on untrusted pull requests or upload media, screenshots, save files or logs to
public CI artifacts. Public build/galleries must not consume the private corpus.

Keen 1 shareware is a candidate for EGA/input/speaker coverage; Wolf3D shareware
is a later 286/VGA candidate. Neither has an approved manifest or execution
receipt yet. A successful admission check is not a game compatibility result.
DOSBox/JS-DOS import remains a separate planned feature.

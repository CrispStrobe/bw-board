# External guest fixtures

Public software examples use freely licensed or freeware material with recorded source provenance and license notices. Original external guest media, acquisition notes and proprietary compatibility records are maintained in [the private firmware repository](https://github.com/CrispStrobe/brickwright-firmware-private). Historical fixture notes are preserved in its documentation archive.

Use [the x86 loading guide](X86-LOADING-GUIDE.md) for CLI/GUI formats and backend selection. Media manifests describe inputs; they do not establish guest compatibility. `scripts/check-private-guest.mjs` checks an external manifest and its archive/terms hashes without extracting, executing or publishing the input. Guest image writes, export and persistence depend on the chosen loader.

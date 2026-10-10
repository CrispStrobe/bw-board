# Official Node release-pin text comparison

The two archive pins in [draft PR477](https://github.com/CrispStrobe/bw-board/pull/477),
source `61fa4800434301843a648f9ad851067366b5525e`, match the
[official Node 20.20.2 checksum list](https://nodejs.org/dist/v20.20.2/SHASUMS256.txt).
Root and an independent peer compared the retained original checksum text with
Git source without acquiring archives or importing producer helpers.
[summary.json](summary.json) records exact text and pin identities.

This checks text-to-source agreement. It does not verify a release signature,
rehash archive bytes, qualify native runtime behavior or establish profiler
support. The separately named hosted preflight, build and four fresh support
children remain necessary gates.

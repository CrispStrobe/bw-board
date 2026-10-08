# Mixed-profile test expectation correction

[PR466](https://github.com/CrispStrobe/bw-board/pull/466) source `94ecaacb` failed
[CI](https://github.com/CrispStrobe/bw-board/actions/runs/37833022645) and the
[xv6 workflow](https://github.com/CrispStrobe/bw-board/actions/runs/37833022318)
on the same newly added regression. A 16-bit IRET consumed a 32-bit interrupt
frame and raised the existing guest #GP, which the test did not expect.
The mixed-width positive and descriptor-mutation cases passed in those logs.
This is a test expectation error; these failed jobs are not qualification.

Reviewed correction [`1ecb987b`](https://github.com/CrispStrobe/bw-board/commit/1ecb987b86217c7c549fffc1d3b7ff498898b9dd)
asserts the original fault and invalid observer, and updates the exact test
source pins. CPU code is unchanged. Root and independent peer reviewed the
retained original logs and correction without replaying the guest. Fresh hosted
checks and a real guest frame pair remain pending.

[Summary](summary.json) records original uncompressed log hashes, test totals
and exact sources. It contains no guest binary or private host origins.

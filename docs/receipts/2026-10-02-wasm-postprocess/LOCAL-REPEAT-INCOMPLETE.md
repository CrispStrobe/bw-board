# Redundant local repeat is unqualified

The finalized script's `local-build/` repeat was intentionally stopped after
the two independent CI optimizer build jobs succeeded in run 36991093841.
The shared VPS gave the local compression process very little CPU; this repeat
was redundant to the completed original native pilot and the new hosted builds.
The exact owned process PID 816303 and its cwd/arguments were checked before
SIGTERM. No other project's process was stopped.

The partial tree has no final BUILD-INFO, was not executed for integration or
timing, and is not publication or acceptance evidence. Keep it distinct from
the completed original pilot in `.t16-register-evidence.qZjhRa/postopt-main-O3/`
and from the independent hosted build artifacts. No original bytes or receipts
were deleted or overwritten.

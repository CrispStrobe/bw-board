# Independent ideal-source self-constraints

An ideal voltage source whose two terminals are on the same electrical node
requires `0 = Vsource`. A nonzero value is inconsistent; a zero value adds no
voltage constraint. This applies to live nodes and to separate ground symbols
merged by the solver into its reference node.

`solveMNA` checks this condition before its zero-node early return. Nonzero
constraints throw a diagnostic naming the source, effective voltage and net.
The effective voltage uses the same control, waveform/time, explicit DC-bias
and current-mode override selection as the ordinary source stamp. Valid zero
constraints do not allocate a row; their individual ideal branch current is
indeterminate and remains absent, rather than being invented as a measurement.

The old allocation omitted ground-ground constraints without checking their
value. For a live self-short, the positive/negative stamp entries overwrote
each other instead of cancelling, imposing an unintended voltage constraint.
This could falsely report convergence or turn a valid 1 V circuit into 0 V.

Powered-off solves, disconnected terminals and sources with positive internal
resistance or positive current limits retain their existing behavior. This is
not a qualification of their short-circuit currents. No general voltage-source
cycle analysis, tolerance change, waveform rewrite or rollback guarantee is
introduced. A public operation that triggers an inconsistent solve can throw,
including `setNetlist` and a later waveform advance; callers must handle that
failure rather than treating a failed operation as a successful measurement.

Focused tests cover signed ground/live/merged-ground conflicts, all-ground
circuits, valid zero constraints on a driven node, control overrides, transient
time versus DC bias, nonideal/disconnected/power-off exclusions and strict OP
observational state. Ngspice rejects the nonzero self-short controls but also
rejects zero self-shorts syntactically; the valid-zero contract is therefore
proved by algebra and the driven-node control, not claimed as ngspice acceptance.

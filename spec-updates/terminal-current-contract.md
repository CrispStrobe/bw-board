# Terminal-current contract

`solveMNA().branchCurrents` and `BoardImpl.branchCurrent(part, terminal)`
report amperes **leaving the part through the named terminal into its net**.
This applies to every device kind, not only passive components. Summing these
readings on a shared net tests KCL; summing a device's own terminals is a
different test and cannot detect a whole-device sign reversal.

`operatingPoint()` preserves its published `positive-into-part-terminal`
contract. One unconditional sign conversion adapts raw MNA results to that
API. Non-UIC initialization converts back when seeding the public live cache.
Internal capacitor voltage is Va−Vb; inductor storage current is a→b, i.e.
OP terminal a or public terminal b. No integrator equation changes for this
API repair. Native MNA voltage-source row unknowns remain into-terminal.

Forward LED brightness and overcurrent diagnostics use **minus** the raw anode
current; sweep delivered current uses the raw source positive terminal without
an additional minus. SPICE source-current vectors use first-node-to-second-node
orientation and require an explicit boundary conversion when comparing public
currents. Node-voltage-only oracle agreement does not prove these conversions.

The prior mixed convention affected D/LED/Zener, voltage-source rows,
transistors and potentiometers. PMOS/PNP polarity and MOS body-junction
contributions must follow their actual stamps, not blanket whole-device flips.
Registered device companions already use out-of-part currents.

Acceptance includes mixed-device shared-net KCL, both source polarities,
immediately before/after non-UIC initialization and after the first step,
signed external-current references, retained LED brightness/DRC and sweep
semantics. Floating/reference-only returns and numerical GMIN residuals are
reported separately; this change does not remove stabilization conductances.

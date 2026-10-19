# Finite-resistance source self-short

For an independent source with finite positive internal resistance, shorting
its external terminals gives `I = Vsource / rInternal`. This is a solvable
branch-current equation even if both terminals are ground. Its positive and
negative node incidences cancel; circulating current does not load that node
or an unrelated supply connected to it.

The MNA solver now retains that branch row on a grounded self-short, including
circuits with no live voltage nodes. A finite-resistance same-node source stamps
only its internal resistance and effective voltage into that row; it no longer
overwrites the positive incidence with the negative incidence. Ordinary
distinct-node source stamps and the preceding ideal-source consistency checks
remain unchanged. Powered-off solves retain the existing zero-node path.

The reproduced 5 V / 10 ohm source formerly had no reported ground current,
or reported 0.6 A when shorted on a 1 V node. The latter also changed the
unrelated 1 V supply's reported load from 1 mA to 601 mA. Both placements
now give 0.5 A circulation and preserve the 1 mA load. Signed current, KCL,
merged grounds, all-ground circuits, controls, finite-resistance current limits,
strict OP observational state and actual meter means are regression-tested.

The existing live ngspice OP gate now compares positive and negative shorted
Thevenin sources against their equivalent explicit ideal-source/resistor decks
at ground and at a driven node. OP currents use positive-into-part convention;
live branch currents and meter means retain positive-out-of-part convention.
No ideal zero-resistance current-limited-short model, generic voltage-cycle
solver, heating model, tolerance/budget change or new device domain is claimed.

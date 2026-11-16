# External mechanical shafts

`claimExternalClock()` grants one synchronous owner. Only `lease.run(action)`
may advance the board until release. Reset invalidates the lease.

`attachMechanicalShaft(id, {angleRad, velocityRadS})` assigns a DC motor rotor to
an external mechanical solver. The normal circuit stamping, series inductance,
resistance and back-EMF remain active. Independent motor inertia integration is
suspended. `setMechanicalShaftState` publishes measured mechanical motion and
quadrature pins. `takeMechanicalShaftImpulse` consumes kT times integrated charge
in N m s, with current, voltage, charge, resistive loss and armature work.
Armature work excludes energy in the separate series inductance; it is not
battery energy. SI motor constants kT and kV should agree for energy-consistent
parameters. Parameters and transmission ratios require calibration for real
hardware; this interface does not certify a manufacturer's motor model.

The caller must step both domains together, apply equal/opposite joint impulses,
and return the measured shaft state. An encoder sample may cross at most one
quadrature edge. Higher rates are rejected explicitly instead of fabricating or
losing edges. Stop must remove output power; reset must release both domains.
No dependency on a particular CAD solver is introduced.

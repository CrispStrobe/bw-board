# External mechanics during transient electrical solves

`attachMechanicalShaft`, `attachExternalServo` and
`attachExternalDistanceSensor` each create an identity-guarded external handle.
They remain valid while the circuit solver probes and rolls back tentative
device updates to locate an event inside a transient integration step.

Transient rollback now restores the payload of `externalShaft`, `externalServo`
and `externalDistance` records in place. It preserves each ownership record's
identity as well as the containing device-state identity. Ordinary device state
is still copied and restored as before. No public attachment API changes.

Previously a rollback replaced these nested records with copies. An attached
inductive motor could run normally but then fail to detach, because its release
closure correctly refused to delete a record with a different identity. Servo
and distance handles could become stale for the same reason. The regression
was exposed by a real CrispBASIC/H-bridge/inductive-motor/Jolt CAD integration.

The new tests use the actual transient solver with a 5 mH winding to verify
motor detach and reattach, servo target/sample, measured distance updates,
release after electrical advance, and stale releases after a new attachment.
The existing clock lease, reset, shaft impulse, encoder, event-timing and
actuator tests remain in the qualification set.

Local qualification on 2026-11-28: all 28 tests in this set passed, as did the
114 focused portable-GPIO/controller-profile tests. The two new transient
regressions failed on the preceding revision and passed with this correction.

```sh
node --test test/mechanical-shaft.test.mjs test/device-timing-events.test.mjs test/actuator-intent-and-meter-mean.test.mjs
```

The motor inertia integrator remains external while the shaft is attached.
The board continues to solve winding current and back-EMF; the CAD solver owns
the rotor position and velocity. Detaching releases that ownership without
inventing an extra time step.

# Passive RLC instrument accuracy control

The regression in `test/rlc-instrument-oracle.test.mjs` independently checks
actual sampled scope data and a watched multimeter DC average. It is a finite
authored control, not qualification of every imported circuit or real hardware.

The circuit is a 5 V, 1 microsecond ramp starting at 1 microsecond, feeding a
5 mH inductor and 10 ohm resistor. The output has an explicitly modeled 12 pF
capacitor and 10 Mohm resistor to ground. That load belongs to the circuit;
the scope observer does not silently supply a physical probe model. Initial
storage comes from the public solved zero operating point, not a private seed.

An independent damped second-order step response and its analytic integral
give the ramp response. Inductor current follows capacitor current plus load
current. Refined Simpson quadrature of this response supplies the expected
DC mean over the whole 5 microsecond interval. A separately authored normal-OP
ngspice deck checks nine samples, with 125 ps and 62.5 ps maximum-step
refinement checked before analytic agreement. No exporter or engine numerical
helper generates the expected answer.

The public sampled scope retains 200 samples at 25 ns spacing. One bounded
stream has fixed ceilings of 20,000 attempts, 60,001 solves and 200 advances;
the observation windows cannot renew that authority. Precision-v1 uses its
public 0.5 ns maximum-step option, with unchanged tolerances and minimum step.
Default interactive-v2 is independently checked at a looser bound reflecting
its measured policy, rather than silently replaced by precision mode.

Wrong circuit inductance and source phase must fail against the fixed
reference. Scope wiring to the source must fail while the correct meter still
agrees; meter wiring to the source must fail while the correct scope still
agrees. These are actual circuit and observer changes, not altered answer data.
Reversed scope and meter polarity are separately rejected, again preserving
the other instrument's agreement with the fixed positive-output reference.

The scope is an ideal sampled observer and the meter assertion is a DC mean,
not RMS. Analog bandwidth, acquisition noise, ADC quantization, nonlinear
winding late-ring accuracy, and physical instrument fidelity remain separate.
No runtime, solver policy, default profile, package pin or deployment is changed.

# ADP7118 current-limited startup envelope

The separately selected `startupModel: 'current-limited-envelope'` uses an authored within-solve current law. It does not replace the default DC behavior or the earlier `datasheet-envelope` startup path. This is a behavioral envelope, not an ADI transistor model or vendor waveform certificate.

The output target is the existing delayed exponential scaled by the fixed nominal voltage: delay rounded to 65.615 us and time constant `300 us / log(9)`. Delivered current is `clip((target(t) - VoutRelativeToGround) / rOut, 0, currentLimit)`. The same solve draws delivered current plus the existing typical IQ law from VIN and returns IQ at GND. Below 200 mA, IQ rises from 50 uA with slope 0.00065 A/A; above it, IQ remains 180 uA. The nonlinear multiport companion owns the matrix currents and final terminal extraction. Previous accepted-step input current is not an authority.

Admission requires explicit positive finite output resistance and current limit, fixed nominal voltage from 1.2 through 5 V, cold startup, direct SENSE, absent SS, and connected EN/GND. Both VIN package pins must share the supply net and both VOUT pins must share the output net. Output loading is restricted to positive finite parallel resistors and capacitors to device GND, with at least one of each. Coincident-net tests do not establish separate physical package-lead current sharing.

VIN must come from an uncontrolled constant source of at most 20 V, with nonnegative finite internal resistance and at most one positive finite external series resistor. EN must come directly from an uncontrolled constant ideal enabled source referenced to device GND. Source waveforms, interactive controls, current-clamped sources, foreign pins, qualified drivers and test injections are refused. With `IQmax` evaluated at the selected current ceiling, guaranteed headroom requires `Vs - Rtotal * (currentLimit + IQmax) > max(nominal + 0.2 V, 2.69 V)`. Newton trial guesses are not the admission point; final solved voltages must remain inside the qualified envelope.

The proof independently solves initial linear RC charging, the constant-current interval, and any released linear interval. Entry and release roots come from those analytic segments. Their analytic integrals qualify the full scope/meter capture window rather than only the final output voltage. A 10 ohm / 2.2 uF overload enters the ceiling at approximately 217.307576 us and remains limited. A 500 ohm / 22 uF inrush enters at approximately 66.268664 us and releases at 329.143234 us. A 500 ohm / 2.2 uF case remains linear.

Tests use real Board advances, native paired scope samples, capture-window means, finite VIN source resistance, common-mode reference shift, package-terminal KCL, output capacitor/load KCL, and large versus partitioned advances. They require the unchanged adaptive accuracy and work gates. A temporary observer inspects the actual accepted solution passed to the existing device dispatcher, without substituting a stale instrument cache: the measured run checks 211 overload and 225 inrush solutions. Independent current-ceiling controls sit 0.5% above and below the unbounded analytic inrush peak; these are authored-law parameter controls, not characterized device current limits.

Each waveform case captures 120 native voltage samples over 1.2 ms. The production qualification measured:

| Parallel load | Maximum sample error | Capture mean error | Adaptive attempts / solves |
| --- | ---: | ---: | ---: |
| 10 ohm / 2.2 uF | 67.548 uV | -10.202 uV | 275 / 821 |
| 500 ohm / 22 uF | 1.716 uV | -2.352 uV | 302 / 902 |
| 500 ohm / 2.2 uF | 0.0505 uV | -13.273 uV | 272 / 812 |

Admission controls reject unsupported topology and source authorities; caught source-control refusal invalidates prior meter/scope observations. Authored capacitor prebias is tested through Board snapshot restoration, which solves immediately after adopting the stored capacitor voltage. This is stored-state restoration, not a separate UIC initializer.

## Source resistance, acquisition and precision

The table above qualifies the 4 ohm VIN-series fixture with one bulk advance,
not every admitted supply and acquisition protocol. A further independent
matrix covers the three loads above, VIN series resistances of 0, 1 and 4 ohms,
and bulk versus 120 partitioned advances: 18 interactive captures, each with
120 native observations. Maximum waveform error is 100.159 microvolts; maximum
absolute window-mean error is 58.489 microvolts. The wider matrix retains the
existing 120-microvolt partition waveform and 100-microvolt linear-control
mean bounds; none of the tighter fixture-specific tests is replaced.

Inrush with an ideal VIN source measures 68.659 microvolts in bulk and
65.648 microvolts partitioned, compared with 1.716 and 1.860 microvolts at
4 ohms. Source resistance does not change this authored headroom-qualified
output law. It does add a changing VIN voltage to the integrator's existing
node-voltage error estimator, so different adaptive meshes are expected.
These measurements establish source-dependent numerical error, not a physical
benefit from adding a resistor. `accuracyMet` means the selected **local**
adaptive error/work checks passed; it is not a global waveform certificate.

Select the existing `precision-v1` profile on a fresh Board before setting
the netlist when a tighter measurement is required. Six persistent precision
captures cover ideal-source overload and inrush plus 4-ohm inrush, each in both
acquisition modes, against the same independent piecewise analytic solution.
They require waveform error below 0.5 microvolts, mean error below 1 microvolt,
120 actual samples, simultaneous supply/terminal KCL and unchanged work gates.
The measured maxima are 0.408 and 0.964 microvolts respectively. A real caller
control omitting precision selection fails the waveform assertion for ideal
inrush in both protocols. No solver/profile/default tolerance or budget is
changed, and these bounds are not promised for all admitted component values.

Register the meter before advancing to observe its capture-window mean. A
meter first requested afterwards returns the current endpoint; it cannot
retroactively integrate a window that it did not observe. Native paired scope
storage remains 120 observations, not 240 independent measurements.

Five executable production-source mutations fail actual Board callers: remove the upper current clamp with its matching derivative; restore previous-step VIN current with its constant derivative; bypass the target clock; omit domain admission; and omit the final prebias guard. The stale-VIN mutation is checked at accepted adaptive solutions because a settled endpoint can repair its bookkeeping and hide the defect. Clock bypass is checked against the cold output current, avoiding an irrelevant adaptive backoff failure. Mutated modules load in memory; the power registry and temporary observer dispatcher are restored, healthy callers are rechecked, and the on-disk source remains unchanged.

This domain does not qualify dynamic enable, shutdown/restart, changing headroom, dropout, prebiased startup, reverse power, adjustable feedback, external SS, inductive loading or coupled regulators. Generic primitive diagnostics preceding this mode are feasibility evidence only; production qualification belongs to the executable ADP7118 tests.

The selected mode also requires matching initialized device state and refuses
any additional `state.drives` authority. `getDeviceState()` exposes live state;
adding a separate output drive there must not silently defeat the current
ceiling or draw output power without simultaneous VIN current. A public
getter/restore regression and an executable guard-removal mutant prove this
boundary. Board snapshots do not themselves serialize device state. Existing
default DC and earlier startup paths retain their behavior.

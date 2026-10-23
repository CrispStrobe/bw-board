# Scope sampling time

True voltage samples retain the integer-nanosecond acquisition grid, but MNA
solutions may be evaluated between those instants. A solve rounded up to a grid
point must not publish that point early. Interpolation brackets the requested
instant using the actual fractional solve times, not their rounded labels.

This correction restores existing sample-grid barriers that early publication
could skip, so corrected sample captures may take a few additional solves. It
does not change integration algorithms, source waveforms, LTE tolerances or
attempt/solve budgets. Integer-only sampling retains its
historical path. Envelope buckets and digital transitions retain their existing
integer-clock contract. Pin/control discontinuities restart sample history at
the actual integer event instant.

Local integration qualification is not independent waveform accuracy. Dynamic
probe validation uses explicit 10 Mohm/15 pF and 1 Mohm/100 pF loads on a
100 kohm/1 Mohm pulse divider and checks every sample against the independent
first-order response. Precision and interactive profiles must not be conflated;
this correction does not promise microvolt accuracy for every interactive run.

The focused test also invokes live ngspice with an independently authored
explicit probe R/C deck: 400 time-aligned observations per probe, checked at
1 microvolt absolute plus 1 ppm relative tolerance. Its ngspice output is itself
checked against the closed form. Local absence is a named skip; upstream CI
installs and requires ngspice, and the oracle census lists this live gate.

The corrected precision fixtures use 2440 attempts/7310 solves (10x) and
2733/8189 (1x), restoring 4 and 14 attempts respectively that premature
publication previously skipped. Envelope captures retain identical work, state
and samples in the regression control. Four isolated defect-restoring mutations
must fail the publication, readiness, interpolation and control-edge assertions.

Next consumer work: independently compare both probe loads with ngspice through
the pinned CLI, and expose precision capture only with explicit initialization
semantics and total-work limits. No passive-probe model claims compensated
bandwidth, ADC quantization, noise or earth-bond safety merely from R/C loading.

## Opt-in voltage aperture capture

`addScopeChannel({type: 'voltage', netId, capture: 'average', sampleRateHz})`
records the mean voltage over each complete sample interval. It integrates the
piecewise-linear path between actual accepted observations, including partial
intervals and multiple sample boundaries. Point and envelope acquisition retain
their existing behavior. Current and digital channels refuse this voltage-only
mode. Reference/probe loading and all existing solver qualification, sample-rate,
work and history-failure rules remain in force.

`getScopeData` returns `capture: 'average'`, `channelType: 'voltage'` and explicit
`apertureNs`. Both ring slots contain the mean in volts. Sample times label the
**end** of each aperture; its covered interval is `[end - apertureNs, end]`.
An unobserved prefix is never published as a guessed sample. Reset discards both
partial area and prior observation state. Reading the ring does not acquire data.

This finite aperture retains narrow pulse area which instantaneous point samples
can miss. It is a boxcar response, not an ideal brick-wall anti-alias filter, and
must not be labelled as an instantaneous voltage or used to infer an oscillator.
The existing instantaneous mode remains appropriate for point-sampled analyses.

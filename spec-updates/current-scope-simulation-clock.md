# Simulation-time current acquisition

## Contract

Opt-in usage:

```js
const handle = board.addScopeChannel({
    type: 'current', partId: 'L', terminal: 'a',
    currentClock: 'simulation', sampleRateHz: 40000000, depth: 402
});
```

Default current channels still acquire one reading per `sampleCurrentChannels()`
display call. Their default metadata and existing write/count behavior remain
unchanged. `capture: 'sample'` alone never selects simulation-clock current
acquisition: all legacy current channels already use that label.

Simulation-clock channels force the existing MNA path for accepted branch-current
authority.
For a healthy powered passive DC board previously using the closed-form walker,
attachment first acquires an existing-MNA static snapshot. Reactive/device
histories are not replaced by a DC solve to supply a missing sample.
Attachment inside a bounded observer charges this solve to the shared budget.
They own sample-grid barriers even without voltage channels and use
the shared fractional-time readiness, sample-pair and ring-label rules. Returned
data identifies `currentClock: 'simulation'`. Display polling neither writes nor
returns these channels. Currents remain amperes **leaving** the selected terminal
into its net; this is opposite SPICE's entering-first-terminal inductor current.

New-mode admission requires a connected part terminal, a positive finite sample
rate no greater than 1 GHz, an integer depth from 1 to 1000000, and sample capture.
Invalid requests refuse before allocating a handle. Accepted-solve current maps,
not a later cache flush, own the samples. Missing/nonfinite current, inconsistent
solve and indeterminate ideal-source alias latch a refusal rather than reporting
zero. Capture failure invalidates earlier partial readings; reset clears the
ring/time epoch but does not rehabilitate a refused history. An unpowered valid
channel retains the existing zero-current convention.

This is an ideal current observer; it does not insert shunt resistance, bandwidth,
noise, clipping or physical probe behavior. No physical-fidelity claim follows.

## Qualification

`node scripts/compare-winding-current-scope.mjs` requests 400 current samples at
25 ns intervals across the authored winding falling edge. It attaches at 1 ms
within the same bounded zero-storage capture and uses **no voltage channels**.
Original 20000-attempt / 60001-solve / 200-advance limits remain in force.
Three independent raw UIC SPICE refinements must meet their existing 10 µV / 1 nA
bounds before every current sample is compared using the predeclared 1 µA bound.
The CLI fails on disagreement and retains timing, current polarity, source
brackets, work receipts and failure diagnostics.

Hosted tests cover unchanged display sampling, standalone analytical RC current,
late attachment, reset/wrap metadata, fractional readiness, accepted-snapshot
authority, discontinuity history, invalid admission, missing/nonfinite samples,
redundant source refusal and whole-capture exhaustion. Three isolated actual
method mutants must fail snapshot, display-write and sample-barrier caller
contracts; a separate executable CLI mutant must fail unsuccessful exit.
All actual engine/oracle execution is hosted. Syntax/pure controls are not
numerical qualification. Source qualification and measured errors are pending.

Package adoption, GUI selection and deployment are separate consumer work.

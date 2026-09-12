# Execution admission API

`bw-board/execution-policy` exports `createExecutionPolicy` and frozen
`MACHINE_SEMANTICS`. It has no CPU, device, DOM or engine dependencies. This is
the P2 selection seam, not a backend, loader, GUI change or qualification suite.
It registers **no built-in implementations** and cannot make the partial native
wired kernel a complete machine. Existing factories are unchanged.

## Trust and catalog

An engine/app adapter constructs a policy once from its **reviewed static
catalog**, never from user preferences, media metadata or project JSON. Entries:

| Field | Meaning |
| --- | --- |
| `id`, `family`, `implementation` | Nonempty stable strings; ID is unique |
| `semantics` | `dos-services`, `functional-hardware`, or `wired-digital` |
| `rank` | Nonnegative safe integer; lower reviewed rank wins |
| `capabilities` | Unique observation capability strings owned by the adapter |
| `reference`, `experimental` | Required booleans |
| `qualification` | `qualified`, `pending`, or `rejected` |
| `evidence` | Required nonempty receipt/commit identity when qualified |
| `reason` | Required explanation for pending/rejected entries |

The module validates structure and snapshots the catalog. It does **not** verify
that evidence exists, run correctness tests, or certify caller-supplied claims.
The catalog author owns those guarantees. Do not let a preferences object become
a catalog entry. Runtime availability can only restrict admission; it cannot
upgrade qualification, capabilities or semantics. Future built-in registrations
must be maintained separately with reviewed evidence and real factory wiring.

## Selection

```js
import {createExecutionPolicy} from 'bw-board/execution-policy';
const policy = createExecutionPolicy(reviewedAdapterCatalog);
const result = policy.select({
  family: 'i8086',
  semantics: 'functional-hardware',
  mode: 'auto', // or 'reference', or 'implementation' with implementationId
  requiredCapabilities: ['registers', 'memory'],
  allowExperimental: false
}, {
  available: verifiedProviderIDs // omitted means none available
});
```

The sample assumes a separately authored catalog; these IDs/capabilities are not
automatic declarations about an existing backend. Capability naming is the
adapter's contract, with exact string matching (no implied supersets).

Auto filters by exact family and semantics, then uses ascending rank and
code-point ID for ties. It never selects experimental entries, even when
`allowExperimental` is true. Experiments require both an explicit implementation
ID and opt-in and must still be qualified and available. Explicit selections
never fall back to a different ID, CPU family or machine. Reference mode filters
to qualified reference entries. No runtime microbenchmark changes ranking.

Success returns `accepted`, `code: 'selected'`, normalized `requested`, frozen
`selected` metadata including capabilities/evidence, `reason`, skipped candidate
`refusals`, and **`restartRequired: true`**. This always describes a reconstruction
plan, including initial creation or selection of the same ID; it does not mean
the live target has changed or a restart has occurred.

Failure has `accepted: false`, `selected: null`, `restartRequired: false`, and a
named code: `invalid-request`, `unknown-implementation`,
`no-matching-implementation`, `no-eligible-implementation`, `family-mismatch`,
`semantics-mismatch`, `candidate-rejected`, `candidate-unqualified`,
`experimental-opt-in-required`, `implementation-unavailable`, or
`missing-capability`. Auto/reference aggregate failures include per-candidate
refusals; explicit mode returns its candidate's reason directly. Malformed
catalogs throw `TypeError` (programmer configuration errors). Malformed selection
requests return `invalid-request` (untrusted saved preferences).

## Adapter integration order

1. Own a reviewed catalog describing only complete supported runners; establish
   actual provider availability separately. Use pending/rejected entries only
   for honest refusal diagnostics, not as selectable backends.
2. Derive machine semantics from the project, implementation preferences from
   settings, and required capabilities from active observers/debugger features.
3. Select before target construction; refuse visibly on failure. Invoke only the
   selected ID's factory. Handle loader failure without silently changing modes.
4. Display active status only after construction succeeds. Save preferences,
   never an old admission result as authority to bypass later checks.
5. Stop and re-admit when observations or topology change. Rebuild topology and
   target where needed. This API provides no hot swap or state migration.

Tests use synthetic providers to avoid overstating real chip support:
`node --test test/execution-policy.test.mjs`.

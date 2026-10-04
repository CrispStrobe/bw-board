# Disabled mapping sideband finding

Source-only review of retained Linux v6.17 files; installed Azure image behavior
has not been tested by this review. No recording or addon was executed.

kernel/events/core.c perf_iterate_ctx rejects states below INACTIVE; executable
MMAP output is selected by attr.mmap/mmap2. tools/perf/util/evsel.c sets those
attributes on the tracking event. builtin-record.c record__config_tracking_events
adds a dummy tracking event for initial_delay, intended to cover mapping delay.
However util/evlist.c control disable with no name calls evlist__disable, whose
excl_dummy=false disables dummy leaders too. enable control does not resynthesize
process mappings. Consequently initial pre-addon /proc maps alone are insufficient.

Named dummy enable is also not a solution: evsel__strcmp rejects dummy events
when a name is supplied; a control ACK alone is not proof of selection. A narrow
source-feasible proposal is global enable while the worker is blocked before
provider/addon, followed by named cpu-clock disable before readiness; later
execution enable/disable controls name only cpu-clock so tracking stays enabled.
Retain all raw tape. Any pre-ready waiting samples must remain outside the
conservative execution ACK window, with no claim of sampling-disabled startup.
This is a proposal requiring source review and meaningful mocked sequence/event
controls, not actual permission/tracking/sampling proof. Post-load /proc maps are
useful independent provenance but cannot repair missing recording sideband alone.

/** Explicit opt-in for owned event-driven adapters, never inferred purity. */
export function createCompiledDeviceScheduler(device,binding) {
    if(!binding?.tracker)throw new TypeError('compiled dependency tracker required');
    const tracker=binding.tracker();let revision;
    const invoke=read=>device.update(read);
    return Object.freeze({
        update() {
            if(device.eventDrivenUpdate!==device.update||!Number.isSafeInteger(device.eventRevision)) {
                // Replacing an implementation or dropping its revision contract
                // restores ordinary calls. Restoring it must do a fresh read.
                tracker.invalidate();binding.drive(device.update(binding.require));return;
            }
            if(!tracker.changed()&&device.eventRevision===revision)return;
            const drives=tracker.invoke(invoke);
            revision=device.eventRevision;
            binding.drive(drives);
        },
        invalidate:()=>tracker.invalidate()
    });
}

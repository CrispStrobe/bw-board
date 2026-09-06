/**
 * The refusal ledger a chip keeps, in one place so every chip keeps it the
 * same way.
 *
 * WHY THIS EXISTS. Each 8086-board chip had grown its own ledger -- a Map of
 * name to count here, a sentence in a field there -- and I8086Machine's
 * chipRefusals() collector had to read all of them. That worked, but it meant
 * a consumer got rows of unequal richness: the 8237's rows named a symptom and
 * an address, the YM3812's rows were a bare string and a number. lego-ac, who
 * consumes these rows in two places (a debugger session line and the lite
 * matrix's P lane), asked for one shape. This is it.
 *
 * THE ROW A LEDGER ENTRY BECOMES:
 *
 *     {count, symptom, ats, atsMore}
 *
 * `count` is every time the feature was refused. `symptom` is what the
 * PROGRAM sees as a result, in a sentence -- not what the model failed to do,
 * which the feature name already says.
 *
 * `ats` IS A SET, NOT THE LAST ONE. The first version of this kept a single
 * `at` and let a second address overwrite the first, so a feature refused at
 * two ports reported count=2 and one address, and the row was a true count
 * beside a partial location. lego-ac named that as the same shape this week
 * has been about: a number that quantifies over one set printed next to a
 * field that quantifies over a smaller one. So addresses accumulate in
 * FIRST-SEEN order and the row can say "refused 2 times, at 3 and at 7".
 *
 * NO SILENT CAP. The set is bounded -- a program that walks every port would
 * otherwise turn a diagnostic into a leak -- and when the bound is reached
 * `atsMore` says so, rather than the row quietly describing fewer addresses
 * than it counted.
 */

/** Addresses kept per feature before `atsMore` takes over. */
export const AT_CAP = 8;

/**
 * Record one refusal of `feature` in `map`, merging with what is already there.
 *
 * @param {Map} map      the chip's ledger
 * @param {string} feature  what was asked for and not delivered
 * @param {{symptom?: string|null, at?: number|null}} [info]
 *        `symptom`: what the program sees. `at`: the address it touched, in
 *        the PART'S OWN space -- a port number or a register offset, never a
 *        machine-bus address. The board's decode is the board's business, and
 *        a chip that baked one in would be wrong on the next board.
 * @returns {Map} the same map, for chaining
 */
export function noteRefusal(map, feature, {symptom = null, at = null} = {}) {
    const prev = map.get(feature);
    const ats = prev?.ats ? [...prev.ats] : [];
    let atsMore = prev?.atsMore ?? false;
    if (at !== null && at !== undefined && !ats.includes(at)) {
        if (ats.length < AT_CAP) ats.push(at);
        else atsMore = true;
    }
    map.set(feature, {
        count: (prev?.count ?? 0) + 1,
        // An entry keeps the symptom it was first given. A caller that passes
        // none is adding a count, not erasing an explanation.
        symptom: prev?.symptom ?? symptom ?? null,
        ats,
        atsMore,
    });
    return map;
}

export default noteRefusal;

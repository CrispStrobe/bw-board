/**
 * `hideBindings` IS PANEL-LEVEL, AND IT SURVIVES A ROUND TRIP.
 *
 * A controller widget card shows what it is bound to — `→ part.param`, or the
 * program-only label. The owner of brickwright-lite asked for a way to hide
 * that. It is panel-level rather than per widget because the per-widget flags
 * beside it (hideLabel, hideValue, hideText, hideMaxOut) each describe ONE
 * card's own face, whereas a binding line is the same kind of information on
 * every card: someone who wants it gone wants it gone everywhere, not twenty
 * times over.
 *
 * WHY THE ROUND TRIP IS THE PART WORTH GATING, and why the gate lives here
 * rather than in the consuming app. Read the comment beside `mode` in toJSON:
 * that field is also panel-level, it was omitted from serialisation for a year,
 * and the cost was four shipped example layouts opening dead — a working
 * faceplate turning into an inert one on load, with no error anywhere. A
 * panel-level setting that toJSON forgets is a setting the user sets and
 * silently loses.
 *
 * So the two directions are asserted separately. Forgetting to WRITE it and
 * forgetting to READ it are different defects with the same symptom, and a
 * single test that happened to cover only one of them would look like coverage.
 *
 * The view that renders the flag is brickwright-lite's; the serialised shape is
 * this project's, so this is where its gate belongs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerPanel } from '../src/controller.js';

test('the default is showing, and an unset flag never reaches the JSON', () => {
    const p = new ControllerPanel();
    p.addWidget('b1', 'button', {}, {});
    assert.equal(p.hideBindings, false,
        'defaulting to hidden would silently change every existing panel');
    assert.ok(!('hideBindings' in p.toJSON()),
        'an unset flag must not be emitted — panels that never touch it have to '
        + 'serialise byte-identically, or every saved project churns on the next write');
});

test('toJSON writes the flag when it is set', () => {
    const p = new ControllerPanel();
    p.addWidget('b1', 'button', {}, {});
    p.setHideBindings(true);
    assert.equal(p.toJSON().hideBindings, true,
        'the setting is lost at save time — this is the `mode` defect, repeated');
});

test('fromJSON reads it back', () => {
    // Separate from the test above ON PURPOSE. A panel that writes the flag and
    // cannot read it loses the setting on load; a panel that reads a flag it
    // never writes loses it on save. Same symptom to a user, different bug, and
    // one test covering both directions would pass while half the path was gone.
    const restored = ControllerPanel.fromJSON({
        version: 1, mode: 'edit', hideBindings: true,
        widgets: [{ name: 'b1', type: 'button', config: {}, layout: {}, binding: null }],
    });
    assert.equal(restored.hideBindings, true, 'the setting is lost at load time');
    assert.equal(restored.toJSON().hideBindings, true, 'and lost again on the next save');
});

test('an old panel without the key loads, and stays showing', () => {
    // Every controller.json shipped before this field existed. Absent must mean
    // false, not undefined-and-therefore-truthy-somewhere-later.
    const old = ControllerPanel.fromJSON({
        version: 1, mode: 'play',
        widgets: [{ name: 'b1', type: 'button', config: {}, layout: {}, binding: null }],
    });
    assert.equal(old.hideBindings, false);
    assert.ok(!('hideBindings' in old.toJSON()),
        're-saving an old panel must not add the key it never had');
});

test('setting it emits, so a view re-renders and a host persists', () => {
    const p = new ControllerPanel();
    p.addWidget('b1', 'button', {}, {});
    const seen = [];
    p.addListener((kind, detail) => seen.push([kind, detail]));

    p.setHideBindings(true);
    assert.equal(seen.length, 1, 'no event: the panel changes and nothing redraws or saves');
    assert.equal(seen[0][0], 'layout');
    assert.deepEqual(seen[0][1], { hideBindings: true });

    // Idempotent: setting the same value twice must not spam listeners, or a
    // host that persists on every event writes the project on every render.
    p.setHideBindings(true);
    assert.equal(seen.length, 1, 'a no-op set emitted anyway');
});

test('removing a widget leaves the panel serialisable and keeps the setting', () => {
    // The removal path and the new field meet here: a panel-level setting must
    // not be a casualty of a widget-level operation.
    const p = new ControllerPanel();
    p.addWidget('a', 'button', {}, { x: 1, y: 2 });
    p.addWidget('b', 'slider', {}, { x: 3, y: 4 });
    p.setHideBindings(true);
    p.removeWidget('a');

    const back = ControllerPanel.fromJSON(JSON.parse(JSON.stringify(p.toJSON())));
    assert.equal(back.getWidget('a'), null, 'the removed widget returned through the round trip');
    assert.ok(back.getWidget('b'), 'the surviving widget did not survive it');
    assert.equal(back.hideBindings, true, 'a widget removal lost the panel setting');
});

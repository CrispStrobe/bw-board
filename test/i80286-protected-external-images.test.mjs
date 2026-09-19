import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCEPTED_IMAGES,
  DIAGNOSTIC_IMAGES,
  FINITE_EXPECTATIONS,
  loadPinnedImages,
  runInt4TaskGateDiagnostic,
  runImage,
} from "../scripts/lib/protected286-external-images.mjs";
import { createOwnedExternal286Engine } from "../scripts/lib/protected286-owned-engine.mjs";

test("pinned external image set is complete and byte-exact", () => {
  const fixtures = loadPinnedImages();
  assert.equal(
    fixtures.manifest.revision,
    "3ee4c6f1178e71db8926caf999416af7f4e340b3",
  );
  assert.deepEqual(
    [...fixtures.images.keys()].sort(),
    [...ACCEPTED_IMAGES, ...DIAGNOSTIC_IMAGES].sort(),
  );
  assert.equal(fixtures.images.size, 8);
});

for (const name of ACCEPTED_IMAGES) {
  test(`${name} reaches its semantic completion boundary`, () => {
    const fixtures = loadPinnedImages();
    const result = runImage(
      createOwnedExternal286Engine(),
      name,
      fixtures.images.get(name),
    );
    if (name in FINITE_EXPECTATIONS) {
      assert.equal(result.kind, "finite");
      assert.ok(result.text.startsWith(FINITE_EXPECTATIONS[name]));
      assert.equal(result.retraceReads, 0);
    } else {
      assert.equal(result.kind, "tasks");
      assert.deepEqual(
        result.trSequence,
        [0x30, 0x38, 0x40, 0x38, 0x48, 0x38, 0x40, 0x38],
      );
      assert.equal(result.retraceReads, 800);
      assert.deepEqual(result.taskState, {
        dispatcher: { backlink: 0, flags: 0x3046, sp: 0x83fe },
        task1: { backlink: 0x38, flags: 0x46, sp: 0x8300 },
        task2: { backlink: 0x38, flags: 0x46, sp: 0x8200 },
        descriptorAccess: {
          initial: 0xe1,
          dispatcher: 0xe3,
          task1: 0xe1,
          task2: 0xe1,
        },
      });
    }
  });
}

test("int4 task gate completes two backlink returns with visible guest output", () => {
  const fixtures = loadPinnedImages();
  const result = runInt4TaskGateDiagnostic(
    createOwnedExternal286Engine(),
    fixtures.images.get("int4_tgate.img"),
  );
  assert.deepEqual(result.trSequence, [0x30, 0x38, 0x30, 0x38, 0x30]);
  assert.deepEqual(result.cplSequence, [0, 0, 3, 0, 3]);
  assert.match(result.text, /^INTO/);
});

# Cold diagnostic checkout binding

[Run 37111905310](https://github.com/CrispStrobe/bw-board/actions/runs/37111905310) failed at the initial parent source snapshot: the workflow checked out old compiled revision a6fa while the reviewed contract required 7632. The new ROM helper was absent. No artifact download, restoration or native child began. Since the initial snapshot failed, there is no complete source before/after equality claim for this attempt.

Both workflow checkout refs now come from the validated fixed contract. Setup checks each exact HEAD before sparse materialization, then verifies all 125 compiled and 52 driver current/Git source inputs before pristine-source fetching. Seven bounded pure controls passed, including local Git wrong-HEAD/missing-input refusal and a source control binding both checkout roles. No real network, restoration or guest occurred in these controls.

[Small lossless receipts](receipts/native-cold-bios-checkout-failure-20261003/index.json) preserve the authentic first error and tests. The complete official result ZIP remains externally retained with its API digest. Compiled 7632, driver8d and the new DSO are unchanged; this fix changes setup/admission plumbing only. No E16 or speed claim is made.

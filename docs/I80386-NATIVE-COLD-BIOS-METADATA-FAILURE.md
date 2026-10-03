# Cold BIOS restoration metadata failure

The second diagnostic [run 37107834752](https://github.com/CrispStrobe/bw-board/actions/runs/37107834752) at `6862d480` downloaded the authenticated original build artifact successfully, then failed during restoration static admission. No addon initialization or native guest occurred. Source and immutable download inputs remained unchanged.

The restored prepared tree failed `git rev-parse HEAD`. File-only metadata copying omits empty directories; the actual partial inventory did not retain `.git` directories, so their absence was not directly observed in the failed tree. The narrow correction preserves verified ordinary metadata directories alongside their exact file bytes. A local, nonnetwork detached Git fixture reproduces failure with file-only copying, then verifies recognition, exact HEAD and object reads after directory preservation. Six bounded source controls passed; genuine restoration with this correction remains unexecuted.

[Small lossless receipts](receipts/native-cold-bios-metadata-failure-20261003/index.json) include commands, errors, source pins and the local metadata inventory. The complete official result ZIP (artifact `11268896285`, SHA-256 `461c4aa0ef589ed21e1baed39283e0677339f692f86f6f5e9ec34f2950984a92`) remains retained externally. This is restoration preparation, with no CPU, BIOS checkpoint or speed result.

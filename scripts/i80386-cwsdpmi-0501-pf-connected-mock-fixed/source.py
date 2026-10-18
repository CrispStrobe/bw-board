#!/usr/bin/env python3
"""Git-only source closure for the separately named PF mock-corrected AT gate.

The launched diagnostic's source.py is data, never imported or executed here.
Its original 238-role/71-node receipt is reconstructed from reviewed Git
objects and compared byte-for-byte with the retained receipt hash.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys

HELD_BASE = "6c342303f619035b5037426cef335d059628e3dc"
FIXED_BASE = "2fc9d71fd9cbd0585ea50f1b81133f18c150c78c"
ORIGINAL_RECEIPT_SHA256 = "203ac8c4c4c9df2d40d8baeb1d7ebe1b73bc24621bfbd0fbafcf4843e144c445"
NEW = "scripts/i80386-cwsdpmi-0501-pf-connected-mock-fixed/"
WORKFLOW = ".github/workflows/i80386-cwsdpmi-0501-pf-connected-mock-fixed.yml"
NEW_ROLES = frozenset(NEW + role for role in
    ("README.md", "source.py", "source-control.py")) | {WORKFLOW}
MOCK_CONTROL = "scripts/i80386-cwsdpmi-0501-pf-connected/orchestration-control.mjs"
MOCK_WORKFLOW = ".github/workflows/i80386-cwsdpmi-0501-pf-mock-control.yml"
CORRECTED = {
    MOCK_CONTROL: "f742639881b5ce62d3e4b9734066427ea7cac67592dee53e2329d31271176ecd",
    MOCK_WORKFLOW: "571496fbcb4b0a3e62f88a994e14f758bf546f2bce4031278f7c3417bd88d10e",
}

# Data copied from the retained, independently Git-verified launched receipt.
# No old producer module is imported, and the exact serialized receipt hash
# below binds this roster, graph, metadata, and all 238 held Git blob hashes.
BASELINE_ROLES = frozenset(('.github/workflows/i80386-cwsdpmi-0501-far-at.yml',
 '.github/workflows/i80386-cwsdpmi-0501-pf-connected.yml',
 '.github/workflows/i80386-cwsdpmi-0501-task-mode.yml',
 'package.json',
 'roms/free-at-bios/BIOS-bochs-legacy',
 'roms/free-at-bios/LICENSE',
 'roms/free-at-bios/README.md',
 'roms/free-at-bios/vgabios-lgpl.bin',
 'scripts/i80386-cwsdpmi-0501-far-at/README.md',
 'scripts/i80386-cwsdpmi-0501-far-at/grade-control.py',
 'scripts/i80386-cwsdpmi-0501-far-at/grade.py',
 'scripts/i80386-cwsdpmi-0501-far-at/inventory-control.py',
 'scripts/i80386-cwsdpmi-0501-far-at/inventory.py',
 'scripts/i80386-cwsdpmi-0501-far-at/source-control.py',
 'scripts/i80386-cwsdpmi-0501-far-at/source.py',
 'scripts/i80386-cwsdpmi-0501-far-attribution/README.md',
 'scripts/i80386-cwsdpmi-0501-frame-at/README.md',
 'scripts/i80386-cwsdpmi-0501-frame-at/adapter.mjs',
 'scripts/i80386-cwsdpmi-0501-frame-at/admit.mjs',
 'scripts/i80386-cwsdpmi-0501-frame-at/driver.mjs',
 'scripts/i80386-cwsdpmi-0501-frame-at/orchestration.mjs',
 'scripts/i80386-cwsdpmi-0501-frame-at/policy.mjs',
 'scripts/i80386-cwsdpmi-0501-frame-at/references.mjs',
 'scripts/i80386-cwsdpmi-0501-frame-at/source-control.py',
 'scripts/i80386-cwsdpmi-0501-frame-at/source.py',
 'scripts/i80386-cwsdpmi-0501-pf-connected/README.md',
 'scripts/i80386-cwsdpmi-0501-pf-connected/adapter.mjs',
 'scripts/i80386-cwsdpmi-0501-pf-connected/driver.mjs',
 'scripts/i80386-cwsdpmi-0501-pf-connected/grade-control.mjs',
 'scripts/i80386-cwsdpmi-0501-pf-connected/grade.mjs',
 'scripts/i80386-cwsdpmi-0501-pf-connected/inventory-control.py',
 'scripts/i80386-cwsdpmi-0501-pf-connected/inventory.py',
 'scripts/i80386-cwsdpmi-0501-pf-connected/orchestration-control.mjs',
 'scripts/i80386-cwsdpmi-0501-pf-connected/orchestration.mjs',
 'scripts/i80386-cwsdpmi-0501-pf-connected/source-control.py',
 'scripts/i80386-cwsdpmi-0501-pf-connected/source.py',
 'scripts/i80386-cwsdpmi-0501-pf-outcome/README.md',
 'scripts/i80386-cwsdpmi-0501-task-excursion/README.md',
 'scripts/i80386-cwsdpmi-0501-task-excursion/adapter.mjs',
 'scripts/i80386-cwsdpmi-0501-task-excursion/driver.mjs',
 'scripts/i80386-cwsdpmi-0501-task-excursion/inventory-control.py',
 'scripts/i80386-cwsdpmi-0501-task-excursion/inventory.py',
 'scripts/i80386-cwsdpmi-0501-task-excursion/orchestration-control.mjs',
 'scripts/i80386-cwsdpmi-0501-task-excursion/orchestration.mjs',
 'scripts/i80386-cwsdpmi-0501-task-excursion/source-control.py',
 'scripts/i80386-cwsdpmi-0501-task-excursion/source.py',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/README.md',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/adapter.mjs',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/driver.mjs',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/inventory-control.py',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/inventory.py',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/orchestration-control.mjs',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/orchestration.mjs',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/source-control.py',
 'scripts/i80386-cwsdpmi-0501-task-mode-at/source.py',
 'scripts/i80386-cwsdpmi-0501-task-mode/README.md',
 'scripts/i80386-cwsdpmi-at-completion/README.md',
 'scripts/i80386-cwsdpmi-at-completion/driver-control.mjs',
 'scripts/i80386-cwsdpmi-at-completion/driver.mjs',
 'scripts/i80386-cwsdpmi-at-completion/grade-control.mjs',
 'scripts/i80386-cwsdpmi-at-completion/grade.mjs',
 'scripts/i80386-cwsdpmi-at-completion/source-control.py',
 'scripts/i80386-cwsdpmi-at-completion/source.py',
 'scripts/i80386-cwsdpmi-at-loaded-actual/README.md',
 'scripts/i80386-cwsdpmi-at-loaded-actual/cut-control.mjs',
 'scripts/i80386-cwsdpmi-at-loaded-actual/cut.mjs',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/FIRST-RESULTS-RECEIPT.json',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/FIRST-RESULTS.md',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/README.md',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/SECOND-RESULTS-RECEIPT.json',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/SECOND-RESULTS.md',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/THIRD-RESULTS-RECEIPT.json',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/THIRD-RESULTS.md',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/driver-control.mjs',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/driver.mjs',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/source-control.py',
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/source.py',
 'scripts/i80386-cwsdpmi-at-loaded/README.md',
 'scripts/i80386-cwsdpmi-at-loaded/passive-ram-control.mjs',
 'scripts/i80386-cwsdpmi-at-loaded/passive-ram.mjs',
 'scripts/i80386-cwsdpmi-at-owned-code/FOURTH-RESULTS-RECEIPT.json',
 'scripts/i80386-cwsdpmi-at-owned-code/FOURTH-RESULTS.md',
 'scripts/i80386-cwsdpmi-at-owned-code/README.md',
 'scripts/i80386-cwsdpmi-at-owned-code/cut-control.mjs',
 'scripts/i80386-cwsdpmi-at-owned-code/cut.mjs',
 'scripts/i80386-cwsdpmi-at-owned/README.md',
 'scripts/i80386-cwsdpmi-at-owned/binding-control.mjs',
 'scripts/i80386-cwsdpmi-at-owned/binding.mjs',
 'scripts/i80386-cwsdpmi-compile-only/QEMU-GATE.md',
 'scripts/i80386-cwsdpmi-compile-only/README.md',
 'scripts/i80386-cwsdpmi-compile-only/RESULTS.md',
 'scripts/i80386-cwsdpmi-compile-only/compile-control.py',
 'scripts/i80386-cwsdpmi-compile-only/compile.py',
 'scripts/i80386-cwsdpmi-compile-only/source.py',
 'scripts/i80386-cwsdpmi-highmem-at/README.md',
 'scripts/i80386-cwsdpmi-highmem-at/binding-control.mjs',
 'scripts/i80386-cwsdpmi-highmem-at/binding.mjs',
 'scripts/i80386-cwsdpmi-highmem-at/cut-control.mjs',
 'scripts/i80386-cwsdpmi-highmem-at/driver-control.mjs',
 'scripts/i80386-cwsdpmi-highmem-at/driver.mjs',
 'scripts/i80386-cwsdpmi-highmem-at/grade-control.mjs',
 'scripts/i80386-cwsdpmi-highmem-at/grade.mjs',
 'scripts/i80386-cwsdpmi-highmem-at/owned-cut.mjs',
 'scripts/i80386-cwsdpmi-highmem-at/source-control.py',
 'scripts/i80386-cwsdpmi-highmem-at/source.py',
 'scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs',
 'scripts/i80386-cwsdpmi-highmem-timer/README.md',
 'scripts/i80386-cwsdpmi-highmem-timer/client.c',
 'scripts/i80386-cwsdpmi-highmem-timer/compile-adapter-control.py',
 'scripts/i80386-cwsdpmi-highmem-timer/compile-adapter.py',
 'scripts/i80386-cwsdpmi-highmem-timer/grade-control.py',
 'scripts/i80386-cwsdpmi-highmem-timer/grade.py',
 'scripts/i80386-cwsdpmi-highmem-timer/inventory-control.py',
 'scripts/i80386-cwsdpmi-highmem-timer/inventory.py',
 'scripts/i80386-cwsdpmi-highmem-timer/media-control.mjs',
 'scripts/i80386-cwsdpmi-highmem-timer/media.mjs',
 'scripts/i80386-cwsdpmi-highmem-timer/oracle-control.py',
 'scripts/i80386-cwsdpmi-highmem-timer/oracle.py',
 'scripts/i80386-cwsdpmi-highmem-timer/source-control.py',
 'scripts/i80386-cwsdpmi-highmem-timer/source.py',
 'scripts/i80386-cwsdpmi-owned/acquire.py',
 'scripts/i80386-cwsdpmi-owned/client.c',
 'scripts/i80386-cwsdpmi-qemu-owned/README.md',
 'scripts/i80386-cwsdpmi-qemu-owned/media-control.mjs',
 'scripts/i80386-cwsdpmi-qemu-owned/media.mjs',
 'scripts/i80386-cwsdpmi-qemu-owned/oracle-control.py',
 'scripts/i80386-cwsdpmi-qemu-owned/oracle.py',
 'scripts/i80386-cwsdpmi-qemu-owned/package-control.py',
 'scripts/i80386-cwsdpmi-qemu-owned/package.py',
 'scripts/i80386-cwsdpmi-qemu-owned/runtime.py',
 'scripts/i80386-cwsdpmi-qemu-owned/source-control.py',
 'scripts/i80386-cwsdpmi-qemu-owned/source.py',
 'scripts/i80386-dos32a-owned/ACTUAL-GATE.md',
 'scripts/i80386-dos32a-owned/README.md',
 'scripts/i80386-dos32a-owned/acquire-control.py',
 'scripts/i80386-dos32a-owned/acquire.py',
 'scripts/i80386-dos32a-owned/build.py',
 'scripts/i80386-dos32a-owned/compare-control.py',
 'scripts/i80386-dos32a-owned/compare.py',
 'scripts/i80386-dos32a-owned/control.py',
 'scripts/i80386-dos32a-owned/grade-control.mjs',
 'scripts/i80386-dos32a-owned/grade.mjs',
 'scripts/i80386-dos32a-owned/keyboard-control.mjs',
 'scripts/i80386-dos32a-owned/keyboard.mjs',
 'scripts/i80386-dos32a-owned/media-control.mjs',
 'scripts/i80386-dos32a-owned/media.mjs',
 'scripts/i80386-dos32a-owned/oracle-control.py',
 'scripts/i80386-dos32a-owned/oracle.py',
 'scripts/i80386-dos32a-owned/source-control.py',
 'scripts/i80386-dos32a-owned/source.py',
 'scripts/i80386-dos32a-owned/target.mjs',
 'scripts/lib/ab-order.mjs',
 'scripts/lib/at-dos-acceptance.mjs',
 'scripts/lib/f0-gpio-profile-receipt.mjs',
 'scripts/lib/f0-timing-receipt.mjs',
 'scripts/lib/fast286-verdict.mjs',
 'scripts/lib/fastpath-census-receipt.mjs',
 'scripts/lib/freedos-at-acceptance.mjs',
 'scripts/lib/harris-browser-measurement.mjs',
 'scripts/lib/harris-native-boot-oracle.mjs',
 'scripts/lib/harris-native-bus-circuit-oracle.mjs',
 'scripts/lib/harris-native-bus-sequencer-oracle.mjs',
 'scripts/lib/harris-native-memory-circuit-oracle.mjs',
 'scripts/lib/harris-native-memory-oracle.mjs',
 'scripts/lib/harris-native-phase-circuit-oracle.mjs',
 'scripts/lib/harris-native-phase-oracle.mjs',
 'scripts/lib/harris-native-phase-schedule-oracle.mjs',
 'scripts/lib/harris-native-settle-oracle.mjs',
 'scripts/lib/harris-owned-workloads.mjs',
 'scripts/lib/i80386-at-console-events.mjs',
 'scripts/lib/i80386-at-dosbox-config.mjs',
 'scripts/lib/i80386-at-hdd-image.mjs',
 'scripts/lib/i80386-at-terminal.mjs',
 'scripts/lib/i80386-doom-fat16-image.mjs',
 'scripts/lib/i80386-doom-short-demo-acceptance.mjs',
 'scripts/lib/i80386-doom-vga-frame.mjs',
 'scripts/lib/i80386-fetch-cursor-eligibility.mjs',
 'scripts/lib/i80386-free-bios-fat16.mjs',
 'scripts/lib/i80386-source-inventory.mjs',
 'scripts/lib/i80386-vga-bios-grade.mjs',
 'scripts/lib/i80386-windows-pointer-feedback.mjs',
 'scripts/lib/i80386-windows-vga-480-frame.mjs',
 'scripts/lib/i80386-windows-vga-frame.mjs',
 'scripts/lib/local-resource-preflight.mjs',
 'scripts/lib/minimize-x86-oracle-probe.mjs',
 'scripts/lib/moo386-v1.mjs',
 'scripts/lib/motion-ab-receipt.mjs',
 'scripts/lib/paterson-routines.mjs',
 'scripts/lib/private-guest-fixtures.mjs',
 'scripts/lib/protected286-external-images.mjs',
 'scripts/lib/protected286-owned-engine.mjs',
 'scripts/lib/same-host-orders.mjs',
 'scripts/lib/sst286.mjs',
 'scripts/lib/wasm-cpu-inspection.mjs',
 'scripts/lib/wasm-edge-inspection.mjs',
 'scripts/lib/wasm-motion-profile.mjs',
 'scripts/lib/window-cpu-profiler.mjs',
 'scripts/lib/x86-oracle-local.mjs',
 'scripts/lib/x86-owned-oracle-probes.mjs',
 'scripts/lib/xv6-serial-tee.mjs',
 'src/adc0809.js',
 'src/at-8042-a20.js',
 'src/at-ps2-mouse.js',
 'src/at-system-control.js',
 'src/audio-bus.js',
 'src/cga-card.js',
 'src/chip-ledger.js',
 'src/dac0832.js',
 'src/ega-card.js',
 'src/experimental/ata16.js',
 'src/experimental/i80286-protected.js',
 'src/experimental/i80386-at-machine.js',
 'src/experimental/i80386.js',
 'src/experimental/vga-memory.js',
 'src/hercules-card.js',
 'src/i8086-machine.js',
 'src/i8086-ram-words.js',
 'src/i8086.js',
 'src/i8237.js',
 'src/i8251.js',
 'src/i8254.js',
 'src/i8255.js',
 'src/i8259.js',
 'src/machine-checkpoint.js',
 'src/mc146818.js',
 'src/mc6845.js',
 'src/mc6850.js',
 'src/ne2000.js',
 'src/ns16c550.js',
 'src/pc-speaker.js',
 'src/sb-dsp.js',
 'src/upd765.js',
 'src/vga-card.js',
 'src/ym3812.js',
 'test/i80386-0501-fault-outcome.test.mjs',
 'test/i80386-0501-frame-orchestration.test.mjs',
 'test/i80386-0501-frame-policy.test.mjs',
 'test/i80386-dpmi-frame-journal.test.mjs'))
BASELINE_GRAPH = {'scripts/i80386-cwsdpmi-0501-frame-at/admit.mjs': ['scripts/i80386-cwsdpmi-highmem-at/binding.mjs'],
 'scripts/i80386-cwsdpmi-0501-frame-at/orchestration.mjs': ['scripts/i80386-cwsdpmi-0501-frame-at/policy.mjs'],
 'scripts/i80386-cwsdpmi-0501-frame-at/policy.mjs': [],
 'scripts/i80386-cwsdpmi-0501-frame-at/references.mjs': [],
 'scripts/i80386-cwsdpmi-0501-pf-connected/adapter.mjs': ['scripts/i80386-cwsdpmi-0501-frame-at/admit.mjs',
                                                          'scripts/i80386-cwsdpmi-0501-pf-connected/driver.mjs',
                                                          'scripts/i80386-cwsdpmi-at-loaded-main-gate/driver.mjs',
                                                          'scripts/i80386-cwsdpmi-highmem-at/owned-cut.mjs',
                                                          'scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs',
                                                          'scripts/i80386-cwsdpmi-highmem-timer/media.mjs',
                                                          'scripts/i80386-dos32a-owned/keyboard.mjs',
                                                          'scripts/i80386-dos32a-owned/media.mjs',
                                                          'src/experimental/i80386-at-machine.js'],
 'scripts/i80386-cwsdpmi-0501-pf-connected/driver.mjs': ['scripts/i80386-cwsdpmi-0501-frame-at/admit.mjs',
                                                         'scripts/i80386-cwsdpmi-0501-frame-at/orchestration.mjs',
                                                         'scripts/i80386-cwsdpmi-0501-frame-at/references.mjs',
                                                         'scripts/i80386-cwsdpmi-0501-pf-connected/grade.mjs',
                                                         'scripts/i80386-cwsdpmi-0501-pf-connected/orchestration.mjs',
                                                         'scripts/i80386-cwsdpmi-at-loaded/passive-ram.mjs',
                                                         'scripts/i80386-cwsdpmi-highmem-at/binding.mjs',
                                                         'scripts/i80386-cwsdpmi-highmem-at/driver.mjs',
                                                         'scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs'],
 'scripts/i80386-cwsdpmi-0501-pf-connected/grade-control.mjs': ['scripts/i80386-cwsdpmi-0501-pf-connected/grade.mjs'],
 'scripts/i80386-cwsdpmi-0501-pf-connected/grade.mjs': [],
 'scripts/i80386-cwsdpmi-0501-pf-connected/orchestration-control.mjs': ['scripts/i80386-cwsdpmi-0501-pf-connected/orchestration.mjs'],
 'scripts/i80386-cwsdpmi-0501-pf-connected/orchestration.mjs': [],
 'scripts/i80386-cwsdpmi-0501-task-mode-at/adapter.mjs': ['scripts/i80386-cwsdpmi-0501-frame-at/admit.mjs',
                                                          'scripts/i80386-cwsdpmi-0501-task-mode-at/driver.mjs',
                                                          'scripts/i80386-cwsdpmi-at-loaded-main-gate/driver.mjs',
                                                          'scripts/i80386-cwsdpmi-highmem-at/owned-cut.mjs',
                                                          'scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs',
                                                          'scripts/i80386-cwsdpmi-highmem-timer/media.mjs',
                                                          'scripts/i80386-dos32a-owned/keyboard.mjs',
                                                          'scripts/i80386-dos32a-owned/media.mjs',
                                                          'src/experimental/i80386-at-machine.js'],
 'scripts/i80386-cwsdpmi-0501-task-mode-at/driver.mjs': ['scripts/i80386-cwsdpmi-0501-frame-at/admit.mjs',
                                                         'scripts/i80386-cwsdpmi-0501-frame-at/orchestration.mjs',
                                                         'scripts/i80386-cwsdpmi-0501-frame-at/references.mjs',
                                                         'scripts/i80386-cwsdpmi-0501-task-mode-at/orchestration.mjs',
                                                         'scripts/i80386-cwsdpmi-at-loaded/passive-ram.mjs',
                                                         'scripts/i80386-cwsdpmi-highmem-at/binding.mjs',
                                                         'scripts/i80386-cwsdpmi-highmem-at/driver.mjs',
                                                         'scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs'],
 'scripts/i80386-cwsdpmi-0501-task-mode-at/orchestration-control.mjs': ['scripts/i80386-cwsdpmi-0501-task-mode-at/orchestration.mjs'],
 'scripts/i80386-cwsdpmi-0501-task-mode-at/orchestration.mjs': [],
 'scripts/i80386-cwsdpmi-at-loaded-actual/cut.mjs': ['scripts/i80386-cwsdpmi-at-loaded/passive-ram.mjs',
                                                     'scripts/i80386-cwsdpmi-at-owned/binding.mjs'],
 'scripts/i80386-cwsdpmi-at-loaded-main-gate/driver.mjs': ['scripts/i80386-cwsdpmi-at-loaded-actual/cut.mjs',
                                                           'scripts/i80386-cwsdpmi-at-owned/binding.mjs',
                                                           'scripts/i80386-cwsdpmi-qemu-owned/media.mjs',
                                                           'scripts/i80386-dos32a-owned/keyboard.mjs',
                                                           'src/experimental/i80386-at-machine.js'],
 'scripts/i80386-cwsdpmi-at-loaded/passive-ram-control.mjs': ['scripts/i80386-cwsdpmi-at-loaded/passive-ram.mjs',
                                                              'src/experimental/vga-memory.js'],
 'scripts/i80386-cwsdpmi-at-loaded/passive-ram.mjs': ['src/experimental/vga-memory.js'],
 'scripts/i80386-cwsdpmi-at-owned/binding.mjs': [],
 'scripts/i80386-cwsdpmi-highmem-at/binding-control.mjs': ['scripts/i80386-cwsdpmi-highmem-at/binding.mjs'],
 'scripts/i80386-cwsdpmi-highmem-at/binding.mjs': [],
 'scripts/i80386-cwsdpmi-highmem-at/cut-control.mjs': ['scripts/i80386-cwsdpmi-highmem-at/binding.mjs',
                                                       'scripts/i80386-cwsdpmi-highmem-at/owned-cut.mjs',
                                                       'scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs',
                                                       'src/experimental/vga-memory.js'],
 'scripts/i80386-cwsdpmi-highmem-at/driver-control.mjs': ['scripts/i80386-cwsdpmi-highmem-at/driver.mjs',
                                                          'scripts/i80386-cwsdpmi-highmem-at/grade.mjs',
                                                          'scripts/i80386-cwsdpmi-highmem-timer/media.mjs'],
 'scripts/i80386-cwsdpmi-highmem-at/driver.mjs': ['scripts/i80386-cwsdpmi-at-loaded-main-gate/driver.mjs',
                                                  'scripts/i80386-cwsdpmi-highmem-at/binding.mjs',
                                                  'scripts/i80386-cwsdpmi-highmem-at/grade.mjs',
                                                  'scripts/i80386-cwsdpmi-highmem-at/owned-cut.mjs',
                                                  'scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs',
                                                  'scripts/i80386-cwsdpmi-highmem-timer/media.mjs',
                                                  'scripts/i80386-dos32a-owned/keyboard.mjs',
                                                  'scripts/i80386-dos32a-owned/media.mjs',
                                                  'src/experimental/i80386-at-machine.js'],
 'scripts/i80386-cwsdpmi-highmem-at/grade-control.mjs': ['scripts/i80386-cwsdpmi-highmem-at/grade.mjs',
                                                         'scripts/i80386-cwsdpmi-highmem-timer/media.mjs'],
 'scripts/i80386-cwsdpmi-highmem-at/grade.mjs': ['scripts/i80386-cwsdpmi-highmem-timer/media.mjs',
                                                 'scripts/i80386-dos32a-owned/keyboard.mjs'],
 'scripts/i80386-cwsdpmi-highmem-at/owned-cut.mjs': ['scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs'],
 'scripts/i80386-cwsdpmi-highmem-at/strict-cut.mjs': ['scripts/i80386-cwsdpmi-at-loaded/passive-ram.mjs',
                                                      'scripts/i80386-cwsdpmi-highmem-at/binding.mjs'],
 'scripts/i80386-cwsdpmi-highmem-timer/media-control.mjs': ['scripts/i80386-cwsdpmi-highmem-timer/media.mjs'],
 'scripts/i80386-cwsdpmi-highmem-timer/media.mjs': ['scripts/lib/i80386-free-bios-fat16.mjs'],
 'scripts/i80386-cwsdpmi-qemu-owned/media.mjs': ['scripts/lib/i80386-free-bios-fat16.mjs'],
 'scripts/i80386-dos32a-owned/keyboard.mjs': [],
 'scripts/i80386-dos32a-owned/media.mjs': ['scripts/lib/i80386-free-bios-fat16.mjs'],
 'scripts/lib/i80386-free-bios-fat16.mjs': [],
 'src/adc0809.js': [],
 'src/at-8042-a20.js': ['src/at-ps2-mouse.js'],
 'src/at-ps2-mouse.js': [],
 'src/at-system-control.js': [],
 'src/audio-bus.js': [],
 'src/cga-card.js': ['src/mc6845.js'],
 'src/chip-ledger.js': [],
 'src/dac0832.js': [],
 'src/ega-card.js': [],
 'src/experimental/ata16.js': [],
 'src/experimental/i80286-protected.js': ['src/i8086.js'],
 'src/experimental/i80386-at-machine.js': ['src/experimental/ata16.js',
                                           'src/experimental/i80386.js',
                                           'src/experimental/vga-memory.js',
                                           'src/i8086-machine.js'],
 'src/experimental/i80386.js': [],
 'src/experimental/vga-memory.js': [],
 'src/hercules-card.js': [],
 'src/i8086-machine.js': ['src/adc0809.js',
                          'src/at-8042-a20.js',
                          'src/at-system-control.js',
                          'src/audio-bus.js',
                          'src/cga-card.js',
                          'src/dac0832.js',
                          'src/ega-card.js',
                          'src/experimental/i80286-protected.js',
                          'src/hercules-card.js',
                          'src/i8086-ram-words.js',
                          'src/i8086.js',
                          'src/i8237.js',
                          'src/i8251.js',
                          'src/i8254.js',
                          'src/i8255.js',
                          'src/i8259.js',
                          'src/machine-checkpoint.js',
                          'src/mc146818.js',
                          'src/mc6850.js',
                          'src/ne2000.js',
                          'src/ns16c550.js',
                          'src/pc-speaker.js',
                          'src/sb-dsp.js',
                          'src/upd765.js',
                          'src/vga-card.js',
                          'src/ym3812.js'],
 'src/i8086-ram-words.js': [],
 'src/i8086.js': [],
 'src/i8237.js': ['src/chip-ledger.js'],
 'src/i8251.js': [],
 'src/i8254.js': [],
 'src/i8255.js': [],
 'src/i8259.js': [],
 'src/machine-checkpoint.js': [],
 'src/mc146818.js': [],
 'src/mc6845.js': [],
 'src/mc6850.js': [],
 'src/ne2000.js': [],
 'src/ns16c550.js': [],
 'src/pc-speaker.js': [],
 'src/sb-dsp.js': ['src/chip-ledger.js'],
 'src/upd765.js': [],
 'src/vga-card.js': [],
 'src/ym3812.js': ['src/chip-ledger.js'],
 'test/i80386-0501-fault-outcome.test.mjs': ['src/experimental/i80386.js'],
 'test/i80386-0501-frame-orchestration.test.mjs': ['scripts/i80386-cwsdpmi-0501-frame-at/orchestration.mjs',
                                                   'scripts/i80386-cwsdpmi-0501-frame-at/policy.mjs',
                                                   'scripts/i80386-cwsdpmi-0501-frame-at/references.mjs'],
 'test/i80386-0501-frame-policy.test.mjs': ['scripts/i80386-cwsdpmi-0501-frame-at/admit.mjs',
                                            'scripts/i80386-cwsdpmi-0501-frame-at/policy.mjs']}
BASELINE_REVIEWED_DIAGNOSTIC_ROLES = {'scripts/i80386-cwsdpmi-0501-pf-outcome/README.md': '5316d82b1f30883305278ab4d34096066f80e5dfa066a141ab0f6447e463e2a2',
 'src/experimental/i80386.js': 'd927f4b90efaf14aeaa5bea7ed94897157203ce496e434b569aecb85e0d865c2',
 'test/i80386-0501-fault-outcome.test.mjs': '1f569a851d399cee08e393d4419aff1aab4c864e9b19666c4ebd45294649fcea'}

IMPORT_FROM = re.compile(r"^\s*(?:import|export)\s+[^\n;]*?\bfrom\s*['\"]([^'\"]+)['\"]", re.M)
IMPORT_CONTINUED = re.compile(r"^\s*}\s*from\s*['\"]([^'\"]+)['\"]", re.M)
IMPORT_NAMED_MULTILINE = re.compile(
    r"^\s*(?:import|export)\s*\{[A-Za-z0-9_$,\s]{0,4096}\}\s*from\s*['\"]([^'\"]+)['\"]", re.M)
IMPORT_SIDE = re.compile(r"^\s*import\s*['\"]([^'\"]+)['\"]", re.M)
IMPORT_DYNAMIC = re.compile(r"\bimport\s*\(")


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(("git", "--no-replace-objects", *args),
        env={**os.environ, "GIT_NO_REPLACE_OBJECTS": "1"}, stderr=subprocess.DEVNULL)


def blob(revision, role):
    return git("show", f"{revision}:{role}")


def live_role(role, maximum=2 << 20):
    path = Path(role)
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= maximum:
        raise ValueError("source role type/size: " + role)
    identity = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(fd)
        if not stat.S_ISREG(opened.st_mode) or (
                opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns) != identity:
            raise ValueError("source role changed before read: " + role)
        with os.fdopen(fd, "rb", closefd=False) as stream:
            raw = stream.read(maximum + 1)
        after = os.fstat(fd)
        after_path = path.lstat()
        if (len(raw) != before.st_size or len(raw) > maximum or
                not stat.S_ISREG(after.st_mode) or not stat.S_ISREG(after_path.st_mode) or
                (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != identity or
                (after_path.st_dev, after_path.st_ino,
                 after_path.st_size, after_path.st_mtime_ns) != identity):
            raise ValueError("source role changed during read: " + role)
        return raw
    finally:
        os.close(fd)


def imported(role, raw, names):
    if not role.endswith((".js", ".mjs")):
        return set()
    source = raw.decode("utf-8")
    if IMPORT_DYNAMIC.search(source):
        raise ValueError("unreviewed dynamic JS import: " + role)
    found = set()
    for specifier in (IMPORT_FROM.findall(source) + IMPORT_CONTINUED.findall(source) +
                      IMPORT_NAMED_MULTILINE.findall(source) + IMPORT_SIDE.findall(source)):
        if specifier.startswith("node:") or specifier == "fs":
            continue
        if not specifier.startswith("."):
            raise ValueError("unbound JS import: " + role)
        resolved = os.path.normpath(os.path.join(os.path.dirname(role), specifier))
        if (resolved.startswith("../") or resolved not in names or
                not resolved.endswith((".js", ".mjs"))):
            raise ValueError("missing/broad JS import: " + role)
        found.add(resolved)
    return found


def baseline_receipt():
    roles = {role: sha(blob(HELD_BASE, role)) for role in BASELINE_ROLES}
    receipt = {"schema": "bw.cwsdpmi-0501-pf-connected.at-source.v1",
        "head": HELD_BASE,
        "inheritedBase": "72d0b32e8bd7d658447745129119e2300ad6bec1",
        "reviewedPfBase": "33d53542aa4375f9eb4c3c508ecf9bc8b1bba0d9",
        "reviewedDiagnosticRoles": BASELINE_REVIEWED_DIAGNOSTIC_ROLES,
        "roles": roles,
        "recursiveImports": BASELINE_GRAPH}
    raw = (json.dumps(receipt, indent=2, sort_keys=True) + "\n").encode()
    if len(roles) != 238 or len(BASELINE_GRAPH) != 71 or sha(raw) != ORIGINAL_RECEIPT_SHA256:
        raise ValueError("original reviewed PF source receipt differs")
    return receipt


def identity(expected):
    if len(expected) != 40 or any(c not in "0123456789abcdef" for c in expected):
        raise ValueError("expected head shape")
    head = git("rev-parse", "HEAD").decode().strip()
    if head != expected or git("status", "--porcelain"):
        raise ValueError("not exact clean source checkout")
    git("merge-base", "--is-ancestor", HELD_BASE, FIXED_BASE)
    git("merge-base", "--is-ancestor", FIXED_BASE, head)
    if set(git("diff", "--name-only", HELD_BASE, FIXED_BASE).decode().splitlines()) != set(CORRECTED):
        raise ValueError("reviewed mock correction scope changed")
    for role, digest in CORRECTED.items():
        if sha(blob(FIXED_BASE, role)) != digest:
            raise ValueError("reviewed mock correction bytes changed: " + role)
    names = set(git("ls-tree", "-r", "--name-only", head).decode().splitlines())
    if set(git("diff", "--name-only", FIXED_BASE, head).decode().splitlines()) != NEW_ROLES or \
       not NEW_ROLES <= names or \
       {name for name in names if name.startswith(NEW)} != NEW_ROLES - {WORKFLOW}:
        raise ValueError("new PF profile scope differs")
    baseline = baseline_receipt()
    if MOCK_WORKFLOW in BASELINE_ROLES or MOCK_WORKFLOW not in names:
        raise ValueError("mock workflow provenance")
    roles = {}
    for role in sorted(set(BASELINE_ROLES) | {MOCK_WORKFLOW} | NEW_ROLES):
        raw = live_role(role)
        if raw != blob(head, role):
            raise ValueError("source differs from Git: " + role)
        if role in BASELINE_ROLES:
            original = blob(FIXED_BASE if role == MOCK_CONTROL else HELD_BASE, role)
            if raw != original:
                raise ValueError("held source role changed: " + role)
        elif role == MOCK_WORKFLOW and sha(raw) != CORRECTED[role]:
            raise ValueError("mock workflow differs from reviewed correction")
        roles[role] = sha(raw)
    if len(roles) != 243:
        raise ValueError("PF mock-fixed source role census")
    for role, deps in BASELINE_GRAPH.items():
        if sorted(imported(role, blob(head, role), names)) != deps:
            raise ValueError("recursive JS import edge differs: " + role)
    if not set(BASELINE_GRAPH) <= set(roles) or any(
            not set(deps) <= set(BASELINE_GRAPH) for deps in BASELINE_GRAPH.values()):
        raise ValueError("recursive JS graph closure")
    return {"schema": "bw.cwsdpmi-0501-pf-connected-mock-fixed.at-source.v1",
        "head": head, "launchedBase": HELD_BASE, "correctedMockBase": FIXED_BASE,
        "reviewedOriginalSourceSha256": ORIGINAL_RECEIPT_SHA256,
        "reviewedCorrectionRoles": CORRECTED,
        "roles": roles, "recursiveImports": BASELINE_GRAPH,
        "baselineRoles": len(baseline["roles"])}


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: source.py expected-head output.json")
    with Path(sys.argv[2]).open("x", encoding="utf-8") as output:
        json.dump(identity(sys.argv[1]), output, indent=2, sort_keys=True)
        output.write("\n")

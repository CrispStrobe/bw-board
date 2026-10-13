Two real MakeCode images for `test/labwired-radio-pair.test.mjs`: a remote and
the car it steers, talking over `radio`.

* `remote.ts` — the sender, a BBC micro:bit V1 program: button A down sends 0,
  up 1; button B down sends 2, up 3 (group 1).
* `car.ts` — the receiver, a Calliope mini 1.x program: 0/1 switch motor A to
  50 % / off, 2/3 motor B.
* `remote.elf`, `car.elf` — the APPLICATION region only (0x18000 upward) of
  the `.hex` MakeCode's own compiler produces for each, wrapped as an ELF by
  `src/hex-app-region.js`. The Nordic S110 SoftDevice and the bootloader that
  the `.hex` also carries are NOT in these files and are never loaded: the
  engine emulates the SoftDevice API.

Built offline with the compilers and base images of pxt-microbit 9.1.1
(pxt-core 13.0.1; dependencies `core`, `radio`; `mbdal-binary.hex`) and
pxt-calliope 3.0.30 (pxt-core 6.0.23; dependencies `core`, `radio`;
`binary.hex`). A rebuild from the same sources and versions has not been
compared byte for byte; it must reproduce the behaviour the test asserts.

```
9be7dd355bd452048956e4cbd0ba3eefddf362bcb5bdedd1db4d77760ec810f6  remote.elf
2a5ecd44100d6b07e639248aa52bb06c7bcbea5a09d538ed0c4dedf2d2a05657  car.elf
286d835a95a773371301c1371a51823bfad0a79fc0d4f40b27ffc06a7996bc06  remote.ts
05cffdaab9baf7d7481a6f087109b555aac0479f0d531b97cf8cbb6f4785620c  car.ts
```

What the application region is made of, and under which terms it is
redistributed here in binary form:

* the MakeCode runtime and the compiled program — pxt-microbit, pxt-calliope,
  pxt-core: MIT, Copyright (c) Microsoft Corporation;
* the device runtime — lancaster-university/microbit-dal and
  calliope-mini/microbit-dal: MIT, Copyright (c) 2016 British Broadcasting
  Corporation and contributors; Calliope gGmbH for the Calliope parts;
* mbed-classic (ARM mbed HAL and the nRF51 target): Apache-2.0, Copyright (c)
  ARM Limited;
* lancaster-university/nrf51-sdk (startup and peripheral drivers): BSD-3-Clause,
  Copyright (c) Nordic Semiconductor ASA;
* the BLE API glue (ble, ble-nrf51822): Apache-2.0, Copyright (c) ARM Limited.

This list was read from those projects' licence files, not derived from a
linker map of these two builds.

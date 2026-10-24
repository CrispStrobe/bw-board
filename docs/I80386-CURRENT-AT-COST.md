# Current ordinary JS 386 cost capture

This source candidate prepares one hosted, media-free measurement of the
current ordinary JS 386 core and AT paths. The measurement job requires separate frozen-source/event admission.
The existing authored five-operation loop is run for one million retired
instructions after a separate fixed warmup. The independent golden is
AX=65534, BX=65535, IP=0 and memory word 65535. The core's one million and
AT's six million charges are **synthetic model counts**, not CPU seconds or a
calibrated physical 16 MHz 386DX clock.

When separately enabled and admitted, four serial hosted children collect
unprofiled core and AT timing plus distinct V8 profiles for attribution.
The runner records startup, warmup, setup, warmed-loop and whole-child CPU
and wall facts separately, under one CPU, 1 GiB without swap, 60 seconds
per child and 8 MiB per profile. The standalone original reader checks
source/import bytes, Node identity, semantic/device goldens, resources,
profiles and finite cleanup. An external audit must still bind official
run, job, steps, artifact and exact source before using any result.

The AT checks preserve PIT fractional state, PIC request/mask/in-service
state and CPU IF eligibility. An RTC pending flag with interrupts disabled
does not establish interrupt delivery. Profile samples cannot be treated as
exact CPU cost shares. This diagnostic neither adopts an optimization nor
qualifies a guest, physical RTx, general OS behavior or a speedup. A later
source change needs its own narrow claim, paired measurements and affected
guest qualification.

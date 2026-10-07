# Paged IRQ native source checkpoint

This is a separate, fixed CPL0 code16 paging and IRQ0 profile. The three
source-only tests run with:

```sh
node --test test/i80386-paged-irq-source.test.mjs test/i80386-paged-irq-provider-source.test.mjs test/i80386-paged-irq-native-source.test.mjs
```

The native runtime and board provider are derived from the authenticated
paged INT/IRET source. The derivative admits the reset master PIC's actual
vector 0; it does not reprogram the PIC or admit PIO. It checks the named
CS:IP 0018:7002, IF, interrupt shadow, and N/Q 39/39 before the single PIC
ACK. The translated gate, three six-byte-frame word writes, and their
generation/order must precede the native IRQ delivery observer. The native
frame push order differs from the JavaScript board's ascending frame writes;
the resulting physical bytes must match. The handler marker precedes the
interrupted marker. The interrupted instruction is not advanced on the IRQ
delivery boundary. Any zero-Q native boundary stays separate from the
JavaScript board step that also begins executing the handler.

The fixture may assert IRQ0 only while the provider is initialized, paused,
closed=false, and no source callback is active, at the exact N/Q cut. It may
do so once. A paused line-staging call then transfers the actual PIC pending
state to the native line; the source callback cannot stage or deassert it
while running. The callback tape from the native addon is an owned typed
array. External direct calls can present a subclass or hostile iterator,
so the provider enters its reentry guard, captures the bounded extent once,
checks it against the intrinsic typed-array metadata, validates each numeric
word before copying it into a private typed array, and validates that entire
copy before board clock effects. It never invokes the caller iterator during
commit or rereads caller words after validation.
Even when a metadata getter swallows a denied nested ACK and supplies otherwise
valid clock words, the violation is latched: the outer transfer has no effect
and further callbacks, line staging, pulses, run admission and terminal
settlement are denied. Paused inspection, ending the current lease and closing
remain available to record the failure and release the board.
An ACK without the staged line or with a malformed scalar argument is denied
before the real PIC changes. The actual PIC ACK clears its request, marks the
vector in service, and deasserts the source line once.

This checkpoint does not include a generated manifest, native compiler
result, addon, clean native guest run, external emulator oracle, or native/JS
differential. Source-only controls do not establish native behavior. The
separate build and actual guest gate must preserve any first failure.

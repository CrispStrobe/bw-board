# sixty5o2 ROM build

Source: [janroesner/sixty5o2](https://github.com/janroesner/sixty5o2) (MIT)

The `*_ca65.asm` files are mechanically ported from the upstream source
for the cc65 assembler toolchain (`.label` local labels → `@label`,
`.text` → `.byte`, character literals to single quotes, `.end` label
renamed).

## Build

Requires cc65 (`apt install cc65`).

```sh
# Bootloader (32K ROM for EATER6502)
ca65 --cpu 65C02 --feature labels_without_colons bootloader_ca65.asm -o boot.o
cat > link.cfg <<'CFG'
MEMORY {
    ZP:  start=$00, size=$100, type=rw, file="";
    RAM: start=$0100, size=$7F00, type=rw, file="";
    ROM: start=$8000, size=$8000, type=ro, file=%O, fill=yes, fillval=$00;
}
SEGMENTS {
    ZEROPAGE: load=ZP, type=zp;
    BSS: load=RAM, type=bss;
    CODE: load=ROM, type=ro, start=$8000;
    ISR: load=ROM, type=ro, start=$FFC9;
    VECTORS: load=ROM, type=ro, start=$FFFC;
}
CFG
ld65 -o bootloader.bin -C link.cfg boot.o

# hello_world example (loaded at $0200)
ca65 --cpu 65C02 --feature labels_without_colons hello_world_ca65.asm -o hello.o
cat > hello_link.cfg <<'CFG'
MEMORY {
    ZP:  start=$00, size=$100, type=rw, file="";
    RAM: start=$0200, size=$1E00, type=rw, file=%O, fill=yes, fillval=$00;
}
SEGMENTS {
    ZEROPAGE: load=ZP, type=zp;
    CODE: load=RAM, type=rw, start=$0200;
}
CFG
ld65 -o hello_world.bin -C hello_link.cfg hello.o
```

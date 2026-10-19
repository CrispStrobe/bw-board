// Copyright (c) 2026 Brickwright contributors. MIT license.
// Bounded shared-memory experiment, not an 80386 execution backend.
#include <stdint.h>

// The AT machine advertises at most 16 MiB of physical RAM. Reserve the
// backing bytes inside the module so JavaScript bus access and a future WASM
// executor can address exactly the same storage without per-block copying.
static uint8_t guest_ram[16u << 20];

uint32_t ram_bridge_version(void) { return 1; }
uint32_t ram_bridge_ptr(void) { return (uint32_t)(uintptr_t)guest_ram; }
uint32_t ram_bridge_capacity(void) { return sizeof(guest_ram); }

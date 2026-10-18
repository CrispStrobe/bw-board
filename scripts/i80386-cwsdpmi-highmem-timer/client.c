/* Owned high-linear-memory and BIOS-timer fixture; uncompiled at this checkpoint. */
#include <dpmi.h>
#include <sys/farptr.h>
#include <stdio.h>
#include <string.h>

enum { BLOCK_BYTES = 4096, DATA_OFFSET = 128, DATA_BYTES = 256 };
enum { EXPECTED_CHECKSUM = 4225408UL, POLL_CAP = 262144UL };
enum { TICKS_PER_DAY = 0x1800B0UL, MAX_TICK_DELTA = 36UL };

int main(void)
{
    __dpmi_meminfo block;
    __dpmi_regs timer;
    unsigned long first = 0, last = 0, delta = 0, checksum = 0;
    unsigned long selector_base = 0, selector_limit = 0;
    unsigned long polls = 0;
    int selector = -1, allocated = 0, result = 1;
    unsigned int i;

    memset(&block, 0, sizeof(block));
    block.size = BLOCK_BYTES;
    if (__dpmi_allocate_memory(&block) != 0) {
        puts("BW_HMT_FAIL 0501");
        return 10;
    }
    allocated = 1; /* Handle zero is valid when allocation succeeded. */
    /* size is our request, not a documented 0501 return; guard retained input. */
    if (block.size != BLOCK_BYTES || block.address <= 0x00100000UL ||
        (unsigned long long)block.address + (unsigned long long)BLOCK_BYTES - 1ULL > 0xffffffffULL) {
        puts("BW_HMT_FAIL 0501_RANGE");
        result = 11;
        goto cleanup;
    }

    selector = __dpmi_allocate_ldt_descriptors(1);
    if (selector < 0 ||
        __dpmi_set_segment_base_address(selector, block.address) != 0 ||
        __dpmi_set_segment_limit(selector, BLOCK_BYTES - 1) != 0) {
        puts("BW_HMT_FAIL SELECTOR");
        result = 12;
        goto cleanup;
    }
    if (__dpmi_get_segment_base_address(selector, &selector_base) != 0) {
        puts("BW_HMT_FAIL SELECTOR_BASE_READ");
        result = 12;
        goto cleanup;
    }
    selector_limit = __dpmi_get_segment_limit(selector);
    if (selector_base != block.address || selector_limit != BLOCK_BYTES - 1) {
        puts("BW_HMT_FAIL SELECTOR_READBACK");
        result = 12;
        goto cleanup;
    }
    for (i = 0; i < DATA_BYTES; ++i)
        _farpokeb((unsigned short)selector, DATA_OFFSET + i,
                  (unsigned char)((i * 29U + 7U) & 255U));
    for (i = 0; i < DATA_BYTES; ++i)
        checksum += (unsigned long)(i + 1U) *
                    _farpeekb((unsigned short)selector, DATA_OFFSET + i);
    if (checksum != EXPECTED_CHECKSUM) {
        puts("BW_HMT_FAIL CHECKSUM");
        result = 13;
        goto cleanup;
    }

    for (polls = 1; polls <= POLL_CAP; ++polls) {
        unsigned long ticks;
        memset(&timer, 0, sizeof(timer));
        timer.h.ah = 0;
        if (__dpmi_int(0x1a, &timer) != 0) {
            puts("BW_HMT_FAIL 0300");
            result = 14;
            goto cleanup;
        }
        ticks = ((unsigned long)timer.x.cx << 16) | (unsigned long)timer.x.dx;
        if (ticks >= TICKS_PER_DAY) {
            puts("BW_HMT_FAIL TICK_RANGE");
            result = 15;
            goto cleanup;
        }
        if (polls == 1) {
            first = ticks;
            continue;
        }
        last = ticks;
        delta = (last + TICKS_PER_DAY - first) % TICKS_PER_DAY;
        if (delta > MAX_TICK_DELTA) {
            puts("BW_HMT_FAIL TICK_DELTA");
            result = 16;
            goto cleanup;
        }
        if (delta != 0)
            break;
    }
    if (delta == 0) {
        puts("BW_HMT_FAIL TICK_BUDGET");
        result = 17;
        goto cleanup;
    }
    result = 0;

cleanup:
    if (selector >= 0 && __dpmi_free_ldt_descriptor(selector) != 0) {
        puts("BW_HMT_FAIL SELECTOR_FREE");
        result = 18;
    }
    if (allocated && __dpmi_free_memory(block.handle) != 0) {
        puts("BW_HMT_FAIL 0502");
        result = 19;
    }
    if (result == 0) {
        puts("BW_HMT_OK");
        printf("BW_HMT_VALUES address=%lu requested=%lu selector_base=%lu selector_limit=%lu first=%lu last=%lu polls=%lu delta=%lu checksum=%lu\n",
               block.address, (unsigned long)BLOCK_BYTES, selector_base, selector_limit,
               first, last, polls, delta, checksum);
    }
    return result;
}

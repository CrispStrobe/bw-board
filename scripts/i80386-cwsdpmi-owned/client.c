/* Owned DJGPP DPMI service fixture. Source only; no compiled guest result yet. */
#include <dpmi.h>
#include <sys/farptr.h>
#include <stdio.h>
#include <string.h>

enum { BLOCK_BYTES = 4096, DATA_OFFSET = 128, DATA_BYTES = 256 };
enum { EXPECTED_CHECKSUM = 4225408UL };

int main(void)
{
    __dpmi_meminfo block;
    __dpmi_regs timer;
    unsigned long checksum = 0;
    int selector = -1;
    int allocated = 0;
    int result = 1;
    unsigned int i;

    memset(&block, 0, sizeof(block));
    memset(&timer, 0, sizeof(timer));
    block.size = BLOCK_BYTES;
    if (__dpmi_allocate_memory(&block) != 0) {
        puts("BW_DPMI_FAIL 0501");
        return 10;
    }
    allocated = 1;
    if (block.size < BLOCK_BYTES) {
        puts("BW_DPMI_FAIL 0501_SIZE");
        result = 11;
        goto cleanup;
    }

    /* 0501 returns a linear address, not a C pointer. Map an LDT data selector. */
    selector = __dpmi_allocate_ldt_descriptors(1);
    if (selector < 0 ||
        __dpmi_set_segment_base_address(selector, block.address) != 0 ||
        __dpmi_set_segment_limit(selector, BLOCK_BYTES - 1) != 0) {
        puts("BW_DPMI_FAIL SELECTOR");
        result = 12;
        goto cleanup;
    }

    for (i = 0; i < DATA_BYTES; ++i) {
        unsigned char value = (unsigned char)((i * 29U + 7U) & 255U);
        _farpokeb((unsigned short)selector, DATA_OFFSET + i, value);
    }
    for (i = 0; i < DATA_BYTES; ++i) {
        unsigned char value = _farpeekb((unsigned short)selector, DATA_OFFSET + i);
        checksum += (unsigned long)(i + 1U) * value;
    }
    if (checksum != EXPECTED_CHECKSUM) {
        puts("BW_DPMI_FAIL CHECKSUM");
        result = 13;
        goto cleanup;
    }

    /* DJGPP __dpmi_int uses INT 31h/0300; BIOS INT 1Ah AH=00h reads ticks. */
    timer.h.ah = 0;
    if (__dpmi_int(0x1a, &timer) != 0) {
        puts("BW_DPMI_FAIL 0300");
        result = 14;
        goto cleanup;
    }
    result = 0;
cleanup:
    if (selector >= 0 && __dpmi_free_ldt_descriptor(selector) != 0) {
        puts("BW_DPMI_FAIL SELECTOR_FREE");
        result = 15;
    }
    if (allocated && __dpmi_free_memory(block.handle) != 0) {
        puts("BW_DPMI_FAIL 0502");
        result = 16;
    }
    if (result == 0) {
        printf("BW_DPMI_OK checksum=%lu\n", checksum);
    }
    return result;
}

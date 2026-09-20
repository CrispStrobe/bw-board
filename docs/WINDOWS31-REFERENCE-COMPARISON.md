# Windows 3.1 reference comparison

This note records what the external references add to the current emulator
acceptance plan. They are operating and historical references, not additional
compatibility receipts.

Sources:

- [Running Windows 3.1 Enhanced mode on FreeDOS](https://danielectra.github.io/blog/windows-31-on-freedos)
- [Win3x forum thread](http://www.win3x.org/win3board/viewtopic.php?t=28120)
- [DOSBox-X Windows 3.1x guide](https://github.com/joncampbell123/dosbox-x/wiki/Guide:Installing-Windows-3.1x)
- [PCjs Windows/386 and Windows 3.x demos](https://www.pcjs.org/blog/2016/03/12/)
- [Xtof Windows 3 internals](https://www.xtof.info/inside-windows3.html)
- [Win3 stock archive](https://archive.org/details/win3_stock)

The DOSBox-X guide states that Windows 3.1 drops 8086/8088 real-mode support,
that Windows for Workgroups 3.11 requires a 386, and that 386 Enhanced Mode is
distinct from standard mode. Its 32-bit disk-access path uses `WIN386.EXE`'s
`WDCTRL` driver and depends on real DOS, one IDE disk, bounded geometry, and
specific INT 13h configuration. Floppy and CD devices must be present before
Windows starts; a host folder mount cannot be the boot drive.

The FreeDOS report supplies the guest-side condition that DOSBox alone hides:
JEMM does not provide the required GEMMIS behavior for enhanced mode. The
working route uses a FreeDOS kernel built with the Windows 3.1 support option,
does not load JEMM, runs `SHARE`, and sets `InDOSPolling=TRUE` under
`[386Enh]`. We must reproduce those inputs before attributing a failure to the
386 executor.

PCjs demonstrates that Windows/386, Windows 3.0, Windows 3.1, and Windows 95
need distinct PC/AT-era profiles; its catalogue is useful for selecting a
reference machine and BIOS/device set. The Archive item contains a historical
Windows 3.11 stock ZIP; it remains an external, user-supplied input. The Win3x
forum and Xtof pages are useful human references, but their hosts are not stable
machine-readable evidence sources, so any claim taken from them needs a pinned
capture or corroboration.

Our current receipt is Windows 3.0 standard mode on external PC DOS 3.2 media.
That is consistent with the references and does not exercise `WIN386.EXE`, V86
tasks, or 32-bit disk access. The next enhanced-mode receipt must retain:

1. the exact Windows/FreeDOS files and hashes;
2. the FreeDOS kernel/JEMM/SHARE/`SYSTEM.INI` configuration;
3. the IDE geometry and INT 13h configuration;
4. protected-mode, paging, V86, timer, keyboard, and disk observations; and
5. a separate result for 32-bit disk access.

No Windows binary, Archive ZIP, or forum attachment is vendored by this repo.

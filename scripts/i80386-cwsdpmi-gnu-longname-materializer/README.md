# Bounded GNU long-name materialization

This derivative credits the GNU tar format's `L` long-file-name metadata and
inherits the pinned refusal-diagnostic parser, four immutable input pins,
selected-nine policy and thirteen fixed hardlink aliases. GNU format references:
[GNU tar archive formats](https://www.gnu.org/software/tar/manual/html_node/Formats.html)
and [GNU tar extensions](https://www.gnu.org/software/tar/manual/html_node/Extensions.html).
The observed original refused byte 76 (`L`), ordinal 102, at decoded offset
5634048 with GNU magic. It did not materialize files or run an observer. That
observation does not establish the next header or qualify this derivative.

Only a GNU-magic `L` header named `././@LongLink`, with empty prefix and link,
non-setid mode and payload extent 2 through 241 bytes, is admitted. Its printable
ASCII name is at most 240 bytes, has exactly one final NUL, passes the inherited
canonical path rules, and has zero alignment padding. Metadata consumes the
existing member and decoded-byte budgets and declared extent before its body is
read. No metadata file or physical hardlink is written.

One pending name must belong to the immediately following permitted ordinary
file, directory or fixed hardlink. Another `L`, orphan, truncation, `K`, PAX,
symlink, unsupported type, checksum, setid, alias or duplicate conflict refuses.
This strict subset additionally requires an empty following prefix and its short
name to equal the pending name's first 100 bytes. This is a deliberate admission
restriction, not a claim that all GNU producers require that placeholder or that
the original following header has been inspected. Original short-field ASCII
and NUL-tail checks still apply. Effective directory slash and file rules remain
unchanged. A later actual original can establish compatibility or preserve the
next refusal; no waiver or retry of a prior head is implied.

Status adds only counts of validated metadata headers and consumed names, plus a
pending boolean. Consumed names count filename substitution, not successful
writes. Names, bodies and raw headers remain private. First fixed refusal facts
survive cleanup. The successful path still requires all nine selected hashes,
four source joins and thirteen admitted aliases; only those nine outputs are
written. Full toolchain, namespace/mode, source ownership, input filesystem lease,
compiler, guest and performance qualification remain false. The compiler is
unchanged and unconditionally disabled.

The controls manufacture archives and filesystem state. The combined suite
includes 16 new GNU controls and 30 inherited diagnostic/acquisition controls;
the inherited propagation control uses unsupported `K` in place of newly
admitted `L`, preserving its original refusal/cleanup purpose. No actual archive,
network, compiler, tool, Node or guest execution is needed:

`python3 -I -B scripts/i80386-cwsdpmi-gnu-longname-materializer/materialize-control.py`

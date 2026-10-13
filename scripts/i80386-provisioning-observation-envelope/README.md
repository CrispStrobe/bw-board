# Independent observation envelope and byte reader

This separately versioned source-only contract checks finite **reported** source,
resource, lifetime and raw-prefix consistency. It does not authenticate an actual
run, approval, source ownership, namespace, hard deadline, compiler or guest.
Every authority flag remains false, including for a consistent manufactured
completion. Existing admission, lifetime, source and supervisor contracts are
unchanged; this is not the older supervisor reader's execution profile.

The [wire contract](contract.json) defines nine names and staged dependencies.
Mandatory members are envelope.json, stdout.prefix, stderr.prefix and status.txt.
Descriptor/table/source-before appear together; resources require that group;
source-after requires before. Admission/lifetime facts require resources. A
completion requires all nine and every positive join. Earlier failures may retain
partial prefixes and genuinely absent facts. A negative outer projection can
retain a complete historical inner result without promoting packet completion.

[reader.py](reader.py) accepts immutable ZIP bytes only. It imports no producers,
assembler, source validators or earlier readers, and performs no OS, source
execution, Git, network, download or replay operations. The closed ZIP subset is
STORED only, with gapless local bodies, matching central rows and exact terminal
EOCD. It rejects extra/unknown/duplicate names, encryption, ZIP64, descriptors,
extras, comments, nonregular modes and hidden framing bytes. CRCs, extents, names,
order, offsets and a valid fixed DOS epoch join independently. Raw and decoded
caps are 512 KiB; binary prefixes are capped at 64 KiB each. JSON rejects duplicate
keys, floating/nonfinite numbers, excessive complexity and bool-as-int values.

Original binary prefixes are never decoded or normalized. Stored lengths/digests,
observed counts, EOF and overflow are distinct. Observed counts are bounded by the
source's capacity-plus-one guard. A retained overflow prefix can be diagnostically
valid, but cannot complete. status.txt is an envelope projection, not the original
process status; a signed launcher exit such as -9 remains -9 in its own field.
Producer-specific firstFailure strings are retained without silent normalization.
Exception types are reported categories; serialized evidence does not recover a
Python exception object's identity.

The full reported descriptor/table/before-after schemas are deeply joined, with
separate canonical inherited14 projections. Exact frozen inherited rows and four
named current component pins are checked. Reported role kinds/counts/hashes do
not prove the complete actual transitive dependency graph or an external approval.
The separately observed table's raw SHA and Git blob hash are recomputed without
Git. Resource payloads use literal CPU180/180, address-space2 GiB, file64 MiB,
FD256 and core0 policies, five policies and ten immediate/final observations.
Readonly receiver rows are separate; a -1 infinity sentinel may survive a failed
row but never satisfies a positive policy match. Missing handshakes are not
replaced by invented full readbacks.

ACK may-have-escaped is conservative and remains true even after a successful
send. An attempted ACK requires historical admission and five readonly matches;
an escaped-only ACK cannot complete. Normal close/consumption after reported
terminal/census observations is allowed. Historical admission never becomes
current usable-handle authority. Signal attempts require the reported admission
premises; cleanup uncertainty, missing after, incomplete EOF, nonterminal PID1,
unreaped launcher or missing/nonzero censuses prohibit completion. These are
reported source-order joins, not a reconstructed event timeline or continuous lease.

Interfaces:

```python
result = reader.audit(raw_zip_bytes, declared_sha256=None)
raw_zip_bytes = assembler.assemble(member_bytes_dict)
```

A supplied ZIP SHA is a declared consistency check, not an official seal.
[assembler.py](assembler.py) creates canonical framing from an admitted immutable
byte snapshot. It does not import the reader, validate deep evidence or return a
success verdict. The independent reader distinguishes `diagnosticValid` from
`completeReportedConsistency` and returns all authority flags false.

Run the manufactured controls from the repository root on Linux/system Python:

```sh
/usr/bin/python3 -I -B scripts/i80386-provisioning-observation-envelope/controls.py
```

Thirty-seven methods use tiny manufactured packets only, including genuine fixed
metadata pins but no source/helper execution or acquired archive bodies. Controls
cover complete/partial joins, byte preservation, original errors, infinity/bool
readbacks, ACK and consumed-handle semantics, source/projection substitutions,
framing/CRC/cap mutations and standard ZIP-tool compatibility.
No private draft or audit receipt is bundled. Official event/job/artifact admission,
externally approved complete graph and the operational collector/launcher remain
separate future gates.

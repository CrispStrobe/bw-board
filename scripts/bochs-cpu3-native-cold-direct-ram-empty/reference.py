"""Authenticate and extract the immutable original three-arm cold guest packet."""
import hashlib
import json
import pathlib
import sys
import zipfile

ZIP_SHA256 = "3881456e5dd46f256640cd28af30117f0be1a92f1b2fe9df1712067c3ea31905"
QUALIFIED_HEAD = "acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1"
REPORTS = ("direct.json", "owned.json", "callback.json")


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def main(archive_name, output_name, verify_only=False):
    archive = pathlib.Path(archive_name)
    output = pathlib.Path(output_name)
    assert archive.is_file() and 0 < archive.stat().st_size < 16 * 1024 * 1024
    assert sha256(archive.read_bytes()) == ZIP_SHA256, "exact original ZIP"
    assert output.is_dir() and not output.is_symlink()
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        names = [member.filename for member in members]
        assert len(names) == len(set(names)) == 40 and all(
            not member.is_dir()
            and not member.filename.startswith("/")
            and ".." not in pathlib.PurePosixPath(member.filename).parts
            and member.file_size <= 64 * 1024 * 1024
            and (member.external_attr >> 16) & 0o170000 in (0, 0o100000)
            for member in members
        ), "bounded regular original members"
        assert sum(member.file_size for member in members) < 80 * 1024 * 1024
        inventory = json.loads(zipped.read("artifact-inventory.json"))["files"]
        assert set(inventory) - set(names) == {"direct-mock", "direct.node", "owned_ram.node"}, "only binary uploads omitted"
        assert set(names) - set(inventory) == {"artifact-inventory.json"}
        for name, expected in inventory.items():
            if name not in names:
                continue
            actual = zipped.read(name)
            assert len(actual) == expected["bytes"] and sha256(actual) == expected["sha256"], name
        comparison = json.loads(zipped.read("comparison.json"))
        assert comparison["schema"] == "bw.cold-native.direct-ram-three-arm-parity.v1"
        assert comparison["parity"] == "PASS"
        assert (comparison["target"], comparison["resumes"], comparison["ports"], comparison["journalEntries"]) == (
            316562, 16524, 16475, 91958
        )
        extracted = {}
        for name in REPORTS:
            report = json.loads(zipped.read(name))
            assert report["target"] == 316562 and report["resumes"] == 16524
            if name == "direct.json":
                assert report["schema"] == "bw.cold-native.direct-ram-actual-fixture.v1"
                assert report["admission"]["sourceHead"] == QUALIFIED_HEAD
                assert len(report["journal"]) == 91958
            else:
                assert report["schema"] == "bw.cold-native.owned-ram-actual-fixture.v1"
            if not verify_only:
                with (output / ("held-" + name)).open("xb") as sink:
                    sink.write(zipped.read(name))
            extracted[name] = inventory[name]
        receipt = {
            "schema": "bw.cold-direct-ram.empty-held-reference.v1",
            "qualifiedHead": QUALIFIED_HEAD,
            "officialRun": 37605762900,
            "officialArtifact": 11474662523,
            "zipSha256": ZIP_SHA256,
            "members": len(names),
            "comparisonSha256": inventory["comparison.json"]["sha256"],
            "reports": extracted,
        }
        if not verify_only:
            with (output / "empty-held-reference.json").open("x") as sink:
                json.dump(receipt, sink, indent=2, sort_keys=True)
                sink.write("\n")
    print(json.dumps({"schema": receipt["schema"], "status": "AUTHENTICATED", "reports": sorted(extracted)}))


if __name__ == "__main__":
    assert len(sys.argv) in (3, 4), "ZIP, existing output directory, optional --verify-only"
    assert len(sys.argv) == 3 or sys.argv[3] == "--verify-only"
    main(sys.argv[1], sys.argv[2], len(sys.argv) == 4)

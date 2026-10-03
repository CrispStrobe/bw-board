"""Closed cold-build archive primitives. No download, subprocess or addon loading."""
import hashlib
import io
import os
from pathlib import Path, PurePosixPath
import stat
import tarfile
import zipfile

LIMIT = 256 * 1024 * 1024

def require(condition, message):
    if not condition:
        raise ValueError(message)

def ordinary(path):
    path = Path(path)
    require(path.is_absolute() and path.resolve() == path, 'canonical path required')
    require(stat.S_ISREG(path.lstat().st_mode), 'ordinary file required')
    require(path.stat().st_size <= LIMIT, 'file limit')
    return path.read_bytes()

def name(value):
    p = PurePosixPath(value)
    require(value and not p.is_absolute() and '\\' not in value and all(x not in ('', '.', '..') for x in value.split('/')), 'unsafe member')
    return value

def digest(data):
    return hashlib.sha256(data).hexdigest()

def verify(data, expected):
    require(set(expected) == {'bytes', 'sha256'}, 'invalid member record')
    require(type(expected['bytes']) is int and 0 <= expected['bytes'] <= LIMIT, 'size domain')
    require(len(data) == expected['bytes'] and digest(data) == expected['sha256'], 'member digest')

def zip_members(path, expected, zip_hash, zip_bytes):
    raw = ordinary(path)
    require(len(raw) == zip_bytes and digest(raw) == zip_hash, 'official ZIP digest')
    result = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for entry in archive.infolist():
            n = name(entry.filename)
            require(n not in result and not entry.is_dir(), 'duplicate or directory ZIP member')
            mode = entry.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG), 'ZIP member type')
            require(entry.file_size <= LIMIT and not entry.flag_bits & 1, 'ZIP size/encryption')
            require(n in expected, 'unexpected ZIP member')
            data = archive.read(entry)
            verify(data, expected[n])
            result[n] = data
    require(set(result) == set(expected), 'missing ZIP member')
    return result

def tar_members(data, expected):
    result = {}
    seen = set()
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
        for entry in archive:
            n = name(entry.name.rstrip('/'))
            require(n not in seen, 'duplicate TAR member')
            seen.add(n)
            require(entry.isdir() or entry.isfile(), 'TAR member type')
            if entry.isdir():
                require(any(k.startswith(n + '/') for k in expected), 'unlisted TAR directory')
                require(len(seen) <= len(expected) * 16, 'directory count')
                continue
            require(entry.size <= LIMIT and n in expected, 'TAR size/member')
            contents = archive.extractfile(entry).read(LIMIT + 1)
            verify(contents, expected[n])
            result[n] = contents
            require(sum(len(v) for v in result.values()) <= LIMIT, 'TAR aggregate limit')
    require(set(result) == set(expected), 'missing TAR member')
    return result

def exclusive_tree(target, files):
    """Only called after the complete archive has authenticated; never overwrites."""
    target = Path(target)
    require(target.is_absolute() and target.parent.resolve() == target.parent, 'target parent')
    require(not os.path.lexists(target), 'existing destination')
    for n in files:
        name(n)
    target.mkdir()
    for n, data in files.items():
        p = target / n
        p.parent.mkdir(parents=True, exist_ok=True)
        with p.open('xb') as stream:
            stream.write(data)

"""Fixed post-capture read access; ownership and qualification stay unchanged."""
import hashlib
import os
import stat

CAPS = {
    'companion.zip': 2097152, 'controller-status.json': 262144,
    'entry-status.json': 65536, 'resource-wire.bin': 8192,
    'resource-observation.json': 16384, 'lifetime-status.json': 32768,
    'capture-index.json': 16384, 'official-event.json': 8192,
    'stdout.bin': 65536, 'stderr.bin': 65536,
    'observation.zip': 524288, 'observer-diagnostic.bin': 65536,
    'approval.json': 65536, 'child-capture.json': 16384,
}


class Refusal(ValueError):
    pass


class _Handoff:
    """Internal borrowed directory route; no public path or launch interface."""
    def __init__(self, directory_fd, identity, frozen):
        self.fd = directory_fd
        self.identity = identity
        self.frozen = frozen
        self.entered = False
        self.busy = False
        self.first = None
        self.close_attempted = 0
        self.close_refused = 0
        self.rows = []
        self.directory_readable = False

    def _check(self):
        if self.first is not None:
            raise Refusal(self.first)

    def _need(self, condition, code):
        if not condition:
            if self.first is None:
                self.first = code
            raise Refusal(code)

    def _call(self, function, *args, **kwargs):
        self._check()
        value = function(*args, **kwargs)
        self._check()
        return value

    @staticmethod
    def _facts(value):
        return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)

    def status(self):
        if self.busy:
            if self.first is None:
                self.first = 'handoff-reentry'
            raise Refusal('handoff-reentry')
        return {'schema': 'bw.provisioning-artifact-handoff.v1',
                'firstFailure': self.first, 'directoryReadable': self.directory_readable,
                'closeAttempted': self.close_attempted, 'closeRefused': self.close_refused,
                'files': [dict(row) for row in self.rows],
                'ownershipTransferred': False, 'actualQualification': False}

    def run(self):
        self._need(not self.entered, 'handoff-once')
        self.entered = True
        self.busy = True
        primary = None
        held = []
        # Fixed bindings are captured before the first OS boundary.
        fstat, namedstat, openfile, read, close, chmod, names = (
            os.fstat, os.stat, os.open, os.read, os.close, os.fchmod, os.listdir)
        directory_fd, identity, frozen = self.fd, self.identity, self.frozen
        hash_constructor, facts = hashlib.sha256, self._facts
        caps = dict(CAPS)
        try:
            self._need(type(directory_fd) is int and directory_fd >= 0
                       and type(identity) is tuple and len(identity) == 2
                       and all(type(n) is int and n >= 0 for n in identity),
                       'directory-identity-shape')
            self._need(frozen is True, 'capture-freeze-unconfirmed')
            directory = self._call(fstat, directory_fd)
            self._need(stat.S_ISDIR(directory.st_mode) and directory.st_uid == 0
                       and directory.st_gid == 0
                       and stat.S_IMODE(directory.st_mode) == 0o700
                       and (directory.st_dev, directory.st_ino) == identity,
                       'directory-identity')
            listing = self._call(names, directory_fd)
            self._need(type(listing) is list and len(listing) <= 14
                       and all(type(name) is str for name in listing), 'inventory-shape')
            self._need(len(set(listing)) == len(listing) and set(listing) <= set(caps),
                       'inventory-names')
            identities = set()
            total = 0
            for name in sorted(listing):
                self._check()
                fd = openfile(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                              dir_fd=directory_fd)
                # Capture the returned descriptor before any later hook.
                try:
                    held.append([fd, name, None])
                except BaseException:
                    if self.first is None:
                        self.first = 'handoff-refused'
                    self.close_attempted += 1
                    try:
                        close(fd)
                    except BaseException:
                        self.close_refused += 1
                    raise
                self._check()
                self._need(type(fd) is int and fd >= 0 and fd != directory_fd,
                           'file-descriptor')
                first = self._call(fstat, fd)
                self._need(stat.S_ISREG(first.st_mode) and first.st_uid == first.st_gid == 0
                           and first.st_nlink == 1 and 0 <= first.st_size <= caps[name],
                           'file-shape')
                file_identity = (first.st_dev, first.st_ino)
                self._need(file_identity not in identities, 'file-alias')
                identities.add(file_identity)
                total += first.st_size
                self._need(total <= 4194304, 'aggregate-cap')
                count = 0
                digest = self._call(hash_constructor)
                update, hexdigest = digest.update, digest.hexdigest
                self._check()
                while True:
                    body = self._call(read, fd, min(65536, first.st_size + 1 - count))
                    self._need(type(body) is bytes, 'read-shape')
                    count += len(body)
                    self._need(count <= first.st_size, 'read-extent')
                    if not body:
                        break
                    self._call(update, body)
                end = self._call(fstat, fd)
                named = self._call(namedstat, name, dir_fd=directory_fd, follow_symlinks=False)
                self._need(count == first.st_size and stat.S_ISREG(end.st_mode)
                           and stat.S_ISREG(named.st_mode)
                           and end.st_uid == end.st_gid == named.st_uid == named.st_gid == 0
                           and end.st_nlink == named.st_nlink == 1
                           and facts(first) == facts(end) == facts(named),
                           'file-changed')
                held[-1][2] = facts(first)
                self.rows.append({'name': name, 'bytes': count, 'sha256': self._call(hexdigest)})
                self._check()
            # No permissions change until the complete fixed inventory is read.
            for fd, name, expected in held:
                current = self._call(fstat, fd)
                named = self._call(namedstat, name, dir_fd=directory_fd, follow_symlinks=False)
                self._need(stat.S_ISREG(current.st_mode) and stat.S_ISREG(named.st_mode)
                           and current.st_uid == current.st_gid == named.st_uid == named.st_gid == 0
                           and current.st_nlink == named.st_nlink == 1
                           and expected == facts(current) == facts(named),
                           'final-file-changed')
                self._call(chmod, fd, 0o444)
                changed = self._call(fstat, fd)
                self._need(stat.S_IMODE(changed.st_mode) == 0o444
                           and changed.st_uid == changed.st_gid == 0
                           and changed.st_nlink == 1 and facts(changed) == expected,
                           'file-mode-readback')
        except BaseException as error:
            primary = error
            if self.first is None:
                self.first = 'handoff-refused'
        finally:
            consumed = set()
            for fd, _, _ in reversed(held):
                if type(fd) is not int or fd < 0 or fd == directory_fd or fd in consumed:
                    continue
                consumed.add(fd)
                self.close_attempted += 1
                try:
                    close(fd)
                except BaseException as error:
                    self.close_refused += 1
                    if self.first is None:
                        self.first = 'file-close-refused'
                    if primary is None:
                        primary = error
        try:
            if primary is None:
                self._check()
                final = self._call(fstat, directory_fd)
                self._need(stat.S_ISDIR(final.st_mode) and final.st_uid == final.st_gid == 0
                           and stat.S_IMODE(final.st_mode) == 0o700
                           and (final.st_dev, final.st_ino) == identity
                           and facts(final) == facts(directory),
                           'final-directory-changed')
                final_names = self._call(names, directory_fd)
                self._need(type(final_names) is list and len(final_names) == len(listing)
                           and all(type(name) is str for name in final_names)
                           and sorted(final_names) == sorted(listing), 'final-inventory-changed')
                self._call(chmod, directory_fd, 0o555)
                changed = self._call(fstat, directory_fd)
                self._need(stat.S_IMODE(changed.st_mode) == 0o555
                           and changed.st_uid == changed.st_gid == 0
                           and facts(changed) == facts(directory),
                           'directory-mode-readback')
                self.directory_readable = True
        except BaseException as error:
            if self.first is None:
                self.first = 'handoff-refused'
            if primary is None:
                primary = error
        finally:
            self.busy = False
        if primary is not None:
            raise primary
        return self.status()

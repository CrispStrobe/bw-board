"""Injected phase scheduling only; no root/source admission or compilation."""
class Refusal(ValueError):
    pass

class PhaseOwner:
    def __init__(self, capture, write, before_path, terminal_path):
        self._capture = capture
        self._write = write
        self._paths = (before_path, terminal_path)
        self._phase = "new"
        self._busy = False
        self._poison = False
        self._secondary = None
        self._first_failure = None

    def _enter(self):
        if self._busy:
            self._poison = True
            self._first_failure = self._first_failure or "owner-reentry"
            raise Refusal("owner-reentry")
        if self._poison:
            raise Refusal("owner-poison")
        self._busy = True

    def _call(self, fn, *args):
        value = fn(*args)
        if self._poison:
            raise Refusal("owner-reentry")
        return value

    def _capture_write(self, phase, slot, positive):
        receipt = self._call(self._capture, phase)
        # Fixed-role unit authenticates its own issued receipt on write.
        # This layer does not admit caller receipts as source authority.
        self._call(self._write, self._paths[slot], receipt)
        if positive and (type(receipt) is not dict or receipt.get("complete") is not True):
            raise Refusal("boundary-incomplete")

    def before(self):
        self._enter()
        try:
            if self._phase != "new":
                self._poison = True
                self._first_failure = self._first_failure or "owner-order"
                raise Refusal("owner-order")
            self._phase = "before-consumed"
            self._capture_write("before-probes", 0, True)
            self._phase = "before-complete"
        except BaseException:
            self._first_failure = self._first_failure or "boundary-operation-refused"
            raise
        finally:
            self._busy = False

    def after(self):
        self._enter()
        try:
            if self._phase != "before-complete":
                self._poison = True
                self._first_failure = self._first_failure or "owner-order"
                raise Refusal("owner-order")
            self._phase = "terminal-consumed"
            self._capture_write("after-link", 1, True)
        except BaseException:
            self._first_failure = self._first_failure or "boundary-operation-refused"
            raise
        finally:
            self._busy = False

    def failure(self):
        """Best-effort secondary facts; original exception is re-raised by owner."""
        try:
            self._enter()
        except BaseException:
            self._secondary = self._secondary or "owner-refusal"
            return
        try:
            if self._phase == "terminal-consumed":
                return
            self._phase = "terminal-consumed"
            self._capture_write("failure-final", 1, False)
        except BaseException:
            self._secondary = self._secondary or "diagnostic-refusal"
        finally:
            self._busy = False

    def status(self):
        if self._busy:
            self._poison = True
            self._first_failure = self._first_failure or "owner-reentry"
            raise Refusal("owner-reentry")
        return {"phase": self._phase, "secondary": self._secondary, "firstFailure": self._first_failure,
                "poisoned": self._poison, "rootQualified": False,
                "compilationQualified": False}


def preserve_error(secondary):
    """Call only inside an original failure handler; never replace that failure."""
    try:
        secondary()
    except BaseException:
        return "secondary-refusal"
    return None

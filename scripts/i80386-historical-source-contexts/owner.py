"""One fixed historical context session; no caller commands or source roots."""
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('_materializer', Path(__file__).absolute().with_name('materializer.py'))
materializer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(materializer)


def emit(value):
    raw = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)
    if len(raw.encode('utf-8')) > 16384:
        raise materializer.Refusal('owner-message-cap')
    sys.stdout.write(raw + '\n')
    sys.stdout.flush()


def session():
    context = materializer.Materializer()
    primary = None
    ready = False
    try:
        context._prepare()
        if not context.prepared or context.busy or context.closed:
            raise materializer.Refusal('owner-not-prepared')
        owner = context._prepared_owner
        emit({'schema': 'bw.historical-owner-ready.v1', 'repository': 'CrispStrobe/bw-board',
              'head': owner[0], 'root': owner[4], 'rowCount': 186,
              'pins': dict(context._pins()), 'selectors': context._selectors,
              'runtimeQualified': False, 'currentCpuQualified': False})
        ready = True
        # Extent+one guard; EOF, a second command or a prefix is not CLOSE.
        command = sys.stdin.buffer.read(7)
        if command != b'CLOSE\n':
            raise materializer.Refusal('owner-close-command')
    except BaseException as error:
        primary = error
    finally:
        try:
            context.close()
        except BaseException as error:
            if primary is None:
                primary = error
    observations = context.observations()
    released = (observations['releaseComplete'] is True
                and observations['finalReadbackComplete'] is True
                and observations['cleanupUncertain'] is False)
    emit({'schema': 'bw.historical-owner-closed.v1', 'readyIssued': ready,
          'releaseObserved': released, 'observations': observations,
          'firstFailure': None if primary is None else {'type': type(primary).__name__, 'message': str(primary)[:1024]},
          'historicalRuntimeQualified': False, 'currentCpuQualified': False})
    return 0 if primary is None and ready and released else 1


if __name__ == '__main__':
    if len(sys.argv) != 1:
        raise SystemExit('fixed owner takes no arguments')
    raise SystemExit(session())

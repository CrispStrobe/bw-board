"""CPU-free three-child schedule and semantic refusal controls."""
import copy

from run import SCHEDULE, semantic_gate, snapshot_failure_if_admitted

assert SCHEDULE == (('reference', False), ('sample-1', True), ('sample-2', True))
baseline = {'steps': 24338279, 'ram': 'a' * 64, 'disk': 'b' * 64,
            'serial': 'fork test OK\n$ ', 'interrupts': [1, 2, 3]}
semantic_gate(baseline, copy.deepcopy(baseline))
for changed in (
    dict(baseline, steps=baseline['steps'] + 1),
    dict(baseline, ram='c' * 64),
    dict(baseline, serial='fork test\n$ '),
    dict(baseline, interrupts=[1, 2]),
    {'steps': baseline['steps']},
):
    try:
        semantic_gate(baseline, changed)
    except ValueError as error:
        assert 'guest semantic projection differs' in str(error)
    else:
        raise AssertionError('changed guest projection admitted')
class Admitted:
    def __init__(self):
        self.seen = []
    def snapshot_inventory(self, value):
        self.seen.append(value)

snapshot_failure_if_admitted(None, 'unadmitted')
admitted = Admitted()
snapshot_failure_if_admitted(admitted, 'admitted')
assert admitted.seen == ['admitted']
print('rollback runner policy controls PASS')

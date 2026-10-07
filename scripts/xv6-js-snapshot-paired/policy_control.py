"""Bounded adversaries for the predeclared whole-child paired policy."""

from copy import deepcopy

from snapshot_policy import summarize


def rejected(pairs: list[dict]) -> None:
    try:
        summarize(pairs)
    except ValueError:
        return
    raise AssertionError("malformed or unequal paired series was accepted")


def series(cpu_after: float = 0.97, wall_after: float = 1.01) -> list[dict]:
    return [{"index": index,
             "order": ["before", "after"] if index % 2 == 0 else ["after", "before"],
             "semanticSha256": "a" * 64,
             "children": {arm: {"arm": arm, "semanticSha256": "a" * 64,
                                "exitCode": 0, "timedOut": False,
                                "rssExceeded": False,
                                "processGroupEmptyAfterExit": True,
                                "cpuSeconds": 1.0 if arm == "before" else cpu_after,
                                "wallSeconds": 1.0 if arm == "before" else wall_after}
                          for arm in ("before", "after")}}
            for index in range(9)]


good = series()
assert summarize(good)["adoptionGatePass"] is True
assert summarize(series(0.99))["adoptionGatePass"] is False
assert summarize(series(0.97, 1.03))["adoptionGatePass"] is False
one_bad = series()
one_bad[4]["children"]["after"]["cpuSeconds"] = 1.01
assert summarize(one_bad)["adoptionGatePass"] is False
for mutate in (
    lambda x: x.pop(),
    lambda x: x[1].update(order=["before", "after"]),
    lambda x: x[5].update(semanticSha256="b" * 64),
    lambda x: x[3]["children"]["after"].update(semanticSha256="b" * 64),
    lambda x: x[3]["children"]["after"].update(exitCode=1),
    lambda x: x[3]["children"]["after"].update(cpuSeconds=float("nan")),
    lambda x: x[3]["children"]["after"].update(wallSeconds=0),
):
    case = deepcopy(good)
    mutate(case)
    rejected(case)
print("snapshot paired policy controls PASS")

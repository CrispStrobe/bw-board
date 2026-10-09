"""Shared aggregate ceiling for the exact pinned public Node header archive.

This byte budget is only one predicate. Archive hash, individual member size,
count, type, path, duplicate and required-header checks remain independent.
"""

HEADER_TOTAL_LIMIT = 64 * 1024 * 1024
HEADER_REPORT_LIMIT = 1 * 1024 * 1024


def within_header_budget(total):
    return type(total) is int and 0 <= total <= HEADER_TOTAL_LIMIT


def within_header_report(raw):
    return type(raw) is bytes and 0 < len(raw) <= HEADER_REPORT_LIMIT

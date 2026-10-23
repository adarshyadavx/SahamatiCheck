"""`python -m sahamati_core.rules` lints the registry (CI); `--update-lock` records versions and hashes."""

import sys

from .registry import check_lock, load_registry_uncached, write_lock


def main() -> int:
    reg, errors = load_registry_uncached()
    if errors or reg is None:
        print("rule registry INVALID:")
        for e in errors:
            print("  -", e)
        return 1
    if "--update-lock" in sys.argv:
        print(f"wrote {write_lock(reg)}")
        return 0
    lock_errors = check_lock(reg)
    if lock_errors:
        print("rule registry lock is out of date:")
        for e in lock_errors:
            print("  -", e)
        return 1
    on = len(reg.enabled())
    print(f"rule registry OK: {len(reg.rules)} rules ({on} enabled), "
          f"{sum(len(r.tests) for r in reg.rules)} test cases, lock verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())

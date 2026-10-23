"""Every registry rule's own test cases (positive, negative, inconclusive, guard), run from the YAML."""

from __future__ import annotations

import pytest
from rule_harness import all_cases, case_id, check_case
from sahamati_core.rules.models import Rule, TestCase


@pytest.mark.parametrize("pair", all_cases(), ids=case_id)
def test_rule_case(pair: tuple[Rule, TestCase]) -> None:
    rule, case = pair
    errs = check_case(rule, case)
    assert not errs, "\n".join(errs)

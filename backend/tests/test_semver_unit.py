import pytest

from app.semver import bump_semver, is_valid, parse


def test_bumps():
    assert bump_semver("1.2.3", "patch") == "1.2.4"
    assert bump_semver("1.2.3", "minor") == "1.3.0"
    assert bump_semver("1.2.3", "major") == "2.0.0"
    assert bump_semver("1.2.3") == "1.2.4"  # padrão: patch


def test_first_publication_becomes_1_0_0_whatever_the_bump():
    for kind in ("patch", "minor", "major"):
        assert bump_semver("0.1.7", kind, publishing=True) == "1.0.0"  # type: ignore[arg-type]
    # já publicada antes: segue o tipo escolhido
    assert bump_semver("1.4.0", "patch", publishing=True) == "1.4.1"


def test_drafts_start_below_1_and_keep_counting():
    assert bump_semver("0.1.0", "patch") == "0.1.1"
    assert bump_semver("0.1.9", "minor") == "0.2.0"


def test_numbers_are_not_limited_to_one_digit():
    assert bump_semver("1.9.9", "patch") == "1.9.10"
    assert bump_semver("1.9.10", "minor") == "1.10.0"
    assert bump_semver("9.99.99", "major") == "10.0.0"


def test_parse_and_validation():
    assert parse("2.10.3") == (2, 10, 3)
    for bad in ("1.2", "v1.2.3", "1.2.3.4", "a.b.c", "", None):
        assert not is_valid(bad)
    with pytest.raises(ValueError):
        parse("1.2")

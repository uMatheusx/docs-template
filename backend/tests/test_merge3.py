import random

import pytest

from app.merge3 import merge3

BASE = "# Título\n\nPrimeiro parágrafo.\n\nSegundo parágrafo.\n\nTerceiro parágrafo.\n"


def test_identical_texts_merge_to_themselves():
    result = merge3(BASE, BASE, BASE)
    assert result.clean and result.render() == BASE


def test_changes_in_different_places_are_combined():
    ours = BASE.replace("Primeiro parágrafo.", "Primeiro parágrafo, revisado.")
    theirs = BASE.replace("Terceiro parágrafo.", "Terceiro parágrafo, ampliado.")
    result = merge3(BASE, ours, theirs)
    assert result.clean
    merged = result.render()
    assert "Primeiro parágrafo, revisado." in merged and "Terceiro parágrafo, ampliado." in merged
    assert "Segundo parágrafo." in merged


def test_only_proposal_changed_takes_the_proposal():
    theirs = BASE.replace("Segundo", "Segundo (novo)")
    assert merge3(BASE, BASE, theirs).render() == theirs


def test_only_page_changed_keeps_the_page():
    ours = BASE + "\nApêndice.\n"
    assert merge3(BASE, ours, BASE).render() == ours


def test_same_change_on_both_sides_is_not_a_conflict():
    both = BASE.replace("Segundo parágrafo.", "Segundo parágrafo igual.")
    result = merge3(BASE, both, both)
    assert result.clean and result.render() == both


def test_overlapping_changes_are_a_conflict_with_context():
    ours = BASE.replace("Segundo parágrafo.", "Segundo da página.")
    theirs = BASE.replace("Segundo parágrafo.", "Segundo da proposta.")
    result = merge3(BASE, ours, theirs)
    assert not result.clean and len(result.conflicts) == 1
    conflict = result.conflicts[0]
    assert conflict.base == ["Segundo parágrafo.\n"]
    assert conflict.ours == ["Segundo da página.\n"] and conflict.theirs == ["Segundo da proposta.\n"]
    assert conflict.before[-1] == "\n" and conflict.after[0] == "\n"


@pytest.mark.parametrize(
    ("choice", "expected"),
    [
        ("ours", "Segundo da página.\n"),
        ("theirs", "Segundo da proposta.\n"),
        ("both", "Segundo da página.\nSegundo da proposta.\n"),
    ],
)
def test_resolutions(choice, expected):
    ours = BASE.replace("Segundo parágrafo.", "Segundo da página.")
    theirs = BASE.replace("Segundo parágrafo.", "Segundo da proposta.")
    merged = merge3(BASE, ours, theirs).render([choice])
    assert expected in merged
    assert merged.startswith("# Título\n\nPrimeiro parágrafo.\n\n") and merged.endswith("Terceiro parágrafo.\n")


def test_render_requires_a_choice_per_conflict():
    ours = BASE.replace("Segundo parágrafo.", "A")
    theirs = BASE.replace("Segundo parágrafo.", "B")
    result = merge3(BASE, ours, theirs)
    with pytest.raises(ValueError, match="cada conflito"):
        result.render()
    with pytest.raises(ValueError, match="cada conflito"):
        result.render(["ours", "ours"])
    with pytest.raises(ValueError, match="inválida"):
        result.render(["nenhuma"])  # type: ignore[list-item]


def test_multiple_conflicts_are_resolved_in_order():
    base = "a\n\nb\n\nc\n\nd\n"
    ours = "a1\n\nb\n\nc\n\nd1\n"
    theirs = "a2\n\nb\n\nc\n\nd2\n"
    result = merge3(base, ours, theirs)
    assert len(result.conflicts) == 2
    assert result.render(["ours", "theirs"]) == "a1\n\nb\n\nc\n\nd2\n"


def test_deletion_by_one_side_and_edit_elsewhere_by_the_other():
    base = BASE + "\nQuarto parágrafo.\n"
    ours = base.replace("Segundo parágrafo.\n\n", "")
    theirs = base.replace("Quarto parágrafo.", "Quarto parágrafo, ampliado.")
    merged = merge3(base, ours, theirs).render()
    assert "Segundo parágrafo." not in merged and "ampliado" in merged


def test_edits_on_adjacent_lines_are_a_conflict():
    """Como no git: sem uma linha intacta entre as duas edições, não dá para saber qual vence."""
    result = merge3("uma\nduas\n", "uma editada\nduas\n", "uma\nduas editada\n")
    assert len(result.conflicts) == 1


def test_missing_final_newline_is_preserved():
    base = "linha 1\nlinha 2\nlinha 3"
    ours = "linha 1 editada\nlinha 2\nlinha 3"
    theirs = "linha 1\nlinha 2\nlinha 3 editada"
    assert merge3(base, ours, theirs).render() == "linha 1 editada\nlinha 2\nlinha 3 editada"


def test_empty_base_with_both_sides_adding_text_conflicts():
    result = merge3("", "A\n", "B\n")
    assert len(result.conflicts) == 1 and result.render(["both"]) == "A\nB\n"


def test_random_non_overlapping_edits_always_combine():
    """Propriedade: edições em linhas distintas, uma de cada lado, nunca geram conflito e preservam as duas."""
    rng = random.Random(7)
    for _ in range(200):
        n = rng.randint(6, 30)
        base_lines = [f"linha {i}\n" for i in range(n)]
        # linhas separadas por pelo menos uma linha intacta, para as regiões não se tocarem
        spots = sorted(rng.sample(range(1, n - 1, 2), k=min(2, len(range(1, n - 1, 2)))))
        if len(spots) < 2:
            continue
        ours_lines, theirs_lines = list(base_lines), list(base_lines)
        ours_lines[spots[0]] = "mudou na página\n"
        theirs_lines[spots[1]] = "mudou na proposta\n"
        result = merge3("".join(base_lines), "".join(ours_lines), "".join(theirs_lines))
        assert result.clean
        expected = list(base_lines)
        expected[spots[0]], expected[spots[1]] = "mudou na página\n", "mudou na proposta\n"
        assert result.render() == "".join(expected)

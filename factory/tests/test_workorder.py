import pytest

from factory_lib import workorder
from factory_lib.workorder import WorkOrderError

from .conftest import HERE


def test_the_real_work_order_parses_into_all_nine_fields():
    wo = workorder.parse(HERE / "workorders" / "WO-001-case-insensitive-picker.md")
    assert (wo.id, wo.title) == ("WO-001", "Case-insensitive player picker")
    assert set(wo.fields) == set(workorder.FIELDS)
    assert "frontend/src/shooter.ts" in wo.files and "frontend/e2e/validation.e2e.ts" in wo.files
    assert (wo.max_repairs, wo.minutes, wo.budget_seconds) == (2, 45, 2700)
    labels = [c.label for c in wo.checks]
    assert labels[0] == "frontend lint" and labels[-1] == "new tests fail without the change"
    assert wo.checks[-1].command.startswith("fails-first:")
    assert wo.checks[0].cwd == "frontend"


def test_a_missing_field_is_named(tmp_path, write_order):
    text = write_order().read_text().replace("Stop:         Two failed repair attempts.\n", "")
    bad = tmp_path / "bad.md"
    bad.write_text(text)
    with pytest.raises(WorkOrderError, match="Stop"):
        workorder.parse(bad)


def test_a_check_needs_label_folder_and_command(tmp_path, write_order):
    bad = tmp_path / "bad.md"
    bad.write_text(write_order().read_text().replace("the shooter is fixed | . | python3 check.py", "just a command"))
    with pytest.raises(WorkOrderError, match="label"):
        workorder.parse(bad)


def test_the_budget_needs_repairs_and_minutes(tmp_path, write_order):
    bad = tmp_path / "bad.md"
    bad.write_text(write_order().read_text().replace("2 repair attempts, 30 minutes", "soon"))
    with pytest.raises(WorkOrderError, match="Budget"):
        workorder.parse(bad)


def test_the_heading_must_name_the_order(tmp_path, write_order):
    bad = tmp_path / "bad.md"
    bad.write_text(write_order().read_text().replace("# WO-001 Make the shooter fixed", "# Make the shooter fixed"))
    with pytest.raises(WorkOrderError, match="heading"):
        workorder.parse(bad)

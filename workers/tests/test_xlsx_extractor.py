import pathlib
from extractors.xlsx_extractor import extract

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "sample.xlsx"


def test_xlsx_contains_sheet_names():
    result = extract(FIXTURE.read_bytes())
    assert "Expenses" in result.markdown
    assert "Summary" in result.markdown


def test_xlsx_contains_cell_values():
    result = extract(FIXTURE.read_bytes())
    assert "Legal Fees" in result.text
    assert "1000" in result.text or "1000" in result.markdown


def test_xlsx_metadata_has_sheet_names():
    result = extract(FIXTURE.read_bytes())
    assert "sheet_names" in result.metadata
    assert "Expenses" in result.metadata["sheet_names"]


def test_xlsx_no_attachments():
    result = extract(FIXTURE.read_bytes())
    assert result.attachments == []

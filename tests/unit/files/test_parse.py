"""Structured chat-file reads retain source locations and enforce hard limits."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from octop.infra.files.parse import FileParseError, ParseLimits, parse_file


def test_plain_text_segments_keep_original_line_numbers(tmp_path: Path) -> None:
    path = tmp_path / "notes.txt"
    path.write_text("first line\n\nthird line\n", encoding="utf-8")

    result = parse_file(path)

    assert [(segment.text, segment.locator) for segment in result.segments] == [
        ("first line", {"kind": "text_line", "start": 1, "end": 1}),
        ("third line", {"kind": "text_line", "start": 3, "end": 3}),
    ]
    assert result.coverage.complete is True
    assert result.coverage.characters == len("first linethird line")


def test_csv_segments_keep_row_and_column_locations(tmp_path: Path) -> None:
    path = tmp_path / "sales.csv"
    path.write_text('name,comment\nAda,"said, hello"\n', encoding="utf-8")

    result = parse_file(path)

    assert [(segment.text, segment.locator) for segment in result.segments] == [
        ("name\tcomment", {"kind": "csv_row", "row": 1}),
        ("Ada\tsaid, hello", {"kind": "csv_row", "row": 2}),
    ]


def test_pdf_segments_keep_one_based_page_number(tmp_path: Path) -> None:
    from pypdf import PdfWriter

    path = tmp_path / "report.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    writer.add_blank_page(width=72, height=72)
    with path.open("wb") as output:
        writer.write(output)

    result = parse_file(path)

    assert result.coverage.total_units == 2
    assert result.coverage.empty_units == 2
    assert result.coverage.complete is True
    assert result.segments == ()


def test_pdf_page_with_images_and_no_text_is_marked_for_ocr(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import pypdf

    class ImageOnlyPage:
        images = [object()]

        @staticmethod
        def extract_text() -> str:
            return ""

    class ImageOnlyPdf:
        is_encrypted = False
        pages = [ImageOnlyPage()]

    path = tmp_path / "scan.pdf"
    path.write_bytes(b"synthetic pdf parser fixture")
    monkeypatch.setattr(pypdf, "PdfReader", lambda _path: ImageOnlyPdf())

    result = parse_file(path)

    assert result.coverage.complete is False
    assert result.coverage.ocr_needed_units == 1
    assert result.coverage.empty_units == 1


def test_xlsx_segments_keep_sheet_and_row_locations(tmp_path: Path) -> None:
    from openpyxl import Workbook

    path = tmp_path / "sales.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    assert sheet is not None
    sheet.title = "Q1"
    sheet.append(["item", "qty"])
    sheet.append(["apple", 2])
    workbook.save(path)

    result = parse_file(path)

    assert [(segment.text, segment.locator) for segment in result.segments] == [
        ("item\tqty", {"kind": "spreadsheet_row", "sheet": "Q1", "row": 1}),
        ("apple\t2", {"kind": "spreadsheet_row", "sheet": "Q1", "row": 2}),
    ]
    assert result.coverage.total_units == 2


def test_xlsx_cell_budget_is_cumulative_across_sheets(tmp_path: Path) -> None:
    from openpyxl import Workbook

    path = tmp_path / "many-sheets.xlsx"
    workbook = Workbook()
    workbook.active.append(["a", "b"])
    second = workbook.create_sheet("second")
    second.append(["c", "d"])
    workbook.save(path)

    result = parse_file(path, limits=ParseLimits(max_cells=3))

    assert result.coverage.complete is False
    assert result.coverage.total_units is None
    assert [segment.locator["sheet"] for segment in result.segments] == ["Sheet"]


@pytest.mark.parametrize(
    "entry_name", ["../outside.txt", "folder/../outside.txt", "/absolute.txt", "folder//file.txt"]
)
def test_office_archive_rejects_traversal_and_ambiguous_paths(
    tmp_path: Path, entry_name: str
) -> None:
    path = tmp_path / "bad.docx"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(entry_name, b"content")

    with pytest.raises(FileParseError, match="invalid path"):
        parse_file(path)


def test_csv_character_limit_stops_reading_and_marks_partial(tmp_path: Path) -> None:
    path = tmp_path / "large.csv"
    path.write_text("first\nsecond\nthird\n", encoding="utf-8")

    result = parse_file(path, limits=ParseLimits(max_characters=7))

    assert [segment.text for segment in result.segments] == ["first"]
    assert result.coverage.complete is False
    assert result.coverage.truncated is True


def test_compressed_office_container_is_rejected_before_expansion(tmp_path: Path) -> None:
    path = tmp_path / "bomb.docx"
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", b"0" * 20_000)

    with pytest.raises(FileParseError, match="archive"):
        parse_file(path, limits=ParseLimits(max_archive_ratio=2))

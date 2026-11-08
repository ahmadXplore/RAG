"""PDFParser — fast, high-fidelity PDF parser using PyMuPDF (fitz) or pypdf.

Extracts text, headings, paragraphs, and page structure from research papers and educational documents.
Produces NormalizedDocument conforming to the RAG ingestion pipeline contract.
"""
from __future__ import annotations

import logging
import re
import time
from pathlib import Path

logger = logging.getLogger(__name__)

from packages.ingestion.parsed_document import (
    NormalizedDocument,
    ParsedHeading,
    ParsedPage,
    ParsedParagraph,
    ParsedTable,
    ParserProvenance,
)
from packages.ingestion.parsers.base import BaseParser

_PDF_PARSER_VERSION = "1.0.0"

try:
    from rapidocr_onnxruntime import RapidOCR
    _RAPIDOCR_AVAILABLE = True
except ImportError:
    _RAPIDOCR_AVAILABLE = False

try:
    import pymupdf as fitz  # PyMuPDF
    _PYMUPDF_AVAILABLE = True
except ImportError:
    try:
        import fitz
        _PYMUPDF_AVAILABLE = True
    except ImportError:
        _PYMUPDF_AVAILABLE = False

try:
    import pypdf
    _PYPDF_AVAILABLE = True
except ImportError:
    _PYPDF_AVAILABLE = False


class PDFParser(BaseParser):
    """Parses PDF documents into structured NormalizedDocument representations."""

    @property
    def name(self) -> str:
        return "pymupdf_pdf"

    @property
    def version(self) -> str:
        return _PDF_PARSER_VERSION

    def parse(
        self,
        file_path: Path,
        document_id: str,
        document_version_id: str,
    ) -> NormalizedDocument:
        """Parse a PDF file into a NormalizedDocument."""
        self._check_path(file_path)

        start = time.monotonic()
        pages: list[ParsedPage] = []
        headings: list[ParsedHeading] = []
        paragraphs: list[ParsedParagraph] = []
        tables: list[ParsedTable] = []
        reading_order = 0

        if _PYMUPDF_AVAILABLE:
            doc = fitz.open(str(file_path))
            for page_idx, page in enumerate(doc, 1):
                page_text = page.get_text()
                pages.append(ParsedPage(page_number=page_idx, text=page_text, is_empty=not page_text.strip()))

                # Extract blocks
                blocks = page.get_text("blocks")
                current_section_path = ""
                for b in blocks:
                    text = b[4].strip()
                    if not text:
                        continue

                    # Filter out simple page numbers or small footer lines
                    if re.match(r"^(page\s+\d+|\d+\s+of\s+\d+|\d+)$", text, re.IGNORECASE):
                        continue

                    lines = text.split("\n")
                    first_line = lines[0].strip()

                    # Heading detection heuristics
                    is_heading = (
                        len(lines) == 1
                        and len(text) < 80
                        and (
                            re.match(r"^(abstract|introduction|background|methodology|methods|experiments|results|discussion|conclusion|references|related work)", text, re.IGNORECASE)
                            or re.match(r"^\d+(\.\d+)*\s+[A-Z]", text)
                            or (text.isupper() and len(text) > 3)
                        )
                    )

                    if is_heading:
                        level = 1 if re.match(r"^(\d+\s+[A-Z]|abstract|introduction|conclusion|references)", text, re.IGNORECASE) else 2
                        headings.append(
                            ParsedHeading(
                                level=level,
                                text=text,
                                page=page_idx,
                                path=text,
                            )
                        )
                        current_section_path = text
                    else:
                        reading_order += 1
                        paragraphs.append(
                            ParsedParagraph(
                                text=text,
                                page=page_idx,
                                section_path=current_section_path,
                                reading_order=reading_order,
                            )
                        )

            doc.close()

            # Fallback for scanned image PDFs with no extractable text layer
            if not paragraphs and _RAPIDOCR_AVAILABLE:
                logger.info(
                    "PDF '%s' has no selectable text stream. Activating RapidOCR for scanned image pages...",
                    file_path.name,
                )
                ocr = RapidOCR()
                doc = fitz.open(str(file_path))
                # For scanned books, OCR up to 25 foundational pages
                max_ocr_pages = min(25, len(doc))
                current_heading = "Overview"

                for p_idx in range(max_ocr_pages):
                    page = doc[p_idx]
                    pix = page.get_pixmap(dpi=90)
                    img_bytes = pix.tobytes("png")
                    ocr_res, _ = ocr(img_bytes)
                    if not ocr_res:
                        continue

                    page_lines = [l[1] for l in ocr_res if l and len(l) > 1 and l[1].strip()]
                    if not page_lines:
                        continue

                    first_line = page_lines[0].strip()
                    if len(first_line) < 70 and (
                        re.match(r"^(chapter|preface|contents|introduction|\d+)", first_line, re.IGNORECASE)
                        or first_line.isupper()
                    ):
                        headings.append(
                            ParsedHeading(
                                level=1,
                                text=first_line,
                                page=p_idx + 1,
                                path=first_line,
                            )
                        )
                        current_heading = first_line
                        page_lines = page_lines[1:]

                    if page_lines:
                        page_text = "\n".join(page_lines)
                        reading_order += 1
                        paragraphs.append(
                            ParsedParagraph(
                                text=page_text,
                                page=p_idx + 1,
                                section_path=current_heading,
                                reading_order=reading_order,
                            )
                        )
                doc.close()
        elif _PYPDF_AVAILABLE:
            reader = pypdf.PdfReader(str(file_path))
            for page_idx, page in enumerate(reader.pages, 1):
                text = page.extract_text() or ""
                pages.append(ParsedPage(page_number=page_idx, text=text, is_empty=not text.strip()))
                paragraphs.append(
                    ParsedParagraph(
                        text=text,
                        page=page_idx,
                        section_path="",
                        reading_order=page_idx,
                    )
                )
        else:
            raise RuntimeError("Neither PyMuPDF nor pypdf is installed for PDF parsing.")

        duration = time.monotonic() - start

        return NormalizedDocument(
            document_id=document_id,
            document_version_id=document_version_id,
            pages=pages,
            headings=headings,
            paragraphs=paragraphs,
            tables=tables,
            provenance=ParserProvenance(
                parser_name=self.name,
                parser_version=self.version,
                duration_seconds=round(duration, 3),
                fallback_used=False,
                fallback_reason="",
            ),
        )

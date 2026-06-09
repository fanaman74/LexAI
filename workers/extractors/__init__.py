from extractors.common import ExtractionResult, detect_source_type


def _route_attachment(data: bytes) -> ExtractionResult:
    return ExtractionResult(
        text="[attachment — requeued for extraction]",
        markdown="*attachment — requeued for extraction*",
        metadata={"note": "routed as attachment"},
    )


def extract(source_type: str, data: bytes) -> ExtractionResult:
    """Route raw bytes to the correct extractor by source_type."""
    _EXTRACTORS = {
        "pdf": lambda d: __import__("extractors.pdf_extractor", fromlist=["extract"]).extract(d),
        "docx": lambda d: __import__("extractors.docx_extractor", fromlist=["extract"]).extract(d),
        "xlsx": lambda d: __import__("extractors.xlsx_extractor", fromlist=["extract"]).extract(d),
        "eml": lambda d: __import__("extractors.eml_extractor", fromlist=["extract"]).extract(d),
        "msg": lambda d: __import__("extractors.msg_extractor", fromlist=["extract"]).extract(d),
        "email_attachment": lambda d: _route_attachment(d),
    }
    fn = _EXTRACTORS.get(source_type)
    if fn is None:
        return ExtractionResult(
            text="",
            markdown="",
            metadata={"error": f"unsupported source_type: {source_type}"},
        )
    return fn(data)

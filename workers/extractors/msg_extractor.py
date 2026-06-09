from __future__ import annotations
import io
import traceback
import extract_msg
from extractors.common import ExtractionResult, Attachment, html_to_markdown


def extract(data: bytes) -> ExtractionResult:
    try:
        msg = extract_msg.openMsg(io.BytesIO(data))
    except Exception as e:
        return ExtractionResult(
            text="",
            markdown="",
            metadata={"parse_error": True, "error": str(e)},
        )

    try:
        sender = getattr(msg, "sender", "") or ""
        subject = getattr(msg, "subject", "") or ""
        date = str(getattr(msg, "date", "") or "")
        to_addrs = [r.email for r in (getattr(msg, "recipients", []) or [])]
        cc = getattr(msg, "cc", "") or ""
        body = getattr(msg, "body", "") or ""
        html_body = getattr(msg, "htmlBody", None)
        if not body and html_body:
            body = html_to_markdown(
                html_body.decode("utf-8", errors="replace") if isinstance(html_body, bytes) else html_body
            )

        attachments: list[Attachment] = []
        for att in (getattr(msg, "attachments", []) or []):
            fname = getattr(att, "longFilename", None) or getattr(att, "shortFilename", "attachment")
            att_data = getattr(att, "data", None) or b""
            attachments.append(Attachment(
                filename=fname,
                data=att_data if isinstance(att_data, bytes) else bytes(att_data),
                content_type="application/octet-stream",
            ))

        header_md = (
            f"# Email\n\n"
            f"**From:** {sender}  \n"
            f"**To:** {', '.join(to_addrs)}  \n"
            + (f"**CC:** {cc}  \n" if cc else "")
            + f"**Date:** {date}  \n"
            f"**Subject:** {subject}  \n"
        )
        att_list = "\n".join(f"{i+1}. {a.filename}" for i, a in enumerate(attachments))
        att_md = f"\n\n## Attachments\n\n{att_list}" if attachments else ""
        markdown = header_md + "\n\n## Body\n\n" + body + att_md

        metadata = {
            "from": sender,
            "to": to_addrs,
            "cc": cc,
            "subject": subject,
            "date": date,
        }
        return ExtractionResult(
            text=f"From: {sender}\nTo: {', '.join(to_addrs)}\nSubject: {subject}\n\n{body}",
            markdown=markdown,
            metadata=metadata,
            attachments=attachments,
        )
    except Exception as e:
        return ExtractionResult(
            text="",
            markdown="",
            metadata={"parse_error": True, "error": str(e), "traceback": traceback.format_exc()},
        )

from __future__ import annotations
import email
import email.policy
from email.header import decode_header
from extractors.common import ExtractionResult, Attachment, html_to_markdown


def _decode_header_value(val: str | None) -> str:
    if not val:
        return ""
    parts = decode_header(val)
    return "".join(
        p.decode(enc or "utf-8") if isinstance(p, bytes) else p
        for p, enc in parts
    )


def extract(data: bytes) -> ExtractionResult:
    msg = email.message_from_bytes(data, policy=email.policy.compat32)

    from_addr = _decode_header_value(msg.get("From", ""))
    to_addrs = [a.strip() for a in _decode_header_value(msg.get("To", "")).split(",") if a.strip()]
    cc_addrs = [a.strip() for a in _decode_header_value(msg.get("Cc", "")).split(",") if a.strip()]
    subject = _decode_header_value(msg.get("Subject", ""))
    date_str = msg.get("Date", "")
    message_id = msg.get("Message-ID", "")

    body_text = ""
    body_html = ""
    attachments: list[Attachment] = []

    for part in msg.walk():
        ct = part.get_content_type()
        cd = part.get("Content-Disposition", "")
        if "attachment" in cd:
            filename = part.get_filename() or "attachment"
            att_bytes = part.get_payload(decode=True) or b""
            attachments.append(Attachment(
                filename=filename,
                data=att_bytes,
                content_type=ct,
            ))
        elif ct == "text/plain" and not body_text:
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                body_text = payload.decode(charset, errors="replace")
        elif ct == "text/html" and not body_html:
            payload = part.get_payload(decode=True)
            if payload:
                charset = part.get_content_charset() or "utf-8"
                body_html = payload.decode(charset, errors="replace")

    body = body_text or html_to_markdown(body_html)

    header_md = (
        f"# Email\n\n"
        f"**From:** {from_addr}  \n"
        f"**To:** {', '.join(to_addrs)}  \n"
        + (f"**CC:** {', '.join(cc_addrs)}  \n" if cc_addrs else "")
        + f"**Date:** {date_str}  \n"
        f"**Subject:** {subject}  \n"
    )
    att_list = "\n".join(f"{i+1}. {a.filename}" for i, a in enumerate(attachments))
    att_md = f"\n\n## Attachments\n\n{att_list}" if attachments else ""
    markdown = header_md + "\n\n## Body\n\n" + body + att_md

    metadata = {
        "from": from_addr,
        "to": to_addrs,
        "cc": cc_addrs,
        "subject": subject,
        "date": date_str,
        "message_id": message_id,
    }
    return ExtractionResult(
        text=f"From: {from_addr}\nTo: {', '.join(to_addrs)}\nSubject: {subject}\n\n{body}",
        markdown=markdown,
        metadata=metadata,
        attachments=attachments,
    )

"""Email sending. Uses SMTP when SMTP_HOST is set, otherwise writes to ./outbox and prints
the message to the console, so password-reset links are visible during development."""
import os
import pathlib
import smtplib
from datetime import datetime
from email.message import EmailMessage


def send_email(to: str, subject: str, body: str) -> None:
    host = os.getenv("SMTP_HOST")
    if host:
        m = EmailMessage()
        m["From"] = os.getenv("MAIL_FROM", "billing@brightloop.local")
        m["To"] = to
        m["Subject"] = subject
        m.set_content(body)
        with smtplib.SMTP(host, int(os.getenv("SMTP_PORT", "587"))) as s:
            s.starttls()
            user = os.getenv("SMTP_USER")
            if user:
                s.login(user, os.getenv("SMTP_PASSWORD", ""))
            s.send_message(m)
        return
    outbox = pathlib.Path(os.getenv("OUTBOX_DIR", "outbox"))
    outbox.mkdir(exist_ok=True)
    (outbox / f"{datetime.now():%Y%m%d-%H%M%S-%f}.txt").write_text(
        f"To: {to}\nSubject: {subject}\n\n{body}"
    )
    print(f"[mail] to={to} subject={subject}\n{body}")

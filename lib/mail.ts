import nodemailer from "nodemailer";

export interface MailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

export async function sendMail(options: MailOptions): Promise<void> {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.MAIL_FROM || "Brightloop Billing <no-reply@brightloop.test>";

  if (host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      return;
    } catch (err) {
      console.warn("SMTP send failed, falling back to console output:", err);
    }
  }

  // Fallback: print full email and links to server console
  console.log("\n==================== [OUTGOING EMAIL] ====================");
  console.log(`From:    ${from}`);
  console.log(`To:      ${options.to}`);
  console.log(`Subject: ${options.subject}`);
  console.log("-------------------- CONTENT -----------------------------");
  if (options.text) {
    console.log(options.text);
  }
  if (options.html) {
    console.log("\nHTML version:");
    console.log(options.html);
  }
  console.log("==========================================================\n");
}


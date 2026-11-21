import { checkSmtp } from "./mailer.js";

const result = await checkSmtp();
if (result === "verified") {
  console.log("SMTP connection verified. No email was sent.");
} else {
  console.error(
    result === "missing_configuration"
      ? "Configure SMTP_URL and SMTP_FROM (or MAIL_FROM) before checking SMTP."
      : "SMTP verification failed. Check the server address, TLS settings, and credentials.",
  );
  process.exitCode = 1;
}

import { checkSmtp, sendMail } from "./mailer.js";

const [, , option, recipient, ...extra] = process.argv;
const missingConfiguration =
  "Configure SMTP_URL and SMTP_FROM (or MAIL_FROM) before checking SMTP.";
const mailbox = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

if (option === undefined) {
  const result = await checkSmtp();
  if (result === "verified") {
    console.log("SMTP connection verified. No email was sent.");
  } else {
    console.error(
      result === "missing_configuration"
        ? missingConfiguration
        : "SMTP verification failed. Check the server address, TLS settings, and credentials.",
    );
    process.exitCode = 1;
  }
} else if (option !== "--send-to" || !recipient || !mailbox.test(recipient) || extra.length) {
  console.error("Usage: npm run check:smtp -- --send-to test-mailbox@example.com");
  process.exitCode = 2;
} else if (!process.env.SMTP_URL || !(process.env.SMTP_FROM || process.env.MAIL_FROM)) {
  console.error(missingConfiguration);
  process.exitCode = 1;
} else {
  try {
    await sendMail({
      to: recipient,
      subject: "Forme SMTP delivery test",
      text: "If you received this message, your Forme studio can deliver email to this mailbox.",
    });
    console.log(
      "SMTP server accepted the Forme test message. Check the test mailbox and spam folder.",
    );
  } catch {
    console.error("SMTP delivery check failed. Check the SMTP settings, sender, and test mailbox.");
    process.exitCode = 1;
  }
}

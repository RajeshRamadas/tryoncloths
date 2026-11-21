import nodemailer from "nodemailer";

function smtpTransport(smtpUrl) {
  return nodemailer.createTransport({
    url: smtpUrl,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
}

export async function checkSmtp({
  smtpUrl = process.env.SMTP_URL,
  from = process.env.SMTP_FROM || process.env.MAIL_FROM,
  createTransport = smtpTransport,
} = {}) {
  if (!smtpUrl || !from) return "missing_configuration";
  try {
    return (await createTransport(smtpUrl).verify()) === true ? "verified" : "failed";
  } catch {
    return "failed";
  }
}

export function createMailer({
  smtpUrl = process.env.SMTP_URL,
  from = process.env.SMTP_FROM || process.env.MAIL_FROM,
  transport,
} = {}) {
  let client = transport;
  return async function sendMail({ to, subject, html, text, attachments, messageId, headers }) {
    if (!from || (!client && !smtpUrl))
      throw Object.assign(
        new Error("Transactional email needs SMTP_URL and SMTP_FROM configured on the server."),
        { status: 503 },
      );
    try {
      client ||= smtpTransport(smtpUrl);
      const result = await client.sendMail({
        from,
        to,
        subject,
        html,
        text,
        attachments,
        messageId,
        headers,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (result?.rejected?.length) throw new Error("Recipient rejected");
    } catch {
      throw Object.assign(new Error("Email could not be delivered. Please try again later."), {
        status: 503,
      });
    }
  };
}
export const sendMail = createMailer();

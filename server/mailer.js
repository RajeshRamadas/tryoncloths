import nodemailer from 'nodemailer';

export function createMailer({smtpUrl=process.env.SMTP_URL,from=process.env.SMTP_FROM,transport}={}) {
  let client = transport;
  return async function sendMail({to,subject,html,text}) {
    if (!from || (!client && !smtpUrl)) throw Object.assign(new Error('Staff invitations need SMTP_URL and SMTP_FROM configured on the server.'),{status:503});
    try {
      client ||= nodemailer.createTransport({url:smtpUrl,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:10000});
      const result = await client.sendMail({from,to,subject,html,text,disableFileAccess:true,disableUrlAccess:true});
      if (result?.rejected?.length) throw new Error('Recipient rejected');
    } catch {
      throw Object.assign(new Error('Invitation email could not be delivered. Please try again later.'),{status:503});
    }
  };
}
export const sendMail = createMailer();

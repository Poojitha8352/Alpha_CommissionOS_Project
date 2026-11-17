const config = require('../config');

let transporter = null;
let lastError = '';
function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
    });
  }
  return transporter;
}

// Returns true if the mail was handed to the SMTP server, false if mail is not configured / failed.
async function sendMail({ to, subject, text, html, replyTo, attachments }) {
  const t = getTransporter();
  if (!t) { lastError = 'E-mail is not set up on the server: SMTP_HOST is empty in server/.env.'; console.error('[mail] ' + lastError); return false; }
  try {
    lastError = '';
    await t.sendMail({ from: config.smtp.from, to, subject, text, html, replyTo, attachments });
    return true;
  } catch (err) {
    lastError = err.message || 'Could not send the e-mail.';
    console.error('[mail] failed:', err.message);
    return false;
  }
}

const mailError = () => lastError;

module.exports = { sendMail, mailError };

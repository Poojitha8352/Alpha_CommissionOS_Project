const config = require('../config');

let transporter = null;
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
  if (!t) return false;
  try {
    await t.sendMail({ from: config.smtp.from, to, subject, text, html, replyTo, attachments });
    return true;
  } catch (err) {
    console.error('[mail] failed:', err.message);
    return false;
  }
}

module.exports = { sendMail };
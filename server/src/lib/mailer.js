const config = require('../config');
const dns = require('dns');

let transporter = null;
let lastError = '';

// Resolve IPv4 addresses first. Many home / office networks reset (ECONNRESET) IPv6 connections to SMTP servers.
try { dns.setDefaultResultOrder('ipv4first'); } catch (_) {}

function getTransporter() {
  if (!config.smtp.host) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');

    const port = Number(config.smtp.port) || 587;
    const secure = port === 465;

    console.log(`[mail] SMTP: ${config.smtp.host}:${port} (secure=${secure}, user=${config.smtp.user})`);

    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port,
      secure,                 // 465 -> true, 587 -> false (STARTTLS)
      requireTLS: !secure,    // 587: STARTTLS is compulsory
      family: 4,              // force IPv4 (fixes "read ECONNRESET" on networks that drop IPv6)
      tls: { servername: config.smtp.host },
      connectionTimeout: 20000,
      greetingTimeout: 20000,
      socketTimeout: 30000,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: String(config.smtp.pass || '').replace(/\s+/g, '') }
        : undefined,
    });
  }
  return transporter;
}

// Returns true if the mail was handed to the SMTP server, false if mail is not configured / failed.
async function sendMail({ to, subject, text, html, replyTo, attachments }) {
  const t = getTransporter();
  if (!t) {
    lastError = 'E-mail is not set up on the server: SMTP_HOST is empty in server/.env.';
    console.error('[mail] ' + lastError);
    return false;
  }
  try {
    lastError = '';
    await t.sendMail({
      from: config.smtp.from || config.smtp.user,
      to,
      subject,
      text,
      html,
      replyTo,
      attachments,
    });
    return true;
  } catch (err) {
    lastError = err.message || 'Could not send the e-mail.';
    console.error('[mail] failed:', err.message);
    transporter = null; // next attempt uses a fresh connection
    return false;
  }
}

const mailError = () => lastError;

module.exports = { sendMail, mailError };

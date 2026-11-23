// Quick SMTP check:  node test-mail.js   (run inside the server folder)
require('dotenv').config();
const nodemailer = require('nodemailer');
const config = require('./src/config');
const port = Number(config.smtp.port) || 587;
const t = nodemailer.createTransport({
  host: config.smtp.host, port, secure: port === 465, requireTLS: port !== 465, family: 4,
  tls: { servername: config.smtp.host }, connectionTimeout: 20000,
  auth: { user: config.smtp.user, pass: String(config.smtp.pass || '').replace(/\s+/g, '') },
});
console.log(`Checking ${config.smtp.host}:${port} as ${config.smtp.user} ...`);
t.verify().then(() => console.log('SMTP OK - mail can be sent.')).catch((e) => console.log('SMTP FAILED:', e.code || '', e.message));

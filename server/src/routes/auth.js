const express = require('express');
const { z } = require('zod');
const prisma = require('../db');
const config = require('../config');
const wrap = require('../middleware/wrap');
const { requireAuth } = require('../middleware/auth');
const { httpError } = require('../lib/errors');
const { signToken } = require('../lib/tokens');
const { hashPassword, checkPassword, publicUser, recordLogin } = require('../lib/accounts');

const router = express.Router();

const portalSchema = z.enum(['admin', 'employee', 'user']).default('user');
const credentials = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(100),
  email: z.string().trim().toLowerCase().email('Please enter a valid email address.'),
  password: z.string().min(6, 'Password must be at least 6 characters.').max(200),
  portal: portalSchema,
});

const employeeRecordFor = async (email) =>
  prisma.employee.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });

// admin -> #admin, employee -> #employee, user -> the normal login page.
// Returns the (possibly upgraded) account.
async function assertPortal(account, portal) {
  if (account.status !== 'Active') throw httpError(403, 'This account is suspended. Please contact your administrator.');
  if (portal === 'admin' && account.role !== 'admin') throw httpError(403, 'This account does not have admin access.');
  if (portal !== 'admin' && account.role === 'admin') {
    throw httpError(403, 'Admin accounts must sign in from the Admin portal (#admin).');
  }
  // an older "user" account whose e-mail is on the employee list becomes an employee when it uses the employee portal
  if (portal === 'employee' && account.role === 'user' && (await employeeRecordFor(account.email))) {
    return prisma.account.update({ where: { id: account.id }, data: { role: 'employee', tokenVersion: account.tokenVersion + 1 } });
  }
  if (portal === 'employee' && account.role !== 'employee') {
    throw httpError(403, 'This is not an employee account. Please sign in from the normal login page.');
  }
  if (portal === 'user' && account.role === 'employee') {
    throw httpError(403, 'This is an employee account. Please sign in from the Employee portal (#employee).');
  }
  return account;
}

async function session(account, { provider, portal, name }) {
  const updated = await recordLogin(account, { provider, page: portal === 'user' ? 'default' : `#${portal}`, name });
  return { token: signToken(updated), user: publicUser(updated) };
}

// Public settings the login page needs
router.get('/config', (req, res) => {
  res.json({ googleClientId: config.googleClientId, demoGoogle: !config.googleClientId && config.allowDemoGoogle });
});

router.post('/register', wrap(async (req, res) => {
  const body = credentials.parse(req.body);
  if (body.portal === 'admin') throw httpError(403, 'Admin accounts cannot be self-registered.');
  const existing = await prisma.account.findUnique({ where: { email: body.email } });
  if (existing) throw httpError(409, 'An account with this email already exists. Please sign in.');
  // employees can only join with the e-mail the admin added to Employees & Partners
  if (body.portal === 'employee' && !(await employeeRecordFor(body.email))) {
    throw httpError(403, 'This e-mail is not on the employee list. Ask your admin to add you in Employees & Partners first.');
  }
  const account = await prisma.account.create({
    data: {
      name: body.name,
      email: body.email,
      role: body.portal === 'employee' ? 'employee' : 'user',
      provider: 'Email',
      passwordHash: await hashPassword(body.password),
    },
  });
  res.status(201).json(await session(account, { provider: 'Email', portal: body.portal, name: body.name }));
}));

router.post('/login', wrap(async (req, res) => {
  const body = credentials.parse(req.body);
  const account = await prisma.account.findUnique({ where: { email: body.email } });
  if (!account) {
    throw httpError(404, body.portal === 'admin'
      ? 'No admin account found with this email.'
      : 'No account found for this email. Please create an account first.');
  }
  if (!(await checkPassword(body.password, account.passwordHash))) throw httpError(401, 'Incorrect password.');
  const ready = await assertPortal(account, body.portal);
  res.json(await session(ready, { provider: 'Email', portal: body.portal, name: body.name }));
}));

async function verifyGoogleProfile(body) {
  if (config.googleClientId) {
    if (!body.idToken) throw httpError(400, 'Missing Google credential.');
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(config.googleClientId);
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: body.idToken, audience: config.googleClientId });
      payload = ticket.getPayload();
    } catch (err) {
      throw httpError(401, 'Google sign-in could not be verified.');
    }
    if (!payload || !payload.email || payload.email_verified === false) throw httpError(401, 'Google account email is not verified.');
    return { name: payload.name || payload.email, email: payload.email.toLowerCase() };
  }
  if (config.allowDemoGoogle && body.profile) {
    const p = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().toLowerCase().email() }).parse(body.profile);
    return p;
  }
  throw httpError(501, 'Google sign-in is not configured on the server (set GOOGLE_CLIENT_ID).');
}

router.post('/google', wrap(async (req, res) => {
  const portal = portalSchema.parse(req.body.portal);
  const profile = await verifyGoogleProfile(req.body);
  let account = await prisma.account.findUnique({ where: { email: profile.email } });
  if (account) {
    account = await assertPortal(account, portal);
  } else {
    if (portal === 'admin' && !config.adminGoogleEmails.includes(profile.email)) {
      throw httpError(403, 'This Google account is not an authorised admin.');
    }
    if (portal === 'employee' && !(await employeeRecordFor(profile.email))) {
      throw httpError(403, 'This e-mail is not on the employee list. Ask your admin to add you in Employees & Partners first.');
    }
    account = await prisma.account.create({
      data: { name: profile.name, email: profile.email, role: portal === 'admin' ? 'admin' : portal === 'employee' ? 'employee' : 'user', provider: 'Google' },
    });
  }
  res.json(await session(account, { provider: 'Google', portal, name: profile.name }));
}));

// Re-checks the signed-in person's password (used before payments). Does not create a new session.
router.post('/confirm', requireAuth, wrap(async (req, res) => {
  const b = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).parse(req.body);
  if (b.email !== req.account.email) throw httpError(403, 'Enter the email of the account you are signed in with.');
  // Google-only accounts have no password; they are already authenticated by their token
  if (req.account.passwordHash && !(await checkPassword(b.password, req.account.passwordHash))) {
    throw httpError(401, 'Incorrect password.');
  }
  res.json({ ok: true });
}));

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.account) });
});

module.exports = router;
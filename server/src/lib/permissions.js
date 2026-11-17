// Who may change what.
//   admin    -> everything
//   employee -> sees only their own records, and may only (a) update the phone number on their OWN employee record,
//               (b) raise disputes / add comments on their OWN disputes, (c) add comments on their OWN statements (approval workflow)
//   user     -> sees everything; writes only: pay for a subscription, raise disputes and add notes to disputes (Module 11)
const prisma = require('../db');
const { httpError } = require('./errors');
const { COLLECTIONS, fromRow } = require('./collections');

const lc = (v) => String(v || '').trim().toLowerCase();

async function employeeOf(account) {
  const rows = await prisma.employee.findMany({ where: { email: { equals: account.email, mode: 'insensitive' } } });
  if (rows.length) return fromRow(COLLECTIONS.employees, rows[0]);
  const byName = (await prisma.employee.findMany({})).filter((e) => lc(e.name) === lc(account.name));
  return byName.length === 1 ? fromRow(COLLECTIONS.employees, byName[0]) : null;
}

// Returns the body that may really be written (possibly reduced), or throws 403.
async function authoriseWrite({ account, name, method, id, body, existing }) {
  if (account.role === 'admin') return body;
  if (account.role === 'user') {
    // users are view-only, except Module 11 (Disputes & Adjustments): they may raise disputes and add notes
    if (name === 'disputes' && method === 'POST') return { ...body, status: 'Open', employee: body.employee || account.name };
    if (name === 'disputes' && method === 'PUT') {
      if (!existing) throw httpError(404, 'Dispute not found.');
      return { ...existing, comments: Array.isArray(body.comments) ? body.comments : existing.comments };
    }
    throw httpError(403, 'View-only access: you cannot change data.');
  }
  if (account.role !== 'employee') throw httpError(403, 'View-only access: you cannot change data.');

  const me = await employeeOf(account);
  if (!me) throw httpError(403, 'Your login is not linked to an employee record yet. Ask your admin to add you with this e-mail.');

  if (name === 'employees' && method === 'PUT') {
    if (!existing || existing.id !== me.id) throw httpError(403, 'You can only update your own details.');
    // employees may change only their phone number
    return { ...existing, phone: body.phone === undefined ? existing.phone : body.phone };
  }
  if (name === 'disputes' && method === 'POST') {
    return { ...body, employee: me.name, status: 'Open' };
  }
  if (name === 'disputes' && method === 'PUT') {
    if (!existing || lc(existing.employee) !== lc(me.name)) throw httpError(403, 'You can only add comments to your own disputes.');
    return { ...existing, comments: Array.isArray(body.comments) ? body.comments : existing.comments };
  }
  if (name === 'statements' && method === 'PUT') {
    if (!existing || !(existing.employeeId === me.id || lc(existing.employee) === lc(me.name))) throw httpError(403, 'You can only comment on your own statements.');
    return { ...existing, comments: Array.isArray(body.comments) ? body.comments : existing.comments };
  }
  throw httpError(403, 'Employees have limited access: you cannot change this.');
}

module.exports = { employeeOf, authoriseWrite };

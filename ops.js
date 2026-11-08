// Lógica de operación de Visapp (sin base de datos, para poder probarla):
// cita, recordatorios, cobros, retención de datos, reportes y aviso por correo.

const crypto = require('crypto');

const RETENTION_DAYS = 60; // los datos se borran 2 meses después de la última cita
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '');
const date = (v) => (typeof v === 'string' && DATE_RE.test(v) && !isNaN(Date.parse(v)) ? v : '');
const time = (v) => (typeof v === 'string' && TIME_RE.test(v) ? v : '');
const newId = () => crypto.randomBytes(6).toString('hex');
const todayStr = (now = new Date()) => now.toISOString().slice(0, 10);

// ── Cita (la captura el administrador) ──────────────────────────────────────
function sanitizeAppointment(a) {
  a = a || {};
  return {
    casDate: date(a.casDate), casTime: time(a.casTime),
    interviewDate: date(a.interviewDate), interviewTime: time(a.interviewTime),
    consulate: str(a.consulate, 120),
    ds160Confirmation: str(a.ds160Confirmation, 40),
    mrvPaid: a.mrvPaid === 'si' ? 'si' : '',
    notes: str(a.notes, 500),
  };
}

// ── Recordatorios (los marca el administrador) ──────────────────────────────
function sanitizeReminders(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 50).map((r) => ({
    id: str(r && r.id, 20) || newId(),
    date: date(r && r.date),
    text: str(r && r.text, 200),
    done: !!(r && r.done),
  })).filter((r) => r.text);
}

// ── Cobros ──────────────────────────────────────────────────────────────────
const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10000000 ? Math.round(n * 100) / 100 : 0;
};
function sanitizePayments(p) {
  p = p || {};
  const items = Array.isArray(p.items) ? p.items.slice(0, 100) : [];
  return {
    price: money(p.price),
    items: items.map((it) => ({
      id: str(it && it.id, 20) || newId(),
      date: date(it && it.date) || todayStr(),
      amount: money(it && it.amount),
      method: str(it && it.method, 40),
      note: str(it && it.note, 120),
    })).filter((it) => it.amount > 0),
  };
}
function balance(payments) {
  const price = money(payments && payments.price);
  const paid = ((payments && payments.items) || []).reduce((s, it) => s + money(it.amount), 0);
  return { price, paid: Math.round(paid * 100) / 100, due: Math.max(0, Math.round((price - paid) * 100) / 100) };
}

// ── Hoja de captura (secciones ya capturadas en el portal oficial) ──────────
function sanitizeCapture(c, sectionIds) {
  const out = {};
  sectionIds.forEach((id) => { if (c && c[id]) out[id] = true; });
  return out;
}

// ── Retención: borrar datos 2 meses después de la última cita ───────────────
function lastAppointment(appointment) {
  const dates = [appointment && appointment.casDate, appointment && appointment.interviewDate].filter((d) => d && DATE_RE.test(d));
  return dates.length ? dates.sort().pop() : null;
}
function purgeDate(appointment) {
  const last = lastAppointment(appointment);
  if (!last) return null;
  const d = new Date(last + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + RETENTION_DAYS);
  return d.toISOString().slice(0, 10);
}
function isPurgeDue(appointment, now = new Date()) {
  const p = purgeDate(appointment);
  return !!p && p <= todayStr(now);
}

// Borra respuestas y documentos de las solicitudes vencidas; conserva nombre, estado y cobros.
async function purgeExpired(pool, now = new Date()) {
  const { rows } = await pool.query(
    `select id, appointment from applications where purged_at is null and (appointment ? 'interviewDate' or appointment ? 'casDate')`
  );
  let purged = 0;
  for (const r of rows) {
    if (!isPurgeDue(r.appointment, now)) continue;
    const entry = JSON.stringify([{ ts: now.toISOString(), action: 'purged', detail: 'Datos y documentos eliminados (2 meses después de la cita)' }]);
    await pool.query('delete from application_documents where application_id = $1', [r.id]);
    await pool.query(
      `update applications set data = '{}'::jsonb, capture = '{}'::jsonb, purged_at = now(),
         log = coalesce(log, '[]'::jsonb) || $2::jsonb where id = $1`,
      [r.id, entry]
    );
    purged++;
  }
  return purged;
}

// ── Reportes ────────────────────────────────────────────────────────────────
function monthKey(iso) { return String(iso || '').slice(0, 7); }
function lastMonths(n, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}
// apps: [{ status, created_at, submitted_at, payments }]
function buildReport(apps, now = new Date()) {
  const byStatus = {};
  const months = lastMonths(6, now).map((m) => ({ month: m, created: 0, submitted: 0, income: 0 }));
  const idx = Object.fromEntries(months.map((m, i) => [m.month, i]));
  let due = 0, collected = 0, hoursSum = 0, hoursN = 0;
  apps.forEach((a) => {
    byStatus[a.status] = (byStatus[a.status] || 0) + 1;
    const c = monthKey(a.created_at instanceof Date ? a.created_at.toISOString() : a.created_at);
    if (c in idx) months[idx[c]].created++;
    if (a.submitted_at) {
      const s = monthKey(a.submitted_at instanceof Date ? a.submitted_at.toISOString() : a.submitted_at);
      if (s in idx) months[idx[s]].submitted++;
      const h = (new Date(a.submitted_at) - new Date(a.created_at)) / 36e5;
      if (h >= 0) { hoursSum += h; hoursN++; }
    }
    const b = balance(a.payments);
    due += b.due; collected += b.paid;
    ((a.payments && a.payments.items) || []).forEach((it) => {
      const m = monthKey(it.date);
      if (m in idx) months[idx[m]].income += money(it.amount);
    });
  });
  const thisMonth = months[months.length - 1];
  return {
    totals: {
      applications: apps.length,
      submitted: apps.filter((a) => a.submitted_at).length,
      avgHoursToSubmit: hoursN ? Math.round((hoursSum / hoursN) * 10) / 10 : null,
    },
    byStatus,
    months,
    money: { collected: Math.round(collected * 100) / 100, due: Math.round(due * 100) / 100, thisMonth: Math.round(thisMonth.income * 100) / 100 },
  };
}

// ── Aviso por correo (opcional: requiere SMTP_URL) ──────────────────────────
let transporter;
function getTransport() {
  if (transporter !== undefined) return transporter;
  const url = process.env.SMTP_URL;
  if (!url) { transporter = null; return null; }
  const nodemailer = require('nodemailer');
  transporter = url === 'json' ? nodemailer.createTransport({ jsonTransport: true }) : nodemailer.createTransport(url);
  return transporter;
}
async function sendMail({ to, subject, text }) {
  const t = getTransport();
  if (!t || !to) return false;
  const info = await t.sendMail({ from: process.env.SMTP_FROM || 'Visapp <no-reply@visapp.local>', to, subject, text });
  if (process.env.SMTP_URL === 'json') console.log('[mail json]', info.message);
  return true;
}

module.exports = {
  RETENTION_DAYS, sanitizeAppointment, sanitizeReminders, sanitizePayments, sanitizeCapture, balance,
  lastAppointment, purgeDate, isPurgeDue, purgeExpired, buildReport, sendMail, todayStr, newId,
};

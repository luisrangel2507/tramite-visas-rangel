// Prueba de integración: necesita Postgres. Uso:
//   TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:54329/visapp_test npm run test:api
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');

const URL_DB = process.env.TEST_DATABASE_URL;
if (!URL_DB) { test('API (omitida: falta TEST_DATABASE_URL)', { skip: true }, () => {}); return; }
process.env.DATABASE_URL = URL_DB;
process.env.SMTP_URL = 'json';

const express = require('express');
const { pool, ensureSchema } = require('../db');
const visa = require('../visa');
const DS = require('../public/ds160-logic');
const { SECTIONS } = require('../ds160-schema');

let server, base, tok;
async function call(method, path, body, headers = {}) {
  const res = await fetch(base + '/api/visa' + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await res.json(); } catch (e) {}
  return { status: res.status, json };
}
const admin = (m, p, b) => call(m, p, b, { 'x-auth-token': tok });

test.before(async () => {
  await ensureSchema();
  await pool.query('truncate application_documents, applications, tokens, users, settings cascade');
  const app = express(); app.use(express.json()); app.use('/api/visa', visa);
  await new Promise((r) => { server = http.createServer(app).listen(0, r); });
  base = 'http://127.0.0.1:' + server.address().port;
  let r = await call('POST', '/register', { name: 'Luis', email: 'luis.rangel2507@gmail.com', password: 'secreto1' });
  assert.strictEqual(r.status, 200, 'el correo con puntos debe poder registrarse');
  tok = r.json.token;
});
test.after(async () => { server.close(); await pool.end(); });

test('registro: otro correo no puede ser administrador y la respuesta no filtra el salt', async () => {
  const r = await call('POST', '/register', { name: 'X', email: 'otro@gmail.com', password: 'secreto1' });
  assert.strictEqual(r.status, 403);
  const l = await call('POST', '/login', { email: 'luis.rangel2507@gmail.com', password: 'secreto1' });
  assert.strictEqual(l.status, 200);
  assert.ok(!('salt' in l.json.user));
});

test('flujo completo: crear, llenar, consentir, enviar, avisar, cobrar, familia, depurar', async () => {
  // admin sin sesión
  assert.strictEqual((await call('GET', '/admin/applications')).status, 401);

  const c = await admin('POST', '/admin/applications', { name: 'Ana Prueba', note: 'wa' });
  const id = c.json.application.id, link = c.json.application.token;

  // consentimiento y datos del asesor visibles al cliente
  await admin('PUT', '/admin/settings', { whatsapp: '+52 442 123 4567', notifyEmail: 'luis@x.com', advisorName: 'Luis' });
  let open = await call('GET', '/s/' + link);
  assert.strictEqual(open.json.advisor.whatsapp, '524421234567');
  assert.strictEqual(open.json.privacyAcceptedAt, null);
  assert.strictEqual((await call('POST', '/s/' + link + '/consent')).status, 200);
  open = await call('GET', '/s/' + link);
  assert.ok(open.json.privacyAcceptedAt);
  assert.strictEqual((await call('GET', '/public-config')).json.whatsapp, '524421234567');

  // llenar todo el formulario ("No" a todo) y enviar
  const data = {};
  const fill = (fields, scope) => { for (let g = 0; g < 5; g++) fields.forEach((f) => {
    if (!DS.isVisible(f, scope)) return;
    if (f.type === 'list') { scope[f.id] = scope[f.id] && scope[f.id].length ? scope[f.id] : [{}]; scope[f.id].forEach((it) => fill(f.fields, it)); }
    else if (!scope[f.id]) scope[f.id] = f.type === 'yesno' ? 'no' : f.type === 'select' ? f.options[0].value : f.type === 'date' ? '2000-01-01' : f.type === 'number' ? '3' : 'X';
  }); };
  SECTIONS.forEach((s) => fill(s.fields, data));
  data.declaracion = 'si';
  assert.strictEqual((await call('PUT', '/s/' + link, { patch: data })).status, 200);
  const sub = await call('POST', '/s/' + link + '/submit');
  assert.strictEqual(sub.status, 200, JSON.stringify(sub.json));

  // aviso en el panel (no leído) y luego "visto"
  let ov = await admin('GET', '/admin/overview');
  assert.strictEqual(ov.json.unread, 1);
  let list = await admin('GET', '/admin/applications');
  assert.strictEqual(list.json.applications[0].unread, true);
  await admin('POST', `/admin/applications/${id}/seen`);
  ov = await admin('GET', '/admin/overview');
  assert.strictEqual(ov.json.unread, 0);

  // cita, recordatorios, cobros, captura
  const today = new Date().toISOString().slice(0, 10);
  const ct = await admin('PUT', `/admin/applications/${id}/cita`, { appointment: { casDate: '2026-01-10', interviewDate: '2026-01-20', consulate: 'CDMX' } });
  assert.strictEqual(ct.json.purgeOn, '2026-03-21');
  await admin('PUT', `/admin/applications/${id}/reminders`, { reminders: [{ text: 'Llamar a Ana', date: today }, { text: 'Futuro', date: '2999-01-01' }] });
  ov = await admin('GET', '/admin/overview');
  assert.strictEqual(ov.json.reminders.length, 1);
  assert.strictEqual(ov.json.reminders[0].text, 'Llamar a Ana');
  const pay = await admin('PUT', `/admin/applications/${id}/payments`, { payments: { price: 3000, items: [{ amount: 1000, date: today }] } });
  assert.deepStrictEqual(pay.json.balance, { price: 3000, paid: 1000, due: 2000 });
  const cap = await admin('PUT', `/admin/applications/${id}/capture`, { capture: { personal: true, nada: true } });
  assert.deepStrictEqual(cap.json.capture, { personal: true });

  // familia: copia solo lo elegido
  const dup = await admin('POST', `/admin/applications/${id}/duplicate`, { name: 'Pedro Prueba', copy: ['domicilio', 'contactoEEUU'] });
  assert.strictEqual(dup.status, 200);
  const det = await admin('GET', `/admin/applications/${dup.json.application.id}`);
  assert.strictEqual(det.json.data.calle, 'X');
  assert.ok(!('hospedajeCalle' in det.json.data));
  assert.strictEqual(det.json.members.length, 2);
  assert.strictEqual(det.json.application.groupSize, 2);

  // reportes
  const rep = await admin('GET', '/admin/reports');
  assert.strictEqual(rep.json.totals.applications, 2);
  assert.strictEqual(rep.json.money.due, 2000);

  // depuración 2 meses después de la cita
  assert.strictEqual(await visa.purgeExpired(), 2, 'Ana y Pedro comparten las fechas de la cita');
  assert.strictEqual((await call('GET', '/s/' + link)).status, 410);
  const after = await admin('GET', `/admin/applications/${id}`);
  assert.deepStrictEqual(after.json.data, {});
  assert.strictEqual(after.json.documents.length, 0);
  assert.ok(after.json.application.purgedAt);
  assert.strictEqual(after.json.payments.price, 3000, 'los cobros se conservan');
  assert.strictEqual(await visa.purgeExpired(), 0, 'no se repite');
});

test('enlace inválido o regenerado deja de funcionar', async () => {
  const c = await admin('POST', '/admin/applications', { name: 'Zed' });
  const old = c.json.application.token;
  assert.strictEqual((await call('GET', '/s/' + old)).status, 200);
  await admin('POST', `/admin/applications/${c.json.application.id}/regenerate-link`);
  assert.strictEqual((await call('GET', '/s/' + old)).status, 404);
  assert.strictEqual((await call('GET', '/s/nope')).status, 404);
});

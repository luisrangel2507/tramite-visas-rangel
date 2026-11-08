// Visapp — API.
//   · Cliente: entra con un enlace secreto (/s/<token>), sin cuenta ni contraseña.
//   · Administrador (Ing. Rangel): inicia sesión, crea solicitudes/enlaces y ve las respuestas.
// Almacenamiento en Postgres (Supabase u otro) vía DATABASE_URL.

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const contentDisposition = require('content-disposition');
const { pool } = require('./db');
const { SECTIONS, DATALISTS, STATUS_OPTIONS, DOCUMENT_CATEGORIES, FAMILY_COPY } = require('./ds160-schema');
const ops = require('./ops');
const DS160 = require('./public/ds160-logic');

const DEFAULT_STATUS = STATUS_OPTIONS[0].value;
const RECEIVED_STATUS = 'formulario_recibido';
const ADMIN_EMAIL = (process.env.VISA_ADMIN_EMAIL || 'luisrangel2507@gmail.com').toLowerCase();
const EXTRA_KEYS = ['declaracion']; // claves fuera del esquema que el cliente puede guardar
const MAX_DOCS_PER_APPLICATION = 20;
// Gmail ignora los puntos y lo que va tras "+": luis.rangel@gmail.com == luisrangel@gmail.com.
function sameMailbox(a, b) {
  const norm = (e) => {
    const [user, domain] = String(e).trim().toLowerCase().split('@');
    if (domain === 'gmail.com' || domain === 'googlemail.com') return user.split('+')[0].replace(/\./g, '') + '@gmail.com';
    return user + '@' + domain;
  };
  return norm(a) === norm(b);
}
// ── Acceso de clientes (usuario + contraseña) ───────────────────────────────
const PASS_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword() {
  const bytes = crypto.randomBytes(8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += PASS_CHARS[bytes[i] % PASS_CHARS.length];
  return out;
}
function slugName(name) {
  const w = String(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return 'cliente';
  const last = w.length > 1 ? w[w.length > 2 ? w.length - 2 : 1] : '';
  return last ? w[0] + '.' + last : w[0];
}
// Límite de intentos fallidos: 8 por usuario/IP, bloqueo de 15 min.
const attempts = new Map();
function lockedOut(key) { const e = attempts.get(key); return !!e && e.n >= 8 && e.until > Date.now(); }
function recordFail(key) {
  if (attempts.size > 5000) attempts.clear();
  let e = attempts.get(key);
  if (!e || (e.until && e.until <= Date.now())) e = { n: 0, until: 0 };
  e.n++; if (e.n >= 8) e.until = Date.now() + 15 * 60 * 1000;
  attempts.set(key, e);
}
const clearFails = (key) => attempts.delete(key);

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

function wrap(fn, publicRoute) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: publicRoute ? 'Error de servidor. Intenta de nuevo en unos minutos.' : 'Error de servidor: ' + err.message });
    });
  };
}
const pub = (fn) => wrap(fn, true);

// ── Utilidades ───────────────────────────────────────────────────────────────
function newToken() { return crypto.randomBytes(18).toString('base64url'); }
function newId() { return crypto.randomBytes(12).toString('hex'); }

function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  return test.length === stored.length && crypto.timingSafeEqual(test, stored);
}
function publicUser(u) { return { id: u.id, name: u.name, email: u.email, isAdmin: !!u.is_admin }; }

function mapDoc(d) {
  return { id: d.id, category: d.category, originalName: d.original_name, mimetype: d.mimetype, size: Number(d.size), uploadedAt: d.uploaded_at };
}
function statusOf(a) { return { status: a.status, note: a.status_note, updatedAt: a.status_updated_at }; }

async function pushLog(appId, action, detail) {
  const entry = JSON.stringify([{ ts: new Date().toISOString(), action, detail: detail || '' }]);
  await pool.query(`update applications set log = coalesce(log, '[]'::jsonb) || $2::jsonb where id = $1`, [appId, entry]);
}

async function findApplicationByToken(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const { rows } = await pool.query('select * from applications where token = $1', [token]);
  return rows[0] || null;
}
async function findApplicationById(id) {
  const { rows } = await pool.query('select * from applications where id = $1', [id]);
  return rows[0] || null;
}
async function uniqueUsername(name) {
  const base = slugName(name);
  for (let i = 0; i < 12; i++) {
    const cand = base + (i < 8 ? String(10 + crypto.randomInt(90)) : String(1000 + crypto.randomInt(9000)));
    const { rowCount } = await pool.query('select 1 from applications where lower(username) = $1', [cand]);
    if (!rowCount) return cand;
  }
  return base + crypto.randomBytes(3).toString('hex');
}
// Crea (o restablece) el acceso de un cliente. La contraseña solo se devuelve aquí.
async function issueCredentials(a) {
  const username = a.username || (await uniqueUsername(a.client_name));
  const password = generatePassword();
  const salt = crypto.randomBytes(16).toString('hex');
  await pool.query('update applications set username = $2, pass_salt = $3, pass_hash = $4, pass_changed_at = now() where id = $1',
    [a.id, username, salt, hashPassword(password, salt)]);
  await pool.query('delete from client_sessions where application_id = $1', [a.id]);
  return { username, password };
}
async function startClientSession(appId) {
  const token = crypto.randomBytes(24).toString('hex');
  await pool.query("delete from client_sessions where application_id = $1 and created_at < now() - interval '30 days'", [appId]);
  await pool.query('insert into client_sessions (token, application_id) values ($1,$2)', [token, appId]);
  return token;
}
async function validClientSession(token, appId) {
  if (!token || typeof token !== 'string' || token.length > 100) return false;
  const { rowCount } = await pool.query("select 1 from client_sessions where token = $1 and application_id = $2 and created_at > now() - interval '30 days'", [token, appId]);
  return rowCount > 0;
}

async function listDocs(appId) {
  const { rows } = await pool.query(
    'select id, category, original_name, mimetype, size, uploaded_at from application_documents where application_id = $1 order by uploaded_at asc',
    [appId]
  );
  return rows.map(mapDoc);
}

// Verifica el contenido real del archivo (no solo el tipo que declara el navegador).
function looksLikeAllowedFile(buf) {
  if (!buf || buf.length < 12) return false;
  const head = buf.subarray(0, 12);
  const is = (...bytes) => bytes.every((b, i) => head[i] === b);
  return (
    is(0x25, 0x50, 0x44, 0x46) ||                       // PDF
    is(0xff, 0xd8, 0xff) ||                             // JPEG
    is(0x89, 0x50, 0x4e, 0x47) ||                       // PNG
    is(0x47, 0x49, 0x46, 0x38) ||                       // GIF
    (is(0x52, 0x49, 0x46, 0x46) && head.subarray(8, 12).toString() === 'WEBP') ||
    head.subarray(4, 8).toString() === 'ftyp'           // HEIC/HEIF
  );
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    const ok = /^image\/|^application\/pdf$/.test(file.mimetype);
    cb(ok ? null : new Error('Tipo de archivo no permitido (solo imágenes o PDF)'), ok);
  },
});

function sendDocument(res, entry) {
  res.set('Content-Type', entry.mimetype);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Content-Disposition', contentDisposition(entry.original_name, { type: 'attachment' }));
  res.send(entry.content);
}

const router = express.Router();

// ── Ajustes del asesor ───────────────────────────────────────────────────────
async function getSettings() {
  const { rows } = await pool.query("select value from settings where key = 'main'");
  const v = (rows[0] && rows[0].value) || {};
  return { whatsapp: String(v.whatsapp || ''), notifyEmail: String(v.notifyEmail || ''), advisorName: String(v.advisorName || 'Ing. Luis Eduardo Rangel Llanes') };
}
router.get('/public-config', pub(async (req, res) => {
  const st = await getSettings();
  res.json({ whatsapp: st.whatsapp, advisorName: st.advisorName });
}));

// ── Esquema (público, para renderizar el formulario) ─────────────────────────
router.get('/schema', (req, res) => {
  res.json({ sections: SECTIONS, datalists: DATALISTS, statusOptions: STATUS_OPTIONS, documentCategories: DOCUMENT_CATEGORIES, familyCopy: FAMILY_COPY, retentionDays: ops.RETENTION_DAYS });
});

// ══ CLIENTE (enlace secreto) ═════════════════════════════════════════════════
async function resolveLink(req, res) {
  const a = await findApplicationByToken(req.params.token);
  if (!a) { res.status(404).json({ error: 'Este enlace no es válido o ya no está activo. Pide uno nuevo a tu asesor.' }); return null; }
  if (a.purged_at) { res.status(410).json({ error: 'Este trámite ya fue cerrado y, por tu privacidad, tus datos fueron eliminados.' }); return null; }
  return a;
}
// Solo identifica la solicitud por su enlace (sin sesión): para la pantalla de contraseña.
async function loadLinkOnly(req, res, next) {
  try { const a = await resolveLink(req, res); if (!a) return; req.application = a; next(); }
  catch (err) { console.error(err); res.status(500).json({ error: 'Error de servidor. Intenta de nuevo en unos minutos.' }); }
}
// Enlace + sesión iniciada con usuario y contraseña.
async function loadByLink(req, res, next) {
  try {
    const a = await resolveLink(req, res); if (!a) return;
    if (!(await validClientSession(req.headers['x-client-session'], a.id))) {
      return res.status(401).json({ error: 'Inicia sesión para continuar.', needsLogin: true });
    }
    req.application = a;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error de servidor. Intenta de nuevo en unos minutos.' });
  }
}

router.get('/s/:token/hello', loadLinkOnly, pub(async (req, res) => {
  const a = req.application;
  res.json({ clientName: a.client_name, username: a.username || '', hasAccess: !!a.pass_hash });
}));

function checkPassword(a, password) { return !!a.pass_hash && verifyPassword(String(password || ''), a.pass_salt, a.pass_hash); }

router.post('/s/:token/login', loadLinkOnly, pub(async (req, res) => {
  const a = req.application;
  const key = req.ip + '|' + a.id;
  if (lockedOut(key)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
  if (!checkPassword(a, (req.body || {}).password)) { recordFail(key); return res.status(401).json({ error: 'Contraseña incorrecta' }); }
  clearFails(key);
  res.json({ ok: true, session: await startClientSession(a.id) });
}));

router.post('/client/login', pub(async (req, res) => {
  const username = String((req.body || {}).username || '').trim().toLowerCase().slice(0, 80);
  const password = String((req.body || {}).password || '');
  const key = req.ip + '|' + username;
  if (lockedOut(key)) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
  const { rows } = await pool.query('select * from applications where lower(username) = $1', [username]);
  const a = rows[0];
  if (!a || !checkPassword(a, password)) { recordFail(key); return res.status(401).json({ error: 'Usuario o contraseña incorrectos' }); }
  if (a.purged_at) return res.status(410).json({ error: 'Este trámite ya fue cerrado y, por tu privacidad, tus datos fueron eliminados.' });
  clearFails(key);
  res.json({ ok: true, session: await startClientSession(a.id), linkToken: a.token, clientName: a.client_name });
}));

router.post('/s/:token/logout', loadByLink, pub(async (req, res) => {
  await pool.query('delete from client_sessions where token = $1', [req.headers['x-client-session']]);
  res.json({ ok: true });
}));

router.get('/s/:token', loadByLink, pub(async (req, res) => {
  const a = req.application;
  await pool.query('update applications set last_opened_at = now() where id = $1', [a.id]);
  const cfg = await getSettings();
  res.json({
    clientName: a.client_name,
    privacyAcceptedAt: a.privacy_accepted_at,
    advisor: { name: cfg.advisorName, whatsapp: cfg.whatsapp },
    data: a.data || {},
    status: statusOf(a),
    submittedAt: a.submitted_at,
    updatedAt: a.updated_at,
    documents: await listDocs(a.id),
  });
}));

router.post('/s/:token/consent', loadByLink, pub(async (req, res) => {
  await pool.query('update applications set privacy_accepted_at = coalesce(privacy_accepted_at, now()) where id = $1', [req.application.id]);
  await pushLog(req.application.id, 'privacy_accepted', 'El cliente aceptó el aviso de privacidad');
  res.json({ ok: true });
}));

router.put('/s/:token', loadByLink, pub(async (req, res) => {
  const patch = DS160.sanitizePatch(SECTIONS, (req.body || {}).patch, EXTRA_KEYS);
  if (!Object.keys(patch).length) return res.json({ ok: true, updatedAt: req.application.updated_at });
  const { rows } = await pool.query(
    `update applications set data = coalesce(data, '{}'::jsonb) || $2::jsonb, updated_at = now()
     where id = $1 returning data, updated_at`,
    [req.application.id, JSON.stringify(patch)]
  );
  const c = DS160.completion(SECTIONS, rows[0].data);
  res.json({ ok: true, updatedAt: rows[0].updated_at, completion: { filled: c.filled, total: c.total, pct: c.pct, bySection: c.bySection } });
}));

router.post('/s/:token/submit', loadByLink, pub(async (req, res) => {
  const a = req.application;
  const c = DS160.completion(SECTIONS, a.data);
  if (c.missing.length) {
    return res.status(422).json({ error: 'Aún faltan campos por llenar.', missing: c.missing.slice(0, 60), totalMissing: c.missing.length });
  }
  if ((a.data || {}).declaracion !== 'si') {
    return res.status(422).json({ error: 'Debes aceptar la declaración final para enviar.', missing: [] });
  }
  await pool.query(
    `update applications set submitted_at = now(),
       status = case when status = $2 then $3 else status end,
       status_updated_at = case when status = $2 then now() else status_updated_at end
     where id = $1`,
    [a.id, DEFAULT_STATUS, RECEIVED_STATUS]
  );
  await pushLog(a.id, 'submitted', a.submitted_at ? 'Reenviado por el cliente' : 'Formulario enviado por el cliente');
  res.json({ ok: true });
  // Aviso por correo al asesor (opcional; no bloquea la respuesta al cliente).
  getSettings().then((cfg) => ops.sendMail({
    to: cfg.notifyEmail,
    subject: `Visapp: ${a.client_name} envió su formulario`,
    text: `${a.client_name} terminó y envió su formulario DS-160.\n\nRevísalo en el panel de Visapp.`,
  })).catch((e) => console.error('No se pudo enviar el aviso por correo:', e.message));
}));

router.get('/s/:token/documents', loadByLink, pub(async (req, res) => {
  res.json({ documents: await listDocs(req.application.id) });
}));

router.post('/s/:token/documents', loadByLink, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
      if (!looksLikeAllowedFile(req.file.buffer)) {
        return res.status(400).json({ error: 'El archivo no parece una imagen o PDF válido' });
      }
      const a = req.application;
      const { rows: cnt } = await pool.query('select count(*)::int as n from application_documents where application_id = $1', [a.id]);
      if (cnt[0].n >= MAX_DOCS_PER_APPLICATION) {
        return res.status(400).json({ error: `Máximo ${MAX_DOCS_PER_APPLICATION} documentos por solicitud` });
      }
      const category = DOCUMENT_CATEGORIES.some((c) => c.value === req.body.category) ? req.body.category : 'otro';
      const id = crypto.randomBytes(8).toString('hex');
      const name = String(req.file.originalname || 'documento').slice(0, 200);
      await pool.query(
        `insert into application_documents (id, application_id, category, original_name, mimetype, size, content)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, a.id, category, name, req.file.mimetype, req.file.size, req.file.buffer]
      );
      await pushLog(a.id, 'document_uploaded', `${name} (${category})`);
      res.json({ ok: true, document: { id, category, originalName: name, mimetype: req.file.mimetype, size: req.file.size, uploadedAt: new Date().toISOString() } });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error de servidor. Intenta de nuevo.' });
    }
  });
});

router.delete('/s/:token/documents/:id', loadByLink, pub(async (req, res) => {
  const { rows } = await pool.query(
    'delete from application_documents where id = $1 and application_id = $2 returning original_name',
    [req.params.id, req.application.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  await pushLog(req.application.id, 'document_deleted', rows[0].original_name);
  res.json({ ok: true });
}));

// ══ ADMINISTRADOR ════════════════════════════════════════════════════════════
async function auth(req, res, next) {
  try {
    const token = req.headers['x-auth-token'];
    let user = null;
    if (token) {
      const { rows } = await pool.query('select u.* from tokens t join users u on u.id = t.user_id where t.token = $1', [token]);
      user = rows[0] || null;
    }
    if (!user || !user.is_admin) return res.status(401).json({ error: 'No autorizado' });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error de servidor: ' + err.message });
  }
}

async function startSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  await pool.query('insert into tokens (token, user_id) values ($1,$2)', [token, userId]);
  return token;
}

router.post('/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 6) {
    return res.status(400).json({ error: 'Nombre, correo y contraseña (mínimo 6 caracteres) son obligatorios' });
  }
  const emailLc = String(email).trim().toLowerCase();
  if (!sameMailbox(emailLc, ADMIN_EMAIL)) {
    return res.status(403).json({ error: 'El registro está reservado al administrador.' });
  }
  const existing = await pool.query('select 1 from users where email = $1', [emailLc]);
  if (existing.rowCount) return res.status(409).json({ error: 'Ya existe una cuenta con ese correo. Inicia sesión.' });
  const salt = crypto.randomBytes(16).toString('hex');
  const user = { id: newId(), name: String(name).trim(), email: emailLc, salt };
  await pool.query(
    'insert into users (id, name, email, salt, hash, is_admin) values ($1,$2,$3,$4,$5,true)',
    [user.id, user.name, user.email, salt, hashPassword(String(password), salt)]
  );
  res.json({ ok: true, token: await startSession(user.id), user: { id: user.id, name: user.name, email: user.email, isAdmin: true } });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const emailLc = String(email || '').trim().toLowerCase();
  const { rows } = await pool.query('select * from users where email = $1', [emailLc]);
  const user = rows[0];
  if (!user || !verifyPassword(String(password || ''), user.salt, user.hash)) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  if (!user.is_admin) {
    return res.status(403).json({ error: 'Este acceso es solo para el administrador. Los clientes entran con el enlace que les envió su asesor.' });
  }
  res.json({ ok: true, token: await startSession(user.id), user: publicUser(user) });
}));

router.post('/logout', auth, wrap(async (req, res) => {
  await pool.query('delete from tokens where token = $1', [req.token]);
  res.json({ ok: true });
}));

router.get('/me', auth, wrap(async (req, res) => {
  res.json({ user: publicUser(req.user) });
}));

router.put('/password', auth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  if (!verifyPassword(String(currentPassword || ''), req.user.salt, req.user.hash)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  await pool.query('update users set salt = $1, hash = $2 where id = $3', [salt, hashPassword(String(newPassword), salt), req.user.id]);
  res.json({ ok: true });
}));

function summarize(a, docCount, groupSize) {
  const c = DS160.completion(SECTIONS, a.data);
  const payments = a.payments && a.payments.items ? a.payments : { price: 0, items: [] };
  return {
    id: a.id, token: a.token, clientName: a.client_name, note: a.client_note,
    status: statusOf(a), completion: { pct: c.pct, filled: c.filled, total: c.total },
    documentCount: docCount, createdAt: a.created_at, updatedAt: a.updated_at,
    submittedAt: a.submitted_at, lastOpenedAt: a.last_opened_at,
    unread: !!a.submitted_at && (!a.admin_seen_at || new Date(a.admin_seen_at) < new Date(a.submitted_at)),
    groupId: a.group_id || null, groupSize: groupSize || 1,
    username: a.username || '', hasAccess: !!a.pass_hash,
    appointment: a.appointment || {},
    balance: ops.balance(payments),
    purgeOn: ops.purgeDate(a.appointment), purgedAt: a.purged_at,
  };
}

router.get('/admin/applications', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select a.*, (select count(*)::int from application_documents d where d.application_id = a.id) as doc_count
     from applications a order by a.created_at desc`
  );
  const sizes = {};
  rows.forEach((a) => { if (a.group_id) sizes[a.group_id] = (sizes[a.group_id] || 0) + 1; });
  res.json({ applications: rows.map((a) => summarize(a, a.doc_count, sizes[a.group_id])) });
}));

router.post('/admin/applications', auth, wrap(async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 150);
  const note = String((req.body || {}).note || '').trim().slice(0, 300);
  if (!name) return res.status(400).json({ error: 'El nombre del cliente es obligatorio' });
  const id = newId();
  const token = newToken();
  await pool.query('insert into applications (id, token, client_name, client_note) values ($1,$2,$3,$4)', [id, token, name, note]);
  await pushLog(id, 'link_created', 'Solicitud creada por el administrador');
  const credentials = await issueCredentials(await findApplicationById(id));
  res.json({ ok: true, application: summarize(await findApplicationById(id), 0), credentials });
}));

router.get('/admin/applications/:id', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const c = DS160.completion(SECTIONS, a.data);
  const log = Array.isArray(a.log) ? a.log : [];
  const docs = await listDocs(a.id);
  let members = [];
  if (a.group_id) {
    const m = await pool.query('select id, client_name, status, submitted_at from applications where group_id = $1 order by created_at asc', [a.group_id]);
    members = m.rows.map((r) => ({ id: r.id, clientName: r.client_name, status: r.status, submittedAt: r.submitted_at }));
  }
  res.json({
    application: summarize(a, docs.length, members.length || 1),
    data: a.data || {},
    documents: docs,
    log: log.slice(-200).reverse(),
    missing: c.missing,
    appointment: a.appointment || {},
    reminders: Array.isArray(a.reminders) ? a.reminders : [],
    payments: a.payments && a.payments.items ? a.payments : { price: 0, items: [] },
    capture: a.capture || {},
    privacyAcceptedAt: a.privacy_accepted_at,
    members,
  });
}));

router.put('/admin/applications/:id', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const name = String((req.body || {}).name || a.client_name).trim().slice(0, 150);
  const note = String((req.body || {}).note ?? a.client_note).trim().slice(0, 300);
  if (!name) return res.status(400).json({ error: 'El nombre es obligatorio' });
  await pool.query('update applications set client_name = $2, client_note = $3 where id = $1', [a.id, name, note]);
  res.json({ ok: true });
}));

router.put('/admin/applications/:id/status', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const { status, note } = req.body || {};
  const option = STATUS_OPTIONS.find((s) => s.value === status);
  if (!option) return res.status(400).json({ error: 'Estado inválido' });
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  await pool.query('update applications set status = $2, status_note = $3, status_updated_at = now() where id = $1', [a.id, status, cleanNote]);
  await pushLog(a.id, 'status_changed', option.label + (cleanNote ? ` — ${cleanNote}` : ''));
  res.json({ ok: true });
}));

router.post('/admin/applications/:id/credentials', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  if (a.purged_at) return res.status(400).json({ error: 'Este trámite ya fue cerrado' });
  const credentials = await issueCredentials(a);
  await pushLog(a.id, 'credentials_reset', a.pass_hash ? 'Contraseña restablecida por el administrador' : 'Acceso del cliente creado');
  res.json({ ok: true, credentials });
}));

router.post('/admin/applications/:id/regenerate-link', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const token = newToken();
  await pool.query('update applications set token = $2 where id = $1', [a.id, token]);
  await pushLog(a.id, 'link_regenerated', 'El enlace anterior dejó de funcionar');
  res.json({ ok: true, token });
}));

router.delete('/admin/applications/:id', auth, wrap(async (req, res) => {
  const r = await pool.query('delete from applications where id = $1', [req.params.id]);
  if (!r.rowCount) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
}));

router.get('/admin/applications/:id/documents/:docId/download', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from application_documents where id = $1 and application_id = $2',
    [req.params.docId, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  sendDocument(res, rows[0]);
}));


// ── Cita, recordatorios, cobros, hoja de captura (los llena el administrador) ─
router.put('/admin/applications/:id/cita', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const appointment = ops.sanitizeAppointment((req.body || {}).appointment);
  await pool.query('update applications set appointment = $2::jsonb where id = $1', [a.id, JSON.stringify(appointment)]);
  await pushLog(a.id, 'appointment_saved', 'Datos de la cita actualizados');
  res.json({ ok: true, appointment, purgeOn: ops.purgeDate(appointment) });
}));

router.put('/admin/applications/:id/reminders', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const reminders = ops.sanitizeReminders((req.body || {}).reminders);
  await pool.query('update applications set reminders = $2::jsonb where id = $1', [a.id, JSON.stringify(reminders)]);
  res.json({ ok: true, reminders });
}));

router.post('/admin/applications/:id/reminders/:rid/done', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const reminders = (Array.isArray(a.reminders) ? a.reminders : []).map((r) => (r.id === req.params.rid ? { ...r, done: true } : r));
  await pool.query('update applications set reminders = $2::jsonb where id = $1', [a.id, JSON.stringify(reminders)]);
  res.json({ ok: true });
}));

router.put('/admin/applications/:id/payments', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const payments = ops.sanitizePayments((req.body || {}).payments);
  await pool.query('update applications set payments = $2::jsonb where id = $1', [a.id, JSON.stringify(payments)]);
  res.json({ ok: true, payments, balance: ops.balance(payments) });
}));

router.put('/admin/applications/:id/capture', auth, wrap(async (req, res) => {
  const a = await findApplicationById(req.params.id);
  if (!a) return res.status(404).json({ error: 'No encontrado' });
  const capture = ops.sanitizeCapture((req.body || {}).capture, SECTIONS.map((s) => s.id));
  await pool.query('update applications set capture = $2::jsonb where id = $1', [a.id, JSON.stringify(capture)]);
  res.json({ ok: true, capture });
}));

router.post('/admin/applications/:id/seen', auth, wrap(async (req, res) => {
  await pool.query('update applications set admin_seen_at = now() where id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ── Familia / grupo de viaje: nueva solicitud copiando datos compartidos ─────
router.post('/admin/applications/:id/duplicate', auth, wrap(async (req, res) => {
  const src = await findApplicationById(req.params.id);
  if (!src) return res.status(404).json({ error: 'No encontrado' });
  if (src.purged_at) return res.status(400).json({ error: 'Esta solicitud ya fue depurada: no hay datos que copiar' });
  const name = String((req.body || {}).name || '').trim().slice(0, 150);
  if (!name) return res.status(400).json({ error: 'El nombre del nuevo integrante es obligatorio' });
  const wanted = Array.isArray((req.body || {}).copy) ? req.body.copy : [];
  const data = {};
  FAMILY_COPY.filter((g) => wanted.includes(g.id)).forEach((g) => g.fields.forEach((f) => {
    if (src.data && src.data[f] !== undefined && src.data[f] !== '') data[f] = src.data[f];
  }));
  const groupId = src.group_id || newId();
  const id = newId();
  const token = newToken();
  await pool.query('update applications set group_id = $2 where id = $1', [src.id, groupId]);
  await pool.query(
    `insert into applications (id, token, client_name, client_note, data, group_id, appointment, payments)
     values ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,'{}'::jsonb)`,
    [id, token, name, src.client_note || '', JSON.stringify(data), groupId, JSON.stringify(ops.sanitizeAppointment({
      casDate: src.appointment && src.appointment.casDate, interviewDate: src.appointment && src.appointment.interviewDate,
      consulate: src.appointment && src.appointment.consulate }))]
  );
  await pushLog(id, 'link_created', `Agregado al grupo de ${src.client_name} (se copiaron ${Object.keys(data).length} datos)`);
  await pushLog(src.id, 'group_member_added', `Se agregó a ${name} al grupo`);
  const credentials = await issueCredentials(await findApplicationById(id));
  res.json({ ok: true, application: summarize(await findApplicationById(id), 0, 2), credentials });
}));

// ── Resumen del día, reportes y ajustes ──────────────────────────────────────
router.get('/admin/overview', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `select id, client_name, submitted_at, admin_seen_at, reminders, appointment, purged_at from applications where purged_at is null`
  );
  const today = ops.todayStr();
  const reminders = [], upcoming = [];
  let unread = 0;
  rows.forEach((a) => {
    if (a.submitted_at && (!a.admin_seen_at || new Date(a.admin_seen_at) < new Date(a.submitted_at))) unread++;
    (Array.isArray(a.reminders) ? a.reminders : []).forEach((r) => {
      if (!r.done && r.date && r.date <= today) reminders.push({ appId: a.id, clientName: a.client_name, id: r.id, date: r.date, text: r.text, overdue: r.date < today });
    });
    const ap = a.appointment || {};
    [['CAS (biométricos)', ap.casDate, ap.casTime], ['Entrevista', ap.interviewDate, ap.interviewTime]].forEach(([kind, d, t]) => {
      if (d && d >= today) upcoming.push({ appId: a.id, clientName: a.client_name, kind, date: d, time: t || '' });
    });
  });
  reminders.sort((x, y) => x.date.localeCompare(y.date));
  upcoming.sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time));
  res.json({ unread, reminders, upcoming: upcoming.slice(0, 10) });
}));

router.get('/admin/reports', auth, wrap(async (req, res) => {
  const { rows } = await pool.query('select status, created_at, submitted_at, payments from applications');
  res.json(ops.buildReport(rows));
}));

router.get('/admin/settings', auth, wrap(async (req, res) => {
  res.json({ settings: await getSettings(), emailConfigured: !!process.env.SMTP_URL });
}));
router.put('/admin/settings', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const value = {
    whatsapp: String(b.whatsapp || '').replace(/\D/g, '').slice(0, 15),
    notifyEmail: String(b.notifyEmail || '').trim().slice(0, 120),
    advisorName: String(b.advisorName || '').trim().slice(0, 100) || 'Ing. Luis Eduardo Rangel Llanes',
  };
  await pool.query(
    `insert into settings (key, value) values ('main', $1::jsonb) on conflict (key) do update set value = excluded.value`,
    [JSON.stringify(value)]
  );
  res.json({ ok: true, settings: value });
}));

module.exports = router;
module.exports.purgeExpired = () => ops.purgeExpired(pool);

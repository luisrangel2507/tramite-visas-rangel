// Gestión de Trámite de Visas — módulo de backend.
// Almacenamiento en Postgres (Supabase u otro proveedor) vía DATABASE_URL,
// para que los datos sobrevivan a los redeploys. Módulo aparte para no
// inflar server.js.

const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const contentDisposition = require('content-disposition');
const { pool } = require('./db');
const { SECTIONS, DOCUMENT_CATEGORIES, STATUS_OPTIONS } = require('./visa-schema');

const DEFAULT_STATUS = STATUS_OPTIONS[0].value;
const ADMIN_EMAIL = (process.env.VISA_ADMIN_EMAIL || 'luisrangel2507@gmail.com').toLowerCase();

function wrap(fn) {
  return (req, res) => {
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: 'Error de servidor' });
    });
  };
}

// ── Acceso a datos ───────────────────────────────────────────────────────────
async function findUserByEmail(email) {
  const { rows } = await pool.query('select * from users where email = $1', [email]);
  return rows[0] || null;
}
async function findUserById(id) {
  const { rows } = await pool.query('select * from users where id = $1', [id]);
  return rows[0] || null;
}
async function findUserByToken(token) {
  const { rows } = await pool.query(
    'select u.* from tokens t join users u on u.id = t.user_id where t.token = $1',
    [token]
  );
  return rows[0] || null;
}
async function insertUser(user) {
  await pool.query(
    'insert into users (id, name, email, salt, hash, is_admin, created_at) values ($1,$2,$3,$4,$5,$6,$7)',
    [user.id, user.name, user.email, user.salt, user.hash, user.isAdmin, user.createdAt]
  );
}
async function updateUserPassword(id, salt, hash) {
  await pool.query('update users set salt = $1, hash = $2 where id = $3', [salt, hash, id]);
}
async function listClients() {
  const { rows } = await pool.query('select * from users where is_admin = false order by created_at asc');
  return rows;
}
async function insertToken(token, userId) {
  await pool.query('insert into tokens (token, user_id) values ($1,$2)', [token, userId]);
}
async function deleteToken(token) {
  await pool.query('delete from tokens where token = $1', [token]);
}

async function getForm(userId) {
  const { rows } = await pool.query('select * from forms where user_id = $1', [userId]);
  if (rows[0]) return rows[0];
  await pool.query(
    'insert into forms (user_id, data, log, updated_at) values ($1, $2, $3, null) on conflict (user_id) do nothing',
    [userId, '{}', '[]']
  );
  return { user_id: userId, data: {}, log: [], updated_at: null };
}
async function saveFormData(userId, data, updatedAt) {
  await getForm(userId); // asegura que exista la fila
  await pool.query('update forms set data = $1, updated_at = $2 where user_id = $3', [
    JSON.stringify(data), updatedAt, userId,
  ]);
}
async function pushLog(userId, action, detail) {
  const form = await getForm(userId);
  const log = Array.isArray(form.log) ? form.log : [];
  log.push({ ts: new Date().toISOString(), action, detail: detail || '' });
  const trimmed = log.length > 500 ? log.slice(-500) : log;
  await pool.query('update forms set log = $1 where user_id = $2', [JSON.stringify(trimmed), userId]);
}

async function getStatus(userId) {
  const { rows } = await pool.query('select * from statuses where user_id = $1', [userId]);
  if (rows[0]) return { status: rows[0].status, note: rows[0].note, updatedAt: rows[0].updated_at };
  return { status: DEFAULT_STATUS, note: '', updatedAt: null };
}
async function setStatus(userId, status, note) {
  const updatedAt = new Date().toISOString();
  await pool.query(
    `insert into statuses (user_id, status, note, updated_at) values ($1,$2,$3,$4)
     on conflict (user_id) do update set status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
    [userId, status, note, updatedAt]
  );
  return { status, note, updatedAt };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function verifyPassword(password, salt, hash) {
  const test = crypto.scryptSync(password, salt, 64);
  const stored = Buffer.from(hash, 'hex');
  if (test.length !== stored.length) return false;
  return crypto.timingSafeEqual(test, stored);
}
function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, isAdmin: !!u.is_admin, createdAt: u.created_at };
}
function mapDoc(d) {
  return {
    id: d.id, category: d.category, originalName: d.original_name,
    mimetype: d.mimetype, size: Number(d.size), uploadedAt: d.uploaded_at,
  };
}

const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generateTempPassword() {
  const bytes = crypto.randomBytes(10);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += TEMP_PASSWORD_CHARS[bytes[i] % TEMP_PASSWORD_CHARS.length];
  return out;
}

function computeCompletion(data) {
  const total = SECTIONS.reduce((n, s) => n + s.fields.length, 0);
  let filled = 0;
  for (const s of SECTIONS) {
    for (const f of s.fields) {
      const v = (data || {})[`${s.id}.${f.id}`];
      if (v !== undefined && v !== null && String(v).trim() !== '') filled++;
    }
  }
  return { filled, total, pct: total ? Math.round((filled / total) * 100) : 0 };
}
async function completion(userId) {
  const form = await getForm(userId);
  return computeCompletion(form.data);
}

async function createAccount({ name, email, password, isAdmin, createdDetail }) {
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomBytes(12).toString('hex'),
    name: String(name).trim(),
    email,
    salt,
    hash: hashPassword(password, salt),
    isAdmin: !!isAdmin,
    createdAt: new Date().toISOString(),
  };
  await insertUser(user);
  await getForm(user.id);
  await pushLog(user.id, 'account_created', createdDetail || '');
  await setStatus(user.id, DEFAULT_STATUS, '');
  return findUserById(user.id);
}

async function auth(req, res, next) {
  try {
    const token = req.headers['x-auth-token'];
    const user = token ? await findUserByToken(token) : null;
    if (!user) return res.status(401).json({ error: 'No autorizado' });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error de servidor' });
  }
}
function requireAdmin(req, res, next) {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Solo administrador' });
  next();
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const ok = /^image\/|^application\/pdf$/.test(file.mimetype);
    cb(ok ? null : new Error('Tipo de archivo no permitido (solo imágenes o PDF)'), ok);
  },
});

const router = express.Router();

// ── Esquema (público, para renderizar el formulario) ───────────────────────
router.get('/schema', (req, res) => {
  res.json({ sections: SECTIONS, documentCategories: DOCUMENT_CATEGORIES, statusOptions: STATUS_OPTIONS });
});

// ── Registro / Login ────────────────────────────────────────────────────────
router.post('/register', wrap(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ error: 'Nombre, correo y contraseña (mínimo 6 caracteres) son obligatorios' });
  }
  const emailLc = String(email).trim().toLowerCase();
  if (emailLc !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'El registro está reservado al administrador. Pide al Ing. Rangel que te cree tu cuenta.' });
  }
  if (await findUserByEmail(emailLc)) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
  }
  const user = await createAccount({ name, email: emailLc, password, isAdmin: true });
  const token = crypto.randomBytes(24).toString('hex');
  await insertToken(token, user.id);
  res.json({ ok: true, token, user: publicUser(user) });
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body || {};
  const emailLc = String(email || '').trim().toLowerCase();
  const user = await findUserByEmail(emailLc);
  if (!user || !verifyPassword(password || '', user.salt, user.hash)) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  await insertToken(token, user.id);
  res.json({ ok: true, token, user: publicUser(user) });
}));

router.post('/logout', auth, wrap(async (req, res) => {
  await deleteToken(req.token);
  res.json({ ok: true });
}));

router.get('/me', auth, wrap(async (req, res) => {
  res.json({ user: publicUser(req.user), completion: await completion(req.user.id), status: await getStatus(req.user.id) });
}));

router.put('/password', auth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }
  if (!verifyPassword(currentPassword || '', req.user.salt, req.user.hash)) {
    return res.status(401).json({ error: 'La contraseña actual no es correcta' });
  }
  const salt = crypto.randomBytes(16).toString('hex');
  await updateUserPassword(req.user.id, salt, hashPassword(newPassword, salt));
  await pushLog(req.user.id, 'password_changed', '');
  res.json({ ok: true });
}));

// ── Formulario ───────────────────────────────────────────────────────────────
router.get('/form', auth, wrap(async (req, res) => {
  const f = await getForm(req.user.id);
  const log = Array.isArray(f.log) ? f.log : [];
  res.json({ data: f.data || {}, updatedAt: f.updated_at, log: log.slice(-100).reverse(), completion: computeCompletion(f.data) });
}));

router.get('/log', auth, wrap(async (req, res) => {
  const f = await getForm(req.user.id);
  const log = Array.isArray(f.log) ? f.log : [];
  res.json({ log: log.slice(-100).reverse() });
}));

router.post('/form', auth, wrap(async (req, res) => {
  const { data, sectionTitle } = req.body || {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return res.status(400).json({ error: 'Datos de formulario inválidos' });
  }
  const f = await getForm(req.user.id);
  const merged = Object.assign({}, f.data);
  let changed = 0;
  for (const [k, v] of Object.entries(data)) {
    if (typeof k !== 'string' || k.length > 120) continue;
    if (v !== null && typeof v !== 'string' && typeof v !== 'number') continue;
    merged[k] = v;
    changed++;
  }
  const updatedAt = new Date().toISOString();
  await saveFormData(req.user.id, merged, updatedAt);
  await pushLog(req.user.id, 'form_saved', sectionTitle ? `Sección: ${sectionTitle} (${changed} campos)` : `${changed} campos`);
  res.json({ ok: true, updatedAt, completion: computeCompletion(merged) });
}));

// ── Documentos ───────────────────────────────────────────────────────────────
router.get('/documents', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select id, category, original_name, mimetype, size, uploaded_at from documents where user_id = $1 order by uploaded_at asc',
    [req.user.id]
  );
  res.json({ documents: rows.map(mapDoc) });
}));

router.post('/documents', auth, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });
      const category = String(req.body.category || 'otro');
      const id = crypto.randomBytes(8).toString('hex');
      const uploadedAt = new Date().toISOString();
      await pool.query(
        `insert into documents (id, user_id, category, original_name, mimetype, size, content, uploaded_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, req.user.id, category, req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, uploadedAt]
      );
      const entry = { id, category, originalName: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, uploadedAt };
      await pushLog(req.user.id, 'document_uploaded', `${entry.originalName} (${category})`);
      res.json({ ok: true, document: entry });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: 'Error de servidor' });
    }
  });
});

router.get('/documents/:id/download', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from documents where id = $1 and user_id = $2',
    [req.params.id, req.user.id]
  );
  const entry = rows[0];
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  res.set('Content-Type', entry.mimetype);
  res.set('Content-Disposition', contentDisposition(entry.original_name));
  res.send(entry.content);
}));

router.delete('/documents/:id', auth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'delete from documents where id = $1 and user_id = $2 returning original_name',
    [req.params.id, req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  await pushLog(req.user.id, 'document_deleted', rows[0].original_name);
  res.json({ ok: true });
}));

// ── Administración (Ing. Rangel) ─────────────────────────────────────────────
router.post('/admin/users', auth, requireAdmin, wrap(async (req, res) => {
  const { name, email } = req.body || {};
  if (!name || !email) {
    return res.status(400).json({ error: 'Nombre y correo son obligatorios' });
  }
  const emailLc = String(email).trim().toLowerCase();
  if (await findUserByEmail(emailLc)) {
    return res.status(409).json({ error: 'Ya existe una cuenta con ese correo' });
  }
  const tempPassword = generateTempPassword();
  const user = await createAccount({
    name, email: emailLc, password: tempPassword, isAdmin: false,
    createdDetail: 'Cuenta creada por el administrador',
  });
  res.json({ ok: true, user: publicUser(user), tempPassword });
}));

router.get('/admin/users', auth, requireAdmin, wrap(async (req, res) => {
  const clients = await listClients();
  const list = [];
  for (const u of clients) {
    const form = await getForm(u.id);
    const { rows } = await pool.query('select count(*)::int as count from documents where user_id = $1', [u.id]);
    list.push({
      ...publicUser(u),
      completion: computeCompletion(form.data),
      documentCount: rows[0].count,
      formUpdatedAt: form.updated_at,
      status: await getStatus(u.id),
    });
  }
  res.json({ users: list });
}));

router.get('/admin/users/:id', auth, requireAdmin, wrap(async (req, res) => {
  const u = await findUserById(req.params.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  const f = await getForm(u.id);
  const { rows: docRows } = await pool.query(
    'select id, category, original_name, mimetype, size, uploaded_at from documents where user_id = $1 order by uploaded_at asc',
    [u.id]
  );
  const log = Array.isArray(f.log) ? f.log : [];
  res.json({
    user: publicUser(u),
    data: f.data || {},
    updatedAt: f.updated_at,
    log: log.slice(-200).reverse(),
    documents: docRows.map(mapDoc),
    completion: computeCompletion(f.data),
    status: await getStatus(u.id),
  });
}));

router.put('/admin/users/:id/status', auth, requireAdmin, wrap(async (req, res) => {
  const u = await findUserById(req.params.id);
  if (!u) return res.status(404).json({ error: 'No encontrado' });
  const { status, note } = req.body || {};
  const option = STATUS_OPTIONS.find((s) => s.value === status);
  if (!option) return res.status(400).json({ error: 'Estado inválido' });
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 500) : '';
  const saved = await setStatus(u.id, status, cleanNote);
  await pushLog(u.id, 'status_changed', option.label + (cleanNote ? ` — ${cleanNote}` : ''));
  res.json({ ok: true, status: saved });
}));

router.get('/admin/users/:id/documents/:docId/download', auth, requireAdmin, wrap(async (req, res) => {
  const { rows } = await pool.query(
    'select * from documents where id = $1 and user_id = $2',
    [req.params.docId, req.params.id]
  );
  const entry = rows[0];
  if (!entry) return res.status(404).json({ error: 'No encontrado' });
  res.set('Content-Type', entry.mimetype);
  res.set('Content-Disposition', contentDisposition(entry.original_name));
  res.send(entry.content);
}));

module.exports = router;

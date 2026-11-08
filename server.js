const express = require('express');
const path = require('path');
const { ensureSchema } = require('./db');
const visaRouter = require('./visa');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use('/api/visa', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, visaRouter);

// Enlace del cliente: /s/<token> — no se indexa ni se cachea.
app.get('/s/:token', (req, res) => {
  res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow, noarchive' });
  res.sendFile(path.join(PUBLIC, 'solicitud.html'));
});

app.use(express.static(PUBLIC));

ensureSchema()
  .catch((err) => console.error('No se pudo verificar el esquema de la base de datos:', err.message))
  .then(() => app.listen(PORT, () => console.log(`Visapp · puerto ${PORT}`)));

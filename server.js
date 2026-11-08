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

app.get('/sw.js', (req, res) => { res.set('Cache-Control', 'no-cache'); res.type('js').sendFile(path.join(PUBLIC, 'sw.js')); });
app.use(express.static(PUBLIC, { extensions: ['html'] }));

// Privacidad: borra respuestas y documentos 2 meses después de la última cita.
function runPurge() {
  visaRouter.purgeExpired()
    .then((n) => { if (n) console.log(`Depuración de privacidad: ${n} solicitud(es) cerradas`); })
    .catch((err) => console.error('Error en la depuración de privacidad:', err.message));
}

ensureSchema()
  .catch((err) => console.error('No se pudo verificar el esquema de la base de datos:', err.message))
  .then(() => {
    app.listen(PORT, () => console.log(`Visapp · puerto ${PORT}`));
    runPurge();
    setInterval(runPurge, 6 * 60 * 60 * 1000).unref();
  });

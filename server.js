const express = require('express');
const path = require('path');
const visaRouter = require('./visa');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use('/api/visa', visaRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => console.log(`Trámite de Visas Rangel · puerto ${PORT}`));

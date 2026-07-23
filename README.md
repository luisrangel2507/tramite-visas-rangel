# Trámite de Visas Rangel

App de gestión de trámite de visas — Ing. Luis Eduardo Rangel Llanes.

Node/Express, sin base de datos externa: los usuarios, el formulario y los
documentos subidos se guardan como archivos en `data/`.

## Desarrollo local

```bash
npm install
npm start
```

La app queda en `http://localhost:3000` (o el puerto de `PORT`).

## Desplegar en Railway

1. En el [dashboard de Railway](https://railway.app/dashboard), **New Project
   → Deploy from GitHub repo** y elige este repositorio.
2. Railway detecta el proyecto Node automáticamente (Nixpacks) y usa
   `npm start` como comando de arranque — no hace falta configurar nada más
   para que arranque.
3. **Importante — almacenamiento persistente:** el sistema de archivos de
   Railway se reinicia en cada despliegue. Sin un Volume, se perderían las
   cuentas registradas, el formulario guardado y los documentos subidos cada
   vez que se vuelva a desplegar. Para evitarlo:
   - En el servicio, ve a **Settings → Volumes → New Volume**.
   - Mount path: `/app/data`
   - Con eso, la carpeta `data/` (usuarios, tokens, formulario, documentos)
     queda persistente entre despliegues.
4. Variables de entorno (**Settings → Variables**), opcionales:
   - `VISA_ADMIN_EMAIL` — correo con acceso de administrador (por defecto
     `luisrangel2507@gmail.com`).
   - `PORT` la define Railway automáticamente, no hace falta configurarla.
5. Una vez desplegado, Railway asigna un dominio público en
   **Settings → Networking → Generate Domain** (o se puede conectar un
   dominio propio ahí mismo).

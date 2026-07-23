# Trámite de Visas Rangel

App de gestión de trámite de visas — Ing. Luis Eduardo Rangel Llanes.

Node/Express. Los usuarios, el formulario, los documentos subidos y el
estado del trámite se guardan en una base de datos Postgres (por ejemplo
Supabase), no en el disco del servidor — así los datos no se pierden en
cada despliegue.

## Desarrollo local

Necesitas una base de datos Postgres accesible (local o remota) y correr
`schema.sql` una vez para crear las tablas:

```bash
npm install
psql "$DATABASE_URL" -f schema.sql
DATABASE_URL="postgresql://usuario:password@host:5432/basededatos" npm start
```

La app queda en `http://localhost:3000` (o el puerto de `PORT`).

## Desplegar en Railway

1. **Base de datos (Supabase):**
   - Crea una cuenta gratis en [supabase.com](https://supabase.com) y un
     nuevo proyecto.
   - En el panel del proyecto, abre el **SQL Editor**, pega el contenido de
     `schema.sql` de este repositorio y ejecútalo (una sola vez). Esto crea
     las tablas necesarias.
   - En **Project Settings → Database → Connection string**, copia la
     cadena de conexión (usa la de "Connection Pooling" / modo *Transaction*
     si está disponible — es la más compatible con Railway), reemplaza
     `[YOUR-PASSWORD]` por la contraseña de tu proyecto.
2. En el [dashboard de Railway](https://railway.app/dashboard), **New Project
   → Deploy from GitHub repo** y elige este repositorio. Railway detecta el
   proyecto Node automáticamente (Nixpacks) y usa `npm start`.
3. Variables de entorno del servicio (**Settings → Variables**):
   - `DATABASE_URL` — la cadena de conexión de Supabase del paso 1
     (obligatoria).
   - `VISA_ADMIN_EMAIL` — correo con acceso de administrador (por defecto
     `luisrangel2507@gmail.com`).
   - `PORT` la define Railway automáticamente, no hace falta configurarla.
4. Una vez desplegado, entra a la app y usa el enlace **"Configurar cuenta
   de administrador"** en la pantalla de login (con el correo de
   `VISA_ADMIN_EMAIL`) para crear tu cuenta. De ahí en adelante, tú creas
   las cuentas de los clientes desde el panel de administrador.
5. Railway asigna un dominio público en **Settings → Networking → Generate
   Domain** (o se puede conectar un dominio propio ahí mismo).

Como los datos viven en Supabase y no en el disco de Railway, los
redespliegues (cada `git push`) ya no borran cuentas, formularios ni
documentos.

# Trámite de Visas Rangel

App para el servicio de trámite de citas de visa del Ing. Luis Eduardo Rangel Llanes.

**Cómo funciona**

1. Entras al panel (`/`) con tu correo y contraseña.
2. Creas una **solicitud** con el nombre del cliente → la app genera un **enlace secreto** (`/s/…`).
3. Copias el enlace o lo mandas directo por WhatsApp.
4. El cliente lo abre desde su celular (sin cuenta ni contraseña) y llena todo el
   formulario DS-160, paso a paso. Se **guarda solo** mientras escribe y puede
   continuar después con el mismo enlace. Al final acepta la declaración y envía.
5. Tú ves las respuestas en el panel: tocas cualquier dato para **copiarlo**,
   copias todo como texto, o lo imprimes / guardas en PDF. También ves los
   documentos que subió, el avance (%) y puedes ir cambiando el estado del trámite.

El formulario cubre todas las secciones de la solicitud en línea DS-160: datos
personales, domicilio/teléfonos/correo/redes sociales, pasaporte, viaje a EE. UU.,
contacto en EE. UU., familia, trabajo y estudios, información adicional y las
27 preguntas de seguridad y antecedentes. Las preguntas se muestran u ocultan según
las respuestas (por ejemplo, datos del cónyuge solo si está casado(a)), y las listas
(otros teléfonos, empleos anteriores, etc.) se pueden repetir las veces necesarias.

> No se piden los datos del *preparador* (tú) ni la ciudad donde se presenta la
> solicitud: son los mismos para todos tus clientes y los capturas tú en el portal.

**Seguridad:** el enlace es la llave de acceso (128 bits aleatorios); no aparece en
buscadores. Si un enlace se comparte por error, en el detalle de la solicitud usa
**“Generar enlace nuevo”** y el anterior deja de funcionar.

## Desarrollo local

Necesitas una base de datos Postgres accesible. Las tablas se crean solas al
arrancar (`schema.sql` es idempotente).

```bash
npm install
DATABASE_URL="postgresql://usuario:password@host:5432/basededatos" npm start
npm test        # pruebas de la lógica del formulario
```

La app queda en `http://localhost:3000` (o el puerto de `PORT`).

## Desplegar en Railway

1. **Base de datos (Supabase):** crea un proyecto en [supabase.com](https://supabase.com)
   y, en **Project Settings → Database → Connection string**, copia la cadena de
   conexión (la de *Connection Pooling* / modo *Transaction* es la más compatible con
   Railway) reemplazando `[YOUR-PASSWORD]`. No hace falta correr SQL a mano.
2. En el [dashboard de Railway](https://railway.app/dashboard): **New Project →
   Deploy from GitHub repo** y elige este repositorio (usa `npm start`).
3. Variables de entorno del servicio:
   - `DATABASE_URL` — la cadena de conexión del paso 1 (obligatoria).
   - `VISA_ADMIN_EMAIL` — correo del administrador (por defecto `luisrangel2507@gmail.com`).
   - `PORT` lo define Railway.
4. Ya desplegado, entra a la app y usa **“Configurar cuenta de administrador”** (con el
   correo de `VISA_ADMIN_EMAIL`) para crear tu contraseña.
5. En **Settings → Networking → Generate Domain** Railway te da el dominio público
   (o conecta uno propio). Los enlaces que mandes usarán ese dominio.

Los datos viven en Postgres, no en el disco de Railway: los redespliegues no borran nada.

### Si ya usabas la versión anterior

Las cuentas de cliente con contraseña y su formulario antiguo ya no se usan (los
clientes ahora entran por enlace), pero **sus datos siguen en la base de datos**
(tablas `users`, `forms`, `documents`, `statuses`); tu cuenta de administrador sigue
funcionando igual. Los clientes anteriores no aparecen en el panel nuevo: créales una
solicitud nueva con su enlace.

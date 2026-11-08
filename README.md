# Visapp

**Visapp** — app para el servicio de trámite de citas de visa del Ing. Luis Eduardo Rangel Llanes.

| Dirección | Qué es |
|---|---|
| `/` | Página pública (servicios, cómo funciona, preguntas frecuentes, botón de WhatsApp) |
| `/panel` | Panel del asesor (instalable como app en el celular) |
| `/entrar` | Acceso de clientes con **usuario y contraseña** |
| `/s/<enlace>` | Formulario DS-160 del cliente (el enlace personal también pide la contraseña) |
| `/privacidad` | Aviso de Privacidad |

## Cómo funciona

1. Entras a `/panel` y creas una **solicitud** con el nombre del cliente. La app genera su **usuario** (p. ej. `maria.lopez48`) y una **contraseña**, y te arma el mensaje de WhatsApp con enlace, usuario y contraseña. La contraseña solo se muestra al crearla; si se pierde, la restableces (eso cierra la sesión anterior del cliente).
2. El cliente entra en `/entrar` (o abriendo su enlace) con su usuario y contraseña, acepta el aviso de privacidad y llena el formulario DS-160 completo, de 5 en 5 preguntas.
   Se guarda solo, avisa si un dato parece mal (pasaporte vencido, teléfono incompleto…) y trae
   ayuda “¿Dónde lo encuentro?” y un botón de WhatsApp para dudas.
3. Cuando envía, te aparece un aviso en el panel (y por correo si lo configuras).
4. Tú capturas en el portal oficial con la **Hoja de captura**: tocas cada dato para copiarlo y marcas
   cada sección como capturada.

### En el panel

- **Solicitudes:** lista o **tablero por estados** (arrastra o usa “Mover a…”), búsqueda, filtro y la
  tarjeta **Hoy** con formularios nuevos, recordatorios vencidos y próximas citas.
- **Cita:** fechas del CAS y de la entrevista, consulado, n.º de confirmación del DS-160, pago de MRV.
  *Las capturas tú.*
- **Recordatorios:** los marcas tú, con fecha; aparecen en “Hoy” cuando llega el día.
- **Cobros:** precio, pagos recibidos y saldo por cliente.
- **Familia / grupo de viaje:** agrega a otra persona del mismo viaje; se copian domicilio, viaje,
  contacto en EE. UU. (y opcionalmente datos de los padres).
- **Clientes:** quién debe y cuánto. **Reportes:** solicitudes por mes, ingresos, embudo por estado.
- **Configuración:** tu WhatsApp, correo para avisos, contraseña e instalación de la app.

## Acceso de clientes

- Usuario y contraseña por solicitud; las contraseñas se guardan cifradas (scrypt), nunca en texto.
- Tras 8 intentos fallidos se bloquea el acceso 15 minutos. La sesión dura 30 días en el celular del cliente.
- Las solicitudes creadas con la versión anterior (solo enlace) no tienen contraseña: abre la solicitud en el panel y pulsa **Restablecer contraseña** para generarla.

## Privacidad: borrado automático

**2 meses después de la última cita** (CAS o entrevista, la más tardía) el servidor elimina
automáticamente las respuestas y documentos de esa solicitud. Se conservan el nombre, el estado y
los cobros. El enlace deja de funcionar. Se revisa al arrancar y cada 6 horas. Si no capturas una
fecha de cita, los datos **no** se borran solos.

> El texto de `/privacidad` es un modelo general: revísalo con un asesor legal y agrega tu domicilio
> completo y un correo de contacto antes de usarlo con clientes reales.

## Desarrollo local

Necesitas Postgres. Las tablas se crean/actualizan solas al arrancar.

```bash
npm install
DATABASE_URL="postgresql://usuario:password@host:5432/basededatos" npm start
npm test                                  # lógica del formulario y de operación
TEST_DATABASE_URL="postgresql://…/prueba" npm run test:api   # prueba de la API (usa una base vacía de pruebas)
```

## Desplegar en Railway

1. **Base de datos (Supabase):** copia la cadena de conexión (*Connection Pooling*, modo *Transaction*)
   en **Project Settings → Database**. No hace falta correr SQL.
2. En Railway: **New Project → Deploy from GitHub repo** y elige este repositorio.
3. Variables del servicio:
   - `DATABASE_URL` — obligatoria.
   - `VISA_ADMIN_EMAIL` — correo del administrador (por defecto `luisrangel2507@gmail.com`; Gmail con o sin puntos cuenta igual).
   - `SMTP_URL` — *opcional*, para avisos por correo. Ej. `smtps://usuario:contraseña-de-aplicación@smtp.gmail.com`.
     `SMTP_FROM` — *opcional*, remitente.
4. Entra a `/panel` y usa “Configurar cuenta de administrador” la primera vez.
5. En **Settings → Networking → Generate Domain** obtienes la dirección pública.
6. En `/panel` → **Configuración** captura tu WhatsApp (activa los botones de contacto) y el correo de avisos.

### Notas

- **App instalable:** abre `/panel` en el celular → “Instalar app” (Android/Chrome) o Compartir → “Agregar a pantalla de inicio” (iPhone).
- **Código postal → estado/ciudad:** el formulario consulta un servicio público externo (zippopotam.us). Si no responde, el cliente simplemente captura los datos a mano.
- **Versión anterior:** las cuentas de cliente con contraseña ya no se usan; sus datos siguen en la base de datos (`users`, `forms`, `documents`, `statuses`) pero no aparecen en el panel nuevo.

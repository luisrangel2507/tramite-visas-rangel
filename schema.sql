-- Esquema de base de datos para Trámite de Visas Rangel.
-- La app lo ejecuta automáticamente al arrancar (todo es idempotente),
-- así que no hace falta correrlo a mano; también puede pegarse en el
-- editor SQL de Supabase.

-- Cuenta del administrador (y sesiones del panel).
create table if not exists users (
  id text primary key,
  name text not null,
  email text not null unique,
  salt text not null,
  hash text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists tokens (
  token text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Solicitudes: una por cliente. El cliente entra con un enlace secreto
-- (columna token), sin cuenta ni contraseña.
create table if not exists applications (
  id text primary key,
  token text not null unique,
  client_name text not null,
  client_note text not null default '',
  data jsonb not null default '{}'::jsonb,
  log jsonb not null default '[]'::jsonb,
  status text not null default 'enlace_enviado',
  status_note text not null default '',
  status_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  submitted_at timestamptz,
  last_opened_at timestamptz
);

create table if not exists application_documents (
  id text primary key,
  application_id text not null references applications(id) on delete cascade,
  category text not null,
  original_name text not null,
  mimetype text not null,
  size bigint not null,
  content bytea not null,
  uploaded_at timestamptz not null default now()
);
create index if not exists application_documents_app_idx on application_documents(application_id);

-- Tablas de la versión anterior (cuentas de cliente con contraseña).
-- Ya no se usan; se conservan para no perder datos existentes.
create table if not exists forms (
  user_id text primary key references users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  log jsonb not null default '[]'::jsonb,
  updated_at timestamptz
);
create table if not exists documents (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  category text not null,
  original_name text not null,
  mimetype text not null,
  size bigint not null,
  content bytea not null,
  uploaded_at timestamptz not null default now()
);
create table if not exists statuses (
  user_id text primary key references users(id) on delete cascade,
  status text not null,
  note text not null default '',
  updated_at timestamptz
);

alter table users enable row level security;
alter table tokens enable row level security;
alter table applications enable row level security;
alter table application_documents enable row level security;
alter table forms enable row level security;
alter table documents enable row level security;
alter table statuses enable row level security;
-- Sin políticas: solo la clave de servicio (usada por el backend) puede
-- leer o escribir estas tablas; el navegador nunca tiene acceso directo.

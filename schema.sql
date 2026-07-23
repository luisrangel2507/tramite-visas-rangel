-- Esquema de base de datos para Trámite de Visas Rangel.
-- Ejecutar una sola vez en el editor SQL de Supabase (o cualquier Postgres)
-- antes de conectar la app.

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
alter table forms enable row level security;
alter table documents enable row level security;
alter table statuses enable row level security;
-- Sin políticas: solo la clave de servicio (usada por el backend) puede
-- leer o escribir estas tablas; el navegador nunca tiene acceso directo.

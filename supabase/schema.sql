-- Sincronización de Panel: una sola fila por usuario con el estado YA CIFRADO en el dispositivo
-- (AES-256-GCM, ver src/backup.js). El servidor nunca ve datos en claro.
-- Pégalo en Supabase → SQL Editor → Run.

create table if not exists public.panel_sync (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  rev        integer not null default 1,        -- control de concurrencia: cada subida exige la rev anterior
  data       text not null,                     -- JSON de la copia cifrada (formato panel-backup)
  updated_at timestamptz not null default now()
);

alter table public.panel_sync enable row level security;

-- Permisos de tabla para usuarios con sesión (las políticas RLS de abajo limitan a cada uno a su fila).
-- Sin esto: "permission denied for table panel_sync". Nunca se concede a `anon`.
grant select, insert, update, delete on public.panel_sync to authenticated;

drop policy if exists "panel_sync: leer lo propio" on public.panel_sync;
create policy "panel_sync: leer lo propio"    on public.panel_sync for select using ((select auth.uid()) = user_id);
drop policy if exists "panel_sync: crear lo propio" on public.panel_sync;
create policy "panel_sync: crear lo propio"   on public.panel_sync for insert with check ((select auth.uid()) = user_id);
drop policy if exists "panel_sync: editar lo propio" on public.panel_sync;
create policy "panel_sync: editar lo propio"  on public.panel_sync for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "panel_sync: borrar lo propio" on public.panel_sync;
create policy "panel_sync: borrar lo propio"  on public.panel_sync for delete using ((select auth.uid()) = user_id);

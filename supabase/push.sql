-- Avisos push de Panel (ejecuta DESPUÉS de schema.sql). Supabase → SQL Editor → Run.
-- Antes de ejecutarlo, sustituye PROJECT_REF y ANON_KEY en el bloque del cron (al final).

-- Una fila por usuario: suscripciones push de sus dispositivos y la lista de próximos avisos.
-- Los avisos van SIN cifrar (solo cifras, sin nombres de hábitos): el servidor necesita leerlos para enviarlos.
create table if not exists public.panel_push (
  user_id       uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  subscriptions jsonb not null default '[]',
  reminders     jsonb not null default '[]',
  updated_at    timestamptz not null default now()
);
alter table public.panel_push enable row level security;
drop policy if exists "panel_push: leer lo propio" on public.panel_push;
create policy "panel_push: leer lo propio"   on public.panel_push for select using ((select auth.uid()) = user_id);
drop policy if exists "panel_push: crear lo propio" on public.panel_push;
create policy "panel_push: crear lo propio"  on public.panel_push for insert with check ((select auth.uid()) = user_id);
drop policy if exists "panel_push: editar lo propio" on public.panel_push;
create policy "panel_push: editar lo propio" on public.panel_push for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "panel_push: borrar lo propio" on public.panel_push;
create policy "panel_push: borrar lo propio" on public.panel_push for delete using ((select auth.uid()) = user_id);

-- Claves VAPID: las genera la función la primera vez. Sin políticas = solo accesible con la service role.
create table if not exists public.push_keys (
  id          integer primary key default 1 check (id = 1),
  public_key  text not null,
  private_key text not null
);
alter table public.push_keys enable row level security;

-- Cron: llama a la función cada minuto. La función solo envía lo que ya toca, así que la clave anon basta.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.schedule('panel-reminders', '* * * * *', $$
  select net.http_post(
    url     := 'https://PROJECT_REF.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer ANON_KEY', 'Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
$$);

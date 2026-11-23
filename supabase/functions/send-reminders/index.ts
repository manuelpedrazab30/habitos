// Edge Function de Panel: envía por Web Push los avisos de panel_push que ya tocan.
// La llama un cron de Supabase cada minuto (supabase/push.sql). Despliegue: ver CLAUDE.md.
//   GET ?action=key  → { publicKey }  (clave VAPID pública, para que el navegador se suscriba)
//   cualquier otra   → envía los avisos vencidos y devuelve { sent }
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const STALE_MS = 6 * 60 * 60 * 1000; // un aviso que lleva más de 6 h vencido ya no sirve: se descarta
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function vapidKeys() {
  const { data } = await db.from('push_keys').select('public_key, private_key').eq('id', 1).maybeSingle();
  if (data) return { publicKey: data.public_key as string, privateKey: data.private_key as string };
  const k = webpush.generateVAPIDKeys();
  await db.from('push_keys').upsert({ id: 1, public_key: k.publicKey, private_key: k.privateKey });
  return k;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const keys = await vapidKeys();
    if (new URL(req.url).searchParams.get('action') === 'key') return json({ publicKey: keys.publicKey });

    webpush.setVapidDetails('https://manuelpedrazab30.github.io/habitos/', keys.publicKey, keys.privateKey);
    const now = Date.now();
    const { data: rows, error } = await db.from('panel_push').select('user_id, subscriptions, reminders, updated_at');
    if (error) throw error;

    let sent = 0;
    for (const row of rows ?? []) {
      const reminders: any[] = row.reminders ?? [];
      const due = reminders.filter((r) => Date.parse(r.at) <= now);
      if (!due.length) continue;
      // Reclamar antes de enviar: si la app subió una lista nueva entretanto, no coincide updated_at
      // y se deja para el minuto siguiente (así nunca se envía dos veces el mismo aviso).
      const { data: claimed } = await db.from('panel_push')
        .update({ reminders: reminders.filter((r) => Date.parse(r.at) > now), updated_at: new Date().toISOString() })
        .eq('user_id', row.user_id).eq('updated_at', row.updated_at).select('user_id');
      if (!claimed?.length) continue;

      const dead = new Set<string>();
      for (const r of due.filter((x) => Date.parse(x.at) > now - STALE_MS)) {
        for (const sub of row.subscriptions ?? []) {
          try {
            await webpush.sendNotification(sub, JSON.stringify({ title: r.title, body: r.body, url: r.url, tag: r.id }));
            sent++;
          } catch (e) {
            if (e?.statusCode === 404 || e?.statusCode === 410) dead.add(sub.endpoint);
          }
        }
      }
      if (dead.size) {
        await db.from('panel_push').update({ subscriptions: (row.subscriptions ?? []).filter((s: any) => !dead.has(s.endpoint)) })
          .eq('user_id', row.user_id);
      }
    }
    return json({ sent });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});

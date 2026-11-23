// Lógica pura de la sincronización (sin red ni DOM). La parte con efectos vive en src/sync.js.
//
// Modelo: en el servidor hay UNA fila por usuario { rev, data } (data = copia cifrada). Cada
// dispositivo recuerda la `baseRev` que bajó/subió por última vez y si tiene cambios sin subir
// (`dirty`). Subir exige que la rev del servidor siga siendo baseRev (concurrencia optimista).

/** ¿Hay algo que merezca subirse? (un dispositivo recién instalado no debe pisar la nube) */
export function hasData(state) {
  const st = state?.study;
  return (state?.habits?.length ?? 0) > 0
    || (state?.finance?.transactions?.length ?? 0) > 0
    || Boolean(st && (st.tasks.length || st.exams.length || st.readings.length || st.sessions.length));
}

/** Cifras para que el usuario compare dos versiones al resolver un conflicto. */
export function summarize(state) {
  const st = state?.study ?? {};
  return {
    habits: state?.habits?.length ?? 0,
    movements: state?.finance?.transactions?.length ?? 0,
    tasks: (st.tasks?.length ?? 0) + (st.exams?.length ?? 0) + (st.readings?.length ?? 0),
  };
}

export function summaryText(s) {
  return `${s.habits} hábitos, ${s.movements} movimientos, ${s.tasks} tareas/exámenes/lecturas`;
}

/**
 * Qué hacer en una sincronización → 'noop' | 'push' | 'pull' | 'conflict'.
 *  remoteRev: rev de la fila del servidor (null = no hay fila)
 *  baseRev:   rev que este dispositivo vio por última vez (null = nunca ha sincronizado)
 *  dirty:     cambios locales sin subir
 *  localEmpty: este dispositivo no tiene datos
 */
export function decideSync({ remoteRev, baseRev, dirty, localEmpty }) {
  if (remoteRev == null) return localEmpty ? 'noop' : 'push';
  if (baseRev == null) return localEmpty ? 'pull' : 'conflict';
  if (remoteRev === baseRev) return dirty ? 'push' : 'noop';
  if (remoteRev > baseRev) return dirty ? 'conflict' : 'pull';
  return 'conflict'; // la fila del servidor es "anterior" a lo que vimos: se recreó
}

/** https://xxxx.supabase.co/ → https://xxxx.supabase.co (o null si no es una URL https válida). */
export function normalizeUrl(input) {
  try {
    const u = new URL(String(input).trim());
    if (u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Mensaje legible de una respuesta de error de Supabase (auth o REST). */
export function errorMessage(body, status) {
  const raw = body?.msg || body?.message || body?.error_description || body?.error || '';
  if (/invalid login credentials/i.test(raw)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(raw)) return 'Confirma tu correo (te llegó un enlace) y vuelve a entrar.';
  if (/already registered|already been registered/i.test(raw)) return 'Ese correo ya tiene cuenta: usa “Entrar”.';
  if (/relation .*panel_sync.* does not exist|panel_sync/i.test(raw) && status === 404) return 'Falta la tabla panel_sync: ejecuta supabase/schema.sql en Supabase.';
  if (status === 404) return 'Falta la tabla panel_sync: ejecuta supabase/schema.sql en Supabase.';
  if (/invalid api key|no api key/i.test(raw)) return 'La clave pública (anon) no es correcta.';
  return raw || `Error ${status}`;
}

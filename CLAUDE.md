# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

Panel personal tipo "cerebro digital" (UI en español) con cuatro secciones: **Inicio** (resumen de todo), **Hábitos** (el seguimiento de hábitos original), **Finanzas** y **Correo**. Se cambia de sección con el selector de la barra superior; cada sección tiene su propia barra de navegación inferior. Objetivos de producto que guían las decisiones:
- **Mínima fricción**: registrar un hábito es un toque desde la vista "Hoy"; registrar un gasto es importe → categoría → Guardar. Sin cuentas ni backend.
- **Gamificación basada en datos**: rachas, XP/niveles y mensajes de motivación que siempre dicen una distancia concreta ("te faltan 2,4 kg; a tu ritmo llegas el 25 dic, 31 días antes del plazo"). Nada de frases genéricas o cliché.
- **Visualización para detectar áreas de mejora**: mapas de calor, cumplimiento por día de la semana, hábitos que más han caído, proyección hacia la meta.

## Comandos

No hay build, ni npm, ni dependencias: es JavaScript con módulos ES nativos. Node **no** está instalado en esta máquina.

```bash
python3 serve.py        # servir la app → http://localhost:5173 (puerto opcional como argumento)
```
(También está en `.claude/launch.json` como `habitos` para el panel de preview.) Los módulos ES necesitan HTTP; abrir `index.html` con `file://` no funciona. `serve.py` es `http.server` con `Cache-Control: no-store`: con `python3 -m http.server` el navegador reutiliza módulos antiguos tras editar y aparecen errores como "does not provide an export named …".

**Iconos**: `python3 tools/make_icons.py` regenera `icons/icon-{180,192,512}.png` (dibujados por código, sin dependencias). Edita el diseño en ese script, no los PNG.

**Probar en un iPhone**: `serve.py` escucha en todas las interfaces e imprime la URL de la red local; ábrela en Safari con el móvil en la misma wifi. Por HTTP en la red local no hay service worker (requiere HTTPS), así que la app instalada solo carga mientras el Mac sirve. La versión real está publicada en GitHub Pages.

**Despliegue**: GitHub Pages sirve la rama `main` tal cual (raíz del repo, con `.nojekyll`) en https://manuelpedrazab30.github.io/habitos/ (repo `manuelpedrazab30/habitos`). Hacer push a `main` publica en 1–2 minutos. Todas las rutas son relativas (la app vive bajo `/habitos/`): no uses rutas absolutas que empiecen por `/`. Tras cambiar archivos de `src/`, sube `CACHE` en `sw.js` si cambia la lista `SHELL`.

**Tests**: abrir `http://localhost:5173/tests/index.html` en el navegador. Runner propio en `tests/runner.js` (`test`, `eq`, `ok`, `near`).
- Un solo test o grupo: `tests/index.html?grep=streaks` (filtra por subcadena del nombre).
- Para automatizar: el resultado queda en `window.__testResults` (`{ passed, failed: [{name, error}] }`) y en `document.title`.
- Un archivo de test nuevo hay que importarlo en `tests/index.html`.
- Los tests usan una fecha fija (`T = '2026-11-11'`, miércoles), nunca la fecha real.

## Arquitectura

```
src/domain/   lógica pura, sin DOM (todo lo testeable vive aquí)
src/store.js  estado único + persistencia en localStorage
src/ui/       vistas: funciones (state, ctx) → elemento DOM
src/app.js    arranque, router por hash, feedback de gamificación (toasts de XP/récord/nivel)
src/ui/finance/  sección de finanzas: overview (resumen + alta inicial), transactions, accounts, entrySheet
src/ui/home.js   Inicio: lo más importante de los tres módulos + una tarjeta por módulo
src/inbox/       Correo: gmail.js (OAuth + API), ai.js (resumen con Claude), state.js (config/caché/refresh)
src/ui/inbox/    vistas del correo: overview (resumen), list (bandeja), connect (conexión)
vendor/          SDK oficial de Anthropic (bundle ESM 1.8.0, Apache-2.0), cargado solo para el resumen con IA
src/demo.js   datos de ejemplo: demoState (hábitos) y demoFinance (finanzas), cada uno sin tocar la otra sección
sw.js, manifest.webmanifest, icons/   PWA instalable (pantalla de inicio de iPhone/Android)
```

### PWA y móvil
- `index.html` lleva las meta de iOS (`apple-touch-icon`, `apple-mobile-web-app-*`, barra de estado `black-translucent`); `.topbar` y `.nav` reservan `env(safe-area-inset-*)`.
- `sw.js` es "red primero" con copia en caché para uso sin conexión. Solo se registra en HTTPS fuera de localhost (`app.js`), para no servir código viejo en desarrollo. **Si añades un archivo a `src/`, añádelo a `SHELL` en `sw.js`** y sube `CACHE` cuando cambie la lista.
- La app instalada en iOS tiene su propio localStorage, separado del de Safari (por eso Ajustes explica cómo exportar e importar).
- Gráficas: el ancho del viewBox es el ancho real disponible (`chartWidth()` en `charts.js`), para que el texto no encoja en el móvil; `app.js` vuelve a renderizar al cambiar el ancho. Los tooltips responden a `touchstart` y se cierran al desplazar.
- Campos de texto a 16 px como mínimo (si no, iOS hace zoom al enfocar); botones táctiles de ≥ 44 px en `@media (max-width: 600px)`.

### Modelo de datos (`store.js`, `domain/habits.js`)
- `state = { version, habits: Habit[], entries: { [habitId]: { 'YYYY-MM-DD': number } }, workouts, settings }`. Un valor por hábito y día; `setEntry(id, key, null)` borra (y borra también la sesión de entrenamiento de ese día).
- Tres `kind` de hábito: `check` (valor 1), `count` (cantidad con `dailyGoal`), `target` (medición que va hacia `goal.value` desde `goal.start`; la dirección subir/bajar se infiere).
- Tres `schedule`: `daily`, `days` (días concretos, 0 = lunes) y `weekly` (N veces por semana, cualquier día). Casi toda la lógica de rachas/estadísticas se bifurca entre "semanal" y "diario/días concretos".
- Un registro = un día, en todos los tipos. En un hábito "3 veces por semana" cada registro es un día concreto de esa semana (la tarjeta de Hoy muestra la tira L–D con los días hechos); la semana se cumple con N días distintos.
- `goal` opcional con `deadline`, distinto según el tipo:
  - `check`: meta de **duración**, no de número de veces: `{ from, deadline }` ("3 veces/semana durante 12 semanas"). El formulario acepta semanas o fecha de fin (y las plantillas `goal.weeks`); se guarda solo `from` + `deadline`.
  - `count`: `{ total, deadline }` (cantidad acumulada).
  - `target`: `{ start, value, deadline }`.
- `createHabit()` es el normalizador único: lo usan el formulario, `updateHabit`, la importación y `migrate()`. Si añades un campo, añádelo ahí.
- Cambios de esquema: subir `VERSION` y añadir un paso en `migrate()` en `store.js`. v5 añadió `state.finance`. v2 eliminó `goal.total` de los hábitos `check`; v3 añadió la rutina y `state.workouts`; v4 dividió la rutina en `habit.sessions` (la lista única de v3 se copia a cada sesión) y cada registro pasó a `{ sessionId, items }`.

### Entrenamiento y sobrecarga progresiva (`domain/workouts.js`)
- Un hábito `check` puede tener una rutina dividida en **sesiones**: `sessions: [{ id, name, exercises: [{ id, name, sets, reps, weight }] }]` (`reps` = objetivo por serie; `[]` = sin rutina). Hay exactamente `sessionCount(schedule)` plantillas, una por entrenamiento de la semana: N por semana → N ("Día A, B, C…", en rotación); días concretos → una por día; diario → 7. `normalizeSessions` (vía `createHabit`) rellena o recorta al cambiar el calendario y pone nombres por defecto; el formulario hace lo mismo en vivo con `fitSessions()` sin borrar filas a medio escribir.
- Qué plantilla toca un día (`sessionFor`): la ya registrada ese día; si no, la de ese día de la semana (días concretos/diario); si no, la siguiente a la última hecha (rotación). La hoja permite cambiarla.
- Sesiones registradas: `state.workouts[habitId][día] = { sessionId, items: [{ exerciseId, name, sets, reps, weight }] }`, una por día; `store.setWorkout(id, día, items, sessionId)` guarda la sesión **y** marca el día (`entries = 1`). `weight: null` = peso corporal, fuera de las estadísticas de peso. Usa `entryItems()` para leer los ejercicios de un registro.
- Identidad de ejercicio: id **o** nombre normalizado (`normName`). La misma "Sentadilla" en dos sesiones comparte historial, récords y sugerencias; `allExercises(habit)` da la lista única.
- La estadística clave es el peso por ejercicio (`exerciseStats`): cambio desde el inicio y en 4 semanas, récord, sesiones seguidas con el mismo peso (`STALL_SESSIONS` = 4 → estancado) y sugerencia de doble progresión: si en la última sesión llegaste a las reps del plan, toca subir `WEIGHT_STEP` (2,5 kg).
- En hábitos con rutina (`hasRoutine`), marcar el día (Hoy, tira semanal o historial) abre `ui/workoutSheet.js` en lugar de alternar. Cada ejercicio se precarga con lo registrado ese día, si no con la última vez que se hizo (en cualquier sesión), si no con el plan (`prefillSession`); repetir es un toque.
- XP: +`PR_XP` por cada récord de peso (`prCount`, sin contar la primera sesión de cada ejercicio). `ctx.logWorkout()` anuncia los récords nuevos.
- `overloadMessages` genera los mensajes: qué ejercicios subir y a cuántos kg, estancamientos, récords recientes y la mayor subida en 4 semanas.

### Finanzas (`domain/finance.js`, `ui/finance/`)
- `state.finance = { currency, since, accounts, categories, paydays, fixedCosts, transactions }` (ver la cabecera de `finance.js`). **Importes siempre en céntimos enteros**; `parseAmount` entiende "12,50", "12.5", "1.234,56"; `formatMoney` formatea con `Intl`.
- Todo cambio de finanzas es una función pura (`saveTransaction`, `deleteTransaction`, `saveAccount`, `saveCategory`, `savePaydays`, `saveFixedCost`…) que devuelve un `finance` nuevo; la UI lo guarda con `ctx.saveFinance(next, mensaje)` (→ `store.setFinance`, con "Deshacer"). No mutes `state.finance`.
- Tipos de movimiento: `expense` (con `categoryId`), `income` y `transfer` (`toAccountId`). Los saldos se derivan (`accountBalances` = saldo inicial ± movimientos); las transferencias no cuentan como gasto ni ingreso. Cuentas y categorías con movimientos no se pueden borrar.
- **Cobros fijos** (`paydays`, por defecto días 1 y 15): definen los periodos (del 1 al 14, del 15 a fin de mes; días > fin de mes se recortan). `periodSummary` da lo ingresado − gastado en el periodo y cuánto queda al día hasta el siguiente cobro. `pendingPaydays` lista cobros sin registrar (desde `since`, máx. 45 días): el resumen los ofrece con un botón "Registrar" (ingreso con `paydayId`). En el alta, `since` = inicio del periodo actual, para pedir el cobro que lo abrió.
- **Gastos fijos** (`fixedCosts`: alquiler, suscripciones…; mensuales o anuales con `month`): se definen en Cuentas (`fixedCostSheet`, que sugiere categoría por el nombre). Nunca se pagan solos: el pago es un gasto normal con `fixedCostId` (`fixedCostPayment`; en la fecha de vencimiento, o hoy si se paga antes). Un vencimiento cuenta como pagado si hay un gasto con su `fixedCostId` a ±10 días (`fixedPayment`), así que pagar antes o con otro importe funciona. Solo hay vencimientos desde el `createdAt` de cada gasto fijo (no se piden meses anteriores al alta).
- `periodSummary` descuenta los fijos del periodo aún sin pagar: `left` (ingresado − gastado), `committed` (fijos pendientes), `free` (`left − committed`) y `perDay` sobre `free`. El resumen muestra `free` como "para gastar"; los vencidos sin pagar salen como tarjeta con "Pagado" (`pendingFixedCosts`) y los de los próximos 3 días como mensaje.
- Registro rápido (`ui/finance/entrySheet.js`, `ctx.openEntry()`, botón "＋ Gasto" de la barra, tecla `g`, ruta `#/finanzas/nuevo`): el importe tiene el foco al abrir (teclado numérico en iOS), la cuenta viene preseleccionada (`lastAccountId`), las categorías van por uso (`categoriesByUse`) y "Repetir" rellena un gasto reciente (`recentExpenses`).
- `monthSummary` compara con el mes anterior **hasta el mismo día del mes**; los presupuestos son mensuales por categoría (aviso al 80%). `financeMessages` sigue la misma regla que los hábitos: cifras concretas, nada genérico.
- Rutas: `#/finanzas`, `#/finanzas/movimientos`, `#/finanzas/cuentas`, `#/finanzas/nuevo`. La sección activa se recuerda (`localStorage['panel.section']`) para abrir la app donde se dejó.

### Datos y copias de seguridad (`src/backup.js`, Ajustes)
- Los datos viven solo en el `localStorage` de cada dispositivo (la app instalada en iOS tiene el suyo, aparte del de Safari). Nunca van al repo (es público) ni a ningún servidor.
- Al arrancar, `requestPersistentStorage()` pide `navigator.storage.persist()` para que el sistema no borre los datos por falta de espacio; Ajustes muestra si está concedido.
- **Copia cifrada**: `encryptBackup` cifra `store.exportJson()` en el dispositivo con AES-256-GCM y clave PBKDF2-SHA-256 (600 000 iteraciones, sal e IV aleatorios en cada copia) → JSON `{ format: 'panel-backup', version: 1, kdf, cipher, data }`. `decryptBackup` falla con un mensaje claro si la contraseña es incorrecta o el archivo está alterado (GCM autentica). La contraseña no se guarda nunca; los campos usan `autocomplete` (`new-password`/`current-password` + usuario oculto "Copia de Panel") para que el llavero de iOS la guarde.
- Guardar el archivo (`saveFile`): hoja de Compartir del sistema (`navigator.share` con `files`; en iPhone → Guardar en Archivos → iCloud Drive) o descarga si no hay. El cifrado y el compartir van en **dos toques**: iOS exige un gesto directo para `share()` y el cifrado es asíncrono.
- WebCrypto solo existe en contexto seguro (HTTPS o localhost): por HTTP en la red local la copia cifrada no está disponible (Ajustes lo avisa).
- Restaurar acepta copias cifradas (pide contraseña) y exportaciones JSON sin cifrar; siempre muestra un resumen y se puede deshacer. `localStorage['panel.lastBackup']` guarda la fecha de la última copia; `backupOverdue` (hay datos y nunca, o ≥ 7 días) pone un punto en Ajustes (barra de Hábitos) y en el ⚙ de Finanzas.

### Correo (`domain/inbox.js`, `src/inbox/`, `src/ui/inbox/`)
- Proveedor-neutro: Gmail (y en el futuro Outlook) se traduce al formato de mensaje de la cabecera de `domain/inbox.js`. Las reglas (`analyzeMessage`/`digest`/`inboxMessages`) funcionan sin IA: pide respuesta (interrogación o petición explícita de una persona, no de remitentes automáticos/boletines), facturas (palabra de pago + importe con moneda; `billRecorded` mira si ya hay un gasto igual ±7 días en Finanzas), fechas (solo con palabra de plazo: "vence", "antes del", "reunión"…), boletines y códigos. Puntuación → "Requiere tu atención".
- **Gmail sin servidor**: OAuth 2.0 de token por redirección (`response_type=token`, permiso `gmail.readonly`), sin librerías de Google. `handleOAuthRedirect()` corre en `app.js` **antes de pintar** (Google devuelve `#access_token=…` en el hash, que choca con el router), comprueba `state` y guarda el token en `sessionStorage` (~1 h; al caducar, "Actualizar" vuelve a pasar por Google). Solo se leen cabeceras y `snippet` (`format=metadata`), nunca el cuerpo. El usuario crea su propio ID de cliente en Google Cloud (guía en Correo → Conexión; la URI de redirección es `redirectUri()` = origen + ruta) y se añade como usuario de prueba.
- **Resumen con IA (opcional)**: `inbox/ai.js` usa el SDK oficial (`vendor/anthropic-sdk-1.8.0.mjs`, `import()` dinámico solo al pedir resumen) con `dangerouslyAllowBrowser: true` y la clave del usuario. Modelo por defecto `claude-opus-5-5` (`effort: low`, salida JSON con `output_config.format` + esquema, `fallbacks: "default"` con la beta `server-side-fallback-2026-07-01` en Opus/Sonnet; Haiku 5.5 como opción barata, sin fallback). Se envían remitente, asunto, extracto y etiquetas de hasta 40 correos. El prompt trata los correos como datos, no como instrucciones. Comprueba `stop_reason` (`refusal`, `max_tokens`) antes de leer el texto.
- **Fuera del estado de la app** a propósito: `localStorage['panel.inbox.config']` (id de cliente, cuenta, clave de Claude, modelo, días) y `['panel.inbox.cache']` (última lectura + último resumen). Así las copias cifradas no incluyen correos ni claves, y `store.js` no sabe nada del correo. Las vistas leen la caché con `currentDigest(finance)`; `ctx.refreshInbox()` / `ctx.runInboxAi()` vuelven a pintar al terminar.
- Modo ejemplo (`demoInbox`, correos ficticios) para probar sin cuenta. Las facturas detectadas ofrecen "Añadir a gastos" (abre `ctx.openEntry` con importe, remitente y fecha).

### Principio clave: todo lo derivado se calcula, nunca se guarda
Rachas, XP, niveles, estadísticas y mensajes se recalculan desde `entries` en cada render. Así, deshacer un registro o rellenar días pasados deja todo coherente sin contadores que sincronizar. No persistas XP ni rachas.

### Fechas (`domain/dates.js`)
Los días son claves locales `'YYYY-MM-DD'`, comparables como strings. Usa siempre `addDays`, `diffDays`, `weekday`, `weekStart` y `fromKey`. **Nunca** `new Date('YYYY-MM-DD')` ni `Date.parse` (lo interpretan como UTC y desplazan el día). La semana empieza en lunes.

### Reglas de dominio que no son obvias
- El periodo en curso nunca rompe una racha: hoy (o la semana actual) sin completar cuenta como "pendiente", no como fallo. En las tasas de cumplimiento, hoy sin hacer y la semana en curso sin cumplir se excluyen del denominador.
- Los días no programados no rompen rachas diarias; registrar en ellos suma XP pero no alarga la racha.
- Los registros anteriores a `createdAt` cuentan (`habitStart()` = mínimo entre creación y primer registro).
- XP (`gamification.js`): base 10 + bonus por racha previa (tope 10 días), bonus por semana cumplida en hábitos semanales, +250 al alcanzar una meta. Nivel n requiere `50·n·(n−1)` XP.
- Proyecciones (`stats.js`): target = regresión lineal sobre las mediciones de los últimos 42 días; meta de total = media diaria de los últimos 14 días.
- Metas de duración (`durationProgress` en `stats.js`): cada periodo (semana en hábitos semanales, día programado en el resto) es cumplido, fallado (pasado sin cumplir) o restante (el actual y los futuros). La meta se logra con `DURATION_SUCCESS` (80 %) de periodos cumplidos, aunque no haya terminado el plazo. Los mensajes dicen cuántos periodos faltan y cuánto margen de fallo queda.
- `messages.js` genera mensajes `{kind, priority, text}`; la vista Hoy muestra los 3 de mayor prioridad. Un mensaje nuevo debe citar una cifra concreta (distancia, fecha, ritmo necesario vs. actual).

### Temas visuales (`src/ui/theme.js`, `themes/`)
- El tema activo va en `html[data-theme]`: `classic` (= `styles.css` tal cual), `hud` (versión A, cian) y `gold` (versión B, dorado). Todas las hojas de `themes/` se cargan siempre desde `index.html` y cada regla va bajo su `html[data-theme="…"]`, así que sin el atributo no afectan a nada.
- Tipografía de A y B: **Space Grotesk** (SIL OFL 1.1), incluida en `fonts/space-grotesk-latin.woff2` (variable 300–700, subconjunto latino) con su licencia en `fonts/OFL-SpaceGrotesk.txt`; el `@font-face` está en `holo.css`. Nada se carga de Google Fonts en tiempo de ejecución (funciona sin conexión). El tema clásico sigue con la fuente del sistema.
- `themes/holo.css` es la base común de A y B (paneles con esquinas, escaneo, anillos, animación de entrada) y **no lleva colores fijos**: usa variables (`--h-rgb`, `--h2-rgb`, `--amber-rgb`, `--panel-top`, `--font-head`, `--font-num`…) que define cada tema en `hud.css` / `gold.css`. Un tema holográfico nuevo = otra hoja de variables + añadirlo al `:is(...)` de `holo.css`.
- Un script en línea en `index.html` aplica el tema guardado (`localStorage['panel.theme']`) antes de pintar, y acepta `?theme=classic|hud|gold`. Se elige en Ajustes → "Estilo visual" (`THEMES`, `applyTheme`). Un tema nuevo: su hoja, su `<link>`, su entrada en `THEMES` (y el color en el script de `index.html`) y su ruta en `SHELL` de `sw.js`.
- `THEMES[].symbols` (solo `gold`): `src/ui/symbols.js` sustituye los emojis por iconos de línea SVG en el color del tema mediante un `MutationObserver` sobre `<body>` (mapa emoji → icono; sin icono propio, silueta del emoji; en `<option>` se quitan). Al cambiar de tema se restauran desde `data-emoji`. Si añades emojis nuevos a la app, añade su icono a `MAP`/`ICONS`. Cuidado con regex `g` + `test()`: deja `lastIndex` movido (se usa `HAS` sin `g` para comprobar).
- Los temas redefinen las variables de `:root` (`--accent`, `--surface`…); las gráficas leen `var(--accent)` en línea, así que cambian solas. `gold.css` además lleva los colores de hábitos/categorías (`--c` en línea) a la gama dorada con selectores `[style*="--c: #…"]` + `!important`. El confeti usa `--confetti` si el tema la define. `app.js` pone `main.enter` ~0,9 s en cada cambio de ruta: úsalo para animaciones de entrada (no en cada re-render).

### UI
- Sin framework. `ui/dom.js` aporta `h()` (HTML), `s()` (SVG), `toast()` y un tooltip compartido. `h()` ignora hijos `null`/`false`; `element.replaceChildren()` **no**, así que filtra antes.
- Las variables CSS dentro de `style` (`{'--c': color}`) funcionan porque `h()` usa `setProperty`. En SVG, los colores con `var(--x)` deben ir en `style`, no como atributo `fill`/`stroke`.
- Cada cambio del store re-renderiza la vista activa entera (salvo si hay un `form.habit-form` en pantalla, para no perder lo que el usuario escribe). El estado efímero de UI (día seleccionado en Hoy, rangos de gráficas, editor de día abierto) vive en `ctx.ui` en `app.js`.
- Todo registro debe pasar por `ctx.logEntry()` / `ctx.logWorkout()` (ambos usan `withFeedback` en `app.js`), no por el store directamente: calculan la XP ganada, detectan récords (de racha y de peso) y subidas de nivel y ofrecen "Deshacer".
- Modales: `ui/sheet.js` (`openSheet`) monta la hoja en `<body>`, fuera de `#view`, así que sobrevive a los re-render; se cierra con el fondo, Escape o al cambiar de ruta. `element.append()` tampoco ignora `null`: filtra antes.
- Rutas: `#/` (Hoy), `#/progreso`, `#/nuevo[?t=índice de plantilla]`, `#/editar/:id`, `#/habito/:id`, `#/ajustes` (+ las de finanzas). Atajos de teclado: `h`, `p`, `n`, `f` (finanzas), `g` (nuevo gasto), `i` (inicio), `c` (correo). Rutas del correo e inicio: `#/inicio`, `#/correo`, `#/correo/bandeja`, `#/correo/conexion`. Sin ruta, la app abre la última sección usada (la primera vez, Inicio).
- La barra superior (`#sections`, `#level`) y la inferior (`#nav`) las pinta `app.js` (`renderNav`/`renderHeader`) según la sección; `index.html` solo tiene los contenedores.
- Gráficas SVG hechas a mano en `ui/charts.js` (`heatmap`, `lineChart`, `barChart`, `ring`). No añadas librerías de gráficas: el proyecto evita dependencias y pasos de build.

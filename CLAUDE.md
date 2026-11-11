# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es

App web de seguimiento de hábitos (UI en español). Objetivos de producto que guían las decisiones:
- **Mínima fricción**: registrar un hábito es un toque desde la vista "Hoy"; sin cuentas ni backend.
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
src/demo.js   datos de ejemplo (botón en el estado vacío)
sw.js, manifest.webmanifest, icons/   PWA instalable (pantalla de inicio de iPhone/Android)
```

### PWA y móvil
- `index.html` lleva las meta de iOS (`apple-touch-icon`, `apple-mobile-web-app-*`, barra de estado `black-translucent`); `.topbar` y `.nav` reservan `env(safe-area-inset-*)`.
- `sw.js` es "red primero" con copia en caché para uso sin conexión. Solo se registra en HTTPS fuera de localhost (`app.js`), para no servir código viejo en desarrollo. **Si añades un archivo a `src/`, añádelo a `SHELL` en `sw.js`** y sube `CACHE` cuando cambie la lista.
- La app instalada en iOS tiene su propio localStorage, separado del de Safari (por eso Ajustes explica cómo exportar e importar).
- Gráficas: el ancho del viewBox es el ancho real disponible (`chartWidth()` en `charts.js`), para que el texto no encoja en el móvil; `app.js` vuelve a renderizar al cambiar el ancho. Los tooltips responden a `touchstart` y se cierran al desplazar.
- Campos de texto a 16 px como mínimo (si no, iOS hace zoom al enfocar); botones táctiles de ≥ 44 px en `@media (max-width: 600px)`.

### Modelo de datos (`store.js`, `domain/habits.js`)
- `state = { version, habits: Habit[], entries: { [habitId]: { 'YYYY-MM-DD': number } }, settings }`. Un valor por hábito y día; `setEntry(id, key, null)` borra.
- Tres `kind` de hábito: `check` (valor 1), `count` (cantidad con `dailyGoal`), `target` (medición que va hacia `goal.value` desde `goal.start`; la dirección subir/bajar se infiere).
- Tres `schedule`: `daily`, `days` (días concretos, 0 = lunes) y `weekly` (N veces por semana, cualquier día). Casi toda la lógica de rachas/estadísticas se bifurca entre "semanal" y "diario/días concretos".
- Un registro = un día, en todos los tipos. En un hábito "3 veces por semana" cada registro es un día concreto de esa semana (la tarjeta de Hoy muestra la tira L–D con los días hechos); la semana se cumple con N días distintos.
- `goal` opcional con `deadline`, distinto según el tipo:
  - `check`: meta de **duración**, no de número de veces: `{ from, deadline }` ("3 veces/semana durante 12 semanas"). El formulario acepta semanas o fecha de fin (y las plantillas `goal.weeks`); se guarda solo `from` + `deadline`.
  - `count`: `{ total, deadline }` (cantidad acumulada).
  - `target`: `{ start, value, deadline }`.
- `createHabit()` es el normalizador único: lo usan el formulario, `updateHabit`, la importación y `migrate()`. Si añades un campo, añádelo ahí.
- Cambios de esquema: subir `VERSION` y añadir un paso en `migrate()` en `store.js`. v2 eliminó `goal.total` de los hábitos `check`.

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

### UI
- Sin framework. `ui/dom.js` aporta `h()` (HTML), `s()` (SVG), `toast()` y un tooltip compartido. `h()` ignora hijos `null`/`false`; `element.replaceChildren()` **no**, así que filtra antes.
- Las variables CSS dentro de `style` (`{'--c': color}`) funcionan porque `h()` usa `setProperty`. En SVG, los colores con `var(--x)` deben ir en `style`, no como atributo `fill`/`stroke`.
- Cada cambio del store re-renderiza la vista activa entera (salvo si hay un `form.habit-form` en pantalla, para no perder lo que el usuario escribe). El estado efímero de UI (día seleccionado en Hoy, rangos de gráficas, editor de día abierto) vive en `ctx.ui` en `app.js`.
- Todo registro debe pasar por `ctx.logEntry()`, no por `store.setEntry()` directamente: calcula la XP ganada, detecta récords y subidas de nivel y ofrece "Deshacer".
- Rutas: `#/` (Hoy), `#/progreso`, `#/nuevo[?t=índice de plantilla]`, `#/editar/:id`, `#/habito/:id`, `#/ajustes`. Atajos de teclado: `h`, `p`, `n`.
- Gráficas SVG hechas a mano en `ui/charts.js` (`heatmap`, `lineChart`, `barChart`, `ring`). No añadas librerías de gráficas: el proyecto evita dependencias y pasos de build.

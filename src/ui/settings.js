import { h, toast } from './dom.js';
import { installCard } from './install.js';

export function settingsView(state, ctx) {
  const archived = state.habits.filter((x) => x.archived);
  const fileInput = h('input', { type: 'file', accept: 'application/json', hidden: true, onChange: async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      ctx.store.importJson(await file.text());
      toast('Datos importados', { action: 'Deshacer', onAction: () => ctx.store.undo(), timeout: 6000 });
    } catch (err) {
      toast(`No se pudo importar: ${err.message}`, { tone: 'bad' });
    }
  } });

  return h('section', { class: 'view settings' },
    h('h1', {}, 'Ajustes'),
    installCard(),
    h('div', { class: 'card' },
      h('h2', {}, 'Tus datos'),
      h('p', { class: 'muted' }, 'Todo se guarda solo en este navegador, sin cuentas. Haz una copia si cambias de dispositivo.'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn primary', onClick: () => {
          const blob = new Blob([ctx.store.exportJson()], { type: 'application/json' });
          const a = h('a', { href: URL.createObjectURL(blob), download: `habitos-${ctx.today()}.json` });
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } }, 'Exportar copia'),
        h('button', { class: 'btn ghost', onClick: () => fileInput.click() }, 'Importar copia'),
        fileInput,
      ),
    ),
    archived.length ? h('div', { class: 'card' },
      h('h2', {}, 'Archivados'),
      h('ul', { class: 'plain' }, archived.map((x) => h('li', {},
        h('a', { href: `#/habito/${x.id}` }, `${x.emoji} ${x.name}`),
        h('button', { class: 'btn ghost small', onClick: () => ctx.store.setArchived(x.id, false) }, 'Restaurar')))),
    ) : null,
    h('div', { class: 'card' },
      h('h2', {}, 'Empezar de cero'),
      h('button', { class: 'btn danger', onClick: () => {
        if (!confirm('¿Borrar todos los hábitos y registros?')) return;
        ctx.store.reset();
        toast('Datos borrados', { action: 'Deshacer', onAction: () => ctx.store.undo(), timeout: 8000 });
      } }, 'Borrar todo'),
    ),
  );
}

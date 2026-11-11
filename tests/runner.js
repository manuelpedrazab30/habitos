// Runner mínimo sin dependencias. Abre tests/index.html (servido por HTTP).
// Filtra con ?grep=texto. El resultado queda en window.__testResults para automatizar.

const tests = [];
export const test = (name, fn) => tests.push({ name, fn });

export function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  esperado: ${e}\n  obtenido: ${a}`);
}
export function ok(cond, msg = 'se esperaba verdadero') {
  if (!cond) throw new Error(msg);
}
export function near(actual, expected, eps = 1e-6, msg = '') {
  if (Math.abs(actual - expected) > eps) throw new Error(`${msg} esperado ≈${expected}, obtenido ${actual}`);
}

export async function run() {
  const grep = new URLSearchParams(location.search).get('grep');
  const out = document.getElementById('out');
  let passed = 0;
  const failed = [];
  for (const t of tests) {
    if (grep && !t.name.includes(grep)) continue;
    try {
      await t.fn();
      passed++;
      out.insertAdjacentHTML('beforeend', `<div class="pass">✓ ${t.name}</div>`);
    } catch (e) {
      failed.push({ name: t.name, error: e.message });
      out.insertAdjacentHTML('beforeend', `<div class="fail">✗ ${t.name}<pre>${e.message}</pre></div>`);
      console.error(t.name, e);
    }
  }
  const summary = `${passed} correctos, ${failed.length} fallidos`;
  document.getElementById('summary').textContent = summary;
  document.title = failed.length ? `✗ ${summary}` : `✓ ${summary}`;
  window.__testResults = { passed, failed };
}

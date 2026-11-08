const test = require('node:test');
const assert = require('node:assert');
const { SECTIONS, DATALISTS } = require('../ds160-schema');
const DS = require('../public/ds160-logic');

// Llena de forma recursiva todos los campos visibles con un valor válido.
function fill(fields, scope, answers = {}) {
  for (let guard = 0; guard < 5; guard++) { // varias pasadas: responder un "sí" hace aparecer campos nuevos
    fields.forEach((f) => {
      if (!DS.isVisible(f, scope)) return;
      if (f.type === 'list') {
        if (!Array.isArray(scope[f.id]) || !scope[f.id].length) scope[f.id] = [{}];
        scope[f.id].forEach((item) => fill(f.fields, item, answers));
      } else if (scope[f.id] === undefined || scope[f.id] === '') {
        if (f.id in answers) scope[f.id] = answers[f.id];
        else if (f.type === 'yesno') scope[f.id] = 'si';
        else if (f.type === 'select') scope[f.id] = f.options[0].value;
        else if (f.type === 'date') scope[f.id] = '1998-10-16';
        else if (f.type === 'number') scope[f.id] = '5';
        else scope[f.id] = 'X';
      }
    });
  }
}

test('ids únicos y condiciones apuntan a campos existentes', () => {
  const seen = new Set();
  SECTIONS.forEach((s) => {
    const ids = new Set(s.fields.map((f) => f.id));
    s.fields.forEach((f) => {
      assert.ok(!seen.has(f.id), 'id duplicado: ' + f.id); seen.add(f.id);
      if (f.list) assert.ok(DATALISTS[f.list], 'datalist faltante: ' + f.list);
      [].concat(f.showIf || []).forEach((c) => assert.ok(ids.has(c.id), `${f.id} depende de ${c.id}`));
      if (f.type === 'list') f.fields.forEach((sf) => [].concat(sf.showIf || []).forEach((c) =>
        assert.ok(f.fields.some((x) => x.id === c.id), `${f.id}.${sf.id} depende de ${c.id}`)));
    });
  });
});

test('formulario vacío: 0 % y con campos pendientes', () => {
  const c = DS.completion(SECTIONS, {});
  assert.strictEqual(c.pct, 0);
  assert.ok(c.total > 100 && c.missing.length === c.total);
});

test('respondiendo "Sí" a todo se llega a 100 % (incluye listas anidadas)', () => {
  const data = {};
  SECTIONS.forEach((s) => fill(s.fields, data));
  const c = DS.completion(SECTIONS, data);
  assert.deepStrictEqual(c.missing, []);
  assert.strictEqual(c.pct, 100);
});

test('respondiendo "No" a todo también llega a 100 % y exige menos', () => {
  const yes = {}; const no = {};
  SECTIONS.forEach((s) => fill(s.fields, yes));
  SECTIONS.forEach((s) => s.fields.forEach((f) => { if (f.type === 'yesno') no[f.id] = 'no'; }));
  SECTIONS.forEach((s) => fill(s.fields, no));
  const cn = DS.completion(SECTIONS, no);
  assert.strictEqual(cn.pct, 100);
  assert.ok(cn.total < DS.completion(SECTIONS, yes).total);
});

test('"No aplica" cuenta como respondido y se muestra legible', () => {
  const data = { nombreNativo: DS.NA };
  const miss = DS.completion(SECTIONS, data).missing.map((m) => m.label);
  assert.ok(!miss.includes('Nombre completo en tu idioma nativo'));
  const rows = DS.present(SECTIONS, data)[0].rows.filter((r) => r.label === 'Nombre completo en tu idioma nativo');
  assert.match(rows[0].value, /^No aplica/);
});

test('una lista visible vacía cuenta como pendiente; con elementos se evalúan sus campos', () => {
  const base = { otrosNombres: 'si' };
  let m = DS.completion(SECTIONS, base).missing.map((x) => x.label);
  assert.ok(m.some((l) => l.startsWith('Otros nombres usados')));
  m = DS.completion(SECTIONS, { ...base, otrosNombresLista: [{ apellidos: 'A' }] }).missing.map((x) => x.label);
  assert.ok(m.includes('Nombre 1: Nombre(s)'));
});

test('sanitizePatch descarta claves desconocidas, tipos raros y recorta largos', () => {
  const out = DS.sanitizePatch(SECTIONS, {
    apellidos: 'A'.repeat(1000), evil: 'x', sexo: { a: 1 }, declaracion: 'si',
    otrosNombresLista: [{ apellidos: 'P', nombres: 'Q', hack: 'z' }],
  }, ['declaracion']);
  assert.strictEqual(out.apellidos.length, 300);
  assert.ok(!('evil' in out) && !('sexo' in out));
  assert.strictEqual(out.declaracion, 'si');
  assert.deepStrictEqual(out.otrosNombresLista, [{ apellidos: 'P', nombres: 'Q' }]);
});

test('toText produce un resumen legible con fechas en español', () => {
  const txt = DS.toText(SECTIONS, { apellidos: 'PEREZ', fechaNacimiento: '1998-10-16', otrosNombres: 'no' });
  assert.match(txt, /Apellido\(s\): PEREZ/);
  assert.match(txt, /16 de octubre de 1998/);
  assert.match(txt, /¿Has usado otros nombres.*: No/);
});

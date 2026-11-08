const test = require('node:test');
const assert = require('node:assert');
const ops = require('../ops');

test('cita: limpia fechas/horas inválidas y recorta textos', () => {
  const a = ops.sanitizeAppointment({ casDate: '2026-12-01', casTime: '9:00', interviewDate: 'mañana', consulate: 'X'.repeat(500), mrvPaid: 'si', evil: 1 });
  assert.strictEqual(a.casDate, '2026-12-01');
  assert.strictEqual(a.casTime, '');
  assert.strictEqual(a.interviewDate, '');
  assert.strictEqual(a.consulate.length, 120);
  assert.strictEqual(a.mrvPaid, 'si');
  assert.ok(!('evil' in a));
});

test('retención: 60 días después de la última cita (la más tardía)', () => {
  assert.strictEqual(ops.purgeDate({}), null);
  assert.strictEqual(ops.purgeDate({ casDate: '2026-01-10', interviewDate: '2026-01-20' }), '2026-03-21');
  assert.strictEqual(ops.purgeDate({ casDate: '2026-01-10' }), '2026-03-11');
  assert.ok(!ops.isPurgeDue({ interviewDate: '2026-01-20' }, new Date('2026-03-20T12:00:00Z')));
  assert.ok(ops.isPurgeDue({ interviewDate: '2026-01-20' }, new Date('2026-03-21T12:00:00Z')));
});

test('cobros: saldo = precio - pagos; descarta montos inválidos', () => {
  const p = ops.sanitizePayments({ price: '2500', items: [{ amount: 1000, date: '2026-11-02' }, { amount: -5 }, { amount: 'abc' }, { amount: 500.555, date: '2026-11-03' }] });
  assert.strictEqual(p.items.length, 2);
  assert.deepStrictEqual(ops.balance(p), { price: 2500, paid: 1500.56, due: 999.44 });
  assert.strictEqual(ops.balance({ price: 100, items: [{ amount: 300 }] }).due, 0);
});

test('recordatorios: requieren texto, fecha válida o vacía, máx. 50', () => {
  const r = ops.sanitizeReminders([{ text: 'Llamar', date: '2026-11-10' }, { text: '', date: '2026-11-10' }, { text: 'x', date: 'hoy' }]);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[1].date, '');
  assert.ok(r[0].id);
});

test('hoja de captura: solo secciones existentes', () => {
  assert.deepStrictEqual(ops.sanitizeCapture({ personal: true, falsa: true, viaje: 0 }, ['personal', 'viaje']), { personal: true });
});

test('reporte: por estado, por mes, ingresos y saldo por cobrar', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const rep = ops.buildReport([
    { status: 'enlace_enviado', created_at: '2026-11-01T10:00:00Z', submitted_at: null, payments: { price: 1000, items: [] } },
    { status: 'cita_programada', created_at: '2026-10-05T10:00:00Z', submitted_at: '2026-10-05T12:00:00Z', payments: { price: 2000, items: [{ amount: 500, date: '2026-11-03' }, { amount: 1500, date: '2026-10-20' }] } },
  ], now);
  assert.strictEqual(rep.totals.applications, 2);
  assert.strictEqual(rep.totals.submitted, 1);
  assert.strictEqual(rep.totals.avgHoursToSubmit, 2);
  assert.strictEqual(rep.byStatus.cita_programada, 1);
  assert.strictEqual(rep.months.length, 6);
  const nov = rep.months[5], oct = rep.months[4];
  assert.strictEqual(nov.month, '2026-11');
  assert.strictEqual(nov.created, 1); assert.strictEqual(nov.income, 500);
  assert.strictEqual(oct.created, 1); assert.strictEqual(oct.submitted, 1); assert.strictEqual(oct.income, 1500);
  assert.deepStrictEqual(rep.money, { collected: 2000, due: 1000, thisMonth: 500 });
});

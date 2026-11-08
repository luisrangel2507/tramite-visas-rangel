// Lógica compartida del formulario DS-160 (servidor y navegador).
// Visibilidad condicional, porcentaje de avance, campos faltantes,
// limpieza de datos y presentación legible.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DS160 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  var NA = 'NA';
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function one(cond, scope) {
    var v = scope[cond.id];
    if ('eq' in cond) return v === cond.eq;
    if (cond.in) return cond.in.indexOf(v) !== -1;
    if (cond.notIn) return v != null && v !== '' && cond.notIn.indexOf(v) === -1;
    return true;
  }
  function isVisible(field, scope) {
    var c = field.showIf;
    if (!c) return true;
    if (!Array.isArray(c)) c = [c];
    for (var i = 0; i < c.length; i++) if (!one(c[i], scope)) return false;
    return true;
  }
  function isFilled(v) {
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && String(v).trim() !== '';
  }

  // Recorre los campos visibles de un ámbito (sección o elemento de lista).
  function walk(fields, scope, cb, path) {
    fields.forEach(function (f) {
      if (!isVisible(f, scope)) return;
      if (f.type === 'list') {
        var items = Array.isArray(scope[f.id]) ? scope[f.id] : [];
        cb(f, scope, path, null);
        items.forEach(function (it, i) {
          walk(f.fields, it || {}, cb, path.concat([{ field: f, index: i }]));
        });
      } else {
        cb(f, scope, path, null);
      }
    });
  }

  function missingLabel(f, path) {
    var prefix = path.map(function (p) { return (p.field.itemLabel || p.field.label) + ' ' + (p.index + 1); }).join(' › ');
    return prefix ? prefix + ': ' + f.label : f.label;
  }

  // → { filled, total, pct, missing:[{sectionId, section, label}], bySection:{id:{filled,total}} }
  function completion(sections, data) {
    data = data || {};
    var filled = 0, total = 0, missing = [], bySection = {};
    sections.forEach(function (s) {
      var sf = 0, st = 0;
      walk(s.fields, data, function (f, scope, path) {
        if (f.optional) return;
        if (f.type === 'list') {
          // la lista cuenta como 1 unidad: debe tener al menos un elemento
          st++;
          if (isFilled(scope[f.id])) sf++;
          else missing.push({ sectionId: s.id, section: s.title, field: f.id, label: missingLabel(f, path) + ' (agrega al menos uno)' });
          return;
        }
        st++;
        if (isFilled(scope[f.id])) sf++;
        else missing.push({ sectionId: s.id, section: s.title, field: path.length ? path[0].field.id : f.id, label: missingLabel(f, path) });
      }, []);
      bySection[s.id] = { filled: sf, total: st };
      filled += sf; total += st;
    });
    return { filled: filled, total: total, pct: total ? Math.floor((filled / total) * 100) : 0, missing: missing, bySection: bySection };
  }

  // Limpia un parche del cliente según el esquema: descarta claves desconocidas
  // y valores con tipo equivocado; recorta longitudes. Devuelve solo lo válido.
  function sanitizeValue(field, v) {
    if (field.type === 'list') {
      if (!Array.isArray(v)) return undefined;
      var max = field.max || 10;
      return v.slice(0, max).map(function (item) {
        var out = {};
        field.fields.forEach(function (sf) {
          if (sf.type === 'list') return;
          var sv = sanitizeValue(sf, item && item[sf.id]);
          if (sv !== undefined) out[sf.id] = sv;
        });
        return out;
      });
    }
    if (v === null || v === undefined) return '';
    if (typeof v !== 'string' && typeof v !== 'number') return undefined;
    v = String(v);
    var limit = field.type === 'textarea' ? 2000 : 300;
    return v.slice(0, limit);
  }
  function sanitizePatch(sections, patch, extraKeys) {
    var index = {};
    sections.forEach(function (s) { s.fields.forEach(function (f) { index[f.id] = f; }); });
    var out = {};
    Object.keys(patch || {}).forEach(function (k) {
      if (extraKeys && extraKeys.indexOf(k) !== -1) {
        out[k] = String(patch[k] == null ? '' : patch[k]).slice(0, 20);
        return;
      }
      var f = index[k];
      if (!f) return;
      var v = sanitizeValue(f, patch[k]);
      if (v !== undefined) out[k] = v;
    });
    return out;
  }

  // ── Presentación ────────────────────────────────────────────────────────
  function fmtDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return parseInt(m[3], 10) + ' de ' + MESES[parseInt(m[2], 10) - 1] + ' de ' + m[1];
  }
  function displayValue(f, v) {
    if (v === NA) return 'No aplica' + (f.na ? ' (' + f.na + ')' : '');
    if (!isFilled(v)) return '';
    if (f.type === 'yesno') return v === 'si' ? 'Sí' : v === 'no' ? 'No' : v;
    if (f.type === 'select') {
      var o = (f.options || []).filter(function (x) { return x.value === v; })[0];
      return o ? o.label : v;
    }
    if (f.type === 'date') return fmtDate(v);
    return String(v);
  }

  // → [{ id, title, rows:[ {label, value, empty} | {label, items:[[rows]...]} ] }]
  function present(sections, data) {
    data = data || {};
    function build(fields, scope) {
      var rows = [];
      fields.forEach(function (f) {
        if (!isVisible(f, scope)) return;
        if (f.type === 'list') {
          var items = Array.isArray(scope[f.id]) ? scope[f.id] : [];
          rows.push({ label: f.label, itemLabel: f.itemLabel, items: items.map(function (it) { return build(f.fields, it || {}); }) });
        } else {
          var val = displayValue(f, scope[f.id]);
          rows.push({ label: f.label, value: val, empty: !val, optional: !!f.optional });
        }
      });
      return rows;
    }
    return sections.map(function (s) { return { id: s.id, title: s.title, rows: build(s.fields, data) }; });
  }

  function toText(sections, data) {
    var out = [];
    function emit(rows, indent) {
      rows.forEach(function (r) {
        if (r.items) {
          out.push(indent + r.label + ':');
          if (!r.items.length) out.push(indent + '  — sin respuesta —');
          r.items.forEach(function (it, i) {
            out.push(indent + '  ' + (r.itemLabel || 'Elemento') + ' ' + (i + 1));
            emit(it, indent + '    ');
          });
        } else {
          out.push(indent + r.label + ': ' + (r.value || '—'));
        }
      });
    }
    present(sections, data).forEach(function (s) {
      out.push('', '== ' + s.title.toUpperCase() + ' ==');
      emit(s.rows, '');
    });
    return out.join('\n').trim();
  }

  return {
    NA: NA, isVisible: isVisible, isFilled: isFilled, completion: completion,
    sanitizePatch: sanitizePatch, present: present, toText: toText, fmtDate: fmtDate, displayValue: displayValue,
  };
});

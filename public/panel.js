// Panel de Visapp (administrador).
(function () {
  'use strict';
  var DS = window.DS160;
  var API = '/api/visa';
  var token = '';
  try { token = localStorage.getItem('visa_token') || ''; } catch (e) {}

  var schema = null, apps = [], overview = { unread: 0, reminders: [], upcoming: [] };
  var current = null;          // detalle abierto: { application, data, ... }
  var navName = 'apps', viewMode = 'list', clientFilter = 'all';
  try { viewMode = localStorage.getItem('visa_view') === 'board' ? 'board' : 'list'; } catch (e) {}

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDate(iso) { return iso ? new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
  function fmtDay(d) { return d ? DS.fmtDate(d) : ''; }
  function fmtSize(b) { return b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
  function money(n) { return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 }); }
  function linkFor(t) { return location.origin + '/s/' + t; }
  function todayStr() { var d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function newId() { return Math.random().toString(16).slice(2, 10); }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (token) headers['X-Auth-Token'] = token;
    return fetch(API + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (!res.ok) { var e = new Error(d.error || 'Error de red'); e.status = res.status; throw e; }
          return d;
        });
      });
  }
  var toastTimer;
  function toast(text) {
    var t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 1800);
  }
  function copy(text, okMsg) {
    var done = function () { toast(okMsg || 'Copiado'); };
    function fallback() {
      var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('No se pudo copiar'); }
      ta.remove();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback); else fallback();
  }
  function busy(btn, text, fn) {
    var orig = btn.innerHTML; btn.disabled = true; btn.textContent = text;
    return fn().then(function (v) { btn.disabled = false; btn.innerHTML = orig; return v; },
      function (e) { btn.disabled = false; btn.innerHTML = orig; throw e; });
  }
  function waLink(text) { return 'https://wa.me/?text=' + encodeURIComponent(text); }
  function onClick(id, fn) { $(id).addEventListener('click', fn); }
  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
  function msg(id, text, ok) { $(id).innerHTML = text ? '<div class="msg ' + (ok ? 'ok' : 'err') + '">' + esc(text) + '</div>' : ''; }

  // ── Acceso ──────────────────────────────────────────────────────────────
  function authMsg(t, err) { $('auth-msg').innerHTML = t ? '<div class="msg ' + (err ? 'err' : 'ok') + '">' + esc(t) + '</div>' : ''; }
  function setToken(t) { token = t; try { localStorage.setItem('visa_token', t); } catch (e) {} }
  function clearToken() { token = ''; try { localStorage.removeItem('visa_token'); } catch (e) {} }

  $('login-form').addEventListener('submit', function (e) {
    e.preventDefault(); authMsg('');
    busy(e.target.querySelector('button[type=submit]'), 'Ingresando…', function () {
      return api('/login', { method: 'POST', body: { email: $('login-email').value, password: $('login-password').value } });
    }).then(function (d) { setToken(d.token); boot(); }).catch(function (err) { authMsg(err.message, true); });
  });
  onClick('pw-eye', function () { var i = $('login-password'); i.type = i.type === 'password' ? 'text' : 'password'; });
  onClick('to-setup', function () { $('setup-form').classList.toggle('hidden'); authMsg(''); });
  $('setup-form').addEventListener('submit', function (e) {
    e.preventDefault(); authMsg('');
    busy(e.target.querySelector('button[type=submit]'), 'Creando…', function () {
      return api('/register', { method: 'POST', body: { name: $('setup-name').value, email: $('setup-email').value, password: $('setup-password').value } });
    }).then(function (d) { setToken(d.token); boot(); }).catch(function (err) { authMsg(err.message, true); });
  });
  onClick('logout-btn', function () {
    api('/logout', { method: 'POST' }).catch(function () {}).then(function () {
      clearToken(); $('app-screen').classList.add('hidden'); $('auth-screen').classList.remove('hidden');
    });
  });
  onClick('logout-btn2', function () { $('logout-btn').click(); });

  // ── Navegación ──────────────────────────────────────────────────────────
  var AREAS = { apps: 'list-area', clients: 'clients-area', reports: 'reports-area', settings: 'settings-area' };
  function showNav(name) {
    navName = name;
    Object.keys(AREAS).forEach(function (k) { $(AREAS[k]).classList.toggle('hidden', k !== name); });
    $('detail-area').classList.add('hidden');
    each('.bottom-nav button', function (b) { b.classList.toggle('active', b.dataset.nav === name); });
    window.scrollTo(0, 0);
    if (name === 'apps') refreshAll();
    if (name === 'clients') renderClients();
    if (name === 'reports') loadReports();
    if (name === 'settings') loadSettings();
  }
  each('.bottom-nav button', function (b) { b.addEventListener('click', function () { showNav(b.dataset.nav); }); });
  onClick('back', function () { showNav(navName); });

  // ── Solicitudes: nueva ──────────────────────────────────────────────────
  function statusOpt(v) { return (schema.statusOptions.filter(function (s) { return s.value === v; })[0]) || { label: v, tone: 'neutral' }; }
  function reminderText(a, url) {
    return 'Hola ' + a.clientName.split(' ')[0] + ', vas en ' + a.completion.pct + '% de tu solicitud de visa. Continúa donde te quedaste (se guarda sola): ' + url;
  }
  var freshCreds = {};   // contraseñas recién generadas (solo en memoria, para poder copiarlas)
  function accessText(name, url, cred, showPass) {
    return 'Hola ' + name.split(' ')[0] + ', para tu trámite de visa entra a Visapp y llena tu información (se guarda sola y puedes continuar después):\n' +
      'Enlace: ' + url + '\nUsuario: ' + cred.username + '\n' + (showPass ? 'Contraseña: ' + cred.password : '(tu contraseña te la mandé antes)');
  }
  function credBoxHtml(app, cred) {
    var url = linkFor(app.token);
    return '<div class="cred-box"><div class="cred-row"><span>Usuario</span><b>' + esc(cred.username) + '</b><button class="btn btn-sm" data-copy="' + esc(cred.username) + '" data-copy-msg="Usuario copiado">Copiar</button></div>' +
      '<div class="cred-row"><span>Contraseña</span><b>' + esc(cred.password) + '</b><button class="btn btn-sm" data-copy="' + esc(cred.password) + '" data-copy-msg="Contraseña copiada">Copiar</button></div>' +
      '<div class="link-actions"><button class="btn btn-sm btn-primary" data-copy="' + esc(accessText(app.clientName, url, cred, true)) + '" data-copy-msg="Mensaje copiado">Copiar mensaje completo</button>' +
      '<a class="btn btn-sm btn-wa" style="text-decoration:none;display:inline-block" target="_blank" rel="noopener" href="' + esc(waLink(accessText(app.clientName, url, cred, true))) + '">Enviar por WhatsApp</a></div>' +
      '<div class="hint">⚠️ Guarda o envía la contraseña ahora: por seguridad no se vuelve a mostrar (si se pierde, la restableces).</div></div>';
  }
  function linkBoxHtml(app, cred) {
    var url = linkFor(app.token);
    freshCreds[app.id] = cred;
    return '<div class="link-box"><div class="lbl">Acceso creado para ' + esc(app.clientName) + '</div>' + credBoxHtml(app, cred) +
      '<div class="lbl" style="margin-top:12px">Enlace personal</div><div class="link-url">' + esc(url) + '</div>' +
      '<div class="link-actions"><button class="btn btn-sm" data-copy="' + esc(url) + '">Copiar solo el enlace</button></div></div>';
  }
  onClick('new-btn', function () {
    var name = $('new-name').value.trim();
    if (!name) { msg('new-msg', 'Escribe el nombre del cliente'); return; }
    msg('new-msg', '');
    busy($('new-btn'), 'Creando…', function () {
      return api('/admin/applications', { method: 'POST', body: { name: name, note: $('new-note').value } });
    }).then(function (d) {
      $('new-link').innerHTML = linkBoxHtml(d.application, d.credentials);
      $('new-name').value = ''; $('new-note').value = '';
      refreshAll();
    }).catch(function (err) { msg('new-msg', err.message); });
  });

  // ── Solicitudes: lista, tablero, filtros ────────────────────────────────
  function filtered() {
    var q = $('search-input').value.trim().toLowerCase(), f = $('filter-status').value;
    return apps.filter(function (a) {
      if (f === '__new') return a.unread;
      return (!q || (a.clientName + ' ' + a.note).toLowerCase().indexOf(q) !== -1) && (!f || a.status.status === f);
    });
  }
  function badges(a) {
    var h = '';
    if (a.unread) h += '<span class="pill new">Nuevo</span>';
    else if (a.submittedAt) h += '<span class="pill sent">Enviado</span>';
    if (a.groupSize > 1) h += '<span class="pill grp" title="Grupo de viaje">👥 ' + a.groupSize + '</span>';
    return h;
  }
  function cardHtml(a, i) {
    var st = statusOpt(a.status.status), ap = a.appointment || {};
    var next = ap.interviewDate || ap.casDate;
    return '<div class="client-card' + (a.unread ? ' is-new' : '') + '" data-open="' + a.id + '" style="animation-delay:' + (i * 30) + 'ms">' +
      '<div class="client-top"><div><div class="client-name">' + esc(a.clientName) + '</div>' + (a.note ? '<div class="client-note">' + esc(a.note) + '</div>' : '') + '</div>' +
      '<div class="pills">' + badges(a) + '<span class="pill tone-' + st.tone + '">' + esc(st.label) + '</span><span class="pill">' + a.completion.pct + '%</span></div></div>' +
      '<div class="bar"><i style="width:' + a.completion.pct + '%"></i></div>' +
      '<div class="client-meta"><span>' + a.documentCount + ' doc(s)</span>' +
      (next ? '<span>· 📅 ' + esc(fmtDay(next)) + '</span>' : '') +
      (a.balance.due > 0 ? '<span class="due">· Debe ' + money(a.balance.due) + '</span>' : '') +
      '<span>· ' + (a.updatedAt ? 'editó ' + fmtDate(a.updatedAt) : a.lastOpenedAt ? 'abrió el enlace' : 'aún no abre el enlace') + '</span>' +
      '<button class="btn btn-sm" style="margin-left:auto" data-copy="' + esc(linkFor(a.token)) + '">Copiar enlace</button></div></div>';
  }
  var FOLDER = '<svg viewBox="0 0 24 24"><path d="M6 11V6a2 2 0 0 1 2-2h7l3 3v4"/><path d="M9 8h5M9 11h4"/><path d="M4 13h16l-1.4 7.5H5.4z"/></svg>';
  function renderApps() {
    var box = $('apps-list'), board = $('board');
    $('view-list').classList.toggle('on', viewMode === 'list');
    $('view-board').classList.toggle('on', viewMode === 'board');
    box.classList.toggle('hidden', viewMode !== 'list');
    board.classList.toggle('hidden', viewMode !== 'board');
    if (!apps.length) {
      board.classList.add('hidden'); box.classList.remove('hidden');
      box.innerHTML = '<div class="empty-state"><div class="empty-ill">' + FOLDER + '</div><h4>Aún no hay solicitudes</h4><p>Crea la primera solicitud y comienza a gestionar trámites.</p><button class="btn-outline-gold" id="first-btn" type="button">+ Crear primera solicitud</button></div>';
      return;
    }
    var list = filtered();
    if (viewMode === 'list') {
      box.innerHTML = list.length ? list.map(cardHtml).join('') : '<div class="empty">Sin resultados con ese filtro.</div>';
      return;
    }
    board.innerHTML = schema.statusOptions.map(function (s) {
      var col = list.filter(function (a) { return a.status.status === s.value; });
      return '<div class="col" data-col="' + s.value + '"><div class="col-hd tone-' + s.tone + '"><span>' + esc(s.label) + '</span><b>' + col.length + '</b></div>' +
        col.map(function (a) {
          return '<div class="kcard' + (a.unread ? ' is-new' : '') + '" draggable="true" data-drag="' + a.id + '" data-open="' + a.id + '">' +
            '<div class="kname">' + esc(a.clientName) + '</div><div class="kmeta">' + badges(a) + '<span class="pill">' + a.completion.pct + '%</span></div>' +
            (a.balance.due > 0 ? '<div class="due kdue">Debe ' + money(a.balance.due) + '</div>' : '') +
            '<select class="kmove" data-move="' + a.id + '" aria-label="Mover a…"><option value="">Mover a…</option>' +
            schema.statusOptions.filter(function (x) { return x.value !== a.status.status; }).map(function (x) { return '<option value="' + x.value + '">' + esc(x.label) + '</option>'; }).join('') + '</select></div>';
        }).join('') + '</div>';
    }).join('');
  }
  function moveStatus(id, status) {
    var a = apps.filter(function (x) { return x.id === id; })[0];
    if (!a || a.status.status === status) return;
    api('/admin/applications/' + id + '/status', { method: 'PUT', body: { status: status, note: a.status.note || '' } })
      .then(function () { toast('Movida a “' + statusOpt(status).label + '”'); refreshAll(); })
      .catch(function (err) { alert(err.message); });
  }
  var board = $('board');
  board.addEventListener('dragstart', function (e) { var c = e.target.closest('[data-drag]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.drag); e.dataTransfer.effectAllowed = 'move'; } });
  board.addEventListener('dragover', function (e) { var col = e.target.closest('.col'); if (col) { e.preventDefault(); col.classList.add('over'); } });
  board.addEventListener('dragleave', function (e) { var col = e.target.closest('.col'); if (col) col.classList.remove('over'); });
  board.addEventListener('drop', function (e) {
    var col = e.target.closest('.col'); if (!col) return;
    e.preventDefault(); col.classList.remove('over');
    moveStatus(e.dataTransfer.getData('text/plain'), col.dataset.col);
  });
  board.addEventListener('change', function (e) { var s = e.target.closest('[data-move]'); if (s && s.value) moveStatus(s.dataset.move, s.value); });
  board.addEventListener('click', function (e) { if (e.target.closest('[data-move]')) e.stopPropagation(); }, true);

  onClick('view-list', function () { viewMode = 'list'; try { localStorage.setItem('visa_view', 'list'); } catch (e) {} renderApps(); });
  onClick('view-board', function () { viewMode = 'board'; try { localStorage.setItem('visa_view', 'board'); } catch (e) {} renderApps(); });
  onClick('search-btn', function () { var t = $('list-tools'); t.classList.toggle('hidden'); $('search-btn').classList.toggle('on', !t.classList.contains('hidden')); if (!t.classList.contains('hidden')) $('search-input').focus(); });
  onClick('filter-btn', function () { var t = $('list-tools'); t.classList.toggle('hidden'); $('filter-btn').classList.toggle('on', !t.classList.contains('hidden')); });
  $('search-input').addEventListener('input', renderApps);
  $('filter-status').addEventListener('change', renderApps);
  $('apps-list').addEventListener('click', function (e) { if (e.target.id === 'first-btn') { $('new-name').focus(); window.scrollTo({ top: 0, behavior: 'smooth' }); } });

  document.addEventListener('click', function (e) {
    var c = e.target.closest ? e.target.closest('[data-copy]') : null;
    if (c) { e.stopPropagation(); copy(c.dataset.copy, c.dataset.copyMsg || 'Enlace copiado'); return; }
    var o = e.target.closest ? e.target.closest('[data-open]') : null;
    if (o) openDetail(o.dataset.open);
  });

  // ── Hoy: recordatorios, citas próximas, nuevos ──────────────────────────
  function renderToday() {
    var el = $('today-card'), h = '';
    var r = overview.reminders, u = overview.upcoming;
    if (overview.unread) h += '<button class="today-new" id="today-new" type="button">🔔 ' + overview.unread + (overview.unread === 1 ? ' formulario nuevo' : ' formularios nuevos') + ' por revisar</button>';
    if (r.length) {
      h += '<div class="today-title">Recordatorios</div>' + r.map(function (x) {
        return '<div class="trow"><button class="tick" data-rem-done="' + x.appId + ':' + x.id + '" aria-label="Marcar como hecho">✓</button>' +
          '<div class="tmain" data-open="' + x.appId + '"><b>' + esc(x.text) + '</b><span>' + esc(x.clientName) + '</span></div>' +
          '<span class="tdate' + (x.overdue ? ' over' : '') + '">' + (x.overdue ? 'Vencido · ' + esc(fmtDay(x.date)) : 'Hoy') + '</span></div>';
      }).join('');
    }
    if (u.length) {
      h += '<div class="today-title">Próximas citas</div>' + u.slice(0, 5).map(function (x) {
        return '<div class="trow" data-open="' + x.appId + '"><span class="ticon">📅</span><div class="tmain"><b>' + esc(x.clientName) + '</b><span>' + esc(x.kind) + '</span></div><span class="tdate">' + esc(fmtDay(x.date)) + (x.time ? ' · ' + esc(x.time) : '') + '</span></div>';
      }).join('');
    }
    el.classList.toggle('hidden', !h);
    el.innerHTML = h;
    var b = $('nav-badge');
    b.textContent = overview.unread; b.classList.toggle('hidden', !overview.unread);
    document.title = (overview.unread ? '(' + overview.unread + ') ' : '') + 'Visapp — Panel';
  }
  $('today-card').addEventListener('click', function (e) {
    var d = e.target.closest('[data-rem-done]');
    if (d) {
      e.stopPropagation();
      var p = d.dataset.remDone.split(':');
      api('/admin/applications/' + p[0] + '/reminders/' + p[1] + '/done', { method: 'POST' }).then(function () { toast('Recordatorio hecho'); refreshAll(); });
      return;
    }
    if (e.target.id === 'today-new') { $('filter-status').value = '__new'; $('list-tools').classList.remove('hidden'); renderApps(); }
  });

  function loadList() { return api('/admin/applications').then(function (d) { apps = d.applications; renderApps(); if (navName === 'clients') renderClients(); }); }
  function loadOverview() { return api('/admin/overview').then(function (d) { overview = d; renderToday(); }); }
  function refreshAll() { return Promise.all([loadList(), loadOverview()]).catch(function () {}); }

  // ── Clientes (cobranza) ─────────────────────────────────────────────────
  function renderClients() {
    var due = 0, paid = 0;
    apps.forEach(function (a) { due += a.balance.due; paid += a.balance.paid; });
    $('clients-kpis').innerHTML =
      '<div class="kpi"><span>Por cobrar</span><b class="due">' + money(due) + '</b></div><div class="kpi"><span>Cobrado</span><b>' + money(paid) + '</b></div>';
    var list = apps.filter(function (a) {
      if (clientFilter === 'due') return a.balance.due > 0;
      if (clientFilter === 'paid') return a.balance.price > 0 && a.balance.due === 0;
      return true;
    }).sort(function (a, b) { return b.balance.due - a.balance.due; });
    $('clients-list').innerHTML = list.length ? list.map(function (a) {
      var b = a.balance, st = statusOpt(a.status.status);
      return '<div class="client-card" data-open="' + a.id + '"><div class="client-top"><div><div class="client-name">' + esc(a.clientName) + (a.groupSize > 1 ? ' <span class="pill grp">👥 ' + a.groupSize + '</span>' : '') + '</div>' +
        '<div class="client-note">' + esc(st.label) + (a.note ? ' · ' + esc(a.note) : '') + '</div></div>' +
        '<div class="money"><b class="' + (b.due > 0 ? 'due' : 'okc') + '">' + (b.price ? (b.due > 0 ? money(b.due) : 'Liquidado') : '—') + '</b>' + (b.price ? '<small>de ' + money(b.price) + '</small>' : '<small>sin precio</small>') + '</div></div></div>';
    }).join('') : '<div class="empty">Nada por aquí con este filtro.</div>';
  }
  each('#clients-chips .chip', function (c) {
    c.addEventListener('click', function () { clientFilter = c.dataset.cf; each('#clients-chips .chip', function (x) { x.classList.toggle('on', x === c); }); renderClients(); });
  });

  // ── Reportes ────────────────────────────────────────────────────────────
  var MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function monthLabel(m) { return MESES[parseInt(m.slice(5, 7), 10) - 1]; }
  function barChart(months, a, b, fmt) {
    var max = Math.max.apply(null, months.map(function (m) { return Math.max(m[a], b ? m[b] : 0); }).concat([1]));
    return '<div class="bars">' + months.map(function (m) {
      return '<div class="barcol"><div class="bpair"><i class="b1" style="height:' + Math.round((m[a] / max) * 100) + '%" title="' + fmt(m[a]) + '"></i>' +
        (b ? '<i class="b2" style="height:' + Math.round((m[b] / max) * 100) + '%" title="' + fmt(m[b]) + '"></i>' : '') + '</div><span>' + monthLabel(m.month) + '</span></div>';
    }).join('') + '</div>';
  }
  function loadReports() {
    $('reports-body').innerHTML = '<div class="empty">Cargando…</div>';
    api('/admin/reports').then(function (r) {
      var t = r.totals, total = t.applications || 1;
      var h = '<div class="kpis">' +
        '<div class="kpi"><span>Solicitudes</span><b>' + t.applications + '</b></div>' +
        '<div class="kpi"><span>Formularios enviados</span><b>' + t.submitted + '</b></div>' +
        '<div class="kpi"><span>Cobrado este mes</span><b>' + money(r.money.thisMonth) + '</b></div>' +
        '<div class="kpi"><span>Por cobrar</span><b class="due">' + money(r.money.due) + '</b></div>' +
        '<div class="kpi"><span>Llenado promedio</span><b>' + (t.avgHoursToSubmit == null ? '—' : t.avgHoursToSubmit < 48 ? t.avgHoursToSubmit + ' h' : Math.round(t.avgHoursToSubmit / 24) + ' días') + '</b></div>' +
        '<div class="kpi"><span>Cobrado en total</span><b>' + money(r.money.collected) + '</b></div></div>';
      h += '<div class="card"><div class="card-title" style="margin-bottom:6px">Solicitudes por mes</div><div class="legend"><i class="b1"></i> Creadas <i class="b2"></i> Enviadas</div>' +
        barChart(r.months, 'created', 'submitted', function (v) { return v; }) + '</div>';
      h += '<div class="card"><div class="card-title" style="margin-bottom:6px">Ingresos por mes</div>' + barChart(r.months, 'income', null, money) +
        '<div class="hint">Suma de los pagos registrados en cada mes.</div></div>';
      h += '<div class="card"><div class="card-title" style="margin-bottom:10px">Embudo por estado</div>' + schema.statusOptions.map(function (s) {
        var n = r.byStatus[s.value] || 0;
        return '<div class="funnel"><span>' + esc(s.label) + '</span><div class="fbar"><i class="tone-' + s.tone + '" style="width:' + Math.round((n / total) * 100) + '%"></i></div><b>' + n + '</b></div>';
      }).join('') + '</div>';
      $('reports-body').innerHTML = h;
    }).catch(function (err) { $('reports-body').innerHTML = '<div class="msg err">' + esc(err.message) + '</div>'; });
  }

  // ── Configuración ───────────────────────────────────────────────────────
  function loadSettings() {
    api('/admin/settings').then(function (d) {
      $('set-name').value = d.settings.advisorName; $('set-wa').value = d.settings.whatsapp; $('set-mail').value = d.settings.notifyEmail;
      $('mail-hint').textContent = d.emailConfigured ? 'Te llegará un correo cada vez que un cliente envíe su formulario.'
        : 'Aún no está configurado el envío de correos en el servidor (variable SMTP_URL); mientras tanto verás los avisos dentro del panel.';
    });
  }
  onClick('set-save', function () {
    busy($('set-save'), 'Guardando…', function () {
      return api('/admin/settings', { method: 'PUT', body: { advisorName: $('set-name').value, whatsapp: $('set-wa').value, notifyEmail: $('set-mail').value } });
    }).then(function () { msg('set-msg', 'Datos guardados', true); }).catch(function (err) { msg('set-msg', err.message); });
  });
  onClick('pwd-save', function () {
    var cur = $('pwd-current'), neu = $('pwd-new');
    if (neu.value.length < 6) { msg('pwd-msg', 'La nueva contraseña debe tener al menos 6 caracteres'); return; }
    busy($('pwd-save'), 'Guardando…', function () {
      return api('/password', { method: 'PUT', body: { currentPassword: cur.value, newPassword: neu.value } });
    }).then(function () { cur.value = ''; neu.value = ''; msg('pwd-msg', 'Contraseña actualizada', true); }).catch(function (err) { msg('pwd-msg', err.message); });
  });
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; $('install-btn').classList.remove('hidden'); $('install-text').textContent = 'Instala Visapp para abrirla como una app, con su propio ícono.'; });
  onClick('install-btn', function () { if (installEvt) { installEvt.prompt(); installEvt = null; $('install-btn').classList.add('hidden'); } });
  if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches) {
    $('install-text').textContent = 'En iPhone: abre esta página en Safari, toca Compartir y elige “Agregar a pantalla de inicio”.';
  }

  // ── Detalle ─────────────────────────────────────────────────────────────
  function openAcc(name, open) { var c = document.querySelector('[data-acc="' + name + '"]'); if (c) c.classList.toggle('open', open !== false); }
  each('.acc-hd', function (h) { h.addEventListener('click', function () { h.parentElement.classList.toggle('open'); }); });

  function pill(id, text, tone) { var el = $(id); el.textContent = text || ''; el.className = 'mini' + (tone ? ' tone-' + tone : ''); }

  function openDetail(id) {
    return api('/admin/applications/' + id).then(function (d) {
      current = d;
      Object.keys(AREAS).forEach(function (k) { $(AREAS[k]).classList.add('hidden'); });
      $('detail-area').classList.remove('hidden');
      window.scrollTo(0, 0);
      renderDetail();
      if (d.application.unread) api('/admin/applications/' + id + '/seen', { method: 'POST' }).then(refreshAll);
    }).catch(function (err) { alert(err.message); });
  }

  var lastDetailId = null;
  function renderDetail() {
    var d = current, a = d.application;
    if (lastDetailId !== a.id) { each('.acc', function (c) { c.classList.remove('open'); }); lastDetailId = a.id; }
    $('d-name').textContent = a.clientName;
    $('d-sub').textContent = (a.note ? a.note + ' · ' : '') + a.completion.pct + '% completado' + (a.submittedAt ? ' · enviado ' + fmtDate(a.submittedAt) : ' · aún no lo envía');
    var purged = !!a.purgedAt;
    $('d-purged').classList.toggle('hidden', !purged);
    $('d-purged').textContent = purged ? 'Por privacidad, las respuestas y documentos de este trámite se eliminaron el ' + fmtDate(a.purgedAt) + ' (2 meses después de la cita). Se conservan el nombre, el estado y los cobros.' : '';
    $('d-link').textContent = linkFor(a.token);
    paintCred();
    pill('d-privacy', d.privacyAcceptedAt ? 'Privacidad aceptada' : 'Sin aceptar privacidad', d.privacyAcceptedAt ? 'good' : 'warn');

    // estado
    $('d-status').value = a.status.status; $('d-status-note').value = a.status.note || '';
    $('d-status-hint').textContent = a.status.updatedAt ? 'Última actualización: ' + fmtDate(a.status.updatedAt) : '';
    pill('d-status-pill', statusOpt(a.status.status).label, statusOpt(a.status.status).tone);

    // cita
    var ap = d.appointment || {};
    $('c-cas-d').value = ap.casDate || ''; $('c-cas-t').value = ap.casTime || '';
    $('c-int-d').value = ap.interviewDate || ''; $('c-int-t').value = ap.interviewTime || '';
    $('c-cons').value = ap.consulate || ''; $('c-conf').value = ap.ds160Confirmation || '';
    $('c-mrv').checked = ap.mrvPaid === 'si'; $('c-notes').value = ap.notes || '';
    paintCitaMeta(ap, a.purgeOn);

    renderReminders(); renderPayments(); renderFamily();
    paintCapture();

    $('answers').innerHTML = answersHtml(d.data, d.capture || {});
    $('d-docs').innerHTML = d.documents.length ? d.documents.map(function (x) {
      var cat = schema.documentCategories.filter(function (c) { return c.value === x.category; })[0];
      return '<div class="doc-row"><div>' + esc(x.originalName) + '<span>' + esc(cat ? cat.label : x.category) + ' · ' + fmtSize(x.size) + ' · ' + fmtDate(x.uploadedAt) + '</span></div>' +
        '<button class="btn btn-sm" data-dl="' + x.id + '">Descargar</button></div>';
    }).join('') : '<div class="empty">Sin documentos</div>';
    var labels = { link_created: 'Solicitud creada', link_regenerated: 'Enlace regenerado', submitted: 'Formulario enviado', document_uploaded: 'Documento subido', document_deleted: 'Documento eliminado',
      status_changed: 'Estado actualizado', privacy_accepted: 'Aviso de privacidad aceptado', appointment_saved: 'Cita actualizada', group_member_added: 'Integrante agregado', purged: 'Datos eliminados' };
    $('d-log').innerHTML = d.log.length ? d.log.map(function (l) {
      return '<div class="log-item"><b>' + esc(labels[l.action] || l.action) + '</b>' + (l.detail ? ' — ' + esc(l.detail) : '') + '<time>' + fmtDate(l.ts) + '</time></div>';
    }).join('') : '<div class="empty">Sin actividad</div>';
    openAcc('link', true);
  }

  // Hoja de captura
  function answersHtml(data, capture) {
    return DS.present(schema.sections, data).map(function (s) {
      function rows(list) {
        return list.map(function (r) {
          if (r.items) {
            return '<div class="ans-list"><div class="ans-label">' + esc(r.label) + '</div>' +
              (r.items.length ? r.items.map(function (it, i) { return '<div class="ans-item"><div class="ans-item-hd">' + esc(r.itemLabel) + ' ' + (i + 1) + '</div>' + rows(it) + '</div>'; }).join('')
                : '<div class="ans-value empty-v" style="text-align:left">— sin respuesta —</div>') + '</div>';
          }
          var cls = r.empty ? (r.optional ? 'opt-v' : 'empty-v') : '';
          return '<div class="ans-row"><div class="ans-label">' + esc(r.label) + '</div><div class="ans-value ' + cls + '"' +
            (r.empty ? '' : ' data-val="' + esc(r.value) + '" title="Tocar para copiar"') + '>' + (r.empty ? (r.optional ? '—' : 'Sin responder') : esc(r.value)) + '</div></div>';
        }).join('');
      }
      var done = !!capture[s.id];
      return '<div class="ans-section' + (done ? ' captured' : '') + '" data-sec="' + s.id + '"><div class="ans-hd"><span>' + esc(s.title) + '</span>' +
        '<span class="ans-tools no-print"><button class="btn btn-sm" data-copysec="' + s.id + '">Copiar</button>' +
        '<label class="check sm"><input type="checkbox" data-cap="' + s.id + '"' + (done ? ' checked' : '') + '> Capturada</label></span></div>' + rows(s.rows) + '</div>';
    }).join('');
  }
  function paintCapture() {
    var n = Object.keys(current.capture || {}).length, t = schema.sections.length;
    $('cap-progress').textContent = n + ' de ' + t + ' secciones capturadas en el portal';
  }
  $('answers').addEventListener('click', function (e) {
    var v = e.target.closest('.ans-value[data-val]');
    if (v) { copy(v.dataset.val, 'Copiado'); return; }
    var cs = e.target.closest('[data-copysec]');
    if (cs) {
      var sec = schema.sections.filter(function (s) { return s.id === cs.dataset.copysec; })[0];
      copy(DS.toText([sec], current.data), 'Sección copiada');
    }
  });
  $('answers').addEventListener('change', function (e) {
    var c = e.target.closest('[data-cap]'); if (!c) return;
    var cap = current.capture || {};
    if (c.checked) cap[c.dataset.cap] = true; else delete cap[c.dataset.cap];
    current.capture = cap;
    c.closest('.ans-section').classList.toggle('captured', c.checked);
    paintCapture();
    api('/admin/applications/' + current.application.id + '/capture', { method: 'PUT', body: { capture: cap } }).catch(function (err) { alert(err.message); });
  });
  onClick('copy-all', function () { copy('SOLICITUD DS-160 — ' + current.application.clientName + '\n' + DS.toText(schema.sections, current.data), 'Todo copiado'); });
  onClick('print-btn', function () { window.print(); });

  each('.tab', function (b) {
    b.addEventListener('click', function () {
      each('.tab', function (x) { x.classList.remove('active'); }); each('.view', function (x) { x.classList.remove('active'); });
      b.classList.add('active'); $(b.dataset.view).classList.add('active');
    });
  });

  // Acceso (usuario y contraseña)
  function paintCred() {
    var a = current.application, c = freshCreds[a.id];
    if (!a.hasAccess) { $('d-cred').innerHTML = '<div class="msg err">Este cliente aún no tiene usuario y contraseña. Pulsa “Restablecer contraseña” para generarlos.</div>'; return; }
    $('d-cred').innerHTML = c ? credBoxHtml(a, c) :
      '<div class="cred-box"><div class="cred-row"><span>Usuario</span><b>' + esc(a.username) + '</b><button class="btn btn-sm" data-copy="' + esc(a.username) + '" data-copy-msg="Usuario copiado">Copiar</button></div>' +
      '<div class="cred-row"><span>Contraseña</span><b>••••••••</b><span class="hint" style="margin:0">solo se ve al crearla o restablecerla</span></div></div>';
  }
  onClick('d-reset', function () {
    var a = current.application;
    if (a.hasAccess && !confirm('Se generará una contraseña nueva y se cerrará la sesión actual de ' + a.clientName + '. ¿Continuar?')) return;
    busy($('d-reset'), 'Generando…', function () { return api('/admin/applications/' + a.id + '/credentials', { method: 'POST' }); })
      .then(function (r) { freshCreds[a.id] = r.credentials; current.application.username = r.credentials.username; current.application.hasAccess = true; paintCred(); openAcc('link', true); toast('Contraseña nueva generada'); })
      .catch(function (err) { alert(err.message); });
  });

  // Enlace
  onClick('d-copy', function () { copy(linkFor(current.application.token), 'Enlace copiado'); });
  onClick('d-wa', function () {
    var a = current.application;
    var c = freshCreds[a.id];
    window.open(waLink(a.hasAccess ? accessText(a.clientName, linkFor(a.token), c || { username: a.username }, !!c)
      : 'Hola ' + a.clientName.split(' ')[0] + ', abre este enlace para llenar tu solicitud de visa: ' + linkFor(a.token)), '_blank', 'noopener');
  });
  onClick('d-remind', function () { var a = current.application; window.open(waLink(reminderText(a, linkFor(a.token))), '_blank', 'noopener'); });
  onClick('d-regen', function () {
    if (!confirm('El enlace actual dejará de funcionar. ¿Generar uno nuevo?')) return;
    api('/admin/applications/' + current.application.id + '/regenerate-link', { method: 'POST' }).then(function () { openDetail(current.application.id); toast('Enlace nuevo generado'); }).catch(function (err) { alert(err.message); });
  });
  onClick('d-delete', function () {
    var a = current.application;
    if (!confirm('¿Eliminar la solicitud de ' + a.clientName + ' con todas sus respuestas y documentos? No se puede deshacer.')) return;
    api('/admin/applications/' + a.id, { method: 'DELETE' }).then(function () { showNav(navName); }).catch(function (err) { alert(err.message); });
  });

  // Estado
  onClick('d-status-save', function () {
    busy($('d-status-save'), 'Guardando…', function () {
      return api('/admin/applications/' + current.application.id + '/status', { method: 'PUT', body: { status: $('d-status').value, note: $('d-status-note').value } });
    }).then(function () { openDetail(current.application.id); refreshAll(); toast('Estado actualizado'); }).catch(function (err) { alert(err.message); });
  });

  // Cita
  function paintCitaMeta(ap, purgeOn) {
    var parts = [];
    if (ap.casDate) parts.push('CAS ' + fmtDay(ap.casDate)); if (ap.interviewDate) parts.push('Entrevista ' + fmtDay(ap.interviewDate));
    pill('d-cita-pill', parts.length ? parts[parts.length - 1] : 'Sin cita', parts.length ? 'good' : '');
    $('c-purge').textContent = purgeOn
      ? '🔒 Por privacidad, las respuestas y documentos se eliminarán automáticamente el ' + fmtDay(purgeOn) + ' (2 meses después de la última cita). Se conservan el nombre, el estado y los cobros.'
      : 'Al guardar la fecha de la cita, los datos personales se eliminarán automáticamente 2 meses después.';
  }
  onClick('c-save', function () {
    var appointment = { casDate: $('c-cas-d').value, casTime: $('c-cas-t').value, interviewDate: $('c-int-d').value, interviewTime: $('c-int-t').value,
      consulate: $('c-cons').value, ds160Confirmation: $('c-conf').value, mrvPaid: $('c-mrv').checked ? 'si' : '', notes: $('c-notes').value };
    busy($('c-save'), 'Guardando…', function () { return api('/admin/applications/' + current.application.id + '/cita', { method: 'PUT', body: { appointment: appointment } }); })
      .then(function (r) { current.appointment = r.appointment; paintCitaMeta(r.appointment, r.purgeOn); $('c-hint').textContent = 'Guardado ✓'; refreshAll(); })
      .catch(function (err) { $('c-hint').textContent = err.message; });
  });

  // Recordatorios
  function saveReminders(list) {
    return api('/admin/applications/' + current.application.id + '/reminders', { method: 'PUT', body: { reminders: list } })
      .then(function (r) { current.reminders = r.reminders; renderReminders(); refreshAll(); });
  }
  function renderReminders() {
    var list = current.reminders || [], pend = list.filter(function (r) { return !r.done; }).length;
    pill('d-rem-pill', pend ? pend + ' pendiente' + (pend > 1 ? 's' : '') : 'Ninguno', pend ? 'warn' : '');
    $('rem-list').innerHTML = list.length ? list.map(function (r) {
      var over = !r.done && r.date && r.date < todayStr();
      return '<div class="trow' + (r.done ? ' done' : '') + '"><button class="tick' + (r.done ? ' on' : '') + '" data-rem-toggle="' + r.id + '" aria-label="Marcar">✓</button>' +
        '<div class="tmain"><b>' + esc(r.text) + '</b><span>' + (r.date ? esc(fmtDay(r.date)) : 'Sin fecha') + (over ? ' · vencido' : '') + '</span></div>' +
        '<button class="btn btn-link" data-rem-del="' + r.id + '">Quitar</button></div>';
    }).join('') : '<div class="hint" style="margin:0 0 6px">Sin recordatorios. Los que agregues aparecerán en “Hoy” cuando llegue su fecha.</div>';
  }
  $('rem-list').addEventListener('click', function (e) {
    var list = (current.reminders || []).slice();
    var t = e.target.closest('[data-rem-toggle]'), d = e.target.closest('[data-rem-del]');
    if (t) { list.forEach(function (r) { if (r.id === t.dataset.remToggle) r.done = !r.done; }); saveReminders(list); }
    if (d) { saveReminders(list.filter(function (r) { return r.id !== d.dataset.remDel; })); }
  });
  onClick('rem-add', function () {
    var text = $('rem-text').value.trim(); if (!text) return;
    var list = (current.reminders || []).concat([{ id: newId(), text: text, date: $('rem-date').value, done: false }]);
    saveReminders(list).then(function () { $('rem-text').value = ''; $('rem-date').value = ''; });
  });

  // Cobros
  function savePayments(p) {
    return api('/admin/applications/' + current.application.id + '/payments', { method: 'PUT', body: { payments: p } })
      .then(function (r) { current.payments = r.payments; renderPayments(); refreshAll(); });
  }
  function renderPayments() {
    var p = current.payments || { price: 0, items: [] };
    var paid = p.items.reduce(function (s, i) { return s + i.amount; }, 0), due = Math.max(0, (p.price || 0) - paid);
    $('pay-price').value = p.price || '';
    pill('d-pay-pill', p.price ? (due > 0 ? 'Debe ' + money(due) : 'Liquidado') : 'Sin precio', p.price ? (due > 0 ? 'warn' : 'good') : '');
    $('pay-list').innerHTML = p.items.length ? p.items.map(function (i) {
      return '<div class="trow"><span class="ticon">💵</span><div class="tmain"><b>' + money(i.amount) + '</b><span>' + esc(fmtDay(i.date)) + (i.method ? ' · ' + esc(i.method) : '') + '</span></div><button class="btn btn-link" data-pay-del="' + i.id + '">Quitar</button></div>';
    }).join('') : '';
    $('pay-hint').textContent = p.price ? 'Precio ' + money(p.price) + ' · Pagado ' + money(paid) + ' · Saldo ' + money(due) : 'Escribe el precio del servicio para ver el saldo.';
  }
  $('pay-price').addEventListener('change', function () {
    var p = current.payments || { price: 0, items: [] };
    savePayments({ price: parseFloat($('pay-price').value) || 0, items: p.items });
  });
  onClick('pay-add', function () {
    var amt = parseFloat($('pay-amount').value); if (!(amt > 0)) return;
    var p = current.payments || { price: 0, items: [] };
    var price = parseFloat($('pay-price').value) || p.price || 0;
    savePayments({ price: price, items: p.items.concat([{ id: newId(), amount: amt, date: todayStr(), method: $('pay-method').value }]) }).then(function () { $('pay-amount').value = ''; toast('Pago registrado'); });
  });
  $('pay-list').addEventListener('click', function (e) {
    var d = e.target.closest('[data-pay-del]'); if (!d) return;
    var p = current.payments; savePayments({ price: p.price, items: p.items.filter(function (i) { return i.id !== d.dataset.payDel; }) });
  });

  // Familia / grupo
  function renderFamily() {
    var m = current.members || [];
    pill('d-fam-pill', m.length > 1 ? m.length + ' personas' : 'Solo', m.length > 1 ? 'good' : '');
    $('fam-list').innerHTML = m.length > 1 ? m.map(function (x) {
      return '<div class="trow' + (x.id === current.application.id ? ' me' : '') + '" data-open="' + x.id + '"><span class="ticon">👤</span><div class="tmain"><b>' + esc(x.clientName) + (x.id === current.application.id ? ' (esta solicitud)' : '') + '</b><span>' + esc(statusOpt(x.status).label) + (x.submittedAt ? ' · enviado' : '') + '</span></div></div>';
    }).join('') : '';
    $('fam-copy').innerHTML = schema.familyCopy.map(function (g) {
      return '<label class="check"><input type="checkbox" data-fcopy="' + g.id + '"' + (g.id === 'padres' ? '' : ' checked') + '> Copiar: ' + esc(g.label) + '</label>';
    }).join('');
  }
  onClick('fam-add', function () {
    var name = $('fam-name').value.trim();
    if (!name) { msg('fam-msg', 'Escribe el nombre del nuevo integrante'); return; }
    var copyIds = []; each('[data-fcopy]', function (c) { if (c.checked) copyIds.push(c.dataset.fcopy); });
    busy($('fam-add'), 'Creando…', function () { return api('/admin/applications/' + current.application.id + '/duplicate', { method: 'POST', body: { name: name, copy: copyIds } }); })
      .then(function (r) { freshCreds[r.application.id] = r.credentials; $('fam-name').value = ''; refreshAll(); return openDetail(r.application.id).then(function () { openAcc('link', true); toast('Solicitud creada: copia su enlace aquí arriba'); }); })
      .catch(function (err) { msg('fam-msg', err.message); });
  });

  // Documentos
  $('d-docs').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-dl]') : null; if (!b) return;
    fetch(API + '/admin/applications/' + current.application.id + '/documents/' + b.dataset.dl + '/download', { headers: { 'X-Auth-Token': token } })
      .then(function (res) {
        if (!res.ok) throw new Error('No se pudo descargar');
        return res.blob().then(function (blob) {
          var cd = res.headers.get('Content-Disposition') || '';
          var m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/.exec(cd);
          var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = m ? decodeURIComponent(m[1] || m[2]) : 'documento';
          document.body.appendChild(a); a.click(); a.remove();
        });
      }).catch(function (err) { alert(err.message); });
  });

  // ── Arranque ────────────────────────────────────────────────────────────
  function hideLoader() { $('boot-loader').classList.add('hide'); }
  function showAuth() { hideLoader(); $('app-screen').classList.add('hidden'); $('auth-screen').classList.remove('hidden'); }
  function boot() {
    if (!token) { showAuth(); return; }
    Promise.all([schema ? Promise.resolve(schema) : api('/schema'), api('/me')]).then(function (r) {
      schema = r[0];
      $('who-name').textContent = r[1].user.name;
      $('d-status').innerHTML = schema.statusOptions.map(function (s) { return '<option value="' + s.value + '">' + esc(s.label) + '</option>'; }).join('');
      $('filter-status').innerHTML = '<option value="">Todos los estados</option><option value="__new">Nuevos sin revisar</option>' +
        schema.statusOptions.map(function (x) { return '<option value="' + x.value + '">' + esc(x.label) + '</option>'; }).join('');
      $('auth-screen').classList.add('hidden'); $('app-screen').classList.remove('hidden');
      showNav('apps');
      hideLoader();
    }).catch(function (err) {
      if (err && err.status === 401) clearToken();
      showAuth();
    });
  }
  // Refresca avisos al volver a la app y cada minuto.
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && token && schema) refreshAll(); });
  setInterval(function () { if (document.visibilityState === 'visible' && token && schema && navName === 'apps' && $('detail-area').classList.contains('hidden')) refreshAll(); }, 60000);
  boot();
})();

const app = {
  apiBase: '/api',
  db: null,
  user: null,
  catalogs: null,
  isOffline: !navigator.onLine,
  pendingCount: 0,
  charts: {},
  deferredPrompt: null,
  eventSource: null,
  selectedRecordId: null,
  dashboardData: null,
  activeModuleKey: 'apicultura',
  activePresetKey: '',
  moduleDefinitions: {},
  storeNames: {
    pending: 'pending_records',
    cache: 'cache'
  },
  els: {},

  async init() {
    this.mapEls();
    this.moduleDefinitions = this.buildModuleDefinitions();
    this.bindEvents();
    await this.initDB();
    await this.registerServiceWorker();
    this.updateConnectionUi();
    this.warnIfOpenedOutsideBackend();
    await this.restoreSession();
    await this.refreshPendingState();
  },

  mapEls() {
    const pick = id => document.getElementById(id);
    this.els = {
      cardLogin: pick('cardLogin'),
      cardApp: pick('cardApp'),
      loginUser: pick('loginUser'),
      loginPass: pick('loginPass'),
      loginMsg: pick('loginMsg'),
      btnLogin: pick('btnLogin'),
      btnLogout: pick('btnLogout'),
      btnInstall: pick('btnInstall'),
      btnGuardar: pick('btnGuardar'),
      btnLimpiar: pick('btnLimpiar'),
      btnSyncNow: pick('btnSyncNow'),
      btnRefreshDashboard: pick('btnRefreshDashboard'),
      btnRefreshRecords: pick('btnRefreshRecords'),
      statusPill: pick('statusPill'),
      registroForm: pick('registroForm'),
      eventDate: pick('eventDate'),
      yearRef: pick('yearRef'),
      processFamily: pick('processFamily'),
      evidenceType: pick('evidenceType'),
      community: pick('community'),
      actorClave: pick('actorClave'),
      moduleKey: pick('moduleKey'),
      moduleLabel: pick('moduleLabel'),
      presetKey: pick('presetKey'),
      presetLabel: pick('presetLabel'),
      presetSelect: pick('presetSelect'),
      moduleSummary: pick('moduleSummary'),
      presetSummary: pick('presetSummary'),
      dynamicFields: pick('dynamicFields'),
      lineName: pick('lineName'),
      expedienteCode: pick('expedienteCode'),
      recordTitle: pick('recordTitle'),
      recordSummary: pick('recordSummary'),
      recordNotes: pick('recordNotes'),
      recordFiles: pick('recordFiles'),
      fileList: pick('fileList'),
      formMsgContainer: pick('formMsgContainer'),
      lblResponsable: pick('lblResponsable'),
      modeLabel: pick('modeLabel'),
      pendingCount: pick('pendingCount'),
      pendingList: pick('pendingList'),
      lastSeedAt: pick('lastSeedAt'),
      tabCaptura: pick('tabCaptura'),
      tabDashboard: pick('tabDashboard'),
      tabRegistros: pick('tabRegistros'),
      viewCaptura: pick('viewCaptura'),
      viewDashboard: pick('viewDashboard'),
      viewRegistros: pick('viewRegistros'),
      dashboardSearch: pick('dashboardSearch'),
      dashboardProcess: pick('dashboardProcess'),
      dashboardCommunity: pick('dashboardCommunity'),
      dashboardYear: pick('dashboardYear'),
      kpiTotal: pick('kpiTotal'),
      kpiThisMonth: pick('kpiThisMonth'),
      kpiCommunities: pick('kpiCommunities'),
      kpiAttachments: pick('kpiAttachments'),
      communitySummary: pick('communitySummary'),
      recentSummary: pick('recentSummary'),
      recordsSearch: pick('recordsSearch'),
      recordsProcess: pick('recordsProcess'),
      recordsCommunity: pick('recordsCommunity'),
      recordsYear: pick('recordsYear'),
      recordsBody: pick('recordsBody'),
      recordDetail: pick('recordDetail'),
      toastHost: pick('toastHost'),
      moduleCards: Array.from(document.querySelectorAll('[data-module-key]'))
    };
  },

  bindEvents() {
    this.els.btnLogin.addEventListener('click', () => this.login());
    this.els.btnLogout.addEventListener('click', () => this.logout());
    this.els.btnLimpiar.addEventListener('click', () => this.resetForm());
    this.els.btnSyncNow.addEventListener('click', () => this.syncPending());
    this.els.btnRefreshDashboard.addEventListener('click', () => this.loadDashboard());
    this.els.btnRefreshRecords.addEventListener('click', () => this.loadRecords());
    this.els.registroForm.addEventListener('submit', event => {
      event.preventDefault();
      this.saveRecord();
    });
    this.els.processFamily.addEventListener('change', () => this.handleProcessFamilyChange());
    this.els.presetSelect.addEventListener('change', () => this.handlePresetChange());
    this.els.recordFiles.addEventListener('change', () => this.renderSelectedFiles());
    this.els.tabCaptura.addEventListener('click', () => this.setView('captura'));
    this.els.tabDashboard.addEventListener('click', () => this.setView('dashboard'));
    this.els.tabRegistros.addEventListener('click', () => this.setView('registros'));
    this.els.moduleCards.forEach(card => {
      card.addEventListener('click', () => this.setActiveModule(card.dataset.moduleKey, { forceDefaults: true }));
    });

    ['dashboardSearch', 'dashboardProcess', 'dashboardCommunity', 'dashboardYear'].forEach(id => {
      this.els[id].addEventListener('change', () => this.loadDashboard());
    });
    ['recordsSearch', 'recordsProcess', 'recordsCommunity', 'recordsYear'].forEach(id => {
      this.els[id].addEventListener('change', () => this.loadRecords());
    });

    this.els.loginPass.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.login();
      }
    });

    window.addEventListener('online', async () => {
      this.isOffline = false;
      this.updateConnectionUi();
      await this.syncPending();
      if (this.user) {
        await this.loadDashboard();
        await this.loadRecords();
        this.connectEventStream();
      }
    });

    window.addEventListener('offline', () => {
      this.isOffline = true;
      this.updateConnectionUi();
      this.closeEventStream();
    });

    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      this.deferredPrompt = event;
      this.els.btnInstall.hidden = false;
    });

    this.els.btnInstall.addEventListener('click', async () => {
      if (!this.deferredPrompt) {
        return;
      }
      await this.deferredPrompt.prompt();
      this.deferredPrompt = null;
      this.els.btnInstall.hidden = true;
    });
  },

  initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('RPI_MONITOR_DB', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeNames.pending)) {
          db.createObjectStore(this.storeNames.pending, { keyPath: 'local_id' });
        }
        if (!db.objectStoreNames.contains(this.storeNames.cache)) {
          db.createObjectStore(this.storeNames.cache, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('local_records')) {
          db.createObjectStore('local_records', { keyPath: 'local_id' });
        }
      };
    });
  },

  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      return;
    }
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (error) {
      console.warn('No se pudo registrar el service worker', error);
    }
  },

  dbPut(storeName, value) {
    return new Promise(resolve => {
      if (!this.db) {
        resolve();
        return;
      }
      const tx = this.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },

  dbGet(storeName, key) {
    return new Promise(resolve => {
      if (!this.db) {
        resolve(null);
        return;
      }
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  },

  dbGetAll(storeName) {
    return new Promise(resolve => {
      if (!this.db) {
        resolve([]);
        return;
      }
      const tx = this.db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    });
  },

  dbDelete(storeName, key) {
    return new Promise(resolve => {
      if (!this.db) {
        resolve();
        return;
      }
      const tx = this.db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  },

  cacheKey(name, filters = {}) {
    return `${name}:${JSON.stringify(filters)}`;
  },

  async cachePut(key, value) {
    await this.dbPut(this.storeNames.cache, { key, value, stored_at: new Date().toISOString() });
  },

  async cacheGet(key) {
    const row = await this.dbGet(this.storeNames.cache, key);
    return row ? row.value : null;
  },

  async restoreSession() {
    if (this.isStaticPreviewHost()) {
      const cachedBootstrap = await this.cacheGet('bootstrap');
      if (cachedBootstrap && cachedBootstrap.user) {
        this.user = cachedBootstrap.user;
        this.catalogs = cachedBootstrap.catalogs || this.standaloneCatalogs();
        this.enterApp(cachedBootstrap.settings || {});
        await this.loadDashboard(true);
        await this.loadRecords(true);
      }
      return;
    }

    if (!this.isOffline) {
      try {
        const data = await this.apiJson('/bootstrap');
        this.user = data.user;
        this.catalogs = data.catalogs;
        await this.cachePut('bootstrap', data);
        this.enterApp(data.settings);
        this.connectEventStream();
        await this.loadDashboard();
        await this.loadRecords();
        return;
      } catch (error) {
        console.warn('No se pudo restaurar sesion online', error);
      }
    }

    const cachedBootstrap = await this.cacheGet('bootstrap');
    if (cachedBootstrap && cachedBootstrap.user) {
      this.user = cachedBootstrap.user;
      this.catalogs = cachedBootstrap.catalogs;
      this.enterApp(cachedBootstrap.settings || {});
      await this.loadDashboard(true);
      await this.loadRecords(true);
      this.renderMessage('loginMsg', 'Modo sin conexion habilitado con cache local.', 'warning');
    }
  },

  // Credenciales aceptadas en modo standalone (GitHub Pages)
  standaloneCredentials: [
    { username: 'admin', password: 'rpi2026', display_name: 'Administrador RPI', role: 'admin' },
    { username: 'laura', password: 'renta2026', display_name: 'Laura', role: 'tecnico' }
  ],

  standaloneCatalogs() {
    const modules = this.moduleDefinitions || {};
    const families = Object.values(modules).map(m => m.processFamily).filter(Boolean);
    const evidenceTypes = [...new Set(Object.values(modules).flatMap(m => m.evidenceTypes || []))];
    return {
      processFamilies: [...new Set(families)],
      evidenceTypes,
      communities: [
        'Hugua Guasu', 'Takuarita', 'Arroyo Guasu', 'Yryapy', 'Ko\'e Poti',
        'Vy\'a Renda', 'Santa Rosa', 'San Carlos', 'Potrerito',
        'Yvy Pyta', 'Mba\'epu', 'Sawhoyamaxa', 'Yakye Axa'
      ],
      actors: ['Tecnico apicultura', 'Tecnico agricultura', 'Tecnico comercializacion', 'Tecnico produccion animal', 'Lider comunitario', 'Productor/a'],
      years: ['2024', '2025', '2026']
    };
  },

  async login() {
    const username = this.els.loginUser.value.trim();
    const password = this.els.loginPass.value.trim();
    if (!username || !password) {
      this.renderMessage('loginMsg', 'Completa usuario y contrasena.', 'error');
      return;
    }

    this.els.btnLogin.disabled = true;
    this.els.btnLogin.querySelector('span').textContent = 'Verificando...';

    // Modo standalone para GitHub Pages
    if (this.isStaticPreviewHost()) {
      await new Promise(r => setTimeout(r, 600));
      const match = this.standaloneCredentials.find(c => c.username === username && c.password === password);
      if (!match) {
        this.renderMessage('loginMsg', 'Usuario o contrasena incorrectos.', 'error');
        this.els.btnLogin.disabled = false;
        this.els.btnLogin.querySelector('span').textContent = 'Ingresar Seguro';
        return;
      }
      this.user = { username: match.username, display_name: match.display_name, role: match.role };
      this.catalogs = this.standaloneCatalogs();
      const bootstrap = { user: this.user, catalogs: this.catalogs, settings: { lastSeedAt: new Date().toISOString() } };
      await this.cachePut('bootstrap', bootstrap);
      this.renderMessage('loginMsg', '', 'info');
      this.enterApp(bootstrap.settings);
      await this.loadDashboard(true);
      await this.loadRecords(true);
      this.toast('Sesion iniciada en modo local.', 'success');
      this.els.btnLogin.disabled = false;
      this.els.btnLogin.querySelector('span').textContent = 'Ingresar Seguro';
      return;
    }

    if (this.isOffline) {
      this.renderMessage('loginMsg', 'Necesitas conectividad al menos una vez para iniciar sesion.', 'warning');
      this.els.btnLogin.disabled = false;
      this.els.btnLogin.querySelector('span').textContent = 'Ingresar Seguro';
      return;
    }

    try {
      const { data } = await this.fetchJson(`${this.apiBase}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password })
      });
      this.renderMessage('loginMsg', '', 'info');
      await this.restoreSession();
      this.toast('Sesion iniciada correctamente.', 'success');
    } catch (error) {
      this.renderMessage('loginMsg', error.message || 'Error de autenticacion', 'error');
    } finally {
      this.els.btnLogin.disabled = false;
      this.els.btnLogin.querySelector('span').textContent = 'Ingresar Seguro';
    }
  },

  async logout() {
    try {
      await fetch(`${this.apiBase}/logout`, { method: 'POST', credentials: 'same-origin' });
    } catch (error) {
      console.warn('No se pudo cerrar sesion en servidor', error);
    }
    this.user = null;
    this.catalogs = null;
    this.closeEventStream();
    this.els.cardApp.hidden = true;
    this.els.cardLogin.hidden = false;
    this.els.btnLogout.hidden = true;
    this.els.loginPass.value = '';
    this.toast('Sesion cerrada.', 'info');
  },

  enterApp(settings = {}) {
    this.els.cardLogin.hidden = true;
    this.els.cardApp.hidden = false;
    this.els.btnLogout.hidden = false;
    this.els.lblResponsable.textContent = this.user?.display_name || this.user?.username || '-';
    this.els.eventDate.value = new Date().toISOString().split('T')[0];
    this.els.yearRef.value = new Date().getFullYear();
    this.els.lastSeedAt.textContent = settings.lastSeedAt ? settings.lastSeedAt.substring(0, 10) : '-';
    this.populateCatalogs();
    this.setView('captura');
  },

  populateSelect(selectEl, values, placeholder, includeAll = false) {
    if (!selectEl) {
      return;
    }
    const firstValue = includeAll ? '' : '';
    const firstLabel = includeAll ? 'Todos' : placeholder;
    const options = [`<option value="${this.escapeHtml(firstValue)}">${this.escapeHtml(firstLabel)}</option>`];
    (values || []).forEach(value => {
      options.push(`<option value="${this.escapeHtml(value)}">${this.escapeHtml(value)}</option>`);
    });
    selectEl.innerHTML = options.join('');
  },

  buildModuleDefinitions() {
    return {
      apicultura: {
        label: 'Apicultura',
        processFamily: 'apicultura',
        lineName: 'Apicultura',
        titlePlaceholder: 'Registro de apiario o cosecha',
        evidenceTypes: ['registro_cosecha', 'registro_produccion', 'informe_tecnico', 'planilla_firma'],
        summary: 'Apiarios, cosecha de miel, produccion para consumo y renta. Diferenciado por codigo de apiario.',
        presets: [
          { key: 'registro_apiario', label: 'Registro de apiario', lineName: 'Apicultura registro', titlePrefix: 'Registro de apiario', evidenceType: 'registro_produccion', summary: 'Estado productivo del apiario, cantidad de colmenas y condicion general.' },
          { key: 'cosecha_miel', label: 'Cosecha de miel', lineName: 'Apicultura cosecha', titlePrefix: 'Cosecha de miel', evidenceType: 'registro_cosecha', summary: 'Cantidad cosechada, cuanto para consumo propio y cuanto para renta/venta.' },
          { key: 'comercializacion_miel', label: 'Comercializacion de miel', lineName: 'Apicultura comercializacion', titlePrefix: 'Venta de miel', evidenceType: 'registro_produccion', summary: 'Registro de venta de miel: cantidad, precio y destino.' },
          { key: 'mantenimiento_apiario', label: 'Mantenimiento de apiario', lineName: 'Apicultura mantenimiento', titlePrefix: 'Mantenimiento de apiario', evidenceType: 'informe_tecnico', summary: 'Revision, limpieza, tratamiento sanitario y mantenimiento general.' }
        ],
        fields: [
          { name: 'codigo_apiario', label: 'Codigo de apiario', type: 'text', placeholder: 'API-001' },
          { name: 'estado_productivo', label: 'Estado productivo', type: 'select', options: ['Inicio', 'En ejecucion', 'Cosecha'] },
          { name: 'cantidad_cosecha_kg', label: 'Cantidad cosechada (kg)', type: 'number', min: '0' },
          { name: 'cantidad_consumo_kg', label: 'Consumo propio (kg)', type: 'number', min: '0' },
          { name: 'cantidad_renta_kg', label: 'Para renta/venta (kg)', type: 'number', min: '0' },
          { name: 'precio_venta', label: 'Precio de venta (Gs)', type: 'number', min: '0' },
          { name: 'componente', label: 'Componente', type: 'select', options: ['Industrial', 'Indigena'] }
        ]
      },
      agricultura: {
        label: 'Agricultura',
        processFamily: 'agricultura',
        lineName: 'Agricultura',
        titlePlaceholder: 'Registro de produccion agricola',
        evidenceTypes: ['registro_produccion', 'informe_tecnico', 'planilla_firma', 'relevamiento'],
        summary: 'Produccion agricola por tipo de huerta, rubros de cultivo, consumo y renta.',
        presets: [
          { key: 'huerta_escolar', label: 'Huerta Escolar', lineName: 'Agricultura huerta escolar', titlePrefix: 'Huerta escolar', evidenceType: 'registro_produccion', summary: 'Huerta en centro educativo: rubros, superficie y produccion.' },
          { key: 'huerta_comercial', label: 'Huerta Comercial (Hugua Guazu)', lineName: 'Agricultura huerta comercial', titlePrefix: 'Huerta comercial', evidenceType: 'registro_produccion', summary: 'Huerta comercial de Hugua Guazu: volumen de produccion y destino.' },
          { key: 'huerta_comunitaria', label: 'Huerta Comunitaria (Vy\'a Renda)', lineName: 'Agricultura huerta comunitaria', titlePrefix: 'Huerta comunitaria', evidenceType: 'registro_produccion', summary: 'Huerta comunitaria Vy\'a Renda: produccion colectiva y distribucion.' },
          { key: 'huerta_familiar', label: 'Huerta Familiar', lineName: 'Agricultura huerta familiar', titlePrefix: 'Huerta familiar', evidenceType: 'registro_produccion', summary: 'Huerta a nivel familiar: autoconsumo y excedente para renta.' }
        ],
        fields: [
          { name: 'tipo_huerta', label: 'Tipo de huerta', type: 'select', options: ['Escolar', 'Comercial', 'Comunitaria', 'Familiar'] },
          { name: 'rubro', label: 'Rubro/cultivo', type: 'text', placeholder: 'Mandioca, poroto, maiz, verduras...' },
          { name: 'superficie_ha', label: 'Superficie (ha)', type: 'number', min: '0' },
          { name: 'cantidad_produccion_kg', label: 'Produccion (kg)', type: 'number', min: '0' },
          { name: 'cantidad_consumo_kg', label: 'Consumo propio (kg)', type: 'number', min: '0' },
          { name: 'cantidad_renta_kg', label: 'Para renta/venta (kg)', type: 'number', min: '0' },
          { name: 'componente', label: 'Componente', type: 'select', options: ['Industrial', 'Indigena'] }
        ]
      },
      ganaderia: {
        label: 'Ganaderia',
        processFamily: 'ganaderia',
        lineName: 'Ganaderia',
        titlePlaceholder: 'Registro de produccion animal',
        evidenceTypes: ['registro_produccion', 'informe_tecnico', 'planilla_firma'],
        summary: 'Produccion animal, avicultura y forraje. Cantidad de cabezas, destino y componente.',
        presets: [
          { key: 'produccion_animal', label: 'Produccion animal', lineName: 'Ganaderia produccion', titlePrefix: 'Produccion animal', evidenceType: 'registro_produccion', summary: 'Registro de produccion bovina, porcina o caprina.' },
          { key: 'avicultura', label: 'Avicultura', lineName: 'Ganaderia avicultura', titlePrefix: 'Avicultura', evidenceType: 'registro_produccion', summary: 'Cria de aves: cantidad, produccion de huevos y destino.' },
          { key: 'produccion_forraje', label: 'Produccion de forraje', lineName: 'Ganaderia forraje', titlePrefix: 'Produccion de forraje', evidenceType: 'informe_tecnico', summary: 'Produccion de forraje para alimentacion animal.' }
        ],
        fields: [
          { name: 'tipo_produccion', label: 'Tipo de produccion', type: 'select', options: ['Bovina', 'Avicola', 'Porcina', 'Caprina', 'Forraje'] },
          { name: 'cantidad_cabezas', label: 'Cantidad de cabezas/aves', type: 'number', min: '0' },
          { name: 'produccion_forraje_kg', label: 'Produccion de forraje (kg)', type: 'number', min: '0' },
          { name: 'destino', label: 'Destino', type: 'select', options: ['Consumo', 'Renta', 'Mixto'] },
          { name: 'componente', label: 'Componente', type: 'select', options: ['Industrial', 'Indigena'] }
        ]
      },
      comercializacion: {
        label: 'Comercializacion',
        processFamily: 'comercializacion',
        lineName: 'Comercializacion',
        titlePlaceholder: 'Registro de venta o comercializacion',
        evidenceTypes: ['registro_venta', 'informe_tecnico', 'facturas'],
        summary: 'Ventas, ferias, mercados e ingresos por renta. Canal de venta y monto.',
        presets: [
          { key: 'venta_directa', label: 'Venta directa', lineName: 'Comercializacion directa', titlePrefix: 'Venta directa', evidenceType: 'registro_venta', summary: 'Venta directa al consumidor sin intermediario.' },
          { key: 'feria_local', label: 'Feria local', lineName: 'Comercializacion feria', titlePrefix: 'Feria local', evidenceType: 'registro_venta', summary: 'Participacion en feria local o regional.' },
          { key: 'intermediario', label: 'Venta a intermediario', lineName: 'Comercializacion intermediario', titlePrefix: 'Venta a intermediario', evidenceType: 'facturas', summary: 'Venta a acopiador, intermediario o cooperativa.' }
        ],
        fields: [
          { name: 'rubro_comercializado', label: 'Rubro comercializado', type: 'text', placeholder: 'Miel, mandioca, huevos, carne...' },
          { name: 'cantidad_vendida_kg', label: 'Cantidad vendida (kg)', type: 'number', min: '0' },
          { name: 'ingreso_total_gs', label: 'Ingreso total (Gs)', type: 'number', min: '0' },
          { name: 'canal_venta', label: 'Canal de venta', type: 'select', options: ['Directo', 'Feria', 'Intermediario', 'Cooperativa'] },
          { name: 'comprador', label: 'Comprador/destino', type: 'text', placeholder: 'Nombre o lugar de venta' },
          { name: 'componente', label: 'Componente', type: 'select', options: ['Industrial', 'Indigena'] }
        ]
      },
      capacitacion: {
        label: 'Capacitaciones',
        processFamily: 'capacitacion',
        lineName: 'Capacitacion',
        titlePlaceholder: 'Visita tecnica o taller',
        evidenceTypes: ['planilla_firma', 'informe_tecnico', 'registros', 'audiovisuales'],
        summary: 'Visitas tecnicas de campo, talleres grupales, asistencia individual y formacion.',
        presets: [
          { key: 'visita_tecnica', label: 'Visita tecnica de campo', lineName: 'Capacitacion visita', titlePrefix: 'Visita tecnica', evidenceType: 'informe_tecnico', summary: 'Visita de tecnico a finca, apiario o comunidad.' },
          { key: 'taller_grupal', label: 'Taller grupal', lineName: 'Capacitacion taller', titlePrefix: 'Taller grupal', evidenceType: 'planilla_firma', summary: 'Taller con grupo de productores, teoria y practica.' },
          { key: 'asistencia_individual', label: 'Asistencia tecnica individual', lineName: 'Capacitacion individual', titlePrefix: 'Asistencia tecnica', evidenceType: 'informe_tecnico', summary: 'Atencion personalizada a un productor o familia.' }
        ],
        fields: [
          { name: 'tipo_actividad', label: 'Tipo de actividad', type: 'select', options: ['Visita tecnica', 'Taller', 'Capacitacion', 'Asistencia individual', 'Demostracion'] },
          { name: 'tema', label: 'Tema', type: 'text', placeholder: 'Manejo de colmenas, riego, poda...' },
          { name: 'participantes_total', label: 'Total participantes', type: 'number', min: '0' },
          { name: 'tecnico_responsable', label: 'Tecnico responsable', type: 'text', placeholder: 'Nombre del tecnico' },
          { name: 'resultado', label: 'Resultado y seguimiento', type: 'textarea', full: true, placeholder: 'Que se logro y que falta hacer.' }
        ]
      },
      entregas: {
        label: 'Entregas y Compromisos',
        processFamily: 'entregas_compromisos',
        lineName: 'Entregas',
        titlePlaceholder: 'Entrega de insumos o compromiso',
        evidenceTypes: ['planilla_firma', 'acta_entrega', 'registros', 'facturas'],
        summary: 'Entregas de insumos, herramientas, semillas y compromisos de seguimiento.',
        presets: [
          { key: 'entrega_insumos', label: 'Entrega de insumos', lineName: 'Entregas insumos', titlePrefix: 'Entrega de insumos', evidenceType: 'acta_entrega', summary: 'Entrega de semillas, plantines, agroquimicos u otros insumos.' },
          { key: 'entrega_herramientas', label: 'Entrega de herramientas', lineName: 'Entregas herramientas', titlePrefix: 'Entrega de herramientas', evidenceType: 'acta_entrega', summary: 'Entrega de herramientas, equipamiento o materiales.' },
          { key: 'compromiso_seguimiento', label: 'Compromiso de seguimiento', lineName: 'Entregas compromisos', titlePrefix: 'Compromiso de seguimiento', evidenceType: 'registros', summary: 'Acuerdos, compromisos asumidos y fecha de seguimiento.' }
        ],
        fields: [
          { name: 'tipo_entrega', label: 'Tipo de entrega', type: 'select', options: ['Insumos', 'Herramientas', 'Semillas', 'Plantines', 'Animales', 'Equipamiento'] },
          { name: 'cantidad', label: 'Cantidad entregada', type: 'number', min: '0' },
          { name: 'unidad', label: 'Unidad', type: 'select', options: ['Unidades', 'Kg', 'Litros', 'Paquetes', 'Cajas'] },
          { name: 'beneficiarios_total', label: 'Total beneficiarios', type: 'number', min: '0' },
          { name: 'compromiso', label: 'Compromiso asumido', type: 'textarea', full: true, placeholder: 'Que se comprometio, quien y para cuando.' },
          { name: 'fecha_seguimiento', label: 'Proxima fecha de seguimiento', type: 'date' }
        ]
      }
    };
  },

  resolveModuleKeyFromProcess(processFamily) {
    const match = Object.entries(this.moduleDefinitions).find(([, config]) => config.processFamily === processFamily);
    return match ? match[0] : 'apicultura';
  },

  handleProcessFamilyChange() {
    const processFamily = this.els.processFamily.value;
    const moduleKey = this.resolveModuleKeyFromProcess(processFamily);
    this.setActiveModule(moduleKey, { syncProcess: false, preserveEvidence: true });
  },

  handlePresetChange() {
    this.applyPreset(this.els.presetSelect.value, { forceDefaults: true, preserveEvidence: false });
  },

  setActiveModule(moduleKey, options = {}) {
    const config = this.moduleDefinitions[moduleKey] || this.moduleDefinitions.apicultura;
    const {
      syncProcess = true,
      preserveEvidence = false,
      forceDefaults = false
    } = options;

    this.activeModuleKey = moduleKey in this.moduleDefinitions ? moduleKey : 'apicultura';
    this.els.moduleCards.forEach(card => {
      card.classList.toggle('active', card.dataset.moduleKey === this.activeModuleKey);
      if (card.dataset.moduleKey === this.activeModuleKey && card.dataset.color) {
        document.documentElement.style.setProperty('--active-mod', card.dataset.color);
      }
    });

    this.els.moduleKey.value = this.activeModuleKey;
    this.els.moduleLabel.value = config.label;
    this.els.moduleSummary.innerHTML = `<strong>${this.escapeHtml(config.label)}</strong><div>${this.escapeHtml(config.summary)}</div>`;

    if (syncProcess) {
      this.els.processFamily.value = config.processFamily;
    }
    this.populatePresets(config);
    const presetKey = this.resolveInitialPresetKey(config);
    this.applyPreset(presetKey, { forceDefaults, preserveEvidence, fromModuleSwitch: true });
  },

  resolveInitialPresetKey(config) {
    const presets = config.presets || [];
    if (!presets.length) {
      return '';
    }
    const current = this.els.presetKey.value;
    if (current && presets.some(preset => preset.key === current)) {
      return current;
    }
    return presets[0].key;
  },

  populatePresets(config) {
    const presets = config.presets || [];
    const options = presets.map(preset => `<option value="${this.escapeHtml(preset.key)}">${this.escapeHtml(preset.label)}</option>`);
    this.els.presetSelect.innerHTML = options.join('');
    if (!presets.length) {
      this.els.presetSummary.innerHTML = '';
    }
  },

  getPresetConfig(moduleConfig, presetKey) {
    return (moduleConfig.presets || []).find(preset => preset.key === presetKey) || null;
  },

  applyPreset(presetKey, options = {}) {
    const moduleConfig = this.moduleDefinitions[this.activeModuleKey] || this.moduleDefinitions.apicultura;
    const preset = this.getPresetConfig(moduleConfig, presetKey) || this.getPresetConfig(moduleConfig, this.resolveInitialPresetKey(moduleConfig));
    const {
      forceDefaults = false,
      preserveEvidence = false
    } = options;

    if (preset) {
      this.activePresetKey = preset.key;
      this.els.presetSelect.value = preset.key;
      this.els.presetKey.value = preset.key;
      this.els.presetLabel.value = preset.label;
      this.els.presetSummary.innerHTML = `<strong>${this.escapeHtml(preset.label)}</strong><div>${this.escapeHtml(preset.summary || moduleConfig.summary)}</div>`;
    } else {
      this.activePresetKey = '';
      this.els.presetKey.value = '';
      this.els.presetLabel.value = '';
      this.els.presetSummary.innerHTML = '';
    }

    this.syncEvidenceOptions(moduleConfig, preset, preserveEvidence);
    this.renderDynamicFields(moduleConfig, preset);

    if (forceDefaults || !this.els.lineName.value) {
      this.els.lineName.value = (preset && preset.lineName) || moduleConfig.lineName;
    }
    this.els.recordTitle.placeholder = (preset && preset.titlePrefix) || moduleConfig.titlePlaceholder;
    if ((forceDefaults || !this.els.recordTitle.value) && preset && preset.titlePrefix) {
      this.els.recordTitle.value = '';
    }
  },

  syncEvidenceOptions(config, preset, preserveSelection = false) {
    const currentValue = this.els.evidenceType.value;
    const combined = [
      ...(preset && preset.evidenceType ? [preset.evidenceType] : []),
      ...(config.evidenceTypes || []),
      ...((this.catalogs && this.catalogs.evidenceTypes) || [])
    ];
    const unique = Array.from(new Set(combined.filter(Boolean)));
    this.populateSelect(this.els.evidenceType, unique, 'Selecciona un tipo');
    if (preserveSelection && unique.includes(currentValue)) {
      this.els.evidenceType.value = currentValue;
      return;
    }
    if (preset && preset.evidenceType) {
      this.els.evidenceType.value = preset.evidenceType;
      return;
    }
    if (config.evidenceTypes && config.evidenceTypes.length > 0) {
      this.els.evidenceType.value = config.evidenceTypes[0];
    }
  },

  renderDynamicFields(config, preset) {
    const fields = [...(config.fields || []), ...((preset && preset.fields) || [])];
    if (!fields.length) {
      this.els.dynamicFields.innerHTML = '';
      this.els.dynamicFields.classList.add('hidden');
      return;
    }
    this.els.dynamicFields.classList.remove('hidden');
    this.els.dynamicFields.innerHTML = fields.map(field => this.renderDynamicField(field)).join('');
  },

  renderDynamicField(field) {
    const classes = field.full ? 'field full' : 'field';
    if (field.type === 'select') {
      const options = [`<option value="">Selecciona</option>`]
        .concat((field.options || []).map(option => `<option value="${this.escapeHtml(option)}">${this.escapeHtml(option)}</option>`))
        .join('');
      return `
        <div class="${classes}">
          <label for="${this.escapeHtml(field.name)}">${this.escapeHtml(field.label)}</label>
          <select id="${this.escapeHtml(field.name)}" name="${this.escapeHtml(field.name)}">${options}</select>
        </div>
      `;
    }

    if (field.type === 'textarea') {
      return `
        <div class="${classes}">
          <label for="${this.escapeHtml(field.name)}">${this.escapeHtml(field.label)}</label>
          <textarea id="${this.escapeHtml(field.name)}" name="${this.escapeHtml(field.name)}" rows="3" placeholder="${this.escapeHtml(field.placeholder || '')}"></textarea>
        </div>
      `;
    }

    return `
      <div class="${classes}">
        <label for="${this.escapeHtml(field.name)}">${this.escapeHtml(field.label)}</label>
        <input id="${this.escapeHtml(field.name)}" name="${this.escapeHtml(field.name)}" type="${this.escapeHtml(field.type || 'text')}" min="${this.escapeHtml(field.min || '')}" placeholder="${this.escapeHtml(field.placeholder || '')}">
      </div>
    `;
  },

  populateCatalogs() {
    const catalogs = this.catalogs || { processFamilies: [], evidenceTypes: [], communities: [], actors: [], years: [] };
    this.populateSelect(this.els.processFamily, catalogs.processFamilies, 'Selecciona un proceso');
    this.populateSelect(this.els.community, catalogs.communities, 'Selecciona una comunidad');
    this.populateSelect(this.els.actorClave, catalogs.actors, 'Selecciona un actor');

    this.populateSelect(this.els.dashboardProcess, catalogs.processFamilies, 'Todos', true);
    this.populateSelect(this.els.dashboardCommunity, catalogs.communities, 'Todas', true);
    this.populateSelect(this.els.dashboardYear, catalogs.years, 'Todos', true);
    this.populateSelect(this.els.recordsProcess, catalogs.processFamilies, 'Todos', true);
    this.populateSelect(this.els.recordsCommunity, catalogs.communities, 'Todas', true);
    this.populateSelect(this.els.recordsYear, catalogs.years, 'Todos', true);
    this.setActiveModule(this.activeModuleKey, { forceDefaults: true });
  },

  setView(view) {
    const map = {
      captura: { tab: this.els.tabCaptura, panel: this.els.viewCaptura },
      dashboard: { tab: this.els.tabDashboard, panel: this.els.viewDashboard },
      registros: { tab: this.els.tabRegistros, panel: this.els.viewRegistros }
    };
    Object.values(map).forEach(item => {
      item.tab.classList.remove('active');
      item.panel.hidden = true;
      item.panel.classList.remove('active');
    });
    map[view].tab.classList.add('active');
    map[view].panel.hidden = false;
    map[view].panel.classList.add('active');
    if (view === 'dashboard') {
      this.renderVisibleDashboardCharts();
      this.loadDashboard();
    }
    if (view === 'registros') {
      this.loadRecords();
    }
  },

  updateConnectionUi() {
    const pendingLabel = this.pendingCount > 0 ? ` | ${this.pendingCount} pendientes` : '';
    if (this.isOffline) {
      this.els.statusPill.className = 'status-pill warning';
      this.els.statusPill.textContent = `Sin conexion${pendingLabel}`;
      this.els.modeLabel.textContent = 'Offline';
    } else if (this.pendingCount > 0) {
      this.els.statusPill.className = 'status-pill info';
      this.els.statusPill.textContent = `Sincronizacion activa${pendingLabel}`;
      this.els.modeLabel.textContent = 'Online';
    } else {
      this.els.statusPill.className = 'status-pill success';
      this.els.statusPill.textContent = 'Conectado';
      this.els.modeLabel.textContent = 'Online';
    }
    this.els.pendingCount.textContent = String(this.pendingCount);
  },

  async refreshPendingState() {
    const pending = await this.dbGetAll(this.storeNames.pending);
    this.pendingCount = pending.length;
    this.updateConnectionUi();
    this.renderPendingList(pending);
    if (!this.isOffline && this.pendingCount > 0) {
      await this.syncPending();
    }
  },

  renderPendingList(items) {
    if (!items || items.length === 0) {
      this.els.pendingList.className = 'pending-list empty';
      this.els.pendingList.textContent = 'No hay registros pendientes.';
      return;
    }
    this.els.pendingList.className = 'pending-list';
    this.els.pendingList.innerHTML = items
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
      .map(item => `
        <div class="pending-item">
          <div>
            <strong>${this.escapeHtml(item.payload.title)}</strong>
            <div class="muted">${this.escapeHtml(item.payload.community || 'Sin comunidad')} | ${this.escapeHtml(item.payload.process_family || 'Sin proceso')}</div>
          </div>
          <div class="muted">${(item.files || []).length} adj.</div>
        </div>
      `)
      .join('');
  },

  renderSelectedFiles() {
    const files = Array.from(this.els.recordFiles.files || []);
    if (files.length === 0) {
      this.els.fileList.className = 'file-list empty';
      this.els.fileList.textContent = 'Sin adjuntos seleccionados.';
      return;
    }
    this.els.fileList.className = 'file-list';
    this.els.fileList.innerHTML = files.map(file => `
      <div class="file-item">
        <span>${this.escapeHtml(file.name)}</span>
        <span class="muted">${this.formatBytes(file.size)}</span>
      </div>
    `).join('');
  },

  getFormPayload() {
    const formData = new FormData(this.els.registroForm);
    const payload = {};
    formData.forEach((value, key) => {
      payload[key] = typeof value === 'string' ? value.trim() : value;
    });
    if (!payload.year_ref && payload.event_date) {
      payload.year_ref = payload.event_date.substring(0, 4);
    }
    if (!payload.summary) {
      payload.summary = this.buildAutoSummary(payload);
    }
    return payload;
  },

  buildAutoSummary(payload) {
    const bits = [];
    if (payload.module_label) {
      bits.push(payload.module_label);
    }
    if (payload.preset_label) {
      bits.push(payload.preset_label);
    }
    if (payload.community) {
      bits.push(`en ${payload.community}`);
    }
    if (payload.tipo_documentacion) {
      bits.push(`tipo ${payload.tipo_documentacion}`);
    }
    if (payload.ruta_consulta) {
      bits.push(payload.ruta_consulta);
    }
    if (payload.instrumento_aplicado) {
      bits.push(payload.instrumento_aplicado);
    }
    if (payload.tema_autogestion) {
      bits.push(payload.tema_autogestion);
    }
    if (payload.tipo_visita) {
      bits.push(payload.tipo_visita);
    }
    if (payload.entrega_realizada) {
      bits.push(`entrega ${payload.entrega_realizada}`);
    }
    return bits.filter(Boolean).join(' | ');
  },

  async saveRecord() {
    if (!this.els.registroForm.reportValidity()) {
      return;
    }

    const payload = this.getFormPayload();
    const files = Array.from(this.els.recordFiles.files || []).map(file => ({
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      blob: file
    }));

    this.els.btnGuardar.disabled = true;
    this.els.btnGuardar.textContent = this.isOffline ? 'Guardando localmente...' : 'Guardando...';

    try {
      if (this.isStaticPreviewHost()) {
        await this.saveRecordLocally(payload, files);
        this.renderFormMessage('Registro guardado localmente en este dispositivo.', 'success');
      } else if (this.isOffline) {
        await this.queuePendingRecord(payload, files);
        this.renderFormMessage('Registro guardado en cola local. Se sincronizara al volver la conexion.', 'warning');
      } else {
        try {
          await this.sendRecord(payload, files);
          this.renderFormMessage('Registro guardado correctamente en la base central.', 'success');
        } catch (error) {
          await this.queuePendingRecord(payload, files);
          this.renderFormMessage('La senal fallo durante el envio. Registro guardado localmente para sincronizar despues.', 'warning');
        }
      }
      this.resetForm();
      await this.refreshPendingState();
      await this.loadDashboard();
      await this.loadRecords();
    } finally {
      this.els.btnGuardar.disabled = false;
      this.els.btnGuardar.textContent = 'Guardar registro';
    }
  },

  async sendRecord(payload, files) {
    const formData = new FormData();
    formData.append('payload', JSON.stringify(payload));
    (files || []).forEach(file => {
      formData.append('attachments', file.blob, file.name);
    });

    const { data } = await this.fetchJson(`${this.apiBase}/records`, {
      method: 'POST',
      credentials: 'same-origin',
      body: formData
    });
    this.toast(`Registro ${data.record.record_uuid} guardado.`, 'success');
    return data.record;
  },

  async queuePendingRecord(payload, files) {
    const localId = `LOCAL-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    await this.dbPut(this.storeNames.pending, {
      local_id: localId,
      created_at: new Date().toISOString(),
      payload,
      files
    });
    this.pendingCount += 1;
    this.updateConnectionUi();
  },

  async saveRecordLocally(payload, files) {
    const localId = `LOCAL-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const record = {
      local_id: localId,
      record_uuid: localId,
      created_at: new Date().toISOString(),
      event_date: payload.event_date || new Date().toISOString().split('T')[0],
      year_ref: payload.year_ref || new Date().getFullYear().toString(),
      process_family: payload.process_family || '',
      evidence_type: payload.evidence_type || '',
      community: payload.community || '',
      actor_clave: payload.actor_clave || '',
      line_name: payload.line_name || '',
      expediente_code: payload.expediente_code || '',
      title: payload.title || '',
      summary: payload.summary || '',
      notes: payload.notes || '',
      module_key: payload.module_key || '',
      module_label: payload.module_label || '',
      preset_key: payload.preset_key || '',
      preset_label: payload.preset_label || '',
      source: 'standalone',
      attachments: (files || []).map(f => f.name),
      _payload: payload
    };
    await this.dbPut('local_records', record);
    this.toast('Registro guardado localmente.', 'success');
  },

  async getLocalRecords(filters = {}) {
    const all = await this.dbGetAll('local_records');
    return all.filter(r => {
      if (filters.process_family && r.process_family !== filters.process_family) return false;
      if (filters.community && r.community !== filters.community) return false;
      if (filters.year_ref && r.year_ref !== filters.year_ref) return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = [r.title, r.community, r.expediente_code, r.summary, r.notes]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (b.event_date || '').localeCompare(a.event_date || ''));
  },

  buildLocalDashboard(records) {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const communities = new Set(records.map(r => r.community).filter(Boolean));

    const byProcess = {};
    const byEvidence = {};
    const byMonth = {};
    const byCommunity = {};

    records.forEach(r => {
      const pf = r.process_family || 'Sin proceso';
      byProcess[pf] = (byProcess[pf] || 0) + 1;
      const ev = r.evidence_type || 'Sin tipo';
      byEvidence[ev] = (byEvidence[ev] || 0) + 1;
      const month = (r.event_date || '').substring(0, 7) || 'Sin fecha';
      byMonth[month] = (byMonth[month] || 0) + 1;
      const com = r.community || 'Sin comunidad';
      byCommunity[com] = (byCommunity[com] || 0) + 1;
    });

    const toList = obj => Object.entries(obj).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);

    return {
      kpis: {
        totalRecords: records.length,
        newThisMonth: records.filter(r => (r.event_date || '').startsWith(thisMonth)).length,
        communitiesCovered: communities.size,
        attachmentsTotal: records.reduce((s, r) => s + (r.attachments || []).length, 0)
      },
      byProcess: toList(byProcess),
      byEvidence: toList(byEvidence),
      timeline: Object.entries(byMonth).sort(([a], [b]) => a.localeCompare(b)).map(([label, value]) => ({ label, value })),
      byCommunity: toList(byCommunity).slice(0, 8),
      recent: records.slice(0, 5).map(r => ({
        title: r.title,
        community: r.community,
        event_date: r.event_date,
        process_family: r.process_family
      }))
    };
  },

  async syncPending() {
    if (this.isOffline || !this.user || this.isStaticPreviewHost()) {
      return;
    }
    const pending = await this.dbGetAll(this.storeNames.pending);
    if (!pending.length) {
      return;
    }

    this.toast(`Sincronizando ${pending.length} registro(s) pendientes...`, 'info');
    let synced = 0;
    for (const item of pending) {
      try {
        await this.sendRecord(item.payload, item.files || []);
        await this.dbDelete(this.storeNames.pending, item.local_id);
        synced += 1;
      } catch (error) {
        console.warn('Fallo al sincronizar', item.local_id, error);
      }
    }
    await this.refreshPendingState();
    if (synced > 0) {
      await this.loadDashboard();
      await this.loadRecords();
      this.toast(`Se sincronizaron ${synced} registro(s).`, 'success');
    }
  },

  dashboardFilters() {
    return {
      search: this.els.dashboardSearch.value.trim(),
      process_family: this.els.dashboardProcess.value,
      community: this.els.dashboardCommunity.value,
      year_ref: this.els.dashboardYear.value
    };
  },

  recordsFilters() {
    return {
      search: this.els.recordsSearch.value.trim(),
      process_family: this.els.recordsProcess.value,
      community: this.els.recordsCommunity.value,
      year_ref: this.els.recordsYear.value,
      limit: 250
    };
  },

  async loadDashboard(forceCache = false) {
    if (!this.user) {
      return;
    }
    const filters = this.dashboardFilters();
    const cacheKey = this.cacheKey('dashboard', filters);

    if (this.isStaticPreviewHost()) {
      const records = await this.getLocalRecords(filters);
      this.renderDashboard(this.buildLocalDashboard(records));
      return;
    }

    try {
      if (this.isOffline || forceCache) {
        const cached = await this.cacheGet(cacheKey);
        if (cached) {
          this.renderDashboard(cached);
          return;
        }
      }
      const data = await this.apiJson(`/dashboard?${new URLSearchParams(filters).toString()}`);
      await this.cachePut(cacheKey, data);
      this.renderDashboard(data);
    } catch (error) {
      const fallback = await this.cacheGet(cacheKey);
      if (fallback) {
        this.renderDashboard(fallback);
        this.toast('Tablero cargado desde cache local.', 'warning');
      }
    }
  },

  renderDashboard(data) {
    this.dashboardData = data;
    const kpis = data.kpis || {};
    this.els.kpiTotal.textContent = kpis.totalRecords || 0;
    this.els.kpiThisMonth.textContent = kpis.newThisMonth || 0;
    this.els.kpiCommunities.textContent = kpis.communitiesCovered || 0;
    this.els.kpiAttachments.textContent = kpis.attachmentsTotal || 0;

    this.renderSummaryList(this.els.communitySummary, data.byCommunity, item => `${item.label} <span>${item.value}</span>`);
    this.renderSummaryList(
      this.els.recentSummary,
      data.recent,
      item => `<div><strong>${this.escapeHtml(item.title || 'Sin titulo')}</strong><div class="muted">${this.escapeHtml(item.community || 'Sin comunidad')} | ${this.escapeHtml(item.event_date || '')}</div></div><span class="badge">${this.escapeHtml(item.process_family || 'Sin proceso')}</span>`
    );

    if (this.els.viewDashboard.hidden) {
      return;
    }

    this.renderVisibleDashboardCharts();
  },

  renderVisibleDashboardCharts() {
    if (this.els.viewDashboard.hidden || !this.dashboardData) {
      return;
    }

    const data = this.dashboardData;
    this.renderChart('chartProcess', 'doughnut', data.byProcess, ['#0c5b45', '#198f66', '#c66a1f', '#3f8c63', '#7a9b8c']);
    this.renderChart('chartEvidence', 'bar', data.byEvidence, ['#c66a1f']);
    this.renderChart('chartTimeline', 'line', data.timeline, ['#0b6bcb']);
  },

  renderSummaryList(target, items, formatter) {
    if (!items || !items.length) {
      target.innerHTML = '<div class="summary-item"><span>Sin datos disponibles.</span></div>';
      return;
    }
    target.innerHTML = items.map(item => `<div class="summary-item">${formatter(item)}</div>`).join('');
  },

  renderChart(canvasId, type, items, palette) {
    if (typeof Chart === 'undefined') {
      return;
    }
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (this.charts[canvasId]) {
      this.charts[canvasId].destroy();
    }
    const labels = (items || []).map(item => item.label || 'Sin dato');
    const values = (items || []).map(item => item.value || 0);
    const colors = labels.map((_, index) => palette[index % palette.length]);
    this.charts[canvasId] = new Chart(context, {
      type,
      data: {
        labels,
        datasets: [{
          label: 'Registros',
          data: values,
          backgroundColor: type === 'line' ? 'rgba(11, 107, 203, 0.14)' : colors,
          borderColor: colors,
          borderWidth: 2,
          fill: type === 'line',
          tension: 0.28
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: type !== 'bar' },
          tooltip: { mode: 'index', intersect: false }
        },
        scales: type === 'doughnut' ? {} : {
          y: {
            beginAtZero: true,
            ticks: { precision: 0 }
          }
        }
      }
    });
  },

  async loadRecords(forceCache = false) {
    if (!this.user) {
      return;
    }
    const filters = this.recordsFilters();
    const cacheKey = this.cacheKey('records', filters);

    if (this.isStaticPreviewHost()) {
      const localRecords = await this.getLocalRecords(filters);
      const mapped = localRecords.map(r => ({
        id: r.local_id,
        event_date: r.event_date,
        process_family: r.process_family,
        community: r.community,
        evidence_type: r.evidence_type,
        title: r.title,
        source_system: 'local',
        attachment_count: (r.attachments || []).length,
        summary: r.summary,
        notes: r.notes,
        line_name: r.line_name,
        expediente_code: r.expediente_code,
        actor_clave: r.actor_clave,
        module_label: r.module_label,
        preset_label: r.preset_label
      }));
      this.renderRecords(mapped);
      return;
    }

    try {
      if (this.isOffline || forceCache) {
        const cached = await this.cacheGet(cacheKey);
        if (cached) {
          this.renderRecords(cached.records || []);
          return;
        }
      }
      const data = await this.apiJson(`/records?${new URLSearchParams(filters).toString()}`);
      await this.cachePut(cacheKey, data);
      this.renderRecords(data.records || []);
    } catch (error) {
      const fallback = await this.cacheGet(cacheKey);
      if (fallback) {
        this.renderRecords(fallback.records || []);
        this.toast('Registros cargados desde cache local.', 'warning');
      } else {
        this.els.recordsBody.innerHTML = '<tr><td colspan="7" class="empty-row">No se pudo cargar la base.</td></tr>';
      }
    }
  },

  renderRecords(records) {
    if (!records || !records.length) {
      this.els.recordsBody.innerHTML = '<tr><td colspan="7" class="empty-row">No hay registros para los filtros seleccionados.</td></tr>';
      return;
    }
    this.els.recordsBody.innerHTML = records.map(record => `
      <tr class="record-row ${record.id === this.selectedRecordId ? 'active' : ''}" data-record-id="${record.id}">
        <td>${this.escapeHtml(record.event_date || '')}</td>
        <td><span class="badge">${this.escapeHtml(record.process_family || 'Sin proceso')}</span></td>
        <td>${this.escapeHtml(record.community || '')}</td>
        <td>${this.escapeHtml(record.evidence_type || '')}</td>
        <td>${this.escapeHtml(record.title || '')}</td>
        <td>${this.escapeHtml(record.source_system || '')}</td>
        <td>${this.escapeHtml(String(record.attachment_count || 0))}</td>
      </tr>
    `).join('');
    this.els.recordsBody.querySelectorAll('.record-row').forEach(row => {
      row.addEventListener('click', () => this.selectRecord(row.dataset.recordId));
    });
    if (!this.selectedRecordId && records[0]) {
      this.selectRecord(records[0].id);
    }
  },

  async selectRecord(recordId) {
    this.selectedRecordId = recordId;
    this.els.recordsBody.querySelectorAll('.record-row').forEach(row => {
      row.classList.toggle('active', row.dataset.recordId === String(recordId));
    });

    if (this.isStaticPreviewHost()) {
      const localRecord = await this.dbGet('local_records', recordId);
      if (localRecord) {
        this.renderRecordDetail({
          ...localRecord,
          source_system: 'local',
          attachment_count: (localRecord.attachments || []).length,
          attachments: (localRecord.attachments || []).map(name => ({ filename: name, kind: 'archivo', size_bytes: 0 })),
          payload_json: localRecord._payload || {}
        });
      }
      return;
    }

    try {
      const data = await this.apiJson(`/records/${recordId}`);
      this.renderRecordDetail(data.record);
    } catch (error) {
      this.els.recordDetail.innerHTML = '<div class="detail-empty">No se pudo cargar el detalle del registro.</div>';
    }
  },

  renderRecordDetail(record) {
    const attachments = record.attachments || [];
    const payloadEntries = this.buildPayloadEntries(record.payload_json || {});
    const payloadSummary = payloadEntries.length
      ? `<div class="detail-field"><span>Campos operativos</span><div class="list-summary">${payloadEntries.map(item => `<div class="summary-item"><div><strong>${this.escapeHtml(item.label)}</strong><div class="muted">${this.escapeHtml(item.value)}</div></div></div>`).join('')}</div></div>`
      : '';
    const payloadText = record.payload_json && Object.keys(record.payload_json).length
      ? `<div class="detail-field"><span>Payload original</span><pre>${this.escapeHtml(JSON.stringify(record.payload_json, null, 2))}</pre></div>`
      : '';

    const attachmentHtml = attachments.length
      ? attachments.map(item => `
          <div class="attachment-item">
            <div>
              <strong>${this.escapeHtml(item.filename)}</strong>
              <div class="muted">${this.escapeHtml(item.kind)} | ${this.formatBytes(item.size_bytes)}</div>
            </div>
            <a class="btn btn-secondary btn-small" href="${this.escapeHtml(item.url)}" target="_blank" rel="noreferrer">Abrir</a>
          </div>
        `).join('')
      : '<div class="summary-item"><span>Sin adjuntos.</span></div>';

    this.els.recordDetail.innerHTML = `
      <div class="detail-grid">
        <div class="detail-field"><span>Titulo</span><strong>${this.escapeHtml(record.title || '')}</strong></div>
        <div class="detail-field"><span>Resumen</span><div>${this.escapeHtml(record.summary || 'Sin resumen')}</div></div>
        <div class="detail-field"><span>Notas</span><div>${this.escapeHtml(record.notes || 'Sin notas')}</div></div>
        <div class="detail-field"><span>Proceso</span><div>${this.escapeHtml(record.process_family || '')}</div></div>
        <div class="detail-field"><span>Subficha</span><div>${this.escapeHtml((record.payload_json && record.payload_json.preset_label) || 'No especificada')}</div></div>
        <div class="detail-field"><span>Comunidad</span><div>${this.escapeHtml(record.community || '')}</div></div>
        <div class="detail-field"><span>Linea</span><div>${this.escapeHtml(record.line_name || '')}</div></div>
        <div class="detail-field"><span>Actor clave</span><div>${this.escapeHtml(record.actor_clave || '')}</div></div>
        <div class="detail-field"><span>Expediente</span><div>${this.escapeHtml(record.expediente_code || '')}</div></div>
        <div class="detail-field"><span>Fuente</span><div>${this.escapeHtml(record.source_system || '')}</div></div>
        <div class="detail-field"><span>Adjuntos</span><div>${attachmentHtml}</div></div>
        ${payloadSummary}
        ${payloadText}
      </div>
    `;
  },

  buildPayloadEntries(payload) {
    const ignored = new Set([
      'event_date',
      'year_ref',
      'process_family',
      'community',
      'title',
      'summary',
      'notes',
      'evidence_type',
      'module_key',
      'module_label',
      'preset_key',
      'preset_label',
      'line_name',
      'expediente_code',
      'actor_clave',
      'top_block'
    ]);
    return Object.entries(payload || {})
      .filter(([key, value]) => !ignored.has(key) && String(value || '').trim() !== '')
      .map(([key, value]) => ({
        label: key.replaceAll('_', ' '),
        value: String(value)
      }));
  },

  connectEventStream() {
    if (this.isOffline || !this.user || typeof EventSource === 'undefined' || this.isStaticPreviewHost()) {
      return;
    }
    this.closeEventStream();
    try {
      this.eventSource = new EventSource(`${this.apiBase}/events`);
      this.eventSource.onmessage = async () => {
        await this.loadDashboard();
        await this.loadRecords();
      };
      this.eventSource.onerror = () => {
        this.closeEventStream();
      };
    } catch (error) {
      console.warn('No se pudo abrir el stream de eventos', error);
    }
  },

  closeEventStream() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  },

  async apiJson(path) {
    const { data } = await this.fetchJson(`${this.apiBase}${path}`, {
      credentials: 'same-origin'
    });
    return data;
  },

  warnIfOpenedOutsideBackend() {
    if (window.location.protocol === 'file:') {
      this.renderMessage(
        'loginMsg',
        `Esta app no debe abrirse como archivo local. Inicia el backend y abre ${this.preferredAppUrl()}.`,
        'warning'
      );
    }
  },

  async fetchJson(url, options = {}) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new Error(
        `No se pudo contactar al backend. Verifica que la app este abierta en ${this.preferredAppUrl()} y que server.py siga corriendo.`
      );
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const rawBody = await response.text();
    const trimmedBody = rawBody.trim();
    let data = null;

    if (trimmedBody) {
      if (contentType.includes('application/json') || trimmedBody.startsWith('{') || trimmedBody.startsWith('[')) {
        try {
          data = JSON.parse(trimmedBody);
        } catch (error) {
          throw new Error(`La API devolvio JSON invalido en ${url}.`);
        }
      } else if (contentType.includes('text/html') || trimmedBody.startsWith('<!DOCTYPE html') || trimmedBody.startsWith('<html')) {
        throw new Error(
          `La app recibio HTML en ${url} en lugar de JSON. Abre el monitor desde ${this.preferredAppUrl()}; no desde index.html ni desde otro servidor.`
        );
      } else {
        throw new Error(`La API devolvio una respuesta inesperada en ${url}.`);
      }
    } else {
      data = {};
    }

    if (!response.ok || !data.success) {
      throw new Error(data.error || `La API respondio con estado ${response.status}.`);
    }

    return { response, data };
  },

  isStaticPreviewHost() {
    const host = (window.location.hostname || '').toLowerCase();
    return host.endsWith('github.io');
  },

  remoteHostWarning() {
    return `GitHub Pages solo publica el frontend estatico. El login y la base central requieren el backend Flask/SQLite. Abre la app desde ${this.preferredAppUrl()} o desde la IP local del equipo que ejecuta server.py.`;
  },

  preferredAppUrl() {
    if (this.isStaticPreviewHost()) {
      return 'http://127.0.0.1:8080/';
    }
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      return `${window.location.origin}/`;
    }
    return 'http://127.0.0.1:8080/';
  },

  resetForm() {
    this.els.registroForm.reset();
    this.els.eventDate.value = new Date().toISOString().split('T')[0];
    this.els.yearRef.value = new Date().getFullYear();
    this.setActiveModule(this.activeModuleKey || 'apicultura', { forceDefaults: true });
    this.renderFormMessage('', 'success');
    this.renderSelectedFiles();
  },

  renderFormMessage(message, type) {
    if (!message) {
      this.els.formMsgContainer.innerHTML = '';
      return;
    }
    this.els.formMsgContainer.innerHTML = `<div class="message ${type}">${this.escapeHtml(message)}</div>`;
  },

  renderMessage(targetId, message, type) {
    const target = document.getElementById(targetId);
    if (!target) {
      return;
    }
    target.innerHTML = message ? `<div class="message ${type}">${this.escapeHtml(message)}</div>` : '';
  },

  toast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    this.els.toastHost.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 4200);
  },

  escapeHtml(value) {
    return String(value || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },

  formatBytes(size) {
    const value = Number(size || 0);
    if (value < 1024) {
      return `${value} B`;
    }
    if (value < 1024 * 1024) {
      return `${(value / 1024).toFixed(1)} KB`;
    }
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
};

document.addEventListener('DOMContentLoaded', () => app.init());

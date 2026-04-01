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
  activeModuleKey: 'consulta_clpi',
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
      moduleSummary: pick('moduleSummary'),
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
      const request = indexedDB.open('RPI_MONITOR_DB', 1);
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

  async login() {
    const username = this.els.loginUser.value.trim();
    const password = this.els.loginPass.value.trim();
    if (!username || !password) {
      this.renderMessage('loginMsg', 'Completa usuario y contrasena.', 'error');
      return;
    }
    if (this.isOffline) {
      this.renderMessage('loginMsg', 'Necesitas conectividad al menos una vez para iniciar sesion.', 'warning');
      return;
    }

    this.els.btnLogin.disabled = true;
    this.els.btnLogin.textContent = 'Verificando...';
    try {
      const response = await fetch(`${this.apiBase}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password })
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'No se pudo iniciar sesion');
      }
      this.renderMessage('loginMsg', '', 'info');
      await this.restoreSession();
      this.toast('Sesion iniciada correctamente.', 'success');
    } catch (error) {
      this.renderMessage('loginMsg', error.message || 'Error de autenticacion', 'error');
    } finally {
      this.els.btnLogin.disabled = false;
      this.els.btnLogin.textContent = 'Ingresar';
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
      consulta_clpi: {
        label: 'Consulta y CLPI',
        processFamily: 'consulta_y_consentimiento',
        lineName: 'CCLPI / CLPI / CPLI',
        titlePlaceholder: 'Consulta de CLPI en comunidad',
        evidenceTypes: ['actas', 'informes', 'registros', 'audiovisuales'],
        summary: 'Pensado para actas, acuerdos, consentimiento, lideres participantes y proximos hitos de consulta.',
        fields: [
          { name: 'ruta_consulta', label: 'Ruta de consulta', type: 'select', options: ['CCLPI', 'CLPI', 'CPLI', 'Consulta preliminar'] },
          { name: 'fase_consulta', label: 'Fase actual', type: 'select', options: ['Preparacion', 'Socializacion', 'Deliberacion', 'Consentimiento', 'Seguimiento'] },
          { name: 'participantes_total', label: 'Participantes', type: 'number', min: '0' },
          { name: 'lideres_presentes', label: 'Lideres presentes', type: 'text', placeholder: 'Nombres o referentes clave' },
          { name: 'acuerdo_principal', label: 'Acuerdo principal', type: 'textarea', full: true, placeholder: 'Sintetiza el acuerdo, permiso o principal decision.' },
          { name: 'proximo_hito', label: 'Proximo hito', type: 'textarea', full: true, placeholder: 'Que falta, quien lo hara y para cuando.' }
        ]
      },
      documentaciones: {
        label: 'Documentaciones',
        processFamily: 'documentaciones',
        lineName: 'TG04 Documentaciones',
        titlePlaceholder: 'Gestion documental en comunidad',
        evidenceTypes: ['registros', 'solicitud', 'informes', 'facturas'],
        summary: 'Para tramites, solicitudes, cedulas, certificados, carnet indigena y seguimiento administrativo.',
        fields: [
          { name: 'tipo_documentacion', label: 'Tipo de documentacion', type: 'select', options: ['Carnet indigena', 'Cedula primera vez', 'Cedula renovacion', 'Certificado', 'Inscripcion de nacimiento', 'Otro'] },
          { name: 'institucion_referida', label: 'Institucion referida', type: 'select', options: ['INDI', 'Registro Civil', 'Identificaciones', 'Municipalidad', 'Otro'] },
          { name: 'cantidad_gestiones', label: 'Cantidad de gestiones', type: 'number', min: '0' },
          { name: 'estado_tramite', label: 'Estado del tramite', type: 'select', options: ['Iniciado', 'En gestion', 'Entregado', 'Observado'] },
          { name: 'beneficiarios_total', label: 'Beneficiarios', type: 'number', min: '0' },
          { name: 'observacion_tramite', label: 'Observacion del tramite', type: 'textarea', full: true, placeholder: 'Cuellos de botella, faltantes, entrega o proximo paso.' }
        ]
      },
      servicios_ecosistemicos: {
        label: 'Servicios ecosistemicos',
        processFamily: 'servicios_ecosistemicos',
        lineName: 'TG01 Servicios ecosistemicos',
        titlePlaceholder: 'Relevamiento de servicios ecosistemicos',
        evidenceTypes: ['encuesta', 'relevamiento', 'mapas', 'informes'],
        summary: 'Para linea de base, encuestas, mapeos, diagnosticos y monitoreo territorial o ambiental.',
        fields: [
          { name: 'instrumento_aplicado', label: 'Instrumento aplicado', type: 'select', options: ['Linea de base', 'Encuesta', 'Mapeo', 'Relevamiento', 'Monitoreo'] },
          { name: 'area_intervencion', label: 'Area o tema', type: 'text', placeholder: 'Bosque, agua, territorio, uso de recursos...' },
          { name: 'hogares_beneficiados', label: 'Hogares relevados', type: 'number', min: '0' },
          { name: 'referente_local', label: 'Referente local', type: 'text', placeholder: 'Lider o referente consultado' },
          { name: 'necesidad_detectada', label: 'Necesidad detectada', type: 'textarea', full: true, placeholder: 'Que necesidad o riesgo se detecto.' },
          { name: 'resultado_inmediato', label: 'Resultado inmediato', type: 'textarea', full: true, placeholder: 'Hallazgo principal o cambio observado.' }
        ]
      },
      seguridad_alimentaria: {
        label: 'Seguridad alimentaria escolar',
        processFamily: 'seguridad_alimentaria_escolar',
        lineName: 'TG05 Seguridad alimentaria escolar',
        titlePlaceholder: 'Seguimiento de seguridad alimentaria escolar',
        evidenceTypes: ['registros', 'informes', 'relevamiento', 'facturas'],
        summary: 'Para monitoreo de necesidad, entregas, cobertura, comite escolar y alertas alimentarias.',
        fields: [
          { name: 'centro_educativo', label: 'Centro educativo', type: 'text', placeholder: 'Nombre de escuela o sede' },
          { name: 'matricula_total', label: 'Matricula', type: 'number', min: '0' },
          { name: 'entrega_realizada', label: 'Entrega realizada', type: 'select', options: ['Si', 'No', 'Parcial'] },
          { name: 'dias_cobertura', label: 'Dias de cobertura', type: 'number', min: '0' },
          { name: 'comite_escolar', label: 'Comite o referente', type: 'text', placeholder: 'Nombre del comite o referente' },
          { name: 'riesgo_alimentario', label: 'Riesgo o alerta', type: 'textarea', full: true, placeholder: 'Describe faltantes, cobertura insuficiente o riesgo detectado.' }
        ]
      },
      autogestion: {
        label: 'Autogestion comunitaria',
        processFamily: 'autogestion_comunitaria',
        lineName: 'TG06 Autogestion comunitaria',
        titlePlaceholder: 'Accion de autogestion comunitaria',
        evidenceTypes: ['registros', 'informes', 'notas', 'audiovisuales'],
        summary: 'Para reuniones, acuerdos, liderazgos, organizacion comunitaria y siguientes acciones.',
        fields: [
          { name: 'tema_autogestion', label: 'Tema principal', type: 'select', options: ['Organizacion', 'Liderazgo', 'Gestion comunitaria', 'Capacitacion', 'Seguimiento'] },
          { name: 'participantes_total', label: 'Participantes', type: 'number', min: '0' },
          { name: 'organizacion_referente', label: 'Organizacion referente', type: 'text', placeholder: 'Comunidad, comite u organizacion' },
          { name: 'lider_comunitario', label: 'Lider comunitario', type: 'text', placeholder: 'Nombre del referente' },
          { name: 'acuerdo_principal', label: 'Acuerdo principal', type: 'textarea', full: true, placeholder: 'Que se acordo o definio.' },
          { name: 'proxima_accion', label: 'Proxima accion', type: 'textarea', full: true, placeholder: 'Compromisos, responsables y plazo.' }
        ]
      },
      seguimiento_indigena: {
        label: 'Seguimiento indigena',
        processFamily: 'seguimiento_componente_indigena',
        lineName: 'Seguimiento componente indigena',
        titlePlaceholder: 'Visita o seguimiento territorial',
        evidenceTypes: ['informes', 'registros', 'audiovisuales', 'notas'],
        summary: 'Para visitas casa por casa, reuniones de lideres, expectativas comunitarias y alertas del territorio.',
        fields: [
          { name: 'tipo_visita', label: 'Tipo de visita', type: 'select', options: ['Casa por casa', 'Reunion de lideres', 'Expectativas comunitarias', 'Seguimiento general', 'Asistencia medica'] },
          { name: 'hogares_visitados', label: 'Hogares visitados', type: 'number', min: '0' },
          { name: 'tecnico_apoyo', label: 'Tecnico o aliado', type: 'text', placeholder: 'Nombre del apoyo tecnico' },
          { name: 'riesgo_detectado', label: 'Riesgo detectado', type: 'textarea', full: true, placeholder: 'Riesgo social, operativo o comunitario.' },
          { name: 'accion_inmediata', label: 'Accion inmediata', type: 'textarea', full: true, placeholder: 'Respuesta inmediata o derivacion realizada.' }
        ]
      },
      general_rpi: {
        label: 'Registro general RPI',
        processFamily: 'general_otro',
        lineName: 'Registro general RPI',
        titlePlaceholder: 'Registro operativo RPI',
        evidenceTypes: ['informes', 'registros', 'notas', 'audiovisuales'],
        summary: 'Usa esta ficha cuando el proceso no cae claramente en uno de los modulos principales.',
        fields: [
          { name: 'contexto_operativo', label: 'Contexto operativo', type: 'text', placeholder: 'Campana, visita, coordinacion, alerta...' },
          { name: 'participantes_total', label: 'Participantes', type: 'number', min: '0' },
          { name: 'resultado_inmediato', label: 'Resultado inmediato', type: 'textarea', full: true, placeholder: 'Que paso y que resultado hubo.' }
        ]
      }
    };
  },

  resolveModuleKeyFromProcess(processFamily) {
    const match = Object.entries(this.moduleDefinitions).find(([, config]) => config.processFamily === processFamily);
    return match ? match[0] : 'general_rpi';
  },

  handleProcessFamilyChange() {
    const processFamily = this.els.processFamily.value;
    const moduleKey = this.resolveModuleKeyFromProcess(processFamily);
    this.setActiveModule(moduleKey, { syncProcess: false, preserveEvidence: true });
  },

  setActiveModule(moduleKey, options = {}) {
    const config = this.moduleDefinitions[moduleKey] || this.moduleDefinitions.general_rpi;
    const {
      syncProcess = true,
      preserveEvidence = false,
      forceDefaults = false
    } = options;

    this.activeModuleKey = moduleKey in this.moduleDefinitions ? moduleKey : 'general_rpi';
    this.els.moduleCards.forEach(card => {
      card.classList.toggle('active', card.dataset.moduleKey === this.activeModuleKey);
    });

    this.els.moduleKey.value = this.activeModuleKey;
    this.els.moduleLabel.value = config.label;
    this.els.moduleSummary.innerHTML = `<strong>${this.escapeHtml(config.label)}</strong><div>${this.escapeHtml(config.summary)}</div>`;

    if (syncProcess) {
      this.els.processFamily.value = config.processFamily;
    }

    this.syncEvidenceOptions(config, preserveEvidence);
    this.renderDynamicFields(config);

    if (forceDefaults || !this.els.lineName.value) {
      this.els.lineName.value = config.lineName;
    }
    this.els.recordTitle.placeholder = config.titlePlaceholder;
  },

  syncEvidenceOptions(config, preserveSelection = false) {
    const currentValue = this.els.evidenceType.value;
    const combined = [...(config.evidenceTypes || []), ...((this.catalogs && this.catalogs.evidenceTypes) || [])];
    const unique = Array.from(new Set(combined.filter(Boolean)));
    this.populateSelect(this.els.evidenceType, unique, 'Selecciona un tipo');
    if (preserveSelection && unique.includes(currentValue)) {
      this.els.evidenceType.value = currentValue;
      return;
    }
    if (config.evidenceTypes && config.evidenceTypes.length > 0) {
      this.els.evidenceType.value = config.evidenceTypes[0];
    }
  },

  renderDynamicFields(config) {
    const fields = config.fields || [];
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
      if (this.isOffline) {
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

    const response = await fetch(`${this.apiBase}/records`, {
      method: 'POST',
      credentials: 'same-origin',
      body: formData
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'No se pudo guardar el registro');
    }
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

  async syncPending() {
    if (this.isOffline || !this.user) {
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
    this.selectedRecordId = Number(recordId);
    this.els.recordsBody.querySelectorAll('.record-row').forEach(row => {
      row.classList.toggle('active', Number(row.dataset.recordId) === this.selectedRecordId);
    });
    try {
      const data = await this.apiJson(`/records/${recordId}`);
      this.renderRecordDetail(data.record);
    } catch (error) {
      this.els.recordDetail.innerHTML = '<div class="detail-empty">No se pudo cargar el detalle del registro.</div>';
    }
  },

  renderRecordDetail(record) {
    const attachments = record.attachments || [];
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
        <div class="detail-field"><span>Comunidad</span><div>${this.escapeHtml(record.community || '')}</div></div>
        <div class="detail-field"><span>Linea</span><div>${this.escapeHtml(record.line_name || '')}</div></div>
        <div class="detail-field"><span>Actor clave</span><div>${this.escapeHtml(record.actor_clave || '')}</div></div>
        <div class="detail-field"><span>Expediente</span><div>${this.escapeHtml(record.expediente_code || '')}</div></div>
        <div class="detail-field"><span>Fuente</span><div>${this.escapeHtml(record.source_system || '')}</div></div>
        <div class="detail-field"><span>Adjuntos</span><div>${attachmentHtml}</div></div>
        ${payloadText}
      </div>
    `;
  },

  connectEventStream() {
    if (this.isOffline || !this.user || typeof EventSource === 'undefined') {
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
    const response = await fetch(`${this.apiBase}${path}`, {
      credentials: 'same-origin'
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'Error en la API');
    }
    return data;
  },

  resetForm() {
    this.els.registroForm.reset();
    this.els.eventDate.value = new Date().toISOString().split('T')[0];
    this.els.yearRef.value = new Date().getFullYear();
    this.setActiveModule(this.activeModuleKey || 'consulta_clpi', { forceDefaults: true });
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

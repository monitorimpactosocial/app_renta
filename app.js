const app = {
    usuarioActual: null,
    sessionToken: null,
    catalogos: null,
    chartInstances: {},
    els: {},
    tablaConsultaData: [],
    tablaConsultaSortBy: 'fecha',
    tablaConsultaSortAsc: false,

    scriptUrl: "https://script.google.com/macros/s/AKfycbzx6irREkELBkEWDQ8qWaf0erP6o6g9y2AxJWYDO9ItZPq_GFQ3BDJvRl_TOGKEap_pfw/exec", // URL a modificar post-deploy

    init() {
        this.mapEls();
        this.bindBaseEvents();
    },

    async apiCall(accion, payload = {}) {
        payload.accion = accion;
        if (this.sessionToken) {
            payload.token = this.sessionToken; // Adjuntar "el pase libre" a la petición
        }

        try {
            const response = await fetch(this.scriptUrl, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // Apps Script prefiere plain text a veces por tema de preflights
                body: JSON.stringify(payload)
            });
            if (!response.ok) throw new Error("Error HTTP " + response.status);
            const data = await response.json();

            // Si el servidor detectó que el token es malo o expiró
            if (data && data.authError) {
                this.toast("La sesión expiró por seguridad. Vuelve a ingresar.", "error");
                this.cerrarSesion();
                return null;
            }

            return data;
        } catch (err) {
            console.error("API Error:", err);
            throw err;
        }
    },

    mapEls() {
        this.els.cardLogin = document.getElementById("cardLogin");
        this.els.cardApp = document.getElementById("cardApp");
        this.els.loginUser = document.getElementById("loginUser");
        this.els.loginPass = document.getElementById("loginPass");
        this.els.btnLogin = document.getElementById("btnLogin");
        this.els.btnLogout = document.getElementById("btnLogout");
        this.els.btnBuscarCI = document.getElementById("btnBuscarCI");
        this.els.btnGuardar = document.getElementById("btnGuardar");
        this.els.registroForm = document.getElementById("registroForm");
        this.els.camposEspecificos = document.getElementById("camposEspecificos");
        this.els.productorResumen = document.getElementById("productorResumen");

        // Tabs V2
        this.els.tabs = document.querySelectorAll('.page-tabs .tab');
        this.els.viewFormularios = document.getElementById('viewFormularios');
        this.els.viewDashboard = document.getElementById('viewDashboard');
        this.els.panelDashboard = document.getElementById('panelDashboard');
        this.els.panelFormulario = document.getElementById('panelFormulario');
        this.els.moduloActivo = document.getElementById('moduloActivo');
    },

    bindBaseEvents() {
        if (this.els.btnLogin) this.els.btnLogin.addEventListener("click", () => this.login());
        if (this.els.btnLogout) this.els.btnLogout.addEventListener("click", () => this.cerrarSesion());
        if (this.els.btnBuscarCI) this.els.btnBuscarCI.addEventListener("click", () => this.buscarCI());
        if (this.els.btnGuardar) this.els.btnGuardar.addEventListener("click", () => this.guardarRegistro());

        document.addEventListener("change", (e) => {
            if (e.target && e.target.id === "departamento") this.onDepartamentoChange();
            if (e.target && e.target.id === "distrito") this.onDistritoChange();
        });
    },

    // --- SISTEMA LOGIN V2 ---
    async login() {
        const user = (this.els.loginUser?.value || "").trim();
        const pass = (this.els.loginPass?.value || "").trim();

        this.els.btnLogin.disabled = true;
        this.els.btnLogin.textContent = "Verificando...";

        try {
            const res = await this.apiCall("verificarLogin", { user, pass });
            if (!res || !res.success) {
                this.toast("Credenciales inválidas", "error");
                this.els.btnLogin.disabled = false;
                this.els.btnLogin.textContent = "Ingresar Seguro";
                return;
            }

            this.usuarioActual = res.user;
            this.sessionToken = res.token; // Guardar la llave en memoria temporal

            document.getElementById("lblResponsable").textContent = this.usuarioActual.nombre;
            document.getElementById("fecha").value = new Date().toISOString().split("T")[0];

            await this.cargarCatalogos();
            this.iniciarSesionUI();
        } catch (err) {
            this.toast("Fallo de conexión al servidor", "error");
            this.els.btnLogin.disabled = false;
            this.els.btnLogin.textContent = "Ingresar Seguro";
        }
    },

    iniciarSesionUI() {
        document.getElementById("cardLogin").style.display = "none";
        document.getElementById("cardApp").style.display = "block";
        if (this.els.btnLogout) this.els.btnLogout.style.display = 'inline-block';
    },

    cerrarSesion() {
        this.usuarioActual = null;
        this.sessionToken = null;
        this.els.cardApp.style.display = "none";
        this.els.cardLogin.style.display = "block";
        this.els.loginPass.value = "";
        this.toast("Sesión cerrada correctamente", "info");
    },

    // --- NAVEGACIÓN Y TABS V2 ---
    switchTab(tabName) {
        if (this.els.tabs) this.els.tabs.forEach(t => t.classList.remove('active'));
        if (this.els.viewFormularios) this.els.viewFormularios.style.display = 'none';
        if (this.els.viewDashboard) this.els.viewDashboard.style.display = 'none';
        const viewCons = document.getElementById('viewConsulta');
        if (viewCons) viewCons.style.display = 'none';

        if (tabName === 'formularios') {
            const tabForm = document.getElementById('tabFormularios');
            if (tabForm) tabForm.classList.add('active');
            if (this.els.viewFormularios) this.els.viewFormularios.style.display = 'block';
        } else if (tabName === 'dashboard') {
            const tabDash = document.getElementById('tabDashboard');
            if (tabDash) tabDash.classList.add('active');
            if (this.els.viewDashboard) this.els.viewDashboard.style.display = 'block';
            this.cargarDashboard();
        } else if (tabName === 'consulta') {
            const tabCons = document.getElementById('tabConsulta');
            if (tabCons) tabCons.classList.add('active');
            if (viewCons) viewCons.style.display = 'block';
            if (this.tablaConsultaData.length === 0) this.cargarTablaConsulta();
        }
    },

    volverAlDashboard() {
        if (this.els.panelFormulario) this.els.panelFormulario.style.display = 'none';
        if (this.els.panelDashboard) this.els.panelDashboard.style.display = 'grid';
        if (this.els.registroForm) this.els.registroForm.reset();

        const df = document.getElementById('fecha');
        if (df) df.value = new Date().toISOString().split('T')[0];

        const pc = this.els.productorResumen;
        if (pc) {
            pc.innerHTML = "Sin búsqueda realizada.";
            pc.classList.add("empty");
        }
        const msgC = document.getElementById("formMsgContainer");
        if (msgC) msgC.innerHTML = "";
    },

    async cargarCatalogos() {
        try {
            const data = await this.apiCall("getCatalogosAvanzados");
            this.catalogos = data;
            this.poblarSelect("departamento", data.departamentos);
            this.poblarSelect("sexo", data.sexos);
            this.poblarSelect("tipo_persona", data.tiposPersona);
            this.poblarSelect("estado_seguimiento", data.estadosSeguimiento);
            this.poblarDatalist("list_organizaciones", data.organizaciones);
        } catch (err) {
            console.error("Fallo cargando catálogos", err);
        }
    },

    poblarSelect(id, values, keepFirst = true) {
        const el = document.getElementById(id);
        if (!el) return;

        const first = keepFirst ? `<option value="">Seleccione</option>` : "";
        el.innerHTML = first + (values || []).map(v => `<option value="${this.escapeHtml(v)}">${this.escapeHtml(v)}</option>`).join("");
    },

    poblarDatalist(id, values) {
        const el = document.getElementById(id);
        if (!el) return;
        el.innerHTML = (values || []).map(v => `<option value="${this.escapeHtml(v)}"></option>`).join("");
    },

    onDepartamentoChange() {
        const dep = document.getElementById("departamento").value;
        const distritos = this.catalogos?.distritosByDepartamento?.[dep] || [];
        this.poblarSelect("distrito", distritos);
        this.poblarSelect("comunidad", []);
    },

    onDistritoChange() {
        const dep = document.getElementById("departamento").value;
        const dis = document.getElementById("distrito").value;
        const key = dep + "|||" + dis;
        const comunidades = this.catalogos?.comunidadesByDeptoDistrito?.[key] || [];
        this.poblarSelect("comunidad", comunidades);
    },

    abrirFormulario(modulo) {
        if (this.els.panelDashboard) this.els.panelDashboard.style.display = "none";
        if (this.els.panelFormulario) this.els.panelFormulario.style.display = "block";
        if (this.els.moduloActivo) this.els.moduloActivo.value = modulo;

        const formTitle = document.getElementById("formTitle");
        if (!formTitle) return;

        if (modulo === "apicultura") {
            formTitle.textContent = "Ficha de Apicultura";
            this.els.camposEspecificos.innerHTML = `
        <div class="grid-3">
          <div>
            <label for="tipo_proyecto">Tipo de proyecto</label>
            <select id="tipo_proyecto" name="tipo_proyecto"></select>
          </div>
          <div>
            <label for="asistencia">Tipo de asistencia</label>
            <select id="asistencia" name="asistencia"></select>
          </div>
          <div>
            <label for="estado_productivo">Estado productivo</label>
            <select id="estado_productivo" name="estado_productivo">
              <option value="">Seleccione</option>
              <option value="Inicial">Inicial</option>
              <option value="En producción">En producción</option>
              <option value="En recuperación">En recuperación</option>
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label for="cantidad_colmenas">Cantidad de colmenas</label>
            <input type="number" id="cantidad_colmenas" name="cantidad_colmenas" min="0">
          </div>
          <div>
            <label for="cantidad_cajas">Cantidad de cajas</label>
            <input type="number" id="cantidad_cajas" name="cantidad_cajas" min="0">
          </div>
        </div>
      `;
            this.poblarSelect("tipo_proyecto", this.catalogos?.tiposProyecto || []);
            this.poblarSelect("asistencia", this.catalogos?.tiposAsistencia || []);
        }

        if (modulo === "agricola") {
            formTitle.textContent = "Ficha de Producción Agrícola";
            this.els.camposEspecificos.innerHTML = `
        <div class="grid-3">
          <div>
            <label for="rubro">Rubro</label>
            <select id="rubro" name="rubro"></select>
          </div>
          <div>
            <label for="estado_proyecto">Estado del proyecto</label>
            <select id="estado_proyecto" name="estado_proyecto"></select>
          </div>
          <div>
            <label for="etapa">Etapa</label>
            <select id="etapa" name="etapa"></select>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label for="superficie_ha">Superficie, ha</label>
            <input type="number" step="0.01" id="superficie_ha" name="superficie_ha">
          </div>
          <div>
            <label for="asistencia">Tipo de asistencia</label>
            <select id="asistencia" name="asistencia"></select>
          </div>
        </div>
      `;
            this.poblarSelect("rubro", this.catalogos?.rubros || []);
            this.poblarSelect("estado_proyecto", this.catalogos?.estadosProyecto || []);
            this.poblarSelect("etapa", this.catalogos?.etapasAgricolas || []);
            this.poblarSelect("asistencia", this.catalogos?.tiposAsistencia || []);
        }

        if (modulo === "forestal") {
            formTitle.textContent = "Ficha Forestal";
            this.els.camposEspecificos.innerHTML = `
        <div class="grid-3">
          <div>
            <label for="especie">Especie</label>
            <select id="especie" name="especie"></select>
          </div>
          <div>
            <label for="tipo_sistema">Tipo de sistema</label>
            <select id="tipo_sistema" name="tipo_sistema"></select>
          </div>
          <div>
            <label for="asistencia">Tipo de asistencia</label>
            <select id="asistencia" name="asistencia"></select>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label for="cantidad">Cantidad</label>
            <input type="number" id="cantidad" name="cantidad" min="0">
          </div>
          <div>
            <label for="superficie_ha">Superficie, ha</label>
            <input type="number" step="0.01" id="superficie_ha" name="superficie_ha">
          </div>
        </div>
      `;
            this.poblarSelect("especie", this.catalogos?.especies || []);
            this.poblarSelect("tipo_sistema", this.catalogos?.tiposSistemaForestal || []);
            this.poblarSelect("asistencia", this.catalogos?.tiposAsistencia || []);
        }

        if (modulo === "indigena") {
            formTitle.textContent = "Ficha Componente Indígena";
            this.els.camposEspecificos.innerHTML = `
        <div class="grid-3">
          <div>
            <label for="etnia">Etnia</label>
            <select id="etnia" name="etnia"></select>
          </div>
          <div>
            <label for="pueblo">Pueblo / comunidad indígena</label>
            <input type="text" id="pueblo" name="pueblo">
          </div>
          <div>
            <label for="tipo_asistencia">Tipo de asistencia</label>
            <select id="tipo_asistencia" name="tipo_asistencia"></select>
          </div>
        </div>
        <div class="grid-2">
          <div>
            <label for="beneficiarios_hogar">Beneficiarios del hogar</label>
            <input type="number" id="beneficiarios_hogar" name="beneficiarios_hogar" min="0">
          </div>
          <div>
            <label for="lider">Líder o referente</label>
            <input type="text" id="lider" name="lider">
          </div>
        </div>
      `;
            this.poblarSelect("etnia", this.catalogos?.etnias || []);
            this.poblarSelect("tipo_asistencia", this.catalogos?.tiposAsistencia || []);
        }
    },

    async buscarCI() {
        const ci = (document.getElementById("ci").value || "").trim();
        if (!ci) {
            this.toast("Ingrese un documento", "error");
            return;
        }

        this.els.btnBuscarCI.disabled = true;
        this.els.btnBuscarCI.textContent = "⏳...";

        try {
            const res = await this.apiCall("buscarProductorDetallado", { ci });
            this.els.btnBuscarCI.disabled = false;
            this.els.btnBuscarCI.textContent = "Buscar";

            if (!res || !res.success) {
                this.renderResumenNoEncontrado(res?.historial || []);
                return;
            }

            const p = res.data;
            document.getElementById("nombres").value = p.nombres || "";
            document.getElementById("apellidos").value = p.apellidos || "";
            document.getElementById("telefono").value = p.telefono || "";
            document.getElementById("sexo").value = p.sexo || "";
            document.getElementById("tipo_persona").value = p.tipo_persona || "";
            document.getElementById("organizacion").value = p.organizacion || "";
            document.getElementById("finca_ha").value = p.finca_ha || "";
            document.getElementById("referencia").value = p.referencia || "";
            document.getElementById("latitud").value = p.latitud || "";
            document.getElementById("longitud").value = p.longitud || "";

            document.getElementById("departamento").value = p.departamento || "";
            this.onDepartamentoChange();
            document.getElementById("distrito").value = p.distrito || "";
            this.onDistritoChange();
            document.getElementById("comunidad").value = p.comunidad || "";

            this.renderResumenEncontrado(p, res.historial || []);
        } catch (err) {
            this.els.btnBuscarCI.disabled = false;
            this.els.btnBuscarCI.textContent = "Buscar";
            this.toast("Error de red", "error");
        }
    },

    renderResumenEncontrado(persona, historial) {
        const target = this.els.productorResumen;
        target.classList.remove("empty");
        target.innerHTML = `
      <div class="mini-summary-grid">
        <div><b>Documento:</b> ${this.escapeHtml(persona.ci || "")}</div>
        <div><b>Actividad principal:</b> ${this.escapeHtml(persona.actividad_principal || "")}</div>
        <div><b>Ubicación:</b> ${this.escapeHtml([persona.departamento, persona.distrito, persona.comunidad].filter(Boolean).join(" / "))}</div>
        <div><b>Organización:</b> ${this.escapeHtml(persona.organizacion || "No registrada")}</div>
      </div>
      <div class="summary-history">
        <b>Últimas intervenciones</b>
        <ul>
          ${(historial || []).map(h => `
            <li>${this.escapeHtml(String(h.fecha || ""))} | ${this.escapeHtml(h.modulo || "")} | ${this.escapeHtml(h.detalle || "")}</li>
          `).join("") || "<li>Sin historial reciente.</li>"}
        </ul>
      </div>
    `;
    },

    renderResumenNoEncontrado(historial) {
        const target = this.els.productorResumen;
        target.classList.remove("empty");
        target.innerHTML = `
      <div><b>Documento no hallado en _PERSONAS.</b></div>
      <div>Puede registrar una nueva ficha.</div>
      <div class="summary-history">
        <b>Historial localizado</b>
        <ul>
          ${(historial || []).map(h => `
            <li>${this.escapeHtml(String(h.fecha || ""))} | ${this.escapeHtml(h.modulo || "")} | ${this.escapeHtml(h.detalle || "")}</li>
          `).join("") || "<li>Sin antecedentes localizados.</li>"}
        </ul>
      </div>
    `;
    },

    async guardarRegistro() {
        const form = document.getElementById("registroForm");
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const fd = new FormData(form);
        const payload = {};
        fd.forEach((v, k) => payload[k] = v);
        payload.registrado_por = this.usuarioActual?.nombre || "Laura";

        this.els.btnGuardar.disabled = true;
        this.els.btnGuardar.textContent = "Guardando...";

        try {
            const res = await this.apiCall("procesarRegistroWeb", { payload });
            this.els.btnGuardar.disabled = false;
            this.els.btnGuardar.textContent = "✅ Guardar en Base Central";

            if (!res || !res.success) {
                this.toast(res?.error || "No fue posible guardar", "error");
                return;
            }

            document.getElementById("formMsgContainer").innerHTML = `
              <div class="msg-success">
                Registro guardado correctamente. ID: <b>${this.escapeHtml(res.resumen_id || "")}</b>
              </div>
            `;
            form.reset();
            document.getElementById("fecha").value = new Date().toISOString().split("T")[0];

            const pc = this.els.productorResumen;
            if (pc) {
                pc.innerHTML = "Sin búsqueda realizada.";
                pc.classList.add("empty");
            }

            setTimeout(() => this.volverAlDashboard(), 2500);
        } catch (err) {
            this.els.btnGuardar.disabled = false;
            this.els.btnGuardar.textContent = "✅ Guardar en Base Central";
            this.toast("Fallo de conexión", "error");
        }
    },

    toast(msg, type = "info") {
        const target = document.getElementById("formMsgContainer") || document.body;
        target.innerHTML = `<div class="msg-${type === "error" ? "error" : "success"}">${this.escapeHtml(msg)}</div>`;
    },

    escapeHtml(str) {
        return String(str || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    },

    // --- CARGA DE TABLERO KPI ---
    async cargarDashboard(filtroModulo = 'TODOS') {
        const pm = document.getElementById('kpiPersonas');
        const pi = document.getElementById('kpiInterv');
        const pd = document.getElementById('kpiDptos');
        if (pm) pm.innerText = "...";
        if (pi) pi.innerText = "...";
        if (pd) pd.innerText = "...";

        try {
            const res = await this.apiCall("getDashboardMetrics", { filtroModulo });
            if (pm) pm.innerText = res.totalProductores || 0;
            if (pi) pi.innerText = res.intervencionesRecientes || 0;
            if (pd) pd.innerText = Object.keys(res.dptosAcumulados || {}).length;

            this.dibujarGraficos(res);
        } catch (err) {
            console.error('Error cargando tablero', err);
        }
    },

    dibujarGraficos(res) {
        if (typeof Chart === 'undefined') return;

        Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
        Chart.defaults.color = '#64748b';

        // --- 1. CHart Modulos (Doughnut) ---
        const modCtxEl = document.getElementById('chartModulos');
        if (modCtxEl) {
            const modCtx = modCtxEl.getContext('2d');
            if (this.chartInstances.mod) this.chartInstances.mod.destroy();

            const coloresMod = {
                'APICULTURA': '#f59e0b',
                'AGRICOLA': '#10b981',
                'FORESTAL': '#065f46',
                'INDIGENA': '#0ea5e9',
                'OTRO': '#64748b'
            };

            const labelsMod = Object.keys(res.modulosAcumulados || {});
            const dataMod = Object.values(res.modulosAcumulados || {});
            const bgMod = labelsMod.map(l => coloresMod[l] || coloresMod['OTRO']);

            this.chartInstances.mod = new Chart(modCtx, {
                type: 'doughnut',
                data: {
                    labels: labelsMod,
                    datasets: [{
                        data: dataMod,
                        backgroundColor: bgMod,
                        borderWidth: 4,
                        borderColor: '#ffffff',
                        hoverOffset: 6
                    }]
                },
                options: {
                    maintainAspectRatio: false,
                    cutout: '70%',
                    plugins: {
                        legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, padding: 20, font: { weight: '600' } } },
                        tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', padding: 12, cornerRadius: 8, titleFont: { size: 14 } }
                    }
                }
            });
        }

        // --- NUEVO: Chart Sexo (Pie) ---
        const sexCtxEl = document.getElementById('chartSexo');
        if (sexCtxEl) {
            const sexCtx = sexCtxEl.getContext('2d');
            if (this.chartInstances.sexo) this.chartInstances.sexo.destroy();
            const coloresSexo = { 'Femenino': '#0ea5e9', 'Masculino': '#10b981', 'Otro': '#64748b' };
            const labelsSexo = Object.keys(res.sexoAcumulado || {});
            const dataSexo = Object.values(res.sexoAcumulado || {});
            this.chartInstances.sexo = new Chart(sexCtx, {
                type: 'pie',
                data: {
                    labels: labelsSexo,
                    datasets: [{ data: dataSexo, backgroundColor: labelsSexo.map(l => coloresSexo[l] || coloresSexo['Otro']), borderWidth: 2, borderColor: '#ffffff' }]
                },
                options: { maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
            });
        }

        // --- 2. Chart Dptos (Bar) ---
        const dptCtxEl = document.getElementById('chartDptos');
        if (dptCtxEl) {
            const dptCtx = dptCtxEl.getContext('2d');
            if (this.chartInstances.dpt) this.chartInstances.dpt.destroy();

            const gradientBar = dptCtx.createLinearGradient(0, 0, 0, 400);
            gradientBar.addColorStop(0, '#059669');
            gradientBar.addColorStop(1, '#064e3b');

            this.chartInstances.dpt = new Chart(dptCtx, {
                type: 'bar',
                data: {
                    labels: Object.keys(res.dptosAcumulados || {}),
                    datasets: [{
                        label: 'Productores',
                        data: Object.values(res.dptosAcumulados || {}),
                        backgroundColor: gradientBar,
                        borderRadius: 6,
                        barPercentage: 0.6
                    }]
                },
                options: {
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', padding: 12, cornerRadius: 8 }
                    },
                    scales: {
                        x: { grid: { display: false }, border: { display: false }, ticks: { font: { weight: '600' } } },
                        y: { grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false }, border: { display: false }, beginAtZero: true }
                    }
                }
            });
        }

        // --- 3. Chart Timeline (Line) ---
        const timeCtxEl = document.getElementById('chartTimeline');
        if (timeCtxEl) {
            const timeCtx = timeCtxEl.getContext('2d');
            if (this.chartInstances.time) this.chartInstances.time.destroy();

            const meses = Object.keys(res.timeline || {}).sort();
            const valores = meses.map(m => res.timeline[m]);

            const gradientLine = timeCtx.createLinearGradient(0, 0, 0, 400);
            gradientLine.addColorStop(0, 'rgba(234, 88, 12, 0.25)');
            gradientLine.addColorStop(1, 'rgba(234, 88, 12, 0.0)');

            this.chartInstances.time = new Chart(timeCtx, {
                type: 'line',
                data: {
                    labels: meses,
                    datasets: [{
                        label: 'Nuevas Intervenciones',
                        data: valores,
                        borderColor: '#ea580c',
                        backgroundColor: gradientLine,
                        fill: true,
                        tension: 0.4,
                        borderWidth: 3,
                        pointBackgroundColor: '#ffffff',
                        pointBorderColor: '#ea580c',
                        pointBorderWidth: 2,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }]
                },
                options: {
                    maintainAspectRatio: false,
                    interaction: { intersect: false, mode: 'index' },
                    plugins: {
                        legend: { display: false },
                        tooltip: { backgroundColor: 'rgba(15, 23, 42, 0.9)', padding: 12, cornerRadius: 8 }
                    },
                    scales: {
                        x: { grid: { display: false }, border: { display: false }, ticks: { font: { weight: '600' } } },
                        y: { grid: { color: 'rgba(0,0,0,0.03)', drawBorder: false }, border: { display: false }, beginAtZero: true }
                    }
                }
            });
        }

        // --- 4. DATA TABLES SUMMARY ---
        const tbdRecientes = document.getElementById('tablaRecientes');
        if (tbdRecientes) {
            if (!res.recientes || res.recientes.length === 0) {
                tbdRecientes.innerHTML = `<tr><td colspan="3" style="text-align:center; padding:12px;">Sin datos recientes</td></tr>`;
            } else {
                tbdRecientes.innerHTML = res.recientes.map(r => `
                        <tr style="border-bottom: 1px solid var(--border-light);">
                            <td style="padding: 12px 24px; color:#475569; font-size:0.85rem;">${this.escapeHtml(r.fecha)}</td>
                            <td style="padding: 12px 24px; font-weight:500;">${this.escapeHtml(r.nombre)}</td>
                            <td style="padding: 12px 24px;">
                                <span style="background:var(--bg-color); color:var(--primary); padding:2px 8px; border-radius:12px; font-size:0.75rem;">${this.escapeHtml(r.modulo)}</span>
                            </td>
                        </tr>
                    `).join('');
            }
        }

        const tbdOrgs = document.getElementById('tablaTopOrgs');
        if (tbdOrgs) {
            const topOrgsArr = Object.entries(res.topOrgs || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
            if (topOrgsArr.length === 0) {
                tbdOrgs.innerHTML = `<tr><td colspan="2" style="text-align:center; padding:12px;">Sin datos</td></tr>`;
            } else {
                tbdOrgs.innerHTML = topOrgsArr.map(o => `
                        <tr style="border-bottom: 1px solid var(--border-light);">
                            <td style="padding: 12px 24px;">${this.escapeHtml(o[0])}</td>
                            <td style="padding: 12px 24px; text-align:right; font-weight:600; color:var(--primary);">${o[1]}</td>
                        </tr>
                    `).join('');
            }
        }
    },

    // --- BASE DE DATOS (CONSULTA) ---
    async cargarTablaConsulta() {
        const tbody = document.getElementById('tbodyConsulta');
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #94a3b8;">Cargando datos históricos... ⏳</td></tr>`;

        try {
            const res = await this.apiCall("getIntervencionesData");
            this.tablaConsultaData = res || [];
            this.filtrarTablaConsulta();
        } catch (err) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #ef4444;">Error de conexión.</td></tr>`;
        }
    },

    renderTablaConsulta(dataArray) {
        const tbody = document.getElementById('tbodyConsulta');
        if (!tbody) return;
        if (!dataArray || dataArray.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #64748b;">No se encontraron registros.</td></tr>`;
            return;
        }

        tbody.innerHTML = dataArray.map(r => `
          <tr style="border-bottom: 1px solid var(--border-light); transition: background 0.2s;">
            <td style="padding: 12px 16px; color: #475569;">${this.escapeHtml(r.fecha)}</td>
            <td style="padding: 12px 16px; font-weight: 500;">${this.escapeHtml(r.documento)}</td>
            <td style="padding: 12px 16px;">${this.escapeHtml(r.nombre)}</td>
            <td style="padding: 12px 16px;">
                <span style="background: var(--bg-color); color: var(--primary); padding: 4px 8px; border-radius: 12px; font-size: 0.8rem; font-weight: 600;">
                    ${this.escapeHtml(r.modulo)}
                </span>
            </td>
            <td style="padding: 12px 16px; color: #475569;">${this.escapeHtml(r.comunidad)}</td>
            <td style="padding: 12px 16px; color: #64748b; font-size: 0.85rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${this.escapeHtml(r.detalle)}">
                ${this.escapeHtml(r.detalle)}
            </td>
          </tr>
      `).join('');
    },

    filtrarTablaConsulta() {
        const term = (document.getElementById('searchInput')?.value || "").trim().toLowerCase();
        let filtrado = this.tablaConsultaData;
        if (term) {
            filtrado = this.tablaConsultaData.filter(r => {
                return (r.nombre && r.nombre.toLowerCase().includes(term)) ||
                    (r.documento && String(r.documento).toLowerCase().includes(term)) ||
                    (r.modulo && r.modulo.toLowerCase().includes(term)) ||
                    (r.comunidad && r.comunidad.toLowerCase().includes(term)) ||
                    (r.detalle && r.detalle.toLowerCase().includes(term));
            });
        }
        this.aplicarOrdenamientoRender(filtrado);
    },

    ordenarTablaConsulta(col) {
        if (this.tablaConsultaSortBy === col) {
            this.tablaConsultaSortAsc = !this.tablaConsultaSortAsc;
        } else {
            this.tablaConsultaSortBy = col;
            this.tablaConsultaSortAsc = true;
        }
        this.filtrarTablaConsulta();
    },

    aplicarOrdenamientoRender(dataBase) {
        const col = this.tablaConsultaSortBy;
        dataBase.sort((a, b) => {
            let valA = String(a[col] || "").toLowerCase();
            let valB = String(b[col] || "").toLowerCase();
            if (valA < valB) return this.tablaConsultaSortAsc ? -1 : 1;
            if (valA > valB) return this.tablaConsultaSortAsc ? 1 : -1;
            return 0;
        });
        this.renderTablaConsulta(dataBase);
    }
};

document.addEventListener("DOMContentLoaded", () => app.init());

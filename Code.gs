/**
 * PARACEL - APP RENTA V3
 * Backend mejorado sobre el repositorio existente
 */

const TARGET_SPREADSHEET_ID = "1uI2M-cBDiUp5DhoGqGWw6y_tzI8yAzEbXjDj17apcj4";

const SHEET_PERSONAS = "_PERSONAS";
const SHEET_INTERVENCIONES = "_INTERVENCIONES";
const SHEET_AUDITORIA = "_AUDITORIA";
const SHEET_INDEX = "_LEGADO_INDEX";

const PERSONAS_HEADERS = [
  "ID_Documento",
  "Nombres",
  "Apellidos",
  "Departamento",
  "Distrito",
  "Comunidad",
  "Telefono",
  "Sexo",
  "Tipo_Persona",
  "Organizacion",
  "Finca_Ha",
  "Referencia",
  "Latitud",
  "Longitud",
  "Tipo_Actividad_Principal",
  "Ultima_Actualizacion"
];

const INTERV_HEADERS = [
  "Resumen_ID",
  "Fecha_Hora",
  "Tecnico",
  "Modulo",
  "Documento_Productor",
  "Nombre_Productor",
  "Departamento",
  "Distrito",
  "Comunidad",
  "Organizacion",
  "Detalle_Accion",
  "Comentarios",
  "Estado_Seguimiento",
  "Proxima_Visita"
];

const MODULE_HEADERS = {
  APICULTURA: [
    "Timestamp",
    "Resumen_ID",
    "Documento",
    "Responsable",
    "Fecha",
    "Departamento",
    "Distrito",
    "Comunidad",
    "Organizacion",
    "Tipo_Proyecto",
    "Asistencia",
    "Cantidad_Colmenas",
    "Cantidad_Cajas",
    "Estado_Productivo",
    "Comentario"
  ],
  AGRICOLA: [
    "Timestamp",
    "Resumen_ID",
    "Documento",
    "Responsable",
    "Fecha",
    "Departamento",
    "Distrito",
    "Comunidad",
    "Organizacion",
    "Rubro",
    "Estado_Proyecto",
    "Superficie_Ha",
    "Etapa",
    "Asistencia",
    "Comentario"
  ],
  FORESTAL: [
    "Timestamp",
    "Resumen_ID",
    "Documento",
    "Responsable",
    "Fecha",
    "Departamento",
    "Distrito",
    "Comunidad",
    "Organizacion",
    "Especie",
    "Cantidad",
    "Superficie_Ha",
    "Tipo_Sistema",
    "Asistencia",
    "Comentario"
  ],
  INDIGENA: [
    "Timestamp",
    "Resumen_ID",
    "Documento",
    "Responsable",
    "Fecha",
    "Departamento",
    "Distrito",
    "Comunidad",
    "Organizacion",
    "Etnia",
    "Pueblo",
    "Tipo_Asistencia",
    "Beneficiarios_Hogar",
    "Lider",
    "Comentario"
  ]
};

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function handleRequest(requestData) {
  try {
    const accion = requestData.accion;
    if (!accion) throw new Error("Acción no especificada");

    switch (accion) {
      case "verificarLogin":
        return verificarLogin(requestData.user, requestData.pass);
      case "getCatalogosAvanzados":
        return getCatalogosAvanzados();
      case "buscarProductorDetallado":
        return buscarProductorDetallado(requestData.ci);
      case "procesarRegistroWeb":
        return procesarRegistroWeb(requestData.payload);
      case "getDashboardMetrics":
        return getDashboardMetrics(requestData.filtroModulo);
      case "getIntervencionesData":
        return getIntervencionesData();
      default:
        throw new Error("Acción desconocida: " + accion);
    }
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function doPost(e) {
  let requestData = {};
  if (e && e.postData && e.postData.contents) {
    try {
      requestData = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return responseJSON({ success: false, error: "JSON inválido" });
    }
  }
  return responseJSON(handleRequest(requestData));
}

function doGet(e) {
  // Soporte para pruebas GET
  const req = (e && e.parameter) ? e.parameter : {};
  return responseJSON(handleRequest(req));
}

function verificarLogin(user, pass) {
  try {
    const usr = String(user || "").trim().toLowerCase();
    const pwd = String(pass || "").trim();

    if (usr === "laura" && pwd === "renta2026") {
      logAuditoria(usr, "LOGIN", "Inicio de sesión exitoso");
      return { success: true, user: { nombre: "Laura", rol: "admin" } };
    }

    logAuditoria(usr, "LOGIN_FAILED", "Intento fallido");
    return { success: false, error: "Credenciales inválidas" };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function logAuditoria(usuario, accion, detalle) {
  try {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    const sh = getOrCreateSheet(ss, SHEET_AUDITORIA, ["Timestamp", "Usuario", "Accion", "Detalle"]);
    sh.appendRow([new Date(), usuario, accion, detalle]);
  } catch (e) {}
}

function getOrCreateSheet(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    formatHeader_(sh, headers.length);
    sh.setFrozenRows(1);
  } else {
    ensureHeaders_(sh, headers);
  }
  return sh;
}

function ensureHeaders_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const current = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  headers.forEach(h => {
    if (current.indexOf(h) === -1) {
      sheet.getRange(1, current.length + 1).setValue(h);
      current.push(h);
    }
  });
  formatHeader_(sheet, current.length);
}

function formatHeader_(sheet, nCols) {
  sheet.getRange(1, 1, 1, nCols)
    .setFontWeight("bold")
    .setBackground("#0b5d4b")
    .setFontColor("#ffffff");
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, i) => map[String(h)] = i);
  return map;
}

function buildEmptyRow_(headers) {
  return new Array(headers.length).fill("");
}

function normalizeText_(x) {
  return String(x || "")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeKey_(x) {
  return normalizeText_(x).toUpperCase();
}

function uniqueSorted_(arr) {
  return Array.from(new Set(arr.filter(v => normalizeText_(v) !== ""))).sort((a, b) => String(a).localeCompare(String(b), "es"));
}

function getCatalogosAvanzados() {
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const shPer = getOrCreateSheet(ss, SHEET_PERSONAS, PERSONAS_HEADERS);
  const shForestal = ss.getSheetByName("APP_FORESTAL");
  const shAgricola = ss.getSheetByName("APP_AGRICOLA");
  const shApi = ss.getSheetByName("APP_APICULTURA");

  const data = shPer.getLastRow() > 1 ? shPer.getDataRange().getValues() : [];
  const hm = headerMap_(shPer);

  const departamentos = [];
  const distritosByDepartamento = {};
  const comunidadesByDeptoDistrito = {};
  const organizaciones = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dep = normalizeText_(row[hm["Departamento"]]);
    const dis = normalizeText_(row[hm["Distrito"]]);
    const com = normalizeText_(row[hm["Comunidad"]]);
    const org = normalizeText_(row[hm["Organizacion"]]);

    if (dep) departamentos.push(dep);

    if (dep && dis) {
      if (!distritosByDepartamento[dep]) distritosByDepartamento[dep] = [];
      distritosByDepartamento[dep].push(dis);
    }

    if (dep && dis && com) {
      const key = dep + "|||" + dis;
      if (!comunidadesByDeptoDistrito[key]) comunidadesByDeptoDistrito[key] = [];
      comunidadesByDeptoDistrito[key].push(com);
    }

    if (org) organizaciones.push(org);
  }

  Object.keys(distritosByDepartamento).forEach(k => {
    distritosByDepartamento[k] = uniqueSorted_(distritosByDepartamento[k]);
  });

  Object.keys(comunidadesByDeptoDistrito).forEach(k => {
    comunidadesByDeptoDistrito[k] = uniqueSorted_(comunidadesByDeptoDistrito[k]);
  });

  const especies = ["Eucalipto", "Pino", "Especies nativas", "Frutales", "Yerba mate"];
  const rubros = ["Mandioca", "Maíz", "Poroto", "Tomate", "Sésamo", "Hortalizas", "Sandía", "Otros"];
  const etnias = ["Ayoreo", "Mbya Guaraní", "Ava Guaraní", "Nivaclé", "Enxet", "Guaná", "Sanapaná", "Otros"];
  const tiposProyecto = ["Individual", "Asociativo", "Comunitario"];
  const estadosProyecto = ["Diagnóstico", "Implementada", "En seguimiento", "Finalizada"];
  const etapasAgricolas = ["Preparación", "Siembra", "Mantenimiento", "Cosecha", "Postcosecha"];
  const tiposSistemaForestal = ["Plantación", "Enriquecimiento", "Agroforestal", "Silvopastoril", "Protección"];
  const tiposAsistencia = ["Capacitación", "Asistencia técnica", "Entrega de insumos", "Visita de seguimiento", "Levantamiento de datos"];
  const sexos = ["F", "M", "No especifica"];
  const tiposPersona = ["Productor", "Productora", "Comité", "Asociación", "Comunidad", "Otro"];
  const estadosSeguimiento = ["Abierto", "En seguimiento", "Cerrado"];

  return {
    departamentos: uniqueSorted_(departamentos),
    distritosByDepartamento,
    comunidadesByDeptoDistrito,
    organizaciones: uniqueSorted_(organizaciones),
    especies,
    rubros,
    etnias,
    tiposProyecto,
    estadosProyecto,
    etapasAgricolas,
    tiposSistemaForestal,
    tiposAsistencia,
    sexos,
    tiposPersona,
    estadosSeguimiento
  };
}

function buscarProductorDetallado(ci) {
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const shPer = getOrCreateSheet(ss, SHEET_PERSONAS, PERSONAS_HEADERS);
  const shInt = getOrCreateSheet(ss, SHEET_INTERVENCIONES, INTERV_HEADERS);

  const ciKey = normalizeKey_(ci);
  const dataPer = shPer.getLastRow() > 1 ? shPer.getDataRange().getValues() : [];
  const hmPer = headerMap_(shPer);

  let persona = null;
  for (let i = dataPer.length - 1; i >= 1; i--) {
    if (normalizeKey_(dataPer[i][hmPer["ID_Documento"]]) === ciKey) {
      persona = {
        ci: normalizeText_(dataPer[i][hmPer["ID_Documento"]]),
        nombres: normalizeText_(dataPer[i][hmPer["Nombres"]]),
        apellidos: normalizeText_(dataPer[i][hmPer["Apellidos"]]),
        departamento: normalizeText_(dataPer[i][hmPer["Departamento"]]),
        distrito: normalizeText_(dataPer[i][hmPer["Distrito"]]),
        comunidad: normalizeText_(dataPer[i][hmPer["Comunidad"]]),
        telefono: normalizeText_(dataPer[i][hmPer["Telefono"]]),
        sexo: normalizeText_(dataPer[i][hmPer["Sexo"]]),
        tipo_persona: normalizeText_(dataPer[i][hmPer["Tipo_Persona"]]),
        organizacion: normalizeText_(dataPer[i][hmPer["Organizacion"]]),
        finca_ha: normalizeText_(dataPer[i][hmPer["Finca_Ha"]]),
        referencia: normalizeText_(dataPer[i][hmPer["Referencia"]]),
        latitud: normalizeText_(dataPer[i][hmPer["Latitud"]]),
        longitud: normalizeText_(dataPer[i][hmPer["Longitud"]]),
        actividad_principal: normalizeText_(dataPer[i][hmPer["Tipo_Actividad_Principal"]]),
        ultima_actualizacion: dataPer[i][hmPer["Ultima_Actualizacion"]]
      };
      break;
    }
  }

  const dataInt = shInt.getLastRow() > 1 ? shInt.getDataRange().getValues() : [];
  const hmInt = headerMap_(shInt);

  const historial = [];
  for (let i = dataInt.length - 1; i >= 1; i--) {
    if (normalizeKey_(dataInt[i][hmInt["Documento_Productor"]]) === ciKey) {
      historial.push({
        fecha: dataInt[i][hmInt["Fecha_Hora"]],
        modulo: dataInt[i][hmInt["Modulo"]],
        detalle: dataInt[i][hmInt["Detalle_Accion"]],
        comunidad: dataInt[i][hmInt["Comunidad"]],
        tecnico: dataInt[i][hmInt["Tecnico"]]
      });
      if (historial.length === 5) break;
    }
  }

  if (!persona) {
    return { success: false, msg: "No encontrado", historial };
  }

  return { success: true, data: persona, historial };
}

function procesarRegistroWeb(registro) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);

    const shPer = getOrCreateSheet(ss, SHEET_PERSONAS, PERSONAS_HEADERS);
    const shInt = getOrCreateSheet(ss, SHEET_INTERVENCIONES, INTERV_HEADERS);

    const modulo = normalizeKey_(registro.modulo);
    if (!MODULE_HEADERS[modulo]) {
      throw new Error("Módulo no válido: " + modulo);
    }

    const shModule = getOrCreateSheet(ss, "APP_" + modulo, MODULE_HEADERS[modulo]);

    const timestamp = new Date();
    const ci = normalizeText_(registro.ci);
    const nombreCompleto = [normalizeText_(registro.nombres), normalizeText_(registro.apellidos)].join(" ").trim();
    const resumenID = modulo + "-" + Utilities.getUuid().slice(0, 8).toUpperCase();

    // --- UPSERT _PERSONAS ---
    const perData = shPer.getLastRow() > 1 ? shPer.getDataRange().getValues() : [];
    const hmPer = headerMap_(shPer);

    let rowIndex = -1;
    for (let i = 1; i < perData.length; i++) {
      if (normalizeKey_(perData[i][hmPer["ID_Documento"]]) === normalizeKey_(ci)) {
        rowIndex = i + 1;
        break;
      }
    }

    const perHeaders = shPer.getRange(1, 1, 1, shPer.getLastColumn()).getValues()[0];
    const rowPersona = buildEmptyRow_(perHeaders);

    rowPersona[hmPer["ID_Documento"]] = ci;
    rowPersona[hmPer["Nombres"]] = normalizeText_(registro.nombres);
    rowPersona[hmPer["Apellidos"]] = normalizeText_(registro.apellidos);
    rowPersona[hmPer["Departamento"]] = normalizeText_(registro.departamento);
    rowPersona[hmPer["Distrito"]] = normalizeText_(registro.distrito);
    rowPersona[hmPer["Comunidad"]] = normalizeText_(registro.comunidad);
    rowPersona[hmPer["Telefono"]] = normalizeText_(registro.telefono);
    rowPersona[hmPer["Sexo"]] = normalizeText_(registro.sexo);
    rowPersona[hmPer["Tipo_Persona"]] = normalizeText_(registro.tipo_persona);
    rowPersona[hmPer["Organizacion"]] = normalizeText_(registro.organizacion);
    rowPersona[hmPer["Finca_Ha"]] = normalizeText_(registro.finca_ha);
    rowPersona[hmPer["Referencia"]] = normalizeText_(registro.referencia);
    rowPersona[hmPer["Latitud"]] = normalizeText_(registro.latitud);
    rowPersona[hmPer["Longitud"]] = normalizeText_(registro.longitud);
    rowPersona[hmPer["Tipo_Actividad_Principal"]] = modulo;
    rowPersona[hmPer["Ultima_Actualizacion"]] = timestamp;

    if (rowIndex > -1) {
      shPer.getRange(rowIndex, 1, 1, rowPersona.length).setValues([rowPersona]);
    } else {
      shPer.appendRow(rowPersona);
    }

    // --- _INTERVENCIONES ---
    const hmInt = headerMap_(shInt);
    const intHeaders = shInt.getRange(1, 1, 1, shInt.getLastColumn()).getValues()[0];
    const rowInt = buildEmptyRow_(intHeaders);

    rowInt[hmInt["Resumen_ID"]] = resumenID;
    rowInt[hmInt["Fecha_Hora"]] = registro.fecha || timestamp;
    rowInt[hmInt["Tecnico"]] = normalizeText_(registro.registrado_por || "Laura");
    rowInt[hmInt["Modulo"]] = modulo;
    rowInt[hmInt["Documento_Productor"]] = ci;
    rowInt[hmInt["Nombre_Productor"]] = nombreCompleto;
    rowInt[hmInt["Departamento"]] = normalizeText_(registro.departamento);
    rowInt[hmInt["Distrito"]] = normalizeText_(registro.distrito);
    rowInt[hmInt["Comunidad"]] = normalizeText_(registro.comunidad);
    rowInt[hmInt["Organizacion"]] = normalizeText_(registro.organizacion);
    rowInt[hmInt["Detalle_Accion"]] = buildDetalleIntervencion_(modulo, registro);
    rowInt[hmInt["Comentarios"]] = normalizeText_(registro.comentario);
    rowInt[hmInt["Estado_Seguimiento"]] = normalizeText_(registro.estado_seguimiento);
    rowInt[hmInt["Proxima_Visita"]] = normalizeText_(registro.proxima_visita);

    shInt.appendRow(rowInt);

    // --- APP_MODULO ---
    const hmMod = headerMap_(shModule);
    const modHeaders = shModule.getRange(1, 1, 1, shModule.getLastColumn()).getValues()[0];
    const rowMod = buildEmptyRow_(modHeaders);

    rowMod[hmMod["Timestamp"]] = timestamp;
    rowMod[hmMod["Resumen_ID"]] = resumenID;
    rowMod[hmMod["Documento"]] = ci;
    rowMod[hmMod["Responsable"]] = normalizeText_(registro.registrado_por || "Laura");
    rowMod[hmMod["Fecha"]] = registro.fecha || timestamp;
    rowMod[hmMod["Departamento"]] = normalizeText_(registro.departamento);
    rowMod[hmMod["Distrito"]] = normalizeText_(registro.distrito);
    rowMod[hmMod["Comunidad"]] = normalizeText_(registro.comunidad);
    rowMod[hmMod["Organizacion"]] = normalizeText_(registro.organizacion);
    rowMod[hmMod["Comentario"]] = normalizeText_(registro.comentario);

    if (modulo === "APICULTURA") {
      rowMod[hmMod["Tipo_Proyecto"]] = normalizeText_(registro.tipo_proyecto);
      rowMod[hmMod["Asistencia"]] = normalizeText_(registro.asistencia);
      rowMod[hmMod["Cantidad_Colmenas"]] = normalizeText_(registro.cantidad_colmenas);
      rowMod[hmMod["Cantidad_Cajas"]] = normalizeText_(registro.cantidad_cajas);
      rowMod[hmMod["Estado_Productivo"]] = normalizeText_(registro.estado_productivo);
    }

    if (modulo === "AGRICOLA") {
      rowMod[hmMod["Rubro"]] = normalizeText_(registro.rubro);
      rowMod[hmMod["Estado_Proyecto"]] = normalizeText_(registro.estado_proyecto);
      rowMod[hmMod["Superficie_Ha"]] = normalizeText_(registro.superficie_ha);
      rowMod[hmMod["Etapa"]] = normalizeText_(registro.etapa);
      rowMod[hmMod["Asistencia"]] = normalizeText_(registro.asistencia);
    }

    if (modulo === "FORESTAL") {
      rowMod[hmMod["Especie"]] = normalizeText_(registro.especie);
      rowMod[hmMod["Cantidad"]] = normalizeText_(registro.cantidad);
      rowMod[hmMod["Superficie_Ha"]] = normalizeText_(registro.superficie_ha);
      rowMod[hmMod["Tipo_Sistema"]] = normalizeText_(registro.tipo_sistema);
      rowMod[hmMod["Asistencia"]] = normalizeText_(registro.asistencia);
    }

    if (modulo === "INDIGENA") {
      rowMod[hmMod["Etnia"]] = normalizeText_(registro.etnia);
      rowMod[hmMod["Pueblo"]] = normalizeText_(registro.pueblo);
      rowMod[hmMod["Tipo_Asistencia"]] = normalizeText_(registro.tipo_asistencia);
      rowMod[hmMod["Beneficiarios_Hogar"]] = normalizeText_(registro.beneficiarios_hogar);
      rowMod[hmMod["Lider"]] = normalizeText_(registro.lider);
    }

    shModule.appendRow(rowMod);

    logAuditoria(registro.registrado_por || "Laura", "FORM_SUBMIT", "Módulo: " + modulo + " | Doc: " + ci);

    return { success: true, resumen_id: resumenID };
  } catch (e) {
    logAuditoria(registro && registro.registrado_por ? registro.registrado_por : "Laura", "FORM_ERROR", e.toString());
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

function buildDetalleIntervencion_(modulo, registro) {
  if (modulo === "APICULTURA") {
    return [
      registro.tipo_proyecto,
      registro.asistencia,
      registro.cantidad_colmenas ? ("Colmenas: " + registro.cantidad_colmenas) : "",
      registro.cantidad_cajas ? ("Cajas: " + registro.cantidad_cajas) : ""
    ].filter(Boolean).join(" | ");
  }

  if (modulo === "AGRICOLA") {
    return [
      registro.rubro,
      registro.estado_proyecto,
      registro.etapa,
      registro.superficie_ha ? ("Ha: " + registro.superficie_ha) : ""
    ].filter(Boolean).join(" | ");
  }

  if (modulo === "FORESTAL") {
    return [
      registro.especie,
      registro.tipo_sistema,
      registro.cantidad ? ("Cantidad: " + registro.cantidad) : "",
      registro.superficie_ha ? ("Ha: " + registro.superficie_ha) : ""
    ].filter(Boolean).join(" | ");
  }

  if (modulo === "INDIGENA") {
    return [
      registro.etnia,
      registro.pueblo,
      registro.tipo_asistencia,
      registro.beneficiarios_hogar ? ("Hogar: " + registro.beneficiarios_hogar) : ""
    ].filter(Boolean).join(" | ");
  }

  return "Intervención registrada";
}

function getDashboardMetrics(filtroModulo) {
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const shPer = getOrCreateSheet(ss, SHEET_PERSONAS, PERSONAS_HEADERS);
  const shInt = getOrCreateSheet(ss, SHEET_INTERVENCIONES, INTERV_HEADERS);
  const modulo = normalizeKey_(filtroModulo || "TODOS");
  const perData = shPer.getLastRow() > 1 ? shPer.getDataRange().getValues() : [];
  const intData = shInt.getLastRow() > 1 ? shInt.getDataRange().getValues() : [];
  const hmPer = headerMap_(shPer);
  const hmInt = headerMap_(shInt);
  const out = {
    totalProductores: 0,
    intervencionesRecientes: 0,
    dptosAcumulados: {},
    distritosAcumulados: {},
    modulosAcumulados: {},
    sexoAcumulado: { "Femenino": 0, "Masculino": 0, "Otro": 0 },
    topOrgs: {},
    timeline: {},
    recientes: []
  };
  for (let i = 1; i < perData.length; i++) {
    const act = normalizeKey_(perData[i][hmPer["Tipo_Actividad_Principal"]]);
    if (modulo === "TODOS" || act === modulo || act.indexOf(modulo) > -1) {
      out.totalProductores++;
      const org = normalizeText_(perData[i][hmPer["Organizacion"]]);
      if (org && org !== "No especifica") out.topOrgs[org] = (out.topOrgs[org] || 0) + 1;
      let sexo = normalizeText_(perData[i][hmPer["Sexo"]]).toUpperCase();
      if (sexo.startsWith("F")) out.sexoAcumulado["Femenino"]++;
      else if (sexo.startsWith("M")) out.sexoAcumulado["Masculino"]++;
      else out.sexoAcumulado["Otro"]++;
    }
  }
  for (let i = intData.length - 1; i >= 1; i--) {
    const mod = normalizeKey_(intData[i][hmInt["Modulo"]]);
    if (modulo !== "TODOS" && mod !== modulo && mod.indexOf(modulo) === -1) continue;
    out.intervencionesRecientes++;
    out.modulosAcumulados[mod] = (out.modulosAcumulados[mod] || 0) + 1;
    const depto = normalizeText_(intData[i][hmInt["Departamento"]]);
    if (depto) out.dptosAcumulados[depto] = (out.dptosAcumulados[depto] || 0) + 1;
    const dist = normalizeText_(intData[i][hmInt["Distrito"]]);
    if (dist) out.distritosAcumulados[dist] = (out.distritosAcumulados[dist] || 0) + 1;
    
    const fechaInt = intData[i][hmInt["Fecha_Hora"]];
    if (fechaInt) {
      const fecha = new Date(fechaInt);
      if (!isNaN(fecha)) {
        const k = fecha.getFullYear() + "-" + String(fecha.getMonth() + 1).padStart(2, "0");
        out.timeline[k] = (out.timeline[k] || 0) + 1;
      }
    }
    if (out.recientes.length < 8) {
      let fStr = "";
      if (fechaInt instanceof Date) { fStr = fechaInt.toISOString().split("T")[0]; }
      else { fStr = String(fechaInt || "").substring(0, 10); }
      out.recientes.push({
        fecha: fStr,
        modulo: intData[i][hmInt["Modulo"]],
        nombre: intData[i][hmInt["Nombre_Productor"]],
        detalle: intData[i][hmInt["Detalle_Accion"]]
      });
    }
  }
  return out;
}

function getIntervencionesData() {
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_INTERVENCIONES);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getDisplayValues();
  const headers = data[0];
  const rows = [];
  for (let i = data.length - 1; i >= 1; i--) {
    const row = {};
    headers.forEach((h, j) => {
      row[h] = data[i][j];
    });
    rows.push({
      fecha: row["Fecha_Hora"] ? String(row["Fecha_Hora"]).substring(0, 10) : "",
      modulo: row["Modulo"],
      documento: row["Documento_Productor"],
      nombre: row["Nombre_Productor"],
      comunidad: row["Comunidad"],
      detalle: row["Detalle_Accion"],
      tecnico: row["Tecnico"]
    });
  }
  return rows;
}

```

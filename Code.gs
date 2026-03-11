/**
 * PARACEL - APP RENTA BACKEND V2 (Google Apps Script)
 * Hoja destino: 1uI2M-cBDiUp5DhoGqGWw6y_tzI8yAzEbXjDj17apcj4
 */

const TARGET_SPREADSHEET_ID = "1uI2M-cBDiUp5DhoGqGWw6y_tzI8yAzEbXjDj17apcj4";

// Nombres de las hojas maestras
const SHEET_PERSONAS = "_PERSONAS";
const SHEET_INTERVENCIONES = "_INTERVENCIONES";
const SHEET_AUDITORIA = "_AUDITORIA";
const SHEET_INDEX = "_LEGADO_INDEX";

/**
 * Sirve la PWA cuando se accede a la URL Web.
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('App Renta | Paracel V2')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Función helper para inyectar CSS y JS en el HTML principal.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Verifica el inicio de sesión.
 */
function verificarLogin(user, pass) {
  try {
    const usr = user.trim().toLowerCase();
    const pwd = pass.trim();
    if (usr === 'laura' && pwd === 'renta2026') {
      logAuditoria(usr, "LOGIN", "Inicio de sesión exitoso");
      return { success: true, user: { nombre: 'Laura', rol: 'admin' } };
    }
    logAuditoria(usr, "LOGIN_FAILED", "Intento fallido");
    return { success: false, error: 'Credenciales inválidas' };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * Registra acciones en la hoja de auditoría
 */
function logAuditoria(usuario, accion, detalle) {
  try {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_AUDITORIA) || crearHojaBase(ss, SHEET_AUDITORIA, ["Timestamp", "Usuario", "Accion", "Detalle"]);
    sheet.appendRow([new Date().toISOString(), usuario, accion, detalle]);
  } catch (e) {
    // Silencioso
  }
}

/**
 * Crea una hoja con cabeceras estándar si no existe
 */
function crearHojaBase(ss, name, headers) {
  let sheet = ss.insertSheet(name);
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#e0e0e0");
  sheet.setFrozenRows(1);
  return sheet;
}

/**
 * Obtiene o crea las hojas del core relacional
 */
function initCoreSheets(ss) {
  let personas = ss.getSheetByName(SHEET_PERSONAS) || crearHojaBase(ss, SHEET_PERSONAS, ["ID_Documento", "Nombres", "Apellidos", "Departamento", "Distrito", "Comunidad", "Tipo_Actividad_Principal", "Ultima_Actualizacion"]);
  let intervenciones = ss.getSheetByName(SHEET_INTERVENCIONES) || crearHojaBase(ss, SHEET_INTERVENCIONES, ["Resumen_ID", "Fecha_Hora", "Tecnico", "Módulo", "Documento_Productor", "Nombre_Productor", "Comunidad", "Detalle_Accion"]);
  return { personas, intervenciones };
}

/**
 * Recibe los datos del formulario web y los distribuye en la estructura relacional (Persona -> Intervención -> Módulo App)
 */
function procesarRegistroWeb(registro) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000); // 15s para evitar colisiones
  
  try {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    const core = initCoreSheets(ss);
    
    const timestamp = new Date().toISOString();
    const ci = registro.ci.toString().trim().toUpperCase();
    const modulo = registro.modulo.toUpperCase();
    
    // 1. UPSERT (Update or Insert) en _PERSONAS
    const tPersonas = core.personas.getDataRange().getValues();
    let rowPersonaIndex = -1;
    for (let i = 1; i < tPersonas.length; i++) {
      if (tPersonas[i][0].toString().trim().toUpperCase() === ci) {
        rowPersonaIndex = i + 1;
        break;
      }
    }
    
    if (rowPersonaIndex > -1) {
      // Actualiza datos demográficos si cambió la comunidad
      core.personas.getRange(rowPersonaIndex, 4, 1, 5).setValues([[registro.departamento, registro.distrito, registro.comunidad, modulo, timestamp]]);
    } else {
      // Nueva persona
      core.personas.appendRow([
        ci, registro.nombres, registro.apellidos, registro.departamento, registro.distrito, registro.comunidad, modulo, timestamp
      ]);
    }
    
    // 2. INSERT en _INTERVENCIONES (Log centralizado de actividad cronológica)
    // Generar un ID único para amarrar la intervención con la tabla específica
    const resumenID = modulo + "-" + new Date().getTime().toString().slice(-6);
    // Armar detalle de intervención rápido dependiendo de los campos enviando
    let resumenAccion = "Registro Creado";
    if (modulo === 'APICULTURA') resumenAccion = `Proy. ${registro.tipo_proyecto} | ${registro.insumos}`;
    else if (modulo === 'AGRICOLA') resumenAccion = `${registro.estado_proyecto} | ${registro.rubro}`;
    else if (modulo === 'FORESTAL') resumenAccion = `${registro.cantidad} uds ${registro.especie}`;
    else if (modulo === 'INDIGENA') resumenAccion = `${registro.asistencia} | ${registro.etnia}`;
    
    core.intervenciones.appendRow([
      resumenID, registro.fecha, registro.registrado_por, modulo, ci, `${registro.nombres} ${registro.apellidos}`, registro.comunidad, resumenAccion
    ]);
    
    // 3. INSERT en la hoja ESPECÍFICA OPERATIVA del Módulo (APP_MÓDULO)
    const sheetNameOpt = "APP_" + modulo;
    let sheetOpt = ss.getSheetByName(sheetNameOpt);
    
    if (!sheetOpt) {
      let headers = ["Timestamp", "Resumen_ID", "Documento", "Responsable"];
      if (modulo === 'APICULTURA') headers.push("Tipo_Proyecto", "Insumos");
      else if (modulo === 'AGRICOLA') headers.push("Estado_Proyecto", "Rubro");
      else if (modulo === 'FORESTAL') headers.push("Especie", "Cantidad");
      else if (modulo === 'INDIGENA') headers.push("Etnia", "Asistencia");
      
      sheetOpt = crearHojaBase(ss, sheetNameOpt, headers);
    }
    
    let rowDataOpt = [timestamp, resumenID, ci, registro.registrado_por];
    if (modulo === 'APICULTURA') rowDataOpt.push(registro.tipo_proyecto, registro.insumos);
    else if (modulo === 'AGRICOLA') rowDataOpt.push(registro.estado_proyecto, registro.rubro);
    else if (modulo === 'FORESTAL') rowDataOpt.push(registro.especie, registro.cantidad);
    else if (modulo === 'INDIGENA') rowDataOpt.push(registro.etnia, registro.asistencia);
    
    sheetOpt.appendRow(rowDataOpt);

    logAuditoria(registro.registrado_por, "FORM_SUBMIT", `Módulo: ${modulo} | Doc: ${ci}`);
    return { success: true };
    
  } catch(e) {
    logAuditoria("SYSTEM", "ERROR", e.toString());
    return { success: false, error: e.toString() };
  } finally {
    lock.releaseLock();
  }
}

/**
 * RECONSTRUIR ÍNDICE HISTÓRICO (Diccionario para Prefills desde el Excel viejo)
 * Solo debe ser invocado estáticamente u ocasionalmente por un administrador.
 */
function reconstruirIndiceHistorico() {
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  
  // Limpiar / Preparar hoja de sub-índice
  let sheetIndex = ss.getSheetByName(SHEET_INDEX);
  if (sheetIndex) {
    sheetIndex.clear();
  } else {
    sheetIndex = crearHojaBase(ss, SHEET_INDEX, ["CEDULA_RUC", "NOMBRES_APELLIDOS", "DEPARTAMENTO", "DISTRITO", "COMUNIDAD", "MODULO_ORIGEN"]);
  }
  if (sheetIndex.getLastRow() === 0) sheetIndex.appendRow(["CEDULA_RUC", "NOMBRES_APELLIDOS", "DEPARTAMENTO", "DISTRITO", "COMUNIDAD", "MODULO_ORIGEN"]);

  const sheets = ss.getSheets();
  const indexData = [];
  const cedulasProcesadas = new Set();
  
  sheets.forEach(sh => {
    const name = sh.getName().toUpperCase();
    if (name.startsWith("_") || name.startsWith("APP_")) return; // Ignorar hojas operativas nuevas
    
    // Intento ciego de encontrar columnas lógicas ("Cédula", "Nombre", etc.)
    const data = sh.getDataRange().getValues();
    if (data.length < 2) return;
    
    const headers = data[0].map(h => h.toString().toUpperCase().trim());
    
    // Fuzzy matching simplificado para índices nativos
    let iDoc = headers.findIndex(h => h.includes("C.I") || h.includes("CEDULA") || h.includes("DOCUMENTO"));
    let iNom = headers.findIndex(h => h.includes("NOMBRE") || h.includes("RAZON SOCIAL"));
    let iApe = headers.findIndex(h => h.includes("APELLIDO"));
    let iDep = headers.findIndex(h => h.includes("DEPARTAMENTO"));
    let iDis = headers.findIndex(h => h.includes("DISTRITO"));
    let iCom = headers.findIndex(h => h.includes("COMUNIDAD") || h.includes("ASENTAMIENTO") || h.includes("BARRIO"));
    
    if (iDoc === -1 || iNom === -1) return; // Si no hay cedula ni nombre, no es una tabla útil para el index
    
    for (let r = 1; r < data.length; r++) {
      let ci = data[r][iDoc] ? data[r][iDoc].toString().trim().replace(/[\.,]/g, '') : null;
      if (!ci || ci === "" || ci.length < 4 || isNaN(ci)) continue;
      
      if (!cedulasProcesadas.has(ci)) {
        let fullName = data[r][iNom] ? data[r][iNom].toString().trim() : "";
        if (iApe !== -1 && data[r][iApe]) fullName += " " + data[r][iApe].toString().trim();
        
        let dep = iDep !== -1 ? data[r][iDep] : "";
        let dis = iDis !== -1 ? data[r][iDis] : "";
        let com = iCom !== -1 ? data[r][iCom] : "";
        
        indexData.push([ci, fullName.substring(0, 100), dep, dis, com, name]);
        cedulasProcesadas.add(ci);
      }
    }
  });
  
  if (indexData.length > 0) {
    sheetIndex.getRange(2, 1, indexData.length, indexData[0].length).setValues(indexData);
  }
  
  return { success: true, regs: indexData.length };
}

/**
 * Consulta la base _PERSONAS y _LEGADO_INDEX para el autocompletado en el frontend.
 */
function buscarProductorPWA(ci) {
  const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  ci = ci.toString().trim().toUpperCase();
  
  // Buscar en _PERSONAS (Manda)
  let sheetPer = ss.getSheetByName(SHEET_PERSONAS);
  if (sheetPer) {
    const data = sheetPer.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) { // Desde el último metido
      if (data[i][0].toString().trim() === ci) {
        return { success: true, source: 'CRM', data: { nombres: data[i][1], apellidos: data[i][2], departamento: data[i][3], distrito: data[i][4], comunidad: data[i][5] } };
      }
    }
  }
  
  // Si no está, buscar en _LEGADO_INDEX (Histórico)
  let sheetIdx = ss.getSheetByName(SHEET_INDEX);
  if (sheetIdx) {
    const data = sheetIdx.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0].toString().trim() === ci) {
           return { success: true, source: 'LEGACY', data: { nombres: data[i][1] || "", apellidos: "", departamento: data[i][2] || "", distrito: data[i][3] || "", comunidad: data[i][4] || "" } };
        }
    }
  }
  
  return { success: false, msg: "No encontrado" };
}

/**
 * Devuelve un análisis resumen para el Tablero / Dashboard
 */
function getDashboardMetrics() {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    let personas = ss.getSheetByName(SHEET_PERSONAS);
    let intervenciones = ss.getSheetByName(SHEET_INTERVENCIONES);
    
    let res = { totalProductores: 0, intervencionesRecientes: 0, modulosAcumulados: {} };
    
    if (personas) {
      res.totalProductores = personas.getLastRow() - 1;
    }
    
    if (intervenciones && intervenciones.getLastRow() > 1) {
      const ints = intervenciones.getDataRange().getValues();
      res.intervencionesRecientes = ints.length - 1;
      
      for(let i=1; i < ints.length; i++) {
        let modulo = ints[i][3];
        if(!res.modulosAcumulados[modulo]) res.modulosAcumulados[modulo] = 0;
        res.modulosAcumulados[modulo]++;
      }
    }
    
    return res;
}

/**
 * Devuelve catálogos básicos para poblar listas del frontend (Idea del usuario).
 */
function obtenerCatalogos() {
  return {
    departamentos: ['Concepción', 'San Pedro', 'Caaguazú', 'Alto Paraná', 'Canindeyú', 'Presidente Hayes', 'Amambay'],
    rubros: ['Mandioca', 'Maíz', 'Poroto', 'Sésamo', 'Hortalizas', 'Sandía', 'Tomate', 'Otros'],
    especies: ['Eucalipto', 'Pino', 'Especies Nativas', 'Yerba Mate', 'Cítricos'],
    etnias: ['Ayoreo', 'Mbya Guaraní', 'Ava Guaraní', 'Nivaclé', 'Enxet', 'Guaná', 'Sanapaná', 'Stepit', 'Otros']
  };
}

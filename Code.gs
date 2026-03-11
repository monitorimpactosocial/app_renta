/**
 * PARACEL - APP RENTA BACKEND (Google Apps Script)
 * Hoja destino: 1uI2M-cBDiUp5DhoGqGWw6y_tzI8yAzEbXjDj17apcj4
 */

const TARGET_SPREADSHEET_ID = "1uI2M-cBDiUp5DhoGqGWw6y_tzI8yAzEbXjDj17apcj4";

/**
 * Sirve la PWA cuando se accede a la URL Web.
 */
function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('App Renta | Paracel')
    .setFaviconUrl('https://docs.google.com/drawings/d/e/2PACX-1vRL5Z1V5K2lU-sWl5kP28Gtdx3yH__vj7QZ_28I6e1o4P298t41z6f_1x2k3-v1-a-5_9-y/pub?w=200&h=200') // Placeholder favicon
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
    
    // Hardcoded condition per user request
    if (usr === 'laura' && pwd === 'renta2026') {
      return { success: true, user: { nombre: 'Laura', rol: 'admin' } };
    }
    
    return { success: false, error: 'Credenciales inválidas' };
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * Recibe los datos del formulario web y los inserta en el Google Sheet unificado
 */
function procesarRegistroWeb(registro) {
  try {
    const ss = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
    
    // Busca o crea la hoja de destino según el módulo
    const sheetName = "BD_" + registro.modulo.toUpperCase();
    let sheet = ss.getSheetByName(sheetName);
    
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      // Crea cabeceras genéricas la primera vez
      sheet.appendRow([
        "Timestamp", "Registrado_Por", "Módulo", "Fecha", "N_Documento", 
        "Nombres", "Apellidos", "Departamento", "Distrito", "Comunidad", 
        "Dato_Extra_1", "Dato_Extra_2"
      ]);
      sheet.getRange("1:1").setFontWeight("bold").setBackground("#e0e0e0");
    }

    // Aplanar los datos dinámicos extra dependiendo del módulo
    let extra1 = "";
    let extra2 = "";
    
    if(registro.modulo === 'apicultura') {
      extra1 = registro.tipo_proyecto || "";
      extra2 = registro.insumos || "";
    } else if(registro.modulo === 'agricola') {
      extra1 = registro.estado_proyecto || "";
      extra2 = registro.rubro || "";
    } else if(registro.modulo === 'forestal') {
      extra1 = registro.especie || "";
      extra2 = registro.cantidad || "";
    } else if(registro.modulo === 'indigena') {
      extra1 = registro.etnia || "";
      extra2 = registro.asistencia || "";
    }

    // Preparar Fila
    const rowData = [
      registro.timestamp,
      registro.registrado_por,
      registro.modulo,
      registro.fecha,
      registro.ci,
      registro.nombres,
      registro.apellidos,
      registro.departamento,
      registro.distrito,
      registro.comunidad,
      extra1,
      extra2
    ];

    sheet.appendRow(rowData);
    
    return { success: true };
    
  } catch(e) {
    return { success: false, error: e.toString() };
  }
}

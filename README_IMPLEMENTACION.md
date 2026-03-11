# Implementación de la App Renta V2 (Avanzada + Premium UI)

Este repositorio contiene el código fuente completo de la versión 2 de la Aplicación de Monitoreo de Impacto Social (Renta) de PARACEL.

## 1. Archivos a crear en Google Apps Script
Debe copiar el contenido de los siguientes 5 archivos a su proyecto de Apps Script:
- `Code.gs`: Controlador transaccional y relacional.
- `index.html`: Estructura HTML principal con UI Moderna (Glassmorphism).
- `JavaScript.html`: Lógica frontend con autocompletado inteligente y PWA Support.
- `Stylesheet.html`: Sistema de estilos corporativos Paracel Premium.
- `appsscript.json`: Manifiesto de configuración (Accesos y Zona Horaria).

## 2. Hoja de cálculo de destino
La App Renta apunta a un único Google Sheet Maestro: `1uI2M-cBDiUp5DhoGqGWw6y_tzI8yAzEbXjDj17apcj4`.

La V2 incluye arquitectura **Maestro-Detalle**:
- `_PERSONAS`: Ficha única por productor.
- `_INTERVENCIONES`: Bitácora maestra cronológica.
- `APP_{MODULO}`: Hojas específicas de detalles operativos por módulo.

## 3. Credenciales de acceso de prueba
- **Usuario**: `laura`
- **Contraseña**: `renta2026`

## 4. Despliegue Crítico (¡Importante la primera vez!)
1. Reemplace los 5 archivos en su proyecto de Apps Script.
2. Vaya a `Implementar` → `Nueva implementación` → `Aplicación web` (`Usuario que implementa` / `Cualquier usuario`).
3. Abra la PWA iniciando sesión.
4. **Vaya al Tablero KPI y ejecute el botón rojo: "Reconstruir Índice Histórico"**. Esto es fundamental para que el buscador predictivo por Cédula funcione usando los datos legados de sus tablas originales.

## 5. Novedades Versión 2.1
- **UI Premium**: Interfaz renovada basada en componentes de Glassmorphism, paneles suspendidos y degradados corporativos fluidos.
- **Catálogos Dinámicos**: Los campos como Departamentos, Rubros y Etnias se cargan directamente desde el backend a través de listas predictivas (`<datalist>`), permitiendo mantener el control sin bloquear la entrada libre.
- **Service Worker Dinámico**: Inyección directa en RAM para habilitar la instalación PWA (Añadir a Inicio) superando restricciones "iframe" de Google Apps Script.

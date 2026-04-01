# RPI Monitor Web

Aplicacion web local-first para el programa RPI, basada en la idea original de `app_renta` pero migrada a una arquitectura con:

- `Flask` como backend local
- `SQLite` como base de datos principal
- `IndexedDB` para cola offline en el navegador
- `Service Worker` para funcionamiento como PWA
- almacenamiento de adjuntos dentro de SQLite como BLOB

## Que resuelve

- Carga de registros de campo aunque no haya internet.
- Sincronizacion automatica cuando vuelve la conectividad.
- Tablero operativo actualizado en tiempo real cuando se registra informacion online.
- Consulta historica unificada usando la base RPI actual como semilla.
- Carga de fotos, videos, PDF, Word, Excel, CSV y otros adjuntos.
- Fichas operativas por linea de trabajo: consulta/CLPI, documentaciones, servicios ecosistemicos, seguridad alimentaria escolar, autogestion y seguimiento indigena.

## Base sembrada

La app toma como fuente inicial:

- `../RPI - PROGRAMA DE VINCULACION CON PUEBLOS INDIGENAS/RPI_BASE_MAESTRA_ACTUAL.csv`

Al iniciar por primera vez, o al ejecutar con `--reseed`, esa base se carga dentro de:

- `../rpi_monitoreo.sqlite`

## Credenciales iniciales

- `admin / rpi2026`
- `laura / renta2026`

## Como ejecutar

```powershell
cd "c:\Users\DiegoMeza\OneDrive - PARACEL S.A\MONITOREO_IMPACTO_SOCIAL_PARACEL\Archivos de Latifi Chelala - PROGRAMAS SOCIALES\RPI_APP_WEB"
python server.py --host 0.0.0.0 --reseed
```

Luego abrir:

- `http://127.0.0.1:8080`
- `http://localhost:8080`
- `http://<IP-DE-TU-PC>:8080`

## Notas tecnicas

- El backend sirve tanto la API como los archivos estaticos de la PWA.
- Los adjuntos se guardan directamente dentro de SQLite. Para videos muy pesados conviene mas adelante migrar a almacenamiento por archivo + referencia en BD.
- La cola offline vive en IndexedDB del navegador, no en la base SQLite hasta que se sincroniza.
- El tablero escucha eventos SSE (`/api/events`) para refrescarse en tiempo real cuando entra un nuevo registro online.


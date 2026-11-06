# Atenea local (Android, sin internet)

Versión instalable de **Atenea** que funciona sin internet y sin Hostinger.
Usa la misma interfaz y el mismo motor de cálculo del aplicativo web.
Lo que hacía el servidor (PHP y MySQL) ahora lo hace la app dentro del teléfono.

## Qué incluye

- **Índice de Viscosidad (ASTM D2270)**: cálculo directo, hallar U y hallar Y. Usa la misma tabla de 311 puntos.
- **Curvas Viscosidad–Temperatura (ASTM D341)**: generar la curva, comparar aceites y buscar el rango de temperatura.
- **Biblioteca de lubricantes**: 2.327 productos tomados de la base de Hostinger. Permite filtros, equivalencias entre marcas, "Registrados" y completar un dato faltante.
- **Catálogo editable**: agregar, editar y eliminar productos. Todo queda guardado en el teléfono.
- **Exportar** a Excel y PDF con la marca LCM. Los archivos van a *Descargas › Atenea* y se pueden abrir o compartir.
- **Datos y respaldo**:
  - guardar una copia de seguridad (.json);
  - restaurarla en otro teléfono, ya sea todo o solo el catálogo;
  - volver al catálogo original.

## Verificado contra el servidor

Los resultados que había guardado el PHP de Hostinger se recalcularon con la app local y salieron idénticos:

- los 10 cálculos de IV;
- los 736 puntos de las 32 curvas;
- las 5 búsquedas de temperatura.

## Diferencias con la versión web

- No hay cuentas ni contraseñas. Cada teléfono tiene sus propios datos.
- Se quitaron la gestión de usuarios y la recuperación por correo.
- El historial de cada usuario en Hostinger no se trae a la app. Solo se trae el catálogo.
- Las fuentes vienen incluidas en la app, así que ya no dependen de Google Fonts.

## Generar el APK

1. Sube el contenido de esta carpeta a un repositorio nuevo de GitHub. Son menos de 100 archivos.
2. Crea `.github/workflows/build-apk.yml` (abajo está el contenido).
3. En **Actions**, descarga el artefacto **Atenea-apk**.

```yaml
name: Generar APK
on:
  push:
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'
      - uses: gradle/actions/setup-gradle@v4
        with:
          gradle-version: '8.7'
      - name: Compilar APK
        run: |
          DIR=$(dirname "$(find . -name settings.gradle | head -1)")
          cd "$DIR"
          gradle assembleDebug --no-daemon
          cp app/build/outputs/apk/debug/app-debug.apk "$GITHUB_WORKSPACE/Atenea.apk"
      - uses: actions/upload-artifact@v4
        with:
          name: Atenea-apk
          path: Atenea.apk
```

Requiere Android 10 o superior.

## Estructura

| Ruta | Qué es |
|---|---|
| `app/src/main/assets/www/` | La interfaz original de Atenea (index.html, app.js, style.css) |
| `assets/js/local/atenea-local.js` | Reemplaza `api/*.php`: responde lo mismo, guardando en el teléfono |
| `assets/js/local/exportar.js` | Reemplaza `export_excel.php` y `export_pdf.php` |
| `assets/js/local/catalogo-editor.js` | Catálogo editable y copia de seguridad |
| `assets/data/catalogo.json` | Catálogo exportado de la base MySQL |
| `java/.../MainActivity.java` | Guardar en Descargas, compartir y elegir archivos |

Los cambios a `app.js` se limitan a cuatro puntos, comentados como versión local:

- la función `api()`;
- la función `abrirDescarga()`;
- el inicio sin login;
- el Módulo 3 habilitado.

# Curso de igualdad — publicación en GitHub Pages

## Archivos que debe contener el repositorio

La web utiliza estos dos archivos:

1. `index.html`
2. `app.js`

Los contenidos se leen del Google Sheets oficial **Curso de igualdad · Datos web**. Ya no es necesario subir el Excel al repositorio.

## Publicación

En GitHub, entra en **Settings → Pages** y configura:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/ (root)**

Después guarda. GitHub mostrará la dirección pública cuando termine el despliegue.

## Actualizar el contenido

Para cambiar el programa, el calendario o los materiales, edita el Google Sheets. La web lee las pestañas `CONFIGURACION`, `CALENDARIO_WEB` y `MATERIALES_WEB` cada vez que se abre.

### Añadir enlaces y materiales

Utiliza una fila de `MATERIALES_WEB` por cada archivo o enlace:

- `ID_MATERIAL`: identificador único, por ejemplo `MAT-107`.
- `FECHA`: fecha de la sesión en formato `24/09/2026`.
- `MODULO`: debe coincidir con el nombre usado en `CALENDARIO_WEB`, por ejemplo `Modulo 0`.
- `TITULO`: nombre que verá el alumnado.
- `TIPO`: `Documento`, `Presentación`, `Vídeo`, `Lectura`, `Plantilla` o `Enlace`.
- `ENLACE`: URL completa, comenzando por `https://`.
- `FILA_ORIGEN`: referencia interna opcional.
- `VISIBLE`: escribe `TRUE` para publicarlo y `FALSE` para ocultarlo.

La web coloca el material en la sesión que tenga la misma fecha y el mismo módulo. También lo muestra en la pestaña Recursos. Los materiales sin URL válida no se enseñan al alumnado.

En Google Drive, abre **Compartir → Acceso general** y decide si el archivo puede verlo cualquier persona con el enlace o solamente las cuentas autorizadas. Copia el enlace de visualización, no el código para insertar.

## Límite de esta versión

El panel personal se guarda en el navegador de cada alumna mediante almacenamiento local. No escribe datos personales ni progreso en el Google Sheets.

## Prueba local

No abras `index.html` con doble clic, porque el navegador puede bloquear la lectura del Excel. Sirve la carpeta con un servidor local; por ejemplo:

```bash
python -m http.server 8000
```

Después abre `http://localhost:8000`.

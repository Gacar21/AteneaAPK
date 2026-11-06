/* =========================================================
   Atenea local — exportaciones a Excel y PDF sin servidor
   ---------------------------------------------------------
   Equivalente a api/export_excel.php + api/lib/XlsxWriter.php
   y api/export_pdf.php + api/lib/SimplePdf.php: mismas hojas,
   mismos títulos, misma marca LCM (logo, rojo y amarillo).
   El archivo se guarda en Descargas › Atenea del teléfono.
   ========================================================= */
(function () {
    'use strict';

    const native = window.Android || null;
    const L = () => window.AteneaLocal;

    /* ======================================================
       Utilidades
       ====================================================== */

    // Igual que echo de un float en PHP: sin ceros sobrantes
    const phpNum = (v) => {
        if (v === null || v === undefined || v === '') return '';
        const n = Number(v);
        if (!isFinite(n)) return String(v);
        return String(parseFloat(n.toPrecision(14)));
    };
    const phpRound = (v, d) => {
        const f = 10 ** d, n = Number(v);
        return Math.round(Math.abs(n) * f + 1e-9) / f * Math.sign(n);
    };
    const fechaCorta = () => {
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    const nombreSeguro = (s) => s.replace(/[^A-Za-z0-9_\-.]/g, '_');

    class ErrorExport extends Error {}
    const fallar = (m) => { throw new ErrorExport(m); };

    let logoBytes = null;
    async function logo() {
        if (logoBytes === null) {
            try {
                const r = await fetch('assets/img/logo_lcm_export.png');
                logoBytes = r.ok ? new Uint8Array(await r.arrayBuffer()) : false;
            } catch (e) { logoBytes = false; }
        }
        return logoBytes || null;
    }

    /* ======================================================
       XLSX (port de XlsxWriter.php)
       ====================================================== */

    const ESTILO = { NORMAL: 0, TITULO: 1, ENCABEZADO: 2, NUMERO4: 3, ETIQUETA: 4, BANDA_ROJA: 5, BANDA_AMARILLA: 6 };

    const colLetra = (col) => {
        let s = '';
        while (col > 0) { const r = (col - 1) % 26; s = String.fromCharCode(65 + r) + s; col = Math.floor((col - 1) / 26); }
        return s;
    };
    const a1 = (ref) => {
        const m = ref.match(/^([A-Z]+)(\d+)$/);
        let col = 0;
        for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
        return [col, Number(m[2])];
    };
    const xmlEsc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
        // caracteres de control no válidos en XML
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

    class Xlsx {
        constructor(hoja) {
            this.hoja = (hoja.replace(/[\\/?*[\]:]/g, ' ').trim() || 'Hoja1').slice(0, 31);
            this.celdas = new Map(); // fila -> Map(col -> {v, s})
            this.merges = [];
            this.anchos = {};
            this.maxCol = 1;
            this.maxFila = 1;
        }
        set(fila, col, valor, estilo = ESTILO.NORMAL) {
            if (valor === null || valor === undefined) return;
            if (!this.celdas.has(fila)) this.celdas.set(fila, new Map());
            this.celdas.get(fila).set(col, { v: valor, s: estilo });
            this.maxCol = Math.max(this.maxCol, col);
            this.maxFila = Math.max(this.maxFila, fila);
        }
        setA1(ref, valor, estilo) { const [c, f] = a1(ref); this.set(f, c, valor, estilo); }
        merge(r) { this.merges.push(r); }
        setColWidth(c, w) { this.anchos[c] = w; }
        autosize() {
            for (const fila of this.celdas.values()) {
                for (const [col, c] of fila) {
                    const len = [...String(c.v)].length;
                    this.anchos[col] = Math.max(this.anchos[col] ?? 8, Math.min(60, len + 2));
                }
            }
        }
        sheetXml(conLogo) {
            const off = conLogo ? 4 : 0;
            let x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
            if (Object.keys(this.anchos).length) {
                x += '<cols>';
                for (let c = 1; c <= this.maxCol; c++) x += `<col min="${c}" max="${c}" width="${(this.anchos[c] ?? 10).toFixed(2)}" customWidth="1"/>`;
                x += '</cols>';
            }
            x += '<sheetData>';
            if (off) {
                x += '<row r="1" ht="24" customHeight="1"/><row r="2" ht="24" customHeight="1"/><row r="3" ht="5" customHeight="1">';
                for (let c = 1; c <= this.maxCol; c++) x += `<c r="${colLetra(c)}3" s="${ESTILO.BANDA_ROJA}"/>`;
                x += '</row><row r="4" ht="3.5" customHeight="1">';
                for (let c = 1; c <= this.maxCol; c++) x += `<c r="${colLetra(c)}4" s="${ESTILO.BANDA_AMARILLA}"/>`;
                x += '</row>';
            }
            const filas = [...this.celdas.keys()].sort((a, b) => a - b);
            for (const f of filas) {
                const fr = f + off;
                x += `<row r="${fr}">`;
                const cols = [...this.celdas.get(f).entries()].sort((a, b) => a[0] - b[0]);
                for (const [c, { v, s }] of cols) {
                    const ref = colLetra(c) + fr;
                    if (typeof v === 'number' && isFinite(v)) x += `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
                    else x += `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
                }
                x += '</row>';
            }
            x += '</sheetData>';
            if (this.merges.length) {
                x += `<mergeCells count="${this.merges.length}">`;
                for (let r of this.merges) {
                    if (off) r = r.replace(/([A-Z]+)(\d+)/g, (_, l, n) => l + (Number(n) + off));
                    x += `<mergeCell ref="${r}"/>`;
                }
                x += '</mergeCells>';
            }
            if (conLogo) x += '<drawing r:id="rId1"/>';
            return x + '</worksheet>';
        }
        async generar() {
            const png = await logo();
            const conLogo = !!png;
            const zip = new JSZip();
            const rels = (tipo, destino) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${tipo}" Target="${destino}"/></Relationships>`;
            zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${conLogo ? '<Default Extension="png" ContentType="image/png"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : ''}</Types>`);
            zip.file('_rels/.rels', rels('officeDocument', 'xl/workbook.xml'));
            zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(this.hoja)}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
            zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
            zip.file('xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFE31D25"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE31D25"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFABE15"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFCCCCCC"/></left><right style="thin"><color rgb="FFCCCCCC"/></right><top style="thin"><color rgb="FFCCCCCC"/></top><bottom style="thin"><color rgb="FFCCCCCC"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>');
            zip.file('xl/worksheets/sheet1.xml', this.sheetXml(conLogo));
            if (conLogo) {
                const dim = pngTamano(png);
                const cx = 190 * 9525, cy = Math.round(190 * dim.h / dim.w) * 9525;
                zip.file('xl/worksheets/_rels/sheet1.xml.rels', rels('drawing', '../drawings/drawing1.xml'));
                zip.file('xl/drawings/drawing1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>57150</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>28575</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="2" name="Logo LCM S.A.S" descr="Lubricación de Clase Mundial S.A.S"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>`);
                zip.file('xl/drawings/_rels/drawing1.xml.rels', rels('image', '../media/logo_lcm.png'));
                zip.file('xl/media/logo_lcm.png', png);
            }
            return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
        }
    }

    const pngTamano = (b) => {
        const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
        return { w: dv.getUint32(16), h: dv.getUint32(20) };
    };

    /* ---------- export_excel.php ---------- */

    const flt = (v) => (v === null || v === undefined || v === '' ? null : parseFloat(v));

    async function excel(q) {
        const tipo = q.get('tipo') || '';
        const id = q.get('id');
        const Lc = L();
        let w, nombre;

        if (tipo === 'vi') {
            let registros;
            if (id) {
                const r = await Lc.uno('calculos_vi', Number(id));
                if (!r) fallar('Registro no encontrado');
                registros = [Lc.comoMySQL('calculos_vi', r)];
            } else {
                registros = (await Lc.todos('calculos_vi')).sort((a, b) => b.fecha.localeCompare(a.fecha)).map((r) => Lc.comoMySQL('calculos_vi', r));
            }
            w = new Xlsx('Indice de Viscosidad');
            w.setA1('A1', 'Atenea - Historial de Cálculos de Índice de Viscosidad (ASTM D2270)', ESTILO.TITULO);
            w.merge('A1:K1');
            ['Fecha', 'Muestra', 'Modo', 'Visc. 100°C (Y)', 'Visc. 40°C (U)', 'VI objetivo', 'Visc.40 hallada', 'Visc.100 hallada', 'VI resultado', 'Rama', 'Notas']
                .forEach((h, i) => w.set(3, i + 1, h, ESTILO.ENCABEZADO));
            const modo = { directo: 'Cálculo directo', hallar_U: 'Hallar U (visc. 40°C)', hallar_Y: 'Hallar Y (visc. 100°C)' };
            let r = 4;
            for (const reg of registros) {
                w.set(r, 1, reg.fecha);
                w.set(r, 2, reg.nombre_muestra);
                w.set(r, 3, modo[reg.modo] ?? reg.modo);
                ['visc_100_input', 'visc_40_input', 'vi_objetivo', 'visc_40_resultado', 'visc_100_resultado', 'vi_resultado']
                    .forEach((c, i) => w.set(r, 4 + i, flt(reg[c]), ESTILO.NUMERO4));
                w.set(r, 10, reg.rama);
                w.set(r, 11, reg.notas);
                r++;
            }
            w.autosize();
            nombre = id ? `atenea_vi_${id}.xlsx` : 'atenea_historial_vi.xlsx';

        } else if (tipo === 'curva' && id) {
            const a = await Lc.uno('aceites', Number(id));
            if (!a) fallar('Aceite no encontrado');
            const ac = Lc.comoMySQL('aceites', a);
            w = new Xlsx('Curva Viscosidad-Temp');
            w.setA1('A1', 'Atenea - Curva Viscosidad-Temperatura (ASTM D341)', ESTILO.TITULO);
            w.merge('A1:C1');
            w.setA1('A2', 'Aceite:', ESTILO.ETIQUETA); w.setA1('B2', ac.nombre);
            w.setA1('A3', 'Visc. 40°C conocida:', ESTILO.ETIQUETA); w.setA1('B3', flt(ac.visc_40), ESTILO.NUMERO4);
            w.setA1('A4', 'Visc. 100°C conocida:', ESTILO.ETIQUETA); w.setA1('B4', flt(ac.visc_100), ESTILO.NUMERO4);
            w.set(6, 1, 'Temperatura (°C)', ESTILO.ENCABEZADO);
            w.set(6, 2, 'Viscosidad (cSt)', ESTILO.ENCABEZADO);
            let r = 7;
            for (const p of a.curva) { w.set(r, 1, p.temperatura_c); w.set(r, 2, phpRound(p.viscosidad_cst, 4), ESTILO.NUMERO4); r++; }
            w.autosize();
            nombre = nombreSeguro(`atenea_curva_${ac.nombre}.xlsx`);

        } else if (tipo === 'curvas') {
            const aceites = (await Lc.todos('aceites')).sort((x, y) => new Intl.Collator('es').compare(x.nombre, y.nombre));
            w = new Xlsx('Comparativo Aceites');
            w.setA1('A1', 'Atenea - Comparativo de curvas Viscosidad-Temperatura', ESTILO.TITULO);
            w.merge('A1:' + colLetra(Math.max(1, aceites.length + 1)) + '1');
            w.set(3, 1, 'Temp (°C)', ESTILO.ENCABEZADO);
            aceites.forEach((ac, i) => w.set(3, i + 2, ac.nombre, ESTILO.ENCABEZADO));
            [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220, 230]
                .forEach((t, i) => w.set(4 + i, 1, t));
            aceites.forEach((ac, i) => ac.curva.forEach((p, k) => w.set(4 + k, i + 2, phpRound(p.viscosidad_cst, 4), ESTILO.NUMERO4)));
            w.autosize();
            nombre = 'atenea_comparativo_aceites.xlsx';

        } else if (tipo === 'catalogo' || tipo === 'registrados') {
            let productos, titulo;
            if (tipo === 'registrados') {
                productos = await Lc.solicitud('registrados.php');
                titulo = 'Atenea - Productos registrados';
                nombre = 'atenea_registrados.xlsx';
            } else {
                productos = Lc.filtrarCatalogo(await Lc.productos(), q).slice(0, 2000).map((p) => Lc.comoMySQL('productos', p));
                titulo = 'Atenea - Listado del catálogo de lubricantes';
                nombre = 'atenea_catalogo.xlsx';
            }
            w = new Xlsx('Lubricantes');
            w.setA1('A1', `${titulo} (${productos.length} productos)`, ESTILO.TITULO);
            w.merge('A1:N1');
            ['Nombre', 'Marca', 'Categoría', 'Naturaleza', 'Tipo de base', 'Tipo de espesante', 'NLGI', 'Grado SAE', 'ISO VG', 'Visc. 40°C', 'Visc. 100°C', 'VI', 'P. vertido °C', 'P. inflamación °C']
                .forEach((h, i) => w.set(3, i + 1, h, ESTILO.ENCABEZADO));
            let r = 4;
            for (const p of productos) {
                ['nombre', 'marca', 'categoria', 'aceite_naturaleza', 'tipo_base', 'tipo_espesante', 'nlgi', 'grado_sae'].forEach((c, i) => w.set(r, i + 1, p[c]));
                ['iso_vg', 'viscosidad_40', 'viscosidad_100', 'indice_viscosidad', 'punto_vertido', 'punto_inflamacion'].forEach((c, i) => w.set(r, 9 + i, flt(p[c]), ESTILO.NUMERO4));
                r++;
            }
            w.autosize();
        } else {
            fallar('Esta exportación no está disponible en la versión local.');
        }
        return { bytes: await w.generar(), nombre, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    }

    /* ======================================================
       PDF (port de SimplePdf.php + export_pdf.php, con pdf-lib)
       ====================================================== */

    const A4_W = 595.28, A4_H = 841.89;
    const GRIS = [0.55, 0.58, 0.64], OSCURO = [0.11, 0.13, 0.16], ROJO = [0.890, 0.114, 0.145], AMARILLO = [0.980, 0.745, 0.082];
    const FONDO_SUAVE = [1.0, 0.973, 0.882], BORDE_GRIS = [0.86, 0.87, 0.89];

    class Pdf {
        static async crear() {
            const P = window.PDFLib;
            const p = new Pdf();
            p.doc = await P.PDFDocument.create();
            p.f1 = await p.doc.embedFont(P.StandardFonts.Helvetica);
            p.f2 = await p.doc.embedFont(P.StandardFonts.HelveticaBold);
            p.charset = new Set(p.f1.getCharacterSet());
            const png = await logo();
            p.logo = png ? await p.doc.embedPng(png) : null;
            p.addPage();
            return p;
        }
        addPage() { this.page = this.doc.addPage([A4_W, A4_H]); }
        rgb(c) { return window.PDFLib.rgb(c[0], c[1], c[2]); }
        // Helvetica estándar solo tiene caracteres latinos (WinAnsi): se reemplaza lo demás
        limpio(s) {
            const reemp = { '≈': '~', '✷': '*', '★': '*', '☆': '*', '→': '->', '≤': '<=', '≥': '>=', '±': '±', '−': '-', ' ': ' ', ' ': ' ' };
            return [...String(s)].map((ch) => (this.charset.has(ch.codePointAt(0)) ? ch : (reemp[ch] ?? '?'))).join('').replace(/[\r\n\t]+/g, ' ');
        }
        text(x, y, txt, size = 11, font = 'F1', color = OSCURO) {
            this.page.drawText(this.limpio(txt), { x, y, size, font: font === 'F2' ? this.f2 : this.f1, color: this.rgb(color) });
        }
        ancho(txt, size, negrita) { return (negrita ? this.f2 : this.f1).widthOfTextAtSize(this.limpio(txt), size); }
        textoEnvuelto(x, y, txt, max, size = 10, font = 'F1', inter = 13) {
            const palabras = String(txt).trim().split(/\s+/);
            let linea = '';
            for (const p of palabras) {
                const prueba = linea === '' ? p : linea + ' ' + p;
                if (this.ancho(prueba, size, font === 'F2') > max && linea !== '') { this.text(x, y, linea, size, font); y -= inter; linea = p; }
                else linea = prueba;
            }
            if (linea !== '') { this.text(x, y, linea, size, font); y -= inter; }
            return y;
        }
        line(x1, y1, x2, y2, w = 1, color = [0.2, 0.2, 0.2]) {
            this.page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: this.rgb(color) });
        }
        rect(x, y, w, h, stroke = null, fill = null, lw = 1) {
            this.page.drawRectangle({ x, y, width: w, height: h, color: fill ? this.rgb(fill) : undefined, borderColor: stroke ? this.rgb(stroke) : undefined, borderWidth: stroke ? lw : 0 });
        }
        polyline(pts, color, w = 2) {
            for (let i = 1; i < pts.length; i++) this.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], w, color);
        }
        tabla(x, y, anchoTotal, filas, enc, anchos = [0.5, 0.5], colorEnc = OSCURO) {
            const alto = 20, c1 = anchoTotal * anchos[0];
            if (enc) {
                this.rect(x, y - alto, anchoTotal, alto, null, colorEnc);
                this.text(x + 6, y - alto + 6, enc[0], 10, 'F2', [1, 1, 1]);
                this.text(x + c1 + 6, y - alto + 6, enc[1], 10, 'F2', [1, 1, 1]);
                y -= alto;
            }
            for (const f of filas) {
                this.rect(x, y - alto, anchoTotal, alto, BORDE_GRIS);
                this.text(x + 6, y - alto + 6, String(f[0]), 10, 'F1');
                this.text(x + c1 + 6, y - alto + 6, String(f[1]), 10, 'F1');
                y -= alto;
            }
            return y;
        }
        bandaMarca() {
            this.rect(0, A4_H - 10, A4_W, 10, null, ROJO);
            this.rect(0, A4_H - 14, A4_W, 4, null, AMARILLO);
        }
        encabezado(margen, titulo, subtitulo) {
            this.bandaMarca();
            let y = A4_H - 24;
            if (this.logo) {
                const w = 150, h = w * this.logo.height / this.logo.width;
                this.page.drawImage(this.logo, { x: margen, y: y - h, width: w, height: h });
                y -= h + 22;
            } else y -= 14;
            this.text(margen, y, titulo, 18, 'F2', OSCURO);
            this.text(margen, y - 18, subtitulo, 10, 'F1', GRIS);
            this.line(margen, y - 28, A4_W - margen, y - 28, 1.4, AMARILLO);
            return y - 48;
        }
        pie(margen, y, texto) {
            this.line(margen, y + 14, A4_W - margen, y + 14, 0.8, ROJO);
            this.text(margen, y, texto, 8, 'F1', GRIS);
            this.text(margen, y - 11, 'Lubricación de Clase Mundial S.A.S', 8, 'F2', ROJO);
        }
        generar() { return this.doc.save(); }
    }

    /* ---------- export_pdf.php ---------- */

    async function pdf(q) {
        const tipo = q.get('tipo') || '';
        const id = q.get('id');
        if (!id) fallar('Falta el parametro id');
        const Lc = L();
        const margen = 50, util = A4_W - 2 * margen, fecha = fechaCorta();
        let doc, nombre;

        if (tipo === 'vi') {
            const r0 = await Lc.uno('calculos_vi', Number(id));
            if (!r0) fallar('Registro no encontrado');
            const reg = Lc.comoMySQL('calculos_vi', r0);
            const modo = { directo: 'Calculo directo de IV', hallar_U: 'Busqueda de Visc. a 40C (U)', hallar_Y: 'Busqueda de Visc. a 100C (Y)' };
            let filas, etiqueta, valor;
            const LH = [['Valor L (tabla ASTM)', phpNum(phpRound(reg.valor_L, 3))], ['Valor H (tabla ASTM)', phpNum(phpRound(reg.valor_H, 3))]];
            if (reg.modo === 'directo') {
                filas = [['Viscosidad a 100°C (Y)', reg.visc_100_input + ' cSt'], ['Viscosidad a 40°C (U)', reg.visc_40_input + ' cSt'], ...LH, ['Rama aplicada', reg.rama]];
                etiqueta = 'ÍNDICE DE VISCOSIDAD'; valor = phpNum(phpRound(reg.vi_resultado, 2));
            } else if (reg.modo === 'hallar_U') {
                filas = [['Viscosidad a 100°C (Y) conocida', reg.visc_100_input + ' cSt'], ['IV objetivo', reg.vi_objetivo], ...LH];
                etiqueta = 'VISCOSIDAD A 40°C REQUERIDA (U)'; valor = phpNum(phpRound(reg.visc_40_resultado, 4)) + ' cSt';
            } else {
                filas = [['Viscosidad a 40°C (U) conocida', reg.visc_40_input + ' cSt'], ['IV objetivo', reg.vi_objetivo], ...LH];
                etiqueta = 'VISCOSIDAD A 100°C REQUERIDA (Y)'; valor = phpNum(phpRound(reg.visc_100_resultado, 4)) + ' cSt';
            }
            doc = await Pdf.crear();
            let y = doc.encabezado(margen, 'Atenea — Ficha de Índice de Viscosidad', `Método ASTM D2270  ·  Generado el ${fecha}`);
            doc.rect(margen, y - 62, util, 62, AMARILLO, FONDO_SUAVE);
            doc.text(margen + 12, y - 18, `${modo[reg.modo]} — Muestra: ${reg.nombre_muestra || 'Sin nombre'}`, 9, 'F1', GRIS);
            doc.text(margen + 12, y - 34, etiqueta, 9, 'F1', GRIS);
            doc.text(margen + 12, y - 56, String(valor), 22, 'F2', ROJO);
            y -= 80;
            y = doc.tabla(margen, y, util, filas, ['Parámetro', 'Valor'], [0.5, 0.5], ROJO);
            y -= 20;
            if (reg.notas) {
                doc.text(margen, y, 'Notas:', 10, 'F2'); y -= 15;
                y = doc.textoEnvuelto(margen, y, reg.notas, util, 10); y -= 10;
            }
            doc.pie(margen, Math.max(y, 60), 'Calculado con la tabla ASTM D2270 de 311 puntos (2.0 - 70.0 cSt), replicando el Excel original.');
            nombre = `atenea_vi_${id}.pdf`;

        } else if (tipo === 'curva') {
            const a = await Lc.uno('aceites', Number(id));
            if (!a) fallar('Aceite no encontrado');
            const ac = Lc.comoMySQL('aceites', a);
            const curva = a.curva;
            doc = await Pdf.crear();
            let y = doc.encabezado(margen, 'Atenea — Curva Viscosidad-Temperatura', `Método ASTM D341 (ecuación de Walther)  ·  Generado el ${fecha}`);
            doc.rect(margen, y - 66, util, 66, AMARILLO, FONDO_SUAVE);
            doc.text(margen + 12, y - 18, 'ACEITE', 9, 'F1', GRIS);
            doc.text(margen + 12, y - 38, ac.nombre, 16, 'F2', OSCURO);
            doc.text(margen + 12, y - 58, `Visc. 40°C: ${ac.visc_40} cSt    Visc. 100°C: ${ac.visc_100} cSt`, 10, 'F1');
            y -= 86;
            if (curva.length >= 2) {
                const alto = 200, padL = 45, padB = 22, padT = 10, padR = 10, gx0 = margen, gy0 = y - alto;
                const temps = curva.map((p) => p.temperatura_c), viscs = curva.map((p) => Number(p.viscosidad_cst));
                const minT = Math.min(...temps), maxT = Math.max(...temps), minV = 0, maxV = Math.max(...viscs) * 1.08;
                const ex = (t) => gx0 + padL + (t - minT) / (maxT - minT) * (util - padL - padR);
                const ey = (v) => gy0 + padB + (v - minV) / (maxV - minV) * (alto - padT - padB);
                doc.rect(gx0, gy0, util, alto, BORDE_GRIS);
                for (let i = 0; i <= 4; i++) {
                    const vv = minV + (maxV - minV) * i / 4, yy = ey(vv);
                    doc.line(gx0 + padL, yy, gx0 + util - padR, yy, 0.4, [0.9, 0.9, 0.91]);
                    doc.text(gx0 + 4, yy - 3, phpNum(phpRound(vv, 1)), 7, 'F1', GRIS);
                }
                [minT, (minT + maxT) / 2, maxT].forEach((tv) => doc.text(ex(tv) - 8, gy0 + 6, String(Math.round(tv)), 7, 'F1', GRIS));
                doc.polyline(curva.map((p) => [ex(p.temperatura_c), ey(Number(p.viscosidad_cst))]), ROJO, 2.2);
                doc.text(gx0 + util / 2 - 40, gy0 - 12, 'Temperatura (°C)  /  Viscosidad (cSt)', 8, 'F1', GRIS);
                y = gy0 - 26;
            }
            const filas = curva.map((p) => [`${p.temperatura_c} °C`, `${phpNum(phpRound(p.viscosidad_cst, 4))} cSt`]);
            const porPagina = Math.max(1, Math.floor((y - 70) / 20) - 1);
            for (let i = 0; i < filas.length; i += porPagina) {
                if (i > 0) {
                    doc.addPage(); doc.bandaMarca();
                    y = A4_H - 60;
                    doc.text(margen, y, 'Atenea — Curva Viscosidad-Temperatura (continuación)', 12, 'F2');
                    y -= 30;
                }
                y = doc.tabla(margen, y, util, filas.slice(i, i + porPagina), ['Temperatura', 'Viscosidad'], [0.5, 0.5], ROJO);
            }
            doc.pie(margen, Math.max(y - 26, 40), 'Calculado con la ecuación de Walther (ASTM D341), replicando el Excel original.');
            nombre = nombreSeguro(`atenea_curva_${ac.nombre}.pdf`);

        } else if (tipo === 'producto') {
            const p0 = await Lc.uno('productos', Number(id));
            if (!p0) fallar('Producto no encontrado');
            const p = Lc.comoMySQL('productos', p0);
            doc = await Pdf.crear();
            let y = doc.encabezado(margen, 'Atenea — Ficha técnica de lubricante', `Catálogo de lubricantes  ·  Generado el ${fecha}`);
            doc.rect(margen, y - 60, util, 60, AMARILLO, FONDO_SUAVE);
            doc.text(margen + 12, y - 18, `${String(p.marca).toUpperCase()} — ${p.categoria}`, 9, 'F1', GRIS);
            doc.text(margen + 12, y - 40, p.nombre, 15, 'F2', OSCURO);
            y -= 76;
            const num = (v) => (v === null || v === '' ? null : String(parseFloat(Number(v).toFixed(4))));
            const filas = [];
            const agregar = (l, v) => { if (v !== null && v !== undefined && v !== '') filas.push([l, v]); };
            agregar('Naturaleza', p.aceite_naturaleza);
            agregar('Tipo de base', p.tipo_base);
            agregar('Tipo de espesante', p.tipo_espesante);
            agregar('NLGI', p.nlgi);
            agregar('Grado SAE', p.grado_sae);
            agregar('ISO VG', num(p.iso_vg));
            agregar('Viscosidad a 40°C', p.viscosidad_40 !== null ? num(p.viscosidad_40) + ' cSt' : null);
            agregar('Viscosidad a 100°C', p.viscosidad_100 !== null ? num(p.viscosidad_100) + ' cSt' + (p.viscosidad_100_estimada === 1 ? ' (estimada)' : '') : null);
            agregar('Índice de Viscosidad', num(p.indice_viscosidad));
            agregar('Punto de vertido', p.punto_vertido !== null ? num(p.punto_vertido) + ' °C' : null);
            agregar('Punto de inflamación', p.punto_inflamacion !== null ? num(p.punto_inflamacion) + ' °C' : null);
            agregar('Densidad', p.densidad !== null ? num(p.densidad) + ' g/cm³' : null);
            y = doc.tabla(margen, y, util, filas, ['Especificación', 'Valor'], [0.5, 0.5], ROJO);
            y -= 20;
            if (p.caracteristicas) {
                doc.text(margen, y, 'Características:', 10, 'F2'); y -= 15;
                y = doc.textoEnvuelto(margen, y, p.caracteristicas, util, 10); y -= 10;
            }
            doc.pie(margen, Math.max(y, 60), 'Ficha generada desde el catálogo técnico de Atenea.');
            nombre = `atenea_producto_${id}.pdf`;
        } else {
            fallar("Parametro 'tipo' invalido. Usa vi, curva o producto.");
        }
        return { bytes: await doc.generar(), nombre, mime: 'application/pdf' };
    }

    /* ======================================================
       Entregar el archivo: Descargas del teléfono (o descarga en navegador)
       ====================================================== */

    const aBase64 = (bytes) => {
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    };

    function enviarANativo(bytes, nombre, mime, destino) {
        native.beginFile(nombre);
        const TROZO = 384 * 1024;
        for (let i = 0; i < bytes.length; i += TROZO) native.appendFile(aBase64(bytes.subarray(i, i + TROZO)));
        return native.endFile(mime, destino);
    }

    /** Pequeño panel "Archivo listo" con Abrir / Compartir. */
    function panelArchivo(nombre, uri, mime, bytes) {
        let panel = document.getElementById('local-archivo-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'local-archivo-panel';
            panel.className = 'local-sheet-overlay';
            panel.innerHTML = `
                <div class="local-sheet" role="dialog" aria-label="Archivo guardado">
                    <div class="local-sheet-titulo">Archivo guardado</div>
                    <div class="local-sheet-sub" id="local-archivo-nombre"></div>
                    <div class="local-sheet-botones">
                        <button class="btn btn-primary" id="local-archivo-abrir">Abrir</button>
                        <button class="btn btn-ghost" id="local-archivo-compartir">Compartir</button>
                        <button class="btn btn-ghost" id="local-archivo-cerrar">Cerrar</button>
                    </div>
                </div>`;
            document.body.appendChild(panel);
            panel.addEventListener('click', (e) => { if (e.target === panel) panel.classList.add('hidden'); });
            panel.querySelector('#local-archivo-cerrar').addEventListener('click', () => panel.classList.add('hidden'));
        }
        panel.querySelector('#local-archivo-nombre').textContent = `${nombre} · en Descargas › Atenea`;
        panel.querySelector('#local-archivo-abrir').onclick = () => { panel.classList.add('hidden'); native.openUri(uri, mime); };
        panel.querySelector('#local-archivo-compartir').onclick = () => {
            panel.classList.add('hidden');
            if (enviarANativo(bytes, nombre, mime, 'compartir')) native.shareQueued(mime);
        };
        panel.classList.remove('hidden');
    }

    async function entregar({ bytes, nombre, mime }) {
        if (native && native.beginFile) {
            const uri = enviarANativo(bytes, nombre, mime, 'dispositivo');
            if (!uri) throw new Error('No se pudo guardar el archivo en el teléfono');
            panelArchivo(nombre, uri, mime, bytes);
            return;
        }
        const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
        const a = Object.assign(document.createElement('a'), { href: url, download: nombre });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    /** Reemplazo de abrirDescarga(url): url = 'api/export_excel.php?tipo=…' o export_pdf.php */
    async function descargar(url) {
        const [ruta, query = ''] = url.split('?');
        const q = new URLSearchParams(query);
        await L().asegurarDatos();
        const archivo = ruta.split('/').pop();
        const res = archivo === 'export_pdf.php' ? await pdf(q) : await excel(q);
        await entregar(res);
    }

    window.AteneaExport = { descargar, entregar, Xlsx, ESTILO };
})();

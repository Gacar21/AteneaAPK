/* =========================================================
   Atenea local — reemplaza la carpeta api/ (PHP + MySQL)
   ---------------------------------------------------------
   Todo se guarda en el teléfono (IndexedDB). Cada función
   responde EXACTAMENTE lo que respondía el PHP equivalente
   (mismos campos, mismo orden, decimales como texto igual
   que los devolvía MySQL), para que app.js no note la
   diferencia. Los cálculos usan el mismo motor de app.js.
   ========================================================= */
(function () {
    'use strict';

    const DB_NAME = 'atenea-local';
    const DB_VERSION = 1;
    const USUARIO_LOCAL = { id: 1, email: 'este teléfono', nombre_completo: 'Atenea local', rol: 'usuario', activo: 1 };

    /* ---------- tipos de columna (para responder igual que MySQL) ---------- */
    // Decimales: MySQL los devuelve como texto con la escala de la columna ("46.00").
    const ESQUEMA = {
        productos: {
            enteros: ['id', 'viscosidad_40_estimada', 'viscosidad_100_estimada', 'indice_viscosidad_estimada'],
            decimales: { iso_vg: 2, viscosidad_40: 2, viscosidad_100: 3, indice_viscosidad: 2, punto_vertido: 2, punto_inflamacion: 2, densidad: 5 },
            orden: ['id', 'nombre', 'marca', 'categoria', 'aceite_naturaleza', 'tipo_base', 'grado_sae', 'tipo_espesante', 'nlgi', 'iso_vg',
                'viscosidad_40', 'viscosidad_40_estimada', 'viscosidad_100', 'viscosidad_100_estimada', 'indice_viscosidad',
                'indice_viscosidad_estimada', 'punto_vertido', 'punto_inflamacion', 'densidad', 'caracteristicas', 'specs_extra'],
        },
        calculos_vi: {
            enteros: ['id', 'usuario_id'],
            decimales: { visc_100_input: 4, visc_40_input: 4, vi_objetivo: 4, visc_100_resultado: 4, visc_40_resultado: 4, vi_resultado: 4, valor_L: 3, valor_H: 3 },
            orden: ['id', 'usuario_id', 'fecha', 'nombre_muestra', 'modo', 'visc_100_input', 'visc_40_input', 'vi_objetivo',
                'visc_100_resultado', 'visc_40_resultado', 'vi_resultado', 'valor_L', 'valor_H', 'rama', 'notas'],
        },
        aceites: {
            enteros: ['id', 'usuario_id'],
            decimales: { visc_40: 4, visc_100: 4, constante_A: 8, constante_B: 8 },
            orden: ['id', 'usuario_id', 'fecha', 'nombre', 'visc_40', 'visc_100', 'constante_A', 'constante_B', 'notas'],
        },
        busquedas: {
            enteros: ['id', 'aceite_id'],
            decimales: { viscosidad_objetivo: 4, tolerancia_pct: 4, visc_inferior: 4, visc_superior: 4, temp_min_c: 4, temp_max_c: 4 },
            orden: ['id', 'aceite_id', 'fecha', 'viscosidad_objetivo', 'tolerancia_pct', 'visc_inferior', 'visc_superior', 'temp_min_c', 'temp_max_c'],
        },
    };

    // Redondeo como lo guarda una columna DECIMAL(x, escala)
    const redondear = (v, escala) => {
        if (v === null || v === undefined || v === '' || !isFinite(Number(v))) return null;
        const f = 10 ** escala;
        return Math.round(Number(v) * f + (Number(v) >= 0 ? 1e-9 : -1e-9)) / f;
    };

    /** Guarda los números con la precisión de su columna (igual que MySQL). */
    function normalizar(tabla, fila) {
        const e = ESQUEMA[tabla];
        const out = { ...fila };
        for (const [campo, escala] of Object.entries(e.decimales)) {
            if (campo in out) out[campo] = redondear(out[campo], escala);
        }
        return out;
    }

    /** Fila tal como la entregaba PDO: enteros como número y decimales como texto con escala fija. */
    function comoMySQL(tabla, fila) {
        if (!fila) return fila;
        const e = ESQUEMA[tabla];
        const out = {};
        for (const campo of e.orden) {
            let v = fila[campo];
            if (v === undefined) v = null;
            if (v !== null && campo in e.decimales) v = Number(v).toFixed(e.decimales[campo]);
            else if (v !== null && e.enteros.includes(campo)) v = Number(v);
            out[campo] = v;
        }
        return out;
    }

    const ahora = () => {
        const d = new Date(), p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    };

    class ErrorApi extends Error {
        constructor(mensaje, status = 400) { super(mensaje); this.status = status; }
    }
    const fallar = (m, s) => { throw new ErrorApi(m, s); };

    /* ---------- IndexedDB ---------- */

    let dbPromesa = null;
    function abrirDb() {
        if (!dbPromesa) {
            dbPromesa = new Promise((resolve, reject) => {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    db.createObjectStore('productos', { keyPath: 'id' });
                    db.createObjectStore('calculos_vi', { keyPath: 'id', autoIncrement: true });
                    db.createObjectStore('aceites', { keyPath: 'id', autoIncrement: true });
                    db.createObjectStore('busquedas', { keyPath: 'id', autoIncrement: true }).createIndex('aceite_id', 'aceite_id');
                    db.createObjectStore('registrados', { keyPath: 'producto_id' });
                    db.createObjectStore('meta', { keyPath: 'clave' });
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
        }
        return dbPromesa;
    }

    const promesa = (req) => new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    async function tx(stores, modo, fn) {
        const db = await abrirDb();
        return new Promise((resolve, reject) => {
            const t = db.transaction(stores, modo);
            let resultado;
            Promise.resolve(fn(t)).then((r) => { resultado = r; }, (e) => { try { t.abort(); } catch (_) { /* ya cerrada */ } reject(e); });
            t.oncomplete = () => resolve(resultado);
            t.onerror = () => reject(t.error);
            t.onabort = () => reject(t.error || new Error('Operación cancelada'));
        });
    }

    const todos = (store) => tx([store], 'readonly', (t) => promesa(t.objectStore(store).getAll()));
    const uno = (store, id) => tx([store], 'readonly', (t) => promesa(t.objectStore(store).get(id)));

    /* ---------- catálogo inicial (exportado del MySQL de Hostinger) ---------- */

    let listo = null;
    function asegurarDatos() {
        if (!listo) {
            listo = (async () => {
                const meta = await uno('meta', 'catalogo_inicial');
                if (meta) return;
                const res = await fetch('assets/data/catalogo.json');
                const data = await res.json();
                await tx(['productos', 'meta'], 'readwrite', (t) => {
                    const s = t.objectStore('productos');
                    for (const fila of data.filas) {
                        const p = {};
                        data.columnas.forEach((c, i) => { p[c] = fila[i]; });
                        s.put(p);
                    }
                    t.objectStore('meta').put({ clave: 'catalogo_inicial', version: data.version, productos: data.filas.length, fecha: ahora() });
                });
            })().catch((e) => { listo = null; throw e; });
        }
        return listo;
    }

    // Copia en memoria del catálogo para filtrar rápido (2.300+ productos)
    let cacheProductos = null;
    async function productos() {
        if (!cacheProductos) cacheProductos = await todos('productos');
        return cacheProductos;
    }
    const invalidarCatalogo = () => { cacheProductos = null; };

    /* ---------- comparaciones como la colación utf8mb4_unicode_ci ---------- */

    const colador = new Intl.Collator('es', { sensitivity: 'base', numeric: false });
    const sinTildes = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const igualCi = (a, b) => a !== null && a !== undefined && colador.compare(String(a), String(b)) === 0;
    const ordenMarcaNombre = (a, b) => colador.compare(a.marca || '', b.marca || '') || colador.compare(a.nombre || '', b.nombre || '');

    /* ======================================================
       Endpoints
       ====================================================== */

    /* ---------- auth.php: un solo usuario local, sin contraseña ---------- */
    async function auth(q) {
        const accion = q.get('accion');
        if (accion === 'me' || accion === 'login' || accion === 'registrar') return { usuario: USUARIO_LOCAL, token: 'local' };
        if (accion === 'logout') return { ok: true };
        fallar('Esta función no aplica en la versión local de Atenea.', 404);
    }

    /* ---------- calculos_vi.php ---------- */
    async function calculosVi(metodo, q, body) {
        if (metodo === 'GET') {
            if (q.has('id')) {
                const r = await uno('calculos_vi', Number(q.get('id')));
                if (!r) fallar('Registro no encontrado', 404);
                return comoMySQL('calculos_vi', r);
            }
            const limite = q.has('limite') ? Math.max(1, Math.min(500, parseInt(q.get('limite'), 10) || 1)) : 100;
            const filas = (await todos('calculos_vi')).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
            return filas.slice(0, limite).map((r) => comoMySQL('calculos_vi', r));
        }
        if (metodo === 'POST') {
            const modo = body.modo || '';
            const nombre = String(body.nombre_muestra || '').trim();
            const notas = String(body.notas || '').trim();
            if (!['directo', 'hallar_U', 'hallar_Y'].includes(modo)) fallar("El campo 'modo' debe ser 'directo', 'hallar_U' o 'hallar_Y'.", 422);
            const reg = { usuario_id: 1, fecha: ahora(), nombre_muestra: nombre, modo, notas };
            if (modo === 'directo') {
                const Y = numeroRequerido(body, 'visc_100_input'), U = numeroRequerido(body, 'visc_40_input');
                const r = calcularVI(Y, U);
                Object.assign(reg, { visc_100_input: Y, visc_40_input: U, vi_resultado: r.vi, valor_L: r.L, valor_H: r.H, rama: r.rama });
            } else if (modo === 'hallar_U') {
                const Y = numeroRequerido(body, 'visc_100_input'), vi = numeroRequerido(body, 'vi_objetivo');
                const r = hallarU(Y, vi);
                Object.assign(reg, { visc_100_input: Y, vi_objetivo: vi, visc_40_resultado: r.U, valor_L: r.L, valor_H: r.H, rama: r.rama });
            } else {
                const U = numeroRequerido(body, 'visc_40_input'), vi = numeroRequerido(body, 'vi_objetivo');
                const r = hallarY(U, vi);
                Object.assign(reg, { visc_40_input: U, vi_objetivo: vi, visc_100_resultado: r.Y, valor_L: r.L, valor_H: r.H, rama: r.rama });
            }
            const fila = normalizar('calculos_vi', reg);
            const id = await tx(['calculos_vi'], 'readwrite', (t) => promesa(t.objectStore('calculos_vi').add(fila)));
            return comoMySQL('calculos_vi', { ...fila, id });
        }
        if (metodo === 'DELETE') {
            const id = Number(q.get('id'));
            if (!id) fallar('Falta el id a eliminar', 422);
            if (!(await uno('calculos_vi', id))) fallar('Registro no encontrado', 404);
            await tx(['calculos_vi'], 'readwrite', (t) => t.objectStore('calculos_vi').delete(id));
            return { eliminado: true };
        }
        fallar('Metodo no soportado', 405);
    }

    function numeroRequerido(body, campo) {
        const v = body[campo];
        if (v === undefined || v === null || v === '' || !isFinite(Number(v))) fallar(`El campo '${campo}' es requerido y debe ser numerico.`, 422);
        return Number(v);
    }

    /* ---------- aceites.php (con su curva y sus búsquedas) ---------- */
    async function aceites(metodo, q, body) {
        if (metodo === 'GET') {
            if (q.has('id')) {
                const a = await uno('aceites', Number(q.get('id')));
                if (!a) fallar('Aceite no encontrado', 404);
                const out = comoMySQL('aceites', a);
                out.curva = a.curva.map((p) => ({ temperatura_c: p.temperatura_c, viscosidad_cst: Number(p.viscosidad_cst).toFixed(4) }));
                const busq = await tx(['busquedas'], 'readonly', (t) => promesa(t.objectStore('busquedas').index('aceite_id').getAll(a.id)));
                out.busquedas = busq.sort((x, y) => y.fecha.localeCompare(x.fecha)).map((b) => comoMySQL('busquedas', b));
                return out;
            }
            const filas = (await todos('aceites')).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.id - a.id);
            return filas.map((a) => comoMySQL('aceites', a));
        }
        if (metodo === 'POST') {
            const nombre = String(body.nombre || '').trim();
            if (!nombre) fallar("El campo 'nombre' es requerido.", 422);
            const v40 = numeroRequerido(body, 'visc_40'), v100 = numeroRequerido(body, 'visc_100');
            const ab = calcularAB(v40, v100);
            const curva = generarCurva(ab.A, ab.B);
            const fila = normalizar('aceites', {
                usuario_id: 1, fecha: ahora(), nombre, visc_40: v40, visc_100: v100,
                constante_A: ab.A, constante_B: ab.B, notas: String(body.notas || '').trim(),
            });
            fila.curva = curva.map((p) => ({ temperatura_c: p.temperatura_c, viscosidad_cst: redondear(p.viscosidad_cst, 4) }));
            const id = await tx(['aceites'], 'readwrite', (t) => promesa(t.objectStore('aceites').add(fila)));
            const out = comoMySQL('aceites', { ...fila, id });
            out.curva = curva; // igual que el PHP: la curva recién calculada, sin redondear
            return out;
        }
        if (metodo === 'DELETE') {
            const id = Number(q.get('id'));
            if (!id) fallar('Falta el id a eliminar', 422);
            if (!(await uno('aceites', id))) fallar('Aceite no encontrado', 404);
            await tx(['aceites', 'busquedas'], 'readwrite', async (t) => {
                t.objectStore('aceites').delete(id);
                const ids = await promesa(t.objectStore('busquedas').index('aceite_id').getAllKeys(id));
                ids.forEach((k) => t.objectStore('busquedas').delete(k));
            });
            return { eliminado: true };
        }
        fallar('Metodo no soportado', 405);
    }

    /* ---------- busqueda_temperatura.php ---------- */
    async function busquedaTemperatura(metodo, q, body) {
        if (metodo !== 'POST') fallar('Metodo no soportado', 405);
        const aceiteId = body.aceite_id;
        if (!aceiteId) fallar("El campo 'aceite_id' es requerido.", 422);
        const viscObjetivo = numeroRequerido(body, 'viscosidad_objetivo');
        const tolerancia = body.tolerancia_pct !== undefined && body.tolerancia_pct !== '' && body.tolerancia_pct !== null ? Number(body.tolerancia_pct) : 0.05;
        const aceite = await uno('aceites', Number(aceiteId));
        if (!aceite) fallar('Aceite no encontrado', 404);
        const A = Number(aceite.constante_A), B = Number(aceite.constante_B);
        const viscSuperior = viscObjetivo + tolerancia * viscObjetivo;
        const viscInferior = viscObjetivo - viscObjetivo * tolerancia;
        const tempMin = temperaturaParaViscosidad(A, B, viscSuperior);
        const tempMax = temperaturaParaViscosidad(A, B, viscInferior);
        const fila = normalizar('busquedas', {
            aceite_id: Number(aceiteId), fecha: ahora(), viscosidad_objetivo: viscObjetivo, tolerancia_pct: tolerancia,
            visc_inferior: viscInferior, visc_superior: viscSuperior, temp_min_c: tempMin, temp_max_c: tempMax,
        });
        await tx(['busquedas'], 'readwrite', (t) => t.objectStore('busquedas').add(fila));
        return {
            aceite_id: aceiteId, aceite_nombre: aceite.nombre, viscosidad_objetivo: viscObjetivo, tolerancia_pct: tolerancia,
            visc_inferior: viscInferior, visc_superior: viscSuperior, temp_min_c: tempMin, temp_max_c: tempMax,
        };
    }

    /* ---------- catalogo.php ---------- */

    const FILTROS_EXACTOS = [
        ['marca', 'marca'], ['categoria', 'categoria'], ['tipo_base', 'tipo_base'], ['tipo_espesante', 'tipo_espesante'],
        ['nlgi', 'nlgi'], ['grado_sae', 'grado_sae'], ['aceite_naturaleza', 'aceite_naturaleza'], ['iso_vg', 'iso_vg'],
    ];
    const FILTROS_RANGO = [
        ['viscosidad_40', 'visc40'], ['viscosidad_100', 'visc100'], ['indice_viscosidad', 'vi'],
        ['punto_vertido', 'pv'], ['punto_inflamacion', 'pi'],
    ];

    /** Aplica los mismos filtros que catalogo.php y export_excel.php. */
    function filtrarCatalogo(lista, q) {
        let r = lista;
        for (const [campo, param] of FILTROS_EXACTOS) {
            const v = q.get(param);
            if (v === null || v === '') continue;
            if (campo === 'iso_vg') r = r.filter((p) => p.iso_vg !== null && Number(p.iso_vg) === Number(v));
            else r = r.filter((p) => igualCi(p[campo], v));
        }
        for (const [campo, pref] of FILTROS_RANGO) {
            const min = q.get(pref + '_min'), max = q.get(pref + '_max');
            if (min !== null && min !== '') r = r.filter((p) => p[campo] !== null && p[campo] >= (parseFloat(min) || 0));
            if (max !== null && max !== '') r = r.filter((p) => p[campo] !== null && p[campo] <= (parseFloat(max) || 0));
        }
        const texto = (q.get('texto') || '').trim();
        if (texto) {
            const t = sinTildes(texto);
            r = r.filter((p) => sinTildes(p.nombre).includes(t));
        }
        return r.slice().sort(ordenMarcaNombre);
    }

    const COLUMNAS_BUSQUEDA = ['id', 'nombre', 'marca', 'categoria', 'aceite_naturaleza', 'tipo_base', 'tipo_espesante', 'nlgi', 'grado_sae', 'iso_vg',
        'viscosidad_40', 'viscosidad_100', 'viscosidad_100_estimada', 'indice_viscosidad', 'punto_vertido', 'punto_inflamacion', 'densidad'];

    const distintos = (lista, campo, ordenar) => {
        const vistos = new Map();
        for (const p of lista) {
            const v = p[campo];
            if (v === null || v === undefined || v === '') continue;
            const k = typeof v === 'number' ? v : sinTildes(v);
            if (!vistos.has(k)) vistos.set(k, v);
        }
        return [...vistos.values()].sort(ordenar || ((a, b) => colador.compare(String(a), String(b))));
    };

    async function catalogo(metodo, q, body) {
        const lista = await productos();

        if (metodo === 'PATCH') { // completar un dato faltante calculado (igual que el PHP)
            const id = Number(q.get('id'));
            if (!id) fallar('Falta id de producto valido', 422);
            const permitidos = ['viscosidad_40', 'viscosidad_100', 'indice_viscosidad'];
            if (!permitidos.includes(body.campo)) fallar('Campo invalido. Debe ser uno de: ' + permitidos.join(', '), 422);
            if (!isFinite(Number(body.valor)) || body.valor === '' || body.valor === null) fallar('Valor invalido', 422);
            const p = await uno('productos', id);
            if (!p) fallar('Producto no encontrado', 404);
            if (p[body.campo] !== null && p[body.campo] !== undefined) fallar('Ese producto ya tiene un valor en ese campo; no se sobrescribe automaticamente.', 409);
            p[body.campo] = Number(body.valor);
            p[body.campo + '_estimada'] = 1;
            const fila = normalizar('productos', p);
            await tx(['productos'], 'readwrite', (t) => t.objectStore('productos').put(fila));
            invalidarCatalogo();
            return comoMySQL('productos', fila);
        }

        // --- edición completa del catálogo (nuevo en la versión local) ---
        if (metodo === 'POST' || metodo === 'PUT') {
            const datos = validarProducto(body);
            let fila;
            if (metodo === 'POST') {
                const maxId = lista.reduce((m, p) => Math.max(m, p.id), 0);
                fila = normalizar('productos', { ...datos, id: maxId + 1 });
            } else {
                const id = Number(q.get('id'));
                const actual = await uno('productos', id);
                if (!actual) fallar('Producto no encontrado', 404);
                fila = { ...actual, ...datos, id };
                // si el usuario escribe a mano un valor, deja de ser "estimado"
                for (const c of ['viscosidad_40', 'viscosidad_100', 'indice_viscosidad']) {
                    if (Number(actual[c]) !== Number(fila[c]) || fila[c] === null) fila[c + '_estimada'] = 0;
                }
                fila = normalizar('productos', fila);
            }
            await tx(['productos'], 'readwrite', (t) => t.objectStore('productos').put(fila));
            invalidarCatalogo();
            return comoMySQL('productos', fila);
        }
        if (metodo === 'DELETE') {
            const id = Number(q.get('id'));
            if (!(await uno('productos', id))) fallar('Producto no encontrado', 404);
            await tx(['productos', 'registrados'], 'readwrite', (t) => {
                t.objectStore('productos').delete(id);
                t.objectStore('registrados').delete(id);
            });
            invalidarCatalogo();
            return { eliminado: true };
        }

        if (metodo !== 'GET') fallar('Metodo no soportado', 405);

        if (q.has('id')) {
            const p = lista.find((x) => x.id === Number(q.get('id')));
            if (!p) fallar('Producto no encontrado', 404);
            return comoMySQL('productos', p);
        }

        if (q.has('equivalencias')) {
            const base = lista.find((x) => x.id === Number(q.get('equivalencias')));
            if (!base) fallar('Producto no encontrado', 404);
            let candidatos = lista.filter((c) => igualCi(c.categoria, base.categoria) && c.id !== base.id);
            let criterio = null;
            if (base.iso_vg !== null) { candidatos = candidatos.filter((c) => c.iso_vg !== null && c.iso_vg === base.iso_vg); criterio = 'iso_vg'; }
            else if (base.nlgi !== null) { candidatos = candidatos.filter((c) => igualCi(c.nlgi, base.nlgi)); criterio = 'nlgi'; }
            else if (base.grado_sae !== null) { candidatos = candidatos.filter((c) => igualCi(c.grado_sae, base.grado_sae)); criterio = 'grado_sae'; }
            else if (base.viscosidad_40 !== null) {
                const lo = base.viscosidad_40 * 0.9, hi = base.viscosidad_40 * 1.1;
                candidatos = candidatos.filter((c) => c.viscosidad_40 !== null && c.viscosidad_40 >= lo && c.viscosidad_40 <= hi);
                criterio = 'viscosidad_40 ±10%';
            } else {
                return { base: comoMySQL('productos', base), criterio: null, equivalencias: [] };
            }
            const conPuntaje = candidatos.map((c) => {
                let score = 0;
                if (base.viscosidad_40 !== null && c.viscosidad_40 !== null) score += Math.abs(c.viscosidad_40 - base.viscosidad_40) / base.viscosidad_40 * 100;
                if (base.viscosidad_100 !== null && c.viscosidad_100 !== null) score += Math.abs(c.viscosidad_100 - base.viscosidad_100) / base.viscosidad_100 * 100 * 0.5;
                if (base.indice_viscosidad !== null && c.indice_viscosidad !== null) score += Math.abs(c.indice_viscosidad - base.indice_viscosidad) * 0.2;
                if (base.tipo_base !== null && c.tipo_base !== null && c.tipo_base !== base.tipo_base) score += 5;
                return { ...comoMySQL('productos', c), _score: Math.round(score * 100) / 100, misma_marca: c.marca === base.marca };
            });
            conPuntaje.sort((a, b) => a._score - b._score);
            const limite = q.has('limite') ? Math.max(1, Math.min(50, parseInt(q.get('limite'), 10) || 1)) : 10;
            return { base: comoMySQL('productos', base), criterio, equivalencias: conPuntaje.slice(0, limite) };
        }

        if (q.has('opciones')) {
            return {
                marcas: distintos(lista, 'marca'),
                categorias: distintos(lista, 'categoria'),
                tipos_base: distintos(lista, 'tipo_base'),
                tipos_espesante: distintos(lista, 'tipo_espesante'),
                nlgi: distintos(lista, 'nlgi'),
                grados_sae: distintos(lista, 'grado_sae'),
                iso_vg: distintos(lista, 'iso_vg', (a, b) => a - b).map((v) => Number(v).toFixed(2)),
            };
        }

        const filtrados = filtrarCatalogo(lista, q);
        const limite = q.has('limite') ? Math.max(1, Math.min(500, parseInt(q.get('limite'), 10) || 1)) : 100;
        const mostrados = filtrados.slice(0, limite).map((p) => {
            const m = comoMySQL('productos', p), out = {};
            COLUMNAS_BUSQUEDA.forEach((c) => { out[c] = m[c]; });
            return out;
        });
        return { total: filtrados.length, mostrados: mostrados.length, productos: mostrados };
    }

    // Texto plano: el catálogo se muestra como HTML, así que nunca se guardan etiquetas
    const textoPlano = (v) => {
        if (v === null || v === undefined) return null;
        const s = String(v).replace(/<[^>]*>/g, '').trim();
        return s === '' ? null : s;
    };
    const numeroONulo = (v, campo) => {
        if (v === null || v === undefined || String(v).trim() === '') return null;
        const n = Number(String(v).replace(',', '.'));
        if (!isFinite(n)) fallar(`El campo "${campo}" debe ser un número.`, 422);
        return n;
    };

    function validarProducto(b) {
        const nombre = textoPlano(b.nombre), marca = textoPlano(b.marca), categoria = textoPlano(b.categoria);
        if (!nombre) fallar('El nombre del producto es obligatorio.', 422);
        if (!marca) fallar('La marca es obligatoria.', 422);
        if (!categoria) fallar('La categoría es obligatoria.', 422);
        const p = {
            nombre: nombre.slice(0, 200), marca: marca.slice(0, 80), categoria: categoria.slice(0, 120),
            aceite_naturaleza: textoPlano(b.aceite_naturaleza), tipo_base: textoPlano(b.tipo_base),
            grado_sae: textoPlano(b.grado_sae), tipo_espesante: textoPlano(b.tipo_espesante), nlgi: textoPlano(b.nlgi),
            iso_vg: numeroONulo(b.iso_vg, 'ISO VG'),
            viscosidad_40: numeroONulo(b.viscosidad_40, 'Viscosidad a 40°C'),
            viscosidad_100: numeroONulo(b.viscosidad_100, 'Viscosidad a 100°C'),
            indice_viscosidad: numeroONulo(b.indice_viscosidad, 'Índice de viscosidad'),
            punto_vertido: numeroONulo(b.punto_vertido, 'Punto de vertido'),
            punto_inflamacion: numeroONulo(b.punto_inflamacion, 'Punto de inflamación'),
            densidad: numeroONulo(b.densidad, 'Densidad'),
            caracteristicas: textoPlano(b.caracteristicas),
            viscosidad_40_estimada: 0, viscosidad_100_estimada: 0, indice_viscosidad_estimada: 0,
        };
        if (p.viscosidad_40 !== null && p.viscosidad_40 <= 0) fallar('La viscosidad a 40°C debe ser mayor que 0.', 422);
        if (p.viscosidad_100 !== null && p.viscosidad_100 <= 0) fallar('La viscosidad a 100°C debe ser mayor que 0.', 422);
        if (p.viscosidad_40 !== null && p.viscosidad_100 !== null && p.viscosidad_100 >= p.viscosidad_40) {
            fallar('La viscosidad a 100°C debe ser menor que la de 40°C.', 422);
        }
        return p;
    }

    /* ---------- registrados.php ---------- */
    async function registrados(metodo, q, body) {
        if (metodo === 'GET') {
            const regs = (await todos('registrados')).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.registro_id - a.registro_id);
            const lista = await productos();
            const porId = new Map(lista.map((p) => [p.id, p]));
            return regs.filter((r) => porId.has(r.producto_id)).map((r) => ({
                registro_id: r.registro_id, nota: r.nota, fecha: r.fecha, ...comoMySQL('productos', porId.get(r.producto_id)),
            }));
        }
        if (metodo === 'POST') {
            const id = Number(body.producto_id);
            if (!id) fallar('Falta producto_id', 422);
            if (!(await uno('productos', id))) fallar('Producto no encontrado', 404);
            if (await uno('registrados', id)) return { ya_registrado: true };
            const registro_id = Date.now();
            await tx(['registrados'], 'readwrite', (t) => t.objectStore('registrados').put({ producto_id: id, registro_id, nota: body.nota ?? null, fecha: ahora() }));
            return { id: registro_id };
        }
        if (metodo === 'DELETE') {
            const id = Number(q.get('producto_id'));
            if (!id) fallar('Falta el parametro producto_id', 422);
            await tx(['registrados'], 'readwrite', (t) => t.objectStore('registrados').delete(id));
            return { eliminado: true };
        }
        fallar('Metodo no soportado', 405);
    }

    /* ======================================================
       Punto de entrada: equivalente a fetch('api/' + path)
       ====================================================== */

    const RUTAS = {
        'auth.php': auth,
        'calculos_vi.php': calculosVi,
        'aceites.php': aceites,
        'busqueda_temperatura.php': busquedaTemperatura,
        'catalogo.php': catalogo,
        'registrados.php': registrados,
    };

    async function solicitud(path, opciones = {}) {
        await asegurarDatos();
        const [archivo, query = ''] = path.split('?');
        const q = new URLSearchParams(query);
        const metodo = (opciones.method || 'GET').toUpperCase();
        let body = {};
        if (opciones.body) {
            try { body = JSON.parse(opciones.body) || {}; } catch (e) { body = {}; }
        }
        const fn = archivo === 'auth.php' ? (m, qq) => auth(qq) : RUTAS[archivo];
        if (!fn) fallar('Función no disponible en la versión local', 404);
        return fn(metodo, q, body);
    }

    /* ---------- datos para exportaciones y copia de seguridad ---------- */

    window.AteneaLocal = {
        USUARIO_LOCAL,
        solicitud,
        asegurarDatos,
        comoMySQL,
        filtrarCatalogo,
        productos,
        todos,
        uno,
        tx,
        promesa,
        normalizar,
        invalidarCatalogo,
        ahora,
    };
})();

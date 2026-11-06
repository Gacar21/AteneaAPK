/* =========================================================
   Atenea local — catálogo editable y copia de seguridad
   ---------------------------------------------------------
   - Agregar, editar y eliminar productos del catálogo
   - Exportar / importar todos los datos como un archivo
     (para pasarlos a otro teléfono o tener respaldo)
   - Restaurar el catálogo original
   Se carga DESPUÉS de app.js y usa sus funciones globales.
   ========================================================= */
(function () {
    'use strict';

    const NATURALEZAS = ['mineral', 'sintético', 'semisintético'];

    /* ---------- utilidades ---------- */

    const valorCampo = (p, c) => {
        const v = p ? p[c] : null;
        if (v === null || v === undefined) return '';
        if (['iso_vg', 'viscosidad_40', 'viscosidad_100', 'indice_viscosidad', 'punto_vertido', 'punto_inflamacion', 'densidad'].includes(c)) {
            return String(parseFloat(v));
        }
        return String(v);
    };

    async function refrescarCatalogo() {
        // vuelve a llenar los filtros (pueden haber aparecido marcas o categorías nuevas)
        const selects = ['#cat-categoria', '#cat-marca', '#cat-tipo-base', '#cat-tipo-espesante', '#cat-nlgi', '#cat-grado-sae', '#cat-iso-vg', '#cat-naturaleza'];
        const elegidos = {};
        selects.forEach((id) => {
            const sel = $(id);
            elegidos[id] = sel.value;
            while (sel.options.length > 1) sel.remove(1);
        });
        await cargarOpcionesCatalogo(); // también vuelve a buscar
        selects.forEach((id) => {
            const sel = $(id);
            if ([...sel.options].some((o) => o.value === elegidos[id])) sel.value = elegidos[id];
        });
        await buscarCatalogo();
        await cargarRegistrados();
    }

    /* ======================================================
       Formulario de producto (nuevo / editar)
       ====================================================== */

    async function abrirFormulario(producto = null) {
        $('#cat-modal-overlay').classList.remove('hidden');
        const op = await AteneaLocal.solicitud('catalogo.php?opciones=1');
        const lista = (id, valores) => `<datalist id="${id}">${valores.map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
        const texto = (c, label, extra = '') => `
            <div class="field"><label for="pf-${c}">${label}</label>
            <input type="text" id="pf-${c}" value="${esc(valorCampo(producto, c))}" ${extra}></div>`;
        const numero = (c, label) => `
            <div class="field"><label for="pf-${c}">${label}</label>
            <input type="number" step="any" inputmode="decimal" id="pf-${c}" value="${esc(valorCampo(producto, c))}"></div>`;

        $('#cat-modal-contenido').innerHTML = `
            <div class="card-title" style="margin:0 0 4px;">${producto ? 'Editar producto' : 'Nuevo producto'}</div>
            <div class="view-desc" style="margin-bottom:14px;">Los campos con * son obligatorios. Los demás puedes dejarlos vacíos.</div>
            <form id="pf-form" novalidate>
                ${texto('nombre', 'Nombre del producto *', 'required maxlength="200"')}
                <div class="grid-2">
                    ${texto('marca', 'Marca *', 'list="pf-marcas" required maxlength="80"')}
                    ${texto('categoria', 'Categoría *', 'list="pf-categorias" required maxlength="120"')}
                </div>
                <div class="grid-2">
                    <div class="field"><label for="pf-aceite_naturaleza">Naturaleza</label>
                        <select id="pf-aceite_naturaleza"><option value="">—</option>
                        ${NATURALEZAS.map((n) => `<option ${producto && producto.aceite_naturaleza === n ? 'selected' : ''}>${n}</option>`).join('')}
                        </select></div>
                    ${texto('tipo_base', 'Tipo de base', 'list="pf-bases"')}
                </div>
                <div class="grid-2">
                    ${numero('iso_vg', 'ISO VG')}
                    ${texto('grado_sae', 'Grado SAE', 'list="pf-sae" placeholder="Ej: 15W-40"')}
                </div>
                <div class="grid-2">
                    ${texto('tipo_espesante', 'Tipo de espesante (grasas)', 'list="pf-espesantes"')}
                    ${texto('nlgi', 'NLGI (grasas)', 'list="pf-nlgi"')}
                </div>
                <div class="grid-2">
                    ${numero('viscosidad_40', 'Viscosidad a 40°C (cSt)')}
                    ${numero('viscosidad_100', 'Viscosidad a 100°C (cSt)')}
                </div>
                <div class="field">
                    <label for="pf-indice_viscosidad">Índice de viscosidad</label>
                    <div class="local-con-boton">
                        <input type="number" step="any" inputmode="decimal" id="pf-indice_viscosidad" value="${esc(valorCampo(producto, 'indice_viscosidad'))}">
                        <button type="button" class="btn btn-ghost btn-sm" id="pf-calcular-iv">Calcular</button>
                    </div>
                    <div class="field-hint">“Calcular” usa la viscosidad a 40°C y 100°C con la norma ASTM D2270.</div>
                </div>
                <div class="grid-2">
                    ${numero('punto_vertido', 'Punto de vertido (°C)')}
                    ${numero('punto_inflamacion', 'Punto de inflamación (°C)')}
                </div>
                ${numero('densidad', 'Densidad (g/cm³)')}
                <div class="field"><label for="pf-caracteristicas">Características</label>
                    <textarea id="pf-caracteristicas" rows="4">${esc(valorCampo(producto, 'caracteristicas'))}</textarea></div>
                <div id="pf-error" class="login-error hidden"></div>
                <div class="btn-row action-bar-mobile stack-mobile">
                    <button type="submit" class="btn btn-primary">${producto ? 'Guardar cambios' : 'Agregar al catálogo'}</button>
                    <button type="button" class="btn btn-ghost" id="pf-cancelar">Cancelar</button>
                </div>
            </form>
            ${lista('pf-marcas', op.marcas)}${lista('pf-categorias', op.categorias)}${lista('pf-bases', op.tipos_base)}
            ${lista('pf-sae', op.grados_sae)}${lista('pf-espesantes', op.tipos_espesante)}${lista('pf-nlgi', op.nlgi)}
        `;

        $('#pf-cancelar').addEventListener('click', () => (producto ? abrirDetalleProducto(producto.id) : cerrarModalProducto()));
        $('#pf-calcular-iv').addEventListener('click', () => {
            const u = parseFloat($('#pf-viscosidad_40').value), y = parseFloat($('#pf-viscosidad_100').value);
            if (!(u > 0) || !(y > 0)) return toast('Escribe primero la viscosidad a 40°C y a 100°C.', 'error');
            if (y >= u) return toast('La viscosidad a 100°C debe ser menor que la de 40°C.', 'error');
            try {
                $('#pf-indice_viscosidad').value = Math.round(calcularVI(y, u).vi * 100) / 100;
            } catch (e) { toast(e.message, 'error'); }
        });
        $('#pf-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const campos = ['nombre', 'marca', 'categoria', 'aceite_naturaleza', 'tipo_base', 'grado_sae', 'tipo_espesante', 'nlgi', 'iso_vg',
                'viscosidad_40', 'viscosidad_100', 'indice_viscosidad', 'punto_vertido', 'punto_inflamacion', 'densidad', 'caracteristicas'];
            const body = {};
            campos.forEach((c) => { body[c] = $('#pf-' + c).value; });
            try {
                const guardado = await AteneaLocal.solicitud(producto ? 'catalogo.php?id=' + producto.id : 'catalogo.php', {
                    method: producto ? 'PUT' : 'POST', body: JSON.stringify(body),
                });
                toast(producto ? 'Producto actualizado' : 'Producto agregado al catálogo', 'success');
                await refrescarCatalogo();
                renderModalProducto(guardado);
            } catch (err) {
                const box = $('#pf-error');
                box.textContent = err.message;
                box.classList.remove('hidden');
                box.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        });
        setTimeout(() => $('#pf-nombre').focus(), 50);
    }

    async function eliminarProducto(p) {
        if (!confirm(`¿Eliminar "${p.marca} ${p.nombre}" del catálogo?\n\nSe borra solo de este teléfono.`)) return;
        try {
            await AteneaLocal.solicitud('catalogo.php?id=' + p.id, { method: 'DELETE' });
            cerrarModalProducto();
            toast('Producto eliminado', 'success');
            await refrescarCatalogo();
        } catch (e) { toast(e.message, 'error'); }
    }

    // La ficha del producto conserva todo lo original y suma "Editar" y "Eliminar"
    const renderOriginal = window.renderModalProducto;
    window.renderModalProducto = function (p) {
        renderOriginal(p);
        const fila = $('#cat-modal-export-pdf')?.parentElement;
        if (!fila) return;
        const editar = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-ghost btn-sm', textContent: 'Editar' });
        const eliminar = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-ghost btn-sm local-btn-peligro', textContent: 'Eliminar' });
        editar.addEventListener('click', () => abrirFormulario(p));
        eliminar.addEventListener('click', () => eliminarProducto(p));
        fila.append(editar, eliminar);
    };

    /* ======================================================
       Copia de seguridad
       ====================================================== */

    const STORES = ['productos', 'calculos_vi', 'aceites', 'busquedas', 'registrados'];

    async function exportarRespaldo() {
        await AteneaLocal.asegurarDatos();
        const datos = { app: 'atenea-local', formato: 1, fecha: AteneaLocal.ahora() };
        for (const s of STORES) datos[s] = await AteneaLocal.todos(s);
        const bytes = new TextEncoder().encode(JSON.stringify(datos));
        const hoy = AteneaLocal.ahora().slice(0, 10);
        await AteneaExport.entregar({ bytes, nombre: `atenea_respaldo_${hoy}.json`, mime: 'application/json' });
        return datos;
    }

    async function importarRespaldo(archivo, modo) {
        let datos;
        try {
            datos = JSON.parse(await archivo.text());
        } catch (e) { throw new Error('El archivo no es un respaldo válido de Atenea.'); }
        if (!datos || datos.app !== 'atenea-local' || !Array.isArray(datos.productos)) throw new Error('El archivo no es un respaldo de Atenea.');
        const limpiar = (p) => {
            const t = (v) => (v === null || v === undefined ? null : String(v).replace(/<[^>]*>/g, ''));
            return { ...p, nombre: t(p.nombre), marca: t(p.marca), categoria: t(p.categoria), caracteristicas: t(p.caracteristicas) };
        };
        const tiendas = modo === 'todo' ? STORES : ['productos', 'registrados'];
        await AteneaLocal.tx([...tiendas, 'meta'], 'readwrite', (t) => {
            for (const s of tiendas) {
                const st = t.objectStore(s);
                st.clear();
                for (const fila of datos[s] || []) st.put(s === 'productos' ? limpiar(fila) : fila);
            }
            // marca que el catálogo ya está cargado para que no se reemplace por el original
            t.objectStore('meta').put({ clave: 'catalogo_inicial', version: 'respaldo ' + (datos.fecha || ''), productos: datos.productos.length, fecha: AteneaLocal.ahora() });
        });
        AteneaLocal.invalidarCatalogo();
        return { productos: datos.productos.length, calculos: (datos.calculos_vi || []).length, aceites: (datos.aceites || []).length };
    }

    async function restaurarOriginal() {
        await AteneaLocal.tx(['productos', 'registrados', 'meta'], 'readwrite', (t) => {
            t.objectStore('productos').clear();
            t.objectStore('registrados').clear();
            t.objectStore('meta').delete('catalogo_inicial');
        });
        AteneaLocal.invalidarCatalogo();
        // vuelve a cargar el catálogo empaquetado con la app
        location.reload();
    }

    function panelRespaldo() {
        let panel = document.getElementById('local-respaldo-panel');
        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'local-respaldo-panel';
            panel.className = 'local-sheet-overlay';
            panel.innerHTML = `
                <div class="local-sheet" role="dialog" aria-label="Datos y respaldo">
                    <div class="local-sheet-titulo">Datos y respaldo</div>
                    <div class="local-sheet-sub" id="local-respaldo-resumen">Todo se guarda en este teléfono, sin internet.</div>
                    <div class="local-sheet-botones">
                        <button class="btn btn-primary" id="lr-exportar">Guardar copia de seguridad</button>
                        <button class="btn btn-ghost" id="lr-importar-todo">Restaurar desde un archivo</button>
                        <button class="btn btn-ghost" id="lr-importar-catalogo">Importar solo el catálogo</button>
                        <button class="btn btn-ghost local-btn-peligro" id="lr-original">Volver al catálogo original</button>
                        <button class="btn btn-ghost" id="lr-cerrar">Cerrar</button>
                    </div>
                    <input type="file" id="lr-archivo" accept=".json,application/json" hidden>
                </div>`;
            document.body.appendChild(panel);
            const cerrar = () => panel.classList.add('hidden');
            panel.addEventListener('click', (e) => { if (e.target === panel) cerrar(); });
            panel.querySelector('#lr-cerrar').addEventListener('click', cerrar);
            panel.querySelector('#lr-exportar').addEventListener('click', async () => {
                cerrar();
                try {
                    const d = await exportarRespaldo();
                    if (!window.Android) toast(`Copia guardada: ${d.productos.length} productos, ${d.calculos_vi.length} cálculos, ${d.aceites.length} aceites.`, 'success');
                } catch (e) { toast('No se pudo crear la copia: ' + e.message, 'error'); }
            });
            let modo = 'todo';
            const elegir = (m) => { modo = m; panel.querySelector('#lr-archivo').click(); };
            panel.querySelector('#lr-importar-todo').addEventListener('click', () => elegir('todo'));
            panel.querySelector('#lr-importar-catalogo').addEventListener('click', () => elegir('catalogo'));
            panel.querySelector('#lr-archivo').addEventListener('change', async (e) => {
                const f = e.target.files[0];
                e.target.value = '';
                if (!f) return;
                const aviso = modo === 'todo'
                    ? '¿Reemplazar TODOS los datos de este teléfono (catálogo, cálculos, curvas y registrados) por los del archivo?'
                    : '¿Reemplazar el catálogo de este teléfono por el del archivo? Tus cálculos y curvas no se tocan.';
                if (!confirm(aviso)) return;
                cerrar();
                try {
                    const r = await importarRespaldo(f, modo);
                    toast(`Restaurado: ${r.productos} productos${modo === 'todo' ? `, ${r.calculos} cálculos, ${r.aceites} aceites` : ''}.`, 'success');
                    await refrescarCatalogo();
                    cargarDashboard();
                } catch (err) { toast(err.message, 'error'); }
            });
            panel.querySelector('#lr-original').addEventListener('click', () => {
                if (!confirm('¿Volver al catálogo original? Se pierden los productos agregados o editados en este teléfono (tus cálculos y curvas se conservan).')) return;
                restaurarOriginal();
            });
        }
        AteneaLocal.productos().then((l) => {
            panel.querySelector('#local-respaldo-resumen').textContent = `Catálogo: ${l.length.toLocaleString('es-CO')} productos. Todo se guarda en este teléfono, sin internet.`;
        });
        panel.classList.remove('hidden');
    }

    /* ======================================================
       Botones nuevos en la interfaz
       ====================================================== */

    // Catálogo: "Nuevo producto" y "Respaldo" junto a las pestañas
    const filaTabs = document.querySelector('#view-catalogo .filter-row');
    if (filaTabs) {
        const caja = document.createElement('div');
        caja.className = 'local-cat-acciones';
        caja.innerHTML = `
            <button class="btn btn-primary btn-sm" id="cat-nuevo-producto">＋ Nuevo producto</button>
            <button class="btn btn-ghost btn-sm" id="cat-respaldo">Respaldo</button>`;
        filaTabs.after(caja);
        $('#cat-nuevo-producto').addEventListener('click', () => abrirFormulario(null));
        $('#cat-respaldo').addEventListener('click', panelRespaldo);
    }

    // Menú lateral: "Datos y respaldo" en lugar de contraseña / cerrar sesión
    const filaCuenta = $('#sidebar-logout-btn')?.parentElement;
    if (filaCuenta) {
        filaCuenta.innerHTML = '<button class="btn btn-ghost btn-sm" id="sidebar-respaldo-btn">Datos y respaldo</button>';
        $('#sidebar-respaldo-btn').addEventListener('click', panelRespaldo);
    }
    $('#sidebar-user-email').textContent = 'Datos guardados en este teléfono';

    // Barra superior (móvil): el botón de la llave pasa a ser "respaldo"
    const llave = $('#topbar-password-btn');
    if (llave) {
        const nuevo = llave.cloneNode(false); // sin los eventos de "cambiar contraseña"
        nuevo.id = 'topbar-respaldo-btn';
        nuevo.setAttribute('aria-label', 'Datos y respaldo');
        nuevo.title = 'Datos y respaldo';
        nuevo.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/></svg>';
        llave.replaceWith(nuevo);
        nuevo.addEventListener('click', panelRespaldo);
    }

    /* ---------- botón "atrás" de Android ---------- */
    window.handleBack = () => {
        for (const id of ['local-archivo-panel', 'local-respaldo-panel']) {
            const el = document.getElementById(id);
            if (el && !el.classList.contains('hidden')) { el.classList.add('hidden'); return true; }
        }
        const abiertos = [...document.querySelectorAll('.modal-overlay:not(.hidden)')];
        if (abiertos.length) {
            if (abiertos.some((m) => m.id === 'cat-modal-overlay')) cerrarModalProducto();
            else abiertos.forEach((m) => m.classList.add('hidden'));
            return true;
        }
        if (document.body.classList.contains('sidebar-open') || document.getElementById('sidebar')?.classList.contains('open')) {
            document.getElementById('sidebar-scrim')?.click();
            return true;
        }
        const activa = document.querySelector('.view.active');
        if (activa && activa.id !== 'view-dashboard') { irAVista('dashboard'); return true; }
        return false;
    };

    window.AteneaCatalogoEditor = { abrirFormulario, panelRespaldo, exportarRespaldo, importarRespaldo };
})();

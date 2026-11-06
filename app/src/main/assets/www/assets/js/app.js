/* =========================================================
   Atenea — app.js
   - Motor matematico (espejo exacto de api/MathViscosidad.php)
   - Navegacion SPA
   - Llamadas a la API (guardar / listar / exportar)
   - Graficas con Chart.js
   ========================================================= */

const API = 'api/';

/* ---------------------------------------------------------
   0) MODULOS HABILITADOS EN ESTA ENTREGA
   ---------------------------------------------------------
   Esta es la UNICA linea que cambia entre los distintos paquetes
   de entrega parcial del proyecto (Modulo 1 solo, Modulo 1+2, o
   los 3 modulos completos). El modulo de Indice de Viscosidad
   (Modulo 1) siempre esta disponible: es la base del sistema.
   --------------------------------------------------------- */
const MODULOS_HABILITADOS = {
    curvas: true,   // Modulo 2 - Curvas Viscosidad-Temperatura
    catalogo: true,  // Modulo 3 - Biblioteca de Lubricantes (habilitado en la versión local)
};

/* ---------------------------------------------------------
   1) MOTOR MATEMATICO (identico al de los Excel originales)
   --------------------------------------------------------- */

// La tabla ASTM_D2270_TABLE (astm_table.js) ya viene ordenada ascendente
// por v. OJO: su paso NO es uniforme (0.1 de 2.0 a 20.0 cSt, 0.2 de 20.0
// a 30.0 cSt, 0.5 de 30.0 a 70.0 cSt), asi que no se puede indexar por
// "floor(v)+0.1" como antes. En vez de eso, interpolarASTM ubica el par
// de filas consecutivas de la tabla que realmente encierran a `visc`
// mediante busqueda binaria, sin asumir ningun paso.
function interpolarASTM(visc, columna) {
    if (visc < 70) {
        const tabla = ASTM_D2270_TABLE;
        const n = tabla.length;

        // Igual que el original: por debajo del minimo de la tabla se
        // ancla al primer punto (2.0 cSt).
        if (visc <= tabla[0].v) return tabla[0][columna];
        if (visc > tabla[n - 1].v) {
            throw new Error('Viscosidad a 100°C fuera del rango de la tabla ASTM D2270 (2.0 - 70.0 cSt).');
        }

        // Busqueda binaria del intervalo [lo, hi] tal que tabla[lo].v <= visc < tabla[hi].v
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;
            if (tabla[mid].v <= visc) lo = mid; else hi = mid;
        }

        const pF = tabla[lo], pN = tabla[hi];
        // Interpolacion lineal real entre los dos puntos que encierran a
        // `visc` (equivalente algebraico de la formula original del
        // Excel, generalizada al paso real en vez de asumir 0.1):
        return pF[columna] + (visc - pF.v) / (pN.v - pF.v) * (pN[columna] - pF[columna]);
    }
    if (columna === 'L') return 0.8353 * visc ** 2 + 14.67 * visc - 216;
    return 0.1684 * visc ** 2 + 11.85 * visc - 97;
}

function calcularVI(Y, U) {
    const L = interpolarASTM(Y, 'L');
    const H = interpolarASTM(Y, 'H');

    const viA = ((L - U) / (L - H)) * 100;

    const N = (Math.log10(H) - Math.log10(U)) / Math.log10(Y);
    const viB = ((10 ** N) - 1) / 0.00715 + 100;

    if (viA <= 100) return { vi: viA, L, H, rama: 'VI<=100' };
    return { vi: viB, L, H, rama: 'VI>100' };
}

function hallarU(Y, viObjetivo) {
    let low = 0.5, high = 100000;
    for (let i = 0; i < 200; i++) {
        const mid = (low + high) / 2;
        const vi = calcularVI(Y, mid).vi;
        if (vi > viObjetivo) low = mid; else high = mid;
        if (Math.abs(high - low) < 1e-9) break;
    }
    const U = (low + high) / 2;
    return { U, ...calcularVI(Y, U) };
}

function hallarY(U, viObjetivo) {
    let low = 1.0, high = Math.min(U - 0.01, 3000);
    if (high <= low) high = low + 1;
    for (let i = 0; i < 200; i++) {
        const mid = (low + high) / 2;
        const vi = calcularVI(mid, U).vi;
        if (vi < viObjetivo) low = mid; else high = mid;
        if (Math.abs(high - low) < 1e-9) break;
    }
    const Y = (low + high) / 2;
    return { Y, ...calcularVI(Y, U) };
}

function calcularAB(v40, v100) {
    const y40 = Math.log10(Math.log10(v40 + 0.7));
    const y100 = Math.log10(Math.log10(v100 + 0.7));
    const x40 = Math.log10(40 + 273.15);
    const x100 = Math.log10(100 + 273.15);
    const B = (y100 - y40) / (x40 - x100);
    const A = y40 + B * x40;
    return { A, B };
}

function viscosidadATemp(A, B, tempC) {
    return 10 ** (10 ** (A - B * Math.log10(tempC + 273.15))) - 0.7;
}

function temperaturaParaViscosidad(A, B, visc) {
    return 10 ** ((A - Math.log10(Math.log10(visc + 0.7))) / B) - 273.15;
}

const TEMPS_CURVA = [10,20,30,40,50,60,70,80,90,100,110,120,130,140,150,160,170,180,190,200,210,220,230];

function generarCurva(A, B) {
    return TEMPS_CURVA.map(t => ({ temperatura_c: t, viscosidad_cst: viscosidadATemp(A, B, t) }));
}

/* ---------------------------------------------------------
   2) UTILIDADES DE UI
   --------------------------------------------------------- */

function $(sel, ctx = document) { return ctx.querySelector(sel); }
function $all(sel, ctx = document) { return Array.from(ctx.querySelectorAll(sel)); }

// Nombres, notas, etc. los escribe cada usuario: siempre se escapan antes de
// meterlos en innerHTML (evita que alguien se registre con un nombre que sea HTML/JS).
function esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fmt(n, dec = 3) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('es-CO', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function fmtFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d)) return iso;
    return d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function toast(mensaje, tipo = 'default') {
    const holder = $('#toast-holder');
    const el = document.createElement('div');
    el.className = 'toast' + (tipo !== 'default' ? ' ' + tipo : '');
    el.textContent = mensaje;
    holder.appendChild(el);
    setTimeout(() => el.remove(), 4200);
}

// Los enlaces de descarga (Excel/PDF) navegan directo con window.location,
// asi que no pueden llevar el header "Authorization" -- se manda el token
// por query string en su lugar (Auth.php lo acepta como respaldo para
// estos casos, ver tokenDesdeHeader()).
// VERSIÓN LOCAL: los archivos Excel/PDF se generan en el propio teléfono
// (assets/js/local/exportar.js) en vez de pedirlos a api/export_*.php.
function abrirDescarga(url) {
    toast('Generando archivo…');
    AteneaExport.descargar(url).catch(e => toast('No se pudo exportar: ' + e.message, 'error'));
}

// VERSIÓN LOCAL: en vez de llamar al servidor PHP, las mismas rutas las
// responde el motor local (assets/js/local/atenea-local.js), que guarda todo
// en el teléfono y devuelve exactamente lo que devolvía el PHP.
async function api(path, options = {}) {
    return AteneaLocal.solicitud(path, options);
}

/* ---------------------------------------------------------
   2.1) AUTENTICACION
   --------------------------------------------------------- */

let authToken = localStorage.getItem('atenea_token');
let usuarioSesion = null;
try { usuarioSesion = JSON.parse(localStorage.getItem('atenea_usuario') || 'null'); } catch (e) { usuarioSesion = null; }

function guardarSesionLocal(token, usuario) {
    authToken = token;
    usuarioSesion = usuario;
    localStorage.setItem('atenea_token', token);
    localStorage.setItem('atenea_usuario', JSON.stringify(usuario));
}

function cerrarSesionLocal() {
    authToken = null;
    usuarioSesion = null;
    localStorage.removeItem('atenea_token');
    localStorage.removeItem('atenea_usuario');
    document.body.classList.remove('autenticado');
    // El login queda limpio: no debe quedar el usuario/clave de quien acaba de salir.
    $('#login-email').value = '';
    $('#login-password').value = '';
    $('#login-error').classList.add('hidden');
    mostrarTabLogin('entrar');
}

// Cada usuario ve solo lo suyo (el servidor filtra por usuario_id). Aqui se
// borra cualquier dato en memoria del usuario anterior, por si en la misma
// pestaña se cierra una sesion (o expira) y otra persona inicia la suya.
function resetearEstadoDeUsuario() {
    aceitesCache = [];
    aceitesSeleccionados = new Set();
    registradosCache = [];
    registradosIds = new Set();
    catalogoUltimosProductos = [];
    ivUltimoResultado = null;
    ivContextoProducto = null;
    grAceites = [];
    if (cvChart) { cvChart.destroy(); cvChart = null; }
    if (grChart) { grChart.destroy(); grChart = null; }
    if (typeof cerrarModalProducto === 'function') cerrarModalProducto();
}

function mostrarApp(usuario) {
    resetearEstadoDeUsuario();
    usuarioSesion = usuario;
    document.body.classList.add('autenticado');
    $('#sidebar-user-name').textContent = usuario.nombre_completo || '';
    $('#sidebar-user-email').textContent = usuario.email;
    $('#sidebar-admin-btn').classList.toggle('hidden', usuario.rol !== 'admin');
    $('#topbar-admin-btn').classList.toggle('hidden', usuario.rol !== 'admin');
}

// Al cargar la pagina: si hay un token guardado, se valida contra el
// servidor (por si ya expiro o el usuario fue desactivado) antes de
// mostrar la app; si no hay token o no es valido, se muestra el login.
async function iniciarSesion() {
    if (!authToken) return; // se queda mostrando el login (estado por defecto del body)
    try {
        const { usuario } = await api('auth.php?accion=me');
        mostrarApp(usuario);
        iniciarApp();
    } catch (e) {
        cerrarSesionLocal();
    }
}

$('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#login-email').value.trim();
    const password = $('#login-password').value;
    const btn = $('#login-submit-btn');
    $('#login-error').classList.add('hidden');
    btn.disabled = true;

    try {
        const data = await api('auth.php?accion=login', { method: 'POST', body: JSON.stringify({ email, password }) });
        guardarSesionLocal(data.token, data.usuario);
        $('#login-password').value = '';
        mostrarApp(data.usuario);
        iniciarApp();
    } catch (err) {
        $('#login-error').textContent = err.message;
        $('#login-error').classList.remove('hidden');
    } finally {
        btn.disabled = false;
    }
});

/* ---- Pestañas Iniciar sesion / Registrarse (+ pantallas de recuperar clave) ---- */
// cual: 'entrar' | 'registro' | 'olvide' | 'restablecer'
function mostrarTabLogin(cual) {
    const formularios = { entrar: '#login-form', registro: '#register-form', olvide: '#forgot-form', restablecer: '#reset-form' };
    Object.entries(formularios).forEach(([k, sel]) => $(sel).classList.toggle('hidden', k !== cual));
    $('#login-tab-entrar').classList.toggle('active', cual === 'entrar');
    $('#login-tab-registro').classList.toggle('active', cual === 'registro');
    $('.login-card').classList.toggle('modo-recuperar', cual === 'olvide' || cual === 'restablecer');
    ['#login-error', '#register-error', '#forgot-error', '#reset-error'].forEach(sel => $(sel).classList.add('hidden'));
}
$all('.login-tab').forEach(t => t.addEventListener('click', () => mostrarTabLogin(t.dataset.loginTab)));

/* ---- Registro: nombre completo + correo (el que quieran) + contraseña ---- */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

$('#register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('#register-error');
    const btn = $('#register-submit-btn');
    const mostrarError = (m) => { errBox.textContent = m; errBox.classList.remove('hidden'); };
    errBox.classList.add('hidden');

    const nombre = $('#register-nombre').value.trim().replace(/\s+/g, ' ');
    const email = $('#register-email').value.trim().toLowerCase();
    const password = $('#register-password').value;
    const password2 = $('#register-password2').value;

    if (nombre.split(' ').length < 2) return mostrarError('Escribe tu nombre completo (nombre y apellido).');
    if (!EMAIL_REGEX.test(email)) return mostrarError('Escribe un correo electrónico válido (por ejemplo, nombre@gmail.com).');
    if (password.length < 8) return mostrarError('La contraseña debe tener al menos 8 caracteres.');
    if (password !== password2) return mostrarError('Las contraseñas no coinciden.');

    btn.disabled = true;
    try {
        const data = await api('auth.php?accion=registrar', {
            method: 'POST',
            body: JSON.stringify({ nombre_completo: nombre, email, password }),
        });
        guardarSesionLocal(data.token, data.usuario);
        $('#register-form').reset();
        mostrarApp(data.usuario);
        iniciarApp();
        toast(data.correo_enviado
            ? '¡Cuenta registrada! Te enviamos un correo de confirmación.'
            : '¡Cuenta registrada! Bienvenido/a, ' + nombre.split(' ')[0] + '.', 'success');
    } catch (err) {
        mostrarError(err.message);
    } finally {
        btn.disabled = false;
    }
});

$('#sidebar-logout-btn').addEventListener('click', async () => {
    try { await api('auth.php?accion=logout', { method: 'POST' }); } catch (e) { /* no importa si falla, se limpia igual */ }
    cerrarSesionLocal();
    location.reload();
});

/* ---------------------------------------------------------
   2.1.1) ¿OLVIDASTE TU CONTRASEÑA?
   Paso 1: correo -> llega un codigo de 6 digitos y un enlace.
   Paso 2: codigo (o el enlace, que trae ?reset=TOKEN) + clave nueva.
   --------------------------------------------------------- */

// email: el que se escribio en el paso 1 (para validar el codigo).
// token: el del enlace del correo (si la persona entro por el enlace).
let recuperacion = { email: '', token: '' };

function mostrarMensajeEn(sel, mensaje, ok = false) {
    const box = $(sel);
    box.textContent = mensaje;
    box.classList.toggle('login-error', !ok);
    box.classList.toggle('login-ok', ok);
    box.classList.remove('hidden');
}

// Acepta "123 456", "123-456", etc.; deja solo los 6 digitos.
function limpiarCodigo(v) { return String(v || '').replace(/\D/g, '').slice(0, 6); }
$all('.codigo-input').forEach(inp => inp.addEventListener('input', () => {
    const d = limpiarCodigo(inp.value);
    inp.value = d.length > 3 ? d.slice(0, 3) + ' ' + d.slice(3) : d;
}));

function abrirOlvide() {
    recuperacion = { email: '', token: '' };
    $('#forgot-email').value = $('#login-email').value.includes('@') ? $('#login-email').value.trim() : '';
    mostrarTabLogin('olvide');
    $('#forgot-email').focus();
}

function mostrarPasoRestablecer({ email, token, emailVisible }) {
    recuperacion = { email: email || '', token: token || '' };
    const porEnlace = Boolean(token);
    $('#reset-form').reset();
    $('#reset-codigo-field').classList.toggle('hidden', porEnlace);
    $('#reset-reenviar-btn').classList.toggle('hidden', porEnlace);
    $('#reset-sub').innerHTML = porEnlace
        ? 'Crea una contraseña nueva para <strong>' + esc(emailVisible || '') + '</strong>.'
        : 'Si <strong>' + esc(email) + '</strong> está registrado, te llegó un correo con un código de 6 dígitos. Escríbelo aquí junto con tu contraseña nueva.';
    mostrarTabLogin('restablecer');
    (porEnlace ? $('#reset-password') : $('#reset-codigo')).focus();
}

async function pedirCodigoRecuperacion(email) {
    return api('auth.php?accion=olvide_password', { method: 'POST', body: JSON.stringify({ email }) });
}

$('#login-olvide-btn').addEventListener('click', abrirOlvide);
$all('[data-volver-login]').forEach(b => b.addEventListener('click', () => {
    recuperacion = { email: '', token: '' };
    mostrarTabLogin('entrar');
}));

$('#forgot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#forgot-email').value.trim().toLowerCase();
    if (!EMAIL_REGEX.test(email)) return mostrarMensajeEn('#forgot-error', 'Escribe un correo electrónico válido (por ejemplo, nombre@gmail.com).');

    const btn = $('#forgot-submit-btn');
    btn.disabled = true;
    $('#forgot-error').classList.add('hidden');
    try {
        await pedirCodigoRecuperacion(email);
        mostrarPasoRestablecer({ email });
    } catch (err) {
        mostrarMensajeEn('#forgot-error', err.message);
    } finally {
        btn.disabled = false;
    }
});

$('#reset-reenviar-btn').addEventListener('click', async () => {
    const btn = $('#reset-reenviar-btn');
    if (!recuperacion.email) return abrirOlvide();
    btn.disabled = true;
    try {
        await pedirCodigoRecuperacion(recuperacion.email);
        $('#reset-codigo').value = '';
        mostrarMensajeEn('#reset-error', 'Te enviamos un código nuevo. El anterior ya no sirve.', true);
    } catch (err) {
        mostrarMensajeEn('#reset-error', err.message);
    } finally {
        // Se deja un respiro antes de poder reenviar otra vez.
        setTimeout(() => { btn.disabled = false; }, 30000);
    }
});

$('#reset-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const codigo = limpiarCodigo($('#reset-codigo').value);
    const nueva = $('#reset-password').value;
    const nueva2 = $('#reset-password2').value;

    if (!recuperacion.token && codigo.length !== 6) return mostrarMensajeEn('#reset-error', 'Escribe el código de 6 dígitos que te llegó al correo.');
    if (nueva.length < 8) return mostrarMensajeEn('#reset-error', 'La contraseña debe tener al menos 8 caracteres.');
    if (nueva.length > 72) return mostrarMensajeEn('#reset-error', 'La contraseña no puede superar los 72 caracteres.');
    if (nueva !== nueva2) return mostrarMensajeEn('#reset-error', 'Las contraseñas no coinciden.');

    const body = recuperacion.token
        ? { token: recuperacion.token, nueva }
        : { email: recuperacion.email, codigo, nueva };

    const btn = $('#reset-submit-btn');
    btn.disabled = true;
    $('#reset-error').classList.add('hidden');
    try {
        const data = await api('auth.php?accion=restablecer_password', { method: 'POST', body: JSON.stringify(body) });
        recuperacion = { email: '', token: '' };
        $('#reset-form').reset();
        guardarSesionLocal(data.token, data.usuario);
        mostrarApp(data.usuario);
        iniciarApp();
        mostrarTabLogin('entrar');
        toast('¡Listo! Tu contraseña se cambió y ya iniciaste sesión.', 'success');
    } catch (err) {
        mostrarMensajeEn('#reset-error', err.message);
    } finally {
        btn.disabled = false;
    }
});

// Si la pagina se abrio desde el enlace del correo (index.html?reset=TOKEN),
// se valida el enlace y se muestra directamente el formulario de clave nueva.
// Devuelve true si habia enlace (para no entrar automaticamente a la app).
async function procesarEnlaceRecuperacion() {
    const params = new URLSearchParams(location.search);
    const token = params.get('reset');
    if (!token) return false;

    // Se quita el token de la barra de direcciones (historial, capturas, etc.).
    params.delete('reset');
    const limpia = location.pathname + (params.toString() ? '?' + params : '') + location.hash;
    history.replaceState(null, '', limpia);

    try {
        const data = await api('auth.php?accion=verificar_recuperacion', { method: 'POST', body: JSON.stringify({ token }) });
        mostrarPasoRestablecer({ token, emailVisible: data.email });
    } catch (err) {
        abrirOlvide();
        mostrarMensajeEn('#forgot-error', err.message);
    }
    return true;
}

/* ---------------------------------------------------------
   2.1.2) CAMBIAR CONTRASEÑA (con la sesion iniciada)
   Modo normal: contraseña actual + nueva.
   Modo codigo: si no recuerda la actual, se le envia un codigo al correo.
   --------------------------------------------------------- */

let passwordModoCodigo = false;

function ponerModoCodigoPassword(activo) {
    passwordModoCodigo = activo;
    $('#password-actual-field').classList.toggle('hidden', activo);
    $('#password-codigo-field').classList.toggle('hidden', !activo);
    $('#password-olvide-btn').textContent = activo ? 'Enviar otro código' : '¿No recuerdas tu contraseña actual?';
}

function abrirModalPassword() {
    $('#password-form').reset();
    $('#password-usuario').value = usuarioSesion?.email || '';
    $('#password-error').classList.add('hidden');
    ponerModoCodigoPassword(false);
    $('#password-modal-overlay').classList.remove('hidden');
    cerrarMenuMovil();
    setTimeout(() => $('#password-actual').focus(), 50);
}
function cerrarModalPassword() {
    $('#password-modal-overlay').classList.add('hidden');
    $('#password-form').reset();
}

$('#sidebar-password-btn').addEventListener('click', abrirModalPassword);
$('#topbar-password-btn').addEventListener('click', abrirModalPassword);
$('#password-modal-close').addEventListener('click', cerrarModalPassword);
$('#password-cancel-btn').addEventListener('click', cerrarModalPassword);
$('#password-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'password-modal-overlay') cerrarModalPassword();
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#password-modal-overlay').classList.contains('hidden')) cerrarModalPassword();
});

$('#password-olvide-btn').addEventListener('click', async () => {
    const btn = $('#password-olvide-btn');
    const email = usuarioSesion?.email;
    if (!email) return;
    btn.disabled = true;
    try {
        await pedirCodigoRecuperacion(email);
        ponerModoCodigoPassword(true);
        $('#password-codigo-hint').textContent = 'Lo enviamos a ' + email + '. Revisa también la carpeta de spam.';
        mostrarMensajeEn('#password-error', 'Te enviamos un código de 6 dígitos a tu correo.', true);
        $('#password-codigo').focus();
    } catch (err) {
        mostrarMensajeEn('#password-error', err.message);
    } finally {
        setTimeout(() => { btn.disabled = false; }, passwordModoCodigo ? 30000 : 0);
    }
});

$('#password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const actual = $('#password-actual').value;
    const codigo = limpiarCodigo($('#password-codigo').value);
    const nueva = $('#password-nueva').value;
    const nueva2 = $('#password-nueva2').value;

    if (!passwordModoCodigo && !actual) return mostrarMensajeEn('#password-error', 'Escribe tu contraseña actual.');
    if (passwordModoCodigo && codigo.length !== 6) return mostrarMensajeEn('#password-error', 'Escribe el código de 6 dígitos que te llegó al correo.');
    if (nueva.length < 8) return mostrarMensajeEn('#password-error', 'La contraseña nueva debe tener al menos 8 caracteres.');
    if (nueva.length > 72) return mostrarMensajeEn('#password-error', 'La contraseña nueva no puede superar los 72 caracteres.');
    if (nueva !== nueva2) return mostrarMensajeEn('#password-error', 'Las contraseñas nuevas no coinciden.');
    if (!passwordModoCodigo && nueva === actual) return mostrarMensajeEn('#password-error', 'La contraseña nueva debe ser diferente a la actual.');

    const btn = $('#password-submit-btn');
    btn.disabled = true;
    $('#password-error').classList.add('hidden');
    try {
        if (passwordModoCodigo) {
            // Restablecer cierra todas las sesiones y devuelve una nueva.
            const data = await api('auth.php?accion=restablecer_password', {
                method: 'POST',
                body: JSON.stringify({ email: usuarioSesion.email, codigo, nueva }),
            });
            guardarSesionLocal(data.token, data.usuario);
        } else {
            await api('auth.php?accion=cambiar_password', { method: 'POST', body: JSON.stringify({ actual, nueva }) });
        }
        cerrarModalPassword();
        toast('Tu contraseña se cambió correctamente.', 'success');
    } catch (err) {
        mostrarMensajeEn('#password-error', err.message);
    } finally {
        btn.disabled = false;
    }
});

/* ---------------------------------------------------------
   2.2) GESTION DE USUARIOS (modal, solo admin)
   --------------------------------------------------------- */

function abrirModalUsuarios() {
    $('#usuarios-modal-overlay').classList.remove('hidden');
    cerrarMenuMovil();
    cargarUsuarios();
}
function cerrarModalUsuarios() {
    $('#usuarios-modal-overlay').classList.add('hidden');
}

$('#sidebar-admin-btn').addEventListener('click', abrirModalUsuarios);
$('#topbar-admin-btn').addEventListener('click', abrirModalUsuarios);
$('#usuarios-exportar-btn').addEventListener('click', () => abrirDescarga(API + 'export_excel.php?tipo=usuarios'));
$('#usuarios-modal-close').addEventListener('click', cerrarModalUsuarios);
$('#usuarios-modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'usuarios-modal-overlay') cerrarModalUsuarios();
});

async function cargarUsuarios() {
    const cont = $('#usuarios-lista');
    cont.innerHTML = '<div class="empty-state"><p>Cargando…</p></div>';
    try {
        const usuarios = await api('auth.php?accion=usuarios');
        if (!usuarios.length) {
            cont.innerHTML = '<div class="empty-state"><p>No hay usuarios.</p></div>';
            return;
        }
        let html = '<div class="table-wrap"><table class="data"><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Registro</th><th>Acciones</th></tr></thead><tbody>';
        $('#usuarios-total').textContent = '(' + usuarios.length + ')';
        usuarios.forEach(u => {
            const esYo = usuarioSesion && u.id === usuarioSesion.id;
            html += `<tr>
                <td data-label="Nombre" class="td-nombre">${esc(u.nombre_completo) || '—'}</td>
                <td data-label="Correo">${esc(u.email)}${esYo ? ' <span class="badge badge-amber" style="margin-left:6px;">Tú</span>' : ''}</td>
                <td data-label="Rol">${u.rol === 'admin' ? 'Administrador' : 'Usuario'}</td>
                <td data-label="Registro">${fmtFecha(u.fecha_creacion)}</td>
                <td data-label="Acciones">
                    ${esYo ? '<span style="color:var(--text-faint); font-size:12.5px;">—</span>' : `<button class="btn btn-danger btn-sm" onclick="eliminarUsuario(${u.id})">Eliminar</button>`}
                </td>
            </tr>`;
        });
        html += '</tbody></table></div>';
        cont.innerHTML = html;
    } catch (e) {
        cont.innerHTML = `<div class="empty-state"><p>${e.message}</p></div>`;
    }
}

$('#usuarios-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('#usuarios-email').value.trim();
    const password = $('#usuarios-password').value;
    const rol = $('#usuarios-rol').value;
    const btn = $('#usuarios-crear-btn');
    btn.disabled = true;
    try {
        await api('auth.php?accion=crear_usuario', { method: 'POST', body: JSON.stringify({ email, password, rol }) });
        toast('Usuario creado correctamente.', 'success');
        $('#usuarios-form').reset();
        cargarUsuarios();
    } catch (err) {
        toast(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
});

window.eliminarUsuario = async function (id) {
    if (!confirm('¿Eliminar este usuario? Ya no podrá iniciar sesión.')) return;
    try {
        await api('auth.php?accion=usuario&id=' + id, { method: 'DELETE' });
        toast('Usuario eliminado.', 'success');
        cargarUsuarios();
    } catch (e) { toast(e.message, 'error'); }
};

/* ---------------------------------------------------------
   3) NAVEGACION
   --------------------------------------------------------- */

const TITULOS_VISTA = {
    dashboard: 'Panel general',
    indice: 'Viscosidad 40°C, 100°C e IV',
    curvas: 'Curvas Viscosidad vs Temperatura',
    catalogo: 'Buscar lubricantes',
    historial: 'Historial y exportar',
    grafico: 'Gráfica de curvas',
};


function cerrarMenuMovil() {
    $('#sidebar').classList.remove('open');
    $('#sidebar-scrim').classList.remove('visible');
}

function irAVista(nombre) {
    // La vista de gráfico no tiene entrada propia en el menú: cuelga de "Curvas".
    const navActivo = nombre === 'grafico' ? 'curvas' : nombre;
    $all('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.view === navActivo));
    $all('.view').forEach(el => el.classList.toggle('active', el.id === 'view-' + nombre));
    $('#mobile-view-title').textContent = TITULOS_VISTA[nombre] || 'Atenea';
    $('#topbar-back-btn').classList.toggle('hidden', nombre === 'dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (nombre === 'historial') cargarHistorial();
    if (nombre === 'curvas' && MODULOS_HABILITADOS.curvas) cargarAceites();
    if (nombre === 'dashboard') cargarDashboard();
    if (nombre === 'catalogo' && MODULOS_HABILITADOS.catalogo && !catalogoOpcionesCargadas) cargarOpcionesCatalogo();
    cerrarMenuMovil();
}

$all('.nav-item').forEach(el => el.addEventListener('click', () => irAVista(el.dataset.view)));
$all('[data-goto]').forEach(el => el.addEventListener('click', () => irAVista(el.dataset.goto)));

/* Menu (drawer): en PC se abre con el boton "Menú" de la topbar.
   En movil la navegacion va solo por la barra inferior (.mobile-tabbar),
   por eso aqui no hay boton hamburguesa. */
$('#menu-toggle-open').addEventListener('click', () => {
    $('#sidebar').classList.add('open');
    $('#sidebar-scrim').classList.add('visible');
});
$('#topbar-back-btn').addEventListener('click', () => irAVista('dashboard'));
$('#mobile-menu-close').addEventListener('click', cerrarMenuMovil);
$('#sidebar-scrim').addEventListener('click', cerrarMenuMovil);

/* Efecto "ripple" tactil en los botones, refuerza la respuesta al tocar */
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn) return;
    const ripple = document.createElement('span');
    ripple.className = 'btn-ripple';
    const rect = btn.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
    ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
    btn.appendChild(ripple);
    setTimeout(() => ripple.remove(), 550);
});

/* ---------------------------------------------------------
   4) MODULO: INDICE DE VISCOSIDAD
   --------------------------------------------------------- */

let ivModoActual = 'directo';
let ivUltimoResultado = null;
let ivContextoProducto = null; // {id, campo, nombre} cuando el calculo vino de "completar dato faltante" en el catalogo

function modoParaCampo(campo) {
    if (campo === 'indice_viscosidad') return 'directo';
    if (campo === 'viscosidad_40') return 'hallar_U';
    return 'hallar_Y';
}

// Si el usuario edita un campo a mano, el contexto de "vino del catalogo"
// ya no es confiable -- se oculta el boton de guardar en el producto.
$all('#iv-form-directo input, #iv-form-hallar_U input, #iv-form-hallar_Y input').forEach(inp => {
    inp.addEventListener('input', () => {
        ivContextoProducto = null;
        $('#iv-guardar-producto-wrap').classList.add('hidden');
    });
});

$all('#iv-tabs button').forEach(btn => {
    btn.addEventListener('click', () => {
        ivModoActual = btn.dataset.modo;
        $all('#iv-tabs button').forEach(b => b.classList.toggle('active', b === btn));
        $all('.iv-form').forEach(f => f.classList.add('hidden'));
        $('#iv-form-' + ivModoActual).classList.remove('hidden');
        $('#iv-resultado-wrap').classList.add('hidden');
    });
});

function ejecutarCalculoIV() {
    try {
        let resultado, label, valorTexto;

        if (ivModoActual === 'directo') {
            const Y = parseFloat($('#iv-directo-y').value);
            const U = parseFloat($('#iv-directo-u').value);
            if (isNaN(Y) || isNaN(U)) return toast('Ingresa ambas viscosidades.', 'error');
            resultado = calcularVI(Y, U);
            label = 'Índice de Viscosidad';
            valorTexto = fmt(resultado.vi, 2);

        } else if (ivModoActual === 'hallar_U') {
            const Y = parseFloat($('#iv-hu-y').value);
            const vi = parseFloat($('#iv-hu-vi').value);
            if (isNaN(Y) || isNaN(vi)) return toast('Completa los dos campos.', 'error');
            resultado = hallarU(Y, vi);
            label = 'Viscosidad a 40°C requerida (U)';
            valorTexto = fmt(resultado.U, 4);

        } else {
            const U = parseFloat($('#iv-hy-u').value);
            const vi = parseFloat($('#iv-hy-vi').value);
            if (isNaN(U) || isNaN(vi)) return toast('Completa los dos campos.', 'error');
            resultado = hallarY(U, vi);
            label = 'Viscosidad a 100°C requerida (Y)';
            valorTexto = fmt(resultado.Y, 4);
        }

        ivUltimoResultado = resultado;
        $('#iv-res-label').textContent = label;
        $('#iv-res-valor').innerHTML = valorTexto + ' <small>' + (ivModoActual === 'directo' ? '' : 'cSt') + '</small>';
        $('#iv-res-l').textContent = fmt(resultado.L, 3);
        $('#iv-res-h').textContent = fmt(resultado.H, 3);
        $('#iv-res-rama').textContent = resultado.rama;
        $('#iv-resultado-wrap').classList.remove('hidden');
        $('#iv-guardado-ok').classList.add('hidden');
        $('#iv-guardado-grafica-ok').classList.add('hidden');

        // El boton "guardar en el producto del catalogo" solo se muestra
        // si el calculo que se acaba de hacer es exactamente el que ese
        // producto tenia pendiente (mismo modo <-> mismo campo faltante).
        if (ivContextoProducto && modoParaCampo(ivContextoProducto.campo) === ivModoActual) {
            $('#iv-guardar-producto-nombre').textContent = ivContextoProducto.nombre;
            $('#iv-guardar-producto-wrap').classList.remove('hidden');
        } else {
            $('#iv-guardar-producto-wrap').classList.add('hidden');
        }

    } catch (e) {
        toast(e.message, 'error');
    }
}

$('#iv-calcular-btn').addEventListener('click', ejecutarCalculoIV);

$('#iv-limpiar-btn').addEventListener('click', () => {
    $all('#view-indice input, #view-indice textarea').forEach(i => i.value = '');
    $('#iv-resultado-wrap').classList.add('hidden');
    $('#iv-guardar-producto-wrap').classList.add('hidden');
    ivContextoProducto = null;
});

$('#iv-guardar-producto-btn').addEventListener('click', async () => {
    if (!ivContextoProducto || !ivUltimoResultado) return;
    const { id, campo } = ivContextoProducto;
    const valor = campo === 'indice_viscosidad' ? ivUltimoResultado.vi
                : campo === 'viscosidad_40' ? ivUltimoResultado.U
                : ivUltimoResultado.Y;
    try {
        const actualizado = await api('catalogo.php?id=' + id, {
            method: 'PATCH',
            body: JSON.stringify({ campo, valor }),
        });
        actualizarProductoEnCaches(actualizado);
        toast('Producto del catálogo actualizado con el valor calculado.', 'success');
        $('#iv-guardar-producto-wrap').classList.add('hidden');
        ivContextoProducto = null;
    } catch (e) {
        toast('No se pudo actualizar el producto: ' + e.message, 'error');
    }
});

$('#iv-guardar-btn').addEventListener('click', async () => {
    if (!ivUltimoResultado) return;
    const body = {
        modo: ivModoActual,
        nombre_muestra: $('#iv-nombre').value.trim(),
        notas: $('#iv-notas').value.trim(),
    };
    if (ivModoActual === 'directo') {
        body.visc_100_input = $('#iv-directo-y').value;
        body.visc_40_input = $('#iv-directo-u').value;
    } else if (ivModoActual === 'hallar_U') {
        body.visc_100_input = $('#iv-hu-y').value;
        body.vi_objetivo = $('#iv-hu-vi').value;
    } else {
        body.visc_40_input = $('#iv-hy-u').value;
        body.vi_objetivo = $('#iv-hy-vi').value;
    }

    try {
        await api('calculos_vi.php', { method: 'POST', body: JSON.stringify(body) });
        $('#iv-guardado-ok').classList.remove('hidden');
        toast('Cálculo guardado en el historial.', 'success');
    } catch (e) {
        toast('No se pudo guardar: ' + e.message, 'error');
    }
});

// "Guardar aceite para gráfica": toma la Visc. a 40°C (U) y a 100°C (Y) que
// ya se tienen tras calcular (en directo las dos son datos de entrada; en
// hallar_U / hallar_Y una es dato de entrada y la otra el resultado recien
// calculado) y las guarda como un aceite nuevo con la misma API que usa el
// modulo de Curvas -- por eso, al entrar a Curvas, aparece automaticamente
// en "Aceites guardados" sin tener que volver a escribir los datos.
$('#iv-guardar-grafica-btn').addEventListener('click', async () => {
    if (!ivUltimoResultado) return toast('Primero calcula un resultado.', 'error');

    let v40, v100;
    if (ivModoActual === 'directo') {
        v40 = parseFloat($('#iv-directo-u').value);
        v100 = parseFloat($('#iv-directo-y').value);
    } else if (ivModoActual === 'hallar_U') {
        v40 = ivUltimoResultado.U;
        v100 = parseFloat($('#iv-hu-y').value);
    } else {
        v40 = parseFloat($('#iv-hy-u').value);
        v100 = ivUltimoResultado.Y;
    }
    if (isNaN(v40) || isNaN(v100)) return toast('Faltan datos de viscosidad para guardar el aceite.', 'error');

    const nombre = $('#iv-nombre').value.trim() || ('Aceite IV — ' + new Date().toLocaleDateString('es-CO'));

    try {
        const aceite = await api('aceites.php', {
            method: 'POST',
            body: JSON.stringify({ nombre, visc_40: v40, visc_100: v100, notas: $('#iv-notas').value.trim() }),
        });
        aceitesSeleccionados.add(aceite.id);
        $('#iv-guardado-grafica-ok').classList.remove('hidden');
        toast('Aceite "' + nombre + '" guardado. Aparecerá en Curvas → Aceites guardados.', 'success');
    } catch (e) {
        toast('No se pudo guardar el aceite: ' + e.message, 'error');
    }
});

/* ---------------------------------------------------------
   5) MODULO: CURVAS
   --------------------------------------------------------- */

let cvChart = null;               // (ya no hay grafica embebida en la vista de curvas; se conserva por si se reutiliza)
let aceitesCache = [];
let aceitesSeleccionados = new Set(); // ids marcados para comparar (sobrevive al filtro de busqueda)
const coloresCurva = ['#e31d25', '#c9930c', '#2f9e58', '#6b7280', '#8e44ad', '#1c1e22'];

// "Generar gráfico": guarda el aceite en la cuenta del usuario y lo lleva a
// la vista aparte donde solo se ve el grafico interactivo y los datos.
$('#cv-generar-btn').addEventListener('click', async () => {
    const nombre = $('#cv-nombre').value.trim();
    const v40 = parseFloat($('#cv-v40').value);
    const v100 = parseFloat($('#cv-v100').value);
    if (!nombre) return toast('Ponle un nombre al aceite.', 'error');
    if (isNaN(v40) || isNaN(v100)) return toast('Ingresa ambas viscosidades.', 'error');

    const btn = $('#cv-generar-btn');
    btn.disabled = true;
    try {
        const aceite = await api('aceites.php', {
            method: 'POST',
            body: JSON.stringify({ nombre, visc_40: v40, visc_100: v100, notas: $('#cv-notas').value.trim() }),
        });
        $('#cv-nombre').value = ''; $('#cv-v40').value = ''; $('#cv-v100').value = ''; $('#cv-notas').value = '';
        abrirGrafico([aceite]);
        toast('Aceite "' + nombre + '" guardado en tu cuenta.', 'success');
    } catch (e) {
        toast('No se pudo generar el gráfico: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
    }
});

$('#cv-limpiar-btn').addEventListener('click', () => {
    $all('#view-curvas .card:first-child input, #view-curvas .card:first-child textarea').forEach(i => i.value = '');
});

async function cargarAceites() {
    try {
        aceitesCache = await api('aceites.php');
    } catch (e) {
        toast('No se pudieron cargar los aceites: ' + e.message, 'error');
        return;
    }

    // Si se borro/cambio algo, se descartan marcas de aceites que ya no existen.
    const idsVigentes = new Set(aceitesCache.map(a => a.id));
    aceitesSeleccionados.forEach(id => { if (!idsVigentes.has(id)) aceitesSeleccionados.delete(id); });

    renderTablaAceites(aceitesCache);

    // selector de busqueda de temperatura (usa siempre la lista completa, sin filtrar)
    const sel = $('#bt-aceite-select');
    sel.innerHTML = '<option value="">Selecciona un aceite guardado…</option>' +
        aceitesCache.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('');
    poblarSelectorExacto();
}

function renderTablaAceites(lista) {
    const cont = $('#cv-aceites-tabla');
    if (!aceitesCache.length) {
        cont.innerHTML = '<div class="empty-state"><p>Aún no hay aceites guardados. Crea el primero arriba.</p></div>';
        return;
    }
    if (!lista.length) {
        cont.innerHTML = '<div class="empty-state"><p>Ningún aceite guardado coincide con esa búsqueda.</p></div>';
        return;
    }

    let html = '<div class="table-wrap"><table class="data"><thead><tr>' +
        '<th>Comparar</th><th>Aceite</th><th>Visc. 40°C</th><th>Visc. 100°C</th><th>Acciones</th>' +
        '</tr></thead><tbody>';
    lista.forEach(a => {
        html += `<tr>
            <td data-label="Comparar"><input type="checkbox" class="cv-check" data-id="${a.id}" ${aceitesSeleccionados.has(a.id) ? 'checked' : ''}></td>
            <td data-label="Aceite" class="td-nombre">${esc(a.nombre)}</td>
            <td data-label="Visc. 40°C">${fmt(a.visc_40, 3)}</td>
            <td data-label="Visc. 100°C">${fmt(a.visc_100, 3)}</td>
            <td data-label="Acciones">
                <div class="btn-row">
                    <button class="btn btn-primary btn-sm" onclick="verGraficoAceite(${a.id})">Ver gráfico</button>
                    <button class="btn btn-ghost btn-sm" onclick="exportarCurvaExcel(${a.id})">Excel</button>
                    <button class="btn btn-ghost btn-sm" onclick="exportarCurvaPdf(${a.id})">PDF</button>
                    <button class="btn btn-danger btn-sm" onclick="eliminarAceite(${a.id})">Eliminar</button>
                </div>
            </td>
        </tr>`;
    });
    html += '</tbody></table></div>';
    cont.innerHTML = html;
    $all('.cv-check').forEach(chk => chk.addEventListener('change', () => {
        const id = parseInt(chk.dataset.id);
        if (chk.checked) aceitesSeleccionados.add(id); else aceitesSeleccionados.delete(id);
    }));
}

$('#cv-aceites-filtro').addEventListener('input', () => {
    const texto = $('#cv-aceites-filtro').value.trim().toLowerCase();
    const filtrados = texto ? aceitesCache.filter(a => a.nombre.toLowerCase().includes(texto)) : aceitesCache;
    renderTablaAceites(filtrados);
});

window.verGraficoAceite = function (id) {
    const a = aceitesCache.find(x => x.id === id);
    if (a) abrirGrafico([a]);
};

$('#cv-graficar-seleccion').addEventListener('click', () => {
    const elegidos = aceitesCache.filter(a => aceitesSeleccionados.has(a.id));
    if (!elegidos.length) return toast('Marca al menos un aceite de la lista para graficarlo.', 'error');
    abrirGrafico(elegidos);
});

/* ---------------------------------------------------------
   5.1) VISTA DE GRAFICO: solo el grafico interactivo y los datos
   --------------------------------------------------------- */

let grChart = null;
let grAceites = [];        // [{nombre, visc_40, visc_100, curva:[{temperatura_c, viscosidad_cst}]}]
let grEscalaLog = false;
const GR_T_MIN = TEMPS_CURVA[0];
const GR_T_MAX = TEMPS_CURVA[TEMPS_CURVA.length - 1];
let grXmin = GR_T_MIN;
let grXmax = GR_T_MAX;

// Usa los puntos que ya devolvio el servidor si vienen (aceite recien
// guardado); si no, los calcula con las constantes guardadas (mismo motor).
function curvaDeAceite(a) {
    if (Array.isArray(a.curva) && a.curva.length) {
        return a.curva.map(p => ({ temperatura_c: Number(p.temperatura_c), viscosidad_cst: Number(p.viscosidad_cst) }));
    }
    return generarCurva(parseFloat(a.constante_A), parseFloat(a.constante_B));
}

function abrirGrafico(aceites) {
    if (!aceites || !aceites.length) return;
    grAceites = aceites.map(a => ({
        nombre: a.nombre,
        visc_40: parseFloat(a.visc_40),
        visc_100: parseFloat(a.visc_100),
        curva: curvaDeAceite(a),
    }));
    grXmin = GR_T_MIN; grXmax = GR_T_MAX;
    $('#gr-log').checked = grEscalaLog;
    irAVista('grafico');
    renderGrafico();
}

function renderGrafico() {
    const unico = grAceites.length === 1;
    $('#gr-titulo').textContent = unico ? grAceites[0].nombre : 'Comparativo de curvas';
    $('#gr-desc').textContent = (unico ? 'Curva Viscosidad–Temperatura' : grAceites.length + ' aceites comparados') +
        ' · ecuación de Walther (ASTM D341), de ' + GR_T_MIN + '°C a ' + GR_T_MAX + '°C.';
    dibujarChartGrafico();
    dibujarDatosGrafico();
}

function dibujarChartGrafico() {
    const caja = $('.gr-canvas-box');
    if (typeof Chart === 'undefined') {
        // Chart.js no se cargo (assets/js/vendor/chart.umd.min.js ausente o bloqueado).
        caja.innerHTML = '<p style="padding:16px;color:#c0392b;">No se pudo cargar la librería de gráficos (Chart.js). Verifica que el archivo <code>assets/js/vendor/chart.umd.min.js</code> exista en el servidor.</p>';
        toast('No se pudo cargar la librería de gráficos', 'error');
        return;
    }

    const datasets = grAceites.map((a, i) => {
        const color = coloresCurva[i % coloresCurva.length];
        return {
            label: a.nombre,
            data: a.curva.map(p => ({ x: p.temperatura_c, y: p.viscosidad_cst })),
            borderColor: color,
            backgroundColor: color,
            tension: 0.35,
            pointRadius: 3,
            pointHoverRadius: 7,
            pointHitRadius: 14,
            borderWidth: 2.5,
        };
    });

    try {
        if (grChart) grChart.destroy();
        grChart = new Chart($('#gr-chart').getContext('2d'), {
            type: 'line',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 350 },
                // Al pasar por una temperatura se ven TODAS las curvas a la vez.
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        type: 'linear', min: grXmin, max: grXmax,
                        title: { display: true, text: 'Temperatura (°C)', color: '#6b7280' },
                        grid: { color: '#e2e4e8' }, ticks: { color: '#6b7280' },
                    },
                    y: {
                        type: grEscalaLog ? 'logarithmic' : 'linear',
                        title: { display: true, text: 'Viscosidad (cSt)', color: '#6b7280' },
                        grid: { color: '#e2e4e8' }, ticks: { color: '#6b7280' },
                    },
                },
                plugins: {
                    legend: { labels: { color: '#1c1e22' } },
                    tooltip: {
                        callbacks: {
                            title: (items) => items.length ? items[0].parsed.x + ' °C' : '',
                            label: (ctx) => ' ' + ctx.dataset.label + ': ' + fmt(ctx.parsed.y, 3) + ' cSt',
                        },
                    },
                },
            },
        });
    } catch (e) {
        console.error('Error al crear la gráfica:', e);
        toast('Error al dibujar la gráfica: ' + e.message, 'error');
    }
}

// Tabla de datos: una fila por temperatura, una columna por aceite.
function dibujarDatosGrafico() {
    $('#gr-resumen').innerHTML = grAceites.map((a, i) => `
        <span class="gr-chip">
            <span class="gr-dot" style="background:${coloresCurva[i % coloresCurva.length]}"></span>
            <strong>${esc(a.nombre)}</strong>
            <span class="gr-chip-datos">40°C: ${fmt(a.visc_40, 2)} · 100°C: ${fmt(a.visc_100, 2)} cSt</span>
        </span>`).join('');

    const cabeza = grAceites.map((a, i) =>
        `<th><span class="gr-dot" style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:${coloresCurva[i % coloresCurva.length]}"></span>${esc(a.nombre)} (cSt)</th>`
    ).join('');

    const filas = TEMPS_CURVA.map((t, idx) => {
        const conocido = (t === 40 || t === 100) ? ' gr-conocido' : '';
        const celdas = grAceites.map(a => {
            const p = a.curva.find(pt => pt.temperatura_c === t);
            return `<td>${p ? fmt(p.viscosidad_cst, 3) : '—'}</td>`;
        }).join('');
        return `<tr data-idx="${idx}" class="${conocido.trim()}"><td>${t} °C</td>${celdas}</tr>`;
    }).join('');

    $('#gr-tabla').innerHTML =
        `<div class="gr-tabla-wrap"><table class="gr-datos"><thead><tr><th>Temperatura</th>${cabeza}</tr></thead><tbody>${filas}</tbody></table></div>` +
        `<div class="gr-leyenda-nota">● Las filas de 40 °C y 100 °C son los datos que ingresaste; el resto se calcula con la ecuación de Walther.</div>`;

    // Pasar el cursor por una fila resalta ese punto en el grafico.
    $all('#gr-tabla tbody tr').forEach(tr => {
        tr.addEventListener('mouseenter', () => resaltarPuntoGrafico(parseInt(tr.dataset.idx)));
        tr.addEventListener('mouseleave', () => resaltarPuntoGrafico(null));
    });
}

function resaltarPuntoGrafico(idx) {
    if (!grChart) return;
    if (idx === null) {
        grChart.setActiveElements([]);
        grChart.tooltip.setActiveElements([], { x: 0, y: 0 });
        grChart.update('none');
        return;
    }
    const activos = [];
    grChart.data.datasets.forEach((_, di) => {
        if (grChart.isDatasetVisible(di)) activos.push({ datasetIndex: di, index: idx });
    });
    if (!activos.length) return;
    const punto = grChart.getDatasetMeta(activos[0].datasetIndex).data[idx];
    if (!punto) return;
    grChart.setActiveElements(activos);
    grChart.tooltip.setActiveElements(activos, { x: punto.x, y: punto.y });
    grChart.update('none');
}

// Zoom horizontal (temperatura) alrededor de un centro; el eje Y se
// reajusta solo a lo que queda visible.
function grZoom(factor, centro) {
    if (!grChart) return;
    const c = (centro !== undefined && centro !== null) ? centro : (grXmin + grXmax) / 2;
    let nmin = c - (c - grXmin) * factor;
    let nmax = c + (grXmax - c) * factor;
    if (nmax - nmin >= GR_T_MAX - GR_T_MIN) { nmin = GR_T_MIN; nmax = GR_T_MAX; }
    if (nmax - nmin < 10) return; // no acercar mas de 10 °C de ancho
    if (nmin < GR_T_MIN) { nmax += GR_T_MIN - nmin; nmin = GR_T_MIN; }
    if (nmax > GR_T_MAX) { nmin -= nmax - GR_T_MAX; nmax = GR_T_MAX; }
    grXmin = nmin; grXmax = nmax;
    grChart.options.scales.x.min = grXmin;
    grChart.options.scales.x.max = grXmax;
    grChart.update('none');
}

$('#gr-zoom-in').addEventListener('click', () => grZoom(0.6));
$('#gr-zoom-out').addEventListener('click', () => grZoom(1.6));
$('#gr-zoom-reset').addEventListener('click', () => { grXmin = GR_T_MIN; grXmax = GR_T_MAX; dibujarChartGrafico(); });
$('#gr-log').addEventListener('change', () => { grEscalaLog = $('#gr-log').checked; dibujarChartGrafico(); });
$('#gr-volver').addEventListener('click', () => irAVista('curvas'));
$('#gr-chart').addEventListener('wheel', (e) => {
    if (!grChart) return;
    e.preventDefault();
    const rect = grChart.canvas.getBoundingClientRect();
    const t = grChart.scales.x.getValueForPixel(e.clientX - rect.left);
    grZoom(e.deltaY < 0 ? 0.8 : 1.25, t);
}, { passive: false });

window.eliminarAceite = async function (id) {
    if (!confirm('¿Eliminar este aceite y su curva guardada?')) return;
    try {
        await api('aceites.php?id=' + id, { method: 'DELETE' });
        aceitesSeleccionados.delete(id);
        toast('Aceite eliminado.', 'success');
        cargarAceites();
    } catch (e) { toast('No se pudo eliminar: ' + e.message, 'error'); }
};

window.exportarCurvaExcel = function (id) { abrirDescarga(API + 'export_excel.php?tipo=curva&id=' + id); };
window.exportarCurvaPdf = function (id) { abrirDescarga(API + 'export_pdf.php?tipo=curva&id=' + id); };

$('#cv-exportar-comparativo').addEventListener('click', () => {
    abrirDescarga(API + 'export_excel.php?tipo=curvas');
});

$('#bt-buscar-btn').addEventListener('click', async () => {
    const aceiteId = $('#bt-aceite-select').value;
    const visc = parseFloat($('#bt-visc').value);
    const tolPct = parseFloat($('#bt-tol').value);
    if (!aceiteId) return toast('Selecciona un aceite guardado.', 'error');
    if (isNaN(visc)) return toast('Ingresa la viscosidad objetivo.', 'error');

    try {
        const r = await api('busqueda_temperatura.php', {
            method: 'POST',
            body: JSON.stringify({ aceite_id: aceiteId, viscosidad_objetivo: visc, tolerancia_pct: (isNaN(tolPct) ? 5 : tolPct) / 100 }),
        });
        $('#bt-tmin').textContent = fmt(r.temp_min_c, 1);
        $('#bt-tmax').textContent = fmt(r.temp_max_c, 1);
        $('#bt-vinf').textContent = fmt(r.visc_inferior, 2);
        $('#bt-vsup').textContent = fmt(r.visc_superior, 2);
        $('#bt-resultado').classList.remove('hidden');
    } catch (e) {
        toast('No se pudo calcular: ' + e.message, 'error');
    }
});

/* ---------------------------------------------------------
   5.1) Valor exacto: viscosidad a una temperatura X y
        temperatura para una viscosidad exacta.
        Usa las constantes A y B del aceite guardado (Walther,
        ASTM D341) y las mismas funciones del motor; no guarda nada.
   --------------------------------------------------------- */

function poblarSelectorExacto() {
    const sel = $('#ex-aceite-select');
    if (!sel) return;
    const previo = sel.value;
    sel.innerHTML = '<option value="">Selecciona un aceite guardado…</option>' +
        aceitesCache.map(a => `<option value="${a.id}">${esc(a.nombre)}</option>`).join('');
    if (previo && aceitesCache.some(a => String(a.id) === previo)) sel.value = previo;
    $('#ex-visc-resultado').classList.add('hidden');
    $('#ex-temp-resultado').classList.add('hidden');
}

function constantesAceiteExacto() {
    const id = $('#ex-aceite-select').value;
    if (!id) { toast('Selecciona un aceite guardado.', 'error'); return null; }
    const a = aceitesCache.find(x => String(x.id) === String(id));
    const A = a ? parseFloat(a.constante_A) : NaN;
    const B = a ? parseFloat(a.constante_B) : NaN;
    if (isNaN(A) || isNaN(B) || B === 0) { toast('Ese aceite no tiene constantes válidas.', 'error'); return null; }
    return { A, B };
}

$('#ex-aceite-select').addEventListener('change', () => {
    $('#ex-visc-resultado').classList.add('hidden');
    $('#ex-temp-resultado').classList.add('hidden');
});

$('#ex-visc-btn').addEventListener('click', () => {
    const k = constantesAceiteExacto();
    if (!k) return;
    const t = parseFloat($('#ex-temp').value);
    if (isNaN(t)) return toast('Ingresa la temperatura.', 'error');
    if (t <= -273.15) return toast('La temperatura debe ser mayor a -273,15 °C.', 'error');

    const v = viscosidadATemp(k.A, k.B, t);
    if (!isFinite(v)) return toast('No se pudo calcular a esa temperatura.', 'error');

    $('#ex-visc-t').textContent = fmt(t, 1);
    $('#ex-visc-val').textContent = fmt(v, 3);
    const fuera = t < TEMPS_CURVA[0] || t > TEMPS_CURVA[TEMPS_CURVA.length - 1];
    $('#ex-visc-aviso').textContent = fuera
        ? 'Fuera del rango de la curva (' + TEMPS_CURVA[0] + '–' + TEMPS_CURVA[TEMPS_CURVA.length - 1] + ' °C): valor extrapolado'
        : '';
    $('#ex-visc-resultado').classList.remove('hidden');
});

$('#ex-temp-btn').addEventListener('click', () => {
    const k = constantesAceiteExacto();
    if (!k) return;
    const v = parseFloat($('#ex-visc').value);
    if (isNaN(v)) return toast('Ingresa la viscosidad.', 'error');
    if (v <= 0.3) return toast('La viscosidad debe ser mayor a 0,3 cSt.', 'error');

    const t = temperaturaParaViscosidad(k.A, k.B, v);
    if (!isFinite(t)) return toast('No se pudo calcular para esa viscosidad.', 'error');

    $('#ex-temp-v').textContent = fmt(v, 2);
    $('#ex-temp-val').textContent = fmt(t, 1);
    const fuera = t < TEMPS_CURVA[0] || t > TEMPS_CURVA[TEMPS_CURVA.length - 1];
    $('#ex-temp-aviso').textContent = fuera
        ? 'Fuera del rango de la curva (' + TEMPS_CURVA[0] + '–' + TEMPS_CURVA[TEMPS_CURVA.length - 1] + ' °C): valor extrapolado'
        : '';
    $('#ex-temp-resultado').classList.remove('hidden');
});

/* ---------------------------------------------------------
   6) MODULO: HISTORIAL
   --------------------------------------------------------- */

$all('.chip[data-tipo-hist]').forEach(chip => {
    chip.addEventListener('click', () => {
        $all('.chip[data-tipo-hist]').forEach(c => c.classList.toggle('active', c === chip));
        $('#hist-vi-card').classList.toggle('hidden', chip.dataset.tipoHist !== 'vi');
        $('#hist-curvas-card').classList.toggle('hidden', chip.dataset.tipoHist !== 'curvas');
    });
});

const MODO_LEGIBLE = { directo: 'Cálculo directo', hallar_U: 'Hallar U (40°C)', hallar_Y: 'Hallar Y (100°C)' };

async function cargarHistorial() {
    try {
        const registros = await api('calculos_vi.php');
        const cont = $('#hist-vi-tabla');
        if (!registros.length) {
            cont.innerHTML = '<div class="empty-state"><p>Todavía no hay cálculos guardados.</p></div>';
        } else {
            let html = '<div class="table-wrap"><table class="data"><thead><tr>' +
                '<th>Fecha</th><th>Muestra</th><th>Modo</th><th>Resultado</th><th>Rama</th><th>Acciones</th>' +
                '</tr></thead><tbody>';
            registros.forEach(r => {
                let resultado = '—';
                if (r.modo === 'directo') resultado = fmt(r.vi_resultado, 2) + ' IV';
                else if (r.modo === 'hallar_U') resultado = fmt(r.visc_40_resultado, 3) + ' cSt (U)';
                else resultado = fmt(r.visc_100_resultado, 3) + ' cSt (Y)';

                html += `<tr>
                    <td data-label="Fecha">${fmtFecha(r.fecha)}</td>
                    <td data-label="Muestra" class="td-nombre">${r.nombre_muestra || '<span class="text-faint">Sin nombre</span>'}</td>
                    <td data-label="Modo">${MODO_LEGIBLE[r.modo] || r.modo}</td>
                    <td data-label="Resultado">${resultado}</td>
                    <td data-label="Rama">${r.rama ? `<span class="badge badge-amber">${r.rama}</span>` : '—'}</td>
                    <td data-label="Acciones">
                        <div class="btn-row">
                            <button class="btn btn-ghost btn-sm" onclick="exportarViExcel(${r.id})">Excel</button>
                            <button class="btn btn-ghost btn-sm" onclick="exportarViPdf(${r.id})">PDF</button>
                            <button class="btn btn-danger btn-sm" onclick="eliminarVi(${r.id})">Eliminar</button>
                        </div>
                    </td>
                </tr>`;
            });
            html += '</tbody></table></div>';
            cont.innerHTML = html;
        }
    } catch (e) {
        toast('No se pudo cargar el historial: ' + e.message, 'error');
    }

    try {
        const aceites = await api('aceites.php');
        const cont = $('#hist-curvas-tabla');
        if (!aceites.length) {
            cont.innerHTML = '<div class="empty-state"><p>Todavía no hay aceites guardados.</p></div>';
        } else {
            let html = '<div class="table-wrap"><table class="data"><thead><tr>' +
                '<th>Fecha</th><th>Aceite</th><th>Visc. 40°C</th><th>Visc. 100°C</th><th>Acciones</th>' +
                '</tr></thead><tbody>';
            aceites.forEach(a => {
                html += `<tr>
                    <td data-label="Fecha">${fmtFecha(a.fecha)}</td>
                    <td data-label="Aceite" class="td-nombre">${a.nombre}</td>
                    <td data-label="Visc. 40°C">${fmt(a.visc_40, 3)}</td>
                    <td data-label="Visc. 100°C">${fmt(a.visc_100, 3)}</td>
                    <td data-label="Acciones">
                        <div class="btn-row">
                            <button class="btn btn-ghost btn-sm" onclick="exportarCurvaExcel(${a.id})">Excel</button>
                            <button class="btn btn-ghost btn-sm" onclick="exportarCurvaPdf(${a.id})">PDF</button>
                            <button class="btn btn-danger btn-sm" onclick="eliminarAceite(${a.id})">Eliminar</button>
                        </div>
                    </td>
                </tr>`;
            });
            html += '</tbody></table></div>';
            cont.innerHTML = html;
        }
    } catch (e) {
        toast('No se pudo cargar los aceites: ' + e.message, 'error');
    }
}

window.exportarViExcel = function (id) { abrirDescarga(API + 'export_excel.php?tipo=vi&id=' + id); };
window.exportarViPdf = function (id) { abrirDescarga(API + 'export_pdf.php?tipo=vi&id=' + id); };
window.eliminarVi = async function (id) {
    if (!confirm('¿Eliminar este registro del historial?')) return;
    try {
        await api('calculos_vi.php?id=' + id, { method: 'DELETE' });
        toast('Registro eliminado.', 'success');
        cargarHistorial();
    } catch (e) { toast('No se pudo eliminar: ' + e.message, 'error'); }
};

$('#hist-vi-export-all').addEventListener('click', () => {
    abrirDescarga(API + 'export_excel.php?tipo=vi');
});

/* ---------------------------------------------------------
   7) DASHBOARD
   --------------------------------------------------------- */

async function cargarDashboard() {
    try {
        const tareas = [api('calculos_vi.php?limite=5')];
        if (MODULOS_HABILITADOS.curvas) tareas.push(api('aceites.php'));
        const resultados = await Promise.all(tareas);
        const vis = resultados[0];
        const aceites = MODULOS_HABILITADOS.curvas ? resultados[1] : [];

        $('#stat-vi').textContent = vis.length < 5 ? vis.length : '5+';
        if (MODULOS_HABILITADOS.curvas) $('#stat-aceites').textContent = aceites.length;

        const contVi = $('#dash-vi-list');
        if (!vis.length) {
            contVi.innerHTML = '<div class="empty-state"><p>Sin cálculos todavía.</p></div>';
        } else {
            contVi.innerHTML = vis.slice(0, 5).map(r => {
                let resultado = r.modo === 'directo' ? fmt(r.vi_resultado, 2) + ' IV'
                    : r.modo === 'hallar_U' ? fmt(r.visc_40_resultado, 2) + ' cSt (U)'
                    : fmt(r.visc_100_resultado, 2) + ' cSt (Y)';
                return `<div class="flex-between" style="padding:10px 0; border-bottom:1px solid var(--border-soft);">
                    <div>
                        <div style="font-size:13px;">${esc(r.nombre_muestra) || 'Sin nombre'}</div>
                        <div class="text-faint" style="font-size:11px;">${fmtFecha(r.fecha)}</div>
                    </div>
                    <div class="font-mono" style="color:var(--amber); font-size:13px;">${resultado}</div>
                </div>`;
            }).join('');
        }

        // Si el módulo de curvas está en desarrollo, esta tarjeta ya quedó
        // reemplazada por un aviso fijo (ver aplicarModulosHabilitados) y
        // nunca se debe repintar con datos reales.
        if (MODULOS_HABILITADOS.curvas) {
            const contAc = $('#dash-aceites-list');
            if (!aceites.length) {
                contAc.innerHTML = '<div class="empty-state"><p>Sin aceites guardados.</p></div>';
            } else {
                contAc.innerHTML = aceites.slice(0, 5).map(a => `
                    <div class="flex-between" style="padding:10px 0; border-bottom:1px solid var(--border-soft);">
                        <div>
                            <div style="font-size:13px;">${esc(a.nombre)}</div>
                            <div class="text-faint" style="font-size:11px;">${fmtFecha(a.fecha)}</div>
                        </div>
                        <div class="font-mono" style="color:var(--teal); font-size:12.5px;">${fmt(a.visc_40,1)} / ${fmt(a.visc_100,1)} cSt</div>
                    </div>`).join('');
            }
        }
    } catch (e) {
        toast('No se pudo cargar el panel: ' + e.message, 'error');
    }
}

/* ---------------------------------------------------------
   8) CATALOGO DE LUBRICANTES (piloto: categoria Hidraulico)
   --------------------------------------------------------- */

let catalogoOpcionesCargadas = false;
let catalogoTabActual = 'buscar';
let catalogoUltimosParams = new URLSearchParams();
let catalogoUltimosProductos = [];

/* ---- Completar datos faltantes desde la calculadora de IV ---- */

// Un producto es "calculable" cuando le falta exactamente UNO de estos 3
// datos (si le faltan 2 o mas no hay suficiente informacion para
// resolverlo; si no le falta ninguno no hay nada que calcular).
function campoFaltanteCalculable(p) {
    const campos = ['viscosidad_40', 'viscosidad_100', 'indice_viscosidad'];
    const faltantes = campos.filter(c => p[c] === null || p[c] === undefined);
    if (faltantes.length !== 1) return null;
    const campo = faltantes[0];
    if (campo === 'indice_viscosidad') return { campo, label: 'Índice de Viscosidad', modo: 'directo' };
    if (campo === 'viscosidad_40') return { campo, label: 'Viscosidad a 40°C', modo: 'hallar_U' };
    return { campo, label: 'Viscosidad a 100°C', modo: 'hallar_Y' };
}

function buscarProductoLocal(id) {
    id = Number(id);
    return catalogoUltimosProductos.find(x => Number(x.id) === id)
        || registradosCache.find(x => Number(x.id) === id)
        || null;
}

// Cuando se guarda un valor calculado, actualiza el producto en las
// cachés locales (resultados de busqueda y registrados) para que la
// tarjeta/insignia "falta un dato" desaparezca sin tener que repetir la
// busqueda, y refresca lo que este visible en pantalla.
function actualizarProductoEnCaches(actualizado) {
    const id = Number(actualizado.id);
    const iBuscar = catalogoUltimosProductos.findIndex(x => Number(x.id) === id);
    if (iBuscar !== -1) catalogoUltimosProductos[iBuscar] = actualizado;
    const iReg = registradosCache.findIndex(x => Number(x.id) === id);
    if (iReg !== -1) registradosCache[iReg] = actualizado;

    if (catalogoTabActual === 'buscar' && iBuscar !== -1) {
        renderResultadosCatalogo({ total: catalogoUltimosProductos.length, productos: catalogoUltimosProductos });
    } else if (catalogoTabActual === 'registrados') {
        renderRegistrados();
    }
}

async function irACalcularFaltante(id) {
    let p = buscarProductoLocal(id);
    if (!p) {
        try { p = await api('catalogo.php?id=' + id); }
        catch (e) { return toast('No se pudo cargar el producto: ' + e.message, 'error'); }
    }
    const calc = campoFaltanteCalculable(p);
    if (!calc) return toast('Ese producto ya no tiene un único dato faltante calculable.', 'error');

    cerrarModalProducto();
    ivContextoProducto = { id: p.id, campo: calc.campo, nombre: `${p.marca} ${p.nombre}` };

    $('#iv-tabs button[data-modo="' + calc.modo + '"]')?.click();
    $('#iv-nombre').value = `${p.marca} ${p.nombre}`;

    if (calc.modo === 'directo') {
        $('#iv-directo-y').value = p.viscosidad_100;
        $('#iv-directo-u').value = p.viscosidad_40;
    } else if (calc.modo === 'hallar_U') {
        $('#iv-hu-y').value = p.viscosidad_100;
        $('#iv-hu-vi').value = p.indice_viscosidad;
    } else {
        $('#iv-hy-u').value = p.viscosidad_40;
        $('#iv-hy-vi').value = p.indice_viscosidad;
    }

    irAVista('indice');
    ejecutarCalculoIV();
    toast(`Calculando ${calc.label} faltante de "${p.marca} ${p.nombre}"…`);
}


/* ---- "Registrados": productos guardados desde el catálogo ---- */
let registradosCache = [];
let registradosIds = new Set();

async function cargarRegistrados() {
    try {
        registradosCache = await api('registrados.php');
        registradosIds = new Set(registradosCache.map(r => Number(r.id)));
    } catch (e) {
        toast('No se pudieron cargar los productos registrados: ' + e.message, 'error');
    }
    const contador = $('#cat-tab-registrados-count');
    if (contador) contador.textContent = registradosCache.length;
}

function actualizarEstrellasEnPantalla(id) {
    const activo = registradosIds.has(Number(id));
    $all(`.reg-star[data-id="${id}"]`).forEach(btn => {
        btn.classList.toggle('reg-active', activo);
        btn.textContent = activo ? '★' : '☆';
        btn.setAttribute('aria-label', activo ? 'Quitar de Registrados' : 'Guardar en Registrados');
        btn.title = activo ? 'Quitar de Registrados' : 'Guardar en Registrados';
    });
    const modalBtn = $('#cat-modal-reg-btn');
    if (modalBtn && Number(modalBtn.dataset.id) === Number(id)) {
        modalBtn.textContent = activo ? '★ Registrado' : '☆ Registrar';
        modalBtn.classList.toggle('reg-active', activo);
    }
}

async function toggleRegistro(id) {
    id = Number(id);
    const yaRegistrado = registradosIds.has(id);
    try {
        if (yaRegistrado) {
            await api('registrados.php?producto_id=' + id, { method: 'DELETE' });
            toast('Producto quitado de Registrados.');
        } else {
            await api('registrados.php', { method: 'POST', body: JSON.stringify({ producto_id: id }) });
            toast('Producto guardado en Registrados.', 'success');
        }
        await cargarRegistrados();
        actualizarEstrellasEnPantalla(id);
        if (catalogoTabActual === 'registrados') renderRegistrados();
    } catch (e) {
        toast('No se pudo actualizar Registrados: ' + e.message, 'error');
    }
}

function cambiarTabCatalogo(tab) {
    catalogoTabActual = tab;
    $all('.chip[data-cat-tab]').forEach(c => c.classList.toggle('active', c.dataset.catTab === tab));
    $('#cat-panel-buscar').classList.toggle('hidden', tab !== 'buscar');
    $('#cat-panel-registrados').classList.toggle('hidden', tab !== 'registrados');
    if (tab === 'registrados') renderRegistrados();
}

function tarjetaProductoHtml(p, registrado) {
    const calc = campoFaltanteCalculable(p);
    return `
        <div class="card producto-card" data-id="${p.id}">
            <div class="flex-between">
                <div class="producto-card-info">
                    <div class="card-title mt-0" style="margin-bottom:2px;">${p.nombre}</div>
                    <span class="badge badge-teal">${p.marca}</span>
                    <span class="badge badge-amber">${p.categoria}</span>
                    ${p.grado_sae ? `<span class="badge badge-teal">SAE ${p.grado_sae}</span>` : ''}
                    ${p.tipo_base ? `<span class="badge badge-amber">${p.tipo_base}</span>` : ''}
                    ${p.tipo_espesante ? `<span class="badge badge-amber">Espesante: ${p.tipo_espesante}</span>` : ''}
                    ${p.nlgi ? `<span class="badge badge-amber">NLGI ${p.nlgi}</span>` : ''}
                    ${calc ? `<button type="button" class="badge badge-btn calc-faltante-btn" data-id="${p.id}" title="Calcular ${calc.label} a partir de los otros dos datos">⚙ Falta ${calc.label} — calcular</button>` : ''}
                </div>
                <button type="button" class="btn btn-ghost btn-sm reg-star ${registrado ? 'reg-active' : ''}" data-id="${p.id}" title="${registrado ? 'Quitar de Registrados' : 'Guardar en Registrados'}" aria-label="${registrado ? 'Quitar de Registrados' : 'Guardar en Registrados'}">${registrado ? '★' : '☆'}</button>
            </div>
            <div class="producto-specs">
                <div><span class="m-label">ISO VG</span><span class="m-valor">${fmt(p.iso_vg, 0) || '—'}</span></div>
                <div><span class="m-label">Visc. 40°C</span><span class="m-valor">${fmt(p.viscosidad_40, 1) || '—'} cSt${p.viscosidad_40_estimada == 1 ? ' <span title="Calculado con la calculadora de Índice de Viscosidad a partir de los otros dos datos del producto." style="color:var(--amber); cursor:help;">✷</span>' : ''}</span></div>
                <div><span class="m-label">Visc. 100°C</span><span class="m-valor">${fmt(p.viscosidad_100, 1) || '—'} cSt${p.viscosidad_100_estimada == 1 ? ' <span title="El dato original del Excel no era válido (mayor que la viscosidad a 40°C) o faltaba; se recalculó con el motor ASTM D2270 a partir de los otros dos datos." style="color:var(--amber); cursor:help;">✷</span>' : ''}</span></div>
                <div><span class="m-label">VI</span><span class="m-valor">${fmt(p.indice_viscosidad, 0) || '—'}${p.indice_viscosidad_estimada == 1 ? ' <span title="Calculado con la calculadora de Índice de Viscosidad a partir de los otros dos datos del producto." style="color:var(--amber); cursor:help;">✷</span>' : ''}</span></div>
                <div><span class="m-label">P. vertido</span><span class="m-valor">${fmt(p.punto_vertido, 0) || '—'} °C</span></div>
                <div><span class="m-label">P. inflamación</span><span class="m-valor">${fmt(p.punto_inflamacion, 0) || '—'} °C</span></div>
            </div>
        </div>`;
}

function renderRegistrados() {
    const cont = $('#cat-registrados-resultados');
    if (!cont) return;
    if (!registradosCache.length) {
        cont.innerHTML = '<div class="empty-state"><p>Aún no has registrado ningún producto. Ábrelo desde el catálogo y presiona ☆ para guardarlo aquí.</p></div>';
        return;
    }
    cont.innerHTML = registradosCache.map(p => tarjetaProductoHtml(p, true)).join('');
}

function wireProductoCardClicks(contenedor) {
    contenedor.addEventListener('click', (e) => {
        const calcBtn = e.target.closest('.calc-faltante-btn');
        if (calcBtn) {
            e.stopPropagation();
            irACalcularFaltante(calcBtn.dataset.id);
            return;
        }
        const star = e.target.closest('.reg-star');
        if (star) {
            e.stopPropagation();
            toggleRegistro(star.dataset.id);
            return;
        }
        const card = e.target.closest('.producto-card');
        if (card) abrirDetalleProducto(card.dataset.id);
    });
}

async function cargarOpcionesCatalogo() {
    try {
        const d = await api('catalogo.php?opciones=1');
        const llenarSelect = (id, valores) => {
            const sel = $(id);
            valores.forEach(v => {
                if (v === null || v === '') return;
                const op = document.createElement('option');
                op.value = v;
                op.textContent = v;
                sel.appendChild(op);
            });
        };
        llenarSelect('#cat-categoria', d.categorias);
        llenarSelect('#cat-marca', d.marcas);
        llenarSelect('#cat-tipo-base', d.tipos_base);
        llenarSelect('#cat-tipo-espesante', d.tipos_espesante);
        llenarSelect('#cat-nlgi', d.nlgi);
        llenarSelect('#cat-grado-sae', d.grados_sae);
        llenarSelect('#cat-iso-vg', d.iso_vg.map(v => Number(v)));
        // "Naturaleza" no viene en /opciones (poco variado); se deja fijo
        ['mineral', 'sintético', 'semisintético'].forEach(v => {
            const op = document.createElement('option');
            op.value = v; op.textContent = v;
            $('#cat-naturaleza').appendChild(op);
        });
        catalogoOpcionesCargadas = true;
        buscarCatalogo();
    } catch (e) {
        toast('No se pudieron cargar los filtros del catálogo: ' + e.message, 'error');
    }
}

function limpiarFiltrosCatalogo() {
    ['#cat-texto', '#cat-categoria', '#cat-marca', '#cat-iso-vg', '#cat-grado-sae', '#cat-tipo-base', '#cat-tipo-espesante', '#cat-nlgi', '#cat-naturaleza',
     '#cat-visc40-min', '#cat-visc40-max', '#cat-vi-min', '#cat-vi-max'].forEach(id => { $(id).value = ''; });
    buscarCatalogo();
}

async function buscarCatalogo() {
    const params = new URLSearchParams();
    const agregar = (param, id) => { const v = $(id).value.trim(); if (v !== '') params.set(param, v); };
    agregar('texto', '#cat-texto');
    agregar('categoria', '#cat-categoria');
    agregar('marca', '#cat-marca');
    agregar('iso_vg', '#cat-iso-vg');
    agregar('tipo_base', '#cat-tipo-base');
    agregar('tipo_espesante', '#cat-tipo-espesante');
    agregar('nlgi', '#cat-nlgi');
    agregar('grado_sae', '#cat-grado-sae');
    agregar('aceite_naturaleza', '#cat-naturaleza');
    agregar('visc40_min', '#cat-visc40-min');
    agregar('visc40_max', '#cat-visc40-max');
    agregar('vi_min', '#cat-vi-min');
    agregar('vi_max', '#cat-vi-max');

    catalogoUltimosParams = params;

    const cont = $('#cat-resultados');
    cont.innerHTML = '<div class="empty-state"><p>Buscando…</p></div>';
    try {
        const r = await api('catalogo.php?' + params.toString());
        renderResultadosCatalogo(r);
    } catch (e) {
        cont.innerHTML = `<div class="empty-state"><p>Error al buscar: ${e.message}</p></div>`;
    }
}

function renderResultadosCatalogo(data) {
    $('#cat-resultados-titulo').textContent = `Resultados (${data.total})`;
    catalogoUltimosProductos = data.productos;
    const cont = $('#cat-resultados');
    if (!data.productos.length) {
        cont.innerHTML = '<div class="empty-state"><p>Ningún producto coincide con esos filtros.</p></div>';
        return;
    }
    cont.innerHTML = data.productos.map(p => tarjetaProductoHtml(p, registradosIds.has(Number(p.id)))).join('');
}

$('#cat-buscar-btn').addEventListener('click', buscarCatalogo);
$('#cat-limpiar-btn').addEventListener('click', limpiarFiltrosCatalogo);
$('#cat-texto').addEventListener('keydown', (e) => { if (e.key === 'Enter') buscarCatalogo(); });

$('#cat-export-resultados')?.addEventListener('click', () => {
    abrirDescarga(API + 'export_excel.php?tipo=catalogo&' + catalogoUltimosParams.toString());
});
$('#cat-registrados-export-excel')?.addEventListener('click', () => {
    abrirDescarga(API + 'export_excel.php?tipo=registrados');
});
$all('.chip[data-cat-tab]').forEach(chip => {
    chip.addEventListener('click', () => cambiarTabCatalogo(chip.dataset.catTab));
});

// Delegacion: las tarjetas se re-renderizan en cada busqueda, asi que el
// listener va en el contenedor fijo en vez de en cada tarjeta.
wireProductoCardClicks($('#cat-resultados'));
wireProductoCardClicks($('#cat-registrados-resultados'));

async function abrirDetalleProducto(id) {
    $('#cat-modal-overlay').classList.remove('hidden');
    $('#cat-modal-contenido').innerHTML = '<div class="empty-state"><p>Cargando…</p></div>';
    try {
        const p = await api('catalogo.php?id=' + id);
        renderModalProducto(p);
    } catch (e) {
        $('#cat-modal-contenido').innerHTML = `<div class="empty-state"><p>Error al cargar el producto: ${e.message}</p></div>`;
    }
}

function renderModalProducto(p) {
    const spec = (label, valor) => valor === null || valor === undefined || valor === ''
        ? '' : `<div><span class="m-label">${label}</span><span class="m-valor">${valor}</span></div>`;

    const registrado = registradosIds.has(Number(p.id));
    const calc = campoFaltanteCalculable(p);

    $('#cat-modal-contenido').innerHTML = `
        <div class="flex-between" style="padding-right:38px;">
            <div>
                <span class="badge badge-teal">${p.marca}</span>
                <span class="badge badge-amber">${p.categoria}</span>
            </div>
            <button type="button" class="btn btn-ghost btn-sm reg-star ${registrado ? 'reg-active' : ''}" id="cat-modal-reg-btn" data-id="${p.id}">${registrado ? '★ Registrado' : '☆ Registrar'}</button>
        </div>
        <div class="card-title" style="margin:10px 0 0;">${p.nombre}</div>
        <div class="btn-row" style="margin-top:10px;">
            <button type="button" class="btn btn-ghost btn-sm" id="cat-modal-export-pdf">Ficha en PDF</button>
        </div>
        ${calc ? `
        <div class="card" style="padding:12px 14px; margin-top:12px; background:var(--amber-soft); border-color:var(--amber);">
            <div style="font-size:12.5px; color:var(--text-muted); margin-bottom:8px;">A este producto le falta un solo dato (<strong>${calc.label}</strong>) — se puede calcular a partir de los otros dos.</div>
            <button type="button" class="btn btn-primary btn-sm" id="cat-modal-calcular-faltante" data-id="${p.id}">⚙ Calcular ${calc.label} faltante</button>
        </div>` : ''}
        <div class="modal-specs">
            ${spec('Naturaleza', p.aceite_naturaleza)}
            ${spec('Tipo de base', p.tipo_base)}
            ${spec('Tipo de espesante', p.tipo_espesante)}
            ${spec('NLGI', p.nlgi)}
            ${spec('Grado SAE', p.grado_sae)}
            ${spec('ISO VG', fmt(p.iso_vg, 0))}
            ${spec('Visc. 40°C', p.viscosidad_40 !== null ? fmt(p.viscosidad_40, 1) + ' cSt' + (p.viscosidad_40_estimada == 1 ? ' ✷' : '') : null)}
            ${spec('Visc. 100°C', p.viscosidad_100 !== null ? fmt(p.viscosidad_100, 1) + ' cSt' + (p.viscosidad_100_estimada == 1 ? ' ✷' : '') : null)}
            ${spec('Índice de Viscosidad', p.indice_viscosidad !== null ? fmt(p.indice_viscosidad, 0) + (p.indice_viscosidad_estimada == 1 ? ' ✷' : '') : null)}
            ${spec('Punto de vertido', p.punto_vertido !== null ? fmt(p.punto_vertido, 0) + ' °C' : null)}
            ${spec('Punto de inflamación', p.punto_inflamacion !== null ? fmt(p.punto_inflamacion, 0) + ' °C' : null)}
            ${spec('Densidad', p.densidad !== null ? fmt(p.densidad, 4) + ' g/cm³' : null)}
        </div>
        ${p.caracteristicas ? `<div class="modal-caracteristicas">${p.caracteristicas}</div>` : ''}
        <div class="btn-row action-bar-mobile stack-mobile">
            ${(p.iso_vg !== null || p.nlgi !== null || p.grado_sae !== null || p.viscosidad_40 !== null) ? `
                <button class="btn btn-primary" id="cat-ver-equivalencias">Ver equivalencias entre marcas</button>
            ` : ''}
            ${p.viscosidad_40 !== null && p.viscosidad_100 !== null ? `
                <button class="btn ${(p.iso_vg !== null || p.nlgi !== null || p.grado_sae !== null) ? 'btn-ghost' : 'btn-primary'}" id="cat-enviar-iv">Calcular su Índice de Viscosidad</button>
                <button class="btn btn-ghost" id="cat-enviar-curva">Ver su curva Temp-Viscosidad</button>
            ` : (p.iso_vg === null && p.nlgi === null && p.grado_sae === null && !calc ? '<p class="text-faint" style="font-size:12.5px;">Este producto no tiene viscosidad a 40°C y 100°C completas, así que no se puede enviar a las calculadoras ni buscar equivalencias.</p>' : '')}
        </div>
    `;

    $('#cat-modal-calcular-faltante')?.addEventListener('click', () => irACalcularFaltante(p.id));

    $('#cat-modal-reg-btn').addEventListener('click', () => toggleRegistro(p.id));
    $('#cat-modal-export-pdf').addEventListener('click', () => {
        abrirDescarga(API + 'export_pdf.php?tipo=producto&id=' + p.id);
    });

    if (p.iso_vg !== null || p.nlgi !== null || p.grado_sae !== null || p.viscosidad_40 !== null) {
        $('#cat-ver-equivalencias').addEventListener('click', () => verEquivalencias(p.id));
    }

    if (p.viscosidad_40 !== null && p.viscosidad_100 !== null) {
        $('#cat-enviar-iv').addEventListener('click', () => enviarProductoAIndice(p));
        $('#cat-enviar-curva').addEventListener('click', () => enviarProductoACurvas(p));
    }
}

function cerrarModalProducto() {
    $('#cat-modal-overlay').classList.add('hidden');
}
$('#cat-modal-close').addEventListener('click', cerrarModalProducto);
$('#cat-modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'cat-modal-overlay') cerrarModalProducto(); });

async function verEquivalencias(id) {
    $('#cat-modal-contenido').innerHTML = '<div class="empty-state"><p>Buscando equivalencias…</p></div>';
    try {
        const r = await api('catalogo.php?equivalencias=' + id);
        renderEquivalencias(r);
    } catch (e) {
        $('#cat-modal-contenido').innerHTML = `<div class="empty-state"><p>Error al buscar equivalencias: ${e.message}</p></div>`;
    }
}

function renderEquivalencias(r) {
    const base = r.base;
    const criterioLegible = { iso_vg: 'mismo ISO VG', nlgi: 'mismo NLGI', grado_sae: 'mismo grado SAE' }[r.criterio] || r.criterio;

    let listaHtml;
    if (!r.equivalencias.length) {
        listaHtml = '<div class="empty-state"><p>No se encontraron productos equivalentes en el catálogo actual.</p></div>';
    } else {
        listaHtml = r.equivalencias.map(p => `
            <div class="card producto-card" data-id="${p.id}" style="margin-bottom:10px;">
                <div class="flex-between">
                    <div>
                        <div style="font-size:14px; font-weight:600;">${p.nombre}</div>
                        <span class="badge ${p.misma_marca ? 'badge-amber' : 'badge-teal'}">${p.marca}${p.misma_marca ? ' (misma marca)' : ''}</span>
                    </div>
                    <div class="font-mono text-faint" style="font-size:11.5px; text-align:right;">
                        ${fmt(p.viscosidad_40,1)} / ${fmt(p.viscosidad_100,1)} cSt<br>VI ${fmt(p.indice_viscosidad,0)}
                    </div>
                </div>
            </div>`).join('');
    }

    $('#cat-modal-contenido').innerHTML = `
        <button class="btn btn-ghost" id="cat-volver-ficha" style="margin-bottom:14px;">← Volver a la ficha</button>
        <div class="card-title mt-0">Equivalencias de "${base.nombre}"</div>
        <p class="text-faint" style="font-size:12.5px; margin:4px 0 16px;">Mismo criterio de clasificación (${criterioLegible}), otras marcas de la misma categoría, ordenadas de más a menos parecidas en viscosidad e índice de viscosidad.</p>
        ${listaHtml}
    `;
    $('#cat-volver-ficha').addEventListener('click', () => renderModalProducto(base));
    $all('#cat-modal-contenido .producto-card').forEach(card => {
        card.addEventListener('click', () => abrirDetalleProducto(card.dataset.id));
    });
}

function enviarProductoAIndice(p) {
    cerrarModalProducto();
    // fuerza el modo "directo" del formulario de IV
    $('#iv-tabs button[data-modo="directo"]')?.click();
    $('#iv-nombre').value = `${p.marca} ${p.nombre}`;
    $('#iv-directo-y').value = p.viscosidad_100;
    $('#iv-directo-u').value = p.viscosidad_40;
    irAVista('indice');
    toast('Datos cargados desde el catálogo — presiona Calcular');
}

function enviarProductoACurvas(p) {
    cerrarModalProducto();
    $('#cv-nombre').value = `${p.marca} ${p.nombre}`;
    $('#cv-v40').value = p.viscosidad_40;
    $('#cv-v100').value = p.viscosidad_100;
    $('#cv-notas').value = p.caracteristicas ? `Del catálogo técnico — ${p.categoria}` : '';
    irAVista('curvas');
    toast('Datos cargados desde el catálogo — presiona Generar curva');
}

/* ---------------------------------------------------------
/* ---------------------------------------------------------
   0.1) Aplicar el bloqueo visual de modulos "en desarrollo"
   --------------------------------------------------------- */

function marcarModuloEnDesarrollo(vistaId, nombreVisible, descripcion) {
    const view = document.getElementById('view-' + vistaId);
    if (view) {
        view.innerHTML = `
            <div class="view-header">
                <div>
                    <span class="eyebrow">Próximamente</span>
                    <h2 class="view-title">${nombreVisible}</h2>
                    <div class="view-desc">${descripcion}</div>
                </div>
            </div>
            <div class="card en-desarrollo-card">
                <div class="en-desarrollo-icono">🚧</div>
                <div class="card-title" style="justify-content:center;">Este módulo está en desarrollo</div>
                <div class="card-sub">Se habilitará en una próxima entrega del proyecto.</div>
            </div>`;
    }
    $all(`.nav-item[data-view="${vistaId}"]`).forEach(el => {
        el.classList.add('nav-en-desarrollo');
        if (!el.querySelector('.nav-dev-badge')) {
            const badge = document.createElement('span');
            badge.className = 'nav-dev-badge';
            badge.textContent = 'En desarrollo';
            el.appendChild(badge);
        }
    });
}

function aplicarModulosHabilitados() {
    if (!MODULOS_HABILITADOS.curvas) {
        marcarModuloEnDesarrollo('curvas', 'Curvas Temp-Viscosidad', 'Generación de curvas Viscosidad-Temperatura (ASTM D341) a partir de dos datos conocidos del aceite.');

        const btnCurva = document.querySelector('[data-goto="curvas"]');
        if (btnCurva) {
            btnCurva.textContent = 'Generar curva de aceite (en desarrollo)';
            btnCurva.classList.add('btn-disabled-dev');
        }

        const contAc = document.getElementById('dash-aceites-list');
        if (contAc) contAc.innerHTML = '<div class="empty-state"><p>Este módulo está en desarrollo.</p></div>';

        const statAceites = document.getElementById('stat-aceites');
        if (statAceites && statAceites.parentElement) statAceites.parentElement.style.display = 'none';

        const chipCurvasHist = document.querySelector('.chip[data-tipo-hist="curvas"]');
        if (chipCurvasHist) chipCurvasHist.style.display = 'none';
    }

    if (!MODULOS_HABILITADOS.catalogo) {
        marcarModuloEnDesarrollo('catalogo', 'Buscar lubricantes', 'Buscador multicriterio sobre la biblioteca de productos lubricantes, con equivalencias entre marcas y exportación de fichas.');
    }
}

aplicarModulosHabilitados();

/* ---------------------------------------------------------
   9) INICIO (protegido por login)
   --------------------------------------------------------- */

function iniciarApp() {
    cargarDashboard();
    if (MODULOS_HABILITADOS.catalogo) cargarRegistrados();
}

// VERSIÓN LOCAL: no hay cuentas ni login; la app abre directo con el usuario del teléfono.
mostrarApp(AteneaLocal.USUARIO_LOCAL);
iniciarApp();

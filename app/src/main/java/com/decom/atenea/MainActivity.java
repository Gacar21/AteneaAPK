package com.decom.atenea;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * Atenea local: la interfaz original (HTML/JS/CSS) corre dentro de la app y los
 * datos viven en el teléfono. No usa internet ni servidor.
 * Aquí solo está lo que el navegador no hace solo: guardar Excel/PDF en Descargas,
 * compartir, abrir archivos y elegir un respaldo para importar.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/www/index.html";
    private static final String FOLDER = "Atenea";
    private static final int REQ_ARCHIVO = 71;

    private static final Map<String, String> CONTENT_TYPES = new HashMap<>();
    static {
        CONTENT_TYPES.put("html", "text/html");
        CONTENT_TYPES.put("js", "application/javascript");
        CONTENT_TYPES.put("css", "text/css");
        CONTENT_TYPES.put("json", "application/json");
        CONTENT_TYPES.put("svg", "image/svg+xml");
        CONTENT_TYPES.put("png", "image/png");
        CONTENT_TYPES.put("jpg", "image/jpeg");
        CONTENT_TYPES.put("woff2", "font/woff2");
        CONTENT_TYPES.put("ico", "image/x-icon");
    }

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private ByteArrayOutputStream building;
    private String buildingName;
    private final ArrayList<Uri> shareQueue = new ArrayList<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);

        webView.addJavascriptInterface(new Bridge(), "Android");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                if (HOST.equals(u.getHost())) return false;
                // Enlaces externos (ej. soporte por WhatsApp): se abren con la app del teléfono
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, "Elegir archivo"), REQ_ARCHIVO);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(START_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_ARCHIVO || fileCallback == null) return;
        Uri u = (resultCode == RESULT_OK && data != null) ? data.getData() : null;
        fileCallback.onReceiveValue(u == null ? null : new Uri[]{u});
        fileCallback = null;
    }

    private WebResourceResponse serve(Uri url) {
        if (!HOST.equals(url.getHost()) || url.getPath() == null) return null;
        String path = url.getPath();
        try {
            if (path.startsWith("/www/")) {
                String asset = path.substring(1);
                if (asset.contains("..")) return notFound();
                String ext = asset.substring(asset.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT);
                String type = CONTENT_TYPES.containsKey(ext) ? CONTENT_TYPES.get(ext) : "application/octet-stream";
                return new WebResourceResponse(type, "UTF-8", getAssets().open(asset));
            }
        } catch (Exception e) {
            return notFound();
        }
        return notFound();
    }

    private WebResourceResponse notFound() {
        WebResourceResponse r = new WebResourceResponse("text/plain", "UTF-8", null);
        r.setStatusCodeAndReasonPhrase(404, "Not Found");
        return r;
    }

    /** Guarda en Descargas/Atenea (Excel, PDF, respaldos). */
    private Uri saveToDownloads(byte[] bytes, String name, String mime) throws Exception {
        ContentResolver cr = getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/" + FOLDER);
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = cr.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), v);
        if (uri == null) throw new Exception("No se pudo crear el archivo");
        try (OutputStream out = cr.openOutputStream(uri)) {
            if (out == null) throw new Exception("No se pudo escribir");
            out.write(bytes);
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        cr.update(uri, done, null, null);
        return uri;
    }

    private Uri saveToShareCache(byte[] bytes, String name) throws Exception {
        File dir = new File(getCacheDir(), "compartir");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("Sin espacio temporal");
        File f = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(f)) {
            out.write(bytes);
        }
        return FileProvider.getUriForFile(this, getPackageName() + ".archivos", f);
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_SHORT).show());
    }

    @Override
    public void onBackPressed() {
        // La interfaz decide: cierra ventanas abiertas o vuelve al panel; si ya está en el panel, sale
        webView.evaluateJavascript("window.handleBack ? window.handleBack() : false", value -> {
            if (!"true".equals(value)) MainActivity.super.onBackPressed();
        });
    }

    /** Métodos que la interfaz llama como Android.xxx() */
    private class Bridge {
        @JavascriptInterface
        public void beginFile(String name) {
            building = new ByteArrayOutputStream();
            buildingName = name.replaceAll("[\\\\/:*?\"<>|]", "-");
        }

        @JavascriptInterface
        public void appendFile(String base64Chunk) {
            if (building == null) return;
            byte[] b = Base64.decode(base64Chunk, Base64.DEFAULT);
            building.write(b, 0, b.length);
        }

        /** destino: "dispositivo" (Descargas/Atenea) o "compartir". Devuelve el uri, o "" si falló. */
        @JavascriptInterface
        public String endFile(String mime, String destino) {
            if (building == null) return "";
            byte[] bytes = building.toByteArray();
            building = null;
            try {
                if ("compartir".equals(destino)) {
                    Uri u = saveToShareCache(bytes, buildingName);
                    shareQueue.add(u);
                    return u.toString();
                }
                return saveToDownloads(bytes, buildingName, mime).toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void shareQueued(String mime) {
            if (shareQueue.isEmpty()) return;
            Intent i = new Intent(Intent.ACTION_SEND);
            i.putExtra(Intent.EXTRA_STREAM, shareQueue.get(shareQueue.size() - 1));
            i.setType(mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            shareQueue.clear();
            final Intent chooser = Intent.createChooser(i, "Compartir");
            runOnUiThread(() -> {
                try {
                    startActivity(chooser);
                } catch (ActivityNotFoundException e) {
                    toast("No hay apps para compartir");
                }
            });
        }

        @JavascriptInterface
        public void openUri(String uriString, String mime) {
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(Uri.parse(uriString), mime);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            runOnUiThread(() -> {
                try {
                    startActivity(i);
                } catch (ActivityNotFoundException e) {
                    toast("No hay una app para abrir este archivo (instala Excel, Hojas de cálculo o un lector de PDF)");
                }
            });
        }

        @JavascriptInterface
        public void toast(String msg) {
            MainActivity.this.toast(msg);
        }
    }
}

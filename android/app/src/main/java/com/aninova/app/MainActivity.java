package com.aninova.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.widget.FrameLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;
import com.getcapacitor.BridgeWebViewClient;

import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Actividad principal de AniNova.
 *
 * Además de cargar la web (Capacitor), hace tres cosas que un navegador
 * normal no hace por ti:
 *
 *  1. BLOQUEO DE ANUNCIOS POR DOMINIO: cualquier petición (también las de
 *     dentro de los iframes de los reproductores) a un dominio de
 *     res/raw/adblock_hosts.txt se responde vacía.
 *  2. BLOQUEO DE POP-UPS Y REDIRECCIONES: los reproductores intentan abrir
 *     pestañas nuevas o sacar al usuario de la app al tocar el vídeo. Aquí
 *     toda navegación de la página principal fuera de la app se cancela,
 *     salvo unos pocos sitios de confianza que se abren en el navegador.
 *  3. PANTALLA COMPLETA REAL para el vídeo (apaisado + sin barras).
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "AniNova";

    /** Sitios externos que SÍ pueden abrirse (en el navegador del sistema). */
    private static final Set<String> EXTERNAL_ALLOWED = new HashSet<>(Arrays.asList(
        "zonatmo.org", "themoviedb.org", "github.com", "githubusercontent.com", "aninova.netlify.app"
    ));

    /** Fragmentos que delatan un host de publicidad aunque no esté en la lista. */
    private static final String[] AD_HOST_HINTS = {
        "doubleclick", "googlesyndication", "googleads", "adservice", "adserver", "adsystem",
        "popads", "popcash", "popunder", "propeller", "adsterra", "exoclick", "exosrv",
        "juicyads", "hilltopads", "clickadu", "onclick", "trafficjunky", "pushnotif"
    };

    private final Set<String> blockedHosts = new HashSet<>();
    private String appHost = "localhost";

    // Estado de la pantalla completa
    private View fullscreenView;
    private android.webkit.WebChromeClient.CustomViewCallback fullscreenCallback;
    private int previousOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        loadBlocklist();

        Bridge bridge = getBridge();
        try {
            String host = Uri.parse(bridge.getAppUrl()).getHost();
            if (host != null) appHost = host.toLowerCase(Locale.ROOT);
        } catch (Exception ignored) { }

        WebView webView = bridge.getWebView();
        WebSettings settings = webView.getSettings();
        // Sin ventanas emergentes: window.open() no crea pestañas nuevas y
        // cualquier intento pasa por shouldOverrideUrlLoading (abajo).
        settings.setSupportMultipleWindows(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        bridge.setWebViewClient(new AdBlockWebViewClient(bridge));
        webView.setWebChromeClient(new FullscreenChromeClient(bridge));
    }

    // ------------------------------------------------------------------
    // Lista de bloqueo
    // ------------------------------------------------------------------
    private void loadBlocklist() {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(
                getResources().openRawResource(R.raw.adblock_hosts), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                line = line.trim().toLowerCase(Locale.ROOT);
                if (line.isEmpty() || line.startsWith("#")) continue;
                blockedHosts.add(line);
            }
        } catch (Exception e) {
            Log.w(TAG, "No se pudo leer la lista de bloqueo", e);
        }
        Log.i(TAG, "Bloqueador: " + blockedHosts.size() + " dominios cargados");
    }

    /** true si el host (o alguno de sus dominios padre) está bloqueado. */
    private boolean isAdHost(String host) {
        if (host == null || host.isEmpty()) return false;
        host = host.toLowerCase(Locale.ROOT);
        if (isAppHost(host)) return false;

        String h = host;
        while (true) {
            if (blockedHosts.contains(h)) return true;
            int dot = h.indexOf('.');
            if (dot < 0) break;
            h = h.substring(dot + 1);
        }
        for (String hint : AD_HOST_HINTS) {
            if (host.contains(hint)) return true;
        }
        return false;
    }

    private boolean isAppHost(String host) {
        return host != null && (host.equals(appHost) || host.equals("localhost"));
    }

    private static boolean matchesDomain(String host, Set<String> domains) {
        if (host == null) return false;
        String h = host.toLowerCase(Locale.ROOT);
        while (true) {
            if (domains.contains(h)) return true;
            int dot = h.indexOf('.');
            if (dot < 0) return false;
            h = h.substring(dot + 1);
        }
    }

    // ------------------------------------------------------------------
    // WebViewClient: bloqueo de peticiones y de navegaciones
    // ------------------------------------------------------------------
    private class AdBlockWebViewClient extends BridgeWebViewClient {

        AdBlockWebViewClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (url != null && isAdHost(url.getHost())) {
                return new WebResourceResponse("text/plain", "utf-8", new ByteArrayInputStream(new byte[0]));
            }
            return super.shouldInterceptRequest(view, request);
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
            String host = url.getHost();

            // intent://, market://, tg://… (anuncios que abren otras apps): fuera.
            if (!scheme.equals("http") && !scheme.equals("https")) {
                return !scheme.equals("about") && !scheme.equals("blob") && !scheme.equals("data");
            }

            if (isAdHost(host)) return true;

            // Dentro de un iframe (el reproductor): que navegue a su aire.
            if (!request.isForMainFrame()) return false;

            // Página principal: solo la propia app.
            if (isAppHost(host)) return false;

            // Enlaces externos de confianza pulsados por el usuario → navegador.
            if (request.hasGesture() && matchesDomain(host, EXTERNAL_ALLOWED)) {
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) { }
                return true;
            }

            // Todo lo demás es un pop-up o una redirección publicitaria.
            Log.i(TAG, "Navegación bloqueada: " + host);
            return true;
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri uri = Uri.parse(url);
            String host = uri.getHost();
            if (isAppHost(host)) return false;
            return true;
        }
    }

    // ------------------------------------------------------------------
    // WebChromeClient: pantalla completa del vídeo
    // ------------------------------------------------------------------
    private class FullscreenChromeClient extends BridgeWebChromeClient {

        FullscreenChromeClient(Bridge bridge) {
            super(bridge);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            view.setBackgroundColor(Color.BLACK);

            FrameLayout decor = (FrameLayout) getWindow().getDecorView();
            decor.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

            previousOrientation = getRequestedOrientation();
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);

            WindowInsetsControllerCompat insets = WindowCompat.getInsetsController(getWindow(), decor);
            insets.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            insets.hide(WindowInsetsCompat.Type.systemBars());
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }
    }

    private boolean exitFullscreen() {
        if (fullscreenView == null) return false;

        FrameLayout decor = (FrameLayout) getWindow().getDecorView();
        decor.removeView(fullscreenView);
        fullscreenView = null;

        WindowCompat.getInsetsController(getWindow(), decor).show(WindowInsetsCompat.Type.systemBars());
        setRequestedOrientation(previousOrientation);

        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
        return true;
    }

    // ------------------------------------------------------------------
    // Botón Atrás: sale de pantalla completa → página anterior → cerrar
    // ------------------------------------------------------------------
    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (exitFullscreen()) return;
        WebView webView = getBridge().getWebView();
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}

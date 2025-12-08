package com.aninova.app;

import android.content.SharedPreferences;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.util.HashSet;
import java.util.Set;

public class MainActivity extends BridgeActivity {

    private final Set<String> adDomains = new HashSet<>();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        showWhatsNewDialog();

        // Lista de dominios de anuncios a bloquear
        adDomains.add("doubleclick.net");
        adDomains.add("googleads");
        adDomains.add("googlesyndication.com");
        adDomains.add("adservice.google.com");
        adDomains.add("pagead2.googlesyndication.com");
        adDomains.add("ads.pubmatic.com");
        adDomains.add("adsystem.com");
        adDomains.add("analytics");
        adDomains.add("buffooncountabletreble.com");
        adDomains.add("constructpreachystopper.com");
        adDomains.add("122da.com");
        adDomains.add("curlyluxurypregnancy.com");
        adDomains.add("ad.zanox.com");
        adDomains.add("adsrvr.org");
        adDomains.add("openx.net");

        WebView webView = getBridge().getWebView();

        webView.setWebViewClient(new BridgeWebViewClient(getBridge()) {
            @Nullable
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if (isAd(url)) {
                    // Si es un anuncio, devuelve una respuesta vacía para bloquearlo.
                    return new WebResourceResponse("text/plain", "UTF-8", null);
                }
                // De lo contrario, deja que el comportamiento predeterminado lo maneje.
                return super.shouldInterceptRequest(view, request);
            }

            private boolean isAd(String url) {
                for (String domain : adDomains) {
                    if (url.contains(domain)) {
                        return true;
                    }
                }
                return false;
            }
        });
    }

    private void showWhatsNewDialog() {
        SharedPreferences prefs = getSharedPreferences("AniNovaPrefs", MODE_PRIVATE);
        boolean hasSeenDialog = prefs.getBoolean("has_seen_dialog_2.0", false);

        if (!hasSeenDialog) {
            String title = "Mejoras de AniNova 2.0";
            String message =
                "🎬 Nueva Sección de Películas y Series (Fase Beta)\n" +
                " - Carrusel dinámico en página principal.\n" +
                " - Apartado de Peliculas y Series recientes.\n" +
                " - Servidores Gratuitos para ver contenido en idioma original. (Estoy trabajando para traer contenido en español).\n" +
                " - Mas bloqueos contra anuncios en los servidores.\n\n" +
                "🐛 Bugs Corregidos\n" +
                " - Fallo de carga al iniciar la apk.\n" +
                " - Botones inactivos.\n" +
                " - Error de dirección entre enlaces.\n" +
                " - Solucionado el botón de \"Atrás\". Antes al presionar el botón de atrás se cerraba la apk, ya esta corregido.\n\n" +
                "🎨 Estética\n" +
                " - Nuevos Botones de Ep Siguiente o Anterior.\n" +
                " - Descripciones en Español.\n" +
                " - En el apartado de peliculas he implementado una paleta de colores diferente para distinguir el contenido.";

            new AlertDialog.Builder(this)
                .setTitle(title)
                .setMessage(message)
                .setPositiveButton("Entendido", (dialog, which) -> {
                    dialog.dismiss();
                    // Marcar que el usuario ya ha visto el diálogo
                    SharedPreferences.Editor editor = prefs.edit();
                    editor.putBoolean("has_seen_dialog_2.0", true);
                    editor.apply();
                })
                .setCancelable(false) // Evita que se cierre al tocar fuera
                .show();
        }
    }

    @Override
    public void onBackPressed() {
        WebView webView = getBridge().getWebView();
        if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }
}

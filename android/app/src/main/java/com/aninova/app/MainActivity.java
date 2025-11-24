package com.aninova.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import androidx.annotation.Nullable;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.util.HashSet;
import java.util.Set;

public class MainActivity extends BridgeActivity {

    private final Set<String> adDomains = new HashSet<>();

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

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
}

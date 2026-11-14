package com.sanskritnet.mocktest;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;

/** Loads the live website, so every site update shows up in the app with no new APK. */
public class MainActivity extends Activity {
    private static final String SITE = "https://sanskritnet.chidanandshastry.workers.dev/";
    private WebView web;
    private SwipeRefreshLayout refresh;
    private boolean failed = false;

    @SuppressLint("SetJavaScriptEnabled")
    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        refresh = new SwipeRefreshLayout(this);
        refresh.addView(web);
        setContentView(refresh);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // keeps the student logged in
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        CookieManager.getInstance().setAcceptCookie(true);

        refresh.setOnRefreshListener(() -> { failed = false; web.loadUrl(SITE); });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("app".equals(u.getScheme())) { failed = false; v.loadUrl(SITE); return true; }
                if (u.getHost() != null && u.getHost().endsWith("chidanandshastry.workers.dev")) return false;
                if (u.getHost() != null && u.getHost().endsWith("supabase.co")) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, u));   // other links open in the browser
                return true;
            }
            @Override public void onPageStarted(WebView v, String url, Bitmap f) { refresh.setRefreshing(true); }
            @Override public void onPageFinished(WebView v, String url) { refresh.setRefreshing(false); }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame() && !failed) { failed = true; v.loadUrl("file:///android_asset/offline.html"); }
            }
        });
        if (b != null) web.restoreState(b); else web.loadUrl(SITE);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() {
        if (web.canGoBack() && !failed) web.goBack(); else super.onBackPressed();
    }
}

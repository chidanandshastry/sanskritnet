package com.sanskritnet.mocktest;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
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

        // A bare WebView ignores confirm() and alert(), so the site's "Submit test?" box would do nothing.
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onJsConfirm(WebView v, String url, String msg, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg)
                    .setPositiveButton("OK", (d, w) -> r.confirm())
                    .setNegativeButton("Cancel", (d, w) -> r.cancel())
                    .setOnCancelListener(d -> r.cancel()).show();
                return true;
            }
            @Override public boolean onJsAlert(WebView v, String url, String msg, JsResult r) {
                new AlertDialog.Builder(MainActivity.this).setMessage(msg)
                    .setPositiveButton("OK", (d, w) -> r.confirm()).setOnCancelListener(d -> r.confirm()).show();
                return true;
            }
        });
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

    // Back: the site goes from a sub-screen to the dashboard first; only from the dashboard does the app close.
    @Override public void onBackPressed() {
        if (failed) { super.onBackPressed(); return; }
        web.evaluateJavascript("(function(){return !!(window.__appBack && window.__appBack());})()", handled -> {
            if ("true".equals(handled)) return;
            if (web.canGoBack()) web.goBack(); else finish();
        });
    }
}

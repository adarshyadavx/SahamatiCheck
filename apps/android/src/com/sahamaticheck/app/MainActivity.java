package com.sahamaticheck.app;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.text.TextUtils;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.ProgressBar;
import android.widget.Toast;

import java.io.UnsupportedEncodingException;
import java.net.URLEncoder;
import java.util.Locale;

/**
 * Shows the SahamatiCheck website and turns a shared Play Store link into a check.
 * All analysis happens on the SahamatiCheck server; this app only displays it.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "sahamaticheck";
    private static final String KEY_SERVER = "server";
    private static final int MENU_SERVER = 1;
    private static final int MENU_RELOAD = 2;
    private static final int MENU_BROWSER = 3;

    private WebView web;
    private ProgressBar progress;
    /** A share that arrived before a server address was set; it runs once one is saved. */
    private Intent pending;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setIndeterminate(true);
        progress.setVisibility(View.GONE);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        root.addView(progress, new FrameLayout.LayoutParams(-1, dp(4)));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);           // the website is a Next.js app
        s.setDomStorageEnabled(true);           // theme and language choices
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new Client());

        if (state != null) {
            web.restoreState(state);
        } else {
            handle(getIntent());
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handle(intent);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    // ------------------------------------------------------------------ navigation

    private void handle(Intent intent) {
        String server = server();
        if (server == null) {
            pending = intent;
            askForServer(true);
            return;
        }
        String shared = sharedText(intent);
        if (shared != null) {
            web.loadUrl(server + "/" + lang() + "/check?q=" + encode(shared));
        } else if (web.getUrl() == null) {
            web.loadUrl(server + "/" + lang());
        }
    }

    /** The text another app shared (the Play Store shares "Check out X … https://play.google.com/…"). */
    private static String sharedText(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (TextUtils.isEmpty(text)) return null;
        String t = text.toString().trim();
        return t.length() > 2000 ? t.substring(0, 2000) : t;
    }

    private static String lang() {
        return "hi".equals(Locale.getDefault().getLanguage()) ? "hi" : "en";
    }

    private static String encode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8");
        } catch (UnsupportedEncodingException e) {
            return "";
        }
    }

    // ------------------------------------------------------------------ server address

    private String server() {
        String s = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_SERVER, null);
        return TextUtils.isEmpty(s) ? null : s;
    }

    /** Accepts "192.168.1.20:3100" or "https://example.org/" and returns "http(s)://host[:port]". */
    static String normaliseServer(String raw) {
        if (raw == null) return null;
        String s = raw.trim();
        if (s.isEmpty()) return null;
        if (!s.matches("(?i)^https?://.*")) s = "http://" + s;
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        Uri u = Uri.parse(s);
        if (u.getHost() == null || u.getHost().isEmpty()) return null;
        return s;
    }

    private void askForServer(final boolean firstRun) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint(R.string.server_hint);
        input.setSingleLine(true);
        String current = server();
        if (current != null) input.setText(current);
        FrameLayout box = new FrameLayout(this);
        box.setPadding(dp(20), dp(8), dp(20), 0);
        box.addView(input);

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle(R.string.server_title)
                .setMessage(R.string.server_message)
                .setView(box)
                .setPositiveButton(R.string.save, (d, w) -> {
                    String s = normaliseServer(input.getText().toString());
                    if (s == null) {
                        Toast.makeText(this, R.string.server_invalid, Toast.LENGTH_LONG).show();
                        askForServer(firstRun);
                        return;
                    }
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_SERVER, s).apply();
                    Intent next = pending;
                    pending = null;
                    if (next != null && sharedText(next) != null) {
                        handle(next);
                    } else {
                        web.loadUrl(s + "/" + lang());
                    }
                });
        if (firstRun) {
            b.setCancelable(false);
        } else {
            b.setNegativeButton(android.R.string.cancel, null);
        }
        b.show();
    }

    // ------------------------------------------------------------------ menu

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, MENU_RELOAD, 0, R.string.reload);
        menu.add(0, MENU_SERVER, 1, R.string.server_title);
        menu.add(0, MENU_BROWSER, 2, R.string.open_in_browser);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case MENU_RELOAD:
                if (web.getUrl() == null && server() != null) web.loadUrl(server() + "/" + lang());
                else web.reload();
                return true;
            case MENU_SERVER:
                askForServer(false);
                return true;
            case MENU_BROWSER:
                String url = web.getUrl();
                if (url != null && url.startsWith("http")) openExternally(Uri.parse(url));
                return true;
            default:
                return super.onOptionsItemSelected(item);
        }
    }

    // ------------------------------------------------------------------ web view

    private void openExternally(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, uri.toString(), Toast.LENGTH_LONG).show();
        }
    }

    private boolean isOwnPage(Uri uri) {
        String server = server();
        if (server == null) return false;
        Uri s = Uri.parse(server);
        return TextUtils.equals(uri.getHost(), s.getHost()) && uri.getPort() == s.getPort();
    }

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isOwnPage(uri)) return false;
            // privacy policies, Google Play and everything else open in the user's browser
            openExternally(uri);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            progress.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progress.setVisibility(View.GONE);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            progress.setVisibility(View.GONE);
            String server = server() == null ? "" : TextUtils.htmlEncode(server());
            String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    + "<style>body{font-family:sans-serif;padding:24px;color:#1d1b18;background:#fbf8f3;line-height:1.5}"
                    + "h1{font-size:20px;color:#2a3a8f}code{background:#eee;padding:2px 4px;border-radius:4px}</style></head><body>"
                    + "<h1>" + TextUtils.htmlEncode(getString(R.string.offline_title)) + "</h1>"
                    + "<p>" + TextUtils.htmlEncode(getString(R.string.offline_body)) + "</p>"
                    + "<p><code>" + server + "</code></p>"
                    + "<p>" + TextUtils.htmlEncode(getString(R.string.offline_hint)) + "</p></body></html>";
            view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}

package de.timefeed.terminal;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.app.admin.DevicePolicyManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.net.http.SslError;
import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.NfcAdapter;
import android.nfc.Tag;
import android.nfc.tech.Ndef;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Parcelable;
import android.os.Process;
import android.util.Log;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import org.json.JSONObject;

import java.nio.charset.Charset;
import java.util.Arrays;

/**
 * TimeFeed Terminal — Kiosk-WebView fuer https://timefeed.de/terminal
 *
 * - Vollbild/Immersive, Display bleibt an, Orientierung frei
 * - User-Agent-Suffix " TimeFeedTerminalApp/1.0" (Erkennung durch die Webseite)
 * - Nativer NFC-Reader (Foreground Dispatch) mit JS-Bruecke window.__tfNativeNfc
 * - Robust: Render-Prozess-Crash -> WebView neu, unbehandelte Exception ->
 *   Neustart via AlarmManager, 30-Minuten-Watchdog, optionales App-Pinning
 */
public class MainActivity extends Activity {

    private static final String TAG = "TimeFeedTerminal";
    private static final String START_URL = "https://timefeed.de/terminal";
    private static final String UA_SUFFIX = " TimeFeedTerminalApp/1.0";
    private static final int CAMERA_PERMISSION_REQUEST_CODE = 42;
    private static final long WATCHDOG_INTERVAL_MS = 30L * 60L * 1000L; // 30 Minuten

    private FrameLayout rootLayout;
    private WebView webView;
    private NfcAdapter nfcAdapter;
    private PermissionRequest pendingWebPermissionRequest;
    private final Handler watchdogHandler = new Handler(Looper.getMainLooper());

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            try {
                String url = (webView != null) ? webView.getUrl() : null;
                if (url == null || url.isEmpty() || "about:blank".equals(url)) {
                    Log.w(TAG, "Watchdog: WebView-URL leer/blank -> reload");
                    if (webView != null) {
                        webView.loadUrl(START_URL);
                    } else {
                        buildWebView();
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Watchdog-Fehler", e);
            }
            watchdogHandler.postDelayed(this, WATCHDOG_INTERVAL_MS);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        installCrashRestartHandler();

        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN,
                WindowManager.LayoutParams.FLAG_FULLSCREEN);
        // Display bleibt an (Kiosk-Terminal).
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        rootLayout = new FrameLayout(this);
        setContentView(rootLayout);

        buildWebView();

        // Kamera-Laufzeitberechtigung frueh anfragen, damit die Seite
        // spaeter ohne weiteren Dialog auf die Kamera zugreifen kann.
        if (checkSelfPermission(Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{Manifest.permission.CAMERA},
                    CAMERA_PERMISSION_REQUEST_CODE);
        }

        // NFC ist optional — kein Adapter vorhanden -> App laeuft normal weiter.
        nfcAdapter = NfcAdapter.getDefaultAdapter(this);

        // App-Pinning (Lock Task) nur, wenn per Device-Policy erlaubt;
        // sonst still weiterlaufen.
        startLockTaskIfPermitted();

        watchdogHandler.postDelayed(watchdog, WATCHDOG_INTERVAL_MS);
    }

    // ------------------------------------------------------------------
    // WebView-Aufbau (separat, damit er nach onRenderProcessGone
    // komplett neu erstellt werden kann)
    // ------------------------------------------------------------------

    private void buildWebView() {
        if (webView != null) {
            try {
                rootLayout.removeView(webView);
                webView.destroy();
            } catch (Exception e) {
                Log.e(TAG, "WebView-Abbau fehlgeschlagen", e);
            }
            webView = null;
        }

        webView = new WebView(this);
        rootLayout.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        // Hardening wie in der FotoFeed-Vorlage: kein Datei-/Content-Zugriff.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        // Medienwiedergabe (Kamera-Preview, Sounds) ohne Nutzer-Geste.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        // Daran erkennt die Webseite die native Terminal-App.
        s.setUserAgentString(s.getUserAgentString() + UA_SUFFIX);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(webView, false);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                // Kiosk: nur timefeed.de innerhalb der App laden,
                // alles andere ignorieren (kein Ausbruch aus dem Kiosk).
                if (host != null && (host.equals("timefeed.de")
                        || host.endsWith(".timefeed.de"))) {
                    return false;
                }
                return true;
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // Renderer abgestuerzt oder vom System beendet:
                // WebView komplett neu aufbauen statt App-Crash.
                Log.w(TAG, "Render-Prozess weg -> WebView neu aufbauen");
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        buildWebView();
                    }
                });
                return true; // Crash der App verhindern
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        handleWebPermissionRequest(request);
                    }
                });
            }
        });

        webView.loadUrl(START_URL);
    }

    // ------------------------------------------------------------------
    // Kamera-Berechtigung fuer die Webseite
    // ------------------------------------------------------------------

    private void handleWebPermissionRequest(PermissionRequest request) {
        boolean wantsVideo = false;
        for (String res : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(res)) {
                wantsVideo = true;
                break;
            }
        }
        if (!wantsVideo) {
            request.deny();
            return;
        }
        if (checkSelfPermission(Manifest.permission.CAMERA)
                == PackageManager.PERMISSION_GRANTED) {
            request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
        } else {
            // Erst die Runtime-Permission holen, dann dem WebView gewaehren.
            pendingWebPermissionRequest = request;
            requestPermissions(new String[]{Manifest.permission.CAMERA},
                    CAMERA_PERMISSION_REQUEST_CODE);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != CAMERA_PERMISSION_REQUEST_CODE) {
            return;
        }
        boolean granted = grantResults.length > 0
                && grantResults[0] == PackageManager.PERMISSION_GRANTED;
        if (pendingWebPermissionRequest != null) {
            try {
                if (granted) {
                    pendingWebPermissionRequest.grant(new String[]{
                            PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                } else {
                    pendingWebPermissionRequest.deny();
                }
            } catch (Exception e) {
                Log.e(TAG, "WebPermissionRequest-Antwort fehlgeschlagen", e);
            }
            pendingWebPermissionRequest = null;
        }
    }

    // ------------------------------------------------------------------
    // NFC (Foreground Dispatch)
    // ------------------------------------------------------------------

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        if (nfcAdapter != null) {
            try {
                Intent intent = new Intent(this, getClass())
                        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
                int flags = (Build.VERSION.SDK_INT >= 31)
                        ? PendingIntent.FLAG_MUTABLE : 0;
                PendingIntent pi = PendingIntent.getActivity(this, 0, intent, flags);
                // null/null = alle Tag-Typen an diese Activity dispatchen.
                nfcAdapter.enableForegroundDispatch(this, pi, null, null);
            } catch (Exception e) {
                Log.e(TAG, "NFC Foreground Dispatch fehlgeschlagen", e);
            }
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (nfcAdapter != null) {
            try {
                nfcAdapter.disableForegroundDispatch(this);
            } catch (Exception e) {
                Log.e(TAG, "NFC disableForegroundDispatch fehlgeschlagen", e);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleNfcIntent(intent);
    }

    private void handleNfcIntent(Intent intent) {
        if (intent == null) {
            return;
        }
        String action = intent.getAction();
        if (!NfcAdapter.ACTION_NDEF_DISCOVERED.equals(action)
                && !NfcAdapter.ACTION_TECH_DISCOVERED.equals(action)
                && !NfcAdapter.ACTION_TAG_DISCOVERED.equals(action)) {
            return;
        }

        Tag tag = intent.getParcelableExtra(NfcAdapter.EXTRA_TAG);
        String uid = (tag != null) ? bytesToHex(tag.getId()) : "";

        // (a) NDEF-URI-Record (FeedAuth-Hub-Chips: auth.feedapps.de/t/<TOKEN>),
        // (b) sonst NDEF-Text-Record (Alt-Chip = Stempel-Code), (c) sonst nur UID.
        String url = readNdefUri(intent, tag);
        String text = readNdefText(intent, tag);

        dispatchNfcToPage(url, text, uid);
    }

    private String readNdefText(Intent intent, Tag tag) {
        try {
            // 1. Bevorzugt: bereits geparste NDEF-Messages aus dem Intent.
            Parcelable[] raw = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
            if (raw != null) {
                for (Parcelable p : raw) {
                    String t = extractTextRecord((NdefMessage) p);
                    if (t != null) {
                        return t;
                    }
                }
            }
            // 2. Fallback: gecachte NDEF-Message direkt vom Tag.
            if (tag != null) {
                Ndef ndef = Ndef.get(tag);
                if (ndef != null) {
                    NdefMessage cached = ndef.getCachedNdefMessage();
                    if (cached != null) {
                        return extractTextRecord(cached);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "NDEF-Lesen fehlgeschlagen", e);
        }
        return null;
    }

    /** Liest den ersten URI-Record (Hub-Chip-URL). Parallel zu readNdefText. */
    private String readNdefUri(Intent intent, Tag tag) {
        try {
            Parcelable[] raw = intent.getParcelableArrayExtra(NfcAdapter.EXTRA_NDEF_MESSAGES);
            if (raw != null) {
                for (Parcelable p : raw) {
                    String u = extractUriRecord((NdefMessage) p);
                    if (u != null) {
                        return u;
                    }
                }
            }
            if (tag != null) {
                Ndef ndef = Ndef.get(tag);
                if (ndef != null) {
                    NdefMessage cached = ndef.getCachedNdefMessage();
                    if (cached != null) {
                        return extractUriRecord(cached);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "NDEF-URI-Lesen fehlgeschlagen", e);
        }
        return null;
    }

    /** Extrahiert den ersten URI-Record (RTD_URI oder TNF_ABSOLUTE_URI) einer Message. */
    private static String extractUriRecord(NdefMessage message) {
        if (message == null) {
            return null;
        }
        for (NdefRecord record : message.getRecords()) {
            try {
                // toUri() deckt Well-Known-URI (RTD_URI, inkl. Schema-Praefixbyte) und
                // absolute-URI-Records ab und liefert die vollstaendige URL zurueck.
                Uri uri = record.toUri();
                if (uri != null) {
                    String s = uri.toString();
                    if (s != null && !s.isEmpty()) {
                        return s;
                    }
                }
            } catch (Exception ignore) {
                // Kein URI-Record — naechsten pruefen.
            }
        }
        return null;
    }

    /** Extrahiert den ersten Well-Known-Text-Record (RTD_TEXT) einer Message. */
    private static String extractTextRecord(NdefMessage message) {
        if (message == null) {
            return null;
        }
        for (NdefRecord record : message.getRecords()) {
            if (record.getTnf() == NdefRecord.TNF_WELL_KNOWN
                    && Arrays.equals(record.getType(), NdefRecord.RTD_TEXT)) {
                byte[] payload = record.getPayload();
                if (payload == null || payload.length == 0) {
                    continue;
                }
                // Statusbyte: Bit 7 = Encoding, Bits 0..5 = Laenge Sprachcode.
                boolean utf16 = (payload[0] & 0x80) != 0;
                int langLength = payload[0] & 0x3F;
                if (1 + langLength > payload.length) {
                    continue;
                }
                Charset cs = Charset.forName(utf16 ? "UTF-16" : "UTF-8");
                return new String(payload, 1 + langLength,
                        payload.length - 1 - langLength, cs);
            }
        }
        return null;
    }

    /**
     * Uebergibt den NFC-Scan an die Seite.
     * Contract: window.__tfNativeNfc({"url": <string|null>, "text": <string|null>, "uid": <hex>})
     * url = NDEF-URI (Hub-Chip), text = NDEF-Text (Alt-Stempel-Code), uid = Tag-Seriennummer.
     */
    private void dispatchNfcToPage(String url, String text, String uid) {
        if (webView == null) {
            return;
        }
        try {
            JSONObject json = new JSONObject();
            json.put("url", url != null ? url : JSONObject.NULL);
            json.put("text", text != null ? text : JSONObject.NULL);
            json.put("uid", uid);
            webView.evaluateJavascript(
                    "window.__tfNativeNfc && window.__tfNativeNfc(" + json + ")", null);
        } catch (Exception e) {
            Log.e(TAG, "NFC-Dispatch an Seite fehlgeschlagen", e);
        }
    }

    /** UID als Hex, Grossbuchstaben, ohne Doppelpunkte (z. B. "04A2B3C4D5E680"). */
    private static String bytesToHex(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02X", b));
        }
        return sb.toString();
    }

    // ------------------------------------------------------------------
    // Kiosk / Robustheit
    // ------------------------------------------------------------------

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        decor.setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemUi();
        }
    }

    /** startLockTask nur, wenn Lock-Task fuer dieses Paket erlaubt ist. */
    private void startLockTaskIfPermitted() {
        try {
            DevicePolicyManager dpm =
                    (DevicePolicyManager) getSystemService(Context.DEVICE_POLICY_SERVICE);
            if (dpm != null && dpm.isLockTaskPermitted(getPackageName())) {
                startLockTask();
            }
        } catch (Exception e) {
            // Kein Device-Owner / nicht erlaubt -> still weiterlaufen.
            Log.i(TAG, "Lock-Task nicht verfuegbar: " + e.getMessage());
        }
    }

    /**
     * Unbehandelte Exceptions: App via AlarmManager in 2 Sekunden neu
     * starten und Prozess beenden (FotoFeed/Kiosk-Muster).
     */
    private void installCrashRestartHandler() {
        final Thread.UncaughtExceptionHandler previous =
                Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler(new Thread.UncaughtExceptionHandler() {
            @Override
            public void uncaughtException(Thread thread, Throwable throwable) {
                Log.e(TAG, "Unbehandelte Exception -> Neustart in 2s", throwable);
                try {
                    Intent intent = new Intent(getApplicationContext(), MainActivity.class);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                            | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                    int flags = PendingIntent.FLAG_CANCEL_CURRENT;
                    if (Build.VERSION.SDK_INT >= 31) {
                        flags |= PendingIntent.FLAG_IMMUTABLE;
                    }
                    PendingIntent restart = PendingIntent.getActivity(
                            getApplicationContext(), 1, intent, flags);
                    AlarmManager am = (AlarmManager) getSystemService(Context.ALARM_SERVICE);
                    if (am != null) {
                        am.set(AlarmManager.RTC,
                                System.currentTimeMillis() + 2000L, restart);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Neustart-Planung fehlgeschlagen", e);
                }
                Process.killProcess(Process.myPid());
                System.exit(2);
            }
        });
    }

    @Override
    protected void onDestroy() {
        watchdogHandler.removeCallbacks(watchdog);
        if (webView != null) {
            try {
                rootLayout.removeView(webView);
                webView.destroy();
            } catch (Exception ignored) {
            }
            webView = null;
        }
        super.onDestroy();
    }
}

# TimeFeed Terminal (Android-Kiosk-App)

Vollbild-Kiosk-WebView fuer `https://timefeed.de/terminal` mit nativem
NFC-Reader. Die Webseite erkennt die App am User-Agent-Suffix
`TimeFeedTerminalApp/1.0`.

## Build

```bash
./build.sh
```

Benoetigt: Android SDK unter `/opt/android-sdk` (build-tools 35.0.0,
platforms/android-35), JDK 17 (`javac`, `keytool`), Python 3 mit Pillow
(Icon-Generierung). Kein Gradle — der Build laeuft direkt ueber
aapt2 / javac / d8 / zipalign / apksigner.

Ergebnis:

- `TimeFeed-Terminal.apk` (hier im Ordner)
- Kopie in `/opt/TimeFeed/downloads/TimeFeed-Terminal.apk`

Der Release-Keystore `timefeed-terminal.keystore` wird beim ersten Build
erzeugt und danach wiederverwendet (gleiche Signatur => Updates ohne
Deinstallation moeglich). Keystore-Passwort steht als Variable in
`build.sh` (privates Repo). **Keystore nicht loeschen!**

## Installation auf dem Tablet

1. APK aufs Geraet bringen: `https://timefeed.de` bzw. aus
   `/opt/TimeFeed/downloads/TimeFeed-Terminal.apk` per USB/Download.
2. **Unbekannte Quellen erlauben:** Einstellungen → Apps →
   "Unbekannte Apps installieren" fuer den Browser/Dateimanager erlauben,
   dann APK antippen und installieren.
3. Beim ersten Start die **Kamera-Berechtigung** erlauben (fuer
   QR-Scan im Terminal). Ohne Kamera laeuft die App trotzdem.
4. **Akku-Optimierung deaktivieren:** Einstellungen → Apps →
   TimeFeed Terminal → Akku → "Nicht optimiert" / "Uneingeschraenkt".
   Sonst beendet Android die App im Dauerbetrieb.
5. **Autostart nach Boot:** Die App startet nach dem Neustart automatisch.
   Auf manchen Geraeten (Android 10+, Hersteller-Eigenheiten wie
   Xiaomi/Huawei) muss dafuer zusaetzlich "Autostart" bzw.
   "Ueber anderen Apps anzeigen" in den App-Einstellungen erlaubt werden.
6. **App-Pinning aktivieren** (empfohlen fuer Kiosk):
   Einstellungen → Sicherheit → "App-Pinning" (bzw. "Bildschirm anheften")
   einschalten, App oeffnen, in der App-Uebersicht das App-Icon antippen →
   "Anheften". Ist das Geraet per MDM/Device-Owner verwaltet und die App
   fuer Lock-Task freigegeben, pinnt sie sich automatisch selbst.
7. Display-Timeout ist egal — die App haelt das Display selbst an
   (`FLAG_KEEP_SCREEN_ON`).

## NFC-Chips beschreiben / zuordnen

Die App liest beim Auflegen eines Tags:

- **(a) NDEF-Text-Record**, falls vorhanden → als `text` an die Seite
- **(b) sonst die Tag-UID** (Hex, Grossbuchstaben, ohne Doppelpunkte,
  z. B. `04A1B2C3D4E580`) → als `uid`

Uebergabe an die Webseite (fixierter Contract):

```js
window.__tfNativeNfc({ "text": "<ndef-text-oder-null>", "uid": "<hex-uid>" })
```

Zwei Moeglichkeiten fuer Mitarbeiter-Chips:

1. **Text-Record beschreiben:** Mit einer NFC-Tools-App einen
   NDEF-Text-Record mit dem **Stempel-Code** des Mitarbeiters auf den
   Chip schreiben. Die Seite nutzt dann `text`.
2. **UID hinterlegen:** Chip unbeschrieben lassen und die UID des Chips
   beim Mitarbeiter im TimeFeed-Backend als `nfcTagUid` hinterlegen.
   Die UID laesst sich am einfachsten ermitteln, indem man den Chip am
   Terminal auflegt (oder mit einer NFC-Reader-App ausliest).

Geraete ohne NFC: Die App laeuft normal, nur ohne Chip-Funktion.

## Robustheit (eingebaut)

- Renderer-Crash (`onRenderProcessGone`) → WebView wird neu aufgebaut
- Unbehandelte Exception → automatischer App-Neustart nach 2 s (AlarmManager)
- Watchdog alle 30 min: leere URL / `about:blank` → Seite neu laden
- `BOOT_COMPLETED` → Autostart nach Geraete-Boot
- Lock-Task/App-Pinning wird genutzt, wenn per Device-Policy erlaubt

## Projektstruktur

```
AndroidManifest.xml            Manifest (Permissions, Receiver, Theme)
build.sh                       Reproduzierbarer Build (aapt2/javac/d8/apksigner)
src/de/timefeed/terminal/      MainActivity + BootReceiver
res/                           Strings, Farben (#EA580C), Theme, Icons
tools/gen_icons.py             Icon-Generierung aus client/public/icons/icon-512.png
timefeed-terminal.keystore     Release-Keystore (beim ersten Build erzeugt)
```

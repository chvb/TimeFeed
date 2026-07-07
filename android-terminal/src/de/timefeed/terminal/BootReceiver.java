package de.timefeed.terminal;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Startet das Terminal nach dem Geraete-Boot automatisch (Kiosk-Betrieb).
 *
 * Hinweis: Ab Android 10 kann der Start aus dem Hintergrund vom System
 * unterdrueckt werden, wenn die App nicht Device-Owner ist oder keine
 * "Ueber anderen Apps anzeigen"-Berechtigung hat. In dem Fall die App
 * einmal manuell starten bzw. die Berechtigung erteilen (siehe README).
 */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
            return;
        }
        try {
            Intent launch = new Intent(context, MainActivity.class);
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            context.startActivity(launch);
        } catch (Exception e) {
            Log.e("TimeFeedTerminal", "Autostart nach Boot fehlgeschlagen", e);
        }
    }
}

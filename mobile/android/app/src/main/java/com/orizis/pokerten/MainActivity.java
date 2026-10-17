package com.orizis.pokerten;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PokertenGoogleAuthPlugin.class);
        super.onCreate(savedInstanceState);
        hideSystemBars();
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge().getWebView().canGoBack()) {
                    getBridge().getWebView().goBack();
                    return;
                }
                new AlertDialog.Builder(MainActivity.this)
                    .setTitle("Leave POKERTEN?")
                    .setMessage("An active hand may continue while the app is closed.")
                    .setNegativeButton("Keep playing", null)
                    .setPositiveButton("Close app", (dialog, which) -> finish())
                    .show();
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        hideSystemBars();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            // Restore immersive mode after Google sign-in or a native dialog.
            hideSystemBars();
        }
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        );
        // Leave IME and Capacitor's keyboard/cutout inset handling intact.
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}

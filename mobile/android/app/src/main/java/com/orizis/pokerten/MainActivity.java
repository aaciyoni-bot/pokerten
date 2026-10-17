package com.orizis.pokerten;

import android.os.Bundle;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
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
}

package com.orizis.pokerten;

import android.app.Activity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.InstallStateUpdatedListener;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.InstallStatus;
import com.google.android.play.core.install.model.UpdateAvailability;

@CapacitorPlugin(name = "PokertenAppUpdate")
public class PokertenAppUpdatePlugin extends Plugin {
    private AppUpdateManager manager;
    private boolean safe = false, foreground = false, busy = false;
    private final InstallStateUpdatedListener listener = state -> {
        JSObject result = new JSObject();
        result.put("status", installStatus(state.installStatus()));
        notifyListeners("updateState", result);
        // Never install from a download callback: the player may now be seated.
    };
    @Override public void load() {
        manager = AppUpdateManagerFactory.create(getContext());
        manager.registerListener(listener);
        foreground = true;
    }
    private String installStatus(int status) {
        if (status == InstallStatus.DOWNLOADED) return "downloaded";
        if (status == InstallStatus.PENDING || status == InstallStatus.DOWNLOADING) return "downloading";
        if (status == InstallStatus.FAILED) return "error";
        if (status == InstallStatus.CANCELED) return "available";
        return "idle";
    }
    @PluginMethod public void setSafeContext(PluginCall call) {
        getActivity().runOnUiThread(() -> { safe = Boolean.TRUE.equals(call.getBoolean("safe", false)); call.resolve(); });
    }
    private boolean allowed(PluginCall call) {
        if (safe && foreground && !getActivity().isFinishing()) return true;
        call.reject("Update deferred until the player is safely in the lobby.", "update/playing");
        return false;
    }
    @PluginMethod public void check(PluginCall call) {
        getActivity().runOnUiThread(() -> manager.getAppUpdateInfo()
            .addOnSuccessListener(info -> {
                JSObject result = new JSObject();
                String status = installStatus(info.installStatus());
                if (status.equals("idle")) status = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE
                    ? (info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE) ? "available" : "unsupported") : "current";
                result.put("status", status); result.put("versionCode", info.availableVersionCode());
                call.resolve(result);
            }).addOnFailureListener(error -> call.reject("Google Play update check unavailable.", "update/unavailable")));
    }
    @PluginMethod public void startUpdate(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!allowed(call)) return;
            if (busy) { call.reject("Update already in progress.", "update/busy"); return; }
            busy = true;
            manager.getAppUpdateInfo().addOnSuccessListener(info -> {
                if (!allowed(call)) { busy = false; return; }
                if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE || !info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                    busy = false; call.reject("No in-app update available.", "update/unavailable"); return;
                }
                manager.startUpdateFlow(info, getActivity(), AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build())
                    .addOnSuccessListener(code -> {
                        busy = false; JSObject result = new JSObject();
                        result.put("accepted", code == Activity.RESULT_OK); call.resolve(result);
                    }).addOnFailureListener(error -> { busy = false; call.reject("Update did not start.", "update/unavailable"); });
            }).addOnFailureListener(error -> { busy = false; call.reject("Update check failed.", "update/unavailable"); });
        });
    }
    @Override protected void handleOnPause() { foreground = false; super.handleOnPause(); }
    @Override protected void handleOnResume() {
        super.handleOnResume(); foreground = true;
        notifyListeners("foreground", new JSObject());
    }
    @Override protected void handleOnDestroy() {
        safe = false; foreground = false;
        if (manager != null) manager.unregisterListener(listener);
        super.handleOnDestroy();
    }
}

package com.orizis.pokerten;

import android.content.MutableContextWrapper;
import android.os.CancellationSignal;
import androidx.core.content.ContextCompat;
import androidx.credentials.ClearCredentialStateRequest;
import androidx.credentials.Credential;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.CustomCredential;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.ClearCredentialException;
import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;

@CapacitorPlugin(name = "PokertenGoogleAuth")
public class PokertenGoogleAuthPlugin extends Plugin {
    private CancellationSignal pending;

    @PluginMethod
    public void signIn(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String clientId = getContext().getString(R.string.pokerten_google_web_client_id);
            if (clientId.isEmpty()) {
                call.reject("Google sign-in is not configured.", "native/not-configured");
                return;
            }
            if (pending != null) {
                call.reject("Sign-in is already open.", "native/busy");
                return;
            }
            CancellationSignal signal = new CancellationSignal();
            pending = signal;
            try {
                GetCredentialRequest request = new GetCredentialRequest.Builder()
                    .addCredentialOption(new GetSignInWithGoogleOption.Builder(clientId).build())
                    .build();
                CredentialManager.create(getContext()).getCredentialAsync(
                    new MutableContextWrapper(getActivity()), request, signal,
                    ContextCompat.getMainExecutor(getContext()),
                    new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                        @Override
                        public void onResult(GetCredentialResponse response) {
                            pending = null;
                            try {
                                Credential credential = response.getCredential();
                                if (!(credential instanceof CustomCredential) ||
                                    !GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL.equals(credential.getType())) {
                                    call.reject("Unexpected Google credential.", "native/unavailable");
                                    return;
                                }
                                String token = GoogleIdTokenCredential.createFrom(credential.getData()).getIdToken();
                                JSObject result = new JSObject();
                                result.put("idToken", token);
                                call.resolve(result);
                            } catch (Exception ignored) {
                                call.reject("Unable to read Google credential.", "native/unavailable");
                            }
                        }
                        @Override
                        public void onError(GetCredentialException error) {
                            pending = null;
                            call.reject("Google sign-in did not complete.",
                                error instanceof GetCredentialCancellationException ? "native/cancelled" : "native/unavailable");
                        }
                    });
            } catch (Exception ignored) {
                pending = null;
                call.reject("Unable to start Google sign-in.", "native/unavailable");
            }
        });
    }

    @PluginMethod
    public void clearSession(PluginCall call) {
        CredentialManager.create(getContext()).clearCredentialStateAsync(
            new ClearCredentialStateRequest(), null, ContextCompat.getMainExecutor(getContext()),
            new CredentialManagerCallback<Void, ClearCredentialException>() {
                @Override public void onResult(Void result) { call.resolve(); }
                @Override public void onError(ClearCredentialException error) {
                    call.reject("Unable to clear Google session.", "native/unavailable");
                }
            });
    }

    @Override
    protected void handleOnDestroy() {
        if (pending != null) pending.cancel();
        pending = null;
        super.handleOnDestroy();
    }
}

package com.alongside.firetv

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Bridges Fire TV remote presses into JavaScript.
 *
 * Focus on this screen is managed in JavaScript rather than by Android's focus
 * traversal. On a television that is the more predictable of the two: the
 * screens here show a handful of large choices in a deliberate order, and the
 * person holding the remote should never have to guess where the highlight
 * will land next.
 *
 * JavaScript can hand control back with `setEnabled(false)` — which it does
 * while a text field is open, so the on-screen keyboard behaves normally.
 */
class RemoteKeyModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun setEnabled(enabled: Boolean) {
    captureEnabled = enabled
  }

  /** Required by NativeEventEmitter on Android; no bookkeeping needed. */
  @ReactMethod
  fun addListener(eventName: String) = Unit

  @ReactMethod
  fun removeListeners(count: Int) = Unit

  companion object {
    const val NAME = "AlongsideRemoteKeys"

    @Volatile
    @JvmStatic
    var captureEnabled: Boolean = true

    @JvmStatic
    fun emit(context: ReactContext?, key: String) {
      context
        ?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("alongsideRemoteKey", key)
    }
  }
}

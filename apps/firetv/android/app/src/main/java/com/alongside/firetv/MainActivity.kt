package com.alongside.firetv

import android.view.KeyEvent
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "AlongsideTV"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Forward the directional pad, select, media and menu keys to JavaScript.
   *
   * BACK is deliberately not intercepted: it stays with React Native's own
   * BackHandler, so Back behaves the way it does in every other Fire TV app.
   * Key repeats are passed through as well, so holding a direction scrolls.
   */
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (RemoteKeyModule.captureEnabled && event.action == KeyEvent.ACTION_DOWN) {
      val name = when (event.keyCode) {
        KeyEvent.KEYCODE_DPAD_UP -> "up"
        KeyEvent.KEYCODE_DPAD_DOWN -> "down"
        KeyEvent.KEYCODE_DPAD_LEFT -> "left"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
        KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "select"
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "playpause"
        KeyEvent.KEYCODE_MENU -> "menu"
        KeyEvent.KEYCODE_MEDIA_REWIND -> "rewind"
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "forward"
        else -> null
      }
      if (name != null) {
        val context = (application as ReactApplication).reactNativeHost.reactInstanceManager.currentReactContext
        RemoteKeyModule.emit(context, name)
        return true
      }
    }
    return super.dispatchKeyEvent(event)
  }
}

package com.webmux.desktop

import android.graphics.Color
import android.os.Bundle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Edge-to-edge lets the WebView draw under the status bar, and the
    // WebView does not expose that region via env(safe-area-inset-top), so
    // web content overlapped the clock/battery. Pad the content view by the
    // status-bar/cutout inset instead; the strip behind the status bar shows
    // the content background, matched to the app's bg0 color.
    val content = findViewById<android.view.View>(android.R.id.content)
    content.setBackgroundColor(Color.parseColor("#0b0c0f"))
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val top = insets.getInsets(
        WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()
      ).top
      view.setPadding(view.paddingLeft, top, view.paddingRight, view.paddingBottom)
      insets
    }
  }
}

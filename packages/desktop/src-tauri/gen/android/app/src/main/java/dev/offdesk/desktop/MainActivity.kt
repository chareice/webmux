package dev.offdesk.desktop

import android.graphics.Color
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    // The app chrome is always dark regardless of the system theme, so force
    // light (white) system-bar icons; the default auto style picks dark icons
    // under a light system theme, unreadable on the dark strip we paint.
    enableEdgeToEdge(
      statusBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
      navigationBarStyle = SystemBarStyle.dark(Color.TRANSPARENT),
    )
    super.onCreate(savedInstanceState)

    // Edge-to-edge lets the WebView draw under the status bar, and the
    // WebView does not expose that region via env(safe-area-inset-top), so
    // web content overlapped the clock/battery. Pad the content view by the
    // status-bar/cutout inset instead; the strip behind the status bar shows
    // the content background, matched to the app's bg0 color.
    //
    // Same for the soft keyboard: under edge-to-edge Android no longer
    // resizes the window for the IME, so the WebView stayed full-height
    // behind the keyboard and Chromium fell back to visual-viewport panning
    // to chase the caret. xterm moves its hidden textarea to the cursor cell
    // on every render, so busy TUIs (Cursor spinners/status lines) made the
    // page scroll frantically while typing. Padding the content view by the
    // IME inset genuinely shrinks the WebView instead — the layout viewport
    // resizes and there is nothing left to pan.
    val content = findViewById<android.view.View>(android.R.id.content)
    content.setBackgroundColor(Color.parseColor("#0b0c0f"))
    ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
      val top = insets.getInsets(
        WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()
      ).top
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      view.setPadding(view.paddingLeft, top, view.paddingRight, ime)
      insets
    }
  }
}

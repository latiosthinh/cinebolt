package com.cinebolt.tv

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import com.cinebolt.tv.backend.EmbeddedServer

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Start embedded VietStream server before WebView loads
        EmbeddedServer.start()

        webView = WebView(this).apply {
            @Suppress("deprecation")
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                mediaPlaybackRequiresUserGesture = false
                allowFileAccess = true
                allowContentAccess = true
                useWideViewPort = true
                loadWithOverviewMode = true
                setSupportZoom(false)
                builtInZoomControls = false
            }

            webViewClient = object : WebViewClient() {
                @Suppress("deprecation")
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return false
                }
            }

            webChromeClient = WebChromeClient()

            // The page keeps its search field keyboard-less while the remote moves over it; pressing OK asks for the keyboard here.
            addJavascriptInterface(object {
                @JavascriptInterface
                fun showKeyboard() {
                    post {
                        getSystemService(InputMethodManager::class.java).showSoftInput(this@apply, InputMethodManager.SHOW_IMPLICIT)
                    }
                }
            }, "CineBolt")

            // Same colour as the page and splash, so there is no white frame before the first paint.
            setBackgroundColor(0xFF07080B.toInt())

            isFocusable = true
            isFocusableInTouchMode = true
            requestFocus()

            // Let the system lower the renderer's priority (and reclaim it first) while the app is not visible.
            setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true)

            loadUrl("file:///android_asset/index.html?api=" + Uri.encode(apiBase()))
        }

        setContentView(webView)
    }

    /**
     * Backend address: `--es api <url>` launch extra for debugging against external server,
     * otherwise defaults to the embedded server on every device.
     */
    private fun apiBase(): String {
        val prefs = getSharedPreferences("cinebolt", MODE_PRIVATE)
        prefs.edit().remove("api").apply()

        intent?.getStringExtra("api")?.trim()?.trimEnd('/')?.takeIf { it.matches(Regex("^https?://[^/]+$")) }?.let {
            return it
        }
        return EmbeddedServer.url
    }

    // Leaving the app (Home, another app, screen off) must not keep decoding video, downloading
    // segments or running page timers in the background.
    override fun onPause() {
        webView.evaluateJavascript("(function(){var v=document.getElementById('video');if(v)v.pause();})()", null)
        webView.onPause()
        webView.pauseTimers()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView.resumeTimers()
        webView.onResume()
    }

    override fun onDestroy() {
        webView.loadUrl("about:blank")
        webView.destroy()
        if (isFinishing) {
            EmbeddedServer.stop()
        }
        super.onDestroy()
    }

    // The WebView consumes OK on a keyboard-less (inputmode=none) field without telling the page, so announce it first.
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 &&
            (event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER || event.keyCode == KeyEvent.KEYCODE_ENTER)
        ) webView.evaluateJavascript("window.cineBoltOk&&cineBoltOk()", null)
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP,
            KeyEvent.KEYCODE_DPAD_DOWN,
            KeyEvent.KEYCODE_DPAD_LEFT,
            KeyEvent.KEYCODE_DPAD_RIGHT,
            KeyEvent.KEYCODE_DPAD_CENTER,
            KeyEvent.KEYCODE_ENTER,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_CHANNEL_UP,
            KeyEvent.KEYCODE_CHANNEL_DOWN,
            KeyEvent.KEYCODE_BACK -> {
                val js = when (keyCode) {
                    KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
                    KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
                    KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
                    KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
                    KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> "Enter"
                    KeyEvent.KEYCODE_BACK -> "Escape"
                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "MediaPlayPause"
                    KeyEvent.KEYCODE_MEDIA_PLAY -> "MediaPlay"
                    KeyEvent.KEYCODE_MEDIA_PAUSE -> "MediaPause"
                    KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "MediaFastForward"
                    KeyEvent.KEYCODE_MEDIA_REWIND -> "MediaRewind"
                    KeyEvent.KEYCODE_CHANNEL_UP -> "ChannelUp"
                    KeyEvent.KEYCODE_CHANNEL_DOWN -> "ChannelDown"
                    else -> null
                }
                if (js != null && event.action == KeyEvent.ACTION_DOWN) {
                    // Let the WebView deliver directional/typing events to the focused input.
                    // Android Back does not arrive as a browser Escape event.
                    if (keyCode != KeyEvent.KEYCODE_BACK && !js.startsWith("Media") && !js.startsWith("Channel")) return super.onKeyDown(keyCode, event)
                    webView.evaluateJavascript(
                        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'$js',bubbles:true}))", null
                    )
                }
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }
}

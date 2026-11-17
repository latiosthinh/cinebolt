package com.cinebolt.tv.backend

import okhttp3.Request
import okhttp3.Response
import java.io.InputStream
import java.net.URI
import java.net.URL

object HlsProxy {

    fun proxify(base: String, target: String, ref: String, origin: String, isManifest: Boolean): String {
        return "$base/hls/${if (isManifest) "manifest.m3u8" else "seg"}?url=${Utils.b64e(target)}&ref=${Utils.b64e(ref)}&origin=${Utils.b64e(origin)}"
    }

    fun resolveUrl(base: String, u: String): String? {
        return try {
            val baseUri = URI(base)
            baseUri.resolve(u).toString()
        } catch (_: Exception) {
            try {
                URL(URL(base), u).toString()
            } catch (_: Exception) {
                null
            }
        }
    }

    fun rewriteM3u8(text: String, targetUrl: String, ref: String, origin: String, base: String): String {
        val lines = text.split('\n')
        val sb = StringBuilder()
        for (i in lines.indices) {
            val line = lines[i]
            val t = line.trim()
            if (t.isEmpty()) {
                sb.append(line)
            } else if (t.startsWith("#")) {
                val replaced = Regex("URI=\"([^\"]+)\"").replace(line) { mr ->
                    val uri = mr.groupValues[1]
                    val abs = resolveUrl(targetUrl, uri)
                    if (abs != null) {
                        val isManifest = Regex("\\.m3u8(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(uri)
                        "URI=\"${proxify(base, abs, ref, origin, isManifest)}\""
                    } else {
                        mr.value
                    }
                }
                sb.append(replaced)
            } else {
                val abs = resolveUrl(targetUrl, t)
                if (abs != null) {
                    val isManifest = Regex("\\.m3u8(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(t)
                    sb.append(proxify(base, abs, ref, origin, isManifest))
                } else {
                    sb.append(line)
                }
            }
            if (i < lines.size - 1) sb.append('\n')
        }
        return sb.toString()
    }

    fun fetchUpstream(target: String, ref: String?, origin: String?, range: String?): Response {
        val reqBuilder = Request.Builder().url(target)
        reqBuilder.header("User-Agent", Config.USER_AGENT)
        reqBuilder.header("Accept", "*/*")
        if (!ref.isNullOrEmpty()) reqBuilder.header("Referer", ref)
        if (!origin.isNullOrEmpty()) reqBuilder.header("Origin", origin)
        if (!range.isNullOrEmpty()) reqBuilder.header("Range", range)
        return Utils.httpClient.newCall(reqBuilder.build()).execute()
    }
}

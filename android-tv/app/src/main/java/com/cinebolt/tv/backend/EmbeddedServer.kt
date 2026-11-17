package com.cinebolt.tv.backend

import fi.iki.elonen.NanoHTTPD
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.net.ServerSocket

class EmbeddedServer private constructor(port: Int) : NanoHTTPD("127.0.0.1", port) {

    private val router = Router { baseUrl }

    val baseUrl: String
        get() = "http://127.0.0.1:$listeningPort"

    private class CustomStatus(private val code: Int, private val desc: String) : Response.IStatus {
        override fun getRequestStatus(): Int = code
        override fun getDescription(): String = "$code $desc"
    }

    private fun addCors(response: Response): Response {
        response.addHeader("Access-Control-Allow-Origin", "*")
        response.addHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        response.addHeader("Access-Control-Allow-Headers", "*")
        return response
    }

    private fun jsonResponse(jsonString: String, status: Response.IStatus = Response.Status.OK): Response {
        val res = newFixedLengthResponse(status, "application/json; charset=utf-8", jsonString)
        res.addHeader("Cache-Control", "no-cache")
        return addCors(res)
    }

    override fun serve(session: IHTTPSession): Response {
        val method = session.method
        if (method == Method.OPTIONS) {
            val res = newFixedLengthResponse(Response.Status.NO_CONTENT, MIME_PLAINTEXT, "")
            return addCors(res)
        }

        val uri = session.uri
        val queryParams = mutableMapOf<String, String>()
        for ((k, vList) in session.parameters) {
            if (vList.isNotEmpty()) queryParams[k] = vList[0]
        }

        try {
            when {
                uri == "/manifest.json" -> {
                    return jsonResponse(router.buildManifest(baseUrl).toString())
                }

                uri == "/logo.svg" -> {
                    val svg = """<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
                      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0" stop-color="#ff4d4d"/><stop offset="1" stop-color="#ffb347"/>
                      </linearGradient></defs>
                      <rect width="256" height="256" rx="52" fill="#12141c"/>
                      <circle cx="128" cy="128" r="74" fill="url(#g)"/>
                      <path d="M108 92 L172 128 L108 164 Z" fill="#12141c"/>
                    </svg>""".trimIndent()
                    val res = newFixedLengthResponse(Response.Status.OK, "image/svg+xml", svg)
                    return addCors(res)
                }

                uri == "/" -> {
                    val rows = router.providers.values.joinToString("") {
                        "<li><b>${it.name}</b> <code>${it.cfg.apiUrl}</code>${if (it.cfg.proxy) " (qua proxy)" else ""}</li>"
                    }
                    val html = """<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>VietStream Addon</title>
                     <style>body{font-family:system-ui;background:#12141c;color:#eee;max-width:680px;margin:48px auto;padding:0 16px}
                     a{color:#ffb347}code{background:#1e2230;padding:2px 6px;border-radius:6px}</style></head><body>
                     <h1>🎬 VietStream — Addon phim Việt cho Nuvio / Stremio</h1>
                     <p>Cài addon bằng manifest URL:</p>
                     <p><code>$baseUrl/manifest.json</code></p>
                     <h3>Nguồn đang bật</h3><ul>$rows</ul>
                     </body></html>""".trimIndent()
                    val res = newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", html)
                    return addCors(res)
                }

                uri.startsWith("/catalog/") -> {
                    val parts = uri.removePrefix("/").split('/')
                    if (parts.size >= 3) {
                        val type = parts[1]
                        val id = parts[2]
                        val extra = if (parts.size > 3) parts.subList(3, parts.size).joinToString("/") else null
                        val json = router.handleCatalog(type, id, extra, queryParams)
                        return jsonResponse(json.toString())
                    }
                }

                uri.startsWith("/meta/") -> {
                    val parts = uri.removePrefix("/").split('/')
                    if (parts.size >= 3) {
                        val type = parts[1]
                        val id = parts[2]
                        val json = router.handleMeta(type, id)
                        if (json != null) {
                            return jsonResponse(json.toString())
                        }
                    }
                    return jsonResponse("{\"err\":\"not found\"}", Response.Status.NOT_FOUND)
                }

                uri.startsWith("/stream/") -> {
                    val parts = uri.removePrefix("/").split('/')
                    if (parts.size >= 3) {
                        val type = parts[1]
                        val id = parts[2]
                        val json = router.handleStream(type, id, baseUrl)
                        return jsonResponse(json.toString())
                    }
                    return jsonResponse("{\"err\":\"not found\"}", Response.Status.NOT_FOUND)
                }

                uri == "/hls/manifest.m3u8" -> {
                    val target = Utils.b64d(queryParams["url"])
                    val ref = Utils.b64d(queryParams["ref"])
                    val origin = Utils.b64d(queryParams["origin"])
                    if (!Regex("^https?:", RegexOption.IGNORE_CASE).containsMatchIn(target)) {
                        return addCors(newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "bad url"))
                    }
                    val range = session.headers["range"]
                    val up = HlsProxy.fetchUpstream(target, ref, origin, range)
                    val ct = up.header("content-type") ?: "application/vnd.apple.mpegurl"
                    val text = up.body?.string() ?: ""
                    if (!text.trim().startsWith("#EXTM3U")) {
                        val status = Response.Status.lookup(up.code) ?: CustomStatus(up.code, up.message)
                        val res = newFixedLengthResponse(status, ct, text)
                        return addCors(res)
                    }
                    val rewritten = HlsProxy.rewriteM3u8(text, up.request.url.toString(), ref, origin, baseUrl)
                    val res = newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl", rewritten)
                    res.addHeader("Cache-Control", "no-cache")
                    return addCors(res)
                }

                uri == "/hls/seg" -> {
                    val target = Utils.b64d(queryParams["url"])
                    val ref = Utils.b64d(queryParams["ref"])
                    val origin = Utils.b64d(queryParams["origin"])
                    if (!Regex("^https?:", RegexOption.IGNORE_CASE).containsMatchIn(target)) {
                        return addCors(newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "bad url"))
                    }
                    val range = session.headers["range"]
                    val up = HlsProxy.fetchUpstream(target, ref, origin, range)
                    val ct = up.header("content-type") ?: ""
                    if (Regex("mpegurl", RegexOption.IGNORE_CASE).containsMatchIn(ct) ||
                        Regex("\\.m3u8(\\?|$)", RegexOption.IGNORE_CASE).containsMatchIn(target)
                    ) {
                        val text = up.body?.string() ?: ""
                        val rewritten = HlsProxy.rewriteM3u8(text, up.request.url.toString(), ref, origin, baseUrl)
                        val res = newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl", rewritten)
                        res.addHeader("Cache-Control", "no-cache")
                        return addCors(res)
                    }

                    val body = up.body
                    val bodyStream: InputStream = body?.byteStream() ?: ByteArrayInputStream(ByteArray(0))
                    val contentLength = body?.contentLength() ?: -1L
                    val mimeType = if (ct.isNotBlank()) ct else "video/MP2T"
                    val status = Response.Status.lookup(up.code) ?: CustomStatus(up.code, up.message)

                    val res = if (contentLength >= 0) {
                        newFixedLengthResponse(status, mimeType, bodyStream, contentLength)
                    } else {
                        newChunkedResponse(status, mimeType, bodyStream)
                    }

                    for (h in listOf("content-range", "accept-ranges")) {
                        val v = up.header(h)
                        if (!v.isNullOrBlank()) res.addHeader(h, v)
                    }
                    res.addHeader("Cache-Control", "no-cache")
                    return addCors(res)
                }
            }
        } catch (e: Exception) {
            val errJson = JSONObject().apply { put("err", e.message ?: "server error") }
            return jsonResponse(errJson.toString(), Response.Status.INTERNAL_ERROR)
        }

        return jsonResponse("{\"err\":\"not found\"}", Response.Status.NOT_FOUND)
    }

    companion object {
        @Volatile
        private var instance: EmbeddedServer? = null

        val port: Int
            get() = instance?.listeningPort ?: Config.DEFAULT_PORT

        val url: String
            get() = instance?.baseUrl ?: "http://127.0.0.1:$port"

        fun start(preferredPort: Int = Config.DEFAULT_PORT): EmbeddedServer {
            instance?.let {
                if (it.isAlive) return it
            }
            synchronized(this) {
                instance?.let {
                    if (it.isAlive) return it
                }
                var selectedPort = preferredPort
                // Try preferred port, then increment if taken
                for (p in preferredPort..(preferredPort + 10)) {
                    if (isPortAvailable(p)) {
                        selectedPort = p
                        break
                    }
                }
                val server = EmbeddedServer(selectedPort)
                server.start(SOCKET_READ_TIMEOUT, false)
                instance = server
                return server
            }
        }

        fun stop() {
            synchronized(this) {
                instance?.stop()
                instance = null
            }
        }

        private fun isPortAvailable(port: Int): Boolean {
            return try {
                ServerSocket(port, 1, java.net.InetAddress.getByName("127.0.0.1")).use { true }
            } catch (_: Exception) {
                false
            }
        }
    }
}

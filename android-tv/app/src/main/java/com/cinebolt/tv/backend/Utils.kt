package com.cinebolt.tv.backend

import okhttp3.Headers
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.net.URL
import java.text.Normalizer
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit

object Utils {
    val httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(Config.TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .readTimeout(Config.TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .writeTimeout(Config.TIMEOUT_MS, TimeUnit.MILLISECONDS)
        .followRedirects(true)
        .followSslRedirects(true)
        .build()

    fun clientWithTimeout(timeoutMs: Long): OkHttpClient {
        return if (timeoutMs == Config.TIMEOUT_MS) httpClient
        else httpClient.newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .build()
    }

    fun getText(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Long = Config.TIMEOUT_MS): String? {
        return try {
            val reqBuilder = Request.Builder().url(url)
            reqBuilder.header("User-Agent", Config.USER_AGENT)
            for ((k, v) in headers) {
                reqBuilder.header(k, v)
            }
            clientWithTimeout(timeoutMs).newCall(reqBuilder.build()).execute().use { response ->
                if (!response.isSuccessful) null else response.body?.string()
            }
        } catch (_: Exception) {
            null
        }
    }

    fun getJson(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Long = Config.TIMEOUT_MS): Any? {
        val text = getText(
            url,
            mapOf("Accept" to "application/json, text/plain, */*") + headers,
            timeoutMs
        ) ?: return null
        return try {
            JSONTokener(text).nextValue()
        } catch (_: Exception) {
            null
        }
    }

    fun getJsonObject(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Long = Config.TIMEOUT_MS): JSONObject? {
        return getJson(url, headers, timeoutMs) as? JSONObject
    }

    fun getJsonArray(url: String, headers: Map<String, String> = emptyMap(), timeoutMs: Long = Config.TIMEOUT_MS): JSONArray? {
        return getJson(url, headers, timeoutMs) as? JSONArray
    }

    fun normTitle(str: String?): String {
        if (str.isNullOrBlank()) return ""
        val lower = str.lowercase(Locale.ROOT)
        val normalized = Normalizer.normalize(lower, Normalizer.Form.NFD)
        val noMarks = normalized.replace(Regex("[\\u0300-\\u036f]"), "")
        return noMarks.replace('đ', 'd').replace('Đ', 'd')
            .replace(Regex("[^a-z0-9]+"), " ")
            .trim()
    }

    fun stripHtml(str: String?): String {
        if (str.isNullOrBlank()) return ""
        return str.replace(Regex("<[^>]*>?"), "").replace(Regex("\\s+"), " ").trim()
    }

    fun parseEpNum(v: Any?): Int? {
        val s = v?.toString() ?: return null
        val m = Regex("\\d+").find(s) ?: return null
        return m.value.toIntOrNull()
    }

    fun detectAudio(text: String?, fallback: String = "Vietsub"): String {
        val s = text?.lowercase(Locale.ROOT) ?: return fallback
        if (s.isEmpty()) return fallback
        if (Regex("song\\s*ng[ữu]").containsMatchIn(s)) return "Song Ngữ"
        if (Regex("thuy[ếe]t\\s*minh|\\btm\\b").containsMatchIn(s)) return "Thuyết Minh"
        if (Regex("l[ồo]ng\\s*ti[ếe]ng").containsMatchIn(s)) return "Lồng Tiếng"
        if (Regex("vietsub|ph[ụu]\\s*[dđ][êe]|\\bvs\\b").containsMatchIn(s)) return "Vietsub"
        return fallback
    }

    fun audioKey(audio: String?): String {
        val a = audio ?: "vietsub"
        val normalized = Normalizer.normalize(a, Normalizer.Form.NFD)
        val noMarks = normalized.replace(Regex("\\p{InCombiningDiacriticalMarks}+"), "")
        return noMarks.lowercase(Locale.ROOT).replace(Regex("[^a-z0-9]+"), "")
    }

    fun qualityFromText(text: String?, fallback: String?): String? {
        val s = text ?: return fallback
        if (Regex("2160|4k", RegexOption.IGNORE_CASE).containsMatchIn(s)) return "4K"
        val m = Regex("(\\d{3,4})p", RegexOption.IGNORE_CASE).find(s)
        if (m != null) return "${m.groupValues[1]}p"
        return fallback
    }

    fun mapImageUrl(url: String?, cdn: String?): String? {
        if (url.isNullOrBlank()) return null
        val u = url.trim()
        if (u.isEmpty()) return null
        if (u.startsWith("//")) return "https:$u"
        if (Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(u)) {
            return u.replace(Regex("^http://", RegexOption.IGNORE_CASE), "https://")
        }
        val cdnTrim = cdn?.trimEnd('/') ?: return null
        val pathTrim = u.trimStart('/')
        return "$cdnTrim/$pathTrim"
    }

    fun extractUrlParam(embedUrl: String?): String? {
        if (embedUrl.isNullOrBlank()) return null
        return try {
            val u = URL(embedUrl)
            val query = u.query ?: return null
            val pairs = query.split('&')
            for (pair in pairs) {
                val idx = pair.indexOf('=')
                if (idx > 0) {
                    val key = pair.substring(0, idx)
                    val rawVal = pair.substring(idx + 1)
                    val value = java.net.URLDecoder.decode(rawVal, "UTF-8")
                    if ((key == "url" || key == "v" || key == "id") &&
                        Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(value)
                    ) {
                        return value
                    }
                }
            }
            null
        } catch (_: Exception) {
            null
        }
    }

    fun m3u8FromText(text: String?): String? {
        val s = text ?: return null
        val m = Regex("https?://[^\\s\"'<\\\\]+?\\.m3u8[^\\s\"'<\\\\]*", RegexOption.IGNORE_CASE).find(s)
        return m?.value
    }

    fun b64e(s: String?): String {
        val bytes = (s ?: "").toByteArray(Charsets.UTF_8)
        return java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    fun b64d(s: String?): String {
        return try {
            val bytes = java.util.Base64.getUrlDecoder().decode(s ?: "")
            String(bytes, Charsets.UTF_8)
        } catch (_: Exception) {
            ""
        }
    }

    private data class CacheEntry(val value: Any, val exp: Long)
    private val cacheMap = ConcurrentHashMap<String, CacheEntry>()

    @Suppress("UNCHECKED_CAST")
    fun <T> cached(key: String, ttlMs: Long, supplier: () -> T?): T? {
        val now = System.currentTimeMillis()
        val hit = cacheMap[key]
        if (hit != null && hit.exp > now) {
            return hit.value as T
        }
        val fresh = supplier() ?: return null
        if (cacheMap.size > 800) {
            val it = cacheMap.entries.iterator()
            while (it.hasNext()) {
                if (it.next().value.exp <= now) it.remove()
            }
        }
        cacheMap[key] = CacheEntry(fresh as Any, System.currentTimeMillis() + ttlMs)
        return fresh
    }
}

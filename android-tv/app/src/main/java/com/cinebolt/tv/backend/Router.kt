package com.cinebolt.tv.backend

import com.cinebolt.tv.backend.providers.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLDecoder

class Router(val baseUrlProvider: () -> String) {

    val providers: Map<String, BaseProvider> = mapOf(
        "kkphim" to KkphimProvider(Config.PROVIDERS["kkphim"]!!),
        "ophim" to OphimProvider(Config.PROVIDERS["ophim"]!!),
        "nguonc" to NguoncProvider(Config.PROVIDERS["nguonc"]!!),
        "vnstream" to VnstreamProvider(Config.PROVIDERS["vnstream"]!!),
        "phim4k" to Phim4kProvider(Config.PROVIDERS["phim4k"]!!),
        "tophim" to TophimProvider(Config.PROVIDERS["tophim"]!!),
        "k20" to K20Provider(Config.PROVIDERS["k20"]!!)
    )

    data class ParsedId(
        val provider: BaseProvider? = null,
        val slug: String? = null,
        val imdbId: String? = null,
        val season: Int = 1,
        val episode: Int = 1
    )

    fun parseId(id: String): ParsedId? {
        val cleanId = id.removeSuffix(".json")
        val parts = cleanId.split(':').filter { it.isNotEmpty() }
        val head = parts.getOrNull(0) ?: return null
        val season = parts.getOrNull(1)?.toIntOrNull() ?: 1
        val episode = parts.getOrNull(2)?.toIntOrNull() ?: 1

        if (Regex("^tt\\d+").containsMatchIn(head)) {
            return ParsedId(imdbId = head, season = season, episode = episode)
        }
        for (p in providers.values) {
            if (head.startsWith(p.prefix)) {
                return ParsedId(
                    provider = p,
                    slug = head.substring(p.prefix.length),
                    season = season,
                    episode = episode
                )
            }
        }
        return null
    }

    fun parseExtra(str: String?): Map<String, String> {
        if (str.isNullOrBlank()) return emptyMap()
        val extra = mutableMapOf<String, String>()
        val clean = str.replace(Regex("\\.json$", RegexOption.IGNORE_CASE), "")
        val pairs = clean.split('&').filter { it.isNotEmpty() }
        for (pair in pairs) {
            val idx = pair.indexOf('=')
            if (idx >= 0) {
                val k = URLDecoder.decode(pair.substring(0, idx), "UTF-8")
                val v = URLDecoder.decode(pair.substring(idx + 1), "UTF-8")
                if (k in listOf("search", "genre", "country", "sort", "skip")) {
                    extra[k] = v
                }
            }
        }
        return extra
    }

    private fun shouldProxy(providerId: String?): Boolean {
        if (providerId == null) return false
        val cfg = Config.PROVIDERS[providerId] ?: return false
        if (!cfg.proxy) return false
        val list = Config.proxyProviders
        if (list.contains("none")) return false
        return list.contains("*") || list.contains(providerId)
    }

    private fun wrapProxy(stream: StreamItem, baseUrl: String): StreamItem {
        val pid = stream.providerId
        val sUrl = stream.url
        if (sUrl != null && shouldProxy(pid)) {
            val proxyHeaders = stream.behaviorHints.optJSONObject("proxyHeaders")
            val reqHeaders = proxyHeaders?.optJSONObject("request")
            val ref = reqHeaders?.optString("Referer", "") ?: ""
            val origin = reqHeaders?.optString("Origin", "") ?: ""
            stream.url = "$baseUrl/hls/manifest.m3u8?url=${Utils.b64e(sUrl)}&ref=${Utils.b64e(ref)}&origin=${Utils.b64e(origin)}"
        }
        return stream
    }

    private fun dedupe(streams: List<StreamItem>): List<StreamItem> {
        val seen = mutableSetOf<String>()
        return streams.filter { s ->
            val k = s.url ?: s.externalUrl
            if (k.isNullOrBlank() || !seen.add(k)) false else true
        }
    }

    fun buildManifest(baseUrl: String): JSONObject {
        val catalogs = JSONArray()
        val defs = listOf(
            // kkphim
            Triple("kkphim-phim-le", "Phim lẻ (KKphim)", true) to "movie",
            Triple("kkphim-chieu-rap", "Chiếu rạp (KKphim)", true) to "movie",
            Triple("kkphim-phim-bo", "Phim bộ (KKphim)", true) to "series",
            Triple("kkphim-hoat-hinh", "Hoạt hình (KKphim)", true) to "series",
            // ophim
            Triple("ophim-phim-le", "Phim lẻ (OPhim)", false) to "movie",
            Triple("ophim-phim-bo", "Phim bộ (OPhim)", false) to "series",
            // nguonc
            Triple("nguonc-phim-le", "Phim lẻ (NguonC)", false) to "movie",
            Triple("nguonc-phim-bo", "Phim bộ (NguonC)", false) to "series",
            // vnstream
            Triple("vnstream-moi", "Mới nhất (VnStream)", false) to "movie",
            Triple("vnstream-hanh-dong", "Hành động (VnStream)", false) to "movie",
            Triple("vnstream-bo", "Phim bộ (VnStream)", false) to "series",
            // phim4k
            Triple("phim4k-phim-le", "Phim lẻ 4K (Phim4K)", false) to "movie",
            Triple("phim4k-phim-bo", "Phim bộ 4K (Phim4K)", false) to "series",
            // k20
            Triple("k20-movie", "Phim lẻ đa nguồn (K20)", false) to "movie",
            Triple("k20-series", "Phim bộ đa nguồn (K20)", false) to "series"
        )

        for ((triple, type) in defs) {
            val (id, name, hasGenres) = triple
            val catObj = JSONObject().apply {
                put("type", type)
                put("id", id)
                put("name", name)
                val extraArr = JSONArray()
                if (hasGenres) {
                    val genreOptions = JSONArray()
                    KkphimProvider.GENRE_MAP.keys.forEach { genreOptions.put(it) }
                    extraArr.put(JSONObject().apply {
                        put("name", "genre")
                        put("options", genreOptions)
                    })
                    val countryOptions = JSONArray()
                    KkphimProvider.COUNTRY_ORDER.forEach { countryOptions.put(it) }
                    extraArr.put(JSONObject().apply {
                        put("name", "country")
                        put("options", countryOptions)
                    })
                    val sortOptions = JSONArray().apply {
                        put("year_desc")
                        put("year_asc")
                    }
                    extraArr.put(JSONObject().apply {
                        put("name", "sort")
                        put("options", sortOptions)
                    })
                }
                extraArr.put(JSONObject().apply { put("name", "search") })
                extraArr.put(JSONObject().apply { put("name", "skip") })
                put("extra", extraArr)
            }
            catalogs.put(catObj)
        }

        val onProviders = providers.values.toList()
        val prefixes = onProviders.map { it.prefix }
        val allPrefixes = listOf("tt") + prefixes

        val resources = JSONArray().apply {
            put(JSONObject().apply {
                put("name", "catalog")
                val types = JSONArray().apply { put("movie"); put("series") }
                put("types", types)
                val catPrefixes = JSONArray()
                onProviders.forEach { catPrefixes.put("${it.id}-") }
                put("idPrefixes", catPrefixes)
            })
            put(JSONObject().apply {
                put("name", "meta")
                val types = JSONArray().apply { put("movie"); put("series") }
                put("types", types)
                val metaPrefixes = JSONArray()
                prefixes.forEach { metaPrefixes.put(it) }
                put("idPrefixes", metaPrefixes)
            })
            put(JSONObject().apply {
                put("name", "stream")
                val types = JSONArray().apply { put("movie"); put("series") }
                put("types", types)
                val streamPrefixes = JSONArray()
                allPrefixes.forEach { streamPrefixes.put(it) }
                put("idPrefixes", streamPrefixes)
            })
        }

        val names = onProviders.joinToString(" · ") { it.name }
        return JSONObject().apply {
            put("id", Config.Manifest.ID)
            put("version", Config.Manifest.VERSION)
            put("name", Config.Manifest.NAME)
            put("description", "${Config.Manifest.DESCRIPTION}\nNguồn: $names")
            put("logo", "$baseUrl/logo.svg")
            put("resources", resources)
            val typesArr = JSONArray().apply { put("movie"); put("series") }
            put("types", typesArr)
            put("catalogs", catalogs)
            val idPrefArr = JSONArray()
            allPrefixes.forEach { idPrefArr.put(it) }
            put("idPrefixes", idPrefArr)
            put("behaviorHints", JSONObject().apply { put("configurable", false) })
        }
    }

    fun handleCatalog(typeParam: String, idParam: String, extraParam: String?, queryParams: Map<String, String>): JSONObject {
        val type = if (typeParam == "series") "series" else "movie"
        val catalogId = idParam.replace(Regex("\\.json$", RegexOption.IGNORE_CASE), "")
        val dash = catalogId.indexOf('-')
        val providerId = if (dash > 0) catalogId.substring(0, dash) else catalogId
        val kind = if (dash > 0) catalogId.substring(dash + 1) else ""
        val p = providers[providerId] ?: return JSONObject().apply {
            put("metas", JSONArray())
        }

        val extra = mutableMapOf<String, String>()
        extra.putAll(queryParams)
        if (!extraParam.isNullOrBlank()) {
            extra.putAll(parseExtra(extraParam))
        }

        val search = extra["search"] ?: ""
        val genre = extra["genre"] ?: ""
        val country = extra["country"] ?: ""
        val sort = extra["sort"] ?: ""
        val skip = extra["skip"] ?: "0"
        val key = "cat:$providerId:$kind:$type:$search|$genre|$country|$sort|$skip"

        val result = Utils.cached(key, 10 * 60 * 1000L) {
            p.listCatalog(kind, extra)
        }

        val filtered = (result?.metas ?: emptyList()).filter { m ->
            m.id.isNotEmpty() && (m.type.isEmpty() || m.type == type)
        }

        val metasArr = JSONArray()
        filtered.forEach { metasArr.put(it.toJson()) }

        return JSONObject().apply {
            put("metas", metasArr)
            if (result?.pagination != null) {
                put("pagination", result.pagination.toJson())
            }
            put("cacheMaxAge", 600)
        }
    }

    fun handleMeta(typeParam: String, idParam: String): JSONObject? {
        val type = if (typeParam == "series") "series" else "movie"
        val parsed = parseId(idParam) ?: return null

        if (parsed.provider != null && parsed.slug != null) {
            val d = Utils.cached("meta:${parsed.provider.id}:${parsed.slug}", 30 * 60 * 1000L) {
                parsed.provider.detail(parsed.slug)
            } ?: return null
            val meta = parsed.provider.buildMeta(d, withVideos = true) ?: return null
            meta.type = if (type == "series" || d.type == "series") "series" else "movie"
            return JSONObject().apply {
                put("meta", meta.toJson())
                put("cacheMaxAge", 1800)
            }
        }

        if (parsed.imdbId != null) {
            val raw = Utils.cached("cinemetaRaw:$type:${parsed.imdbId}", 6 * 3600 * 1000L) {
                Utils.getJsonObject("${Config.CINEMETA_URL}/meta/$type/${parsed.imdbId}.json")
            }
            val metaObj = raw?.optJSONObject("meta")
            if (metaObj != null) {
                return JSONObject().apply {
                    put("meta", metaObj)
                    put("cacheMaxAge", 1800)
                }
            }
        }
        return null
    }

    fun handleStream(typeParam: String, idParam: String, baseUrl: String): JSONObject {
        val type = if (typeParam == "series") "series" else "movie"
        val parsed = parseId(idParam)
        var streams = mutableListOf<StreamItem>()

        try {
            if (parsed != null && parsed.provider != null && parsed.slug != null) {
                val list = parsed.provider.streamsFromSlug(parsed.slug, type, parsed.season, parsed.episode)
                streams.addAll(list)
            } else if (parsed != null && parsed.imdbId != null) {
                val meta = Cinemeta.getMeta(type, parsed.imdbId)
                if (meta != null) {
                    val opts = MatchOpts(
                        imdbId = parsed.imdbId,
                        title = meta.name,
                        year = meta.year,
                        type = type,
                        season = parsed.season,
                        episode = parsed.episode
                    )
                    for (p in providers.values) {
                        try {
                            val pStreams = p.resolveStream(opts)
                            streams.addAll(pStreams)
                        } catch (_: Exception) {}
                    }
                }
            }
        } catch (_: Exception) {}

        val proxied = streams.map { wrapProxy(it, baseUrl) }
        val deduped = dedupe(proxied)

        val streamsArr = JSONArray()
        deduped.forEach { streamsArr.put(it.toJson()) }

        return JSONObject().apply {
            put("streams", streamsArr)
            put("cacheMaxAge", 600)
        }
    }
}

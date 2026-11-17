package com.cinebolt.tv.backend.providers

import com.cinebolt.tv.backend.*
import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URL
import java.util.Base64
import java.util.regex.Matcher

class NguoncProvider(cfg: ProviderConfig) : BaseProvider(cfg) {

    private fun isSeriesItem(it: JSONObject): Boolean {
        val totalEps = it.optInt("total_episodes", 0)
        val curEp = it.optString("current_episode", "")
        return totalEps > 1 || (curEp.isNotBlank() && !Regex("full", RegexOption.IGNORE_CASE).containsMatchIn(curEp))
    }

    private fun sanitizeImg(url: String?): String? {
        return Utils.mapImageUrl(url, "https://phim.nguonc.com")
    }

    private fun toCatalogItem(it: JSONObject): CatalogItem {
        val type = if (isSeriesItem(it)) "series" else "movie"
        val poster = sanitizeImg(it.optString("poster_url").ifEmpty { it.optString("thumb_url") })
        val bg = sanitizeImg(it.optString("thumb_url").ifEmpty { it.optString("poster_url") })
        return CatalogItem(
            slug = it.optString("slug"),
            name = it.optString("name").ifEmpty { null },
            originalName = it.optString("original_name").ifEmpty { null },
            year = it.optInt("year").takeIf { it > 0 },
            type = type,
            poster = poster,
            background = bg,
            quality = it.optString("quality").ifEmpty { null },
            lang = it.optString("language").ifEmpty { null },
            description = Utils.stripHtml(it.optString("description"))
        )
    }

    private fun toMeta(it: CatalogItem): MetaItem {
        val releaseInfo = listOfNotNull(it.quality, it.lang, it.year?.toString()).joinToString(" · ")
            .ifEmpty { it.year?.toString() }
        return MetaItem(
            id = "$prefix${it.slug}",
            type = it.type,
            name = it.name ?: it.originalName,
            poster = it.poster,
            posterShape = "poster",
            background = it.background,
            releaseInfo = releaseInfo,
            year = it.year
        )
    }

    private fun requestFallback(url: String): JSONObject? {
        val res = Utils.getJsonObject(url, headers)
        if (res != null) return res
        for (fb in cfg.apiFallbacks) {
            if (!url.startsWith(cfg.apiUrl)) break
            val fbUrl = url.replace(cfg.apiUrl, fb)
            val fbRes = Utils.getJsonObject(fbUrl, headers)
            if (fbRes != null) return fbRes
        }
        return null
    }

    override fun search(q: String): List<CatalogItem> {
        if (q.isBlank()) return emptyList()
        return Utils.cached("nc:search:$q", 10 * 60 * 1000L) {
            val encodedQ = java.net.URLEncoder.encode(q, "UTF-8")
            val json = requestFallback("${cfg.apiUrl}/films/search?keyword=$encodedQ&page=1")
            val itemsArr = json?.optJSONArray("items") ?: return@cached emptyList()
            val list = mutableListOf<CatalogItem>()
            for (i in 0 until itemsArr.length()) {
                val it = itemsArr.optJSONObject(i) ?: continue
                list.add(toCatalogItem(it))
            }
            list
        } ?: emptyList()
    }

    override fun listCatalog(kind: String, extra: Map<String, String>): CatalogResult {
        val skip = extra["skip"]?.toIntOrNull() ?: 0
        val page = Math.max(1, (skip / 10) + 1)
        val searchQ = extra["search"]
        if (!searchQ.isNullOrBlank()) {
            return CatalogResult(search(searchQ).map { toMeta(it) })
        }

        val path = when (kind) {
            "phim-bo" -> "/films/danh-sach/phim-bo"
            "moi" -> "/films/phim-moi-cap-nhat"
            else -> "/films/danh-sach/phim-le"
        }
        val json = requestFallback("${cfg.apiUrl}$path?page=$page")
        val itemsArr = json?.optJSONArray("items") ?: return CatalogResult(emptyList())
        val list = mutableListOf<MetaItem>()
        for (i in 0 until itemsArr.length()) {
            val it = itemsArr.optJSONObject(i) ?: continue
            list.add(toMeta(toCatalogItem(it)))
        }
        val pagination = Pagination.fromNguonc(json, fallbackPage = page, fallbackPageSize = 10)
        return CatalogResult(list, pagination)
    }

    override fun detail(slug: String): MovieDetail? {
        return Utils.cached("nc:detail:$slug", 60 * 60 * 1000L) {
            val encodedSlug = java.net.URLEncoder.encode(slug, "UTF-8")
            val json = requestFallback("${cfg.apiUrl}/film/$encodedSlug")
            val m = json?.optJSONObject("movie") ?: json ?: return@cached null
            if (m.optString("name").isEmpty() && m.optString("slug").isEmpty()) return@cached null

            val epsArr = m.optJSONArray("episodes") ?: JSONArray()
            val servers = mutableListOf<ServerItem>()
            for (i in 0 until epsArr.length()) {
                val s = epsArr.optJSONObject(i) ?: continue
                val sName = s.optString("server_name", "Vietsub")
                val itemsArr = s.optJSONArray("items") ?: s.optJSONArray("server_data") ?: JSONArray()
                val items = mutableListOf<EpisodeItem>()
                for (j in 0 until itemsArr.length()) {
                    val e = itemsArr.optJSONObject(j) ?: continue
                    items.add(
                        EpisodeItem(
                            name = e.optString("name").ifEmpty { null },
                            slug = e.optString("slug").ifEmpty { null },
                            m3u8 = e.optString("m3u8").takeIf { it.isNotBlank() },
                            embed = e.optString("embed").takeIf { it.isNotBlank() }
                        )
                    )
                }
                servers.add(ServerItem(sName, items))
            }

            val casts = m.optString("casts").takeIf { it.isNotBlank() }?.split(",")?.map { it.trim() }
            val director = m.optString("director").takeIf { it.isNotBlank() }?.let { listOf(it.trim()) }
            val mSlug = m.optString("slug", slug)
            val metaId = "$prefix$mSlug"

            MovieDetail(
                slug = mSlug,
                name = m.optString("name").ifEmpty { null },
                originalName = m.optString("original_name").ifEmpty { null },
                year = m.optInt("year").takeIf { it > 0 },
                type = if (isSeriesItem(m)) "series" else "movie",
                quality = m.optString("quality").ifEmpty { null },
                lang = m.optString("language").ifEmpty { null },
                time = m.optString("time").ifEmpty { null },
                poster = sanitizeImg(m.optString("poster_url").ifEmpty { m.optString("thumb_url") }),
                background = sanitizeImg(m.optString("thumb_url").ifEmpty { m.optString("poster_url") }),
                description = Utils.stripHtml(m.optString("description")),
                cast = casts,
                director = director,
                servers = servers,
                videos = videosFromServers(servers, metaId)
            )
        }
    }

    private data class StreamCExtraction(val m3u8: String, val referer: String)

    private fun unpackDeanEdwards(packed: String): String {
        val regex = Regex("eval\\(function\\(p,a,c,k,e,d\\)[\\s\\S]*?\\}\\('([\\s\\S]*?)',(\\d+),(\\d+),'([\\s\\S]*?)'\\.split\\('\\|'\\)")
        val match = regex.find(packed) ?: return packed
        var p = match.groupValues[1]
        val a = match.groupValues[2].toIntOrNull() ?: return packed
        var c = match.groupValues[3].toIntOrNull() ?: return packed
        val keys = match.groupValues[4].split("|")

        fun encode(cVal: Int): String {
            val prefix = if (cVal < a) "" else encode(cVal / a)
            val rem = cVal % a
            val charStr = if (rem > 35) (rem + 29).toChar().toString() else rem.toString(36)
            return prefix + charStr
        }

        while (c-- > 0) {
            if (c < keys.size && keys[c].isNotEmpty()) {
                val word = encode(c)
                p = p.replace(Regex("\\b$word\\b"), Matcher.quoteReplacement(keys[c]))
            }
        }
        return p
    }

    private fun extractStreamC(embedUrl: String?): StreamCExtraction? {
        if (embedUrl.isNullOrBlank()) return null
        return try {
            val uri = URI(embedUrl)
            val origin = "${uri.scheme}://${uri.host}${if (uri.port > 0 && uri.port != 80 && uri.port != 443) ":${uri.port}" else ""}"
            val html = Utils.getText(
                embedUrl,
                headers = mapOf(
                    "User-Agent" to Config.USER_AGENT,
                    "Referer" to "https://phim.nguonc.com/",
                    "Origin" to "https://phim.nguonc.com"
                ),
                timeoutMs = 6000L
            ) ?: return null

            // 1) data-obf: base64 JSON
            val obfMatch = Regex("data-obf=[\"']([^\"']+)[\"']", RegexOption.IGNORE_CASE).find(html)
            if (obfMatch != null) {
                try {
                    val decodedBytes = Base64.getDecoder().decode(obfMatch.groupValues[1])
                    val decodedJson = JSONObject(String(decodedBytes, Charsets.UTF_8))
                    val sub = decodedJson.optString("sUb")
                    if (sub.isNotBlank()) {
                        return StreamCExtraction("$origin/$sub", "$origin/")
                    }
                } catch (_: Exception) {}
            }

            // 2) Dean Edwards unpacker
            if (html.contains("eval(function(p,a,c,k,e,d)")) {
                val unpacked = unpackDeanEdwards(html)
                val subMatch = Regex("[\"'](eyJoIjoi[^\"']+)[\"']").find(unpacked)
                if (subMatch != null) {
                    return StreamCExtraction("$origin/${subMatch.groupValues[1]}", "$origin/")
                }
                val directMatch = Regex("(https?://[^\"'\\s)]+\\.m3u8[^\"'\\s)]*)", RegexOption.IGNORE_CASE).find(unpacked)
                if (directMatch != null) {
                    return StreamCExtraction(directMatch.groupValues[1], "$origin/")
                }
            }

            // 3) regex m3u8 directly in HTML
            val directMatch = Regex("(https?://[^\"'\\s)]+\\.m3u8[^\"'\\s)]*)", RegexOption.IGNORE_CASE).find(html)
            if (directMatch != null) {
                return StreamCExtraction(directMatch.groupValues[1], "$origin/")
            }
            null
        } catch (_: Exception) {
            null
        }
    }

    override fun extractStreamItem(ep: EpisodeItem): ExtractedStream? {
        if (!ep.m3u8.isNullOrBlank()) return ExtractedStream(url = ep.m3u8)
        if (!ep.embed.isNullOrBlank()) {
            val extracted = extractStreamC(ep.embed)
            if (extracted != null) {
                return ExtractedStream(
                    url = extracted.m3u8,
                    headers = mapOf("User-Agent" to Config.USER_AGENT, "Referer" to extracted.referer)
                )
            }
            return ExtractedStream(externalUrl = ep.embed)
        }
        return null
    }

    override fun streamsFromDetail(d: MovieDetail, season: Int?, episode: Int?): List<StreamItem> {
        val isMovie = d.type != "series"
        val epNum = if (isMovie) null else (episode ?: 1)
        val streams = mutableListOf<StreamItem>()
        for (server in d.servers) {
            val ep = pickEpisode(server.items, epNum, isMovie) ?: continue
            val src = extractStreamItem(ep) ?: continue
            val audio = Utils.detectAudio(server.serverName, Utils.detectAudio(d.lang, "Vietsub"))
            streams.add(
                makeStream(
                    movieName = d.name,
                    epLabel = if (isMovie) (ep.name ?: "Full") else "Tập $epNum",
                    audio = audio,
                    quality = d.quality,
                    url = src.url,
                    externalUrl = src.externalUrl,
                    headers = src.headers ?: mapOf("User-Agent" to Config.USER_AGENT, "Referer" to cfg.referer)
                )
            )
        }
        return streams
    }

    override fun streamsFromSlug(slug: String, type: String, season: Int?, episode: Int?): List<StreamItem> {
        val d = detail(slug) ?: return emptyList()
        return streamsFromDetail(d, season, episode)
    }
}

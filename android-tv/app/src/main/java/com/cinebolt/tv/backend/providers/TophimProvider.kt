package com.cinebolt.tv.backend.providers

import com.cinebolt.tv.backend.*
import org.json.JSONObject

class TophimProvider(cfg: ProviderConfig) : BaseProvider(cfg) {

    private fun unescapeSsr(body: String?): String {
        var b = body ?: return ""
        while (b.contains("\\\"")) {
            b = b.replace("\\\"", "\"").replace("\\\\", "\\")
        }
        return b
    }

    private fun toMeta(it: CatalogItem): MetaItem {
        return MetaItem(
            id = "$prefix${it.slug}",
            type = it.type,
            name = it.name ?: it.originalName,
            poster = it.poster,
            posterShape = "poster",
            background = it.poster,
            year = it.year
        )
    }

    override fun search(q: String): List<CatalogItem> {
        if (q.isBlank()) return emptyList()
        return Utils.cached("tp:search:$q", 10 * 60 * 1000L) {
            val encodedQ = java.net.URLEncoder.encode(q, "UTF-8")
            val json = Utils.getJsonObject("${cfg.apiUrl}/api/search/suggestions?q=$encodedQ", headers)
            val moviesArr = json?.optJSONArray("movies") ?: return@cached emptyList()
            val list = mutableListOf<CatalogItem>()
            for (i in 0 until moviesArr.length()) {
                val m = moviesArr.optJSONObject(i) ?: continue
                val poster = m.optString("poster_url").ifEmpty { m.optString("thumb_url") }
                list.add(
                    CatalogItem(
                        slug = m.optString("slug"),
                        name = m.optString("title").ifEmpty { null },
                        originalName = m.optString("original_title").ifEmpty { null },
                        poster = poster.takeIf { it.isNotBlank() },
                        year = m.optInt("year").takeIf { it > 0 }
                    )
                )
            }
            list
        } ?: emptyList()
    }

    override fun listCatalog(kind: String, extra: Map<String, String>): CatalogResult {
        val searchQ = extra["search"]
        if (!searchQ.isNullOrBlank()) {
            return CatalogResult(search(searchQ).map { toMeta(it) })
        }
        return CatalogResult(emptyList())
    }

    override fun detail(slug: String): MovieDetail? {
        return Utils.cached("tp:detail:$slug", 60 * 60 * 1000L) {
            val encodedSlug = java.net.URLEncoder.encode(slug, "UTF-8")
            val html = Utils.getText(
                "${cfg.apiUrl}/phim/$encodedSlug",
                headers = mapOf("User-Agent" to Config.USER_AGENT, "Referer" to "${cfg.apiUrl}/"),
                timeoutMs = 12000L
            ) ?: return@cached null
            val b = unescapeSsr(html)

            val titleTagMatch = Regex("<title>([^<]+)</title>", RegexOption.IGNORE_CASE).find(html)
            val t = titleTagMatch?.groupValues?.getOrNull(1) ?: ""
            val tm = Regex("Xem Phim\\s+(.+?)\\s+\\(([^()]*)\\)\\s+\\((\\d{4})\\)").find(t)
            val name = tm?.groupValues?.getOrNull(1)?.trim() ?: slug
            val originalName = tm?.groupValues?.getOrNull(2)?.trim() ?: ""
            val year = tm?.groupValues?.getOrNull(3)?.toIntOrNull()
            val qualityM = Regex("\\b(4K|2160p|1080p|HD)\\b", RegexOption.IGNORE_CASE).find(t)
            val quality = qualityM?.groupValues?.getOrNull(1)?.uppercase(java.util.Locale.ROOT) ?: "HD"

            val re = Regex("\"([^\"]+)\",\"name\":\"([^\"]+)\",\"slug\":\"([^\"]+)\",\"video_url\":\"([^\"]+)\"")
            val groups = mutableMapOf<String, MutableList<EpisodeItem>>()
            var count = 0
            for (match in re.findAll(b)) {
                val label = match.groupValues[1].trim().removePrefix("#")
                val epName = match.groupValues[2]
                val epSlug = match.groupValues[3]
                val url = match.groupValues[4]
                if (!Regex("^https?://", RegexOption.IGNORE_CASE).containsMatchIn(url) ||
                    Regex("embed\\.php|/embed", RegexOption.IGNORE_CASE).containsMatchIn(url)
                ) {
                    continue
                }
                val list = groups.getOrPut(label) { mutableListOf() }
                list.add(EpisodeItem(name = epName, slug = epSlug, m3u8 = url, embed = null))
                count++
            }
            if (count == 0) return@cached null

            val servers = groups.map { (label, items) -> ServerItem(label, items) }
            val hasNumbered = servers.any { s ->
                s.items.any { e ->
                    val epName = e.name ?: ""
                    Regex("tập|\\d", RegexOption.IGNORE_CASE).containsMatchIn(epName) &&
                        !Regex("full", RegexOption.IGNORE_CASE).containsMatchIn(epName)
                }
            }
            val type = if (hasNumbered && count > 1) "series" else "movie"
            val metaId = "$prefix$slug"

            MovieDetail(
                slug = slug,
                name = name,
                originalName = originalName.ifEmpty { null },
                year = year,
                type = type,
                quality = quality,
                lang = "",
                poster = null,
                background = null,
                description = "",
                servers = servers,
                videos = videosFromServers(servers, metaId)
            )
        }
    }

    override fun streamsFromSlug(slug: String, type: String, season: Int?, episode: Int?): List<StreamItem> {
        val d = detail(slug) ?: return emptyList()
        return streamsFromDetail(d, season, episode)
    }
}

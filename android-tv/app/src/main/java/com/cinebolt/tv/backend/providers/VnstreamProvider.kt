package com.cinebolt.tv.backend.providers

import com.cinebolt.tv.backend.*
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.regex.Pattern

class VnstreamProvider(cfg: ProviderConfig) : BaseProvider(cfg) {

    private fun unescapeSsr(body: String?): String {
        var b = body ?: return ""
        while (b.contains("\\\"")) {
            b = b.replace("\\\"", "\"").replace("\\\\", "\\")
        }
        return b
    }

    private fun serverScore(name: String?): Int {
        val s = name?.lowercase(Locale.ROOT) ?: ""
        return when {
            Regex("vietsub").containsMatchIn(s) -> 0
            Regex("phụ đề|phu de").containsMatchIn(s) -> 1
            Regex("thuyết minh|thuyet minh").containsMatchIn(s) -> 2
            Regex("song ngữ|song ngu").containsMatchIn(s) -> 3
            else -> 4
        }
    }

    private fun toMeta(it: CatalogItem): MetaItem {
        return MetaItem(
            id = "$prefix${it.slug}",
            type = it.type,
            name = it.name ?: it.originalName,
            poster = it.poster,
            posterShape = "poster",
            background = it.poster,
            releaseInfo = it.year?.toString(),
            year = it.year
        )
    }

    override fun search(q: String): List<CatalogItem> {
        if (q.isBlank()) return emptyList()
        return Utils.cached("vn:search:$q", 10 * 60 * 1000L) {
            val encodedQ = java.net.URLEncoder.encode(q, "UTF-8")
            val json = Utils.getJsonObject("${cfg.apiUrl}/movies/search?q=$encodedQ", headers)
            val resultArr = json?.optJSONArray("result") ?: return@cached emptyList()
            val list = mutableListOf<CatalogItem>()
            for (i in 0 until resultArr.length()) {
                val it = resultArr.optJSONObject(i) ?: continue
                val posterUrl = it.optString("poster").ifEmpty { it.optString("thumbnail") }
                val yr = it.optInt("publish_year").takeIf { it > 0 } ?: it.optInt("year").takeIf { it > 0 }
                val imdb = it.optString("imdb_id").ifEmpty { it.optString("imdbId") }
                list.add(
                    CatalogItem(
                        slug = it.optString("slug"),
                        name = it.optString("name").ifEmpty { null },
                        originalName = it.optString("origin_name").ifEmpty { null },
                        year = yr,
                        type = if (it.optString("type") == "series") "series" else "movie",
                        poster = Utils.mapImageUrl(posterUrl, null),
                        imdbId = imdb.takeIf { it.isNotBlank() }
                    )
                )
            }
            list
        } ?: emptyList()
    }

    override fun listCatalog(kind: String, extra: Map<String, String>): CatalogResult {
        val skip = extra["skip"]?.toIntOrNull() ?: 0
        val page = Math.max(1, (skip / 20) + 1)
        val searchQ = extra["search"]
        if (!searchQ.isNullOrBlank()) {
            return CatalogResult(search(searchQ).map { toMeta(it) })
        }

        if (kind == "moi") {
            val json = Utils.getJsonObject("${cfg.apiUrl}/movies/hot", headers)
            val resultArr = json?.optJSONArray("result") ?: return CatalogResult(emptyList())
            val list = mutableListOf<MetaItem>()
            val max = Math.min(40, resultArr.length())
            for (i in 0 until max) {
                val it = resultArr.optJSONObject(i) ?: continue
                val posterUrl = it.optString("poster").ifEmpty { it.optString("thumbnail") }
                list.add(
                    toMeta(
                        CatalogItem(
                            slug = it.optString("slug"),
                            name = it.optString("name").ifEmpty { null },
                            poster = Utils.mapImageUrl(posterUrl, null),
                            type = "movie"
                        )
                    )
                )
            }
            return CatalogResult(list)
        }

        val siteUrl = cfg.siteUrl ?: return CatalogResult(emptyList())
        val path = if (kind == "bo") "$siteUrl/phim-bo?page=$page" else "$siteUrl/the-loai/$kind?page=$page"
        val metas = Utils.cached("vn:cat:$path", 30 * 60 * 1000L) {
            val rawHtml = Utils.getText(path, headers, timeoutMs = 10000L) ?: return@cached emptyList()
            val html = unescapeSsr(rawHtml)
            val hostEsc = Pattern.quote(siteUrl.replace(Regex("^https?://"), ""))
            val re = Regex("\"url\":\"https?://$hostEsc/phim/([^\"]+)\",\"name\":\"([^\"]+)\"")
            val seen = mutableSetOf<String>()
            val out = mutableListOf<MetaItem>()
            for (match in re.findAll(html)) {
                if (out.size >= 40) break
                val slug = match.groupValues[1]
                val name = match.groupValues[2]
                if (seen.add(slug)) {
                    out.add(
                        toMeta(
                            CatalogItem(
                                slug = slug,
                                name = name,
                                type = if (kind == "bo") "series" else "movie"
                            )
                        )
                    )
                }
            }
            out
        } ?: emptyList()
        return CatalogResult(metas)
    }

    private data class SiteDetail(
        val id: Int?,
        val slug: String,
        val name: String?,
        val originalName: String?,
        val imdbId: String?,
        val year: Int?,
        val type: String,
        val poster: String?
    )

    private fun detailFromSite(slug: String): SiteDetail? {
        val siteUrl = cfg.siteUrl ?: return null
        return Utils.cached("vn:detail:$slug", 60 * 60 * 1000L) {
            val encodedSlug = java.net.URLEncoder.encode(slug, "UTF-8")
            val rawHtml = Utils.getText("$siteUrl/phim/$encodedSlug", headers, timeoutMs = 10000L) ?: return@cached null
            val html = unescapeSsr(rawHtml)
            val i = html.indexOf("\"movie\":{")
            if (i < 0) return@cached null
            val chunk = html.substring(i, Math.min(i + 4000, html.length))

            fun grab(pattern: String): String? {
                val m = Regex(pattern).find(chunk)
                return m?.groupValues?.getOrNull(1)
            }

            val idM = Regex("\"id\":(\\d+)").find(chunk)
            val id = idM?.groupValues?.getOrNull(1)?.toIntOrNull()
            val isSeries = chunk.contains("\"type\":\"series\"")
            val yrStr = grab("\"publish_year\":(\\d+)")
            val yr = yrStr?.toIntOrNull()

            SiteDetail(
                id = id,
                slug = slug,
                name = grab("\"name\":\"([^\"]+)\""),
                originalName = grab("\"origin_name\":\"([^\"]+)\""),
                imdbId = grab("\"imdb_id\":\"([^\"]+)\""),
                year = yr,
                type = if (isSeries) "series" else "movie",
                poster = Utils.mapImageUrl(grab("\"poster\":\"([^\"]+)\""), null)
            )
        }
    }

    private fun episodes(movieId: Int): List<JSONObject> {
        return Utils.cached("vn:eps:$movieId", 30 * 60 * 1000L) {
            val json = Utils.getJson("${cfg.apiUrl}/episodes/by-idMovie/$movieId", headers) as? JSONArray
                ?: return@cached emptyList()
            val list = mutableListOf<JSONObject>()
            for (i in 0 until json.length()) {
                val it = json.optJSONObject(i) ?: continue
                list.add(it)
            }
            list
        } ?: emptyList()
    }

    override fun detail(slug: String): MovieDetail? {
        val d = detailFromSite(slug) ?: return null
        val movieId = d.id ?: return null
        val eps = episodes(movieId)
        val videos = mutableListOf<VideoItem>()
        val seen = mutableSetOf<String>()
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val nowIso = isoFormat.format(Date())

        for (e in eps) {
            val s = e.optInt("season_number", 1)
            val num = Utils.parseEpNum(e.optString("name")) ?: (videos.size + 1)
            val key = "$s-$num"
            if (seen.add(key)) {
                videos.add(
                    VideoItem(
                        id = "$prefix$slug:$s:$num",
                        title = "Tập $num",
                        season = s,
                        episode = num,
                        released = nowIso
                    )
                )
            }
        }

        return MovieDetail(
            slug = slug,
            name = d.name,
            originalName = d.originalName,
            year = d.year,
            type = d.type,
            poster = d.poster,
            background = d.poster,
            description = "",
            imdbId = d.imdbId,
            servers = emptyList(),
            videos = videos
        )
    }

    private fun resolveEmbed(embedUrl: String): String? {
        val siteUrl = cfg.siteUrl ?: return null
        val html = Utils.getText(
            embedUrl,
            headers = mapOf("User-Agent" to Config.USER_AGENT, "Referer" to "$siteUrl/"),
            timeoutMs = 8000L
        ) ?: return null
        val bmM = Regex("baseUrl\\s*=\\s*\"([^\"]+)\"").find(html)
        val vhM = Regex("videoHash\\s*=\\s*\"([^\"]+)\"").find(html)
        if (bmM != null && vhM != null) {
            return "${bmM.groupValues[1]}/stream/${vhM.groupValues[1]}/master.m3u8"
        }
        val directM = Regex("https?://[^\"'\\s]+\\.m3u8[^\"'\\s]*", RegexOption.IGNORE_CASE).find(html)
        return directM?.value
    }

    private fun watchM3u8(slug: String, epId: Any?): String? {
        val siteUrl = cfg.siteUrl ?: return null
        val encodedSlug = java.net.URLEncoder.encode(slug, "UTF-8")
        val url = "$siteUrl/xem-phim/$encodedSlug.$epId"
        val rawHtml = Utils.getText(
            url,
            headers = mapOf("User-Agent" to Config.USER_AGENT, "Referer" to "$siteUrl/", "Accept" to "text/html"),
            timeoutMs = 12000L
        ) ?: return null

        var m = Regex("\"link\"\\s*:\\s*\\\\?\"(https?://[^\"\\\\]+?\\.m3u8[^\"\\\\]*)\\\\?\"").find(rawHtml)
        if (m != null) return m.groupValues[1]

        m = Regex("\"link\"\\s*:\\s*\"(https?://[^\"]+?\\.m3u8[^\"]*)\"").find(rawHtml)
        if (m != null) return m.groupValues[1]

        val html = unescapeSsr(rawHtml)
        val m2 = Regex("\"type\":\"([^\"]+)\",\"link\":\"([^\"]+)\"").find(html)
        if (m2 != null) {
            val typ = m2.groupValues[1]
            val link = m2.groupValues[2]
            if (Regex("m3u8", RegexOption.IGNORE_CASE).containsMatchIn(typ)) return link
            if (Regex("embed", RegexOption.IGNORE_CASE).containsMatchIn(typ)) return resolveEmbed(link)
        }
        return null
    }

    override fun streamsFromSlug(slug: String, type: String, season: Int?, episode: Int?): List<StreamItem> {
        val isMovie = type != "series"
        val d = detailFromSite(slug) ?: return emptyList()
        val movieId = d.id ?: return emptyList()
        val eps = episodes(movieId)
        if (eps.isEmpty()) return emptyList()

        val pool: List<JSONObject> = if (!isMovie) {
            val s = season ?: 1
            val target = episode ?: 1
            val bySeason = eps.filter { it.optInt("season_number", 1) == s }
            val seasonPool = if (bySeason.isNotEmpty()) bySeason else eps
            val byNum = seasonPool.filter {
                Utils.parseEpNum(it.optString("name")) == target || Utils.parseEpNum(it.optString("slug")) == target
            }
            if (byNum.isNotEmpty()) byNum else seasonPool
        } else {
            val fullEps = eps.filter {
                Regex("full|tap-full", RegexOption.IGNORE_CASE).containsMatchIn("${it.optString("name")} ${it.optString("slug")}")
            }
            if (fullEps.isNotEmpty()) fullEps else eps
        }
        if (pool.isEmpty()) return emptyList()

        val sorted = pool.sortedBy { serverScore(it.optString("server")) }
        val streams = mutableListOf<StreamItem>()
        val usedServers = mutableSetOf<String>()
        val siteUrl = cfg.siteUrl ?: ""

        for (ep in sorted.take(3)) {
            val srv = ep.optString("server")
            if (!usedServers.add(srv)) continue
            val epId = ep.opt("id") ?: continue
            val m3u8 = watchM3u8(slug, epId) ?: continue
            val epNumLabel = if (isMovie) "Full" else "Tập ${Utils.parseEpNum(ep.optString("name")) ?: (episode ?: 1)}"
            streams.add(
                makeStream(
                    movieName = d.name,
                    epLabel = epNumLabel,
                    audio = Utils.detectAudio(srv, "Vietsub"),
                    quality = "HD",
                    url = m3u8,
                    externalUrl = null,
                    headers = mapOf("User-Agent" to Config.USER_AGENT, "Referer" to "$siteUrl/")
                )
            )
        }
        return streams
    }
}

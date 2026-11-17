package com.cinebolt.tv.backend

import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

abstract class BaseProvider(val cfg: ProviderConfig) {
    val id: String = cfg.id
    val name: String = cfg.name
    val prefix: String = cfg.prefix

    open val headers: Map<String, String>
        get() = mapOf(
            "User-Agent" to Config.USER_AGENT,
            "Referer" to cfg.referer,
            "Accept" to "application/json, text/plain, */*"
        )

    fun scoreItem(it: CatalogItem, opts: MatchOpts): Double {
        val q = Utils.normTitle(opts.title)
        if (q.isEmpty()) return Double.NEGATIVE_INFINITY
        var score = 0.0
        if (!opts.imdbId.isNullOrEmpty() && !it.imdbId.isNullOrEmpty() &&
            it.imdbId.equals(opts.imdbId, ignoreCase = true)
        ) {
            score += 30.0
        }

        val key = Utils.normTitle(if (!it.originalName.isNullOrEmpty()) it.originalName else it.name)
        val nameKey = Utils.normTitle(it.name)
        if (key.isNotEmpty() && key == q) {
            score += 100.0
        } else if (nameKey.isNotEmpty() && nameKey == q) {
            score += 90.0
        } else if (key.isNotEmpty() && Math.min(q.length, key.length) > 6 &&
            (q.contains(key) || key.contains(q))
        ) {
            score += 10.0
        } else {
            return Double.NEGATIVE_INFINITY
        }

        val yr = opts.year
        val itY = it.year
        if (itY != null && yr != null) {
            score += if (Math.abs(itY - yr) <= 1) 20.0 else -50.0
        }

        val sn = seasonMarker(it)
        if (sn != null) {
            score += if (opts.type == "series" && sn == (opts.season ?: 1)) 25.0 else -40.0
        }
        return score
    }

    fun seasonMarker(it: CatalogItem): Int? {
        val hay = "${it.name ?: ""} ${it.originalName ?: ""}".lowercase(Locale.ROOT)
        var m = Regex("(?:phần|season|part)\\s*(\\d+)").find(hay)
        if (m != null) return m.groupValues[1].toIntOrNull()
        m = Regex("\\bs\\s*(\\d{1,2})\\b").find(hay)
        if (m != null) return m.groupValues[1].toIntOrNull()
        return null
    }

    fun matchCandidates(items: List<CatalogItem>, opts: MatchOpts): List<CatalogItem> {
        return items
            .map { it to scoreItem(it, opts) }
            .filter { it.second >= 10.0 }
            .sortedByDescending { it.second }
            .map { it.first }
    }

    fun matchItem(items: List<CatalogItem>, opts: MatchOpts): CatalogItem? {
        return matchCandidates(items, opts).firstOrNull()
    }

    fun pickEpisode(items: List<EpisodeItem>, epNum: Int?, isMovie: Boolean): EpisodeItem? {
        if (items.isEmpty()) return null
        if (isMovie) {
            return items.find { Regex("full|fullhd", RegexOption.IGNORE_CASE).containsMatchIn("${it.name ?: ""} ${it.slug ?: ""}") }
                ?: items[0]
        }
        val target = epNum ?: 1
        val pool = items.filter { Utils.parseEpNum(it.name) == target || Utils.parseEpNum(it.slug) == target }
        if (pool.isNotEmpty()) return pool[0]
        if (target in 1..items.size) return items[target - 1]
        return items.firstOrNull()
    }

    data class ExtractedStream(
        val url: String? = null,
        val externalUrl: String? = null,
        val headers: Map<String, String>? = null
    )

    fun makeStream(
        movieName: String?,
        epLabel: String?,
        audio: String?,
        quality: String?,
        url: String?,
        externalUrl: String?,
        headers: Map<String, String>?
    ): StreamItem {
        val q = quality ?: "HD"
        val aud = audio ?: "Vietsub"
        val titleParts = listOfNotNull(epLabel, movieName).filter { it.isNotEmpty() }
        val title = titleParts.joinToString(" • ") + (if (externalUrl != null) " • Mở bằng trình duyệt" else "")

        val hints = JSONObject().apply {
            put("notWebReady", false)
            put("bingeGroup", "$id-${Utils.audioKey(aud)}")
            if (headers != null && headers.isNotEmpty()) {
                val reqHeaders = JSONObject()
                headers.forEach { (k, v) -> reqHeaders.put(k, v) }
                val proxyHeaders = JSONObject().apply { put("request", reqHeaders) }
                put("proxyHeaders", proxyHeaders)
            }
        }

        return StreamItem(
            name = "$name\n$q · $aud",
            title = title,
            url = url,
            externalUrl = externalUrl,
            behaviorHints = hints,
            providerId = id
        )
    }

    fun buildMeta(d: MovieDetail?, withVideos: Boolean = true): MetaItem? {
        if (d == null) return null
        val releaseInfo = listOfNotNull(d.quality, d.lang, d.year?.toString()).joinToString(" · ")
            .ifEmpty { d.year?.toString() }
        val isSeries = d.type == "series"
        return MetaItem(
            id = "$prefix${d.slug}",
            type = if (isSeries) "series" else "movie",
            name = d.name ?: d.originalName,
            poster = d.poster,
            posterShape = "poster",
            background = d.background ?: d.poster,
            description = d.description ?: "",
            releaseInfo = releaseInfo,
            genres = d.genres,
            runtime = d.time,
            cast = d.cast,
            director = d.director,
            videos = if (isSeries && withVideos) d.videos else null,
            year = d.year,
            imdbId = d.imdbId
        )
    }

    fun videosFromServers(servers: List<ServerItem>, metaId: String): List<VideoItem> {
        val primary = servers.firstOrNull { it.items.isNotEmpty() } ?: return emptyList()
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val nowIso = isoFormat.format(Date())
        return primary.items.mapIndexed { idx, e ->
            val num = Utils.parseEpNum(e.name) ?: Utils.parseEpNum(e.slug) ?: (idx + 1)
            val title = if (!e.name.isNullOrBlank() && Regex("tập|ep", RegexOption.IGNORE_CASE).containsMatchIn(e.name)) {
                e.name
            } else {
                "Tập $num"
            }
            VideoItem(
                id = "$metaId:1:$num",
                title = title,
                season = 1,
                episode = num,
                released = nowIso
            )
        }
    }

    open fun extractStreamItem(ep: EpisodeItem): ExtractedStream? {
        if (!ep.m3u8.isNullOrBlank()) return ExtractedStream(url = ep.m3u8)
        if (!ep.embed.isNullOrBlank()) {
            val inner = Utils.extractUrlParam(ep.embed)
            if (inner != null) return ExtractedStream(url = inner)
            return ExtractedStream(externalUrl = ep.embed)
        }
        return null
    }

    open fun resolveStream(opts: MatchOpts): List<StreamItem> {
        val hits = search(opts.title)
        val cands = matchCandidates(hits, opts)
        for (it in cands.take(3)) {
            try {
                val streams = streamsFromSlug(it.slug, opts.type ?: "movie", opts.season ?: 1, opts.episode ?: 1)
                if (streams.isNotEmpty()) return streams
            } catch (_: Exception) {
            }
        }
        return emptyList()
    }

    open fun streamsFromDetail(d: MovieDetail, season: Int?, episode: Int?): List<StreamItem> {
        val isMovie = d.type != "series"
        val epNum = if (isMovie) null else (episode ?: 1)
        val streams = mutableListOf<StreamItem>()
        for (server in d.servers) {
            val ep = pickEpisode(server.items, epNum, isMovie) ?: continue
            val audio = Utils.detectAudio(server.serverName, Utils.detectAudio(d.lang, "Vietsub"))
            val src = extractStreamItem(ep) ?: continue
            streams.add(
                makeStream(
                    movieName = d.name,
                    epLabel = if (isMovie) (ep.name ?: "Full") else "Tập $epNum",
                    audio = audio,
                    quality = Utils.qualityFromText(ep.filename ?: ep.name, d.quality),
                    url = src.url,
                    externalUrl = src.externalUrl,
                    headers = src.headers ?: mapOf("User-Agent" to Config.USER_AGENT, "Referer" to cfg.referer)
                )
            )
        }
        return streams
    }

    abstract fun search(q: String): List<CatalogItem>
    abstract fun listCatalog(kind: String, extra: Map<String, String>): CatalogResult
    abstract fun detail(slug: String): MovieDetail?
    abstract fun streamsFromSlug(slug: String, type: String, season: Int?, episode: Int?): List<StreamItem>
}

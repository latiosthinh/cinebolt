package com.cinebolt.tv.backend.providers

import com.cinebolt.tv.backend.*
import org.json.JSONArray
import org.json.JSONObject

class K20Provider(cfg: ProviderConfig) : BaseProvider(cfg) {

    companion object {
        val K20_SOURCES = listOf("nguonc", "hh3d", "stp", "vsmov", "yan")

        fun encodeNativeId(type: String, id: String): String {
            val json = JSONObject().apply {
                put("type", type)
                put("id", id)
            }
            return Utils.b64e(json.toString())
        }

        fun decodeNativeId(value: String?): Pair<String, String>? {
            return try {
                val decoded = Utils.b64d(value)
                val json = JSONObject(decoded)
                val type = json.optString("type")
                val id = json.optString("id")
                if (type in listOf("movie", "series") && id.isNotBlank()) {
                    Pair(type, id)
                } else {
                    null
                }
            } catch (_: Exception) {
                null
            }
        }

        fun episodeNumber(video: JSONObject?, index: Int): Int {
            if (video == null) return index + 1
            val title = video.optString("title")
            return Utils.parseEpNum(title) ?: video.optInt("episode").takeIf { it > 0 } ?: (index + 1)
        }
    }

    private fun catalogIds(type: String): List<String> {
        return K20_SOURCES.map { "$it-$type" }
    }

    private fun normalizeMeta(meta: JSONObject, fallbackType: String): CatalogItem {
        val metaType = meta.optString("type")
        val type = when (metaType) {
            "series" -> "series"
            "movie" -> "movie"
            else -> fallbackType
        }
        val id = meta.optString("id")
        val relInfo = meta.optString("releaseInfo").ifEmpty { null }
        return CatalogItem(
            slug = encodeNativeId(type, id),
            name = meta.optString("name").ifEmpty { null },
            originalName = meta.optString("name").ifEmpty { null },
            year = Utils.parseEpNum(relInfo),
            type = type,
            poster = meta.optString("poster").ifEmpty { null },
            background = meta.optString("background").ifEmpty { meta.optString("poster") }.ifEmpty { null },
            description = meta.optString("description").ifEmpty { null },
            releaseInfo = relInfo
        )
    }

    private fun toMeta(item: CatalogItem): MetaItem {
        val releaseInfo = item.releaseInfo ?: item.year?.toString()
        return MetaItem(
            id = "$prefix${item.slug}",
            type = item.type,
            name = item.name,
            poster = item.poster,
            posterShape = "poster",
            background = item.background,
            description = item.description,
            releaseInfo = releaseInfo,
            year = item.year
        )
    }

    private fun fetchCatalog(type: String, catalogId: String, extra: Map<String, String>): List<CatalogItem> {
        val search = extra["search"]
        val skip = extra["skip"]?.toIntOrNull() ?: 0

        val suffix = when {
            !search.isNullOrBlank() -> "/search=${java.net.URLEncoder.encode(search, "UTF-8")}.json"
            skip > 0 -> "/skip=$skip.json"
            else -> ".json"
        }

        val json = Utils.getJsonObject("${cfg.apiUrl}/catalog/$type/$catalogId$suffix", headers)
        val metasArr = json?.optJSONArray("metas") ?: return emptyList()
        val list = mutableListOf<CatalogItem>()
        for (i in 0 until metasArr.length()) {
            val m = metasArr.optJSONObject(i) ?: continue
            list.add(normalizeMeta(m, type))
        }
        return list
    }

    fun searchType(query: String, type: String): List<CatalogItem> {
        if (query.isBlank()) return emptyList()
        return Utils.cached("k20:search:$type:$query", 10 * 60 * 1000L) {
            val results = catalogIds(type).map { catId ->
                try {
                    fetchCatalog(type, catId, mapOf("search" to query))
                } catch (_: Exception) {
                    emptyList()
                }
            }
            mergeItems(results)
        } ?: emptyList()
    }

    override fun search(q: String): List<CatalogItem> {
        if (q.isBlank()) return emptyList()
        val movies = searchType(q, "movie")
        val series = searchType(q, "series")
        return movies + series
    }

    private fun mergeItems(results: List<List<CatalogItem>>): List<CatalogItem> {
        val seen = mutableSetOf<String>()
        val merged = mutableListOf<CatalogItem>()
        for (list in results) {
            for (item in list) {
                val native = decodeNativeId(item.slug)
                val nativeId = native?.second ?: item.slug
                val key = "${item.type}:$nativeId"
                if (nativeId.isNotBlank() && seen.add(key)) {
                    merged.add(item)
                }
            }
        }
        return merged
    }

    override fun listCatalog(kind: String, extra: Map<String, String>): CatalogResult {
        val type = if (kind == "series") "series" else "movie"
        val skip = extra["skip"]?.toIntOrNull() ?: 0
        val page = Math.max(1, (skip / 20) + 1)
        val searchQ = extra["search"]
        if (!searchQ.isNullOrBlank()) {
            return CatalogResult(searchType(searchQ, type).map { toMeta(it) })
        }

        val results = catalogIds(type).map { catId ->
            try {
                fetchCatalog(type, catId, extra)
            } catch (_: Exception) {
                emptyList()
            }
        }
        val list = mergeItems(results).map { toMeta(it) }
        val pagination = Pagination(page = page, totalPages = null, totalItems = null, pageSize = 20)
        return CatalogResult(list, pagination)
    }

    override fun resolveStream(opts: MatchOpts): List<StreamItem> {
        val mediaType = if (opts.type == "series") "series" else "movie"
        val hits = searchType(opts.title, mediaType)
        val ranked = matchCandidates(hits, opts)
        val targetYear = opts.year
        val yearMatch = if (targetYear != null) {
            hits.find { it.year != null && Math.abs(it.year - targetYear) <= 1 }
        } else null

        val candidates = ranked.toMutableList()
        for (fallback in listOfNotNull(yearMatch, hits.firstOrNull())) {
            if (candidates.none { it.slug == fallback.slug }) {
                candidates.add(fallback)
            }
        }

        for (candidate in candidates.take(3)) {
            val streams = streamsFromSlug(candidate.slug, mediaType, opts.season ?: 1, opts.episode ?: 1)
            if (streams.isNotEmpty()) return streams
        }
        return emptyList()
    }

    override fun detail(slug: String): MovieDetail? {
        val native = decodeNativeId(slug) ?: return null
        return Utils.cached("k20:detail:${native.first}:${native.second}", 60 * 60 * 1000L) {
            val encodedId = java.net.URLEncoder.encode(native.second, "UTF-8")
            val json = Utils.getJsonObject("${cfg.apiUrl}/meta/${native.first}/$encodedId.json", headers)
            val meta = json?.optJSONObject("meta") ?: return@cached null

            val nativeVideosArr = meta.optJSONArray("videos") ?: JSONArray()
            val nativeVideosList = mutableListOf<JSONObject>()
            val videos = mutableListOf<VideoItem>()

            for (i in 0 until nativeVideosArr.length()) {
                val v = nativeVideosArr.optJSONObject(i) ?: continue
                nativeVideosList.add(v)
                val ep = episodeNumber(v, i)
                val season = v.optInt("season", 1).takeIf { it > 0 } ?: 1
                val title = v.optString("title").ifEmpty { "Tập $ep" }
                val released = v.optString("released").ifEmpty { null }
                videos.add(
                    VideoItem(
                        id = "$prefix$slug:$season:$ep",
                        title = title,
                        season = season,
                        episode = ep,
                        released = released
                    )
                )
            }

            val categories = mutableListOf<String>()
            val catArr = meta.optJSONArray("genres")
            if (catArr != null) {
                for (i in 0 until catArr.length()) {
                    val g = catArr.optString(i)
                    if (g.isNotBlank()) categories.add(g)
                }
            }

            val relInfo = meta.optString("releaseInfo").ifEmpty { null }

            MovieDetail(
                slug = slug,
                name = meta.optString("name").ifEmpty { null },
                originalName = meta.optString("name").ifEmpty { null },
                year = Utils.parseEpNum(relInfo),
                type = native.first,
                quality = "Auto",
                lang = "",
                poster = meta.optString("poster").ifEmpty { null },
                background = meta.optString("background").ifEmpty { meta.optString("poster") }.ifEmpty { null },
                description = meta.optString("description").ifEmpty { "" },
                genres = categories.ifEmpty { null },
                time = meta.optString("runtime").ifEmpty { null },
                servers = emptyList(),
                videos = videos.ifEmpty { null },
                nativeId = native.second,
                nativeVideos = nativeVideosList
            )
        }
    }

    private fun pickNativeVideo(detail: MovieDetail, season: Int?, episode: Int?): String? {
        if (detail.type != "series" || detail.nativeVideos.isEmpty()) return detail.nativeId
        val targetSeason = season ?: 1
        val targetEpisode = episode ?: 1

        var match = detail.nativeVideos.find { v ->
            val vSeason = v.optInt("season", 1).takeIf { it > 0 } ?: 1
            vSeason == targetSeason && episodeNumber(v, 0) == targetEpisode
        }
        if (match == null) {
            match = detail.nativeVideos.find { v -> episodeNumber(v, 0) == targetEpisode }
        }
        if (match == null && targetEpisode in 1..detail.nativeVideos.size) {
            match = detail.nativeVideos[targetEpisode - 1]
        }
        val id = match?.optString("id")?.takeIf { it.isNotBlank() }
        return id ?: detail.nativeId
    }

    private fun mapStream(stream: JSONObject, detail: MovieDetail, episode: Int?): StreamItem? {
        val url = stream.optString("url")
        if (url.isBlank()) return null
        val sName = stream.optString("name")
        val sTitle = stream.optString("title")
        val label = "$sName $sTitle"
        val audio = Utils.detectAudio(label, "Vietsub")
        val quality = Utils.qualityFromText(label, "Auto")

        val hints = stream.optJSONObject("behaviorHints") ?: JSONObject()
        if (!hints.has("notWebReady")) hints.put("notWebReady", false)

        val streamTitle = sTitle.ifEmpty {
            if (detail.type == "series") "Tập ${episode ?: 1}" else (detail.name ?: "")
        }

        return StreamItem(
            name = "K20\n$quality · $audio",
            title = streamTitle,
            url = url,
            behaviorHints = hints,
            providerId = id,
            subtitles = stream.optJSONArray("subtitles")
        )
    }

    override fun streamsFromSlug(slug: String, type: String, season: Int?, episode: Int?): List<StreamItem> {
        val detail = detail(slug) ?: return emptyList()
        val nativeVideoId = pickNativeVideo(detail, season, episode) ?: return emptyList()
        val encodedId = java.net.URLEncoder.encode(nativeVideoId, "UTF-8")

        val json = Utils.getJsonObject("${cfg.apiUrl}/stream/${detail.type}/$encodedId.json", headers)
        val streamsArr = json?.optJSONArray("streams") ?: return emptyList()
        val list = mutableListOf<StreamItem>()
        for (i in 0 until streamsArr.length()) {
            val s = streamsArr.optJSONObject(i) ?: continue
            val mapped = mapStream(s, detail, episode)
            if (mapped != null) list.add(mapped)
        }
        return list
    }
}

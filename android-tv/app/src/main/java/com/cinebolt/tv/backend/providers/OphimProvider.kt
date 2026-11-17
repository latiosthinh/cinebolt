package com.cinebolt.tv.backend.providers

import com.cinebolt.tv.backend.*
import org.json.JSONArray
import org.json.JSONObject

class OphimProvider(cfg: ProviderConfig) : BaseProvider(cfg) {

    private fun normalizeItem(item: JSONObject, fallbackType: String = "movie"): CatalogItem {
        val itemType = item.optString("type")
        val tmdb = item.optJSONObject("tmdb")
        val tmdbType = tmdb?.optString("type")

        val type = when {
            itemType == "single" || tmdbType == "movie" -> "movie"
            itemType in listOf("series", "hoathinh", "tvshows") || tmdbType == "series" -> "series"
            else -> fallbackType
        }

        val imdb = item.optJSONObject("imdb")
        val imdbId = imdb?.optString("id")?.takeIf { it.isNotBlank() }

        val posterUrl = item.optString("poster_url").ifEmpty { null }
        val thumbUrl = item.optString("thumb_url").ifEmpty { null }
        val posterCdn = if (posterUrl != null && Regex("^https?:", RegexOption.IGNORE_CASE).containsMatchIn(posterUrl)) null else cfg.cdnImage
        val thumbCdn = if (thumbUrl != null && Regex("^https?:", RegexOption.IGNORE_CASE).containsMatchIn(thumbUrl)) null else cfg.cdnImage

        return CatalogItem(
            slug = item.optString("slug"),
            name = item.optString("name").ifEmpty { null },
            originalName = item.optString("origin_name").ifEmpty { null },
            year = item.optInt("year").takeIf { it > 0 },
            type = type,
            poster = Utils.mapImageUrl(posterUrl, posterCdn),
            background = Utils.mapImageUrl(thumbUrl, thumbCdn),
            imdbId = imdbId,
            quality = item.optString("quality").ifEmpty { null },
            lang = item.optString("lang").ifEmpty { null },
            description = Utils.stripHtml(item.optString("content"))
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
            year = it.year,
            imdbId = it.imdbId
        )
    }

    override fun search(q: String): List<CatalogItem> {
        if (q.isBlank()) return emptyList()
        return Utils.cached("op:search:$q", 10 * 60 * 1000L) {
            val encodedQ = java.net.URLEncoder.encode(q, "UTF-8")
            val json = Utils.getJsonObject("${cfg.apiUrl}/v1/api/tim-kiem?keyword=$encodedQ&page=1&limit=24", headers)
            val itemsArr = json?.optJSONObject("data")?.optJSONArray("items")
                ?: json?.optJSONArray("items") ?: return@cached emptyList()
            val list = mutableListOf<CatalogItem>()
            for (i in 0 until itemsArr.length()) {
                val it = itemsArr.optJSONObject(i) ?: continue
                list.add(normalizeItem(it, "movie"))
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

        val path = if (kind == "phim-bo") "phim-bo" else "phim-le"
        val type = if (kind == "phim-bo") "series" else "movie"
        val json = Utils.getJsonObject("${cfg.apiUrl}/v1/api/danh-sach/$path?page=$page&limit=20", headers)
        val itemsArr = json?.optJSONObject("data")?.optJSONArray("items")
            ?: json?.optJSONArray("items") ?: return CatalogResult(emptyList())
        val list = mutableListOf<MetaItem>()
        for (i in 0 until itemsArr.length()) {
            val it = itemsArr.optJSONObject(i) ?: continue
            list.add(toMeta(normalizeItem(it, type)))
        }
        val pagination = Pagination.fromKKphim(json, fallbackPage = page, fallbackPageSize = 20)
            ?: Pagination.fromPhim4k(json, fallbackPage = page, fallbackPageSize = 20)
        return CatalogResult(list, pagination)
    }

    override fun detail(slug: String): MovieDetail? {
        return Utils.cached("op:detail:$slug", 60 * 60 * 1000L) {
            val encodedSlug = java.net.URLEncoder.encode(slug, "UTF-8")
            val json = Utils.getJsonObject("${cfg.apiUrl}/v1/api/phim/$encodedSlug", headers)
            val d = json?.optJSONObject("data") ?: return@cached null
            val m = d.optJSONObject("item") ?: d.optJSONObject("movie") ?: return@cached null
            if (m.optString("slug").isEmpty() && m.optString("name").isEmpty()) return@cached null

            val epsArr = d.optJSONArray("episodes") ?: m.optJSONArray("episodes") ?: JSONArray()
            val servers = mutableListOf<ServerItem>()
            for (i in 0 until epsArr.length()) {
                val s = epsArr.optJSONObject(i) ?: continue
                val sName = s.optString("server_name", "Vietsub")
                val itemsArr = s.optJSONArray("items") ?: s.optJSONArray("server_data") ?: JSONArray()
                val items = mutableListOf<EpisodeItem>()
                for (j in 0 until itemsArr.length()) {
                    val e = itemsArr.optJSONObject(j) ?: continue
                    val m3u8 = e.optString("link_m3u8").ifEmpty { e.optString("m3u8") }
                        .ifEmpty { Utils.extractUrlParam(e.optString("link_embed").ifEmpty { e.optString("embed") }) }
                    val embed = e.optString("link_embed").ifEmpty { e.optString("embed") }
                    items.add(
                        EpisodeItem(
                            name = e.optString("name").ifEmpty { null },
                            slug = e.optString("slug").ifEmpty { null },
                            m3u8 = m3u8.takeIf { !it.isNullOrBlank() },
                            embed = embed.takeIf { !it.isNullOrBlank() }
                        )
                    )
                }
                servers.add(ServerItem(sName, items))
            }

            val cdn = d.optString("APP_DOMAIN_CDN_IMAGE").ifEmpty { cfg.cdnImage }
            val mType = m.optString("type")
            val type = if (mType in listOf("series", "hoathinh", "tvshows")) "series" else "movie"

            val categories = mutableListOf<String>()
            val catArr = m.optJSONArray("category")
            if (catArr != null) {
                for (i in 0 until catArr.length()) {
                    val c = catArr.optJSONObject(i)
                    val cName = c?.optString("name") ?: c?.optString("slug")
                    if (!cName.isNullOrBlank()) categories.add(cName)
                }
            }

            val posterUrl = m.optString("poster_url").ifEmpty { null }
            val thumbUrl = m.optString("thumb_url").ifEmpty { null }
            val posterCdn = if (posterUrl != null && Regex("^https?:", RegexOption.IGNORE_CASE).containsMatchIn(posterUrl)) null else cdn
            val thumbCdn = if (thumbUrl != null && Regex("^https?:", RegexOption.IGNORE_CASE).containsMatchIn(thumbUrl)) null else cdn
            val mSlug = m.optString("slug", slug)
            val metaId = "$prefix$mSlug"

            MovieDetail(
                slug = mSlug,
                name = m.optString("name").ifEmpty { null },
                originalName = m.optString("origin_name").ifEmpty { null },
                year = m.optInt("year").takeIf { it > 0 },
                type = type,
                quality = m.optString("quality").ifEmpty { null },
                lang = m.optString("lang").ifEmpty { null },
                time = m.optString("time").ifEmpty { null },
                poster = Utils.mapImageUrl(posterUrl, posterCdn),
                background = Utils.mapImageUrl(thumbUrl, thumbCdn),
                description = Utils.stripHtml(m.optString("content")),
                genres = categories,
                imdbId = m.optJSONObject("imdb")?.optString("id")?.takeIf { it.isNotBlank() },
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

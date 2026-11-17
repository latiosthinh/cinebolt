package com.cinebolt.tv.backend.providers

import com.cinebolt.tv.backend.*
import org.json.JSONArray
import org.json.JSONObject

class KkphimProvider(cfg: ProviderConfig) : BaseProvider(cfg) {

    companion object {
        val GENRE_MAP = mapOf(
            "Hành Động" to "hanh-dong",
            "Phiêu Lưu" to "phieu-luu",
            "Hài Hước" to "hai-huoc",
            "Cổ Trang" to "co-trang",
            "Tâm Lý" to "tam-ly",
            "Hình Sự" to "hinh-su",
            "Chiến Tranh" to "chien-tranh",
            "Võ Thuật" to "vo-thuat",
            "Viễn Tưởng" to "vien-tuong",
            "Khoa Học Viễn Tưởng" to "khoa-hoc-vien-tuong",
            "Kinh Dị" to "kinh-di",
            "Âm Nhạc" to "am-nhac",
            "Thần Thoại" to "than-thoai",
            "Tài Liệu" to "tai-lieu",
            "Gia Đình" to "gia-dinh",
            "Chính Kịch" to "chinh-kich",
            "Bí Ẩn" to "bi-an",
            "Học Đường" to "hoc-duong",
            "Kinh Điển" to "kinh-dien",
            "Tình Cảm" to "tinh-cam",
            "Hoạt Hình" to "hoat-hinh",
            "Thể Thao" to "the-thao"
        )

        val COUNTRY_ORDER = listOf(
            "Âu Mỹ", "Hàn Quốc", "Trung Quốc", "Nhật Bản", "Thái Lan", "Việt Nam", "Đài Loan", "Hồng Kông",
            "Ấn Độ", "Anh", "Pháp", "Ả Rập Xê Út", "Ba Lan", "Bồ Đào Nha", "Brazil", "Canada", "Châu Phi",
            "Đan Mạch", "Đức", "Hà Lan", "Indonesia", "Malaysia", "Mexico", "Na Uy", "Nam Phi", "Nga",
            "Philippines", "Tây Ban Nha", "Thổ Nhĩ Kỳ", "Thụy Điển", "Thụy Sĩ", "UAE", "Úc", "Ukraina",
            "Ý", "Quốc Gia Khác"
        )

        val COUNTRY_MAP = mapOf(
            "Anh" to "anh",
            "Ba Lan" to "ba-lan",
            "Brazil" to "brazil",
            "Bồ Đào Nha" to "bo-dao-nha",
            "Canada" to "canada",
            "Châu Phi" to "chau-phi",
            "Hà Lan" to "ha-lan",
            "Hàn Quốc" to "han-quoc",
            "Hồng Kông" to "hong-kong",
            "Indonesia" to "indonesia",
            "Malaysia" to "malaysia",
            "Mexico" to "mexico",
            "Na Uy" to "na-uy",
            "Nam Phi" to "nam-phi",
            "Nga" to "nga",
            "Nhật Bản" to "nhat-ban",
            "Philippines" to "philippines",
            "Pháp" to "phap",
            "Quốc Gia Khác" to "quoc-gia-khac",
            "Thái Lan" to "thai-lan",
            "Thổ Nhĩ Kỳ" to "tho-nhi-ky",
            "Thụy Sĩ" to "thuy-si",
            "Thụy Điển" to "thuy-dien",
            "Trung Quốc" to "trung-quoc",
            "Tây Ban Nha" to "tay-ban-nha",
            "UAE" to "uae",
            "Ukraina" to "ukraina",
            "Việt Nam" to "viet-nam",
            "Âu Mỹ" to "au-my",
            "Úc" to "uc",
            "Ý" to "y",
            "Đan Mạch" to "dan-mach",
            "Đài Loan" to "dai-loan",
            "Đức" to "duc",
            "Ả Rập Xê Út" to "a-rap-xe-ut",
            "Ấn Độ" to "an-do"
        )

        private data class CatalogEndpoint(val path: String, val type: String)
        private val CATALOG_ENDPOINTS = mapOf(
            "phim-le" to CatalogEndpoint("/v1/api/danh-sach/phim-le", "movie"),
            "chieu-rap" to CatalogEndpoint("/v1/api/danh-sach/phim-chieu-rap", "movie"),
            "phim-bo" to CatalogEndpoint("/v1/api/danh-sach/phim-bo", "series"),
            "hoat-hinh" to CatalogEndpoint("/v1/api/danh-sach/hoat-hinh", "series")
        )
    }

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

        return CatalogItem(
            slug = item.optString("slug"),
            name = item.optString("name").ifEmpty { null },
            originalName = item.optString("origin_name").ifEmpty { null },
            year = item.optInt("year").takeIf { it > 0 },
            type = type,
            poster = Utils.mapImageUrl(item.optString("poster_url"), cfg.cdnImage),
            background = Utils.mapImageUrl(item.optString("thumb_url"), cfg.cdnImage),
            imdbId = imdbId,
            quality = item.optString("quality").ifEmpty { null },
            lang = item.optString("lang").ifEmpty { null }
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
        return Utils.cached("kk:search:$q", 10 * 60 * 1000L) {
            val encodedQ = java.net.URLEncoder.encode(q, "UTF-8")
            val json = Utils.getJsonObject("${cfg.apiUrl}/v1/api/tim-kiem?keyword=$encodedQ&page=1&limit=24", headers)
            val itemsArr = json?.optJSONObject("data")?.optJSONArray("items") ?: return@cached emptyList()
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

        val genre = extra["genre"]
        val country = extra["country"]
        val sort = extra["sort"]
        val ep = CATALOG_ENDPOINTS[kind] ?: CATALOG_ENDPOINTS["phim-le"] ?: return CatalogResult(emptyList())

        val sb = StringBuilder("${cfg.apiUrl}${ep.path}?page=$page&limit=20")
        if (!genre.isNullOrBlank() && genre != "all") {
            val slug = GENRE_MAP[genre] ?: genre.lowercase(java.util.Locale.ROOT).replace(Regex("\\s+"), "-")
            sb.append("&category=").append(java.net.URLEncoder.encode(slug, "UTF-8"))
        }
        if (!country.isNullOrBlank() && country != "all") {
            val slug = COUNTRY_MAP[country] ?: country.lowercase(java.util.Locale.ROOT).replace(Regex("\\s+"), "-")
            sb.append("&country=").append(java.net.URLEncoder.encode(slug, "UTF-8"))
        }
        if (sort == "year_desc") {
            sb.append("&sort_field=year&sort_type=desc")
        } else if (sort == "year_asc") {
            sb.append("&sort_field=year&sort_type=asc")
        }

        val json = Utils.getJsonObject(sb.toString(), headers)
        val itemsArr = json?.optJSONObject("data")?.optJSONArray("items") ?: return CatalogResult(emptyList())
        val list = mutableListOf<MetaItem>()
        val defaultType = CATALOG_ENDPOINTS[kind]?.type ?: "movie"
        for (i in 0 until itemsArr.length()) {
            val it = itemsArr.optJSONObject(i) ?: continue
            list.add(toMeta(normalizeItem(it, defaultType)))
        }
        val pagination = Pagination.fromKKphim(json, fallbackPage = page, fallbackPageSize = 20)
        return CatalogResult(list, pagination)
    }

    override fun detail(slug: String): MovieDetail? {
        return Utils.cached("kk:detail:$slug", 60 * 60 * 1000L) {
            val encodedSlug = java.net.URLEncoder.encode(slug, "UTF-8")
            val json = Utils.getJsonObject("${cfg.apiUrl}/phim/$encodedSlug", headers)
            if (json == null || !json.optBoolean("status", false)) return@cached null
            val m = json.optJSONObject("movie") ?: return@cached null

            val epsArr = json.optJSONArray("episodes") ?: JSONArray()
            val servers = mutableListOf<ServerItem>()
            for (i in 0 until epsArr.length()) {
                val s = epsArr.optJSONObject(i) ?: continue
                val sName = s.optString("server_name", "Vietsub")
                val sData = s.optJSONArray("server_data") ?: JSONArray()
                val items = mutableListOf<EpisodeItem>()
                for (j in 0 until sData.length()) {
                    val e = sData.optJSONObject(j) ?: continue
                    items.add(
                        EpisodeItem(
                            name = e.optString("name").ifEmpty { null },
                            slug = e.optString("slug").ifEmpty { null },
                            filename = e.optString("filename").ifEmpty { null },
                            m3u8 = e.optString("link_m3u8").takeIf { it.isNotBlank() },
                            embed = e.optString("link_embed").takeIf { it.isNotBlank() }
                        )
                    )
                }
                servers.add(ServerItem(sName, items))
            }

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

            val actors = mutableListOf<String>()
            val actArr = m.optJSONArray("actor")
            if (actArr != null) {
                for (i in 0 until actArr.length()) {
                    val a = actArr.optString(i)
                    if (!a.isNullOrBlank()) actors.add(a)
                }
            }

            val directors = mutableListOf<String>()
            val dirArr = m.optJSONArray("director")
            if (dirArr != null) {
                for (i in 0 until dirArr.length()) {
                    val d = dirArr.optString(i)
                    if (!d.isNullOrBlank()) directors.add(d)
                }
            }

            val imdbId = m.optJSONObject("imdb")?.optString("id")?.takeIf { it.isNotBlank() }
            val metaId = "$prefix${m.optString("slug")}"

            MovieDetail(
                slug = m.optString("slug", slug),
                name = m.optString("name").ifEmpty { null },
                originalName = m.optString("origin_name").ifEmpty { null },
                year = m.optInt("year").takeIf { it > 0 },
                type = type,
                quality = m.optString("quality").ifEmpty { null },
                lang = m.optString("lang").ifEmpty { null },
                time = m.optString("time").ifEmpty { null },
                poster = Utils.mapImageUrl(m.optString("poster_url"), cfg.cdnImage),
                background = Utils.mapImageUrl(m.optString("thumb_url"), cfg.cdnImage),
                description = Utils.stripHtml(m.optString("content")),
                genres = categories,
                cast = actors.ifEmpty { null },
                director = directors.ifEmpty { null },
                imdbId = imdbId,
                servers = servers,
                videos = videosFromServers(servers, metaId)
            )
        }
    }

    override fun extractStreamItem(ep: EpisodeItem): ExtractedStream? {
        if (!ep.m3u8.isNullOrBlank()) return ExtractedStream(url = ep.m3u8)
        if (!ep.embed.isNullOrBlank()) {
            val inner = Utils.extractUrlParam(ep.embed)
            if (inner != null) return ExtractedStream(url = inner)
            return ExtractedStream(externalUrl = ep.embed)
        }
        return null
    }

    override fun streamsFromSlug(slug: String, type: String, season: Int?, episode: Int?): List<StreamItem> {
        val d = detail(slug) ?: return emptyList()
        return streamsFromDetail(d, season, episode)
    }
}

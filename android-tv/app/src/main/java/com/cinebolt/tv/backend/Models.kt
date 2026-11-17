package com.cinebolt.tv.backend

import org.json.JSONArray
import org.json.JSONObject

data class CatalogItem(
    val slug: String,
    val name: String?,
    val originalName: String? = null,
    val year: Int? = null,
    val type: String = "movie",
    val poster: String? = null,
    val background: String? = null,
    val imdbId: String? = null,
    val quality: String? = null,
    val lang: String? = null,
    val description: String? = null,
    val releaseInfo: String? = null
)

data class VideoItem(
    val id: String,
    val title: String,
    val season: Int,
    val episode: Int,
    val released: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("title", title)
        put("season", season)
        put("episode", episode)
        if (released != null) put("released", released)
    }
}

data class MetaItem(
    val id: String,
    var type: String,
    val name: String?,
    val poster: String? = null,
    val posterShape: String = "poster",
    val background: String? = null,
    val description: String? = null,
    val releaseInfo: String? = null,
    val genres: List<String>? = null,
    val runtime: String? = null,
    val cast: List<String>? = null,
    val director: List<String>? = null,
    val videos: List<VideoItem>? = null,
    val year: Int? = null,
    val imdbId: String? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("type", type)
        if (name != null) put("name", name)
        if (poster != null) put("poster", poster)
        put("posterShape", posterShape)
        if (background != null) put("background", background)
        if (description != null) put("description", description)
        if (releaseInfo != null) put("releaseInfo", releaseInfo)
        if (year != null) put("year", year)
        if (imdbId != null) put("imdbId", imdbId)
        if (genres != null && genres.isNotEmpty()) {
            val arr = JSONArray()
            genres.forEach { arr.put(it) }
            put("genres", arr)
        }
        if (runtime != null) put("runtime", runtime)
        if (cast != null && cast.isNotEmpty()) {
            val arr = JSONArray()
            cast.forEach { arr.put(it) }
            put("cast", arr)
        }
        if (director != null && director.isNotEmpty()) {
            val arr = JSONArray()
            director.forEach { arr.put(it) }
            put("director", arr)
        }
        if (videos != null && videos.isNotEmpty()) {
            val arr = JSONArray()
            videos.forEach { arr.put(it.toJson()) }
            put("videos", arr)
        }
    }
}

data class StreamItem(
    val name: String,
    var title: String,
    var url: String? = null,
    var externalUrl: String? = null,
    val behaviorHints: JSONObject = JSONObject(),
    val providerId: String? = null,
    val subtitles: JSONArray? = null
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("name", name)
        put("title", title)
        if (url != null) put("url", url)
        if (externalUrl != null) put("externalUrl", externalUrl)
        if (behaviorHints.length() > 0) put("behaviorHints", behaviorHints)
        if (subtitles != null) put("subtitles", subtitles)
    }
}

data class EpisodeItem(
    val name: String?,
    val slug: String?,
    val filename: String? = null,
    val m3u8: String? = null,
    val embed: String? = null
)

data class ServerItem(
    val serverName: String,
    val items: List<EpisodeItem>
)

data class MovieDetail(
    val slug: String,
    val name: String?,
    val originalName: String? = null,
    val year: Int? = null,
    var type: String = "movie",
    val quality: String? = null,
    val lang: String? = null,
    val time: String? = null,
    val poster: String? = null,
    val background: String? = null,
    val description: String? = null,
    val genres: List<String>? = null,
    val cast: List<String>? = null,
    val director: List<String>? = null,
    val imdbId: String? = null,
    val servers: List<ServerItem> = emptyList(),
    val videos: List<VideoItem>? = null,
    val nativeId: String? = null,
    val nativeVideos: List<JSONObject> = emptyList()
)

data class MatchOpts(
    val title: String,
    val year: Int? = null,
    val imdbId: String? = null,
    val type: String? = null,
    val season: Int? = null,
    val episode: Int? = null
)

data class Pagination(
    val page: Int,
    val totalPages: Int?,
    val totalItems: Int?,
    val pageSize: Int
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("page", page)
        if (totalPages != null) put("totalPages", totalPages) else put("totalPages", JSONObject.NULL)
        if (totalItems != null) put("totalItems", totalItems) else put("totalItems", JSONObject.NULL)
        put("pageSize", pageSize)
    }

    companion object {
        fun fromKKphim(json: JSONObject?, fallbackPage: Int = 1, fallbackPageSize: Int = 20): Pagination? {
            val pag = json?.optJSONObject("data")?.optJSONObject("params")?.optJSONObject("pagination") ?: return null
            val page = pag.optInt("currentPage").takeIf { it > 0 } ?: fallbackPage
            val totalPages = pag.optInt("totalPages").takeIf { it > 0 }
            val totalItems = pag.optInt("totalItems").takeIf { it >= 0 }
            val pageSize = pag.optInt("totalItemsPerPage").takeIf { it > 0 } ?: fallbackPageSize
            return Pagination(page = page, totalPages = totalPages, totalItems = totalItems, pageSize = pageSize)
        }

        fun fromPhim4k(json: JSONObject?, fallbackPage: Int = 1, fallbackPageSize: Int = 20): Pagination? {
            val pag = json?.optJSONObject("pagination") ?: return null
            val page = pag.optInt("currentPage").takeIf { it > 0 } ?: fallbackPage
            val totalPages = pag.optInt("totalPages").takeIf { it > 0 }
            val totalItems = pag.optInt("totalItems").takeIf { it >= 0 }
            val pageSize = pag.optInt("totalItemsPerPage").takeIf { it > 0 } ?: fallbackPageSize
            return Pagination(page = page, totalPages = totalPages, totalItems = totalItems, pageSize = pageSize)
        }

        fun fromNguonc(json: JSONObject?, fallbackPage: Int = 1, fallbackPageSize: Int = 10): Pagination? {
            val pag = json?.optJSONObject("paginate") ?: return null
            val page = pag.optInt("current_page").takeIf { it > 0 } ?: fallbackPage
            val totalPages = pag.optInt("total_page").takeIf { it > 0 }
            val totalItems = pag.optInt("total_items").takeIf { it >= 0 }
            val pageSize = pag.optInt("items_per_page").takeIf { it > 0 } ?: fallbackPageSize
            return Pagination(page = page, totalPages = totalPages, totalItems = totalItems, pageSize = pageSize)
        }
    }
}

data class CatalogResult(
    val metas: List<MetaItem>,
    val pagination: Pagination? = null
)

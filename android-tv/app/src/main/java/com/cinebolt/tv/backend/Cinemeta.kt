package com.cinebolt.tv.backend

import org.json.JSONObject

data class CinemetaMeta(
    val imdbId: String,
    val name: String,
    val year: Int?,
    val type: String,
    val runtime: String?,
    val description: String?
)

object Cinemeta {
    fun getMeta(type: String, imdbId: String): CinemetaMeta? {
        if (!Regex("^tt\\d+$").matches(imdbId)) return null
        return Utils.cached("cinemeta:$type:$imdbId", 24 * 3600 * 1000L) {
            val json = Utils.getJsonObject("${Config.CINEMETA_URL}/meta/$type/$imdbId.json", timeoutMs = Config.TIMEOUT_MS)
            val meta = json?.optJSONObject("meta") ?: return@cached null
            val name = meta.optString("name")
            if (name.isNullOrBlank()) return@cached null
            val releaseInfo = meta.optString("releaseInfo", "")
            val yearStr = meta.optString("year", "")
            val yearMatch = Regex("\\d{4}").find(if (releaseInfo.isNotEmpty()) releaseInfo else yearStr)
            val year = yearMatch?.value?.toIntOrNull()
            CinemetaMeta(
                imdbId = meta.optString("imdb_id", imdbId),
                name = name,
                year = year,
                type = type,
                runtime = if (meta.has("runtime")) meta.optString("runtime") else null,
                description = if (meta.has("description")) meta.optString("description") else null
            )
        }
    }
}

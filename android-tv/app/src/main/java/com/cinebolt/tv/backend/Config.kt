package com.cinebolt.tv.backend

data class ProviderConfig(
    val id: String,
    val name: String,
    val prefix: String,
    val apiUrl: String,
    val cdnImage: String? = null,
    val siteUrl: String? = null,
    val referer: String,
    val enabled: Boolean = true,
    val proxy: Boolean = false,
    val apiFallbacks: List<String> = emptyList()
)

object Config {
    const val DEFAULT_PORT = 7001
    const val TIMEOUT_MS = 8000L
    const val STREAM_TIMEOUT_MS = 9000L
    const val CINEMETA_URL = "https://v3-cinemeta.strem.io"
    const val USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"

    val proxyProviders = setOf("nguonc")

    val PROVIDERS = mapOf(
        "kkphim" to ProviderConfig(
            id = "kkphim",
            name = "KKphim",
            prefix = "kk_",
            apiUrl = "https://phimapi.com",
            cdnImage = "https://phimimg.com",
            referer = "https://phimapi.com/",
            enabled = true,
            proxy = false
        ),
        "ophim" to ProviderConfig(
            id = "ophim",
            name = "OPhim",
            prefix = "op_",
            apiUrl = "https://www.ophim.live",
            cdnImage = "https://img.ophim.live",
            siteUrl = "https://www.ophim.live",
            referer = "https://www.ophim.live/",
            enabled = true,
            proxy = false
        ),
        "nguonc" to ProviderConfig(
            id = "nguonc",
            name = "NguonC",
            prefix = "nc_",
            apiUrl = "https://phim.nguonc.com/api",
            apiFallbacks = listOf("https://nguonc.com/api"),
            siteUrl = "https://phim.nguonc.com",
            referer = "https://phim.nguonc.com/",
            enabled = true,
            proxy = true
        ),
        "vnstream" to ProviderConfig(
            id = "vnstream",
            name = "VnStream",
            prefix = "vn_",
            apiUrl = "https://egluy2hhb21vaw5ndw9pbmhl.darkbytes.xyz/api/v1",
            siteUrl = "https://cobephim.biz",
            referer = "https://cobephim.biz/",
            enabled = true,
            proxy = false
        ),
        "phim4k" to ProviderConfig(
            id = "phim4k",
            name = "Phim4K",
            prefix = "p4k_",
            apiUrl = "https://vsmov.com/api",
            siteUrl = "https://vsmov.com",
            referer = "https://vsmov.com/",
            enabled = true,
            proxy = false
        ),
        "tophim" to ProviderConfig(
            id = "tophim",
            name = "Tophim (Motchill)",
            prefix = "tp_",
            apiUrl = "https://tophim.top",
            referer = "https://tophim.top/",
            enabled = true,
            proxy = false
        ),
        "k20" to ProviderConfig(
            id = "k20",
            name = "K20",
            prefix = "k20_",
            apiUrl = "https://sc.k-20.xyz",
            referer = "https://sc.k-20.xyz/",
            enabled = true,
            proxy = false
        )
    )

    object Manifest {
        const val ID = "community.vietstream"
        const val VERSION = "1.1.0"
        const val NAME = "VietStream · Phim Việt"
        const val DESCRIPTION = "Xem phim Việt đa nguồn: KKphim, K20, Xem20 (tùy chọn), OPhim, NguonC, Phim4K, Tophim, VnStream — Vietsub, Lồng tiếng, Thuyết minh. Tương thích Nuvio & Stremio."
    }
}

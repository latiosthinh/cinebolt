package com.cinebolt.tv.backend

import com.cinebolt.tv.backend.providers.K20Provider
import org.junit.Assert.*
import org.junit.Test

class BackendTest {

    @Test
    fun testPhim4kImageMapping() {
        val bareUrl = "https://vsmov.com/storage/images/yBs55noyT0J3l5gPhrwVOasjPDj.jpg"
        val poster = com.cinebolt.tv.backend.providers.Phim4kProvider.mapPoster(bareUrl)
        val bg = com.cinebolt.tv.backend.providers.Phim4kProvider.mapBackground(bareUrl)
        assertEquals("https://image.tmdb.org/t/p/w342/yBs55noyT0J3l5gPhrwVOasjPDj.jpg", poster)
        assertEquals("https://image.tmdb.org/t/p/w1280/yBs55noyT0J3l5gPhrwVOasjPDj.jpg", bg)

        val prefixedUrl = "https://vsmov.com/storage/images/thumb_abc123.jpg"
        val prefixedPoster = com.cinebolt.tv.backend.providers.Phim4kProvider.mapPoster(prefixedUrl)
        assertEquals(prefixedUrl, prefixedPoster)
    }

    @Test
    fun testNormTitle() {
        assertEquals("harry potter va hon da phu thuy", Utils.normTitle("Harry Potter và Hòn Đá Phù Thủy"))
        assertEquals("tham tu lung danh conan", Utils.normTitle("Thám Tử Lừng Danh Conan"))
        assertEquals("doremon", Utils.normTitle("Đôrêmon"))
    }

    @Test
    fun testDetectAudio() {
        assertEquals("Vietsub", Utils.detectAudio("Server #1 - Vietsub"))
        assertEquals("Thuyết Minh", Utils.detectAudio("Server TM"))
        assertEquals("Lồng Tiếng", Utils.detectAudio("Lồng tiếng HD"))
        assertEquals("Song Ngữ", Utils.detectAudio("Bản Song Ngữ"))
    }

    @Test
    fun testParseEpNum() {
        assertEquals(12, Utils.parseEpNum("Tập 12"))
        assertEquals(5, Utils.parseEpNum("tap-5"))
        assertNull(Utils.parseEpNum("Full"))
    }

    @Test
    fun testBase64Url() {
        val original = "https://example.com/playlist.m3u8?token=xyz"
        val enc = Utils.b64e(original)
        assertFalse(enc.contains("+"))
        assertFalse(enc.contains("/"))
        assertFalse(enc.contains("="))
        val dec = Utils.b64d(enc)
        assertEquals(original, dec)
    }

    @Test
    fun testParseId() {
        val router = Router { "http://127.0.0.1:7001" }

        val p1 = router.parseId("kk_conan")
        assertNotNull(p1)
        assertEquals("kkphim", p1?.provider?.id)
        assertEquals("conan", p1?.slug)
        assertEquals(1, p1?.season)
        assertEquals(1, p1?.episode)

        val p2 = router.parseId("nc_film:1:15.json")
        assertNotNull(p2)
        assertEquals("nguonc", p2?.provider?.id)
        assertEquals("film", p2?.slug)
        assertEquals(1, p2?.season)
        assertEquals(15, p2?.episode)

        val p3 = router.parseId("tt0123456:2:8")
        assertNotNull(p3)
        assertNull(p3?.provider)
        assertEquals("tt0123456", p3?.imdbId)
        assertEquals(2, p3?.season)
        assertEquals(8, p3?.episode)
    }

    @Test
    fun testPaginationParsing() {
        // KKphim shape
        val kkJson = org.json.JSONObject("""
            {"data":{"params":{"pagination":{"totalItems":17267,"totalItemsPerPage":20,"currentPage":2,"totalPages":864}}}}
        """.trimIndent())
        val kkPag = Pagination.fromKKphim(kkJson)
        assertNotNull(kkPag)
        assertEquals(2, kkPag?.page)
        assertEquals(864, kkPag?.totalPages)
        assertEquals(17267, kkPag?.totalItems)
        assertEquals(20, kkPag?.pageSize)

        // Phim4K shape
        val p4kJson = org.json.JSONObject("""
            {"pagination":{"totalItems":38433,"totalItemsPerPage":20,"currentPage":3,"totalPages":1922}}
        """.trimIndent())
        val p4kPag = Pagination.fromPhim4k(p4kJson)
        assertNotNull(p4kPag)
        assertEquals(3, p4kPag?.page)
        assertEquals(1922, p4kPag?.totalPages)
        assertEquals(38433, p4kPag?.totalItems)
        assertEquals(20, p4kPag?.pageSize)

        // NguonC shape
        val ncJson = org.json.JSONObject("""
            {"paginate":{"current_page":4,"total_page":1871,"total_items":18708,"items_per_page":10}}
        """.trimIndent())
        val ncPag = Pagination.fromNguonc(ncJson)
        assertNotNull(ncPag)
        assertEquals(4, ncPag?.page)
        assertEquals(1871, ncPag?.totalPages)
        assertEquals(18708, ncPag?.totalItems)
        assertEquals(10, ncPag?.pageSize)

        // Null totalPages serialization
        val k20Pag = Pagination(page = 1, totalPages = null, totalItems = null, pageSize = 20)
        val k20Json = k20Pag.toJson()
        assertTrue(k20Json.isNull("totalPages"))
        assertTrue(k20Json.isNull("totalItems"))
        assertEquals(1, k20Json.getInt("page"))
    }

    @Test
    fun testParseExtra() {
        val router = Router { "http://127.0.0.1:7001" }
        val extra = router.parseExtra("genre=H%C3%A0nh%20%C4%90%E1%BB%99ng&country=H%C3%A0n%20Qu%E1%BB%91c&sort=year_desc&skip=20.json")
        assertEquals("Hành Động", extra["genre"])
        assertEquals("Hàn Quốc", extra["country"])
        assertEquals("year_desc", extra["sort"])
        assertEquals("20", extra["skip"])
    }

    @Test
    fun testK20NativeId() {
        val slug = K20Provider.encodeNativeId("series", "12345")
        val decoded = K20Provider.decodeNativeId(slug)
        assertNotNull(decoded)
        assertEquals("series", decoded?.first)
        assertEquals("12345", decoded?.second)
    }

    @Test
    fun testManifestStructure() {
        val router = Router { "http://127.0.0.1:7001" }
        val manifest = router.buildManifest("http://127.0.0.1:7001")
        assertEquals("community.vietstream", manifest.getString("id"))
        assertEquals("1.1.0", manifest.getString("version"))
        assertTrue(manifest.has("catalogs"))
        assertTrue(manifest.getJSONArray("catalogs").length() >= 10)
    }

    @Test
    fun testLiveProviders() {
        val router = Router { "http://127.0.0.1:7001" }

        // KKphim
        val kk = router.providers["kkphim"]!!
        val kkSearch = kk.search("conan")
        println("KKphim search results: ${kkSearch.size}")
        assertTrue(kkSearch.isNotEmpty())
        val kkDetail = kk.detail(kkSearch[0].slug)
        assertNotNull(kkDetail)
        println("KKphim detail: ${kkDetail?.name}, servers: ${kkDetail?.servers?.size}, videos: ${kkDetail?.videos?.size}")

        // OPhim
        val op = router.providers["ophim"]!!
        val opSearch = op.search("conan")
        println("OPhim search results: ${opSearch.size}")
        if (opSearch.isNotEmpty()) {
            val opDetail = op.detail(opSearch[0].slug)
            println("OPhim detail: ${opDetail?.name}")
        }

        // NguonC
        val nc = router.providers["nguonc"]!!
        val ncSearch = nc.search("conan")
        println("NguonC search results: ${ncSearch.size}")
        if (ncSearch.isNotEmpty()) {
            val ncDetail = nc.detail(ncSearch[0].slug)
            println("NguonC detail: ${ncDetail?.name}")
        }

        // Phim4K
        val p4k = router.providers["phim4k"]!!
        val p4kSearch = p4k.search("conan")
        println("Phim4K search results: ${p4kSearch.size}")
        if (p4kSearch.isNotEmpty()) {
            val p4kDetail = p4k.detail(p4kSearch[0].slug)
            println("Phim4K detail: ${p4kDetail?.name}")
        }

        // Tophim
        val tp = router.providers["tophim"]!!
        val tpSearch = tp.search("conan")
        println("Tophim search results: ${tpSearch.size}")
        if (tpSearch.isNotEmpty()) {
            val tpDetail = tp.detail(tpSearch[0].slug)
            println("Tophim detail: ${tpDetail?.name}")
        }

        // VnStream
        val vn = router.providers["vnstream"]!!
        val vnSearch = vn.search("conan")
        println("VnStream search results: ${vnSearch.size}")
        if (vnSearch.isNotEmpty()) {
            val vnDetail = vn.detail(vnSearch[0].slug)
            println("VnStream detail: ${vnDetail?.name}")
        }
    }

    @Test
    fun testRouterRoutes() {
        val router = Router { "http://127.0.0.1:7001" }

        // Home catalog
        val cat1 = router.handleCatalog("movie", "kkphim-phim-le.json", null, emptyMap())
        val metas1 = cat1.getJSONArray("metas")
        println("kkphim-phim-le metas: ${metas1.length()}")
        assertTrue(metas1.length() > 0)

        // Search catalog
        val catSearch = router.handleCatalog("movie", "kkphim-phim-le", "search=conan.json", emptyMap())
        val searchMetas = catSearch.getJSONArray("metas")
        println("search conan metas: ${searchMetas.length()}")
        assertTrue(searchMetas.length() > 0)

        // Meta route
        val firstId = searchMetas.getJSONObject(0).getString("id")
        println("Testing meta for id: $firstId")
        val metaRes = router.handleMeta("movie", firstId)
        assertNotNull(metaRes)
        val metaObj = metaRes!!.getJSONObject("meta")
        println("Meta name: ${metaObj.optString("name")}, type: ${metaObj.optString("type")}")
        assertTrue(metaObj.has("name"))

        // Stream route
        val streamRes = router.handleStream(metaObj.optString("type", "movie"), firstId, "http://127.0.0.1:7001")
        val streams = streamRes.getJSONArray("streams")
        println("Streams count for $firstId: ${streams.length()}")
        if (streams.length() > 0) {
            val s0 = streams.getJSONObject(0)
            println("Stream[0] name: ${s0.optString("name")}, url: ${s0.optString("url")}")
            assertTrue(s0.has("url") || s0.has("externalUrl"))
        }
    }

    @Test
    fun testEmbeddedHttpServer() {
        val server = EmbeddedServer.start(7005)
        val url = EmbeddedServer.url
        println("Embedded server started at: $url")
        try {
            // Manifest
            val manifestText = Utils.getText("$url/manifest.json")
            assertNotNull(manifestText)
            assertTrue(manifestText!!.contains("community.vietstream"))

            // Catalog
            val catText = Utils.getText("$url/catalog/movie/kkphim-phim-le.json")
            assertNotNull(catText)
            assertTrue(catText!!.contains("metas"))

            // CORS headers check
            val req = okhttp3.Request.Builder().url("$url/manifest.json").build()
            Utils.httpClient.newCall(req).execute().use { resp ->
                assertEquals("*", resp.header("Access-Control-Allow-Origin"))
            }
        } finally {
            EmbeddedServer.stop()
        }
    }
}

// Dependency-free regression checks for data, rendering and asynchronous navigation.
const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const nodes = new Map();
function node() {return {value:'',innerHTML:'',textContent:'',hidden:false,inert:false,style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},contains(){return false;}},setAttribute(){},addEventListener(){},querySelector(){return node();},querySelectorAll(){return [];},focus(){},append(){},removeAttribute(){},load(){},pause(){}};}
const storage = new Map();
const context = vm.createContext({console,URL,AbortController,setTimeout,clearTimeout,location:{hostname:'localhost',protocol:'http:'},window:{scrollTo(){}},document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node,body:node(),querySelectorAll(){return [];},addEventListener(){}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},fetch:async()=>({ok:true,json:async()=>({metas:[]})})});
const source=fs.readFileSync('UI/app.js','utf8').replace(/openTab\(1\);\s*$/,'');
vm.runInContext(source,context);
vm.runInContext(fs.readFileSync('UI/player.js','utf8'),context);
// Each check starts with an empty catalog cache so mocked responses apply; the cache itself is checked with raw.
const raw = code => vm.runInContext(code,context);
const run = code => { raw('apiCache.clear()'); return raw(code); };
(async()=>{
  assert.equal(run("mapMeta({id:'a',name:'Phim',genres:['Action']}).g"),'Hành động');
  assert.equal(run("mapMeta({id:'a'}).y"),'');
  assert.equal(run("mapMeta({id:'a'}).hd"),'');
  assert.equal(run('timeLabel(3671)'),'1:01:11');
  assert.equal(run('timeLabel(Infinity)'),'--:--');
  nodes.get('video').duration=30;nodes.get('video').currentTime=20;
  run('seekPlayer(20)');assert.equal(nodes.get('video').currentTime,30);
  run('seekPlayer(-40)');assert.equal(nodes.get('video').currentTime,0);
  nodes.get('video').duration=Infinity;run('seekPlayer(10)');assert.equal(nodes.get('video').currentTime,0);
  // Manual hide must work while paused; automatic hide must preserve paused controls.
  const playerClasses=new Set(['open','ui-visible']);
  const oldClasses=nodes.get('player').classList;
  nodes.get('player').classList={contains:c=>playerClasses.has(c),add:(...cs)=>cs.forEach(c=>playerClasses.add(c)),remove:(...cs)=>cs.forEach(c=>playerClasses.delete(c))};
  nodes.get('video').paused=true;run("$('playerLoading').hidden=true;hidePlayerControls()");assert(playerClasses.has('ui-visible'));
  run('hidePlayerControls(true)');assert(!playerClasses.has('ui-visible'));assert(nodes.get('playerControls').inert);
  run("showPlayerControls('playerToggle')");assert(playerClasses.has('ui-visible'));assert(!nodes.get('playerControls').inert);
  // Down from the bottom control row hides the controls.
  run("$('playerToggle').id='playerToggle';document.activeElement=$('playerToggle');handlePlayerKey({key:'ArrowDown',preventDefault(){}})");assert(!playerClasses.has('ui-visible'));
  nodes.get('player').classList=oldClasses;
  const markup=run('card(mapMeta({id:\'"<img>\',name:\'<script>alert(1)</script>\'}),2,0)');
  assert(!markup.includes('<script>'));assert(!markup.includes('data-item="movie:"<'));
  run("saveItem(mapMeta({id:'a',name:'Phim'}))");assert.equal(JSON.parse(storage.get('cinebolt.saved')).length,1);
  run("saveItem(mapMeta({id:'a',name:'Phim'}))");assert.equal(JSON.parse(storage.get('cinebolt.saved')).length,0);
  let calls=[];
  context.fetch=async url=>{calls.push(url);return {ok:true,json:async()=>({metas:[{id:url,name:'Tên phim',type:url.includes('/series/')?'series':'movie'}]})};};
  await run('openTab(2)');assert.equal(calls.length,1);assert(calls[0].includes('kkphim') && calls[0].includes('/movie/'));
  calls=[];await run('openTab(3)');assert.equal(calls.length,1);assert(calls[0].includes('kkphim') && calls[0].includes('/series/'));
  calls=[];await run('openTab(4)');assert.equal(calls.length,1);assert(calls[0].includes('kkphim-hoat-hinh'));
  // Category tabs: page bar, unknown-total mode, 12-item slicing, NguonC 10-page, Tat ca windows, country filter
  calls=[];
  await raw('openTab(2)');
  assert.equal(calls.length,0); // re-opening a tab is served from the in-memory catalog cache
  await run('openTab(2)');
  assert.equal(calls.length,1); // and refetches once the cache is empty

  // Page numbers and ellipses
  assert.deepEqual(JSON.parse(run('JSON.stringify(generatePageNumbers(5, 864))')), [1, '…', 4, 5, 6, '…', 864]);
  assert.deepEqual(JSON.parse(run('JSON.stringify(generatePageNumbers(1, 864))')), [1, 2, 3, '…', 864]);
  assert.deepEqual(JSON.parse(run('JSON.stringify(generatePageNumbers(864, 864))')), [1, '…', 862, 863, 864]);
  assert.deepEqual(JSON.parse(run('JSON.stringify(generatePageNumbers(3, 5))')), [1, 2, 3, 4, 5]);

  // Unknown-total mode
  const unkBar = run('renderPageBar(5, null, true, 8)');
  assert(unkBar.includes('Trang 5'));
  assert(unkBar.includes('data-action="firstPage"'));
  assert(unkBar.includes('data-action="prevPage"'));
  assert(unkBar.includes('data-action="nextPage"'));
  assert(!unkBar.includes('data-action="goToPage"'));

  // First page button disabled on page 1, enabled on page 2
  const p1Bar = run('renderPageBar(1, 100, true, 8)');
  assert(p1Bar.includes('data-action="firstPage"') && p1Bar.includes('disabled'));
  assert(p1Bar.includes('data-action="prevPage"') && p1Bar.includes('disabled'));
  const p2Bar = run('renderPageBar(2, 100, true, 8)');
  assert(p2Bar.includes('data-action="firstPage"') && !p2Bar.includes('data-action="firstPage" disabled') && !p2Bar.includes('disabled aria-disabled'));

  // Reset to page 1 on filter change
  run('catState.page = 5; tabFilters[2].page = 5');
  await run("selectCategoryFilter('source','phim4k')");
  assert.equal(run('catState.page'), 1);

  // First-page button jumps to page 1
  run('catState.page = 4; tabFilters[2].page = 4');
  await run('goToCategoryPage(1)');
  assert.equal(run('catState.page'), 1);

  // 10-item slicing spanning two upstream pages
  // Testing fetchSourceSlice directly: startIdx 15, count 10 on pageSize 20 spans skip=0 and skip=20
  calls = [];
  context.fetch = async url => {
    calls.push(url);
    const skipMatch = url.match(/skip=(\d+)/);
    const skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    return {
      ok: true,
      json: async () => ({
        metas: Array.from({ length: 20 }, (_, i) => ({ id: 'kk_' + (skip + i + 1), name: 'Phim ' + (skip + i + 1) })),
        pagination: { currentPage: Math.floor(skip / 20) + 1, totalPages: 10, totalItems: 200, totalItemsPerPage: 20 }
      })
    };
  };
  const sliceRes = await run("fetchSourceSlice('movie', 'kkphim-phim-le', null, null, null, 15, 10, 20)");
  assert.equal(calls.length, 2); // fetches skip=0 and skip=20 to cover items [15, 25)
  assert.equal(sliceRes.items.length, 10);
  assert.equal(sliceRes.items[0].id, 'kk_16');
  assert.equal(sliceRes.items[9].id, 'kk_25');

  // KKphim category page 2: startIdx 10, count 10 -> items [10, 20)
  await run("selectCategoryFilter('source','kkphim')");
  calls = [];
  await run('goToCategoryPage(2)');
  assert.equal(calls.length, 1); // items [10, 20) fall within skip=0
  assert.equal(run('catState.items.length'), 10);
  assert.equal(run('catState.items[0].id'), 'kk_11');
  assert.equal(run('catState.items[9].id'), 'kk_20');
  assert.equal(run('catState.totalPages'), Math.ceil(200 / 10)); // 20 pages

  // NguonC 10-page slicing (P=10, page 1 covers [0, 10))
  calls = [];
  context.fetch = async url => {
    calls.push(url);
    const skipMatch = url.match(/skip=(\d+)/);
    const skip = skipMatch ? parseInt(skipMatch[1], 10) : 0;
    return {
      ok: true,
      json: async () => ({
        metas: Array.from({ length: 10 }, (_, i) => ({ id: 'nc_' + (skip + i + 1), name: 'NC ' + (skip + i + 1) })),
        pagination: { current_page: Math.floor(skip / 10) + 1, total_page: 25, total_items: 250, items_per_page: 10 }
      })
    };
  };
  await run("selectCategoryFilter('source','nguonc')");
  assert.equal(calls.length, 1); // fetches skip=0 to cover 10 items
  assert.equal(run('catState.items.length'), 10);
  assert.equal(run('catState.items[0].id'), 'nc_1');
  assert.equal(run('catState.items[9].id'), 'nc_10');
  assert.equal(run('catState.totalPages'), Math.ceil(250 / 10)); // 25 pages

  // Tat ca windows: multi-source windowing with over-fetching
  // Test case: one source is empty and two sources overlap -> still 10 items
  calls = [];
  context.fetch = async url => {
    calls.push(url);
    if (url.includes('phim4k')) {
      return { ok: true, json: async () => ({ metas: [], pagination: { currentPage: 1, totalPages: 0, totalItems: 0, totalItemsPerPage: 20 } }) };
    }
    if (url.includes('k20')) {
      // Overlaps with nguonc (same name + year)
      return {
        ok: true,
        json: async () => ({
          metas: Array.from({ length: 5 }, (_, i) => ({ id: 'k20_' + i, name: 'Phim Chung ' + i, y: 2026 })),
          pagination: { currentPage: 1, totalPages: 10, totalItems: 50, totalItemsPerPage: 20 }
        })
      };
    }
    if (url.includes('nguonc')) {
      return {
        ok: true,
        json: async () => ({
          metas: Array.from({ length: 5 }, (_, i) => ({ id: 'nc_' + i, name: 'Phim Chung ' + i, y: 2026 })),
          pagination: { current_page: 1, total_page: 10, total_items: 50, items_per_page: 10 }
        })
      };
    }
    // kkphim
    return {
      ok: true,
      json: async () => ({
        metas: Array.from({ length: 5 }, (_, i) => ({ id: 'kk_' + i, name: 'Phim KK ' + i, y: 2026 })),
        pagination: { currentPage: 1, totalPages: 10, totalItems: 50, totalItemsPerPage: 20 }
      })
    };
  };
  run("tabFilters[2].sort = 'default'");
  await run("selectCategoryFilter('source','all')");
  assert.equal(run('catState.items.length'), 10);
  assert.equal(run('catState.totalPages'), Math.ceil(50 / 5)); // 10 pages
  run("tabFilters[2].sort = 'year_desc'");

  // Country filter URL format on KKphim
  await run("selectCategoryFilter('source','kkphim')");
  calls = [];
  await run("selectCategoryFilter('country','Hàn Quốc')");
  assert.equal(calls.length, 1);
  assert(calls[0].includes('country=H%C3%A0n%20Qu%E1%BB%91c'));

  // Genre + Country combined
  calls = [];
  await run("selectCategoryFilter('genre','Hành Động')");
  assert.equal(calls.length, 1);
  assert(calls[0].includes('genre=H%C3%A0nh%20%C4%90%E1%BB%99ng') && calls[0].includes('country=H%C3%A0n%20Qu%E1%BB%91c'));

  // Filter change drops stale responses
  let pendingCat = [];
  context.fetch = url => new Promise(resolve => pendingCat.push(() => resolve({ ok: true, json: async () => ({ metas: [{ id: 'stale_item', name: 'Stale' }] }) })));
  const pStale = run("selectCategoryFilter('source','k20')");
  context.fetch = async url => ({ ok: true, json: async () => ({ metas: [{ id: 'fresh_item', name: 'Fresh' }] }) });
  await run("selectCategoryFilter('source','phim4k')");
  pendingCat.forEach(r => r());
  await pStale;
  assert.equal(run('catState.source'), 'phim4k');
  assert(run("catState.items.every(x => x.id !== 'stale_item')"));

  // Cross-source dedupe: prefers KKphim over others, NguonC over K20
  const dupList = [
    { id: 'nc_phai-song', t: 'Phải Sống', y: 1994 },
    { id: 'k20_phai-song', t: 'Phải Sống (1994)', y: 1994 },
    { id: 'kk_phai-song', t: 'Phải Sống', y: 1994 },
    { id: 'p4k_other', t: 'Phim Khác', y: 2026 }
  ];
  const deduped = run(`dedupeCategoryItems(${JSON.stringify(dupList)})`);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, 'kk_phai-song'); // KKphim preferred
  assert.equal(deduped[1].id, 'p4k_other');
  // Continue watching: unfinished films and series in progress, newest first; finished or barely started films are left out.
  raw(`historyMap={};progressMap={};watchedMap={};
    rememberHistory({id:'kk_a',t:'Phim A',type:'movie'}); saveProgress('kk_a',600,3600);
    rememberHistory({id:'kk_b',t:'Phim B',type:'movie'}); saveProgress('kk_b',3590,3600);
    rememberHistory({id:'kk_c',t:'Phim C',type:'movie'}); saveProgress('kk_c',10,3600);
    rememberHistory({id:'kk_s',t:'Bộ S',type:'series'}); rememberEpisode({id:'kk_s',type:'series'},{id:'kk_s:1:3',title:'Tập 03'}); saveProgress('kk_s:1:3',300,2700);
    historyMap['movie:kk_a'].at=1; historyMap['series:kk_s'].at=2;`);
  const cont = JSON.parse(raw('JSON.stringify(continueList())'));
  assert.equal(cont.map(c => c.x.id).join(','), 'kk_s,kk_a');
  assert.equal(cont[0].sub, 'Tập 03 · còn 40 phút');
  assert(cont[1].resume && Math.abs(cont[1].progress - 1/6) < 1e-9);
  raw('historyMap={};progressMap={};watchedMap={}');
  // Same entry repeated across upstream page boundaries (same id) must appear only once.
  const sameId = run(`dedupeCategoryItems(${JSON.stringify([
    { id: 'kk_ke-hoi-sinh', t: 'Kẻ Hồi Sinh', y: 2026 },
    { id: 'kk_ma-tu', t: 'Ma Tù', y: 2026 },
    { id: 'kk_ke-hoi-sinh', t: 'Kẻ Hồi Sinh', y: 2026 }
  ])})`);
  assert.equal(sameId.map(x => x.id).join(','), 'kk_ke-hoi-sinh,kk_ma-tu');

  // Dropdown filter popup tests: open/close, Back cancels without changes, selecting resets to page 1, hidden for non-KKphim, clear filters
  // 1. Open / close
  run("openFilterPopup('genre')");
  assert.equal(run('popupState?.type'), 'genre');
  assert.equal(nodes.get('filterPopup').hidden, false);
  run("closeFilterPopup(null)");
  assert.equal(run('popupState'), null);
  assert.equal(nodes.get('filterPopup').hidden, true);

  // 2. Back cancels without changes
  run("tabFilters[2].genre = 'all'");
  run("openFilterPopup('genre')");
  assert.equal(run('popupState?.type'), 'genre');
  run("closeFilterPopup(null)"); // Escape/Back cancels
  assert.equal(run("tabFilters[2].genre"), 'all');
  assert.equal(run('popupState'), null);

  // 3. Selecting resets to page 1
  run("tabFilters[2].page = 4");
  run("openFilterPopup('genre')");
  await run("closeFilterPopup('Hành Động')");
  assert.equal(run("tabFilters[2].genre"), 'Hành Động');
  assert.equal(run("catState.page"), 1);

  // 4. Genre and country dropdown buttons hidden for non-KKphim sources
  await run("selectCategoryFilter('source','phim4k')");
  let filterBarHtml = nodes.get('shelves').innerHTML;
  assert(!filterBarHtml.includes('data-dropdown="genre"'));
  assert(!filterBarHtml.includes('data-dropdown="country"'));
  assert(filterBarHtml.includes('data-dropdown="source"'));
  await run("selectCategoryFilter('source','all')");
  let filterBarHtmlAll = nodes.get('shelves').innerHTML;
  assert(filterBarHtmlAll.includes('data-dropdown="genre"'));
  assert(filterBarHtmlAll.includes('data-dropdown="country"'));

  // 5. Clear filters button resets to default sort (year_desc) and page 1
  await run("selectCategoryFilter('genre','Hành Động')");
  assert(nodes.get('shelves').innerHTML.includes('clearFilters'));
  await run("clearCategoryFilters()");
  assert.equal(run("tabFilters[2].source"), 'all');
  assert.equal(run("tabFilters[2].genre"), 'all');
  assert.equal(run("tabFilters[2].country"), 'all');
  assert.equal(run("tabFilters[2].sort"), 'year_desc'); // default sort is year_desc
  assert.equal(run("catState.page"), 1);
  assert(!nodes.get('shelves').innerHTML.includes('clearFilters'));

  // 6. Sort tests: default sort is year_desc, sort URL for KKphim
  assert.equal(run("catState.sort"), 'year_desc');
  context.fetch = async url => { calls.push(url); return { ok: true, json: async () => ({ metas: [] }) }; };
  await run("selectCategoryFilter('source','kkphim')");
  calls = [];
  await run("selectCategoryFilter('sort','year_asc')");
  assert.equal(calls.length, 1);
  assert(calls[0].includes('sort=year_asc'));
  calls = [];
  await run("selectCategoryFilter('sort','year_desc')");
  assert.equal(calls.length, 1);
  assert(calls[0].includes('sort=year_desc'));

  // 7. Client-side name sort (Vietnamese order) and year sort with missing years last
  const testSortList = [
    { t: 'Đất Rừng Phương Nam', y: 2023 },
    { t: 'Áo Lụa Hà Đông', y: 2006 },
    { t: 'Bố Già', y: '' },
    { t: 'Cánh Đồng Hoang', y: 1979 }
  ];
  assert.deepEqual(
    JSON.parse(run(`JSON.stringify(sortCategoryItems(${JSON.stringify(testSortList)}, 'name_asc').map(x=>x.t))`)),
    ['Áo Lụa Hà Đông', 'Bố Già', 'Cánh Đồng Hoang', 'Đất Rừng Phương Nam']
  );
  assert.deepEqual(
    JSON.parse(run(`JSON.stringify(sortCategoryItems(${JSON.stringify(testSortList)}, 'name_desc').map(x=>x.t))`)),
    ['Đất Rừng Phương Nam', 'Cánh Đồng Hoang', 'Bố Già', 'Áo Lụa Hà Đông']
  );
  assert.deepEqual(
    JSON.parse(run(`JSON.stringify(sortCategoryItems(${JSON.stringify(testSortList)}, 'year_desc').map(x=>x.t))`)),
    ['Đất Rừng Phương Nam', 'Áo Lụa Hà Đông', 'Cánh Đồng Hoang', 'Bố Già']
  );
  assert.deepEqual(
    JSON.parse(run(`JSON.stringify(sortCategoryItems(${JSON.stringify(testSortList)}, 'year_asc').map(x=>x.t))`)),
    ['Cánh Đồng Hoang', 'Áo Lụa Hà Đông', 'Đất Rừng Phương Nam', 'Bố Già']
  );

  // 8. Sort change resets to page 1
  run("catState.page = 4; tabFilters[2].page = 4");
  await run("selectCategoryFilter('sort','name_asc')");
  assert.equal(run("catState.page"), 1);
  assert.equal(run("tabFilters[2].sort"), 'name_asc');

  // 9. Xoá lọc resets sort to year_desc
  await run("clearCategoryFilters()");
  assert.equal(run("tabFilters[2].sort"), 'year_desc');
  assert.equal(run("catState.page"), 1);

  // 10. Right/Left between panel and grid (closestVertically)
  const v1 = run("closestVertically([{id:'a',top:100,bottom:150},{id:'b',top:300,bottom:350}], {top:290,bottom:320})");
  assert.equal(v1.id, 'b');
  const v2 = run("closestVertically([{id:'a',top:100,bottom:150},{id:'b',top:300,bottom:350}], {top:110,bottom:140})");
  assert.equal(v2.id, 'a');

  // 11. KKphim server-side year sort strictly ordered client-side (fixing upstream outliers)
  await run("selectCategoryFilter('source','kkphim')");
  const outlierItems = [
    { id: '1', name: 'Phim A', year: 2026 },
    { id: '2', name: 'Thiên Quân', year: 2005 },
    { id: '3', name: 'Cầu Thang', year: 2003 },
    { id: '4', name: 'Phim B', year: 2026 }
  ];
  context.fetch = async url => ({ ok: true, json: async () => ({ metas: outlierItems, pagination: { currentPage: 1, totalPages: 10, totalItems: 200, totalItemsPerPage: 20 } }) });
  run("tabFilters[2].sort = 'default'");
  await run("selectCategoryFilter('sort','year_desc')");
  const years = JSON.parse(run("JSON.stringify(catState.items.map(x=>x.y))"));
  assert.deepEqual(years, [2026, 2026, 2005, 2003]);

  // 12. Info column updating on focus, debounced meta fetch, stale response ignored
  let metaCalls = [];
  context.fetch = async url => {
    metaCalls.push(url);
    if (url.includes('/meta/')) {
      return {
        ok: true,
        json: async () => ({
          meta: {
            name: 'Phim Test Full',
            origin_name: 'Test Original Title',
            description: 'Mô tả chi tiết từ meta API',
            country: 'Hàn Quốc'
          }
        })
      };
    }
    return { ok: true, json: async () => ({ metas: [] }) };
  };

  run("setCategoryFocusedFilm({ id: 'test_film_1', t: 'Phim Test 1', type: 'movie', d: 'Chưa có mô tả cho phim này.', country: '' })");
  assert.equal(run("$('infoTitle').textContent"), 'Phim Test 1');

  // Changing focus before 350 ms clears timer and updates to new film immediately
  run("setCategoryFocusedFilm({ id: 'test_film_2', t: 'Phim Test 2', type: 'movie', d: 'Chưa có mô tả cho phim này.', country: '' })");
  assert.equal(run("$('infoTitle').textContent"), 'Phim Test 2');
  assert.equal(metaCalls.length, 0); // debounced, not called immediately

  // Wait 400ms for debounce timer to fire
  await new Promise(r => setTimeout(r, 400));
  assert.equal(metaCalls.length, 1);
  assert(metaCalls[0].includes('test_film_2'));
  assert.equal(run("$('infoOrigTitle').textContent"), 'Test Original Title');
  assert.equal(run("$('infoDesc').textContent"), 'Mô tả chi tiết từ meta API');
  assert(run("$('infoMeta').textContent").includes('Hàn Quốc'));

  // 13. Details page "Xem thêm": shown only on overflow, and Back from it
  const dDescNode = run("$('dDesc')");
  const dMoreNode = run("$('dMore')");
  const overlayNode = run("$('readMoreOverlay')");

  // Case A: Short text -> no overflow -> dMore hidden
  dDescNode.textContent = 'Mô tả ngắn.';
  dDescNode.scrollHeight = 30;
  dDescNode.clientHeight = 30;
  run('checkDescOverflow()');
  assert.equal(dMoreNode.hidden, true);

  // Case B: Placeholder text -> dMore hidden even if heights differ
  dDescNode.textContent = 'Chưa có mô tả cho phim này.';
  dDescNode.scrollHeight = 80;
  dDescNode.clientHeight = 30;
  run('checkDescOverflow()');
  assert.equal(dMoreNode.hidden, true);

  // Case C: Long text overflowing -> dMore shown
  dDescNode.textContent = 'Mô tả rất dài dài dài dài dài dài dài dài dài dài dài dài dài dài.';
  dDescNode.scrollHeight = 90;
  dDescNode.clientHeight = 30;
  run('checkDescOverflow()');
  assert.equal(dMoreNode.hidden, false);

  // Case D: openReadMore opens overlay, sets title and full text
  run("detailItem = { t: 'Tiêu đề phim', d: 'Mô tả đầy đủ chi tiết của bộ phim.' }; openReadMore()");
  assert.equal(run('readMoreOpen'), true);
  assert.equal(overlayNode.hidden, false);
  assert.equal(run("$('readMoreTitle').textContent"), 'Tiêu đề phim');
  assert.equal(run("$('readMoreBody').textContent"), 'Mô tả đầy đủ chi tiết của bộ phim.');

  // Case E: closeReadMore closes overlay, restores readMoreOpen to false
  run('closeReadMore()');
  assert.equal(run('readMoreOpen'), false);
  assert.equal(overlayNode.hidden, true);

  // Restore fetch for search and remaining tests
  context.fetch = async url => { calls.push(url); return { ok: true, json: async () => ({ metas: [] }) }; };
  await run('openTab(0)');nodes.get('searchInput').value='<img src=x onerror=alert(1)>';
  calls=[];await run('search()');assert.equal(calls.length,2);assert(calls.every(url=>url.includes('%3Cimg')));assert(!nodes.get('shelves').innerHTML.includes('<img'));
  // A late search must not overwrite a newly selected tab.
  let pending=[];context.fetch=url=>new Promise(resolve=>pending.push(()=>resolve({ok:true,json:async()=>({metas:[{id:'late',name:'Late result'}]})})));
  const search=run('search()');await run('openTab(5)');const library=nodes.get('shelves').innerHTML;pending.forEach(resolve=>resolve());await search;assert.equal(nodes.get('shelves').innerHTML,library);
  // Closing a player while sources load must not attach a late stream.
  pending=[];const playback=run("playMovie(mapMeta({id:'slow',name:'Phim'}))");run('closePlayer()');pending.forEach(resolve=>resolve());await playback;assert.equal(nodes.get('video').src,undefined);
  context.fetch=async()=>{throw new Error('offline');};await run('openTab(1)');assert(nodes.get('shelves').innerHTML.includes('Thử lại'));assert(nodes.get('hero').hidden);
  assert(nodes.get('shelves').innerHTML.includes('data-row="2" data-col="0" data-action="retry"'));
  assert(!nodes.get('shelves').innerHTML.includes('${i+2}'));
  // Newest first: year, then CDN upload date, then source order.
  assert.deepEqual(JSON.parse(run(`JSON.stringify(newestFirst([
    {id:'old',y:2020,poster:'https://x/uploads/movies/20261101/a.webp'},
    {id:'a',y:2026,poster:'https://x/uploads/movies/20261026/a.webp'},
    {id:'b',y:2026,poster:'https://x/uploads/movies/20261115/b.webp'},
    {id:'none',y:''},{id:'c',y:2026}]).map(x=>x.id))`)),['b','a','c','old','none']);
  // Holding a seek key accelerates 10 s → 30 s → 60 s; a pause resets it.
  assert.deepEqual(JSON.parse(run('lastSeekKey=0;JSON.stringify(Array.from({length:20},(_,i)=>holdStep(1000+i*100)))')).filter((v,i,a)=>a.indexOf(v)===i),[10,30,60]);
  assert.equal(run('holdStep(99999)'),10);
  nodes.get('video').duration=7200;nodes.get('video').currentTime=100;run('seekPlayer(seekButtons.playerFwd5)');assert.equal(nodes.get('video').currentTime,400);
  run('seekPlayer(seekButtons.playerBack5)');assert.equal(nodes.get('video').currentTime,100);
  // Episodes: sorted, ranges of 50, play resolves the episode stream id and remembers it.
  const videos=Array.from({length:120},(_,i)=>({id:`s:1:${120-i}`,title:`Tập ${120-i}`,season:1,episode:120-i}));
  run(`detailItem=${JSON.stringify({id:'s',type:'series',t:'Phim bộ',videos:null})};detailItem.videos=mapVideos(${JSON.stringify(videos)});epSeason=undefined;epRange=undefined;renderEpisodes()`);
  const eps=nodes.get('dEpisodes').innerHTML;
  assert(eps.includes('data-range="2"'));assert(eps.includes('101–120'));assert(eps.includes('data-episode="s:1:1"'));assert(!eps.includes('data-episode="s:1:51"'));
  calls=[];context.fetch=async url=>{calls.push(url);return {ok:true,json:async()=>({streams:[]})};};
  // No history: Play starts the newest episode.
  await run("playItem(detailItem)");assert(calls[0].endsWith('/stream/series/s%3A1%3A120.json'));
  await run("playEpisode(detailItem,'s:1:77')");assert(calls[1].endsWith('/stream/series/s%3A1%3A77.json'));
  assert.equal(JSON.parse(storage.get('cinebolt.watched'))['series:s'].id,'s:1:77');
  run('epRange=undefined;renderEpisodes()');assert(nodes.get('dEpisodes').innerHTML.includes('data-episode="s:1:77"'));
  assert.equal(run('playLabel(detailItem)'),'▶ Xem tiếp Tập 77');
  // Positions: resume a stopped episode; a finished one moves Play on to the next episode.
  run("saveProgress('s:1:77',1200,2700)");assert.equal(run("resumeAt('s:1:77')"),1200);
  run("saveProgress('s:1:77',2690,2700)");assert.equal(run("resumeAt('s:1:77')"),0);
  assert.equal(run('playLabel(detailItem)'),'▶ Xem Tập 78');
  await run("playItem(detailItem)");assert(calls[2].endsWith('/stream/series/s%3A1%3A78.json'));
  // Search results: grouped by category (anime by genre), each keeping newest-first order.
  assert.equal(run(`JSON.stringify(groupResults([{id:'s2',type:'series',g:'Tình Cảm'},{id:'a1',type:'series',g:'Hoạt Hình'},{id:'m1',type:'movie',g:'Hài'},{id:'s1',type:'series',g:''}]).map(g=>g.h+':'+g.list.map(x=>x.id).join(',')))`),JSON.stringify(['Phim lẻ:m1','Phim bộ:s2,s1','Hoạt hình:a1']));
  // Accent-insensitive exact title match is pinned first in its group; groups render at most 6 cards plus "Xem thêm".
  assert.equal(run("fold('Thượng Công  Chúa Đ')"), 'thuong cong chua d');
  assert.equal(run(`groupResults([{id:'n',type:'series',t:'Thượng Công Chúa 2',y:2026},{id:'x',type:'series',t:'Thượng Công Chúa',y:2020}],'thuong cong chua')[0].list.map(x=>x.id).join()`), 'x,n');
  run(`expandedGroups=new Set();renderResults(groupResults(Array.from({length:9},(_,i)=>({id:'m'+i,type:'movie',t:'Phim '+i}))))`);
  { const html = nodes.get('shelves').innerHTML; assert.equal((html.match(/class="card"/g) || []).length, 6); assert(html.includes('Xem thêm 3 phim')); assert(html.includes('data-bg=')); }
  // On-screen keyboard: typing, no double/leading spaces, backspace, clear.
  run("$('searchInput').value='';typeKey(' ');typeKey('c');typeKey('o');typeKey(' ');typeKey(' ');typeKey('n');typeKey('back');typeKey('n')");assert.equal(nodes.get('searchInput').value,'co n');
  run("typeKey('clear')");assert.equal(nodes.get('searchInput').value,'');
  run("saveProgress('m1',600,6000)");assert.equal(run("playLabel({id:'m1',type:'movie'})"),'▶ Xem tiếp');
  run('closePlayer()');
  // Performance: a closed player must not keep its spinner running; hls buffers stay bounded.
  assert.equal(nodes.get('playerLoading').hidden,true);
  const playerSrc=fs.readFileSync('UI/player.js','utf8');assert(/backBufferLength:\s*30/.test(playerSrc));
  assert(/id="playerLoading" hidden/.test(fs.readFileSync('UI/index.html','utf8')));
  assert(/\.player:not\(\.open\)\{visibility:hidden/.test(fs.readFileSync('UI/tv.css','utf8')));

  // Vertical rail: 6 stacked tabs, data-row and data-col, icon only at rest, CSS tokens
  run('activeTab = 1; renderNav()');
  const navHtml = nodes.get('nav').innerHTML;
  assert.equal((navHtml.match(/class="tab"/g) || []).length, 6);
  assert(navHtml.includes('data-row="0" data-col="0"'));
  assert(navHtml.includes('data-row="1" data-col="0" aria-current="page"'));
  assert(navHtml.includes('data-row="5" data-col="0"'));
  const tvCss = fs.readFileSync('UI/tv.css', 'utf8');
  assert(/--rail:\s*64px/.test(tvCss));
  assert(/flex-direction:\s*column/.test(tvCss));
  assert(/\.brand span\s*\{\s*display:\s*none\s*!important/i.test(tvCss));
  assert(/\.tab span\s*\{\s*display:\s*none\s*!important/i.test(tvCss));
  assert(/\.tab\.f span[^{]*\{\s*display:\s*inline\s*!important/i.test(tvCss));

  for(const name of ['app.js','index.html','player.js','tv.css','logo.svg'])assert.equal(fs.readFileSync('UI/'+name,'utf8'),fs.readFileSync('android-tv/app/src/main/assets/'+name,'utf8'));
  const html=fs.readFileSync('UI/index.html','utf8');assert(html.includes('lang="vi"'));assert(html.includes('charset="utf-8"'));
  assert(!/<video[^>]*\scontrols\b/.test(html));assert(html.includes('id="playerSeek"'));assert(html.includes('id="viewLoading"'));
  console.log('PASS: Vietnamese metadata, escaping, saved films, category filters, search, stale responses, seek bounds, player cancellation, custom controls, error recovery, and Android asset parity.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>run('clearTimeout(noticeTimer);clearTimeout(controlsTimer);clearTimeout(playbackTimer)'));

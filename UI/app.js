/* CineBolt TV — wired to VietStream Stremio addon API */

/* ---------- palette helpers (fallback procedural art) ---------- */
const P = {
  ember:["#2a0d06","#ff6a2b","#ffc46b"], tide:["#041a26","#1fb5d6","#7af0d4"], dusk:["#150a2a","#8f4dff","#ff7ac6"],
  moss:["#0b1a0c","#4caf50","#e2f27a"], steel:["#0e1116","#5c6b82","#c9d6ea"], rose:["#2a0610","#e0335b","#ffb0a0"],
  gold:["#1d1405","#d99a1e","#fff1b8"], ice:["#071222","#3d7bff","#c7e3ff"], noir:["#050505","#3a3a3a","#e8e8e8"],
};
const PK = Object.keys(P);
const art = (p, s) => { const [b, a, c] = P[p];
  return `radial-gradient(ellipse at ${20+(s*37)%60}% ${30+(s*23)%50}%, ${c}cc 0%, transparent 38%),
    radial-gradient(ellipse at ${80-(s*17)%50}% ${70-(s*11)%40}%, ${a} 0%, transparent 55%),
    linear-gradient(${(s*47)%360}deg, ${b} 10%, ${a}55 60%, ${b} 100%)`; };
function hashPalette(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return PK[Math.abs(h) % PK.length]; }
function hashSeed(s) { let h = 0; for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 20; }

/* ---------- API client ---------- */
const $ = id => document.getElementById(id);
/* Backend: the Android app passes ?api=… (emulator → 10.0.2.2, devices → configured host); a browser uses its own host. */
const API_BASE = (() => {
  try { const api = new URLSearchParams(location.search).get('api'); if(api && /^https?:\/\/[^/]+$/i.test(api.replace(/\/+$/,''))) return api.replace(/\/+$/,''); } catch {}
  return location.hostname ? `${location.protocol}//${location.hostname}:7001` : 'http://10.0.2.2:7001';
})();
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const genresVi = {'Action':'Hành động','Adventure':'Phiêu lưu','Animation':'Hoạt hình','Comedy':'Hài','Crime':'Hình sự','Documentary':'Tài liệu','Drama':'Chính kịch','Family':'Gia đình','Fantasy':'Giả tưởng','History':'Lịch sử','Horror':'Kinh dị','Music':'Âm nhạc','Mystery':'Bí ẩn','Romance':'Tình cảm','Science Fiction':'Khoa học viễn tưởng','Thriller':'Giật gân','War':'Chiến tranh','Western':'Viễn Tây'};
const defs = [
  {h:'Phim lẻ mới',catalog:'kkphim-phim-le',type:'movie',kind:'land'},
  {h:'Phim bộ',catalog:'kkphim-phim-bo',type:'series',kind:'land'},
  {h:'Phim chiếu rạp',catalog:'kkphim-chieu-rap',type:'movie',kind:'post'},
  {h:'Hoạt hình',catalog:'kkphim-hoat-hinh',type:'series',kind:'post'},
  {h:'Phim từ Phim4K',catalog:'phim4k-phim-le',type:'movie',kind:'wide'}
];
const tabs = ['Tìm kiếm','Trang chủ','Phim lẻ','Phim bộ','Hoạt hình','Đã lưu'];
const iconPaths = ['<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>','<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>','<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4"/>','<rect x="3" y="7" width="18" height="14" rx="3"/><path d="m8 2 4 5 4-5"/>','<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>','<path d="M6 3h12v18l-6-4-6 4z"/>'];
const navIcon = i => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[i]}</svg>`;
let activeTab = 1, viewVersion = 0, playerVersion = 0, currentItem, playerItem, returnFocus, playerReturnFocus, hls;
let items = new Map(), savedItems = [];
try { const value = JSON.parse(localStorage.getItem('cinebolt.saved') || '[]'); if(Array.isArray(value)) savedItems = value.filter(x => x && typeof x.id === 'string'); } catch {}
const key = x => `${x.type}:${x.id}`;
/* Newest first: release year, then the upload date the CDN puts in image paths (/uploads/movies/20261026/…), then the source order. */
const uploadStamp = x => Number((`${x.poster || ''} ${x.background || ''}`.match(/\/(20\d{6})\//) || [])[1] || 0);
const newestFirst = list => list.map((x,i)=>({x,i})).sort((a,b)=>(Number(b.x.y)||0)-(Number(a.x.y)||0) || uploadStamp(b.x)-uploadStamp(a.x) || a.i-b.i).map(o=>o.x);
/* Last episode started per series: {"series:kk_x": {id:"kk_x:1:3", title:"Tập 03"}}. */
let watchedMap = {};
try { const value = JSON.parse(localStorage.getItem('cinebolt.watched') || '{}'); if(value && typeof value === 'object') watchedMap = value; } catch {}
const watched = x => x && watchedMap[key(x)];
// Playback position per stream (episode id or film id), so Play resumes where the viewer stopped.
let progressMap = {};
try { const value = JSON.parse(localStorage.getItem('cinebolt.progress') || '{}'); if(value && typeof value === 'object') progressMap = value; } catch {}
function saveProgress(id, t, d) {
  if(!id || !Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;
  const done = t > d - 90 || t / d > .95, next = {...progressMap};
  if(t < 30 && !done) delete next[id]; else next[id] = {t:Math.floor(t), d:Math.floor(d), done, at:Date.now()};
  const ids = Object.keys(next); if(ids.length > 200) ids.sort((p,q)=>next[p].at-next[q].at).slice(0, ids.length-200).forEach(k=>delete next[k]);
  progressMap = next; try { localStorage.setItem('cinebolt.progress', JSON.stringify(next)); } catch {}
}
const resumeAt = id => { const p = progressMap[id]; return p && !p.done && p.t >= 30 ? p.t : 0; };
// Which episode Play should start: the last one watched (or the next if it was finished), else the newest.
function nextEpisode(x) {
  const eps = x.videos || [], w = watched(x);
  if(w) { const i = eps.findIndex(e=>e.id===w.id); if(i < 0) return null; return progressMap[w.id]?.done && eps[i+1] ? {e:eps[i+1], resume:false} : {e:eps[i], resume:true}; }
  return eps.length ? {e:eps[eps.length-1], resume:false} : null;
}
function rememberEpisode(x, episode) {
  watchedMap = {...watchedMap, [key(x)]: {id:episode.id, title:episode.title}};
  try { localStorage.setItem('cinebolt.watched', JSON.stringify(watchedMap)); } catch {}
}
// Films the viewer started, newest first, so Home can offer "Xem tiếp" (the progress maps hold only stream ids, not titles or art).
let historyMap = {};
try { const value = JSON.parse(localStorage.getItem('cinebolt.history') || '{}'); if(value && typeof value === 'object') historyMap = value; } catch {}
function rememberHistory(x) {
  if(!x || !x.id) return;
  const keep = ({id,t,type,poster,background,y,g,hd,d}) => ({id,t,type,poster,background,y,g,hd,d});
  const next = {...historyMap, [key(x)]: {item: keep(x), at: Date.now()}};
  const ids = Object.keys(next); if(ids.length > 30) ids.sort((p,q)=>next[p].at-next[q].at).slice(0, ids.length-30).forEach(k=>delete next[k]);
  historyMap = next; try { localStorage.setItem('cinebolt.history', JSON.stringify(next)); } catch {}
}
// Unfinished films and series in progress: what to resume, how far along, and the caption line.
function continueList(limit = 12) {
  return Object.values(historyMap).sort((a,b)=>b.at-a.at).map(h => {
    const x = h.item; if(!x || !x.id) return null;
    const w = x.type === 'series' ? watched(x) : null, streamId = w ? w.id : (x.type === 'series' ? null : x.id);
    if(!streamId) return null;
    const p = progressMap[streamId];
    if(x.type !== 'series' && (!p || p.done || p.t < 30)) return null; // films: only real, unfinished progress
    const left = p && !p.done && p.d ? Math.max(1, Math.round((p.d - p.t) / 60)) : 0;
    const sub = [w && w.title, p && p.done ? 'Đã xem xong' : left ? `còn ${left} phút` : ''].filter(Boolean).join(' · ');
    return {x, progress: p && p.d ? Math.min(1, p.t / p.d) : 0, sub, resume: !!p && !p.done};
  }).filter(Boolean).slice(0, limit);
}
const episodeTitle = e => e.title || `Tập ${e.episode}`;
function mapVideos(videos) {
  return (Array.isArray(videos) ? videos : []).filter(v => v && typeof v.id === 'string')
    .map(v => ({id:v.id, title:v.title || v.name || '', season:Number(v.season) || 1, episode:Number(v.episode) || 0}))
    .sort((a,b) => a.season-b.season || a.episode-b.episode);
}
const isSaved = x => savedItems.some(s => key(s) === key(x));
// Catalog lists are kept in memory for a few minutes, so switching tabs redraws instantly instead of refetching.
const API_TTL = 5 * 60 * 1000, apiCache = new Map();
function apiCached(path) { const hit = apiCache.get(path); return !!hit && Date.now() - hit.at < API_TTL; }
async function api(path) {
  const cacheable = path.startsWith('/catalog/');
  if (cacheable && apiCached(path)) return apiCache.get(path).data;
  const data = await apiFetch(path);
  if (cacheable) { apiCache.delete(path); apiCache.set(path, {at: Date.now(), data}); if (apiCache.size > 60) apiCache.delete(apiCache.keys().next().value); }
  return data;
}
async function apiFetch(path) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
  try { const response = await fetch(API_BASE + path, {signal:controller.signal}); if(!response.ok) throw new Error('request'); return await response.json(); }
  finally { clearTimeout(timeout); }
}
function mapMeta(x) {
  return {id:x.id,t:x.name || x.t || 'Chưa có tên',originalName:x.originalName || x.origin_name || '',type:x.type || 'movie',g:(x.genres || []).map(g => genresVi[g] || g).join(' · '),y:x.year || x.y || '',hd:x.releaseInfo || x.hd || '',d:x.description || x.d || 'Chưa có mô tả cho phim này.',poster:x.poster,background:x.background,imdbRating:x.imdbRating,country:x.country || ''};
}
function artStyle(x, portrait = false) {
  const url = portrait ? (x.poster || x.background) : (x.background || x.poster);
  if(url && /^https?:\/\//i.test(url)) return `background-image:url(${JSON.stringify(url)});background-size:cover;background-position:center`;
  return `background:${art(hashPalette(x.t),hashSeed(x.t))}`;
}
const metadata = x => [x.g,x.y,x.type === 'series' ? 'Phim bộ' : 'Phim lẻ',...x.hd.split('·').map(v=>v.trim()).filter(v=>v && v!==String(x.y)).map(v=>v==='Vietsub'?'Phụ đề Việt':v)].filter(Boolean).map(v => `<span>${esc(v)}</span>`).join('<span aria-hidden="true">·</span>');
function card(x,r,c,lazy=false,portrait=false,extra=null) {
  items.set(key(x),x);
  const style = artStyle(x, portrait);
  const hasImg = /^https?:\/\//i.test(portrait ? (x.poster || x.background || '') : (x.background || x.poster || ''));
  return `<button class="card" data-row="${r}" data-col="${c}" data-item="${esc(key(x))}" aria-label="Xem chi tiết: ${esc(x.t)}"><div class="art" ${lazy ? `data-bg="${esc(style)}"` : `style="${esc(style)}"`}>${hasImg ? '' : `<div class="title-art">${esc(x.t)}</div>`}${x.y ? `<span class="year-tag">${esc(x.y)}</span>` : ''}${extra && extra.progress > 0 ? `<div class="progress"><i style="width:${Math.round(extra.progress*100)}%"></i></div>` : ''}</div><div class="cap"><b>${esc(x.t)}</b>${extra && extra.sub ? `<span>${esc(extra.sub)}</span>` : x.g ? `<span>${esc(x.g)}</span>` : ''}</div></button>`;
}
const playLabel = x => {
  if(x.type === 'series') {
    const n = nextEpisode(x), w = watched(x);
    if(n) return n.resume ? `▶ Xem tiếp ${episodeTitle(n.e)}` : `▶ Xem ${episodeTitle(n.e)}`;
    return w ? `▶ Xem tiếp ${w.title || ''}`.trim() : '▶ Xem phim';
  }
  return resumeAt(x.id) ? '▶ Xem tiếp' : '▶ Xem phim';
};
const ICONS={
  play:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.8v14.4L19 12z" fill="currentColor"/></svg>',
  save:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 16.2l-5.5 4.3z"/><path d="M12 7.3v5.4M9.3 10h5.4"/></svg>',
  saved:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 3.5h11v17L12 16.2l-5.5 4.3z" fill="currentColor"/></svg>'};
// Play/save buttons: icon + label span (the details page shows the label only on the focused button).
function playButtonHtml(x){const l=playLabel(x).replace(/^▶ */,'');return `${ICONS.play}<span>${esc(l)}</span>`;}
function saveButtonHtml(saved){return `${saved?ICONS.saved:ICONS.save}<span>${saved?'Đã lưu':'Lưu phim'}</span>`;}
function setPlayButton(b,x){if(!b)return;b.innerHTML=playButtonHtml(x);b.setAttribute('aria-label',playLabel(x).replace(/^▶ */,''));}
function setSaveButton(b,saved){if(!b)return;b.innerHTML=saveButtonHtml(saved);b.setAttribute('aria-label',saved?'Đã lưu':'Lưu phim');b.setAttribute('aria-pressed',saved);}
function actions(x) { const l=playLabel(x).replace(/^▶ */,''),s=isSaved(x); return `<button class="btn primary" data-action="play" aria-label="${esc(l)}">${playButtonHtml(x)}</button><button class="btn" data-action="save" aria-pressed="${s}" aria-label="${s?'Đã lưu':'Lưu phim'}">${saveButtonHtml(s)}</button>`; }
function setHero(x) {
  currentItem = x; $('hero').hidden = !x;
  if(!x) return;
  $('heroArt').style.cssText = artStyle(x); $('hKick').textContent = 'Phim nổi bật'; $('hTitle').textContent = x.t;
  $('hMeta').innerHTML = metadata(x); $('hDesc').textContent = x.d;
  $('hActions').innerHTML = actions(x) + '<button class="btn" data-action="detail">Chi tiết</button>';
  $('hActions').querySelectorAll('button').forEach((el,c) => {el.dataset.row=1;el.dataset.col=c;});
}
function renderShelves(groups) {
  items=new Map(); // only cards on screen are needed; avoids growing across tab switches
  $('shelves').innerHTML = groups.map(({def,list,error},i) => `<section class="shelf ${def.kind}"><h2>${esc(def.h)}</h2>${error ? '<div class="empty">Không tải được danh sách phim. Vui lòng kiểm tra kết nối. <button class="btn" data-row="' + (i+2) + '" data-col="0" data-action="retry">Thử lại</button></div>' : list.length ? `<div class="track" tabindex="-1">${list.map((x,c)=>def.cont ? card(x.x,i+2,c,false,false,x).replace('<button class="card"', `<button class="card"${x.resume ? ' data-resume="1"' : ''}`) : card(x,i+2,c,false,def.kind==='post')).join('')}</div>` : '<p class="empty">Chưa có phim trong danh sách này.</p>'}</section>`).join('');
}
// The sidebar widens to show every label while focus is anywhere in it.
document.getElementById('nav')?.addEventListener('focusin',()=>document.body.classList.add('nav-open'));
document.getElementById('nav')?.addEventListener('focusout',e=>{if(!e.relatedTarget||!e.relatedTarget.closest('#nav'))document.body.classList.remove('nav-open');});
function renderNav() {
  $('nav').innerHTML = tabs.map((t,i)=>`<button class="tab" aria-label="${t}" title="${t}" data-tab="${i}" data-row="${i}" data-col="0" ${i===activeTab ? 'aria-current="page"' : ''}>${navIcon(i)}<span>${t}</span></button>`).join('');
}
// The loading screen only appears when loading actually takes a moment; cached views draw without a skeleton flash.
let loadingTimer = 0;
function viewLoading(visible, label='Đang tải phim…') {
  clearTimeout(loadingTimer); $('viewLoadingText').textContent=label;
  if (visible) loadingTimer = setTimeout(() => { $('viewLoading').hidden = false; }, 180); else $('viewLoading').hidden = true;
  $('shelves').setAttribute('aria-busy',String(visible));
}

const GRID_COLS = 5;
const PAGE_SIZE = 10;
const PAGE_OVERFETCH = 5;

const GENRES = [
  'Hành Động', 'Phiêu Lưu', 'Hài Hước', 'Cổ Trang', 'Tâm Lý',
  'Hình Sự', 'Chiến Tranh', 'Võ Thuật', 'Viễn Tưởng', 'Khoa Học Viễn Tưởng',
  'Kinh Dị', 'Âm Nhạc', 'Thần Thoại', 'Tài Liệu', 'Gia Đình',
  'Chính Kịch', 'Bí Ẩn', 'Học Đường', 'Kinh Điển', 'Tình Cảm',
  'Hoạt Hình', 'Thể Thao'
];

const COUNTRIES = [
  'Âu Mỹ', 'Hàn Quốc', 'Trung Quốc', 'Nhật Bản', 'Thái Lan', 'Việt Nam', 'Đài Loan', 'Hồng Kông',
  'Ấn Độ', 'Anh', 'Pháp', 'Ả Rập Xê Út', 'Ba Lan', 'Bồ Đào Nha', 'Brazil', 'Canada', 'Châu Phi',
  'Đan Mạch', 'Đức', 'Hà Lan', 'Indonesia', 'Malaysia', 'Mexico', 'Na Uy', 'Nam Phi', 'Nga',
  'Philippines', 'Tây Ban Nha', 'Thổ Nhĩ Kỳ', 'Thụy Điển', 'Thụy Sĩ', 'UAE', 'Úc', 'Ukraina',
  'Ý', 'Quốc Gia Khác'
];

const SORT_OPTIONS = [
  { id: 'year_desc', name: 'Năm mới nhất' },
  { id: 'default', name: 'Mới cập nhật' },
  { id: 'year_asc', name: 'Năm cũ nhất' },
  { id: 'name_asc', name: 'Tên A→Z' },
  { id: 'name_desc', name: 'Tên Z→A' }
];

const CATEGORY_DEFS = {
  2: {
    type: 'movie',
    title: 'Phim lẻ',
    sources: [
      { id: 'all', name: 'Tất cả' },
      { id: 'kkphim', name: 'KKphim', catalog: 'kkphim-phim-le', pageSize: 20 },
      { id: 'phim4k', name: 'Phim4K', catalog: 'phim4k-phim-le', pageSize: 20 },
      { id: 'nguonc', name: 'NguonC', catalog: 'nguonc-phim-le', pageSize: 10 },
      { id: 'k20', name: 'K20', catalog: 'k20-movie', pageSize: 20 }
    ],
    allCatalogs: [
      { id: 'kkphim', catalog: 'kkphim-phim-le', pageSize: 20 },
      { id: 'phim4k', catalog: 'phim4k-phim-le', pageSize: 20 },
      { id: 'nguonc', catalog: 'nguonc-phim-le', pageSize: 10 },
      { id: 'k20', catalog: 'k20-movie', pageSize: 20 }
    ]
  },
  3: {
    type: 'series',
    title: 'Phim bộ',
    sources: [
      { id: 'all', name: 'Tất cả' },
      { id: 'kkphim', name: 'KKphim', catalog: 'kkphim-phim-bo', pageSize: 20 },
      { id: 'phim4k', name: 'Phim4K', catalog: 'phim4k-phim-bo', pageSize: 20 },
      { id: 'nguonc', name: 'NguonC', catalog: 'nguonc-phim-bo', pageSize: 10 },
      { id: 'k20', name: 'K20', catalog: 'k20-series', pageSize: 20 }
    ],
    allCatalogs: [
      { id: 'kkphim', catalog: 'kkphim-phim-bo', pageSize: 20 },
      { id: 'phim4k', catalog: 'phim4k-phim-bo', pageSize: 20 },
      { id: 'nguonc', catalog: 'nguonc-phim-bo', pageSize: 10 },
      { id: 'k20', catalog: 'k20-series', pageSize: 20 }
    ]
  },
  4: {
    type: 'series',
    title: 'Hoạt hình',
    sources: [
      { id: 'all', name: 'Tất cả' },
      { id: 'kkphim', name: 'KKphim', catalog: 'kkphim-hoat-hinh', pageSize: 20 }
    ],
    allCatalogs: [
      { id: 'kkphim', catalog: 'kkphim-hoat-hinh', pageSize: 20 }
    ]
  }
};

const tabFilters = {
  2: { source: 'all', genre: 'all', country: 'all', sort: 'year_desc', page: 1, lastCardId: null },
  3: { source: 'all', genre: 'all', country: 'all', sort: 'year_desc', page: 1, lastCardId: null },
  4: { source: 'all', genre: 'all', country: 'all', sort: 'year_desc', page: 1, lastCardId: null }
};

let catState = null;

function catalogUrl(type, catalog, genre, country, sort, skip) {
  let url = `/catalog/${type}/${catalog}`;
  const parts = [];
  if (genre && genre !== 'all') parts.push(`genre=${encodeURIComponent(genre)}`);
  if (country && country !== 'all') parts.push(`country=${encodeURIComponent(country)}`);
  if (sort && sort !== 'default') parts.push(`sort=${encodeURIComponent(sort)}`);
  if (skip > 0) parts.push(`skip=${skip}`);
  if (parts.length > 0) {
    url += '/' + parts.join('&');
  }
  return url + '.json';
}

async function fetchSourceSlice(type, catalog, genre, country, sort, startIdx, count, pageSize) {
  const endIdx = startIdx + count;
  const firstPage = Math.floor(startIdx / pageSize);
  const lastPage = Math.floor((endIdx - 1) / pageSize);
  const skips = [];
  for (let p = firstPage; p <= lastPage; p++) {
    skips.push(p * pageSize);
  }

  const responses = await Promise.all(
    skips.map(skip => api(catalogUrl(type, catalog, genre, country, sort, skip)).catch(() => ({})))
  );

  let combined = [];
  let totalItems = null;
  let totalPages = null;

  for (const res of responses) {
    const metas = (res.metas || []).map(x => mapMeta({ ...x, type: x.type || type }));
    combined.push(...metas);
    const tItems = res.pagination?.totalItems ?? res.pagination?.total_items;
    const tPages = res.pagination?.totalPages ?? res.pagination?.total_page;
    if (tItems != null && totalItems === null) {
      totalItems = tItems;
    }
    if (tPages != null && totalPages === null) {
      totalPages = tPages;
    }
  }

  const sliceOffset = startIdx - firstPage * pageSize;
  const items = combined.slice(sliceOffset, sliceOffset + count);
  return { items, totalItems, totalPages, pageSize };
}

function interleave(arrays) {
  const result = [];
  const maxLen = Math.max(...arrays.map(a => a.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const arr of arrays) {
      if (i < arr.length) result.push(arr[i]);
    }
  }
  return result;
}

function dedupeCategoryItems(list) {
  const priority = id => id.startsWith('kk_') ? 4 : id.startsWith('p4k_') ? 3 : id.startsWith('nc_') ? 2 : 1;
  const map = new Map();
  for (const item of list) {
    const rawTitle = (item.t || '').replace(/\(\d{4}\)/g, '').trim();
    const key = fold(rawTitle) + ':' + (item.y || '');
    if (!map.has(key) || priority(item.id) > priority(map.get(key).id)) {
      map.set(key, item);
    }
  }
  // Keep exactly one object per film: upstream pages can repeat the same entry (same id) at page boundaries.
  const allowed = new Set(map.values());
  return list.filter(x => allowed.has(x));
}

function generatePageNumbers(current, total) {
  if (!total || total <= 1) return [1];
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set();
  pages.add(1);
  pages.add(total);
  if (total >= 1000) {
    if (current <= 2) {
      pages.add(2);
    } else if (current >= total - 1) {
      pages.add(total - 1);
    } else {
      pages.add(current);
    }
  } else {
    for (let i = -1; i <= 1; i++) {
      const p = current + i;
      if (p >= 1 && p <= total) pages.add(p);
    }
    if (current <= 2) { pages.add(2); pages.add(3); }
    if (current >= total - 1) { pages.add(total - 2); pages.add(total - 1); }
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const res = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) res.push('…');
    res.push(sorted[i]);
  }
  return res;
}

function sortCategoryItems(items, sort) {
  if (!sort || sort === 'default') return items;
  const list = [...items];
  if (sort === 'name_asc') {
    return list.sort((a, b) => (a.t || '').localeCompare(b.t || '', 'vi'));
  }
  if (sort === 'name_desc') {
    return list.sort((a, b) => (b.t || '').localeCompare(a.t || '', 'vi'));
  }
  const extractYear = x => {
    const y = Number(x.y) || Number((x.hd || '').match(/\b(19\d\d|20\d\d)\b/)?.[1]) || Number((x.t || '').match(/\b(19\d\d|20\d\d)\b/)?.[1]);
    return Number.isFinite(y) && y > 1900 ? y : null;
  };
  if (sort === 'year_desc') {
    return list.sort((a, b) => {
      const ya = extractYear(a), yb = extractYear(b);
      if (ya === null && yb === null) return 0;
      if (ya === null) return 1;
      if (yb === null) return -1;
      return yb - ya;
    });
  }
  if (sort === 'year_asc') {
    return list.sort((a, b) => {
      const ya = extractYear(a), yb = extractYear(b);
      if (ya === null && yb === null) return 0;
      if (ya === null) return 1;
      if (yb === null) return -1;
      return ya - yb;
    });
  }
  return list;
}

function getCategoryHint(currentFilter) {
  if (currentFilter.sort === 'name_asc' || currentFilter.sort === 'name_desc') {
    return 'Sắp xếp tên trong trang hiện tại';
  }
  if ((currentFilter.sort === 'year_desc' || currentFilter.sort === 'year_asc') && currentFilter.source === 'all') {
    if (currentFilter.genre !== 'all' || currentFilter.country !== 'all') {
      return 'Lọc áp dụng cho KKphim';
    }
    return 'Sắp xếp năm áp dụng cho KKphim';
  }
  if ((currentFilter.sort === 'year_desc' || currentFilter.sort === 'year_asc') && currentFilter.source !== 'kkphim') {
    return 'Sắp xếp năm trong trang hiện tại';
  }
  if (currentFilter.source === 'all' && (currentFilter.genre !== 'all' || currentFilter.country !== 'all')) {
    return 'Lọc áp dụng cho KKphim';
  }
  return '';
}

function renderPageBar(current, total, hasMore, row = 5) {
  let col = 0;
  const isFirst = current <= 1;
  const isLast = (total !== null && current >= total) || (!hasMore);
  const indicator = `Trang ${current}`;

  return `<div class="toolbar-right" id="toolbarPagination" role="group" aria-label="Chuyển trang">`
    + `<span class="page-hint" aria-hidden="true"><kbd>CH</kbd>+/− chuyển trang</span>`
    + `<span class="page-indicator" id="pageIndicator" aria-label="Trang ${current}${total !== null ? ` / ${total}` : ""}">${esc(indicator)}</span>`
    + `<button class="page-btn page-first" data-action="firstPage" data-row="${row}" data-col="${col++}" ${isFirst ? 'disabled aria-disabled="true"' : ''} aria-label="Trang đầu" title="Trang đầu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m11 17-5-5 5-5m7 10-5-5 5-5"/></svg><span>Trang đầu</span></button>`
    + `<button class="page-btn page-prev" data-action="prevPage" data-row="${row}" data-col="${col++}" ${isFirst ? 'disabled aria-disabled="true"' : ''} aria-label="Trang trước"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg><span>Trước</span></button>`
    + `<button class="page-btn page-next" data-action="nextPage" data-row="${row}" data-col="${col++}" ${isLast ? 'disabled aria-disabled="true"' : ''} aria-label="Trang sau"><span>Sau</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg></button>`
    + `</div>`;
}

function renderCategoryToolbar(tabDef, currentFilter, totalPages) {
  const showGenre = (currentFilter.source === 'all' || currentFilter.source === 'kkphim');
  const isDefaultSort = currentFilter.sort === 'year_desc';
  const hasFilter = currentFilter.source !== 'all' || currentFilter.genre !== 'all' || currentFilter.country !== 'all' || !isDefaultSort;

  const sourceName = tabDef.sources.find(s => s.id === currentFilter.source)?.name || 'Tất cả';
  const genreName = currentFilter.genre === 'all' ? 'Tất cả' : currentFilter.genre;
  const countryName = currentFilter.country === 'all' ? 'Tất cả' : currentFilter.country;
  const sortName = SORT_OPTIONS.find(s => s.id === currentFilter.sort)?.name || 'Năm mới nhất';

  // Default filters show only their label ("Thể loại ▾"); a chosen one shows only its value ("Hành Động ▾").
  const pill = (id, label, set, value) => `<button class="toolbar-pill${set ? ' active' : ''}" data-dropdown="${id}" aria-label="${esc(label)}: ${esc(set ? value : 'Mặc định')}">${set ? '<span class="pill-dot"></span>' + esc(value) : esc(label)} ▾</button>`;
  let pillsHtml = `<div class="toolbar-left" role="group" aria-label="Bộ lọc">`;
  pillsHtml += pill('source', 'Nguồn', currentFilter.source !== 'all', sourceName);
  if (showGenre) {
    pillsHtml += pill('genre', 'Thể loại', currentFilter.genre !== 'all', genreName);
    pillsHtml += pill('country', 'Quốc gia', currentFilter.country !== 'all', countryName);
  }
  pillsHtml += pill('sort', 'Sắp xếp', !isDefaultSort, sortName);
  if (hasFilter) {
    pillsHtml += `<button class="toolbar-pill clear-filter" data-action="clearFilters"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg><span>Xoá lọc</span></button>`;
  }
  pillsHtml += `</div>`;

  const rightHtml = renderPageBar(currentFilter.page, totalPages, catState && catState.hasMore);

  return `<div class="category-toolbar" id="categoryToolbar">${pillsHtml}${rightHtml}</div>`;
}

let infoFetchTimer = 0;
let infoFetchToken = 0;

function updateInfoCol(x) {
  const col = $('categoryInfoCol');
  if (!col) return;
  if (!x) {
    $('infoTitle') && ($('infoTitle').textContent = '');
    $('infoOrigTitle') && ($('infoOrigTitle').textContent = '', $('infoOrigTitle').hidden = true);
    $('infoMeta') && ($('infoMeta').textContent = '');
    $('infoDesc') && ($('infoDesc').textContent = '');
    return;
  }
  $('infoTitle') && ($('infoTitle').textContent = x.t || '');
  const oEl = $('infoOrigTitle');
  if (oEl) {
    oEl.textContent = x.originalName || '';
    oEl.hidden = !x.originalName;
  }
  const mEl = $('infoMeta');
  if (mEl) {
    // releaseInfo repeats the year (e.g. 'FHD · Vietsub · 2026'): keep each piece once, in the details page's wording.
    const hd = (x.hd || '').split('·').map(v => v.trim()).filter(v => v && v !== String(x.y)).map(v => v === 'Vietsub' ? 'Phụ đề Việt' : v);
    const parts = [...new Set([x.y, x.type === 'series' ? 'Phim bộ' : 'Phim lẻ', ...hd, x.g, x.country].filter(Boolean).map(String))];
    mEl.textContent = parts.join(' · ');
  }
  const dEl = $('infoDesc');
  if (dEl) {
    dEl.textContent = x.d || '';
  }
}

function setCategoryFocusedFilm(x) {
  if (!x) return;
  updateInfoCol(x);
  clearTimeout(infoFetchTimer);
  const token = ++infoFetchToken;

  const needsFetch = !x.d || x.d === 'Chưa có mô tả cho phim này.' || !x.country;
  if (!needsFetch) return;

  infoFetchTimer = setTimeout(async () => {
    try {
      let data = detailCache.get(key(x));
      if (!data) {
        data = await api(`/meta/${x.type}/${encodeURIComponent(x.id)}.json`);
        if (data && data.meta) {
          if (detailCache.size >= 40) detailCache.delete(detailCache.keys().next().value);
          detailCache.set(key(x), data);
        }
      }
      if (token !== infoFetchToken || !catState) return;
      if (data && data.meta) {
        const m = data.meta;
        if (m.origin_name || m.originalName) x.originalName = m.origin_name || m.originalName;
        if (m.description) x.d = m.description;
        const countryObj = Array.isArray(m.country) ? m.country[0] : m.country;
        const cName = typeof countryObj === 'string' ? countryObj : (countryObj?.name || countryObj?.slug || '');
        if (cName) x.country = cName;
        if (Array.isArray(m.genres) && m.genres.length && !x.g) {
          x.g = m.genres.map(g => genresVi[g] || g).join(' · ');
        }
        updateInfoCol(x);
      }
    } catch {}
  }, 350);
}

let popupState = null;

function openFilterPopup(type, triggerBtn) {
  const tabDef = CATEGORY_DEFS[activeTab];
  if (!tabDef) return;
  const currentFilter = tabFilters[activeTab] || { source: 'all', genre: 'all', country: 'all', sort: 'year_desc', page: 1 };

  let options = [];
  let currentVal = 'all';
  let title = '';

  if (type === 'source') {
    options = tabDef.sources.map(s => ({ id: s.id, name: s.name }));
    currentVal = currentFilter.source;
    title = 'Nguồn phim';
  } else if (type === 'genre') {
    options = [{ id: 'all', name: 'Tất cả' }, ...GENRES.map(g => ({ id: g, name: g }))];
    currentVal = currentFilter.genre;
    title = 'Thể loại';
  } else if (type === 'country') {
    options = [{ id: 'all', name: 'Tất cả' }, ...COUNTRIES.map(c => ({ id: c, name: c }))];
    currentVal = currentFilter.country;
    title = 'Quốc gia';
  } else if (type === 'sort') {
    options = SORT_OPTIONS;
    currentVal = currentFilter.sort;
    title = 'Sắp xếp';
  } else {
    return;
  }

  popupState = { type, triggerBtn };

  const titleEl = $('filterPopupTitle');
  if (titleEl) titleEl.textContent = title;

  const listEl = $('filterPopupList');
  if (listEl) {
    listEl.innerHTML = options.map((opt, idx) => {
      const isSel = opt.id === currentVal;
      return `<button class="popup-item${isSel ? ' sel' : ''}" data-value="${esc(opt.id)}" data-index="${idx}">`
        + `<span>${esc(opt.name)}</span>`
        + (isSel ? '<span class="popup-check" aria-hidden="true">✓</span>' : '')
        + `</button>`;
    }).join('');
  }

  const popup = $('filterPopup');
  if (popup) {
    popup.hidden = false;
    popup.setAttribute('aria-hidden', 'false');
    popup.inert = false;
  }

  const panel = $('filterPopupPanel');
  if (panel && triggerBtn) {
    const rect = triggerBtn.getBoundingClientRect ? triggerBtn.getBoundingClientRect() : null;
    const top = rect ? (rect.bottom + 6) : 110;
    const left = rect ? rect.left : 40;
    const winW = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : 960;
    const winH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : 540;
    const maxH = Math.min(winH * 0.6, 380);
    panel.style.maxHeight = `${maxH}px`;
    panel.style.top = `${Math.min(winH - maxH - 20, Math.max(20, top))}px`;
    panel.style.left = `${Math.max(16, Math.min(winW - 276, left))}px`;
  }

  setTimeout(() => {
    const selItem = listEl?.querySelector('.popup-item.sel') || listEl?.querySelector('.popup-item');
    if (selItem) {
      selItem.focus({ preventScroll: true });
      selItem.scrollIntoView?.({ block: 'nearest' });
    }
  }, 0);
}

function closeFilterPopup(applyValue) {
  if (!popupState) return Promise.resolve();
  const { type, triggerBtn } = popupState;
  popupState = null;

  const popup = $('filterPopup');
  if (popup) {
    popup.hidden = true;
    popup.setAttribute('aria-hidden', 'true');
    popup.inert = true;
  }

  if (applyValue !== undefined && applyValue !== null) {
    return selectCategoryFilter(type, applyValue);
  } else {
    triggerBtn?.focus?.({ preventScroll: true });
    return Promise.resolve();
  }
}

function clearCategoryFilters() {
  const current = tabFilters[activeTab];
  if (!current) return Promise.resolve();
  current.source = 'all';
  current.genre = 'all';
  current.country = 'all';
  current.sort = 'year_desc';
  current.page = 1;
  current.lastCardId = null;
  const p = renderCategoryTab(activeTab);
  setTimeout(() => {
    $('categoryToolbar')?.querySelector('[data-dropdown="source"]')?.focus({ preventScroll: true });
  }, 0);
  return p;
}

async function renderCategoryTab(tab = activeTab, focusAction = null) {
  const tabDef = CATEGORY_DEFS[tab];
  if (!tabDef) return;
  const currentFilter = tabFilters[tab] || { source: 'all', genre: 'all', country: 'all', sort: 'year_desc', page: 1, lastCardId: null };
  const version = ++viewVersion;

  catState = {
    tab,
    version,
    page: currentFilter.page,
    source: currentFilter.source,
    genre: currentFilter.genre,
    country: currentFilter.country,
    sort: currentFilter.sort,
    genreVisible: (currentFilter.source === 'all' || currentFilter.source === 'kkphim'),
    totalPages: null,
    items: [],
    loading: true,
    hasMore: true
  };

  items = new Map();
  viewLoading(false);

  $('shelves').innerHTML = `<section class="shelf category">`
    + renderCategoryToolbar(tabDef, currentFilter, null)
    + `<div class="category-main" id="categoryMain">`
    + `  <div class="category-info-col" id="categoryInfoCol">`
    + `    <div class="info-title-wrap"><h2 class="info-title" id="infoTitle"></h2><div class="info-orig-title" id="infoOrigTitle" hidden></div></div>`
    + `    <div class="info-meta" id="infoMeta"></div>`
    + `    <p class="info-desc" id="infoDesc"></p>`
    + `  </div>`
    + `  <div class="skeleton-grid" id="categoryGrid"></div>`
    + `</div>`
    + `</section>`;

  setTimeout(() => {
    const g = $('categoryGrid');
    if (g && version === viewVersion && g.className === 'skeleton-grid' && !g.children.length) {
      g.innerHTML = Array(PAGE_SIZE).fill('<div class="skeleton-card"><i></i></div>').join('');
    }
  }, 180);

  await fetchCategoryPage(tab, currentFilter, version, focusAction);
}

async function fetchCategoryPage(tab, currentFilter, version, focusAction = null) {
  const tabDef = CATEGORY_DEFS[tab];
  const type = tabDef.type;
  const page = currentFilter.page;
  const isKkOnly = currentFilter.source === 'all' && (currentFilter.genre !== 'all' || currentFilter.country !== 'all' || currentFilter.sort === 'year_desc' || currentFilter.sort === 'year_asc');

  let rawItems = [];
  let totalPages = null;

  try {
    if (currentFilter.source === 'all' && !isKkOnly) {
      const k = tabDef.allCatalogs.length;
      const s = k > 1 ? (Math.ceil(PAGE_SIZE / k) + 2) : PAGE_SIZE; // for k=4, s=5
      const startIdx = (page - 1) * s;

      const results = await Promise.all(
        tabDef.allCatalogs.map(c => {
          const kkSort = (c.id === 'kkphim' && (currentFilter.sort === 'year_desc' || currentFilter.sort === 'year_asc')) ? currentFilter.sort : null;
          return fetchSourceSlice(type, c.catalog, null, null, kkSort, startIdx, s, c.pageSize);
        })
      );
      if (version !== viewVersion || catState?.version !== version) return;

      const sourceMetas = results.map(r => r.items);
      const totals = [];
      results.forEach((r, idx) => {
        const c = tabDef.allCatalogs[idx];
        const totItems = r.totalItems ?? (r.totalPages ? r.totalPages * c.pageSize : null);
        if (totItems != null) {
          totals.push(Math.ceil(totItems / s));
        }
      });

      const interleaved = interleave(sourceMetas);
      rawItems = dedupeCategoryItems(interleaved).slice(0, PAGE_SIZE);
      totalPages = totals.length > 0 ? Math.max(...totals) : null;
    } else {
      const s = isKkOnly
        ? tabDef.sources.find(src => src.id === 'kkphim') || tabDef.allCatalogs[0]
        : tabDef.sources.find(src => src.id === currentFilter.source) || tabDef.allCatalogs[0];
      const kkSort = (s.id === 'kkphim' && (currentFilter.sort === 'year_desc' || currentFilter.sort === 'year_asc')) ? currentFilter.sort : null;
      const startIdx = (page - 1) * PAGE_SIZE;

      let res = await fetchSourceSlice(type, s.catalog, currentFilter.genre, currentFilter.country, kkSort, startIdx, PAGE_SIZE, s.pageSize);
      if (version !== viewVersion || catState?.version !== version) return;
      rawItems = dedupeCategoryItems(res.items);
      if (rawItems.length < PAGE_SIZE && res.items.length === PAGE_SIZE) {
        res = await fetchSourceSlice(type, s.catalog, currentFilter.genre, currentFilter.country, kkSort, startIdx, PAGE_SIZE + PAGE_OVERFETCH, s.pageSize);
        if (version !== viewVersion || catState?.version !== version) return;
        rawItems = dedupeCategoryItems(res.items);
      }
      rawItems = rawItems.slice(0, PAGE_SIZE);
      const totItems = res.totalItems ?? (res.totalPages ? res.totalPages * s.pageSize : null);
      totalPages = totItems != null ? Math.ceil(totItems / PAGE_SIZE) : null;
    }

    if (currentFilter.sort && currentFilter.sort !== 'default') {
      rawItems = sortCategoryItems(rawItems, currentFilter.sort);
    }

    catState.loading = false;
    catState.items = rawItems;
    catState.totalPages = totalPages;
    catState.hasMore = rawItems.length > 0;

    const toolbarEl = $('categoryToolbar');
    if (toolbarEl) {
      toolbarEl.outerHTML = renderCategoryToolbar(tabDef, currentFilter, totalPages);
    }
    const hintEl = $('categoryHint');
    if (hintEl) {
      hintEl.textContent = getCategoryHint(currentFilter);
    }

    const gridEl = $('categoryGrid');
    if (!rawItems.length) {
      if (gridEl) {
        gridEl.className = 'category-grid';
        gridEl.innerHTML = '<p class="empty">Không tìm thấy phim trong danh mục này.</p>';
      }
      updateInfoCol(null);
      return;
    }

    if (gridEl) {
      gridEl.className = 'category-grid';
      gridEl.innerHTML = rawItems.map((x, i) => {
        const r = Math.floor(i / GRID_COLS);
        const c = i % GRID_COLS;
        return card(x, r, c, true, true);
      }).join('');
      lazyArt(gridEl, 0);
    }

    if (focusAction === 'nav' || document.activeElement?.closest('#nav')) {
      $('nav')?.querySelector('[aria-current]')?.focus({ preventScroll: true });
      setCategoryFocusedFilm(rawItems[0]);
    } else if (focusAction) {
      const btn = $('categoryToolbar')?.querySelector(`[data-action="${focusAction}"]:not([disabled])`)
        || $('categoryToolbar')?.querySelector('[data-action="nextPage"]:not([disabled])')
        || $('categoryToolbar')?.querySelector('[data-action="prevPage"]:not([disabled])');
      if (btn) btn.focus({ preventScroll: true });
      else $('categoryGrid')?.querySelector('.card')?.focus({ preventScroll: true });
      setCategoryFocusedFilm(rawItems[0]);
    } else if (currentFilter.lastCardId) {
      const savedCard = $('categoryGrid')?.querySelector(`[data-item="${currentFilter.lastCardId}"]`);
      if (savedCard) {
        savedCard.focus({ preventScroll: true });
        const item = items.get(currentFilter.lastCardId) || rawItems[0];
        setCategoryFocusedFilm(item);
      } else {
        $('categoryGrid')?.querySelector('.card')?.focus({ preventScroll: true });
        setCategoryFocusedFilm(rawItems[0]);
      }
    } else {
      $('categoryGrid')?.querySelector('.card')?.focus({ preventScroll: true });
      setCategoryFocusedFilm(rawItems[0]);
      window.scrollTo(0, 0);
    }
  } catch (err) {
    if (version !== viewVersion || catState?.version !== version) return;
    catState.loading = false;
    const gridEl = $('categoryGrid');
    if (gridEl) {
      gridEl.className = 'category-grid';
      gridEl.innerHTML = '<div class="empty">Không tải được danh sách phim. Vui lòng kiểm tra kết nối. <button class="btn compact" data-action="retryCategory">Thử lại</button></div>';
    }
  }
}

function goToCategoryPage(targetPage) {
  if (!catState || catState.loading) return Promise.resolve();
  const current = tabFilters[activeTab];
  if (!current) return Promise.resolve();
  if (targetPage < 1) targetPage = 1;
  if (catState.totalPages !== null && targetPage > catState.totalPages) targetPage = catState.totalPages;
  if (targetPage === catState.page) return Promise.resolve();

  const activeBtnAction = document.activeElement?.dataset?.action;
  const wasOnToolbarBtn = activeBtnAction === 'firstPage' || activeBtnAction === 'prevPage' || activeBtnAction === 'nextPage';

  current.page = targetPage;
  current.lastCardId = null;
  return renderCategoryTab(activeTab, wasOnToolbarBtn ? activeBtnAction : null);
}

function selectCategoryFilter(filterType, value) {
  const current = tabFilters[activeTab];
  if (!current) return Promise.resolve();
  if (filterType === 'source') {
    if (current.source === value) return Promise.resolve();
    current.source = value;
    if (value !== 'all' && value !== 'kkphim') {
      current.genre = 'all';
      current.country = 'all';
    }
  } else if (filterType === 'genre') {
    if (current.genre === value) return Promise.resolve();
    current.genre = value;
  } else if (filterType === 'country') {
    if (current.country === value) return Promise.resolve();
    current.country = value;
  } else if (filterType === 'sort') {
    if (current.sort === value) return Promise.resolve();
    current.sort = value;
  }
  current.page = 1;
  current.lastCardId = null;
  const p = renderCategoryTab(activeTab);
  setTimeout(() => {
    $('categoryToolbar')?.querySelector(`[data-dropdown="${filterType}"]`)?.focus({ preventScroll: true });
  }, 0);
  return p;
}

async function openTab(tab) {
  closeFilterPopup(null);
  closeReadMore();
  activeTab = tab; const version = ++viewVersion; clearTimeout(searchTimer); renderNav(); setHero(null);
  document.body.classList?.toggle?.('search-mode', tab === 0);
  document.body.classList?.toggle?.('category-mode', tab >= 2 && tab <= 4);
  viewLoading(tab!==0 && tab!==5,tab===1?'Đang chuẩn bị phim dành cho bạn…':`Đang tải ${tabs[tab].toLocaleLowerCase('vi')}…`);
  $('searchPanel').hidden = tab !== 0;
  $('shelves').innerHTML = ''; window.scrollTo(0,0);
  $('nav').querySelector('[aria-current]')?.focus({preventScroll:true});
  if(tab === 0) { catState=null; search(); return; }
  if(tab === 5) { catState=null; renderShelves([{def:{h:'Phim đã lưu',kind:'land'},list:[...savedItems].reverse()}]); if(!savedItems.length) $('shelves').innerHTML='<p class="empty">Bạn chưa lưu phim nào. Chọn “Lưu phim” để xem lại tại đây.</p>'; return; }
  if(tab >= 2 && tab <= 4) { renderCategoryTab(tab, 'nav'); return; }
  catState = null;
  const chosen = defs;
  const groups = await Promise.all(chosen.map(async def => {try { const data=await api(`/catalog/${def.type}/${def.catalog}.json`); return {def,list:newestFirst((data.metas || []).map(x=>mapMeta({...x,type:x.type || def.type})))}; } catch {return {def,list:[],error:true};} }));
  if(version !== viewVersion) return;
  const hero=groups.flatMap(g=>g.list)[0];
  const cont=continueList();
  viewLoading(false); setHero(hero); renderShelves(cont.length ? [{def:{h:'Xem tiếp',kind:'land',cont:true},list:cont},...groups] : groups); revealApp(hero);
}
// Lift the startup splash once fonts and the hero backdrop are ready, so the first visible frame is the final layout.
let splashTimer=setTimeout(()=>revealApp(),8000);
async function revealApp(hero) {
  const splash=$('splash'); if(!splash || splash.classList.contains('gone')) return;
  const waits=[];
  try { if(document.fonts) waits.push(document.fonts.ready); } catch {}
  const url=hero && (hero.background || hero.poster);
  if(url && typeof Image!=='undefined') { const img=new Image(); img.src=url; waits.push(img.decode().catch(()=>{})); }
  await Promise.race([Promise.all(waits),new Promise(r=>setTimeout(r,3000))]);
  clearTimeout(splashTimer);
  setTimeout(()=>{
    splash.classList.add('gone');
    setTimeout(()=>splash.remove?.(),400);
    $('hActions')?.querySelector('button')?.focus();
  },0);
}
const notice = document.createElement('div'); notice.className='hint'; notice.setAttribute('role','status'); notice.hidden=true; document.body.append(notice); let noticeTimer;
function toast(message) { notice.textContent=message; notice.hidden=false; clearTimeout(noticeTimer); noticeTimer=setTimeout(()=>notice.hidden=true,2500); }
function saveItem(x) {
  const next = isSaved(x) ? savedItems.filter(s=>key(s)!==key(x)) : [...savedItems,x];
  try {localStorage.setItem('cinebolt.saved',JSON.stringify(next));} catch {toast('Không thể lưu phim trên thiết bị này.');return;}
  savedItems=next;
  document.querySelectorAll('[data-action="save"]').forEach(b=>setSaveButton(b,isSaved(x)));
  toast(isSaved(x)?'Đã lưu phim vào mục Đã lưu.':'Đã bỏ phim khỏi mục Đã lưu.');
}
let detailItem, detailVersion=0;
const detailCache=new Map();
function lockBackground(locked) { ['nav','hero','searchPanel','categoryToolbar','shelves','viewLoading'].forEach(id=>$(id)&&($(id).inert=locked)); document.body.style.overflow=locked?'hidden':''; }

let readMoreOpen = false;
function checkDescOverflow() {
  const descEl = $('dDesc');
  const moreBtn = $('dMore');
  if (!descEl || !moreBtn) return;
  const text = (descEl.textContent || '').trim();
  const isPlaceholder = !text || text.includes('Chưa có mô tả');
  const overflows = !isPlaceholder && descEl.scrollHeight > descEl.clientHeight + 1;
  moreBtn.hidden = !overflows;
}

function openReadMore() {
  const x = detailItem || currentItem;
  if (!x) return;
  const titleEl = $('readMoreTitle');
  const bodyEl = $('readMoreBody');
  if (titleEl) titleEl.textContent = x.t || '';
  if (bodyEl) {
    bodyEl.textContent = x.d || '';
    bodyEl.scrollTop = 0;
  }
  const overlay = $('readMoreOverlay');
  if (overlay) {
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    overlay.inert = false;
  }
  readMoreOpen = true;
  $('readMorePanel')?.focus?.();
}

function closeReadMore() {
  const overlay = $('readMoreOverlay');
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.inert = true;
  readMoreOpen = false;
  $('dMore')?.focus?.();
}

function openDetail(x) {
  detailItem=x; returnFocus=document.activeElement;
  $('dArt').style.cssText=artStyle(x); $('dKick').textContent='Thông tin phim'; $('dTitle').textContent=x.t; $('dMeta').innerHTML=metadata(x); $('dDesc').textContent=x.d;
  checkDescOverflow();
  $('dActions').innerHTML=actions(x); // Back lives top-left (.detail-back)
  $('dFacts').innerHTML=x.imdbRating?`<div><b>Điểm IMDb</b>${esc(x.imdbRating)}</div>`:'';
  epSeason=undefined; epRange=undefined; renderEpisodes();
  $('detail').inert=false; $('detail').classList.add('open'); $('detail').setAttribute('aria-hidden','false'); lockBackground(true); $('dActions').firstElementChild.focus();
  $('detail').scrollTop=0; loadDetail(x);
}
async function loadDetail(x) {
  const version=++detailVersion;
  $('detailStatus').hidden=false; $('detailStatus').innerHTML='<span class="spinner small" aria-hidden="true"></span> Đang tải thông tin phim…';
  $('dDesc').classList.add('detail-pending'); $('dFacts').setAttribute('aria-busy','true');
  try {
    let data=detailCache.get(key(x));
    if(!data) {data=await api(`/meta/${x.type}/${encodeURIComponent(x.id)}.json`); if(!data.meta)throw new Error("missing meta");if(detailCache.size>=40)detailCache.delete(detailCache.keys().next().value);detailCache.set(key(x),data);}
    if(version!==detailVersion)return;
    const full=mapMeta({...data.meta,id:x.id,type:x.type});
    detailItem={...x,...full,poster:full.poster||x.poster,background:full.background||x.background,videos:mapVideos(data.meta.videos)};
    $('dMeta').innerHTML=metadata(detailItem); $('dDesc').textContent=detailItem.d;
    checkDescOverflow();
    $('dFacts').innerHTML=full.imdbRating?`<div><b>Điểm IMDb</b>${esc(full.imdbRating)}</div>`:'';
    renderEpisodes(); setPlayButton($('dActions').querySelector('[data-action="play"]'),detailItem); // label now knows the episode list
    $('detailStatus').hidden=true;
  } catch {
    if(version!==detailVersion)return;
    $('detailStatus').innerHTML='Chưa tải được thông tin đầy đủ. <button class="btn compact" data-action="retryDetail">Thử lại</button>';
  } finally {if(version===detailVersion){
    checkDescOverflow();
    $('dDesc').classList.remove('detail-pending');$('dFacts').setAttribute('aria-busy','false');
    if(!$('player').classList.contains('open') && $('detail').contains(document.activeElement))document.activeElement.scrollIntoView({block:'nearest'});
  }}
}
/* Episode picker: season chips (when >1 season), ranges of 50 (when long), then a grid of episodes. */
const EP_RANGE=50;
let epSeason, epRange;
function renderEpisodes() {
  const box=$('dEpisodes'),eps=detailItem?.type==='series'?detailItem.videos||[]:[];
  if(!eps.length){box.hidden=true;box.innerHTML='';return;}
  const last=watched(detailItem)?.id,lastEp=eps.find(e=>e.id===last);
  const seasons=[...new Set(eps.map(e=>e.season))];
  if(!seasons.includes(epSeason))epSeason=lastEp?lastEp.season:seasons[0];
  const inSeason=eps.filter(e=>e.season===epSeason),ranges=Math.ceil(inSeason.length/EP_RANGE);
  if(epRange===undefined)epRange=lastEp&&lastEp.season===epSeason?Math.floor(inSeason.indexOf(lastEp)/EP_RANGE):0;
  epRange=Math.max(0,Math.min(ranges-1,epRange));
  const shown=inSeason.slice(epRange*EP_RANGE,(epRange+1)*EP_RANGE);
  const chip=(attr,value,label,sel)=>`<button class="ep-tab${sel?' sel':''}" ${attr}="${value}" aria-pressed="${sel}">${esc(label)}</button>`;
  box.innerHTML=`<h3>Danh sách tập<span>${inSeason.length} tập</span></h3>`
    +(seasons.length>1?`<div class="ep-tabs">${seasons.map(s=>chip('data-season',s,`Phần ${s}`,s===epSeason)).join('')}</div>`:'')
    +(ranges>1?`<div class="ep-tabs">${Array.from({length:ranges},(_,r)=>{const a=inSeason[r*EP_RANGE],b=inSeason[Math.min(inSeason.length,(r+1)*EP_RANGE)-1];return chip('data-range',r,`${a.episode}–${b.episode}`,r===epRange);}).join('')}</div>`:'')
    +`<div class="ep-grid">${shown.map(e=>`<button class="ep${e.id===last?' last':''}" data-episode="${esc(e.id)}" aria-label="Xem ${esc(episodeTitle(e))}${e.id===last?' (đang xem)':''}">${esc(episodeTitle(e).replace(/^Tập */i,''))}</button>`).join('')}</div>`;
  box.hidden=false;
}
/* Focus selects a season/range chip; re-render and put focus back on the same chip. */
function selectEpisodeTab(b) {
  if(b.classList.contains('sel'))return;
  if(b.dataset.season!==undefined){epSeason=Number(b.dataset.season);epRange=0;}else epRange=Number(b.dataset.range);
  const sel=b.dataset.season!==undefined?`[data-season="${b.dataset.season}"]`:`[data-range="${b.dataset.range}"]`;
  renderEpisodes(); $('dEpisodes').querySelector(sel)?.focus({preventScroll:true});
}
function playEpisode(x, id) {
  const e=(x.videos||[]).find(v=>v.id===id); if(!e)return;
  rememberEpisode(x,{id:e.id,title:episodeTitle(e)});
  playMovie({...x,streamId:e.id,epTitle:episodeTitle(e)});
}
function playItem(x) {
  if(!x)return;
  if(x.type==='series'){
    const n=nextEpisode(x),w=watched(x);
    if(n)return playEpisode(x,n.e.id);
    if(w)return playMovie({...x,streamId:w.id,epTitle:w.title});
  }
  playMovie(x);
}
/* After playback: update "Xem tiếp" labels and the highlighted episode without re-rendering (focus stays put). */
function refreshWatched() {
  const x=detailItem; if(!x)return;
  setPlayButton($('dActions').querySelector('[data-action="play"]'),x);
  const last=watched(x)?.id;
  $('dEpisodes').querySelectorAll('[data-episode]').forEach(b=>b.classList.toggle('last',b.dataset.episode===last));
}
function closeDetail() {
  closeReadMore();
  closeFilterPopup(null);
  ++detailVersion;
  $('detail').classList.remove('open'); $('detail').setAttribute('aria-hidden','true'); $('detail').inert=true; lockBackground(false);
  if(activeTab===5) {openTab(5);return;}
  if(currentItem) {setSaveButton($('hActions').querySelector('[data-action="save"]'),isSaved(currentItem));setPlayButton($('hActions').querySelector('[data-action="play"]'),currentItem);}
  returnFocus?.focus();
}
let searchTimer;
// Results are grouped by category; each group keeps the newest-first order of the list.
const isAnime = x => /hoạt hình/i.test(x.g || '');
function groupResults(list, q = '') {
  const exact = fold(q);
  return [['Phim lẻ', x => x.type === 'movie' && !isAnime(x)], ['Phim bộ', x => x.type !== 'movie' && !isAnime(x)], ['Hoạt hình', isAnime]]
    .map(([h, test]) => { const all = list.filter(test), hit = exact ? all.filter(x => fold(x.t) === exact) : [];
      return {h, list: [...hit, ...all.filter(x => !hit.includes(x))]}; })
    .filter(g => g.list.length);
}
// Accent-insensitive comparison (Vietnamese): "Thượng Công Chúa" == "thuong cong chua".
function fold(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase().replace(/ +/g, ' ').trim(); }
// Few cards per category keep a search light on the TV (artwork is large); "Xem thêm" opens the rest of a group.
const RESULT_LIMIT = 6; let resultGroups = [], expandedGroups = new Set();
const RESULT_COLS = 3;
function renderResults(groups) {
  resultGroups = groups; items = new Map(); let row = 2;
  $('shelves').innerHTML = groups.map((g, gi) => {
    const shown = expandedGroups.has(g.h) ? g.list : g.list.slice(0, RESULT_LIMIT), more = g.list.length - shown.length;
    const html = `<section class="shelf results"><h2>${esc(g.h)}<span>${g.list.length}</span></h2><div class="results-grid">${shown.map((x, c) => card(x, row + Math.floor(c / RESULT_COLS), c % RESULT_COLS, true)).join('')}</div>${more > 0 ? `<button class="btn compact more" data-more="${gi}">Xem thêm ${more} phim</button>` : ''}</section>`;
    row += Math.ceil(shown.length / RESULT_COLS) + 1; return html;
  }).join('');
  lazyArt($('shelves'));
}
// Result artwork loads only when a card comes within ~one screen of view.
// It waits briefly so results that are replaced while the viewer is still typing never fetch their images.
let artObserver, artTimer;
function cancelArt() { clearTimeout(artTimer); artObserver?.disconnect(); }
function lazyArt(root, delay = 500) {
  const arts = [...root.querySelectorAll('.art[data-bg]')];
  const show = el => { el.style.cssText = el.dataset.bg; el.removeAttribute('data-bg'); };
  if (typeof IntersectionObserver === 'undefined') { arts.forEach(show); return; }
  cancelArt();
  artTimer = setTimeout(() => {
    artObserver = new IntersectionObserver(entries => entries.forEach(e => { if (e.isIntersecting) { show(e.target); artObserver.unobserve(e.target); } }), {rootMargin: '400px 0px'});
    arts.forEach(el => artObserver.observe(el));
  }, delay);
}
function expandGroup(gi) {
  const g = resultGroups[+gi]; if (!g) return; expandedGroups.add(g.h);
  const next = RESULT_LIMIT; renderResults(resultGroups); lazyArt($('shelves'), 0);
  $('shelves').querySelectorAll('.results')[+gi]?.querySelectorAll('.card')[next]?.focus({preventScroll: true});
  document.activeElement?.scrollIntoView?.({block: 'center', behavior: 'instant'});
}
// On-screen keyboard: the system keyboard covers half the screen (and the results), so search types with its own keys.
const BACK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h11v14H9l-6-7z"/><path d="m12.5 9.5 5 5m0-5-5 5"/></svg>';
$('searchKeys').innerHTML = [...'abcdefghijklmnopqrstuvwxyz1234567890'].map(c => `<button class="kb-key" data-key="${c}">${c}</button>`).join('')
  + '<button class="kb-key wide" data-key=" " aria-label="Dấu cách">Cách</button>'
  + `<button class="kb-key wide" data-key="back" aria-label="Xóa ký tự">${BACK_ICON}</button>`
  + '<button class="kb-key wide" data-key="clear" aria-label="Xóa hết">Xóa hết</button>';
function typeKey(k) {
  const s = $('searchInput'); let v = s.value;
  if(k === 'back') v = v.slice(0, -1);
  else if(k === 'clear') v = '';
  else if(v.length < 40 && !(k === ' ' && (!v || v.endsWith(' ')))) v += k;
  if(v === s.value) return;
  s.value = v; clearTimeout(searchTimer); cancelArt(); ++viewVersion; searchTimer = setTimeout(search, 400);
}
async function search() {
  const q=$('searchInput').value.trim(),version=++viewVersion;
  if(fold(q).replace(/ /g,'').length<2){viewLoading(false);$('shelves').innerHTML='<p class="empty">Kết quả sẽ hiện ở đây khi bạn gõ tên phim (từ 2 ký tự).</p>';$('searchStatus').textContent='Gõ tên phim, không cần dấu.';return;}
  viewLoading(true,'Đang tìm phim…'); $('searchStatus').textContent='Đang tìm kiếm…';$('shelves').innerHTML='';
  const results=await Promise.allSettled(defs.slice(0,2).map(d=>api(`/catalog/${d.type}/${d.catalog}/search=${encodeURIComponent(q)}.json`)));
  if(version!==viewVersion || activeTab!==0)return;
  viewLoading(false);
  const list=newestFirst([...new Map(results.flatMap((r,i)=>r.status==='fulfilled'?(r.value.metas || []).map(x=>mapMeta({...x,type:x.type || defs[i].type})):[]).map(x=>[key(x),x])).values()]);
  const failures=results.filter(r=>r.status==='rejected').length;
  $('searchStatus').textContent=failures===2?'Không thể tìm kiếm. Kiểm tra kết nối rồi nhấn Enter để thử lại.':`${list.length} kết quả cho “${q}”.${failures?' Một nguồn tìm kiếm chưa phản hồi.':''}`;
  expandedGroups = new Set();
  if(list.length)renderResults(groupResults(list, q));
  else if(!failures)$('shelves').innerHTML='<p class="empty">Không tìm thấy phim. Hãy thử tên khác hoặc từ khóa ngắn hơn.</p>';
}
// The TV keyboard opens whenever an editable field takes focus and then swallows the D-pad, so the field stays
// keyboard-less (inputmode=none) while the remote walks over it; OK asks for the keyboard, leaving it turns it off again.
function editSearch(){const s=$('searchInput');s.inputMode='text';try{window.CineBolt?.showKeyboard();}catch{}}
window.cineBoltOk=()=>{const s=$('searchInput');if(document.activeElement===s && s.inputMode==='none')editSearch();};
$('searchInput').addEventListener('blur',()=>{$('searchInput').inputMode='none';});
document.addEventListener('scroll',()=>document.body.classList.toggle('scrolled',scrollY>24),{passive:true});
$('searchInput').addEventListener('input',()=>{clearTimeout(searchTimer);++viewVersion;searchTimer=setTimeout(search,350);});
document.addEventListener('click',event=>{
  if(event.target.classList.contains('filter-popup-backdrop') || event.target.dataset.action === 'closePopup'){
    closeFilterPopup(null);
    return;
  }
  if(event.target.dataset.action === 'closeReadMore'){
    closeReadMore();
    return;
  }
  const b=event.target.closest('button');if(!b)return;
  if(b.classList.contains('popup-item')){
    closeFilterPopup(b.dataset.value);
    return;
  }
  if(b.dataset.dropdown){
    openFilterPopup(b.dataset.dropdown, b);
    return;
  }
  if(b.dataset.action === 'clearFilters'){
    clearCategoryFilters();
    return;
  }
  if(b.dataset.action === 'readMore'){
    openReadMore();
    return;
  }
  if(b.dataset.filterType){selectCategoryFilter(b.dataset.filterType,b.dataset.value);return;}
  if(b.dataset.action === 'firstPage'){goToCategoryPage(1);return;}
  if(b.dataset.action === 'prevPage'){goToCategoryPage((catState?.page || 1) - 1);return;}
  if(b.dataset.action === 'nextPage'){goToCategoryPage((catState?.page || 1) + 1);return;}
  if(b.dataset.key!==undefined){typeKey(b.dataset.key);return;}
  if(b.dataset.more!==undefined){expandGroup(b.dataset.more);return;}
  if(b.dataset.tab!==undefined){openTab(+b.dataset.tab);return;}
  if(b.dataset.resume && b.dataset.item){playItem(items.get(b.dataset.item));return;}
  if(b.dataset.item){openDetail(items.get(b.dataset.item));return;}
  if(b.dataset.episode){playEpisode(detailItem,b.dataset.episode);return;}
  if(b.dataset.season!==undefined||b.dataset.range!==undefined){selectEpisodeTab(b);return;}
  const x=$('detail').classList.contains('open')?detailItem:currentItem;
  switch(b.dataset.action){case 'play':playItem(x);break;case 'save':saveItem(x);break;case 'detail':openDetail(x);break;case 'closeDetail':closeDetail();break;case 'retryDetail':loadDetail(detailItem);break;case 'retryCategory':renderCategoryTab(activeTab);break;case 'retry':openTab(activeTab);break;}
});
document.addEventListener('focusin',event=>{
  document.querySelectorAll('.f').forEach(el=>el.classList.remove('f'));
  const b=event.target.closest('button'); b?.classList.add('f');
  if(b && (b.dataset.season!==undefined||b.dataset.range!==undefined))selectEpisodeTab(b);
  if(b && b.classList.contains('card') && catState){
    const item = items.get(b.dataset.item);
    if(item) setCategoryFocusedFilm(item);
    if (tabFilters[activeTab]) tabFilters[activeTab].lastCardId = b.dataset.item;
  }
});
/* Geometric D-pad move for the details page (buttons, chips and the episode grid). */
function spatialTarget(controls, focus, k) {
  const r=focus.getBoundingClientRect(),horizontal=k==='ArrowLeft'||k==='ArrowRight';
  let best,score=Infinity;
  for(const el of controls){
    if(el===focus)continue;
    const b=el.getBoundingClientRect();
    if(horizontal){
      if(b.bottom<=r.top+2||b.top>=r.bottom-2)continue; // same line only
      const gap=k==='ArrowRight'?b.left-r.right:r.left-b.right; if(gap<-2)continue;
      if(gap<score){score=gap;best=el;}
    } else {
      const gap=k==='ArrowDown'?b.top-r.bottom:r.top-b.bottom; if(gap<-2)continue;
      const s=gap*4+Math.abs((b.left+b.right)/2-(r.left+r.right)/2); if(s<score){score=s;best=el;}
    }
  }
  return best;
}
function closestVertically(elements, focus) {
  if (!elements || !elements.length) return null;
  const getTop = el => el.getBoundingClientRect ? el.getBoundingClientRect().top : (el.top !== undefined ? el.top : 0);
  const getBottom = el => el.getBoundingClientRect ? el.getBoundingClientRect().bottom : (el.bottom !== undefined ? el.bottom : 0);
  const cy = (getTop(focus) + getBottom(focus)) / 2;
  let best = elements[0], minDist = Infinity;
  for (const el of elements) {
    const ecy = (getTop(el) + getBottom(el)) / 2;
    const dist = Math.abs(cy - ecy);
    if (dist < minDist) { minDist = dist; best = el; }
  }
  return best;
}
function closestByX(candidates, focus) {
  if (!candidates || !candidates.length) return null;
  if (!focus || !focus.getBoundingClientRect) return candidates[0];
  const r = focus.getBoundingClientRect();
  const cx = (r.left + r.right) / 2;
  let best = candidates[0], minDist = Infinity;
  for (const c of candidates) {
    const cr = c.getBoundingClientRect();
    const ccx = (cr.left + cr.right) / 2;
    const dist = Math.abs(cx - ccx);
    if (dist < minDist) { minDist = dist; best = c; }
  }
  return best;
}
function visibleControls() {
  if (readMoreOpen) {
    return [...$('readMorePanel').querySelectorAll('button')];
  }
  if (popupState) {
    return [...$('filterPopupList').querySelectorAll('.popup-item')];
  }
  const root=$('player').classList.contains('open')?$('player'):$('detail').classList.contains('open')?$('detail'):document;
  return [...root.querySelectorAll('button,input,video[controls]')].filter(el=>!el.closest('[inert]') && el.tabIndex>=0 && (!el.getClientRects || el.getClientRects().length));
}
document.addEventListener('keydown',event=>{
  const k=event.key,focus=document.activeElement,player=$('player').classList.contains('open'),detail=$('detail').classList.contains('open');
  const splash=$('splash');if(splash && splash.isConnected && !splash.classList.contains('gone')){event.preventDefault();return;} // nothing to drive until the home screen is shown
  if(player){handlePlayerKey(event);return;}

  if(readMoreOpen){
    if(k==='Escape'||(k==='Backspace'&&focus.tagName!=='INPUT')||k==='Enter'||k===' '){
      event.preventDefault();
      closeReadMore();
      return;
    }
    if(k==='ArrowUp'){
      event.preventDefault();
      const b=$('readMoreBody');
      if(b) b.scrollTop -= 60;
      return;
    }
    if(k==='ArrowDown'){
      event.preventDefault();
      const b=$('readMoreBody');
      if(b) b.scrollTop += 60;
      return;
    }
    if(k.startsWith('Arrow')||k==='Tab'){
      event.preventDefault();
      return;
    }
    return;
  }

  if(detail){
    if(k==='Escape'||(k==='Backspace'&&focus.tagName!=='INPUT')){
      event.preventDefault();
      closeDetail();
      return;
    }
    const controls=visibleControls();
    if(k==='Tab'){
      event.preventDefault();
      controls[(controls.indexOf(focus)+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus();
      return;
    }
    if((k==='Enter'||k===' ')&&focus.tagName==='BUTTON'){
      event.preventDefault();
      focus.click();
      return;
    }
    if(k.startsWith('Arrow')){
      event.preventDefault();
      let target=controls.includes(focus)?spatialTarget(controls,focus,k):controls[0];
      const acts=[...$('dActions').querySelectorAll('button')];
      const moreBtn=$('dMore');
      const hasMore=moreBtn&&!moreBtn.hidden;

      if(k==='ArrowDown'&&focus.classList.contains('detail-back'))target=acts[0]||target;
      if(k==='ArrowDown'&&acts.includes(focus))target=hasMore?moreBtn:($('dEpisodes').querySelector('.ep.last')||$('dEpisodes').querySelector('button')||target);
      if(k==='ArrowDown'&&focus.id==='dMore')target=$('dEpisodes').querySelector('.ep.last')||$('dEpisodes').querySelector('button')||target;
      if(k==='ArrowUp'&&focus.closest('#dEpisodes')&&target&&target.closest('.d-info'))target=hasMore?moreBtn:(acts[0]||target);
      if(k==='ArrowUp'&&focus.id==='dMore')target=acts[0]||target;
      if(k==='ArrowRight'&&focus.id==='dMore')target=acts[0]||target;
      if(k==='ArrowLeft'&&acts.includes(focus)&&hasMore)target=moreBtn;

      if(target){
        target.focus({preventScroll:true});
        const now=document.activeElement;
        if(now.closest('.d-info'))$('detail').scrollTo({top:0});
        else now.scrollIntoView({block:now.closest('#dEpisodes')?'center':'nearest',behavior:'instant'});
      } else if(k==='ArrowUp'){
        $('detail').scrollTo({top:0});
      }
      return;
    }
    return;
  }

  // Rail navigation: when focus is inside #nav
  if(focus.closest('#nav')){
    const tabsList = [...$('nav').querySelectorAll('.tab')];
    const idx = tabsList.indexOf(focus);

    if(k === 'ArrowUp'){
      event.preventDefault();
      if(idx > 0) tabsList[idx - 1].focus({preventScroll:true});
      return;
    }
    if(k === 'ArrowDown'){
      event.preventDefault();
      if(idx < tabsList.length - 1) tabsList[idx + 1].focus({preventScroll:true});
      return;
    }
    if(k === 'Enter' || k === ' '){
      event.preventDefault();
      focus.click();
      return;
    }
    if(k === 'ArrowRight'){
      event.preventDefault();
      if(activeTab === 0){
        $('searchKeys')?.querySelector('button')?.focus({preventScroll:true});
      } else if(activeTab === 1){
        const heroBtn = $('hActions')?.querySelector('button:not([disabled])');
        if(heroBtn && !$('hero').hidden){
          heroBtn.focus({preventScroll:true});
        } else {
          $('shelves')?.querySelector('.card')?.focus({preventScroll:true});
        }
      } else if(activeTab >= 2 && activeTab <= 4){
        const pill = $('categoryToolbar')?.querySelector('.toolbar-pill:not([disabled])');
        if(pill){
          pill.focus({preventScroll:true});
        } else {
          $('categoryGrid')?.querySelector('.card')?.focus({preventScroll:true});
        }
      } else if(activeTab === 5){
        $('shelves')?.querySelector('.card, button:not([disabled])')?.focus({preventScroll:true});
      }
      return;
    }
    if(k === 'ArrowLeft'){
      event.preventDefault();
      return;
    }
    if(k === 'Escape' || (k === 'Backspace' && focus.tagName !== 'INPUT')){
      event.preventDefault();
      if(activeTab !== 1) openTab(1);
      return;
    }
    return;
  }

  if(focus.tagName==='INPUT'){
    if(k==='Enter'){event.preventDefault();if(focus.inputMode==='none'){editSearch();return;}clearTimeout(searchTimer);search();}
    if(k==='ArrowDown'){const first=$('searchKeys')?.querySelector('button');if(first){event.preventDefault();first.focus({preventScroll:true});}}
    if(k==='ArrowLeft'){event.preventDefault();$('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});}
    if(k==='ArrowUp'){event.preventDefault();}
    if(k==='Escape'||k==='Backspace'){event.preventDefault();$('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});}
    return;
  }

  if(!player && !detail && activeTab >= 2 && activeTab <= 4){
    if(popupState){
      if(k==='Escape'||(k==='Backspace'&&focus.tagName!=='INPUT')){
        event.preventDefault();
        closeFilterPopup(null);
        return;
      }
      if(k==='Enter'||k===' '){
        event.preventDefault();
        if(focus && focus.classList.contains('popup-item')){
          closeFilterPopup(focus.dataset.value);
        }
        return;
      }
      if(k==='ArrowUp'||k==='ArrowDown'){
        event.preventDefault();
        const items=[...$('filterPopupList').querySelectorAll('.popup-item')];
        const idx=items.indexOf(focus);
        const nextIdx=k==='ArrowUp'?Math.max(0,idx-1):Math.min(items.length-1,idx+1);
        const target=items[nextIdx];
        if(target){
          target.focus({preventScroll:true});
          target.scrollIntoView?.({block:'nearest'});
        }
        return;
      }
      if(k==='ArrowLeft'||k==='ArrowRight'||k==='Tab'){
        event.preventDefault();
        return;
      }
      return;
    }

    if(k==='MediaFastForward'||k==='ChannelUp'){
      event.preventDefault();
      if(catState && (catState.totalPages === null || catState.page < catState.totalPages) && catState.hasMore){
        goToCategoryPage(catState.page + 1);
      }
      return;
    }
    if(k==='MediaRewind'||k==='ChannelDown'){
      event.preventDefault();
      if(catState && catState.page > 1){
        goToCategoryPage(catState.page - 1);
      }
      return;
    }

    if(k==='Escape'||(k==='Backspace'&&focus.tagName!=='INPUT')){
      event.preventDefault();
      $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
      return;
    }

    if((k==='Enter'||k===' ')&&focus.tagName==='BUTTON'){
      event.preventDefault();
      focus.click();
      return;
    }

    if(k.startsWith('Arrow')){
      event.preventDefault();
      const toolbar=$('categoryToolbar');
      const tbButtons=toolbar?[...toolbar.querySelectorAll('button:not([disabled])')]:[];
      const grid=$('categoryGrid');
      const cards=grid?[...grid.querySelectorAll('.card')]:[];
      const row0Cards=cards.filter(c=>c.dataset.row==='0');

      if(tbButtons.includes(focus)){
        if(k==='ArrowLeft'){
          const idx=tbButtons.indexOf(focus);
          if(idx === 0){
            $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
            return;
          }
          tbButtons[idx-1].focus({preventScroll:true});
          return;
        }
        if(k==='ArrowRight'){
          const idx=tbButtons.indexOf(focus);
          if(idx < tbButtons.length-1) tbButtons[idx+1].focus({preventScroll:true});
          return;
        }
        if(k==='ArrowUp'){
          return;
        }
        if(k==='ArrowDown'){
          const target=closestByX(row0Cards, focus) || row0Cards[0];
          target?.focus({preventScroll:true});
          return;
        }
        return;
      }

      if(focus.classList.contains('card')){
        const row=Number(focus.dataset.row ?? 0);
        const col=Number(focus.dataset.col ?? 0);

        if(k==='ArrowLeft'){
          if(col === 0){
            $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
            return;
          }
          grid.querySelector(`.card[data-row="${row}"][data-col="${col-1}"]`)?.focus({preventScroll:true});
          return;
        }
        if(k==='ArrowRight'){
          if(col >= GRID_COLS - 1) return;
          grid.querySelector(`.card[data-row="${row}"][data-col="${col+1}"]`)?.focus({preventScroll:true});
          return;
        }
        if(k==='ArrowUp'){
          if(row === 0){
            const target=closestByX(tbButtons, focus) || tbButtons[0];
            target?.focus({preventScroll:true});
            return;
          }
          grid.querySelector(`.card[data-row="${row-1}"][data-col="${col}"]`)?.focus({preventScroll:true});
          return;
        }
        if(k==='ArrowDown'){
          if(row >= 1) return;
          grid.querySelector(`.card[data-row="${row+1}"][data-col="${col}"]`)?.focus({preventScroll:true});
          return;
        }
        return;
      }
    }
    return;
  }

  if(activeTab===0){
    if(k==='Escape'||(k==='Backspace'&&focus.tagName!=='INPUT')){
      event.preventDefault();
      $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
      return;
    }
    if((k==='Enter'||k===' ')&&focus.tagName==='BUTTON'){
      event.preventDefault();
      focus.click();
      return;
    }
    if(k.startsWith('Arrow')){
      event.preventDefault();
      const keys = [...$('searchKeys').querySelectorAll('button')];
      const cards = [...$('shelves').querySelectorAll('.card')];

      if(keys.includes(focus)){
        if(k==='ArrowLeft'){
          const target = spatialTarget(keys, focus, k);
          if(!target){
            $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
          } else {
            target.focus({preventScroll:true});
          }
          return;
        }
        if(k==='ArrowRight'){
          const target = spatialTarget(keys, focus, k);
          if(target){
            target.focus({preventScroll:true});
          } else if(cards.length){
            cards[0].focus({preventScroll:true});
            cards[0].scrollIntoView?.({block:'center',inline:'nearest',behavior:'instant'});
          }
          return;
        }
        if(k==='ArrowUp'){
          const target = spatialTarget(keys, focus, k);
          if(target){
            target.focus({preventScroll:true});
          } else {
            $('searchInput')?.focus({preventScroll:true});
          }
          return;
        }
        if(k==='ArrowDown'){
          const target = spatialTarget(keys, focus, k);
          target?.focus({preventScroll:true});
          return;
        }
        return;
      }

      if(cards.includes(focus)){
        if(k==='ArrowLeft'){
          const target = spatialTarget(cards, focus, k);
          if(target){
            target.focus({preventScroll:true});
            target.scrollIntoView?.({block:'center',inline:'nearest',behavior:'instant'});
          } else {
            const nearestKey = closestVertically(keys, focus) || keys[0];
            nearestKey?.focus({preventScroll:true});
          }
          return;
        }
        const target = spatialTarget(cards, focus, k);
        if(target){
          target.focus({preventScroll:true});
          target.scrollIntoView?.({block:'center',inline:'nearest',behavior:'instant'});
        }
        return;
      }
    }
    return;
  }

  if(k==='Escape' || (k==='Backspace' && focus.tagName!=='INPUT')){
    event.preventDefault();
    if(focus && !focus.closest('#nav')){
      $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
    } else if(activeTab!==1){
      openTab(1);
    }
    return;
  }

  const controls=visibleControls();
  if(k==='Tab' && (detail || player)){event.preventDefault();controls[(controls.indexOf(focus)+(event.shiftKey?-1:1)+controls.length)%controls.length]?.focus();return;}
  if((k==='Enter'||k===' ') && focus.tagName==='BUTTON'){event.preventDefault();focus.click();return;}

  // Everywhere else (home, saved): move geometrically between the visible buttons.
  // Scroll containers such as a home row must never take focus themselves, so focus always lands on a control.
  if(k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight'){
    const scope=detail?$('detail'):document;
    const controls=[...scope.querySelectorAll('button:not([disabled])')].filter(el=>!el.closest('[hidden],[inert]')&&el.getClientRects().length&&(detail||!el.closest('#detail')));
    const from=focus&&focus.tagName==='BUTTON'?focus:(focus?.querySelector?.('button')||null);
    if(!from){const first=controls[0];if(first){event.preventDefault();first.focus({preventScroll:true});}return;}
    const content=controls.filter(el=>!el.closest('#nav'));

    // Left boundary on Home & Saved
    if(k==='ArrowLeft'){
      const heroActs = [...($('hActions')?.querySelectorAll('button:not([disabled])') || [])];
      if(heroActs.includes(from) && heroActs.indexOf(from) === 0){
        event.preventDefault();
        $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
        return;
      }
      const track = from.closest('.track');
      if(track){
        const trackCards = [...track.querySelectorAll('.card')];
        if(trackCards.indexOf(from) === 0){
          event.preventDefault();
          $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
          return;
        }
      }
    }

    const target=spatialTarget(content,from,k);
    event.preventDefault();
    if(!target){
      if(k==='ArrowLeft'){
        $('nav')?.querySelector('[aria-current]')?.focus({preventScroll:true});
      } else if(k==='ArrowUp'){
        if(!detail) window.scrollTo({top:0,behavior:'instant'});
      }
      return;
    }
    target.focus({preventScroll:true});
    if(target.closest('#hActions')){if(!detail)window.scrollTo({top:0});}
    else target.scrollIntoView({block:target.closest('.track')?'center':'nearest',inline:'nearest'});
  }
});
$('clock').textContent=new Date().toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'});
openTab(1);

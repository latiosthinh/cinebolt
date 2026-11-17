/* Remote-first player. Native browser controls are intentionally disabled. */
let controlsTimer, playbackTimer, playerFailed=false;
const playerGlyph = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const toggleGlyph = paused => playerGlyph(paused?'<path d="m8 4 12 8-12 8z"/>':'<path d="M8 4v16M16 4v16"/>');
const isPlayerOpen = () => $('player').classList.contains('open');
/* Transport buttons, left to right, and the jump each one makes (seconds). */
const seekButtons = {playerBack5:-300,playerBack1:-60,playerRewind:-10,playerForward:10,playerFwd1:60,playerFwd5:300};
const transportOrder = ['playerBack5','playerBack1','playerRewind','playerToggle','playerForward','playerFwd1','playerFwd5','playerMute','playerHide'];
/* Holding ← → on the timeline accelerates: 10 s, then 30 s, then 60 s per key repeat. */
let seekHold=0, lastSeekKey=0;
function holdStep(now=Date.now()) {
  seekHold = now-lastSeekKey<350 ? seekHold+1 : 0; lastSeekKey=now;
  return seekHold<6 ? 10 : seekHold<18 ? 30 : 60;
}
const timeLabel = seconds => {
  if(!Number.isFinite(seconds))return '--:--';
  const n=Math.max(0,Math.floor(seconds)),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=String(n%60).padStart(2,'0');
  return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;
};
/* Called on every timeupdate (~4×/s): touch the DOM only when something visible changed, and skip the timeline while controls are hidden. */
let shownState={};
function updatePlayer(force=false) {
  const video=$('video'),duration=video.duration,canSeek=Number.isFinite(duration)&&duration>0;
  const label=video.ended?'Xem lại':video.paused?'Phát':'Tạm dừng';
  const next={canSeek,label,paused:video.paused,muted:video.muted};
  if(force || next.canSeek!==shownState.canSeek){
    $('playerSeek').disabled=!canSeek; for(const id of Object.keys(seekButtons))$(id).disabled=!canSeek;
  }
  if(force || label!==shownState.label || next.paused!==shownState.paused){
    $('playerToggle').innerHTML=toggleGlyph(video.paused)+`<span>${label}</span>`; $('playerToggle').setAttribute('aria-label',label);
  }
  if(force || next.muted!==shownState.muted){
    $('playerMute').innerHTML=playerGlyph(`<path d="M11 4 6 8H3v8h3l5 4z"/>${video.muted?'<path d="m16 9 5 6m0-6-5 6"/>':'<path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'}`)+`<span>${video.muted?'Bật tiếng':'Tắt tiếng'}</span>`;
    $('playerMute').setAttribute('aria-label',video.muted?'Bật tiếng':'Tắt tiếng'); $('playerMute').setAttribute('aria-pressed',String(video.muted));
  }
  shownState=next;
  if(!force && !$('player').classList.contains('ui-visible'))return;
  const second=Math.floor(video.currentTime||0),durationText=duration===Infinity?'Trực tiếp':timeLabel(duration);
  if(!force && second===shownState.second && durationText===shownState.durationText)return;
  shownState.second=second; shownState.durationText=durationText;
  $('playerElapsed').textContent=timeLabel(video.currentTime); $('playerDuration').textContent=durationText;
  $('playerSeek').max=canSeek?duration:100; $('playerSeek').value=video.currentTime||0;
  $('playerSeek').style.setProperty('--played',`${canSeek?video.currentTime/duration*100:0}%`);
  $('playerSeek').setAttribute('aria-valuetext',`${timeLabel(video.currentTime)} trên ${timeLabel(duration)}`);
}
function showPlayerControls(focusId) {
  if(!isPlayerOpen())return;
  const wasHidden=!$('player').classList.contains('ui-visible');
  $('player').classList.add('ui-visible'); $('playerTop').inert=false; $('playerControls').inert=false;
  if(wasHidden)updatePlayer(true); // timeline was not updated while hidden
  if(focusId && !$(focusId).disabled)$(focusId).focus({preventScroll:true});
  clearTimeout(controlsTimer);
  if(!$('video').paused && !playerFailed && $('playerLoading').hidden)controlsTimer=setTimeout(hidePlayerControls,4500);
}
function hidePlayerControls(immediate=false) {
  if(!isPlayerOpen() || !immediate && ($('video').paused || playerFailed || !$('playerLoading').hidden))return;
  clearTimeout(controlsTimer);
  $('player').focus({preventScroll:true}); $('player').classList.remove('ui-visible'); $('playerTop').inert=true; $('playerControls').inert=true;
}
function playerLoading(message) {
  if(!isPlayerOpen() || playerFailed)return;
  $('playerLoading').hidden=false; $('playerLoading').classList.remove('is-error'); $('playerLoadingText').textContent=message; $('playerRetry').hidden=true;
  clearTimeout(playbackTimer); playbackTimer=setTimeout(()=>playerError('Phim tải quá lâu. Vui lòng thử lại hoặc quay lại.'),25000);
  showPlayerControls();
}
function playerError(message) {
  if(!isPlayerOpen())return;
  playerFailed=true;clearTimeout(playbackTimer);clearTimeout(controlsTimer);
  if(hls){hls.destroy();hls=null;} $('video').pause();
  $('playerLoading').hidden=false; $('playerLoading').classList.add('is-error'); $('playerLoadingText').textContent=message; $('playerRetry').hidden=false;
  showPlayerControls('playerRetry');
}
async function startVideo(version) {
  if(version!==playerVersion || !isPlayerOpen() || playerFailed)return;
  try {await $('video').play();} catch {
    if(version!==playerVersion || !isPlayerOpen())return;
    clearTimeout(playbackTimer);$('playerLoading').hidden=true;showPlayerControls('playerToggle');updatePlayer();
  }
}
async function playMovie(x, retry=false) {
  if(!x)return;
  const version=++playerVersion;playerItem=x;playerFailed=false;
  if(!retry){playerReturnFocus=document.activeElement;if(typeof rememberHistory==='function')rememberHistory(x);}
  clearTimeout(controlsTimer);clearTimeout(playbackTimer);
  if(hls){hls.destroy();hls=null;}
  const video=$('video');video.pause();video.removeAttribute('src');video.load();
  $('playerTitle').textContent=x.epTitle?`${x.t} · ${x.epTitle}`:x.t; $('player').style.cssText=artStyle(x);
  $('player').inert=false; $('player').classList.remove('ready'); $('player').classList.add('open','ui-visible'); $('player').setAttribute('aria-hidden','false');
  $('detail').inert=true;lockBackground(true);updatePlayer(true);showPlayerControls('playerToggle');playerLoading('Đang tìm nguồn phát…');
  try {
    const data=await api(`/stream/${x.type}/${encodeURIComponent(x.streamId || x.id)}.json`);if(version!==playerVersion)return;
    const stream=(data.streams||[]).find(s=>s.url && /^https?:\/\//i.test(s.url));
    if(!stream){playerError('Chưa có nguồn phát cho phim này. Hãy quay lại và chọn phim khác.');return;}
    playerLoading('Đang tải phim…');
    const start=resumeAt(x.streamId || x.id);if(start)toast(`Xem tiếp từ ${timeLabel(start)}`);
    if(stream.url.includes('.m3u8') && typeof Hls!=='undefined' && Hls.isSupported()) {
      // Bounded buffers: hls.js keeps every played segment by default (backBufferLength: Infinity), which grows memory over a long film.
      hls=new Hls({startPosition:start||-1,backBufferLength:30,maxBufferLength:30,maxMaxBufferLength:60,maxBufferSize:40*1000*1000});hls.loadSource(stream.url);hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED,()=>startVideo(version));
      hls.on(Hls.Events.ERROR,(_,data)=>{if(version===playerVersion && data.fatal)playerError('Không thể phát nguồn phim này. Hãy thử lại.');});
    } else {video.src=stream.url;if(start)video.addEventListener('loadedmetadata',()=>{video.currentTime=start;},{once:true});startVideo(version);}
  } catch {if(version===playerVersion)playerError('Không tải được phim. Vui lòng kiểm tra kết nối và thử lại.');}
}
function closePlayer() {
  rememberPosition();
  ++playerVersion;clearTimeout(controlsTimer);clearTimeout(playbackTimer);playerFailed=false;
  $('playerLoading').hidden=true; // stop the spinner: a hidden player must not keep animating
  $('player').classList.remove('open','ready','ui-visible');$('player').setAttribute('aria-hidden','true');$('player').inert=true;
  if(hls){hls.destroy();hls=null;}const video=$('video');video.pause();video.removeAttribute('src');video.load();
  const detail=$('detail').classList.contains('open');$('detail').inert=!detail;lockBackground(detail);
  if(detail)refreshWatched();
  playerReturnFocus?.focus({preventScroll:true});
}
function togglePlayback() {
  if(playerFailed){playMovie(playerItem,true);return;}
  const video=$('video');
  if(video.paused){if(video.ended)video.currentTime=0;startVideo(playerVersion);}else video.pause();
  showPlayerControls('playerToggle');updatePlayer();
}
function seekPlayer(delta) {
  const video=$('video');if(!Number.isFinite(video.duration)||video.duration<=0)return;
  video.currentTime=Math.max(0,Math.min(video.duration,video.currentTime+delta));updatePlayer();showPlayerControls();
}
function handlePlayerKey(event) {
  const k=event.key,focus=document.activeElement;
  if(['Escape','Backspace'].includes(k)){event.preventDefault();closePlayer();return;}
  if(['MediaPlayPause','MediaPlay','MediaPause'].includes(k)){event.preventDefault();if(k==='MediaPlay' && !$('video').paused || k==='MediaPause' && $('video').paused)return;togglePlayback();return;}
  if(k==='MediaFastForward'||k==='MediaRewind'){event.preventDefault();seekPlayer(k==='MediaFastForward'?10:-10);showPlayerControls('playerSeek');return;}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' ','Tab'].includes(k))return;
  event.preventDefault();
  const shown=$('player').classList.contains('ui-visible');
  if(!shown){
    if(k==='Enter'||k===' ')togglePlayback();
    else if(k==='ArrowLeft'||k==='ArrowRight'){const step=holdStep();seekPlayer(k==='ArrowRight'?step:-step);showPlayerControls('playerSeek');}
    else showPlayerControls('playerToggle');return;
  }
  showPlayerControls();
  if(k==='Tab') {const all=[...$('player').querySelectorAll('button,input')].filter(el=>!el.disabled&&!el.hidden&&el.getClientRects().length);all[(all.indexOf(focus)+(event.shiftKey?-1:1)+all.length)%all.length]?.focus();return;}
  if(k==='Enter'||k===' '){if(focus.tagName==='BUTTON')focus.click();else togglePlayback();return;}
  if(playerFailed){(k==='ArrowUp' || k==='ArrowLeft'?$('playerClose'):$('playerRetry')).focus();return;}
  const buttons=transportOrder.filter(id=>!$(id).disabled);
  if(focus===$('playerSeek')){
    if(k==='ArrowLeft'||k==='ArrowRight'){const step=holdStep();seekPlayer(k==='ArrowRight'?step:-step);}
    else showPlayerControls(k==='ArrowUp'?'playerClose':'playerToggle');return;
  }
  if(focus===$('playerClose')){if(k==='ArrowDown')showPlayerControls($('playerSeek').disabled?'playerToggle':'playerSeek');return;}
  if(k==='ArrowUp'){showPlayerControls($('playerSeek').disabled?'playerClose':'playerSeek');return;}
  // Down from the bottom (transport) row has nowhere further to go: it hides the controls, as the 'hide' button does.
  if(k==='ArrowDown'){if(buttons.includes(focus.id))hidePlayerControls(true);else showPlayerControls('playerToggle');return;}
  const index=buttons.indexOf(focus.id),next=Math.max(0,Math.min(buttons.length-1,index+(k==='ArrowRight'?1:-1)));
  showPlayerControls(buttons[next]);
}
$('playerClose').addEventListener('click',closePlayer);
$('playerRetry').addEventListener('click',()=>playMovie(playerItem,true));
$('playerToggle').addEventListener('click',togglePlayback);
for(const [id,delta] of Object.entries(seekButtons))$(id).addEventListener('click',()=>seekPlayer(delta));
$('playerMute').addEventListener('click',()=>{$('video').muted=!$('video').muted;updatePlayer();showPlayerControls();});
$('playerHide').addEventListener('click',()=>hidePlayerControls(true));
$('playerSeek').addEventListener('input',()=>{if(!Number.isFinite($('video').duration))return;$('video').currentTime=Number($('playerSeek').value);updatePlayer();showPlayerControls();});
$('player').addEventListener('mousemove',()=>showPlayerControls());
$('player').addEventListener('click',e=>{if(e.target===$('player')||e.target.classList.contains('player-shade'))showPlayerControls('playerToggle');});
// Remember the position every 10s of playback, on pause and at the end.
let savedAt=-1;
function rememberPosition(){const v=$('video');if(!playerItem || !isPlayerOpen() || !Number.isFinite(v.duration))return;saveProgress(playerItem.streamId || playerItem.id,v.ended?v.duration:v.currentTime,v.duration);savedAt=v.currentTime;}
$('video').addEventListener('timeupdate',()=>{if(Math.abs($('video').currentTime-savedAt)>=10)rememberPosition();});
for(const type of ['pause','ended'])$('video').addEventListener(type,rememberPosition);
for(const type of ['timeupdate','durationchange','loadedmetadata','volumechange'])$('video').addEventListener(type,()=>updatePlayer());
$('video').addEventListener('playing',()=>{
  if(!isPlayerOpen()||playerFailed)return;clearTimeout(playbackTimer);$('playerLoading').hidden=true;$('player').classList.add('ready');updatePlayer();showPlayerControls();
});
$('video').addEventListener('loadeddata',()=>{if(isPlayerOpen()&&!playerFailed)$('player').classList.add('ready');});
$('video').addEventListener('waiting',()=>{if(!$('video').paused)playerLoading('Đang tải thêm dữ liệu…');});
$('video').addEventListener('seeking',()=>{if(!$('video').paused)playerLoading('Đang chuyển đến vị trí đã chọn…');});
$('video').addEventListener('seeked',()=>{if(isPlayerOpen()&&!playerFailed&&$('video').readyState>=3){clearTimeout(playbackTimer);$('playerLoading').hidden=true;updatePlayer();showPlayerControls();}});
for(const type of ['pause','ended'])$('video').addEventListener(type,()=>{if(isPlayerOpen()&&!playerFailed){updatePlayer();showPlayerControls('playerToggle');}});
$('video').addEventListener('error',()=>{if(isPlayerOpen()&&$('video').getAttribute('src'))playerError('Nguồn phim không khả dụng. Hãy thử lại.');});
updatePlayer(true);

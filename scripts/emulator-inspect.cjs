// Forward the running app's webview_devtools_remote_<pid> to tcp:9225 first.
const fs = require('node:fs');
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9225/json/list')).json();
  const page = pages.find(p => p.url.startsWith('file:///android_asset/index.html'));
  if (!page) throw new Error('CineBolt WebView not found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject) => {ws.onopen=resolve;ws.onerror=reject;});
  let seq=0; const pending=new Map();
  ws.onmessage=event=>{const data=JSON.parse(event.data);if(pending.has(data.id)){pending.get(data.id)(data);pending.delete(data.id);}};
  const send=(method,params={})=>new Promise(resolve=>{const id=++seq;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}));});
  try {
    const expression=process.argv[2] || `JSON.stringify({language:document.documentElement.lang,title:document.querySelector('#hTitle').textContent,focus:document.activeElement.outerHTML,shelves:[...document.querySelectorAll('.shelf h2')].map(x=>x.textContent),cards:document.querySelectorAll('.card').length,detail:document.querySelector('#detail').className,player:document.querySelector('#player').className,search:document.querySelector('#searchStatus').textContent,body:document.body.innerText.slice(0,1500)})`;
    const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.result?.exceptionDetails)throw new Error(JSON.stringify(result.result.exceptionDetails));
    console.log(result.result?.result?.value ?? JSON.stringify(result));
    if(process.argv[3]) {await new Promise(resolve=>setTimeout(resolve,350));const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.argv[3],Buffer.from(shot.result.data,'base64'));}
  } finally {ws.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

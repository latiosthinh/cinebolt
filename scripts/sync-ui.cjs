const fs = require('node:fs');
for (const name of ['index.html', 'app.js', 'player.js', 'tv.css', 'hls.min.js', 'logo.svg']) {
  fs.copyFileSync(`UI/${name}`, `android-tv/app/src/main/assets/${name}`);
}
console.log('Android assets synchronized from UI/.');

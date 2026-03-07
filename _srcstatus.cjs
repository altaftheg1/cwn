const { execSync } = require('child_process');
const { spawnSync } = require('child_process');

// Start server
const srv = require('child_process').spawn('node', ['server.js'], { detached: true, stdio: 'ignore' });
srv.unref();

// Wait for it to come up
const start = Date.now();
let ready = false;
while (Date.now() - start < 15000) {
  try {
    execSync('curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/uae-calm-uae-news.html', { stdio: 'pipe' });
    ready = true;
    break;
  } catch (e) {
    // keep waiting
    const t = Date.now(); while(Date.now()-t < 500) {} // busy wait 500ms
  }
}

if (!ready) { console.log('Server did not start in time'); process.exit(1); }

// Wait for cache to build
const t2 = Date.now(); while(Date.now()-t2 < 10000) {} // wait 10s for cache

const raw = execSync('curl -s http://localhost:3000/api/source-status').toString();
const s = JSON.parse(raw);
const entries = Object.entries(s);
const ok = entries.filter(([,v]) => v.ok);
const fail = entries.filter(([,v]) => !v.ok);
console.log('WORKING (' + ok.length + '):');
ok.forEach(([k,v]) => console.log('  [' + v.articleCount + ' items] ' + v.name));
console.log('\nFAILING (' + fail.length + '):');
fail.forEach(([k,v]) => console.log('  FAIL: ' + v.name + ' — ' + (v.error || 'no items')));

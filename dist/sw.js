const prefix='personal-jet-';
const version=prefix+'4';
const assets=[
  './index.html','./style.css?v=touch-hold','./app.js?v=lateral-roll',
  './physics.js','./physics.js?v=counterfire','./physics.js?v=lateral-roll','./world.js','./gun-mounts.js',
  './combat.js?v=missile-trail','./combat-view.js?v=missile-trail',
  './cockpit-view.js','./canopy-panes.js','./jet-finish.js?v=mirror-canopy',
  './jet-hardware.js?v=wing-guns','./lite.js?v=wing-guns',
  './vendor/three.module.js','./vendor/three.core.js','./vendor/GLTFLoader.js',
  './vendor/BufferGeometryUtils.js','./vendor/SkeletonUtils.js',
  './models/personal-jet-stl.glb','./models/jet-surface-ao.bin',
  './models/personal-jet-stl-lite.json','./models/jet-lite-ao.bin',
  './manifest.webmanifest','./icons/personal-jet-192.png','./icons/personal-jet-512.png',
  './icons/apple-touch-icon.png'
];
const inScope=path=>new URL(path,self.registration.scope).href;
const savedAssets=new Set(assets.map(inScope));

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(version).then(cache=>cache.addAll(
    [...savedAssets].map(url=>new Request(url,{cache:'reload'}))
  )));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith(prefix)&&key!==version).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const {request}=event;
  if(request.method!=='GET')return;
  if(request.mode==='navigate'&&(request.url===inScope('./')||request.url===inScope('./index.html'))){
    event.respondWith(fetch(request).catch(()=>caches.open(version).then(cache=>cache.match(inScope('./index.html')))));
  }else if(savedAssets.has(request.url)){
    event.respondWith(caches.open(version).then(cache=>cache.match(request)).then(saved=>saved??fetch(request)));
  }
});

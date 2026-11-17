(function(){
  var currentSlug = 'nabil-izza-2';
  window.__WEDDING_SLUG = currentSlug;

  function normalizeMusic(src) {
    if(!src || src==='none') return '';
    src = String(src).trim();
    if(src.indexOf('http://')===0 || src.indexOf('https://')===0 || src.indexOf('data:')===0) return src;
    if(src.indexOf('/music/')===0) return src;
    if(src.indexOf('music/')===0) return '/' + src;
    if(src.indexOf('/')===0) return '/music' + src;
    return '/music/' + src;
  }

  // Deep merge: field yang tidak dikirim dashboard tetap memakai nilai default
  function isObj(v){ return v && typeof v === 'object' && !Array.isArray(v); }
  function deepMerge(target, src) {
    if(!isObj(src)) return target;
    Object.keys(src).forEach(function(k){
      if(isObj(src[k]) && isObj(target[k])) deepMerge(target[k], src[k]);
      else if(src[k] !== undefined && src[k] !== null) target[k] = src[k];
    });
    return target;
  }
  window.__deepMergeConfig = deepMerge;

  var defaultMapSnapshot = {
    akad: CONFIG.akad ? JSON.parse(JSON.stringify(CONFIG.akad)) : null,
    resepsi: CONFIG.resepsi ? JSON.parse(JSON.stringify(CONFIG.resepsi)) : null
  };

  // Coba ambil dari localStorage untuk loading instan
  try {
    var cached = localStorage.getItem('wedding_config_' + currentSlug);
    if(cached) {
      var parsed = JSON.parse(cached);
      if(parsed && parsed.playlist && Array.isArray(parsed.playlist)) {
        parsed.playlist = parsed.playlist.filter(function(item) {
          return item && item.indexOf('Royal Burgundy') === -1 && item.indexOf('The_Grace_of_Union') === -1 && item.indexOf('Sepanjang Hidup') === -1;
        });
        if(!parsed.playlist.length) delete parsed.playlist;
      }
      if(parsed && parsed.musicSrc && (parsed.musicSrc.indexOf('Royal Burgundy') !== -1 || parsed.musicSrc.indexOf('The_Grace_of_Union') !== -1 || parsed.musicSrc.indexOf('Sepanjang Hidup') !== -1)) {
        delete parsed.musicSrc;
      }
      deepMerge(CONFIG, parsed);
      if(CONFIG.musicSrc) CONFIG.musicSrc = normalizeMusic(CONFIG.musicSrc);
    }
  } catch(e){}

  // Load konfigurasi maps terbaru dari Cloudflare D1 (/api/maps)
  try {
    fetch('/api/maps', { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(res){
        if(!res || !res.success) return;
        if(res.data && (res.data.akad || res.data.resepsi)) {
          deepMerge(CONFIG, res.data);
          try { localStorage.setItem('wedding_config_' + currentSlug, JSON.stringify(res.data)); } catch(e){}
          if(window.__rebindConfig) window.__rebindConfig();
        } else if(res.data === null) {
          try { localStorage.removeItem('wedding_config_' + currentSlug); } catch(e){}
          if(defaultMapSnapshot.akad) CONFIG.akad = JSON.parse(JSON.stringify(defaultMapSnapshot.akad));
          if(defaultMapSnapshot.resepsi) CONFIG.resepsi = JSON.parse(JSON.stringify(defaultMapSnapshot.resepsi));
          if(window.__rebindConfig) window.__rebindConfig();
        }
      })
      .catch(function(){});
  } catch(e){}

  // Load konfigurasi dari Supabase wedding_config jika tersedia
  try {
    var sb = window.getSupabaseClient ? window.getSupabaseClient() : null;
    if(sb) {
      sb.from('wedding_config').select('config_data').eq('id', currentSlug).maybeSingle().then(function(res){
        if(res && res.data && res.data.config_data) {
          deepMerge(CONFIG, res.data.config_data);
          if(CONFIG.musicSrc) CONFIG.musicSrc = normalizeMusic(CONFIG.musicSrc);
          try { localStorage.setItem('wedding_config_' + currentSlug, JSON.stringify(res.data.config_data)); } catch(e){}
          if(window.__rebindConfig) window.__rebindConfig();
        }
      }).catch(function(err){
        // Graceful offline fallback
      });
    }
  } catch(e){}
})();

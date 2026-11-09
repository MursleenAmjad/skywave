(() => {
  'use strict';

  const CONFIG = {
    siteName: 'Skywave',
    // Where viewers report a channel for removal. Point this at your own email or form once the site is public.
    reportUrl: 'https://github.com/iptv-org/iptv/issues',
    countriesUrl: 'https://iptv-org.github.io/api/countries.json',
    playlistUrl: (lang) => `https://iptv-org.github.io/iptv/languages/${lang}.m3u`,
    // Every channel from every country (~11k channels, ~2.6 MB: GitHub Pages serves .m3u uncompressed).
    worldwideUrl: 'https://iptv-org.github.io/iptv/index.m3u',
    countryUrl: (code) => `https://iptv-org.github.io/iptv/countries/${code.toLowerCase()}.m3u`,
    loadTimeoutMs: 20000,
    // Default channel on open: how many channels to check at once, how many rounds, and how long each check may take.
    autoBatch: 12,
    autoRounds: 3,
    probeTimeoutMs: 6000,
    expandAllBelow: 120,
    searchLimit: 300,
    railSize: 18,
  };

  const KEYS = {
    selection: 'skywave.selection',
    favorites: 'skywave.favorites',
    volume: 'skywave.volume',
    muted: 'skywave.muted',
    last: 'skywave.last',
    collapsed: 'skywave.sidebarCollapsed',
    groupBy: 'skywave.groupBy',
  };

  // Storage can throw in private mode or when site data is blocked; the site still works, it just forgets preferences.
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* see comment on `store` */
      }
    },
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    app: $('app'),
    sidebar: $('sidebar'),
    sidebarToggle: $('sidebarToggle'),
    drawerClose: $('drawerClose'),
    scrim: $('scrim'),
    search: $('search'),
    tabs: document.querySelectorAll('.tab'),
    groupBy: $('groupBy'),
    countAll: $('countAll'),
    countFav: $('countFav'),
    list: $('channelList'),
    scroll: $('channelScroll'),
    regionPill: $('regionPill'),
    regionFlag: $('regionFlag'),
    regionCountry: $('regionCountry'),
    regionLangs: $('regionLangs'),
    player: $('player'),
    video: $('video'),
    idleSub: $('idleSub'),
    idleActions: $('idleActions'),
    loadingLogo: $('loadingLogo'),
    loadingText: $('loadingText'),
    errorTitle: $('errorTitle'),
    errorText: $('errorText'),
    bigPlay: $('bigPlay'),
    ptLogo: $('ptLogo'),
    ptName: $('ptName'),
    ptMeta: $('ptMeta'),
    ctlPlay: $('ctlPlay'),
    ctlPrev: $('ctlPrev'),
    ctlNext: $('ctlNext'),
    ctlMute: $('ctlMute'),
    ctlVolume: $('ctlVolume'),
    ctlPip: $('ctlPip'),
    ctlFullscreen: $('ctlFullscreen'),
    now: $('now'),
    nowLogo: $('nowLogo'),
    nowEyebrow: $('nowEyebrow'),
    nowTitle: $('nowTitle'),
    nowTags: $('nowTags'),
    nowFav: $('nowFav'),
    railSection: $('railSection'),
    railTitle: $('railTitle'),
    railCount: $('railCount'),
    rail: $('rail'),
    railNav: $('railNav'),
    railPrev: $('railPrev'),
    railNext: $('railNext'),
    picker: $('picker'),
    stepCountry: $('stepCountry'),
    stepLang: $('stepLang'),
    countrySearch: $('countrySearch'),
    suggested: $('suggested'),
    countryGrid: $('countryGrid'),
    pickerBack: $('pickerBack'),
    pickerFlag: $('pickerFlag'),
    pickerCountry: $('pickerCountry'),
    langChips: $('langChips'),
    onlyCountry: $('onlyCountry'),
    onlyTitle: $('onlyTitle'),
    onlySub: $('onlySub'),
    pickerSummary: $('pickerSummary'),
    pickerApply: $('pickerApply'),
    toasts: $('toasts'),
    unmute: $('unmute'),
    shortcuts: $('shortcuts'),
    reportLink: $('reportLink'),
    footerStat: $('footerStat'),
    footerYear: $('footerYear'),
  };

  const mobile = window.matchMedia('(max-width: 1023px)');
  const WORLDWIDE = Object.freeze({ worldwide: true, country: 'WORLD', langs: [], onlyCountry: false });

  const state = {
    countries: [],
    countryByCode: new Map(),
    langCache: new Map(),
    selection: store.get(KEYS.selection, null),
    channels: [],
    byKey: new Map(),
    groups: [],
    navList: [],
    expanded: new Set(),
    view: 'all',
    query: '',
    loading: false,
    loadError: null,
    channelsFor: null,
    worldLoading: false,
    worldError: null,
    worldProgress: null,
    favorites: new Map((store.get(KEYS.favorites, []) || []).map((c) => [c.key, c])),
    current: null,
    drawerOpen: false,
    collapsed: store.get(KEYS.collapsed, false),
    groupBy: store.get(KEYS.groupBy, 'country') === 'category' ? 'category' : 'country',
    draft: null,
  };

  /* ---------------------------------------------------------------- helpers */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? u : '');
  const langName = (code) => (window.LANG_NAMES && window.LANG_NAMES[code]) || code.toUpperCase();
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const plural = (n, word, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function monogram(name) {
    const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return 'TV';
    return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
  }

  function logoHtml(ch, extraClass = '') {
    const src = safeUrl(ch.logo);
    const alt = hash(ch.name) % 3 === 0 ? ' alt' : '';
    if (!src) return `<span class="logo is-mono${alt} ${extraClass}"><b>${esc(monogram(ch.name))}</b></span>`;
    return `<span class="logo ${extraClass}" data-mono="${esc(monogram(ch.name))}" data-alt="${alt ? 1 : 0}"><img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
  }

  function setLogo(node, ch) {
    const tmp = document.createElement('div');
    tmp.innerHTML = logoHtml(ch);
    const fresh = tmp.firstElementChild;
    node.className = `${fresh.className} ${[...node.classList].filter((c) => !['logo', 'is-mono', 'alt', 'is-light', 'is-pending'].includes(c)).join(' ')}`.trim();
    node.innerHTML = fresh.innerHTML;
    if (fresh.dataset.mono) node.dataset.mono = fresh.dataset.mono;
    if (fresh.dataset.alt) node.dataset.alt = fresh.dataset.alt;
  }

  // A broken logo turns into a monogram tile instead of a broken-image icon.
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    const tile = img.closest('.logo');
    if (!tile) return;
    tile.classList.add('is-mono');
    if (tile.dataset.alt === '1') tile.classList.add('alt');
    tile.innerHTML = `<b>${esc(tile.dataset.mono || 'TV')}</b>`;
  }, true);

  function countryOf(code) {
    return state.countryByCode.get(code) || null;
  }

  function flagOf(code) {
    return countryOf(code)?.flag || '';
  }

  function toast(message) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    el.toasts.append(t);
    setTimeout(() => {
      t.classList.add('is-leaving');
      setTimeout(() => t.remove(), 320);
    }, 2600);
  }

  /* ------------------------------------------------------------ playlists */

  /**
   * Parse an iptv-org M3U playlist into channel objects.
   * Channel names carry the resolution "(720p)" and notes like "[Geo-blocked]"; they are split out into fields.
   */
  function parseM3U(text, lang) {
    const out = [];
    let info = null;
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line.startsWith('#EXTINF')) {
        info = parseExtinf(line, lang);
      } else if (line.startsWith('#')) {
        if (info && line.startsWith('#EXTVLCOPT')) info.needsHeaders = true;
      } else if (info) {
        info.url = line;
        info.key = info.tvgId ? `${info.tvgId}|${info.quality}` : `url|${line}`;
        if (!info.categories.includes('XXX')) out.push(info);
        info = null;
      }
    }
    return out;
  }

  function parseExtinf(line, lang) {
    const attrs = {};
    for (const m of line.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
    // Attribute values (user agents) contain commas, so drop them before taking the title after the first comma.
    let name = line.replace(/([\w-]+)="[^"]*"/g, '').replace(/^#EXTINF:[^,]*,/, '').trim();
    const notes = [];
    name = name.replace(/\s*\[([^\]]+)\]/g, (_, note) => { notes.push(note); return ''; });
    let quality = '';
    name = name.replace(/\s*\((\d{3,4}[pi])\)/i, (_, q) => { quality = q; return ''; }).trim();
    const categories = (attrs['group-title'] || '')
      .split(';')
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => (c === 'Undefined' ? 'Other' : c));
    const tvgId = attrs['tvg-id'] || '';
    const cc = tvgId.match(/\.([a-z]{2})(?:@|$)/i);
    return {
      name: name || 'Untitled channel',
      logo: attrs['tvg-logo'] || '',
      tvgId,
      country: cc ? cc[1].toUpperCase() : '',
      categories: categories.length ? categories : ['Other'],
      quality,
      notes,
      lang,
      needsHeaders: Boolean(attrs['http-referrer'] || attrs['http-user-agent']),
      url: '',
      key: '',
    };
  }

  /**
   * Download a text file, reporting {loaded, total} bytes as it arrives. Resolves to '' on a 404.
   * GitHub Pages sends .m3u uncompressed with a Content-Length, so `total` is the real size.
   */
  async function fetchText(url, onProgress) {
    const res = await fetch(url);
    if (res.status === 404) return '';
    if (!res.ok) throw new Error(`Playlist request failed (${res.status})`);
    if (!onProgress || !res.body) return res.text();
    const total = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress({ loaded, total });
    }
    return new Blob(chunks).text();
  }

  /** Fetch and parse a playlist once per session. Resolves to [] when iptv-org has no such playlist. */
  function loadPlaylist(cacheKey, url, lang, onProgress) {
    if (!state.langCache.has(cacheKey)) {
      const request = fetchText(url, onProgress)
        .then((text) => parseM3U(text, lang))
        .catch((err) => {
          state.langCache.delete(cacheKey);
          throw err;
        });
      state.langCache.set(cacheKey, request);
    }
    return state.langCache.get(cacheKey);
  }

  const loadLanguage = (code) => loadPlaylist(code, CONFIG.playlistUrl(code), code);
  const loadCountry = (code) => loadPlaylist(`country:${code}`, CONFIG.countryUrl(code), null);
  // The worldwide index carries no language per channel, so those channels have no language tag.
  const loadWorldwide = () => loadPlaylist('__worldwide__', CONFIG.worldwideUrl, null, (progress) => {
    state.worldProgress = progress;
    renderProgress();
  });

  function mergePlaylists(lists, countryCode, onlyCountry) {
    const seen = new Set();
    const out = [];
    for (const list of lists) {
      for (const ch of list) {
        if (seen.has(ch.key)) continue;
        seen.add(ch.key);
        if (onlyCountry && ch.country !== countryCode) continue;
        out.push(ch);
      }
    }
    return out;
  }

  /** Country grouping only makes sense when the list spans countries: Worldwide, or a country with its filter off. */
  const spansCountries = () => Boolean(state.selection && (state.selection.worldwide || !state.selection.onlyCountry));
  const groupMode = () => (spansCountries() ? state.groupBy : 'category');
  const groupKeyOf = (ch) => (groupMode() === 'country' ? ch.country || 'OTHER' : ch.categories[0]);

  function groupChannels(channels, byCountry) {
    const buckets = new Map();
    for (const ch of channels) {
      const key = groupKeyOf(ch);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(ch);
    }
    const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const home = detectCountry();
    // Inside a worldwide category, the viewer's own country comes first: Pakistani news before 900 others.
    const homeFirst = !byCountry && spansCountries() && home;
    const byName = (a, b) => (homeFirst ? (b.country === home) - (a.country === home) : 0) || collator.compare(a.name, b.name);
    const groups = [...buckets.entries()].map(([key, items]) => {
      const country = byCountry ? countryOf(key) : null;
      return {
        key,
        name: byCountry ? (country ? country.name : (key === 'OTHER' ? 'Other' : key)) : key,
        flag: country ? country.flag : '',
        items: items.sort(byName),
      };
    });
    const isOther = (g) => g.name === 'Other';
    // Countries read best alphabetically, with the viewer's own country first; categories by size.
    return groups.sort((a, b) => isOther(a) - isOther(b)
      || (byCountry ? (b.key === home) - (a.key === home) || collator.compare(a.name, b.name)
        : b.items.length - a.items.length || collator.compare(a.name, b.name)));
  }

  /** Replace the channel list. Group open/closed state is kept when the list only grew (worldwide phase 2). */
  function setChannels(channels, selection) {
    const fresh = state.channelsFor !== selection;
    state.channelsFor = selection;
    state.channels = channels;
    state.byKey = new Map(channels.map((c) => [c.key, c]));
    state.groups = groupChannels(channels, groupMode() === 'country');
    if (fresh && selection.worldwide) {
      // Only the viewer's own country (sorted first) opens: other groups grow to thousands once the full list arrives.
      state.expanded = new Set(state.groups.slice(0, 1).map((g) => g.key));
    } else if (fresh) {
      state.expanded = new Set(
        channels.length <= CONFIG.expandAllBelow ? state.groups.map((g) => g.key) : state.groups.slice(0, 2).map((g) => g.key),
      );
    }
    if (state.current && state.byKey.has(state.current.key)) state.expanded.add(groupKeyOf(state.current));
  }

  function setGroupBy(mode) {
    if (mode === state.groupBy) return;
    state.groupBy = mode;
    store.set(KEYS.groupBy, mode);
    if (!state.channels.length) {
      renderSidebar();
      return;
    }
    state.groups = groupChannels(state.channels, groupMode() === 'country');
    // Open only the group holding the channel on screen (or the first group): every other group can run to thousands.
    const currentGroup = state.current && state.byKey.has(state.current.key) ? groupKeyOf(state.current) : null;
    state.expanded = new Set([currentGroup || (state.groups[0] && state.groups[0].key)].filter(Boolean));
    renderSidebar();
    el.scroll.scrollTop = 0;
    revealCurrent();
  }

  function refreshLists() {
    renderSidebar();
    renderIdle();
    renderRail();
    renderFooterStat();
  }

  const listJoin = (items) => new Intl.ListFormat('en', { type: 'conjunction' }).format(items);

  /** One line in the footer saying what the viewer is browsing right now. */
  function renderFooterStat() {
    const sel = state.selection;
    if (!sel || state.loading || !state.channels.length) {
      el.footerStat.hidden = true;
      return;
    }
    const count = plural(state.channels.length, 'channel');
    let text;
    if (sel.worldwide) {
      const countries = new Set(state.channels.map((c) => c.country).filter(Boolean)).size;
      text = `Showing ${count} from ${plural(countries, 'country', 'countries')}.`;
    } else {
      const country = countryOf(sel.country);
      const langs = listJoin(sel.langs.map(langName));
      text = sel.onlyCountry && country ? `Showing ${count} from ${country.name} in ${langs}.` : `Showing ${count} in ${langs}.`;
    }
    el.footerStat.textContent = text;
    el.footerStat.hidden = false;
  }

  /**
   * Worldwide is a ~2.6 MB download, so the viewer's own country (a small file) is shown first
   * while the full list streams in behind it with a progress bar.
   */
  async function loadWorldwideSelection(selection, announce) {
    state.worldLoading = true;
    state.worldError = null;
    state.worldProgress = null;
    const full = loadWorldwide();
    full.catch(() => {}); // awaited below; this only stops an early failure being reported as unhandled
    const home = detectCountry();
    if (home) {
      try {
        const local = await loadCountry(home);
        if (state.selection === selection && state.worldLoading && local.length) {
          setChannels(local, selection);
          state.loading = false;
          refreshLists();
          autoStart(); // your own country is on screen; no need to wait for the rest of the world
        }
      } catch {
        /* the full download below still covers this country */
      }
    }
    try {
      const all = await full;
      if (state.selection !== selection) return;
      setChannels(all, selection);
      if (announce) {
        toast(`Loaded ${plural(all.length, 'channel')} from ${plural(state.groups.filter((g) => g.name !== 'Other').length, 'country', 'countries')}`);
      }
    } catch (err) {
      if (state.selection !== selection) return;
      if (!state.channels.length || state.channelsFor !== selection) throw err;
      state.worldError = err;
    } finally {
      state.worldLoading = false;
    }
  }

  async function applySelection(selection, { announce = true } = {}) {
    state.selection = selection;
    store.set(KEYS.selection, selection);
    renderRegion();
    state.loading = true;
    state.loadError = null;
    renderSidebar();
    renderIdle();
    try {
      if (selection.worldwide) {
        await loadWorldwideSelection(selection, announce);
      } else {
        const lists = await Promise.all(selection.langs.map(loadLanguage));
        if (state.selection !== selection) return;
        setChannels(mergePlaylists(lists, selection.country, selection.onlyCountry), selection);
        if (announce) toast(`Loaded ${plural(state.channels.length, 'channel')}`);
      }
    } catch (err) {
      if (state.selection !== selection) return;
      state.loadError = err;
      state.channels = [];
      state.groups = [];
      state.channelsFor = null;
    } finally {
      if (state.selection === selection) {
        state.loading = false;
        refreshLists();
        autoStart();
      }
    }
  }

  /* -------------------------------------------------------------- sidebar */

  function channelItem(ch) {
    const country = countryOf(ch.country);
    const inCountryGroup = groupMode() === 'country' && state.view === 'all' && !state.query;
    const where = country ? `${country.flag} ${country.name}` : '';
    const meta = [inCountryGroup ? ch.categories[0] : where, ch.quality].filter(Boolean).join(' · ');
    const isFav = state.favorites.has(ch.key);
    const active = state.current && state.current.key === ch.key ? ' is-active' : '';
    return `<li class="ch-item${active}" data-key="${esc(ch.key)}">
      <button class="ch" type="button" data-play="${esc(ch.key)}">
        ${logoHtml(ch)}
        <span class="ch-body"><span class="ch-name">${esc(ch.name)}</span><span class="ch-meta flag">${esc(meta || ch.categories.join(', '))}</span></span>
        <span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>
      </button>
      <button class="ch-fav" type="button" data-fav="${esc(ch.key)}" aria-pressed="${isFav}" aria-label="${isFav ? 'Remove from' : 'Add to'} favorites: ${esc(ch.name)}"><svg class="ic"><use href="#i-star"/></svg></button>
    </li>`;
  }

  function skeletonHtml() {
    return Array.from({ length: 10 }, (_, i) => `<div class="sk-row"><span class="sk" style="width:42px;height:42px;border-radius:11px"></span><span style="flex:1;display:grid;gap:7px"><span class="sk" style="height:12px;width:${55 + ((i * 17) % 35)}%"></span><span class="sk" style="height:10px;width:${30 + ((i * 23) % 25)}%"></span></span></div>`).join('');
  }

  function favoriteList() {
    return [...state.favorites.values()].map((f) => state.byKey.get(f.key) || f);
  }

  function searchList() {
    const q = fold(state.query);
    return state.channels.filter((ch) => {
      if (ch.searchText === undefined) {
        const country = countryOf(ch.country);
        ch.searchText = fold(`${ch.name} ${ch.categories.join(' ')} ${country ? country.name : ''}`);
      }
      return ch.searchText.includes(q);
    });
  }

  function progressParts() {
    const p = state.worldProgress;
    if (!p) return { text: 'Connecting…', pct: '' };
    const mb = (n) => (n / 1048576).toFixed(1);
    if (!p.total) return { text: `${mb(p.loaded)} MB downloaded`, pct: '' };
    const pct = `${Math.min(100, Math.round((p.loaded / p.total) * 100))}%`;
    return { text: `${mb(p.loaded)} of ${mb(p.total)} MB`, pct };
  }

  function worldStatusHtml() {
    if (!state.selection || !state.selection.worldwide) return '';
    if (state.worldError) {
      return `<div class="load-card is-error"><div class="load-row">
        <span class="load-icon"><svg class="ic"><use href="#i-alert"/></svg></span>
        <span class="load-text"><strong>Couldn't load every country</strong><span>Showing the channels that loaded.</span></span>
        <button class="btn btn-ghost load-retry" type="button" data-action="reload">Retry</button>
      </div></div>`;
    }
    if (!state.worldLoading) return '';
    const { text, pct } = progressParts();
    return `<div class="load-card"><div class="load-row">
        <span class="load-icon"><svg class="ic"><use href="#i-globe"/></svg></span>
        <span class="load-text"><strong>Loading channels worldwide</strong><span id="worldText">${text}</span></span>
        <span class="load-pct" id="worldPct">${pct}</span>
      </div><div class="load-bar"><i id="worldBar" style="width:${pct || '6%'}"></i></div></div>`;
  }

  /** Update the progress card in place; re-rendering the whole list on every chunk would be wasteful. */
  function renderProgress() {
    if (!state.selection || !state.selection.worldwide) return;
    const { text, pct } = progressParts();
    const t = document.getElementById('worldText');
    const n = document.getElementById('worldPct');
    const bar = document.getElementById('worldBar');
    if (t) t.textContent = text;
    if (n) n.textContent = pct;
    if (bar) bar.style.width = pct || '6%';
    if (state.loading) el.idleSub.textContent = `Loading channels worldwide… ${pct}`.trim();
  }

  function renderSidebar() {
    el.groupBy.hidden = !spansCountries() || state.view !== 'all';
    el.groupBy.querySelectorAll('[data-group-by]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.groupBy === state.groupBy)));
    el.countAll.textContent = state.channels.length.toLocaleString();
    el.countFav.textContent = state.favorites.size.toLocaleString();
    el.tabs.forEach((t) => {
      const on = t.dataset.view === state.view;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
    });

    if (state.view === 'favorites') {
      const favs = favoriteList();
      state.navList = favs;
      el.list.innerHTML = favs.length
        ? `<ul class="flat-list">${favs.map(channelItem).join('')}</ul>`
        : `<div class="empty"><strong>No favorites yet</strong>Tap the star next to any channel to keep it here.</div>`;
      return;
    }

    const status = worldStatusHtml();
    if (state.loading) {
      el.list.innerHTML = status + skeletonHtml();
      return;
    }
    if (state.loadError) {
      el.list.innerHTML = `<div class="empty"><strong>Couldn't load channels</strong>Check your connection and try again.<br><button class="btn btn-primary" type="button" data-action="reload">Try again</button></div>`;
      return;
    }
    if (!state.selection) {
      el.list.innerHTML = `<div class="empty"><strong>No playlist yet</strong>Choose your country to load channels.<br><button class="btn btn-primary" type="button" data-action="picker">Choose country</button></div>`;
      return;
    }
    if (!state.channels.length) {
      el.list.innerHTML = `<div class="empty"><strong>No channels found</strong>Try another language or turn off "Only channels from this country".<br><button class="btn btn-primary" type="button" data-action="picker">Change playlist</button></div>`;
      return;
    }

    if (state.query) {
      const results = searchList();
      state.navList = results;
      const shown = results.slice(0, CONFIG.searchLimit);
      const partial = state.worldLoading ? ' · more countries still loading' : '';
      el.list.innerHTML = status + (results.length
        ? `<p class="list-note">${plural(results.length, 'result')}${results.length > shown.length ? ` · showing the first ${shown.length}` : ''}${partial}</p><ul class="flat-list">${shown.map(channelItem).join('')}</ul>`
        : `<div class="empty"><strong>Nothing matches "${esc(state.query)}"</strong>${state.worldLoading ? 'More countries are still loading.' : 'Try a channel name, category or country.'}</div>`);
      return;
    }

    state.navList = state.groups.flatMap((g) => g.items);
    el.list.innerHTML = status + state.groups.map((g, i) => {
      const open = state.expanded.has(g.key);
      return `<section class="grp" data-group="${i}">
        <button class="grp-head" type="button" aria-expanded="${open}" data-toggle="${i}">
          ${g.flag ? `<span class="grp-flag flag">${esc(g.flag)}</span>` : ''}<span class="grp-title">${esc(g.name)}</span><span class="grp-count">${g.items.length.toLocaleString()}</span><svg class="ic"><use href="#i-chevron-down"/></svg>
        </button>
        <ul class="grp-list">${open ? g.items.map(channelItem).join('') : ''}</ul>
      </section>`;
    }).join('');
  }

  function toggleGroup(index) {
    const group = state.groups[index];
    const section = el.list.querySelector(`[data-group="${index}"]`);
    if (!group || !section) return;
    const head = section.querySelector('.grp-head');
    const list = section.querySelector('.grp-list');
    const open = !state.expanded.has(group.key);
    if (open) {
      state.expanded.add(group.key);
      if (!list.childElementCount) list.innerHTML = group.items.map(channelItem).join('');
    } else {
      state.expanded.delete(group.key);
    }
    head.setAttribute('aria-expanded', String(open));
  }

  function markActive() {
    el.list.querySelectorAll('.ch-item.is-active').forEach((n) => n.classList.remove('is-active'));
    if (!state.current) return;
    el.list.querySelectorAll(`.ch-item[data-key="${CSS.escape(state.current.key)}"]`).forEach((n) => n.classList.add('is-active'));
  }

  function revealCurrent() {
    if (!state.current || state.view !== 'all' || state.query) return;
    const index = state.groups.findIndex((g) => g.items.some((c) => c.key === state.current.key));
    if (index < 0) return;
    if (!state.expanded.has(state.groups[index].key)) toggleGroup(index);
    const node = el.list.querySelector(`.ch-item[data-key="${CSS.escape(state.current.key)}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }

  function toggleFavorite(key) {
    const ch = state.byKey.get(key) || state.favorites.get(key) || (state.current?.key === key ? state.current : null);
    if (!ch) return;
    if (state.favorites.has(key)) {
      state.favorites.delete(key);
      toast(`Removed ${ch.name} from favorites`);
    } else {
      const { name, logo, tvgId, country, categories, quality, notes, lang, needsHeaders, url } = ch;
      state.favorites.set(key, { key, name, logo, tvgId, country, categories, quality, notes, lang, needsHeaders, url });
      toast(`Added ${ch.name} to favorites`);
    }
    store.set(KEYS.favorites, [...state.favorites.values()]);
    el.countFav.textContent = state.favorites.size.toLocaleString();
    if (state.view === 'favorites') {
      renderSidebar();
    } else {
      el.list.querySelectorAll(`[data-fav="${CSS.escape(key)}"]`).forEach((b) => {
        const on = state.favorites.has(key);
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', `${on ? 'Remove from' : 'Add to'} favorites: ${ch.name}`);
      });
    }
    renderNowFav();
  }

  /* --------------------------------------------------------- region & idle */

  function renderRegion() {
    const sel = state.selection;
    if (!sel) return;
    if (sel.worldwide) {
      el.regionFlag.innerHTML = '<svg class="ic"><use href="#i-globe"/></svg>';
      el.regionCountry.textContent = 'Worldwide';
      el.regionLangs.textContent = 'All countries · all languages';
      return;
    }
    const country = countryOf(sel.country);
    el.regionFlag.textContent = country ? country.flag : '';
    el.regionCountry.textContent = country ? country.name : sel.country;
    el.regionLangs.textContent = sel.langs.map(langName).join(', ') + (sel.onlyCountry ? '' : ' · all countries');
  }

  function renderIdle() {
    const last = store.get(KEYS.last, null);
    const actions = [];
    if (!state.selection) {
      el.idleSub.textContent = 'Choose your country to load live channels in its languages.';
      actions.push('<button class="btn btn-primary btn-lg" type="button" data-action="picker"><svg class="ic"><use href="#i-globe"/></svg>Choose country</button>');
    } else {
      if (state.loading) {
        el.idleSub.textContent = state.selection.worldwide ? 'Loading channels worldwide…' : 'Loading your channels…';
      } else if (state.worldLoading) {
        el.idleSub.textContent = `${plural(state.channels.length, 'channel')} ready while the rest of the world loads.`;
      } else {
        el.idleSub.textContent = `${plural(state.channels.length, 'channel')} ready. Pick one to start watching.`;
      }
      if (last && last.url) actions.push(`<button class="btn btn-primary btn-lg" type="button" data-action="resume"><svg class="ic ic-fill"><use href="#i-play"/></svg>Resume ${esc(last.name)}</button>`);
      actions.push('<button class="btn btn-ghost btn-lg" type="button" data-action="browse">Browse channels</button>');
    }
    el.idleActions.innerHTML = actions.join('');
  }

  /* ---------------------------------------------------------- now & rail */

  function channelMeta(ch) {
    const country = countryOf(ch.country);
    return [ch.categories[0], country ? country.name : '', ch.quality].filter(Boolean).join(' · ');
  }

  function renderNow() {
    const ch = state.current;
    el.now.hidden = !ch;
    if (!ch) return;
    setLogo(el.nowLogo, ch);
    const art = safeUrl(ch.logo);
    if (art) el.now.style.setProperty('--art', `url("${art.replace(/["\\]/g, encodeURIComponent)}")`);
    else el.now.style.removeProperty('--art');
    const logoImg = el.nowLogo.querySelector('img');
    if (logoImg) {
      if (logoImg.complete && logoImg.naturalWidth) markLightLogo(logoImg);
      else logoImg.addEventListener('load', () => markLightLogo(logoImg), { once: true });
    }
    el.nowTitle.textContent = ch.name;
    const country = countryOf(ch.country);
    const tags = [`<span class="tag tag-royal">${esc(ch.categories.join(' · '))}</span>`];
    if (country) tags.push(`<span class="tag"><span class="flag">${esc(country.flag)}</span>${esc(country.name)}</span>`);
    if (ch.lang) tags.push(`<span class="tag">${esc(langName(ch.lang))}</span>`);
    if (ch.quality) tags.push(`<span class="tag tag-tang">${esc(ch.quality)}</span>`);
    ch.notes.forEach((n) => tags.push(`<span class="tag">${esc(n)}</span>`));
    el.nowTags.innerHTML = tags.join('');
    renderNowFav();
  }

  function renderNowFav() {
    if (!state.current) return;
    const on = state.favorites.has(state.current.key);
    el.nowFav.setAttribute('aria-pressed', String(on));
    el.nowFav.querySelector('span').textContent = on ? 'Saved' : 'Favorite';
  }

  function renderRail() {
    const pool = state.channels;
    if (!pool.length) {
      el.railSection.hidden = true;
      return;
    }
    const current = state.current;
    const category = current ? current.categories[0] : null;
    const homeCountry = state.selection && state.selection.worldwide && current ? countryOf(current.country) : null;
    const where = (ch) => {
      const c = countryOf(ch.country);
      return c ? `${c.flag} ${c.name}` : '';
    };
    // Each card's subtitle says what the row title doesn't.
    let picks = [];
    let title = 'Popular picks';
    let metaOf = (ch) => [where(ch), ch.categories[0]].filter(Boolean).join(' · ');
    if (homeCountry) {
      picks = pool.filter((c) => c.country === current.country && c.key !== current.key);
      title = `More from ${homeCountry.name}`;
      metaOf = (ch) => ch.categories[0];
    }
    if (picks.length < 4 && category) {
      picks = pool.filter((c) => c.categories[0] === category && c.key !== current.key);
      title = `More in ${category}`;
      metaOf = (ch) => where(ch) || ch.categories[0];
    }
    if (picks.length < 4) {
      picks = pool.filter((c) => !current || c.key !== current.key);
      title = current ? 'More channels' : 'Start watching';
      metaOf = (ch) => [where(ch), ch.categories[0]].filter(Boolean).join(' · ');
    }
    const shown = picks.slice(0, CONFIG.railSize);
    el.railTitle.textContent = title;
    el.railCount.textContent = plural(picks.length, 'channel');
    el.rail.innerHTML = shown.map((ch) => {
      const art = safeUrl(ch.logo).replace(/["\\]/g, encodeURIComponent);
      return `<button class="card" type="button" data-play="${esc(ch.key)}" aria-label="Play ${esc(ch.name)}">
        <span class="card-art"${art ? ` style="--art:url(&quot;${esc(art)}&quot;)"` : ''}>
          ${logoHtml(ch, 'card-logo')}
          ${ch.quality ? `<span class="card-q">${esc(ch.quality)}</span>` : ''}
          <span class="card-play" aria-hidden="true"><svg class="ic ic-fill"><use href="#i-play"/></svg></span>
        </span>
        <span class="card-name">${esc(ch.name)}</span>
        <span class="card-meta flag">${esc(metaOf(ch))}</span>
      </button>`;
    }).join('');
    el.railSection.hidden = false;
    el.rail.scrollLeft = 0;
    // Until a logo arrives its tile shimmers instead of showing an empty white plate.
    el.rail.querySelectorAll('.card-logo img').forEach((img) => {
      const tile = img.closest('.logo');
      const done = () => {
        tile.classList.remove('is-pending');
        markLightLogo(img);
      };
      if (img.complete && img.naturalWidth) {
        done();
      } else {
        tile.classList.add('is-pending');
        img.addEventListener('load', done, { once: true });
      }
    });
    requestAnimationFrame(updateRailNav);
  }

  function updateRailNav() {
    const r = el.rail;
    const atStart = r.scrollLeft <= 2;
    const atEnd = r.scrollLeft + r.clientWidth >= r.scrollWidth - 2;
    r.classList.toggle('at-start', atStart);
    r.classList.toggle('at-end', atEnd);
    el.railPrev.disabled = atStart;
    el.railNext.disabled = atEnd;
    el.railNav.hidden = atStart && atEnd;
  }

  // White-on-transparent logos vanish on the light plate, so they get a dark one. Reading pixels needs
  // CORS, so a second copy loads in CORS mode; hosts without CORS just keep the light plate.
  const logoTone = new Map();
  function markLightLogo(img) {
    const url = img.currentSrc || img.src;
    const apply = (tone) => {
      if (tone === 'light' && img.isConnected) img.closest('.logo')?.classList.add('is-light');
    };
    if (!logoTone.has(url)) {
      logoTone.set(url, new Promise((resolve) => {
        const probe = new Image();
        probe.crossOrigin = 'anonymous';
        probe.referrerPolicy = 'no-referrer';
        probe.onload = () => {
          try {
            const size = 24;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(probe, 0, 0, size, size);
            const { data } = ctx.getImageData(0, 0, size, size);
            let clear = 0;
            let opaque = 0;
            let light = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i + 3] < 32) clear++;
              else if (data[i + 3] > 160) {
                opaque++;
                light += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
              }
            }
            const transparent = clear / (size * size) > 0.15;
            resolve(transparent && opaque > 12 && light / opaque > 0.8 ? 'light' : 'normal');
          } catch {
            resolve('normal'); // unreadable pixels: keep the default plate
          }
        };
        probe.onerror = () => resolve('normal');
        probe.src = url;
      }));
    }
    logoTone.get(url).then(apply);
  }

  /* --------------------------------------------------------------- player */

  const player = { hls: null, token: 0, loadTimer: null, uiTimer: null, upgraded: false, triedNative: false, autoMuted: false, lastPointer: 'mouse' };
  // The running default-channel search, or null. Any channel the viewer picks themselves cancels it.
  let auto = null;

  function setPlayback(next) {
    el.player.dataset.state = next;
    el.app.dataset.playback = next;
    const playing = next === 'playing';
    el.ctlPlay.setAttribute('aria-label', playing ? 'Pause (K)' : 'Play (K)');
    el.ctlPlay.querySelector('use').setAttribute('href', playing ? '#i-pause' : '#i-play');
  }

  function teardown() {
    clearTimeout(player.loadTimer);
    if (player.hls) {
      player.hls.destroy();
      player.hls = null;
    }
    el.video.removeAttribute('src');
    el.video.load();
    el.player.classList.remove('is-buffering');
  }

  /** Streams on http:// are blocked on an https page, so try the same address over https first. */
  function streamUrl(url) {
    if (window.location.protocol === 'https:' && url.startsWith('http://')) return { url: `https://${url.slice(7)}`, upgraded: true };
    return { url, upgraded: false };
  }

  function playChannel(ch, { automatic = false } = {}) {
    if (!automatic) auto = null;
    el.player.classList.remove('is-searching');
    state.current = ch;
    el.nowEyebrow.textContent = 'Now playing';
    markActive();
    renderNow();
    renderRail();
    el.ptName.textContent = ch.name;
    el.ptMeta.textContent = channelMeta(ch);
    setLogo(el.ptLogo, ch);
    setLogo(el.loadingLogo, ch);
    el.loadingText.textContent = `Tuning in to ${ch.name}…`;
    if (!automatic) document.title = `${ch.name} · ${CONFIG.siteName}`;
    if (state.byKey.has(ch.key)) {
      // Open the channel's group so it is visible in the list, now or once the search is cleared.
      if (state.query || state.view !== 'all') state.expanded.add(groupKeyOf(ch));
      else revealCurrent();
    }
    if (mobile.matches && !automatic) setDrawer(false);
    startStream(ch);
  }

  function startStream(ch) {
    teardown();
    const token = ++player.token;
    const { url, upgraded } = streamUrl(ch.url);
    player.upgraded = upgraded;
    player.triedNative = false;
    setPlayback('loading');
    // The default-channel search moves on sooner; a channel the viewer picked gets the full wait.
    player.loadTimer = setTimeout(() => {
      if (token === player.token) fail('timeout');
    }, auto ? CONFIG.probeTimeoutMs * 2 : CONFIG.loadTimeoutMs);

    const video = el.video;
    if (window.Hls && window.Hls.isSupported()) {
      const hls = new window.Hls({ enableWorker: true, backBufferLength: 30 });
      player.hls = hls;
      let recoveredMedia = false;
      hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        if (token === player.token) tryPlay();
      });
      hls.on(window.Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || token !== player.token) return;
        if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !recoveredMedia) {
          recoveredMedia = true;
          hls.recoverMediaError();
          return;
        }
        // Not an HLS playlist: let the browser try it directly (works for plain MP4 streams).
        if (data.details === window.Hls.ErrorDetails.MANIFEST_PARSING_ERROR && !player.triedNative) {
          player.triedNative = true;
          hls.destroy();
          player.hls = null;
          video.src = url;
          tryPlay();
          return;
        }
        fail(data.type === window.Hls.ErrorTypes.NETWORK_ERROR ? 'network' : 'media');
      });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      tryPlay();
    } else {
      fail('unsupported');
    }
  }

  function readyPaused() {
    clearTimeout(player.loadTimer);
    setPlayback('paused');
  }

  function tryPlay() {
    const attempt = el.video.play();
    if (!attempt) return;
    attempt.catch((err) => {
      if (err.name !== 'NotAllowedError') return;
      // Browsers block sound until the visitor has interacted with the page; start muted and offer sound.
      player.autoMuted = true;
      el.video.muted = true;
      el.video.play().then(() => { el.unmute.hidden = false; }).catch(() => readyPaused());
    });
  }

  const ERRORS = {
    timeout: ["This channel isn't responding", 'The stream took too long to start. It may be offline right now.'],
    network: ["Can't reach this channel", "The stream is offline, or its server doesn't allow playback on other websites."],
    media: ["This stream won't play here", "Your browser can't decode this stream's format."],
    unsupported: ["Your browser can't play live TV", 'Try a recent version of Chrome, Edge, Firefox or Safari.'],
  };

  function fail(reason) {
    if (!state.current) return;
    clearTimeout(player.loadTimer);
    if (auto) {
      const session = auto;
      // Deferred: fail() can run inside an hls.js event, and the next attempt destroys that hls instance.
      setTimeout(() => autoNext(session), 0);
      return;
    }
    let [title, text] = ERRORS[reason] || ERRORS.network;
    if (player.upgraded) {
      text = 'This channel only streams over an insecure (http) connection, which browsers block on secure sites.';
    } else if (state.current.needsHeaders && reason !== 'unsupported') {
      text += ' It also needs special request headers that browsers can\'t send.';
    }
    el.errorTitle.textContent = title;
    el.errorText.textContent = text;
    if (player.hls) {
      player.hls.destroy();
      player.hls = null;
    }
    el.player.classList.remove('is-buffering');
    setPlayback('error');
  }

  /**
   * Check whether a stream answers with an HLS playlist, reading only its first bytes.
   * Same CORS rules as playback, so a stream that passes is one the browser can at least start loading.
   */
  async function probeStream(rawUrl) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CONFIG.probeTimeoutMs);
    try {
      const res = await fetch(streamUrl(rawUrl).url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok || !res.body) return false;
      const reader = res.body.getReader();
      const { value } = await reader.read();
      reader.cancel().catch(() => {});
      return Boolean(value) && new TextDecoder().decode(value.slice(0, 32)).replace(/^\uFEFF/, '').trimStart().startsWith('#EXTM3U');
    } catch {
      return false; // offline, blocked by CORS, or too slow: all mean "skip this one"
    } finally {
      clearTimeout(timer);
    }
  }

  /** Last watched first, then favorites, then the list in the order the sidebar shows it. */
  function autoCandidates() {
    const last = store.get(KEYS.last, null);
    const pool = [
      last && state.byKey.get(last.key),
      ...[...state.favorites.keys()].map((k) => state.byKey.get(k)),
      ...(state.navList.length ? state.navList : state.channels),
    ];
    const seen = new Set();
    return pool.filter((ch) => ch && !seen.has(ch.key) && seen.add(ch.key));
  }

  /** Start a channel by itself when the site opens or a new playlist loads and nothing is on screen yet. */
  function autoStart() {
    if (auto || !state.channels.length || !['idle', 'error'].includes(el.player.dataset.state)) return;
    const session = { candidates: autoCandidates(), next: 0, live: [] };
    auto = session;
    el.player.classList.add('is-searching');
    el.ptName.textContent = 'Finding a live channel';
    el.ptMeta.textContent = 'Skipping channels that are offline';
    el.loadingText.textContent = 'Finding a channel that’s live…';
    setPlayback('loading');
    autoNext(session);
  }

  async function autoNext(session) {
    while (auto === session) {
      if (session.live.length) {
        playChannel(session.live.shift(), { automatic: true });
        return;
      }
      const limit = Math.min(session.candidates.length, CONFIG.autoBatch * CONFIG.autoRounds);
      if (session.next >= limit) break;
      const batch = session.candidates.slice(session.next, session.next + CONFIG.autoBatch);
      session.next += batch.length;
      // All checks run at once; take the first live one in priority order, keep the rest as fallbacks.
      const probes = batch.map((ch) => probeStream(ch.url).then((ok) => (ok ? ch : null)));
      for (let i = 0; i < probes.length; i++) {
        const ch = await probes[i];
        if (auto !== session) return;
        if (ch) {
          Promise.all(probes.slice(i + 1)).then((rest) => {
            if (auto === session) session.live.push(...rest.filter(Boolean));
          });
          playChannel(ch, { automatic: true });
          return;
        }
      }
    }
    if (auto !== session) return;
    auto = null;
    el.player.classList.remove('is-searching');
    el.errorTitle.textContent = 'No live channel found';
    el.errorText.textContent = `None of the ${Math.min(session.next, session.candidates.length)} channels checked answered right now. Pick one from the list, or try again in a while.`;
    setPlayback('error');
  }

  function step(dir) {
    const list = state.navList.length ? state.navList : state.channels;
    if (!list.length) return;
    const index = state.current ? list.findIndex((c) => c.key === state.current.key) : -1;
    const next = list[(index + dir + list.length) % list.length];
    playChannel(next);
    revealCurrent();
  }

  function togglePlay() {
    const s = el.player.dataset.state;
    if (s === 'playing') el.video.pause();
    else if (s === 'paused') {
      el.player.classList.add('is-buffering');
      el.video.play().catch(() => el.player.classList.remove('is-buffering'));
    }
  }

  function showUi() {
    el.player.classList.add('show-ui');
    clearTimeout(player.uiTimer);
    player.uiTimer = setTimeout(() => {
      // Keep the controls up while a mouse rests on them or a keyboard user is tabbing through them.
      // Touch screens leave the last tapped button in :hover, so hover only counts for a mouse.
      const held = player.lastPointer === 'mouse' ? '.controls:hover, .player-top:hover, :focus-visible' : ':focus-visible';
      if (!el.player.querySelector(held)) el.player.classList.remove('show-ui');
    }, 2800);
  }

  function isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function toggleFullscreen() {
    if (isFullscreen()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    const request = el.player.requestFullscreen || el.player.webkitRequestFullscreen;
    if (request) {
      Promise.resolve(request.call(el.player))
        .then(() => window.screen.orientation?.lock?.('landscape'))
        .catch(() => {});
    } else if (el.video.webkitEnterFullscreen) {
      // iPhone Safari only allows the <video> element itself to go full screen.
      el.video.webkitEnterFullscreen();
    }
  }

  function syncVolumeUi() {
    const muted = el.video.muted || el.video.volume === 0;
    el.ctlMute.querySelector('use').setAttribute('href', muted ? '#i-mute' : '#i-volume');
    el.ctlMute.setAttribute('aria-label', muted ? 'Unmute (M)' : 'Mute (M)');
    el.ctlVolume.value = muted ? 0 : el.video.volume;
    el.ctlVolume.style.setProperty('--fill', `${(muted ? 0 : el.video.volume) * 100}%`);
  }

  /* --------------------------------------------------------------- picker */

  function detectCountry() {
    const zones = {
      'Asia/Karachi': 'PK', 'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA',
      'Asia/Dhaka': 'BD', 'Asia/Qatar': 'QA', 'Asia/Kathmandu': 'NP', 'Europe/London': 'UK',
    };
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zones[tz]) return zones[tz];
    for (const locale of navigator.languages || []) {
      const m = locale.match(/-([A-Za-z]{2})$/);
      if (m) {
        const code = m[1].toUpperCase();
        return code === 'GB' ? 'UK' : code;
      }
    }
    return null;
  }

  function countryButton(c, cls = 'country') {
    const current = state.selection && state.selection.country === c.code ? ' is-current' : '';
    if (cls === 'chip') return `<button class="chip" type="button" data-country="${esc(c.code)}"><span class="flag">${esc(c.flag)}</span>${esc(c.name)}</button>`;
    return `<button class="country${current}" type="button" data-country="${esc(c.code)}">
      <span class="country-flag flag">${esc(c.flag)}</span>
      <span class="country-text"><span class="country-name">${esc(c.name)}</span><span class="country-langs">${esc(c.languages.map(langName).join(', ') || 'No language data')}</span></span>
    </button>`;
  }

  function renderCountryGrid() {
    const q = fold(el.countrySearch.value.trim());
    const list = q ? state.countries.filter((c) => fold(`${c.name} ${c.code}`).includes(q)) : state.countries;
    const showWorld = !q || 'worldwide global all countries international'.includes(q);
    const worldCurrent = state.selection && state.selection.worldwide ? ' is-current' : '';
    const worldCard = `<button class="country country-world${worldCurrent}" type="button" data-world>
      <span class="world-icon"><svg class="ic"><use href="#i-globe"/></svg></span>
      <span class="country-text"><span class="country-name">Worldwide</span><span class="country-langs">Every channel, every country, every language</span></span>
      <span class="world-badge">11k+ channels</span>
    </button>`;
    el.countryGrid.innerHTML = (showWorld ? worldCard : '') + (list.length
      ? list.map((c) => countryButton(c)).join('')
      : (showWorld ? '' : `<div class="empty" style="grid-column:1/-1"><strong>No country matches "${esc(el.countrySearch.value)}"</strong></div>`));

    const picks = [];
    const detected = countryOf(detectCountry());
    if (detected) picks.push(detected);
    const currentSel = state.selection && countryOf(state.selection.country);
    if (currentSel && currentSel !== detected) picks.push(currentSel);
    el.suggested.hidden = Boolean(q) || !picks.length;
    el.suggested.innerHTML = `<span class="suggested-label">Suggested</span>${picks.map((c) => countryButton(c, 'chip')).join('')}`;
  }

  function openPicker() {
    if (!state.countries.length) {
      toast('Still loading countries — try again in a moment');
      loadCountries();
      return;
    }
    showStep('country');
    el.countrySearch.value = '';
    renderCountryGrid();
    if (!el.picker.open) el.picker.showModal();
    el.countryGrid.scrollTop = 0;
    if (!mobile.matches) el.countrySearch.focus();
  }

  function showStep(which) {
    el.stepCountry.hidden = which !== 'country';
    el.stepLang.hidden = which !== 'lang';
  }

  function chooseCountry(code) {
    const country = countryOf(code);
    if (!country) return;
    const keep = state.selection && state.selection.country === code ? state.selection : null;
    state.draft = {
      country: code,
      langs: new Set(keep ? keep.langs : country.languages),
      onlyCountry: keep ? keep.onlyCountry : true,
      results: new Map(),
      userToggledOnly: Boolean(keep),
    };
    el.pickerFlag.textContent = country.flag;
    el.pickerCountry.textContent = country.name;
    el.onlyTitle.textContent = `Only channels from ${country.name}`;
    el.onlyCountry.checked = state.draft.onlyCountry;
    showStep('lang');
    renderDraft();

    const draft = state.draft;
    country.languages.forEach((lang) => {
      loadLanguage(lang)
        .then((list) => draft.results.set(lang, list))
        .catch(() => draft.results.set(lang, 'error'))
        .finally(() => {
          if (state.draft === draft) renderDraft();
        });
    });
  }

  function renderDraft() {
    const draft = state.draft;
    if (!draft) return;
    const country = countryOf(draft.country);
    const langs = country.languages;

    el.langChips.innerHTML = langs.length
      ? langs.map((lang) => {
        const result = draft.results.get(lang);
        const pending = result === undefined;
        const unavailable = result === 'error' || (Array.isArray(result) && result.length === 0);
        const local = Array.isArray(result) ? result.filter((c) => c.country === draft.country).length : 0;
        let count = '<span class="mini-spin"></span>Loading';
        if (result === 'error') count = "Couldn't load";
        else if (Array.isArray(result)) count = result.length ? `${plural(result.length, 'channel')} · ${local.toLocaleString()} from here` : 'No channels yet';
        const on = draft.langs.has(lang) && !unavailable;
        return `<button class="lang-chip" type="button" data-lang="${esc(lang)}" aria-pressed="${on}"${unavailable ? ' disabled' : ''}>
          <span class="check"><svg class="ic"><use href="#i-check"/></svg></span>
          <span><span class="lang-name">${esc(langName(lang))}</span><span class="lang-count">${count}</span></span>
        </button>`;
      }).join('')
      : '<p class="picker-sub">iptv-org has no language data for this country.</p>';

    const settled = langs.every((l) => draft.results.has(l));
    const selected = selectedLangs(draft);
    const pendingSelected = selected.filter((l) => !draft.results.has(l));
    const chosen = selected.filter((l) => Array.isArray(draft.results.get(l)));
    const lists = chosen.map((l) => draft.results.get(l));
    const all = mergePlaylists(lists, draft.country, false).length;
    const local = mergePlaylists(lists, draft.country, true).length;

    // When nothing in these languages is registered to the country, default to all channels so the list isn't empty.
    if (settled && !draft.userToggledOnly && draft.onlyCountry && local === 0 && all > 0) {
      draft.onlyCountry = false;
      el.onlyCountry.checked = false;
    }
    el.onlySub.textContent = local === 0 && all > 0
      ? `No channels in these languages are registered to ${country.name}, so all ${plural(all, 'channel')} are shown.`
      : `${local.toLocaleString()} from ${country.name} · ${all.toLocaleString()} in total. Turn off to see every channel in these languages.`;

    const total = draft.onlyCountry ? local : all;
    if (!lists.length && pendingSelected.length) {
      el.pickerSummary.textContent = 'Loading playlists…';
    } else if (!langs.length || (settled && !all)) {
      el.pickerSummary.textContent = `No channels available for ${country.name} yet.`;
    } else if (pendingSelected.length) {
      el.pickerSummary.innerHTML = `<strong>${plural(total, 'channel')}</strong> so far · still loading ${esc(pendingSelected.map(langName).join(' + '))}`;
    } else {
      el.pickerSummary.innerHTML = `<strong>${plural(total, 'channel')}</strong> in ${esc(chosen.map(langName).join(' + ') || 'no languages')}`;
    }
    el.pickerApply.disabled = !selected.length || (!pendingSelected.length && total === 0);
    el.pickerApply.textContent = pendingSelected.length || !total ? 'Watch channels' : `Watch ${plural(total, 'channel')}`;
  }

  /** Languages ticked in the picker, including ones still downloading; known-empty or failed ones are left out. */
  function selectedLangs(draft) {
    return countryOf(draft.country).languages.filter((l) => {
      const result = draft.results.get(l);
      return draft.langs.has(l) && result !== 'error' && !(Array.isArray(result) && result.length === 0);
    });
  }

  function applyWorldwide() {
    el.picker.close();
    state.view = 'all';
    state.query = '';
    el.search.value = '';
    applySelection({ ...WORLDWIDE });
  }

  function applyDraft() {
    const draft = state.draft;
    if (!draft) return;
    const country = countryOf(draft.country);
    const langs = selectedLangs(draft);
    if (!langs.length) return;
    el.picker.close();
    state.view = 'all';
    state.query = '';
    el.search.value = '';
    applySelection({ country: draft.country, langs, onlyCountry: draft.onlyCountry });
  }

  async function loadCountries() {
    try {
      const res = await fetch(CONFIG.countriesUrl);
      if (!res.ok) throw new Error(`Countries request failed (${res.status})`);
      const countries = await res.json();
      const collator = new Intl.Collator();
      state.countries = countries.sort((a, b) => collator.compare(a.name, b.name));
      state.countryByCode = new Map(state.countries.map((c) => [c.code, c]));
      return true;
    } catch {
      toast("Couldn't load the country list — check your connection");
      return false;
    }
  }

  /* ---------------------------------------------------------- sidebar ui */

  function setDrawer(open) {
    state.drawerOpen = open;
    el.app.classList.toggle('drawer-open', open);
    el.scrim.hidden = !open;
    el.sidebar.inert = mobile.matches && !open;
    el.sidebarToggle.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function setCollapsed(collapsed) {
    state.collapsed = collapsed;
    store.set(KEYS.collapsed, collapsed);
    el.app.classList.toggle('sidebar-collapsed', collapsed);
    el.sidebar.inert = collapsed;
    el.sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  }

  function syncLayout() {
    const icon = el.sidebarToggle.querySelector('use');
    if (mobile.matches) {
      el.app.classList.remove('sidebar-collapsed');
      icon.setAttribute('href', '#i-menu');
      setDrawer(false);
    } else {
      setDrawer(false);
      icon.setAttribute('href', '#i-sidebar');
      setCollapsed(state.collapsed);
    }
  }

  function openChannelList({ focusSearch = false } = {}) {
    if (mobile.matches) setDrawer(true);
    else if (state.collapsed) setCollapsed(false);
    if (focusSearch) setTimeout(() => el.search.focus(), mobile.matches ? 200 : 0);
  }

  /* --------------------------------------------------------------- events */

  function findChannel(key) {
    return state.byKey.get(key) || state.favorites.get(key) || null;
  }

  function handleAction(action) {
    const ch = state.current;
    switch (action) {
      case 'picker': openPicker(); break;
      case 'reload': if (state.selection) applySelection(state.selection, { announce: false }); break;
      case 'browse': openChannelList({ focusSearch: true }); break;
      case 'favorites':
        state.view = 'favorites';
        state.query = '';
        el.search.value = '';
        renderSidebar();
        el.scroll.scrollTop = 0;
        openChannelList();
        break;
      case 'resume': {
        const last = store.get(KEYS.last, null);
        if (last) playChannel(findChannel(last.key) || last);
        break;
      }
      case 'retry': if (ch) startStream(ch); else autoStart(); break;
      case 'next': step(1); break;
      default: break;
    }
  }

  function bindEvents() {
    document.addEventListener('click', (e) => {
      const target = e.target.closest('[data-play],[data-fav],[data-toggle],[data-action],[data-country],[data-world],[data-lang],[data-group-by],[data-close]');
      if (!target) return;
      const d = target.dataset;
      if (d.play) {
        const ch = findChannel(d.play);
        if (ch) playChannel(ch);
      } else if (d.fav) {
        toggleFavorite(d.fav);
      } else if (d.toggle !== undefined) {
        toggleGroup(Number(d.toggle));
      } else if (d.action) {
        handleAction(d.action);
      } else if (d.country) {
        chooseCountry(d.country);
      } else if (target.hasAttribute('data-world')) {
        applyWorldwide();
      } else if (d.groupBy) {
        setGroupBy(d.groupBy);
      } else if (d.lang && state.draft) {
        const set = state.draft.langs;
        set.has(d.lang) ? set.delete(d.lang) : set.add(d.lang);
        renderDraft();
      } else if (target.hasAttribute('data-close')) {
        el.picker.close();
      }
    });

    el.sidebarToggle.addEventListener('click', () => (mobile.matches ? setDrawer(!state.drawerOpen) : setCollapsed(!state.collapsed)));
    el.drawerClose.addEventListener('click', () => setDrawer(false));
    el.scrim.addEventListener('click', () => setDrawer(false));
    mobile.addEventListener('change', syncLayout);

    el.tabs.forEach((t) => t.addEventListener('click', () => {
      state.view = t.dataset.view;
      renderSidebar();
      el.scroll.scrollTop = 0;
    }));

    let searchTimer;
    el.search.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        state.query = el.search.value.trim();
        if (state.query && state.view !== 'all') state.view = 'all';
        renderSidebar();
        el.scroll.scrollTop = 0;
      }, 120);
    });

    el.regionPill.addEventListener('click', () => {
      if (state.selection && countryOf(state.selection.country)) {
        openPicker();
        chooseCountry(state.selection.country);
      } else {
        openPicker();
      }
    });
    el.countrySearch.addEventListener('input', renderCountryGrid);
    el.countrySearch.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const first = el.countryGrid.querySelector('[data-country]');
      if (first) chooseCountry(first.dataset.country);
      else if (el.countryGrid.querySelector('[data-world]')) applyWorldwide();
    });
    el.pickerBack.addEventListener('click', () => {
      showStep('country');
      renderCountryGrid();
    });
    el.onlyCountry.addEventListener('change', () => {
      if (!state.draft) return;
      state.draft.onlyCountry = el.onlyCountry.checked;
      state.draft.userToggledOnly = true;
      renderDraft();
    });
    el.pickerApply.addEventListener('click', applyDraft);
    el.picker.addEventListener('click', (e) => {
      if (e.target === el.picker) el.picker.close();
    });

    // Player
    const v = el.video;
    v.addEventListener('playing', () => {
      auto = null;
      el.player.classList.remove('is-searching');
      if (state.current) store.set(KEYS.last, state.current);
      clearTimeout(player.loadTimer);
      el.player.classList.remove('is-buffering');
      setPlayback('playing');
      showUi();
    });
    v.addEventListener('waiting', () => {
      if (el.player.dataset.state === 'playing') el.player.classList.add('is-buffering');
    });
    v.addEventListener('pause', () => {
      if (el.player.dataset.state === 'playing') setPlayback('paused');
    });
    v.addEventListener('error', () => {
      if (!player.hls && v.getAttribute('src') && el.player.dataset.state !== 'idle') fail(player.triedNative ? 'media' : 'network');
    });
    v.addEventListener('volumechange', () => {
      syncVolumeUi();
      if (!v.muted) {
        player.autoMuted = false;
        el.unmute.hidden = true;
      }
      // Muting forced by the browser's autoplay rule is not the viewer's choice, so it isn't remembered.
      if (player.autoMuted) return;
      store.set(KEYS.volume, v.volume);
      store.set(KEYS.muted, v.muted);
    });
    el.unmute.addEventListener('click', () => {
      v.muted = false;
      if (v.volume === 0) v.volume = 0.8;
    });

    el.player.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') showUi();
    });
    // Mouse only: a touch fires pointerleave every time the finger lifts, which hid the controls
    // before the tap reached them, so the tap fell through to the video. Touch hides on the timer.
    el.player.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && el.player.dataset.state === 'playing') el.player.classList.remove('show-ui');
    });
    // Touching a control keeps the controls up while they are in use.
    el.player.addEventListener('pointerdown', (e) => {
      player.lastPointer = e.pointerType;
      if (e.pointerType !== 'mouse' && e.target.closest('.controls, .player-top')) showUi();
    });
    v.addEventListener('click', (e) => {
      if (!window.matchMedia('(hover: none)').matches) {
        togglePlay();
        return;
      }
      // Touch: the middle of the picture plays or pauses; anywhere else shows or hides the controls.
      const r = v.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width;
      const y = (e.clientY - r.top) / r.height;
      const centre = x > 0.3 && x < 0.7 && y > 0.25 && y < 0.75;
      if (centre && ['playing', 'paused'].includes(el.player.dataset.state)) {
        togglePlay();
        showUi();
      } else if (el.player.classList.contains('show-ui')) {
        el.player.classList.remove('show-ui');
      } else {
        showUi();
      }
    });
    v.addEventListener('dblclick', toggleFullscreen);

    el.bigPlay.addEventListener('click', togglePlay);
    el.ctlPlay.addEventListener('click', togglePlay);
    el.ctlPrev.addEventListener('click', () => step(-1));
    el.ctlNext.addEventListener('click', () => step(1));
    el.ctlMute.addEventListener('click', () => {
      if (v.muted || v.volume === 0) {
        v.muted = false;
        if (v.volume === 0) v.volume = 0.6;
      } else {
        v.muted = true;
      }
    });
    el.ctlVolume.addEventListener('input', () => {
      v.volume = Number(el.ctlVolume.value);
      v.muted = v.volume === 0;
    });
    el.ctlFullscreen.addEventListener('click', toggleFullscreen);

    let railFrame = 0;
    el.rail.addEventListener('scroll', () => {
      cancelAnimationFrame(railFrame);
      railFrame = requestAnimationFrame(updateRailNav);
    }, { passive: true });
    window.addEventListener('resize', () => requestAnimationFrame(updateRailNav));
    const scrollRail = (dir) => el.rail.scrollBy({ left: dir * el.rail.clientWidth * 0.85, behavior: 'smooth' });
    el.railPrev.addEventListener('click', () => scrollRail(-1));
    el.railNext.addEventListener('click', () => scrollRail(1));
    const onFullscreen = () => {
      const on = isFullscreen();
      el.ctlFullscreen.querySelector('use').setAttribute('href', on ? '#i-shrink' : '#i-expand');
      el.ctlFullscreen.setAttribute('aria-label', on ? 'Exit full screen (F)' : 'Full screen (F)');
    };
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('webkitfullscreenchange', onFullscreen);

    if (document.pictureInPictureEnabled) {
      el.ctlPip.hidden = false;
      el.ctlPip.addEventListener('click', () => {
        const action = document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture();
        action.catch(() => toast("Picture-in-picture isn't available for this stream"));
      });
    }

    el.nowFav.addEventListener('click', () => state.current && toggleFavorite(state.current.key));

    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && state.drawerOpen) {
        setDrawer(false);
        return;
      }
      if (el.picker.open || e.target.closest('input, textarea, select, [contenteditable]')) return;
      const key = e.key.toLowerCase();
      if (key === '?' && el.shortcuts.togglePopover && !mobile.matches) {
        el.shortcuts.togglePopover();
      } else if (key === '/') {
        e.preventDefault();
        openChannelList({ focusSearch: true });
      } else if (key === 'k' || (key === ' ' && !e.target.closest('button, a'))) {
        e.preventDefault();
        togglePlay();
      } else if (key === 'f') {
        toggleFullscreen();
      } else if (key === 'm') {
        el.ctlMute.click();
      } else if (key === 'n') {
        step(1);
      } else if (key === 'p') {
        step(-1);
      }
    });
  }

  /* ----------------------------------------------------------------- init */

  async function init() {
    el.reportLink.href = CONFIG.reportUrl;
    el.footerYear.textContent = String(new Date().getFullYear());
    const volume = store.get(KEYS.volume, 1);
    el.video.volume = typeof volume === 'number' ? Math.min(1, Math.max(0, volume)) : 1;
    el.video.muted = store.get(KEYS.muted, false) === true;
    syncVolumeUi();
    setPlayback('idle');
    // First visit starts on Worldwide; the country picker stays one click away in the top bar.
    if (!state.selection) state.selection = { ...WORLDWIDE };
    state.loading = true;
    bindEvents();
    syncLayout();
    renderRegion();
    renderIdle();
    renderSidebar();
    await loadCountries();
    await applySelection(state.selection, { announce: false });
  }

  init();
})();

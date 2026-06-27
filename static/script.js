'use strict';

const MAPS = [
    { id: 'de_mirage',    name: 'MIRAGE',    file: 'Mirage.jpg'    },
    { id: 'de_inferno',   name: 'INFERNO',   file: 'Inferno.jpg'   },
    { id: 'de_dust2',     name: 'DUST2',     file: 'Dust2.jpg'     },
    { id: 'de_nuke',      name: 'NUKE',      file: 'Nuke.jpg'      },
    { id: 'de_ancient',   name: 'ANCIENT',   file: 'Ancient.jpg'   },
    { id: 'de_anubis',    name: 'ANUBIS',    file: 'Anubis.jpg'    },
    { id: 'de_cache',     name: 'CACHE',     file: 'Cache.jpg'     },
    { id: 'de_overpass',  name: 'OVERPASS',  file: 'Overpass.jpg'  },
];

let selectedMap   = null;
let serverRunning = false;
let heartbeatTimer = null;

const mapsGrid        = document.getElementById('mapsGrid');
const selectedMapName = document.getElementById('selectedMapName');
const launchBtn       = document.getElementById('launchBtn');
const launchInfoText  = document.getElementById('launchInfoText');
const statusDot       = document.getElementById('statusDot');
const statusLabel     = document.getElementById('statusLabel');
const steamIdInput    = document.getElementById('steamId');
const resolveSteamBtn = document.getElementById('resolveSteamBtn');
const loadSkinsBtn    = document.getElementById('loadSkinsBtn');
const skinsStatus     = document.getElementById('skinsStatus');
const toast           = document.getElementById('toast');
const connectBar      = document.getElementById('connectBar');
const connectAddr     = document.getElementById('connectAddr');
const connectCopyBtn  = document.getElementById('connectCopyBtn');
const connectJoinBtn  = document.getElementById('connectJoinBtn');

function buildMaps() {
    MAPS.forEach(map => {
        const card = document.createElement('div');
        card.className = 'map-card';
        card.dataset.id = map.id;
        card.setAttribute('role', 'button');
        card.tabIndex = 0;
        card.setAttribute('aria-pressed', 'false');
        card.setAttribute('aria-label', map.name);
        card.innerHTML = `
            <img class="map-image" src="/maps/${map.file}" alt="${map.name}" draggable="false">
            <div class="map-overlay">
                <div class="map-checkmark">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </div>
            </div>
            <div class="map-footer">
                <span class="map-name">${map.name}</span>
            </div>
        `;
        card.addEventListener('click', () => selectMap(map, card));
        card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectMap(map, card); }
        });
        mapsGrid.appendChild(card);
    });
}

function selectMap(map, card) {
    document.querySelectorAll('.map-card').forEach(c => {
        c.classList.remove('selected');
        c.setAttribute('aria-pressed', 'false');
    });
    card.classList.add('selected');
    card.setAttribute('aria-pressed', 'true');
    selectedMap = map;
    selectedMapName.textContent = map.name;
    updateServerStatusLine();
    updateLaunchState();
}

function updateLaunchState() {
    if (serverRunning) {
        launchBtn.disabled = false;
        launchBtn.classList.add('running');
        launchBtn.innerHTML = `
            <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
            STOP SERVER
        `;
        launchInfoText.textContent = `Server running on ${selectedMap ? selectedMap.name : '—'}`;
    } else if (selectedMap) {
        launchBtn.disabled = false;
        launchBtn.classList.remove('running');
        launchBtn.innerHTML = `
            <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            LAUNCH SERVER
        `;
        launchInfoText.textContent = `Ready to launch on ${selectedMap.name}`;
    } else {
        launchBtn.disabled = true;
        launchBtn.classList.remove('running');
        launchBtn.innerHTML = `
            <svg class="btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            LAUNCH SERVER
        `;
        launchInfoText.textContent = 'Select a map to launch the server';
    }
}

launchBtn.addEventListener('click', async () => {
    if (serverRunning) {
        launchBtn.disabled = true;
        try {
            const res  = await fetch('/stop', { method: 'POST' });
            const data = await res.json();
            if (data.ok) {
                serverRunning = false;
                setStatus(false);
                hideConnectBar();
                showToast('Server stopped', 'error');
            } else {
                showToast(data.message || 'Failed to stop server', 'error');
            }
        } catch {
            showToast('Could not reach backend', 'error');
        }
        updateLaunchState();
    } else {
        if (!selectedMap) return;
        launchBtn.disabled = true;
        launchInfoText.textContent = 'Starting server…';
        try {
            const res  = await fetch('/launch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ map: selectedMap.id }),
            });
            const data = await res.json();
            if (data.ok) {
                serverRunning = true;
                setStatus(true);
                showConnectBar();
                showToast(`Launched on ${selectedMap.name}`, 'success');
            } else {
                showToast(data.message || 'Failed to launch server', 'error');
            }
        } catch {
            showToast('Could not reach backend', 'error');
        }
        updateLaunchState();
    }
});

function setStatus(online) {
    if (statusDot) statusDot.classList.toggle('online', online);
    if (statusLabel) {
        statusLabel.classList.toggle('online', online);
        statusLabel.textContent = online ? 'ONLINE' : 'OFFLINE';
    }
    updateServerStatusLine();
}

function updateServerStatusLine() {
    const dot = document.getElementById('serverLineDot');
    const st  = document.getElementById('serverLineStatus');
    const mp  = document.getElementById('serverLineMap');
    if (!dot) return;
    dot.classList.toggle('online', serverRunning);
    st.classList.toggle('online', serverRunning);
    st.textContent = serverRunning ? 'ONLINE' : 'OFFLINE';
    mp.textContent = selectedMap ? selectedMap.name : '—';
}

let _connectStr = '';

async function showConnectBar() {
    try {
        const d = await fetch('/api/server/connect-info').then(r => r.json());
        _connectStr = `connect ${d.ip}:${d.port}`;
        connectAddr.textContent = _connectStr;
    } catch {
        _connectStr = 'connect ?:27015';
        connectAddr.textContent = _connectStr;
    }
    connectBar.style.display = '';
}

function hideConnectBar() {
    connectBar.style.display = 'none';
    _connectStr = '';
}

connectCopyBtn.addEventListener('click', () => {
    if (!_connectStr) return;
    navigator.clipboard.writeText(_connectStr).then(() => {
        showToast('Connect command copied!', 'success');
    }).catch(() => {
        showToast('Copy failed', 'error');
    });
});

connectJoinBtn.addEventListener('click', () => {
    if (!_connectStr) return;
    const addr = _connectStr.replace('connect ', '');
    window.location.href = `steam://connect/${addr}`;
});

function validateSteamId(id) {
    return /^7656119\d{10}$/.test(id);
}

steamIdInput.addEventListener('input', () => {
    const val = steamIdInput.value.trim();
    if (!val) {
        steamIdInput.className = 'input-field';
        skinsStatus.textContent = '';
        skinsStatus.className = 'skins-status';
    } else if (validateSteamId(val)) {
        steamIdInput.className = 'input-field valid';
        skinsStatus.textContent = '';
        skinsStatus.className = 'skins-status';
    } else {
        
        steamIdInput.className = 'input-field';
        skinsStatus.textContent = 'Profile link detected — click APPLY to convert it to your SteamID64.';
        skinsStatus.className = 'skins-status';
    }
});

async function resolveSteamId() {
    const val = steamIdInput.value.trim();
    if (!val) { showToast('Paste your SteamID64 or profile link first', 'error'); return false; }
    if (validateSteamId(val)) return true;  
    resolveSteamBtn.disabled = true;
    skinsStatus.textContent = 'Resolving…';
    skinsStatus.className = 'skins-status';
    try {
        const res = await fetch('/api/resolve-steamid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: val }),
        });
        const data = await res.json();
        if (data.ok) {
            steamIdInput.value = data.steamid;
            steamIdInput.dispatchEvent(new Event('input'));
            localStorage.setItem('cs2prak_steamid', data.steamid);
            showToast('SteamID64 resolved', 'success');
            resolveSteamBtn.disabled = false;
            return true;
        }
        skinsStatus.textContent = data.message || 'Could not resolve SteamID64';
        skinsStatus.className = 'skins-status error';
        showToast(data.message || 'Could not resolve', 'error');
    } catch {
        showToast('Could not reach backend', 'error');
    }
    resolveSteamBtn.disabled = false;
    return false;
}

resolveSteamBtn.addEventListener('click', resolveSteamId);
steamIdInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !validateSteamId(steamIdInput.value.trim())) {
        e.preventDefault();
        resolveSteamId();
    }
});

loadSkinsBtn.addEventListener('click', async () => {
    let val = steamIdInput.value.trim();
    if (!val) { showToast('Enter your Steam ID or profile link first', 'error'); return; }
    if (!validateSteamId(val)) {
        
        const ok = await resolveSteamId();
        if (!ok) return;
        val = steamIdInput.value.trim();
    }
    window.openSkinPicker(val);
});

let toastTimer = null;
function showToast(msg, type = '') {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = 'toast show' + (type ? ' ' + type : '');
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2800);
}

const HEARTBEAT_MS = 30_000;

function _sendHeartbeat() {
    fetch('/heartbeat', { method: 'POST' }).catch(() => {});
}

function startHeartbeat() {
    if (heartbeatTimer) return;
    _sendHeartbeat();
    heartbeatTimer = setInterval(_sendHeartbeat, HEARTBEAT_MS);
}

function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

const STATUS_POLL_MS = 4000;
let statusPollTimer = null;

async function _syncServerStatus() {
    try {
        const data = await fetch('/status').then(r => r.json());
        if (data.running === serverRunning) return;   
        serverRunning = data.running;
        setStatus(data.running);
        if (data.running) {
            showConnectBar();
        } else {
            hideConnectBar();
            showToast('Server stopped', 'error');
        }
        updateLaunchState();
    } catch {  }
}

function startStatusPoll() {
    if (!statusPollTimer) statusPollTimer = setInterval(_syncServerStatus, STATUS_POLL_MS);
}
function stopStatusPoll() {
    if (statusPollTimer) { clearInterval(statusPollTimer); statusPollTimer = null; }
}

function _updatePerfMode() {
    document.body.classList.toggle('low-power', document.hidden || !document.hasFocus());
}
window.addEventListener('blur',  _updatePerfMode);
window.addEventListener('focus', _updatePerfMode);

document.addEventListener('visibilitychange', () => {
    _updatePerfMode();
    if (document.hidden) {
        stopHeartbeat();
        stopUpdPoll();
        stopStatusPoll();
    } else {
        startHeartbeat();
        startStatusPoll();
        _syncServerStatus();   
        if (document.getElementById('updBackdrop').classList.contains('open') &&
            !_updPollTimer && updStatusLabel.textContent === 'RUNNING…') {
            _updPollTimer = setInterval(pollUpdateStatus, 1000);
        }
    }
});

const _tabBtns  = document.querySelectorAll('.tab-btn');
const tabsTrack = document.getElementById('tabsTrack');
let _activeTab  = 0;
let _pluginsLoaded = false;

const _demoDdToggle = document.getElementById('demoDdToggle');
const _demoDdMenu   = document.getElementById('demoDdMenu');

_tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.disabled) return;
        const next = parseInt(btn.dataset.tab);
        if (isNaN(next)) return;                 
        if (_demoDdMenu) _demoDdMenu.hidden = true;
        if (next === _activeTab) { syncDemoDd(next); return; }
        _activeTab = next;
        tabsTrack.style.transform = `translateX(-${(100 / 10) * next}%)`;
        _tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        syncDemoDd(next);
        
        document.querySelector('.footer').style.display = (next === 4 || next === 8 || next === 9) ? 'none' : '';
        if (next === 2 && !_pluginsLoaded) {
            _pluginsLoaded = true;
            loadPlugins();
        }
        if (next === 4 && window.initDemo) window.initDemo();
        if (next === 5) checkServerInstalled();
        if (next === 8 && window.initStatistics) window.initStatistics();
        if (next === 9 && window.initAdvanced) window.initAdvanced();
    });
});

function syncDemoDd(active) {
    if (_demoDdToggle) _demoDdToggle.classList.toggle('active', active === 4 || active === 8 || active === 9);
}

function showBetaNotice(anchor) {
    if (document.getElementById('betaNotice')) return;
    const card = document.createElement('div');
    card.id = 'betaNotice';
    card.className = 'tour-tip tip-bottom beta-pop';

    const arrow = document.createElement('div'); arrow.className = 'tour-arrow';
    const head = document.createElement('div'); head.className = 'tour-tip-head';
    const title = document.createElement('span'); title.className = 'tour-tip-title';
    title.textContent = t('tab.betaTitle');
    const tag = document.createElement('span'); tag.className = 'tour-step-count'; tag.textContent = t('tab.beta');
    head.append(title, tag);
    const text = document.createElement('div'); text.className = 'tour-tip-text';
    text.textContent = t('tab.betaNotice');
    const btns = document.createElement('div'); btns.className = 'tour-tip-btns';
    const spacer = document.createElement('span'); spacer.className = 'tour-btn-spacer';
    const ok = document.createElement('button'); ok.className = 'tour-btn tour-next';
    ok.textContent = t('tab.betaOk');
    btns.append(spacer, ok);
    card.append(arrow, head, text, btns);
    document.body.appendChild(card);

    const place = () => {
        const r = anchor.getBoundingClientRect(), w = 320;
        let left = r.left + r.width / 2 - w / 2;
        left = Math.max(14, Math.min(left, window.innerWidth - w - 14));
        card.style.left = left + 'px';
        card.style.top = (r.bottom + 12) + 'px';
        let ax = r.left + r.width / 2 - left;
        arrow.style.left = Math.max(18, Math.min(ax, w - 18)) + 'px';
    };
    place();
    const dismiss = () => {
        card.remove();
        window.removeEventListener('resize', place);
        try { localStorage.setItem('cs2prak_beta_seen', '1'); } catch (e) {}
    };
    ok.addEventListener('click', dismiss);
    window.addEventListener('resize', place);
    requestAnimationFrame(() => card.classList.add('show'));
}

if (_demoDdToggle) {
    _demoDdToggle.addEventListener('click', e => {
        e.stopPropagation();
        if (_demoDdMenu) _demoDdMenu.hidden = !_demoDdMenu.hidden;
        let seen = '0';
        try { seen = localStorage.getItem('cs2prak_beta_seen') || '0'; } catch (e) {}
        if (_demoDdMenu && !_demoDdMenu.hidden && seen !== '1') showBetaNotice(_demoDdToggle);
    });
    document.addEventListener('click', () => { if (_demoDdMenu) _demoDdMenu.hidden = true; });
}

window.cs2reveal = function (container, selector) {
    if (!container) return;
    const targets = [].slice.call(container.querySelectorAll(selector));
    if (!targets.length) return;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !('IntersectionObserver' in window)) return;   
    targets.forEach(t => t.classList.add('reveal'));
    const scroller = container.closest('.tab-panel') || null;
    const io = new IntersectionObserver((entries, obs) => {
        entries.forEach(e => {
            if (!e.isIntersecting) return;
            const t = e.target;
            t.style.transitionDelay = (t.getAttribute('data-rd') || 0) + 'ms';
            t.classList.add('is-in');
            t.addEventListener('transitionend', () => { t.style.transitionDelay = ''; }, { once: true });
            obs.unobserve(t);
        });
    }, { root: scroller, rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    targets.forEach((t, i) => { t.setAttribute('data-rd', Math.min(i, 14) * 28); io.observe(t); });
};

const osSwitch    = document.getElementById('osSwitch');
let _selectedOS   = localStorage.getItem('cs2prak_os') || 'windows';

function _syncOSLabels() {
    const isLinux = _selectedOS === 'linux';
    osSwitch.checked = isLinux;
    document.getElementById('osLabelWin').classList.toggle('active', !isLinux);
    document.getElementById('osLabelLin').classList.toggle('active',  isLinux);
}

osSwitch.addEventListener('change', () => {
    _selectedOS = osSwitch.checked ? 'linux' : 'windows';
    localStorage.setItem('cs2prak_os', _selectedOS);
    _syncOSLabels();
});

document.getElementById('osLabelWin').addEventListener('click', () => {
    if (_selectedOS !== 'windows') { osSwitch.checked = false; osSwitch.dispatchEvent(new Event('change')); }
});
document.getElementById('osLabelLin').addEventListener('click', () => {
    if (_selectedOS !== 'linux') { osSwitch.checked = true; osSwitch.dispatchEvent(new Event('change')); }
});

_syncOSLabels();

window.applyTheme = function (theme) {
    const t = theme || 'dark';
    if (t === 'dark') document.documentElement.removeAttribute('data-theme');
    else              document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('cs2prak_theme', t); } catch (e) {}
};

(function initSettings() {
    
    const themeSeg = document.getElementById('setThemeSeg');
    if (themeSeg) {
        const syncTheme = () => {
            const cur = localStorage.getItem('cs2prak_theme') || 'dark';
            themeSeg.querySelectorAll('.dv-seg-btn').forEach(b => {
                const on = b.dataset.theme === cur;
                b.classList.toggle('on', on);
                b.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        };
        themeSeg.querySelectorAll('.dv-seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                window.applyTheme(btn.dataset.theme);
                syncTheme();
            });
        });
        syncTheme();
    }

    const langSeg = document.getElementById('setLangSeg');
    if (langSeg) {
        const syncLang = () => {
            const cur = localStorage.getItem('cs2prak_lang') || 'en';
            langSeg.querySelectorAll('.dv-seg-btn').forEach(b => {
                const on = b.dataset.lang === cur;
                b.classList.toggle('on', on);
                b.setAttribute('aria-checked', on ? 'true' : 'false');
            });
        };
        langSeg.querySelectorAll('.dv-seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (window.applyLang) window.applyLang(btn.dataset.lang);
                syncLang();
            });
        });
        
        document.addEventListener('langchange', syncLang);
        syncLang();
    }

    const tut = document.getElementById('setTutorialToggle');
    if (tut) {
        tut.checked = localStorage.getItem('cs2prak_tutorial_off') !== '1';
        tut.addEventListener('change', () => {
            if (tut.checked) localStorage.removeItem('cs2prak_tutorial_off');
            else             localStorage.setItem('cs2prak_tutorial_off', '1');
        });
    }
    const restart = document.getElementById('setRestartTour');
    if (restart) {
        restart.addEventListener('click', () => {
            if (window.startTutorial) window.startTutorial();
        });
    }

    const pencil = document.getElementById('setPencilToggle');
    if (pencil) {
        pencil.checked = localStorage.getItem('cs2prak_pencil') === '1';
        pencil.addEventListener('change', () => {
            if (pencil.checked) localStorage.setItem('cs2prak_pencil', '1');
            else                localStorage.removeItem('cs2prak_pencil');
        });
    }
})();

buildMaps();
updateLaunchState();
updateServerStatusLine();
startHeartbeat();

const _savedId = localStorage.getItem('cs2prak_steamid');
if (_savedId) {
    steamIdInput.value = _savedId;
    steamIdInput.dispatchEvent(new Event('input'));
}

fetch('/status').then(r => r.json()).then(data => {
    if (data.running) {
        serverRunning = true;
        setStatus(true);
        showConnectBar();
        updateLaunchState();
    }
}).catch(() => {});

startStatusPoll();
_updatePerfMode();

const updateBtn      = document.getElementById('updateBtn');
const updBackdrop    = document.getElementById('updBackdrop');
const updLog         = document.getElementById('updLog');
const updStatusLabel = document.getElementById('updStatusLabel');
const updCloseBtn    = document.getElementById('updCloseBtn');

let _updPollTimer = null;
let _updLogCursor = 0;
let _updPollMode  = 'server';

function openUpdateModal()  { updBackdrop.classList.add('open'); }
function closeUpdateModal() { updBackdrop.classList.remove('open'); }

function stopUpdPoll() {
    if (_updPollTimer) { clearInterval(_updPollTimer); _updPollTimer = null; }
}

async function pollUpdateStatus() {
    try {
        const res  = await fetch('/update/status');
        const data = await res.json();
        const newLines = data.log.slice(_updLogCursor);
        if (newLines.length) {
            updLog.textContent += newLines.join('\n') + '\n';
            _updLogCursor = data.log.length;
            updLog.scrollTop = updLog.scrollHeight;
        }
        if (!data.running) {
            stopUpdPoll();
            updateBtn.classList.remove('updating');
            updateBtn.disabled = false;
            if (data.exitCode === 0) {
                updStatusLabel.textContent = 'DONE';
                updStatusLabel.className   = 'upd-status-label done';
                showToast('Server updated successfully', 'success');
            } else {
                updStatusLabel.textContent = 'FAILED';
                updStatusLabel.className   = 'upd-status-label failed';
                showToast('Update failed (exit ' + data.exitCode + ')', 'error');
            }
        }
    } catch {  }
}

updateBtn.addEventListener('click', async () => {
    if (updateBtn.classList.contains('updating')) return;
    updLog.textContent = '';
    _updLogCursor = 0;
    updStatusLabel.textContent = 'RUNNING…';
    updStatusLabel.className   = 'upd-status-label';
    document.getElementById('updTitle').textContent = 'SERVER UPDATE';
    _updPollMode = 'server';
    openUpdateModal();
    try {
        const res  = await fetch('/update', { method: 'POST' });
        const data = await res.json();
        if (!data.ok) {
            updStatusLabel.textContent = 'ERROR';
            updStatusLabel.className   = 'upd-status-label failed';
            updLog.textContent = data.message || 'Could not start update';
            return;
        }
        updateBtn.classList.add('updating');
        updateBtn.disabled = true;
        _updPollTimer = setInterval(pollUpdateStatus, 1000);
    } catch {
        updStatusLabel.textContent = 'ERROR';
        updStatusLabel.className   = 'upd-status-label failed';
        updLog.textContent = 'Could not reach backend';
    }
});

updCloseBtn.addEventListener('click', closeUpdateModal);
updBackdrop.addEventListener('click', e => { if (e.target === updBackdrop) closeUpdateModal(); });

let _pluginInstallId = null;
let _pluginInstallName = null;

function _normVer(v) {
    if (!v || v === '—' || v === 'unknown') return null;
    v = v.trim().replace(/^v/, '').split('-')[0];
    return v.split('.').map(x => parseInt(x, 10) || 0);
}

function _isOutdated(local, latest) {
    const tl = _normVer(local);
    const tr = _normVer(latest);
    if (!tl || !tr) return false;
    const n = Math.min(tl.length, tr.length);
    const ls = tl.slice(-n);
    const rs = tr.slice(-n);
    for (let i = 0; i < n; i++) {
        if (ls[i] < rs[i]) return true;
        if (ls[i] > rs[i]) return false;
    }
    return false;
}

function _buildPluginCard(p) {
    const card = document.createElement('div');
    card.className = 'plugin-card' + (p.is_dependency ? ' plugin-card-dep' : '');
    card.dataset.id = p.id;

    const badge = p.installed
        ? '<span class="plugin-badge badge-installed">INSTALLED</span>'
        : '<span class="plugin-badge badge-missing">NOT INSTALLED</span>';
    const depBadge = p.is_dependency
        ? '<span class="plugin-badge badge-dep">DEPENDENCY</span>' : '';

    const localVer = p.local_version || (p.installed ? 'unknown' : '—');

    card.innerHTML = `
        <div class="plugin-card-main">
            <div class="plugin-card-info">
                <div class="plugin-card-title">${p.name} ${badge}${depBadge}</div>
                <div class="plugin-card-desc">${p.description}</div>
                <div class="plugin-versions-row">
                    <span class="plugin-ver-item">
                        <span class="plugin-ver-label">LOCAL</span>
                        <span class="plugin-ver-val" id="localVer_${p.id}">${localVer}</span>
                    </span>
                    <span class="plugin-ver-sep">→</span>
                    <span class="plugin-ver-item">
                        <span class="plugin-ver-label">LATEST</span>
                        <span class="plugin-ver-val" id="latestVer_${p.id}">—</span>
                    </span>
                </div>
            </div>
            <div class="plugin-card-actions">
                <a class="plugin-gh-link" href="${p.github_url}" target="_blank" rel="noopener">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>
                    RELEASES
                </a>
                <button class="plugin-install-btn" id="installBtn_${p.id}">DOWNLOAD</button>
            </div>
        </div>
        <div class="plugin-update-badge" id="updateBadge_${p.id}" style="display:none">
            UPDATE AVAILABLE
        </div>`;

    card.querySelector(`#installBtn_${p.id}`)
        .addEventListener('click', () => startPluginDownload(p.id, p.name));
    return card;
}

async function loadPlugins() {
    const list = document.getElementById('pluginsList');
    const hint = document.getElementById('pluginsHint');
    list.textContent = '';
    hint.textContent = 'Loading installed plugins...';
    try {
        const res  = await fetch('/api/plugins');
        const data = await res.json();
        data.forEach(p => list.appendChild(_buildPluginCard(p)));
        hint.textContent = 'Click CHECK UPDATES to compare with GitHub releases.';
    } catch {
        hint.textContent = 'Could not load plugin info.';
    }
}

async function checkPluginUpdates() {
    const hint    = document.getElementById('pluginsHint');
    const btn     = document.getElementById('checkUpdatesBtn');
    hint.textContent = 'Fetching latest versions from GitHub...';
    btn.disabled = true;
    try {
        const res    = await fetch('/api/plugins/latest');
        const latest = await res.json();
        let updates  = 0;
        for (const [id, ver] of Object.entries(latest)) {
            const latestEl = document.getElementById(`latestVer_${id}`);
            if (latestEl) latestEl.textContent = ver || 'N/A';
            if (ver) {
                const localEl = document.getElementById(`localVer_${id}`);
                const local   = localEl ? localEl.textContent : null;
                if (_isOutdated(local, ver)) {
                    const badge = document.getElementById(`updateBadge_${id}`);
                    if (badge) badge.style.display = '';
                    updates++;
                }
            }
        }
        hint.textContent = updates
            ? `${updates} update${updates > 1 ? 's' : ''} available.`
            : 'All plugins are up to date.';
    } catch {
        hint.textContent = 'Failed to fetch latest versions.';
    }
    btn.disabled = false;
}

async function startPluginDownload(pluginId, pluginName) {
    updLog.textContent = '';
    _updLogCursor = 0;
    updStatusLabel.textContent = 'RUNNING…';
    updStatusLabel.className   = 'upd-status-label';
    document.getElementById('updTitle').textContent =
        `DOWNLOADING ${pluginName.toUpperCase()}`;
    _updPollMode       = 'plugin';
    _pluginInstallId   = pluginId;
    _pluginInstallName = pluginName;
    openUpdateModal();

    try {
        const res  = await fetch(`/api/plugins/${pluginId}/download?os=${_selectedOS}`, { method: 'POST' });
        const data = await res.json();
        if (!data.ok) {
            updStatusLabel.textContent = 'ERROR';
            updStatusLabel.className   = 'upd-status-label failed';
            updLog.textContent = data.message || 'Could not start download';
            return;
        }
        _updPollTimer = setInterval(() => pollPluginStatus(pluginId), 1000);
    } catch {
        updStatusLabel.textContent = 'ERROR';
        updStatusLabel.className   = 'upd-status-label failed';
        updLog.textContent = 'Could not reach backend';
    }
}

async function pollPluginStatus(pluginId) {
    try {
        const res  = await fetch(`/api/plugins/${pluginId}/download/status`);
        const data = await res.json();
        const newLines = data.log.slice(_updLogCursor);
        if (newLines.length) {
            updLog.textContent += newLines.join('\n') + '\n';
            _updLogCursor = data.log.length;
            updLog.scrollTop = updLog.scrollHeight;
        }
        if (!data.running) {
            stopUpdPoll();
            if (data.exitCode === 0) {
                updStatusLabel.textContent = 'DONE';
                updStatusLabel.className   = 'upd-status-label done';
                showToast(`${_pluginInstallName || pluginId} downloaded`, 'success');
            } else {
                updStatusLabel.textContent = 'FAILED';
                updStatusLabel.className   = 'upd-status-label failed';
                showToast('Download failed', 'error');
            }
        }
    } catch {  }
}

document.getElementById('checkUpdatesBtn')
    .addEventListener('click', checkPluginUpdates);

document.getElementById('openCsgoBtn').addEventListener('click', async () => {
    try {
        const res  = await fetch('/api/open-csgo', { method: 'POST' });
        const data = await res.json();
        if (!data.ok) showToast(data.message || 'Could not open server folder', 'error');
    } catch {
        showToast('Could not reach backend', 'error');
    }
});

(function () {
    const menu  = document.getElementById('pluginsMenu');
    const fnBtn = document.getElementById('pluginsFnBtn');
    const list  = document.getElementById('pluginsMenuList');
    if (!menu || !fnBtn) return;
    const close = () => { menu.classList.remove('open'); fnBtn.setAttribute('aria-expanded', 'false'); };
    fnBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = menu.classList.toggle('open');
        fnBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    if (list) list.addEventListener('click', close);          
    document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
})();

const dlServerBtn      = document.getElementById('dlServerBtn');
const dlStatusDot      = document.getElementById('dlStatusDot');
const dlStatusText     = document.getElementById('dlStatusText');
async function checkServerInstalled() {
    try {
        const res = await fetch('/api/server/status');
        const srv = await res.json();
        dlStatusDot.classList.toggle('online', srv.installed);
        dlStatusText.textContent = srv.installed ? 'CS2 Server installed' : 'Not installed';
    } catch {
        dlStatusText.textContent = 'Could not check status';
    }
}

dlServerBtn.addEventListener('click', async () => {
    updLog.textContent = '';
    _updLogCursor = 0;
    updStatusLabel.textContent = 'RUNNING…';
    updStatusLabel.className   = 'upd-status-label';
    document.getElementById('updTitle').textContent = 'DOWNLOAD SERVER';
    _updPollMode = 'server-install';
    openUpdateModal();
    try {
        const res  = await fetch('/api/server/install', { method: 'POST' });
        const data = await res.json();
        if (!data.ok) {
            updStatusLabel.textContent = 'ERROR';
            updStatusLabel.className   = 'upd-status-label failed';
            updLog.textContent = data.message || 'Could not start install';
            return;
        }
        dlServerBtn.disabled = true;
        _updPollTimer = setInterval(pollServerInstallStatus, 1000);
    } catch {
        updStatusLabel.textContent = 'ERROR';
        updStatusLabel.className   = 'upd-status-label failed';
        updLog.textContent = 'Could not reach backend';
    }
});

async function pollServerInstallStatus() {
    try {
        const res  = await fetch('/api/server/install/status');
        const data = await res.json();
        const newLines = data.log.slice(_updLogCursor);
        if (newLines.length) {
            updLog.textContent += newLines.join('\n') + '\n';
            _updLogCursor = data.log.length;
            updLog.scrollTop = updLog.scrollHeight;
        }
        if (!data.running) {
            stopUpdPoll();
            dlServerBtn.disabled = false;
            if (data.exitCode === 0) {
                updStatusLabel.textContent = 'DONE';
                updStatusLabel.className   = 'upd-status-label done';
                showToast('Server installed successfully', 'success');
                checkServerInstalled();
            } else {
                updStatusLabel.textContent = 'FAILED';
                updStatusLabel.className   = 'upd-status-label failed';
                showToast('Server install failed', 'error');
            }
        }
    } catch {  }
}

document.getElementById('configureBtn').addEventListener('click', async () => {
    updLog.textContent = '';
    _updLogCursor = 0;
    updStatusLabel.textContent = 'RUNNING…';
    updStatusLabel.className   = 'upd-status-label';
    document.getElementById('updTitle').textContent = 'CONFIGURE SERVER';
    _updPollMode = 'configure';
    openUpdateModal();
    try {
        const res  = await fetch('/api/configure', { method: 'POST' });
        const data = await res.json();
        if (!data.ok) {
            updStatusLabel.textContent = 'ERROR';
            updStatusLabel.className   = 'upd-status-label failed';
            updLog.textContent = data.message || 'Could not start configure';
            return;
        }
        _updPollTimer = setInterval(pollConfigureStatus, 1000);
    } catch {
        updStatusLabel.textContent = 'ERROR';
        updStatusLabel.className   = 'upd-status-label failed';
        updLog.textContent = 'Could not reach backend';
    }
});

async function pollConfigureStatus() {
    try {
        const res  = await fetch('/api/configure/status');
        const data = await res.json();
        const newLines = data.log.slice(_updLogCursor);
        if (newLines.length) {
            updLog.textContent += newLines.join('\n') + '\n';
            _updLogCursor = data.log.length;
            updLog.scrollTop = updLog.scrollHeight;
        }
        if (!data.running) {
            stopUpdPoll();
            if (data.exitCode === 0) {
                updStatusLabel.textContent = 'DONE';
                updStatusLabel.className   = 'upd-status-label done';
                showToast('Server configured successfully', 'success');
            } else {
                updStatusLabel.textContent = 'FAILED';
                updStatusLabel.className   = 'upd-status-label failed';
                showToast('Configuration failed', 'error');
            }
        }
    } catch {  }
}

const adminInput  = document.getElementById('adminSteamId');
const saveAdminBtn = document.getElementById('saveAdminBtn');

fetch('/api/admin')
    .then(r => r.json())
    .then(d => { if (d.steamid) adminInput.value = d.steamid; })
    .catch(() => {});

saveAdminBtn.addEventListener('click', async () => {
    const steamid = adminInput.value.trim();
    if (!/^7656119\d{10}$/.test(steamid)) {
        showToast('Invalid SteamID64 format', 'error');
        return;
    }
    try {
        const res  = await fetch('/api/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ steamid }),
        });
        const data = await res.json();
        if (data.ok) showToast('Admin saved', 'success');
        else showToast(data.message || 'Failed to save admin', 'error');
    } catch {
        showToast('Could not reach backend', 'error');
    }
});

const managePluginsBtn = document.getElementById('managePluginsBtn');
const pmBackdrop = document.getElementById('pmBackdrop');
const pmCloseBtn = document.getElementById('pmCloseBtn');
const pmList     = document.getElementById('pmList');

const PLUGIN_AUTHORS = {
    'MatchZy':            'shobhit-pathak',
    'MenuManagerCS2':     'NickFox007',
    'PlayerSettings':     'NickFox007',
    'AnyBaseLibCS2':      'NickFox007',
    'WeaponPaints':       'Nereziel',
    'CounterStrikeSharp': 'roflmuffin',
    'Metamod:Source':     'alliedmodders',
};

function buildPmRow(p) {
    const row = document.createElement('div');
    row.className = 'pm-row';
    const author = PLUGIN_AUTHORS[p.name];
    const desc = author
        ? `by <a class="pm-row-author" href="https://github.com/${author}" target="_blank" rel="noopener noreferrer">@${author}</a>`
        : p.folder;
    row.innerHTML = `
        <div class="pm-row-info">
            <div class="pm-row-name">
                <span>${p.name}</span>
                ${p.external ? '<span class="pm-badge-ext">External</span>' : ''}
            </div>
            <div class="pm-row-folder">${desc}</div>
        </div>
        <span class="pm-state ${p.enabled ? 'on' : ''}">${p.enabled ? 'ON' : 'OFF'}</span>
        <label class="sp-toggle">
            <input type="checkbox" ${p.enabled ? 'checked' : ''}>
            <span class="sp-toggle-track"></span>
        </label>
    `;
    const input = row.querySelector('input');
    const state = row.querySelector('.pm-state');
    input.addEventListener('change', async () => {
        const enabled = input.checked;
        input.disabled = true;
        try {
            const res = await fetch(`/api/plugins/installed/${encodeURIComponent(p.folder)}/toggle`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
            });
            const data = await res.json();
            if (data.ok) {
                p.enabled = enabled;
                state.textContent = enabled ? 'ON' : 'OFF';
                state.className = 'pm-state ' + (enabled ? 'on' : '');
                showToast(enabled ? 'Plugin enabled' : 'Plugin disabled', 'success');
            } else {
                input.checked = !enabled;
                showToast(data.message || 'Failed to toggle plugin', 'error');
            }
        } catch {
            input.checked = !enabled;
            showToast('Could not reach backend', 'error');
        }
        input.disabled = false;
    });
    return row;
}

async function openPluginManager() {
    pmBackdrop.classList.add('open');
    pmList.innerHTML = '<div class="pm-empty">Loading…</div>';
    try {
        const items = await fetch('/api/plugins/installed').then(r => r.json());
        pmList.innerHTML = '';
        if (!items.length) {
            pmList.innerHTML = '<div class="pm-empty">No plugins found in the plugins folder.</div>';
            return;
        }
        items.forEach(p => pmList.appendChild(buildPmRow(p)));
    } catch {
        pmList.innerHTML = '<div class="pm-empty">Could not load plugins.</div>';
    }
}

managePluginsBtn.addEventListener('click', openPluginManager);
pmCloseBtn.addEventListener('click', () => pmBackdrop.classList.remove('open'));
pmBackdrop.addEventListener('click', e => { if (e.target === pmBackdrop) pmBackdrop.classList.remove('open'); });

(function () {
    let shown = false;
    function poll() {
        fetch('/api/update/status').then(r => r.json()).then(s => {
            if (!s) return;
            if (s.staged && !shown) {
                shown = true;
                showToast(s.message || 'Update downloaded — it installs when you restart.', 'success');
            } else if (['idle', 'downloading', 'available'].includes(s.status)) {
                setTimeout(poll, 15000);
            }
        }).catch(() => {});
    }
    setTimeout(poll, 5000);
})();

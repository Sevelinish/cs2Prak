'use strict';

(function () {
    const $ = id => document.getElementById(id);
    const picker = $('demoPicker'), viewer = $('demoViewer');
    if (!picker) return;

    const dropEl = $('demoDrop'), hintEl = $('demoPickHint');
    const canvas = $('dvCanvas'), ctx = canvas.getContext('2d');
    const elMap = $('dvMap'), elMapThumb = $('dvMapThumb'), elScore = $('dvScore'), elRoundTag = $('dvRoundTag'),
          elBombTag = $('dvBombTag'), elClock = $('dvClock'), elFloor = $('dvFloor');
    const elRounds = $('dvRounds'), elPlayers = $('dvPlayers'), elKills = $('dvKills');
    const elRoundsPop = $('dvRoundsPop');
    const elNades = $('dvNades');

    if (elRoundTag && elRoundsPop) {
        elRoundTag.addEventListener('click', (e) => { e.stopPropagation(); elRoundsPop.classList.toggle('open'); });
        elRoundsPop.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('click', () => elRoundsPop.classList.remove('open'));
    }
    const nadePop = $('dvNadePop'), nadeTitle = $('dvNadeTitle'), nadePos = $('dvNadePos'),
          nadeAng = $('dvNadeAng'), nadeNote = $('dvNadeNote');
    const dvLaunch = $('dvLaunch'); let launchPoll = null;
    const elPlay = $('dvPlay'), elSpeed = $('dvSpeed');
    const tl = $('dvTimeline'), tlFill = $('dvTlFill'), tlHead = $('dvTlHead'),
          tlRounds = $('dvTlRounds'), tlKills = $('dvTlKills');

    let cssSize = 660;                     
    let showNames = true, showHp = true, showTracers = true, showVoiceList = true;   
    let voiceMode = 0;                     
    const voiceAudios = {};                
    const stage = canvas.parentElement;    
    const TEAM = { 1: '#5b9bd5', 0: '#ff6a1f' };   
    const SPEEDS = [0.5, 1, 2, 4];
    const ROUND_TIME = 115;                 
    const bombImg = new Image(); bombImg.src = '/static/weapon_icons/bomb.png';
    const GREN_IMG = {};                    
    ['smoke', 'he', 'flash', 'molotov'].forEach(t => ['ct', 't'].forEach(s => {
        const im = new Image(); im.src = '/static/grenade_icons/' + t + '_' + s + '.png';
        GREN_IMG[t + '_' + s] = im;
    }));

    let D = null, radar = null, SC = 1, dpr = 1;
    const micImg = new Image(); micImg.src = '/static/mic_white.png?v=76';   
    let cur = 0, playing = false, raf = 0, lastTs = 0, speedIdx = 1;
    let curRound = -1, scrubbing = false;
    const MAXZOOM = 5;
    let view = { zoom: 1, ox: 0, oy: 0 }, panning = false, panLast = null;
    let drawCv = null, dctx = null, drawBadge = null, drawMode = false, drawingNow = false, strokes = [];
    let focusIdx = null, plRows = {}, level = 0, lowerRadar = null;
    let scratch = null, sctx = null;        
    const WEP_SHORT = { 'Smoke Grenade': 'Smoke', 'High Explosive Grenade': 'HE', 'Incendiary Grenade': 'Molly', 'Molotov': 'Molly', 'Flashbang': 'Flash', 'Decoy Grenade': 'Decoy', 'Survival Knife': 'Knife', 'Classic Knife': 'Knife', 'Paracord Knife': 'Knife', 'Skeleton Knife': 'Knife', 'Nomad Knife': 'Knife', 'knife': 'Knife', 'knife_t': 'Knife', 'C4 Explosive': 'C4' };
    const shortWep = n => !n ? '' : (WEP_SHORT[n] || (n.length > 11 ? n.slice(0, 11) : n));

    let ICONSET = new Set();
    fetch('/static/weapon_icons/index.json').then(r => r.json()).then(a => ICONSET = new Set(a)).catch(() => {});
    const slug = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const KNIFE_RE = /knife|bayonet|karambit|daggers|talon|ursus|stiletto|nomad|skeleton|navaja|paracord|survival|classic|gut|flip|falchion|shadow|butterfly|huntsman|bowie|kukri|m9/i;
    function wepIcon(name) {
        const sl = slug(name);
        if (ICONSET.has(sl)) return sl;
        if (KNIFE_RE.test(name) && ICONSET.has('knife')) return 'knife';
        return null;
    }
    function wepRank(name) {                    
        if (KNIFE_RE.test(name)) return 4;
        if (/c4/i.test(name)) return 5;
        if (/grenade|flashbang|molotov|decoy/i.test(name)) return 3;
        if (/glock|usp|p2000|p250|five-?seven|tec-?9|cz75|dual berettas|desert eagle|r8/i.test(name)) return 2;
        return 1;
    }
    const FLY_COL = { he: '#ffd27a', smoke: '#d6d1c8', flash: '#ffffff', molotov: '#ff7a30', decoy: '#8aa0b8' };
    let lastInvSig = {};

    const ACCEPT_RE = /\.(dem|dem\.gz|dem\.zst|gz|zst|zip)$/i;

    $('demoUpload').addEventListener('change', e => {
        enqueueFiles(Array.from(e.target.files || []));
        e.target.value = '';
    });

    ['dragenter', 'dragover'].forEach(ev => dropEl.addEventListener(ev, e => {
        e.preventDefault(); dropEl.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach(ev => dropEl.addEventListener(ev, e => {
        e.preventDefault(); dropEl.classList.remove('drag');
    }));
    dropEl.addEventListener('drop', e => {
        enqueueFiles(Array.from(e.dataTransfer.files || []));
    });

    function mapImgUrl(mapId) {
        if (!mapId) return '';
        const list = (typeof MAPS !== 'undefined' && Array.isArray(MAPS)) ? MAPS : [];
        const hit = list.find(m => m.id === mapId);
        if (hit) return '/maps/' + hit.file;
        const base = mapId.replace(/^de_/, '');
        if (!base) return '';
        return '/maps/' + base.charAt(0).toUpperCase() + base.slice(1) + '.jpg';
    }
    
    function setMapThumb(img, mapId) {
        if (!img) return;
        const url = mapImgUrl(mapId);
        img.onerror = () => { img.style.visibility = 'hidden'; };
        img.onload  = () => { img.style.visibility = ''; };
        if (url) { img.style.visibility = ''; img.src = url; }
        else { img.style.visibility = 'hidden'; img.removeAttribute('src'); }
    }

    const queueWrap = $('demoQueue'), queueList = $('demoQueueList'), queueCount = $('demoQueueCount');
    const libList   = $('demoList'),  libCount  = $('demoLibraryCount');

    let queuePoll = null;   
    let uploading = false;  

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g,
            c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    async function enqueueFiles(files) {
        const accepted = files.filter(f => ACCEPT_RE.test(f.name));
        const rejected = files.length - accepted.length;
        if (!accepted.length) {
            hintEl.textContent = rejected
                ? 'Only .dem, .dem.gz, .dem.zst or .zip files are accepted.'
                : '';
            return;
        }
        if (uploading) { hintEl.textContent = 'Still sending the previous batch…'; return; }

        uploading = true;
        dropEl.classList.add('busy');
        let sent = 0, failed = 0;
        for (const file of accepted) {
            hintEl.textContent = `Sending ${file.name} (${sent + 1}/${accepted.length})…`;
            try {
                const res = await fetch('/api/demo/enqueue?name=' + encodeURIComponent(file.name), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: file,
                }).then(r => r.json());
                if (!res || !res.ok) { failed++; }
            } catch {
                failed++;
            }
            sent++;
        }
        uploading = false;
        dropEl.classList.remove('busy');

        let msg = `Queued ${sent - failed} file${(sent - failed) === 1 ? '' : 's'} for parsing.`;
        if (failed)   msg += `  ${failed} could not be sent.`;
        if (rejected) msg += `  ${rejected} skipped (unsupported).`;
        hintEl.textContent = msg;

        refreshQueue();      
        startQueuePoll();
    }

    const QUEUE_LABEL = { queued: 'QUEUED', parsing: 'PARSING…', done: 'DONE', error: 'ERROR' };

    function renderQueue(items) {
        if (!items || !items.length) { queueWrap.hidden = true; queueList.innerHTML = ''; queueCount.textContent = ''; return; }
        queueWrap.hidden = false;

        const active = items.filter(it => it.status === 'queued' || it.status === 'parsing').length;
        queueCount.textContent = active ? active + ' in progress' : 'finishing up';

        queueList.innerHTML = items.map(it => {
            const st = it.status || 'queued';
            const err = st === 'error' && it.error
                ? '<span class="demo-q-err">' + esc(it.error) + '</span>' : '';
            return (
                '<div class="demo-q-row" data-status="' + esc(st) + '">' +
                    '<span class="demo-q-dot" aria-hidden="true"></span>' +
                    '<span class="demo-q-name">' + esc(it.name) + '</span>' +
                    err +
                    '<span class="demo-q-status">' + (QUEUE_LABEL[st] || esc(st)) + '</span>' +
                '</div>'
            );
        }).join('');
    }

    async function refreshQueue() {
        let items = [];
        try {
            const res = await fetch('/api/demo/queue').then(r => r.json());
            items = (res && res.queue) || [];
        } catch {  }
        renderQueue(items);

        const anyActive  = items.some(it => it.status === 'queued' || it.status === 'parsing');
        const anyDone    = items.some(it => it.status === 'done');

        if (anyDone) loadLibrary();

        if (!anyActive) {

            stopQueuePoll();
            if (items.length) {
                await loadLibrary();
                try { await fetch('/api/demo/queue/clear', { method: 'POST' }); } catch {}
                renderQueue([]);
            }
        }
        return anyActive;
    }

    function startQueuePoll() {
        if (queuePoll) return;
        queuePoll = setInterval(refreshQueue, 1500);
    }
    function stopQueuePoll() {
        if (queuePoll) { clearInterval(queuePoll); queuePoll = null; }
    }

    function fmtAdded(added) {
        if (!added) return '';
        const t = new Date(added * 1000);
        if (isNaN(t)) return '';
        return t.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' })
            .toUpperCase();
    }

    function scoreHtml(d) {
        const sa = (d.sa == null ? '' : d.sa), sb = (d.sb == null ? '' : d.sb);
        const aCls = d.winner === 'A' ? 'win' : (d.winner === 'B' ? 'lose' : '');
        const bCls = d.winner === 'B' ? 'win' : (d.winner === 'A' ? 'lose' : '');
        return '<b class="' + aCls + '">' + esc(sa) + '</b>' +
               '<i>:</i>' +
               '<b class="' + bCls + '">' + esc(sb) + '</b>';
    }

    function libEmptyHtml() {
        return '<div class="demo-empty">No demos yet — drop some .dem files or a .zip above.</div>';
    }

    function renderLibrary(library) {
        libCount.textContent = library && library.length
            ? library.length + (library.length === 1 ? ' demo' : ' demos') : '';

        if (!library || !library.length) { libList.innerHTML = libEmptyHtml(); return; }

        libList.innerHTML = '';
        library.forEach(d => {
            const row = document.createElement('div');
            row.className = 'demo-row';
            row.dataset.key = d.key || '';
            row.tabIndex = 0;
            row.setAttribute('role', 'button');

            row.innerHTML =
                '<img class="demo-row-thumb" alt="" loading="lazy">' +
                '<div class="demo-row-main">' +
                    '<div class="demo-row-top">' +
                        '<span class="demo-row-map">' + esc((d.map || '').replace(/^de_/, '')) + '</span>' +
                        '<span class="demo-row-score">' + scoreHtml(d) + '</span>' +
                    '</div>' +
                    '<span class="demo-row-file">' + esc(d.name || '') + '</span>' +
                '</div>' +
                '<span class="demo-row-date">' + fmtAdded(d.added) + '</span>' +
                '<button class="demo-row-del" title="Remove from library" aria-label="Remove from library">' +
                    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
                '</button>';

            setMapThumb(row.querySelector('.demo-row-thumb'), d.map);

            row.addEventListener('click', e => {
                if (e.target.closest('.demo-row-del')) return;   
                openLibraryDemo(row);
            });
            row.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openLibraryDemo(row); }
            });
            row.querySelector('.demo-row-del').addEventListener('click', e => {
                e.stopPropagation(); deleteLibraryDemo(row);
            });

            libList.appendChild(row);
        });
    }

    async function loadLibrary() {
        try {
            const res = await fetch('/api/demo/library').then(r => r.json());
            renderLibrary((res && res.library) || []);
        } catch {
            libList.innerHTML = '<div class="demo-empty">Could not reach the backend.</div>';
            libCount.textContent = '';
        }
    }

    async function openLibraryDemo(row) {
        if (row.classList.contains('busy')) return;
        const key = row.dataset.key;
        if (!key) return;
        row.classList.add('busy');
        try {
            const data = await fetch('/api/demo/data/' + encodeURIComponent(key)).then(r => r.json());
            openViewer(data);   
        } catch {
            if (window.showToast) showToast('Could not open this demo.', 'error');
        } finally {
            row.classList.remove('busy');
        }
    }

    async function deleteLibraryDemo(row) {
        const key = row.dataset.key;
        if (!key) return;
        row.classList.add('busy');
        try {
            await fetch('/api/demo/library/' + encodeURIComponent(key), { method: 'DELETE' });
            row.remove();
            if (!libList.querySelector('.demo-row')) { libList.innerHTML = libEmptyHtml(); }
            const n = libList.querySelectorAll('.demo-row').length;
            libCount.textContent = n ? n + (n === 1 ? ' demo' : ' demos') : '';
        } catch {
            row.classList.remove('busy');
            if (window.showToast) showToast('Could not delete this demo.', 'error');
        }
    }

    function initPicker() {
        loadLibrary();
        refreshQueue().then(active => { if (active) startQueuePoll(); });
    }
    initPicker();

    function openViewer(data) {
        voiceStopAll(); for (const k in voiceAudios) delete voiceAudios[k];
        D = data;
        view = { zoom: 1, ox: 0, oy: 0 }; canvas.style.cursor = '';
        radar = null; lowerRadar = null;
        setDrawMode(false); clearDraw();
        resizeCanvas();
        canvas.title = 'Scroll: zoom · drag: pan · Space: play/pause · ←/→: round · [ ]: kill · , .: frame · F: fullscreen · click a player when paused: copy setpos';

        elMap.textContent = (D.map || '').replace(/^de_/, '').toUpperCase();
        setMapThumb(elMapThumb, D.map);
        picker.style.display = 'none';
        viewer.style.display = '';

        radar = new Image();
        radar.onload = () => draw(cur);
        radar.onerror = () => { radar = null; draw(cur); };
        radar.src = '/static/radars/' + D.map + '.png';

        level = 0;
        if (D.hasLower) {
            lowerRadar = new Image();
            lowerRadar.onload = () => draw(cur);
            lowerRadar.src = '/static/radars/' + D.map + '_lower.png';
            elFloor.style.display = ''; elFloor.textContent = 'UPPER';
        } else {
            lowerRadar = null; elFloor.style.display = 'none';
        }

        buildRounds();
        buildPlayers();
        buildTimelineMarks();
        focusIdx = null;
        speedIdx = 1; elSpeed.textContent = '1×';
        seekToRound(0);
        refreshLaunchBtn(); startLaunchPoll();
    }

    function refreshLaunchBtn() {
        if (!D || viewer.style.display === 'none') { dvLaunch.style.display = 'none'; return; }
        fetch('/status').then(r => r.json()).then(s => {
            if (s.running) { dvLaunch.style.display = 'none'; }
            else {
                dvLaunch.style.display = ''; dvLaunch.disabled = false;
                dvLaunch.textContent = 'LAUNCH SERVER · ' + (D.map || '').replace(/^de_/, '').toUpperCase();
            }
        }).catch(() => {});
    }
    function startLaunchPoll() { stopLaunchPoll(); launchPoll = setInterval(refreshLaunchBtn, 3000); }
    function stopLaunchPoll() { if (launchPoll) { clearInterval(launchPoll); launchPoll = null; } }
    dvLaunch.addEventListener('click', () => {
        if (!D) return;
        dvLaunch.disabled = true; dvLaunch.textContent = 'STARTING…';
        fetch('/launch', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                           body: JSON.stringify({ map: D.map }) })
            .then(r => r.json()).then(r => {
                if (window.showToast) showToast(r.ok ? ('Launching on ' + D.map) : (r.message || 'Launch failed'),
                                                r.ok ? 'success' : 'error');
                setTimeout(refreshLaunchBtn, 1500);
            }).catch(() => { if (window.showToast) showToast('Could not reach backend', 'error'); refreshLaunchBtn(); });
    });

    $('dvBack').addEventListener('click', () => {
        pause(); stopLaunchPoll(); dvLaunch.style.display = 'none';
        viewer.style.display = 'none'; picker.style.display = '';
        initPicker();   
    });
    elFloor.addEventListener('click', () => { level ^= 1; elFloor.textContent = level ? 'LOWER' : 'UPPER'; draw(cur); });

    function resizeCanvas() {
        dpr = window.devicePixelRatio || 1;
        let s = (document.fullscreenElement === viewer)
            ? Math.min(stage.clientWidth, stage.clientHeight) : 660;
        if (!s || s < 100) s = 660;
        cssSize = s;
        canvas.style.width = s + 'px'; canvas.style.height = s + 'px';
        canvas.width = s * dpr; canvas.height = s * dpr;
        sizeDraw();
        if (D) { SC = cssSize / D.radarSize; clampView(); draw(cur); }
    }
    function toggleFullscreen() {
        if (document.fullscreenElement === viewer) { if (document.exitFullscreen) document.exitFullscreen(); }
        else if (viewer.requestFullscreen) viewer.requestFullscreen();
    }
    $('dvFs').addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', () => { resizeCanvas(); setTimeout(resizeCanvas, 60); });
    window.addEventListener('resize', () => { if (D) resizeCanvas(); });

    function clampView() {
        if (view.zoom <= 1.0001) { view.zoom = 1; view.ox = 0; view.oy = 0; return; }
        const min = cssSize - cssSize * view.zoom;  
        view.ox = Math.min(0, Math.max(min, view.ox));
        view.oy = Math.min(0, Math.max(min, view.oy));
    }
    canvas.addEventListener('wheel', e => {
        if (!D) return;
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const old = view.zoom;
        const z = Math.min(MAXZOOM, Math.max(1, old * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        const wx = (mx - view.ox) / old, wy = (my - view.oy) / old;   
        view.zoom = z; view.ox = mx - wx * z; view.oy = my - wy * z;
        clampView();
        canvas.style.cursor = view.zoom > 1 ? 'grab' : '';
        draw(cur);
    }, { passive: false });
    let pressXY = null, pressMoved = false;
    canvas.addEventListener('mousedown', e => {
        pressXY = [e.clientX, e.clientY]; pressMoved = false;
        if (view.zoom > 1) { panning = true; panLast = [e.clientX, e.clientY]; canvas.style.cursor = 'grabbing'; }
    });
    window.addEventListener('mousemove', e => {
        if (pressXY && Math.abs(e.clientX - pressXY[0]) + Math.abs(e.clientY - pressXY[1]) > 4) pressMoved = true;
        if (!panning) return;
        view.ox += e.clientX - panLast[0]; view.oy += e.clientY - panLast[1];
        panLast = [e.clientX, e.clientY]; clampView(); draw(cur);
    });
    window.addEventListener('mouseup', () => { if (panning) { panning = false; canvas.style.cursor = view.zoom > 1 ? 'grab' : ''; } });

    drawCv = $('dvDraw'); dctx = drawCv && drawCv.getContext('2d'); drawBadge = $('dvDrawBadge');
    const pencilOn = () => localStorage.getItem('cs2prak_pencil') === '1';
    function sizeDraw() {
        if (!drawCv) return;
        drawCv.width = canvas.width; drawCv.height = canvas.height;
        dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        dctx.lineCap = 'round'; dctx.lineJoin = 'round';
        redrawStrokes();
    }
    function setDrawMode(on) {
        drawMode = !!on && pencilOn();
        if (drawCv) drawCv.classList.toggle('is-drawing', drawMode);
        if (drawBadge) drawBadge.hidden = !drawMode;
    }
    function clearDraw() { strokes = []; redrawStrokes(); }
    
    function redrawStrokes() {
        if (!dctx) return;
        dctx.clearRect(0, 0, cssSize, cssSize);
        dctx.strokeStyle = '#ff4d4d'; dctx.lineWidth = 3;
        for (const s of strokes) {
            if (!s.length) continue;
            dctx.beginPath();
            for (let i = 0; i < s.length; i++) {
                const x = view.ox + view.zoom * (s[i][0] * SC), y = view.oy + view.zoom * (s[i][1] * SC);
                i ? dctx.lineTo(x, y) : dctx.moveTo(x, y);
            }
            if (s.length === 1) {
                const x = view.ox + view.zoom * (s[0][0] * SC), y = view.oy + view.zoom * (s[0][1] * SC);
                dctx.lineTo(x + 0.01, y);
            }
            dctx.stroke();
        }
    }
    if (drawCv) {
        const toRadar = e => {                              
            const r = drawCv.getBoundingClientRect();
            const cx = (e.clientX - r.left) * (cssSize / r.width);
            const cy = (e.clientY - r.top) * (cssSize / r.height);
            return [((cx - view.ox) / view.zoom) / SC, ((cy - view.oy) / view.zoom) / SC];
        };
        drawCv.addEventListener('mousedown', e => {
            if (!drawMode) return;
            e.preventDefault(); drawingNow = true;
            strokes.push([toRadar(e)]); redrawStrokes();
        });
        drawCv.addEventListener('mousemove', e => {
            if (!drawMode || !drawingNow || !strokes.length) return;
            strokes[strokes.length - 1].push(toRadar(e)); redrawStrokes();
        });
        window.addEventListener('mouseup', () => { drawingNow = false; });
    }

    function playerAtClient(clientX, clientY) {
        if (!D) return -1;
        const rect = canvas.getBoundingClientRect();
        const mx = (clientX - rect.left) * (cssSize / rect.width);
        const my = (clientY - rect.top)  * (cssSize / rect.height);
        const wx = (mx - view.ox) / view.zoom;          
        const wy = (my - view.oy) / view.zoom;
        const fr = D.frames[Math.min(D.nFrames - 1, Math.max(0, Math.round(cur)))];
        let best = -1, bestD = 16 * 16;                 
        for (let i = 0; i < 10; i++) {
            const e = fr[i];
            if (!e || !e[5]) continue;                  
            if (D.hasLower && e[6] !== level) continue; 
            const dx = e[0] * SC - wx, dy = e[1] * SC - wy, d2 = dx * dx + dy * dy;
            if (d2 < bestD) { bestD = d2; best = i; }
        }
        return best;
    }
    function copyPlayerSetpos(idx) {
        const fr = D.frames[Math.min(D.nFrames - 1, Math.max(0, Math.round(cur)))];
        const e = fr[idx]; if (!e) return;
        const x = Math.round(e[0] * D.scale + D.posX);  
        const y = Math.round(D.posY - e[1] * D.scale);
        const z = e[8] | 0, pitch = e[9] | 0, yaw = Math.round(e[2]);
        const cmd = `setpos ${x} ${y} ${z};setang ${pitch} ${yaw} 0`;
        const note = (m, t) => { if (typeof showToast === 'function') showToast(m, t); };
        const done = () => note(nameOf(idx) + ' → setpos copied', 'success');
        if (navigator.clipboard && navigator.clipboard.writeText)
            navigator.clipboard.writeText(cmd).then(done, () => note(cmd, 'info'));
        else note(cmd, 'info');
    }
    canvas.addEventListener('click', e => {
        if (pressMoved || playing) return;              
        const idx = playerAtClient(e.clientX, e.clientY);
        if (idx >= 0) copyPlayerSetpos(idx);
    });
    canvas.addEventListener('mousemove', e => {         
        if (panning || playing || view.zoom > 1) return;
        canvas.style.cursor = playerAtClient(e.clientX, e.clientY) >= 0 ? 'pointer' : '';
    });

    function buildRounds() {
        elRounds.innerHTML = '';
        D.rounds.forEach((r, i) => {
            const b = document.createElement('button');
            b.className = 'dv-round' + (r.wside ? (r.wside === 'CT' ? ' win-ct' : ' win-t') : '');
            b.textContent = r.n;
            b.addEventListener('click', () => { seekToRound(i); if (elRoundsPop) elRoundsPop.classList.remove('open'); });
            elRounds.appendChild(b);
        });
    }

    function roundAt(frame) {
        let idx = 0;
        for (let i = 0; i < D.rounds.length; i++) if (frame >= D.rounds[i].start) idx = i;
        return idx;
    }

    const KILL_ICON = {
        ak47: 'ak47', aug: 'aug', awp: 'awp', deagle: 'deserteagle', elite: 'dualberettas',
        famas: 'famas', fiveseven: 'fiveseven', glock: 'glock18', g3sg1: 'g3sg1', galilar: 'galilar',
        m249: 'm249', m4a1: 'm4a4', m4a1_silencer: 'm4a1s', mac10: 'mac10', p90: 'p90', mp5sd: 'mp5sd',
        ump45: 'ump45', xm1014: 'xm1014', bizon: 'ppbizon', mag7: 'mag7', negev: 'negev', sawedoff: 'sawedoff',
        tec9: 'tec9', taser: 'zeusx27', hkp2000: 'p2000', mp7: 'mp7', mp9: 'mp9', nova: 'nova', p250: 'p250',
        scar20: 'scar20', sg556: 'sg553', ssg08: 'ssg08', cz75a: 'cz75auto', usp_silencer: 'usps',
        revolver: 'r8revolver', hegrenade: 'highexplosivegrenade', molotov: 'molotov',
        incgrenade: 'incendiarygrenade', inferno: 'molotov', decoy: 'decoygrenade', c4: 'c4explosive'
    };
    const killIcon = w => {
        let n = String(w).replace('weapon_', '').replace(/_off$/, '');   
        if (n === 'planted_c4' || n === 'c4') return 'c4explosive';
        return KILL_ICON[n] || 'knife';
    };
    function renderKills() {
        const r = D.rounds[curRound];
        const ks = D.kills.filter(k => k.f >= r.start && k.f <= r.end);
        if (!ks.length) { elKills.innerHTML = '<div class="dv-kills-empty">No kills this round.</div>'; return; }
        elKills.innerHTML = '';
        ks.forEach(k => {
            const row = document.createElement('div');
            row.className = 'dv-kill' + (k.f <= cur ? ' past' : '');
            row.dataset.f = k.f;
            const aTeam = teamOf(k.a, k.f), vTeam = teamOf(k.v, k.f), sl = killIcon(k.w);
            row.innerHTML =
                `<span class="dv-kill-a ${aTeam}">${nameOf(k.a)}</span>` +
                `<span class="dv-kill-w" style="-webkit-mask-image:url(/static/weapon_icons/${sl}.png);` +
                `mask-image:url(/static/weapon_icons/${sl}.png)"></span>` +
                (k.hs ? '<span class="dv-kill-hs" title="headshot"></span>' : '') +
                `<span class="dv-kill-v ${vTeam}">${nameOf(k.v)}</span>`;
            row.addEventListener('click', () => { seek(k.f); });
            elKills.appendChild(row);
        });
    }

    function markPastKills() {
        elKills.querySelectorAll('.dv-kill').forEach(el => {
            el.classList.toggle('past', (+el.dataset.f) <= cur);
        });
    }

    const NADE_LBL  = { smoke: 'Smoke', he: 'HE', flash: 'Flash', molotov: 'Molotov', decoy: 'Decoy' };
    const NADE_ICON = { smoke: 'smokegrenade', he: 'highexplosivegrenade', flash: 'flashbang',
                        molotov: 'molotov', decoy: 'decoygrenade' };
    function nadeTime(throwF) {
        const r = D.rounds[curRound];
        let s = Math.max(0, Math.round(ROUND_TIME - (throwF - r.freeze) / D.fps));
        return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }
    function renderNades() {
        const r = D.rounds[curRound];
        const ns = (D.flights || []).map((f, i) => ({ f, i }))
            .filter(o => o.f.sp && o.f.p[0][0] >= r.start && o.f.p[0][0] <= r.end)
            .sort((a, b) => a.f.p[0][0] - b.f.p[0][0]);
        if (!ns.length) { elNades.innerHTML = '<div class="dv-kills-empty">No nades this round.</div>'; return; }
        elNades.innerHTML = '';
        for (const o of ns) {
            const f = o.f, tf = f.p[0][0], col = FLY_COL[f.t] || '#fff';
            const sl = NADE_ICON[f.t] || 'smokegrenade';
            const row = document.createElement('div');
            row.className = 'dv-nade' + (tf <= cur ? ' past' : '');
            row.dataset.f = tf;
            row.innerHTML =
                `<span class="dv-nade-ic" style="-webkit-mask-image:url(/static/weapon_icons/${sl}.png);` +
                `mask-image:url(/static/weapon_icons/${sl}.png);background:${col}"></span>` +
                `<span class="dv-nade-by">${f.by || '?'}</span>` +
                `<span class="dv-nade-t">${NADE_LBL[f.t] || f.t}</span>` +
                `<span class="dv-nade-time">${nadeTime(tf)}</span>`;
            row.addEventListener('click', () => openNade(o.i));
            elNades.appendChild(row);
        }
    }
    function markPastNades() {
        elNades.querySelectorAll('.dv-nade').forEach(el => el.classList.toggle('past', (+el.dataset.f) <= cur));
    }
    let nadeSel = null;
    function openNade(i) {
        const f = D.flights[i];
        if (!f || !f.sp) return;
        nadeSel = f;
        pause();
        seek(f.p[0][0]);
        nadeTitle.textContent = (NADE_LBL[f.t] || f.t) + ' — ' + (f.by || '?');
        nadePos.textContent = f.sp.join(' ');
        nadeAng.textContent = f.sa.join(' ') + ' 0';
        nadeNote.textContent = '';
        nadePop.style.display = '';
    }
    function closeNade() { nadePop.style.display = 'none'; nadeSel = null; }
    $('dvNadeClose').addEventListener('click', closeNade);
    nadePop.addEventListener('click', e => { if (e.target === nadePop) closeNade(); });
    $('dvNadeCopy').addEventListener('click', () => {
        if (!nadeSel) return;
        const cmd = `setpos ${nadeSel.sp.join(' ')};setang ${nadeSel.sa.join(' ')} 0`;
        navigator.clipboard.writeText(cmd).then(
            () => { nadeNote.textContent = 'Copied to clipboard'; },
            () => { nadeNote.textContent = cmd; });
    });
    $('dvNadeExport').addEventListener('click', () => {
        if (!nadeSel) return;
        nadeNote.textContent = 'Exporting…';
        fetch('/api/demo/nade-export', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sp: nadeSel.sp, sa: nadeSel.sa })
        }).then(r => r.json()).then(j => {
            nadeNote.textContent = j.ok ? 'Saved expNade.cfg — run  exec expNade  in game'
                                        : ('Error: ' + (j.message || 'failed'));
        }).catch(() => { nadeNote.textContent = 'Export failed'; });
    });

    const gearBtn = $('dvGear'), settingsEl = $('dvSettings');
    function setSettings(open) {
        gearBtn.classList.toggle('open', open);
        settingsEl.classList.toggle('open', open);
        gearBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        settingsEl.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    gearBtn.addEventListener('click', e => { e.stopPropagation(); setSettings(!settingsEl.classList.contains('open')); });
    settingsEl.addEventListener('click', e => e.stopPropagation());          
    document.addEventListener('click', () => setSettings(false));            
    document.addEventListener('keydown', e => { if (e.key === 'Escape') setSettings(false); });

    function wireToggle(id, set) {
        $(id).addEventListener('change', e => { set(e.currentTarget.checked); draw(cur); });
    }
    wireToggle('dvTgNames',  v => { showNames   = v; });
    wireToggle('dvTgHp',     v => { showHp      = v; });
    wireToggle('dvTgTracer', v => { showTracers = v; });
    wireToggle('dvTgVoiceList', v => { showVoiceList = v; });

    const voiceSeg = $('dvTgVoice'), voiceBtns = voiceSeg.querySelectorAll('.dv-seg-btn');
    voiceSeg.addEventListener('click', e => {
        const btn = e.target.closest('.dv-seg-btn');
        if (!btn) return;
        voiceMode = +btn.dataset.voice;
        voiceBtns.forEach(b => {
            const on = b === btn;
            b.classList.toggle('on', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        if (voiceMode === 0) voiceStopAll();
    });
    function voiceWant(u) {
        if (voiceMode === 0 || !playing) return false;
        if (voiceMode === 2 && u.side !== 1) return false;     
        if (voiceMode === 3 && u.side !== 0) return false;     
        return cur >= u.f && cur < u.f + u.dur * D.fps;
    }
    function voiceTick() {
        if (!D || !D.voice || !D.voice.length || voiceMode === 0) return;
        for (const u of D.voice) {
            const want = voiceWant(u);
            let a = voiceAudios[u.n];
            if (want) {
                if (!a) { a = new Audio('/api/demo/voice/' + D.key + '/' + u.n + '.wav'); voiceAudios[u.n] = a; }
                a.playbackRate = SPEEDS[speedIdx];
                if (a.paused) { try { a.currentTime = Math.max(0, (cur - u.f) / D.fps); } catch (e) {} a.play().catch(() => {}); }
            } else if (a && !a.paused) { a.pause(); }
        }
    }
    function voiceStopAll() { for (const k in voiceAudios) { try { voiceAudios[k].pause(); } catch (e) {} } }

    const nameOf = i => (i == null || !D.players[i]) ? '?' : D.players[i].name;
    function teamOf(i, frame) {
        if (i == null) return '';
        const e = D.frames[Math.min(D.nFrames - 1, Math.max(0, frame))][i];
        return e ? (e[4] === 1 ? 'ct' : 't') : '';
    }
    function teamSide(team) {                 
        const fr = D.frames[Math.min(D.nFrames - 1, Math.max(0, Math.floor(cur)))];
        for (const i of team) if (fr[i]) return fr[i][4];
        return team === D.teamA ? 1 : 0;
    }

    function buildPlayers() {
        elPlayers.innerHTML = ''; plRows = {}; lastInvSig = {};
        const make = idx => {
            const row = document.createElement('div');
            row.className = 'dv-pl'; row.dataset.idx = idx;
            row.innerHTML =
                '<span class="dv-pl-hpbar"><i></i></span>' +
                '<span class="dv-pl-name"></span>' +
                '<span class="dv-pl-kda"></span>' +
                '<span class="dv-pl-ics"></span>' +
                '<span class="dv-pl-gear"></span>' +
                '<span class="dv-pl-money"></span>';
            row.addEventListener('click', () => {
                focusIdx = focusIdx === idx ? null : idx;
                if (focusIdx !== null && D.hasLower) {       
                    const e = D.frames[Math.floor(cur)][idx];
                    if (e) { level = e[6]; elFloor.textContent = level ? 'LOWER' : 'UPPER'; }
                }
                updatePlayers(Math.floor(cur)); draw(cur);
            });
            elPlayers.appendChild(row); plRows[idx] = row;
        };
        (D.teamA || []).forEach(make);
        const div = document.createElement('div'); div.className = 'dv-pl-div'; elPlayers.appendChild(div);
        (D.teamB || []).forEach(make);
    }
    function invAt(idx, f) {                     
        const arr = D.inv[idx] || D.inv[String(idx)] || [];
        let res = [];
        for (let i = 0; i < arr.length; i++) { if (arr[i][0] <= f) res = arr[i][1]; else break; }
        return res;
    }
    function renderPlayerIcons(idx, widxs) {
        const names = widxs.map(w => D.weapons[w]).filter(Boolean).sort((a, b) => wepRank(a) - wepRank(b));
        const ics = plRows[idx].querySelector('.dv-pl-ics');
        ics.innerHTML = '';
        for (const it of names) {
            const sl = wepIcon(it);
            if (!sl) continue;
            const im = document.createElement('span');
            im.className = 'dv-pl-ic';
            const u = 'url(/static/weapon_icons/' + sl + '.png)';
            im.style.webkitMaskImage = u; im.style.maskImage = u;
            im.title = it; im.dataset.slug = sl;
            ics.appendChild(im);
        }
    }
    function teamBestWorst(K, De, As) {          
        const best = new Set(), worst = new Set();
        for (const team of [D.teamA, D.teamB]) {
            if (!team || !team.length) continue;
            let bi = null, wi = null, bs = -1e9, ws = 1e9;
            for (const i of team) {
                const s = K[i] - De[i] + As[i] * 0.5;
                if (s > bs) { bs = s; bi = i; }
                if (s < ws) { ws = s; wi = i; }
            }
            if (bs !== ws) { best.add(bi); worst.add(wi); }
        }
        return { best, worst };
    }
    function updatePlayers(frame) {
        const fr = D.frames[Math.min(D.nFrames - 1, Math.max(0, frame))];
        const ec = (D.econ && (D.econ[curRound] || D.econ[String(curRound)])) || {};
        const cf = Math.floor(cur), K = Array(10).fill(0), De = Array(10).fill(0), As = Array(10).fill(0);
        for (const k of D.kills) {
            if (k.f > cf) continue;
            if (k.a != null) K[k.a]++;
            if (k.v != null) De[k.v]++;
            if (k.as != null) As[k.as]++;
        }
        const bw = teamBestWorst(K, De, As);
        for (const idx in plRows) {
            const e = fr[idx], row = plRows[idx], ii = +idx;
            const econ = ec[idx] || ec[String(idx)] || [0, 0, 0, 0, 0];
            const alive = e ? e[5] : 0;
            const side = e ? e[4] : (D.teamA.indexOf(ii) >= 0 ? 1 : 0);
            row.className = 'dv-pl ' + (side === 1 ? 'ct' : 't') + (alive ? '' : ' dead') + (ii === focusIdx ? ' focus' : '');
            row.querySelector('.dv-pl-hpbar i').style.width = (alive ? e[3] : 0) + '%';
            row.querySelector('.dv-pl-name').textContent = D.players[idx].name;
            const kel = row.querySelector('.dv-pl-kda');
            kel.textContent = K[ii] + '/' + De[ii] + '/' + As[ii];
            kel.className = 'dv-pl-kda' + (bw.best.has(ii) ? ' best' : '') + (bw.worst.has(ii) ? ' worst' : '');
            row.querySelector('.dv-pl-money').textContent = '$' + econ[0];
            let gh = '';
            if (econ[1] > 0) {                        
                const team = side === 1 ? 'ct' : 't';
                const kind = econ[2] ? 'full' : 'half';
                gh += '<span class="dv-pl-armor ' + team + ' ' + kind + '"'
                    + ' title="' + (econ[2] ? 'Kevlar + Helmet' : 'Kevlar') + '"></span>';
            }
            if (econ[3]) gh += '<span class="dv-pl-defuse" title="Defuse kit"></span>';
            row.querySelector('.dv-pl-gear').innerHTML = gh;
            
            const widxs = invAt(ii, cf), sig = widxs.join(',');
            if (lastInvSig[idx] !== sig) { renderPlayerIcons(idx, widxs); lastInvSig[idx] = sig; }
            const aslug = (alive && e[7] >= 0) ? wepIcon(D.weapons[e[7]]) : null;
            row.querySelectorAll('.dv-pl-ic').forEach(im => im.classList.toggle('on', im.dataset.slug === aslug));
        }
    }

    function buildTimelineMarks() {
        tlRounds.innerHTML = ''; tlKills.innerHTML = '';
        D.rounds.forEach(r => {
            const m = document.createElement('div');
            m.className = 'dv-tl-rmark'; m.style.left = (100 * r.start / D.nFrames) + '%';
            tlRounds.appendChild(m);
        });
        D.kills.forEach(k => {
            const m = document.createElement('div');
            m.className = 'dv-tl-kmark'; m.style.left = (100 * k.f / D.nFrames) + '%';
            tlKills.appendChild(m);
        });
    }

    function tlSeek(clientX) {
        const r = tl.getBoundingClientRect();
        const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
        seek(p * (D.nFrames - 1));
    }
    tl.addEventListener('mousedown', e => { scrubbing = true; pause(); tlSeek(e.clientX); });
    window.addEventListener('mousemove', e => { if (scrubbing) tlSeek(e.clientX); });
    window.addEventListener('mouseup', () => { scrubbing = false; });

    function setPlayIcon() {
        elPlay.innerHTML = playing
            ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/></svg>'
            : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    }
    function play() { if (playing || !D) return; if (cur >= D.nFrames - 1) cur = 0; playing = true; lastTs = performance.now(); setPlayIcon(); raf = requestAnimationFrame(loop); }
    function pause() { playing = false; setPlayIcon(); if (raf) cancelAnimationFrame(raf); voiceStopAll(); }
    elPlay.addEventListener('click', () => playing ? pause() : play());
    elSpeed.addEventListener('click', () => { speedIdx = (speedIdx + 1) % SPEEDS.length; elSpeed.textContent = SPEEDS[speedIdx] + '×'; });
    $('dvPrevRound').addEventListener('click', () => seekToRound(Math.max(0, roundAt(Math.floor(cur)) - 1)));
    $('dvNextRound').addEventListener('click', () => seekToRound(Math.min(D.rounds.length - 1, roundAt(Math.floor(cur)) + 1)));
    $('dvSkipBuy').addEventListener('click', () => { const r = D.rounds[roundAt(Math.floor(cur))]; if (r) seek(r.freeze); });

    function loop(ts) {
        const dt = (ts - lastTs) / 1000; lastTs = ts;
        cur += dt * D.fps * SPEEDS[speedIdx];
        if (cur >= D.nFrames - 1) { cur = D.nFrames - 1; draw(cur); updateHud(); pause(); return; }
        draw(cur); updateHud(); voiceTick();
        raf = requestAnimationFrame(loop);
    }

    function seek(frame) {
        cur = Math.min(D.nFrames - 1, Math.max(0, frame));
        voiceStopAll();
        draw(cur); updateHud();
    }
    function seekToRound(i) {
        curRound = i; cur = D.rounds[i].start;
        renderKills(); renderNades(); draw(cur); updateHud();
    }
    function step(d) { pause(); seek(Math.round(cur) + d); }
    function jumpKill(dir) {                    
        pause();
        const fs = D.kills.map(k => k.f).sort((a, b) => a - b), c = Math.floor(cur);
        let t = null;
        if (dir > 0) t = fs.find(f => f > c + 1);
        else { const b = fs.filter(f => f < c - 1); t = b.length ? b[b.length - 1] : null; }
        if (t != null) seek(t);
    }

    function updateHud() {
        const ri = roundAt(Math.floor(cur));
        if (ri !== curRound) { curRound = ri; renderKills(); renderNades(); }
        elRoundTag.textContent = 'ROUND ' + D.rounds[ri].n;
        [...elRounds.children].forEach((b, i) => b.classList.toggle('active', i === ri));
        
        const r = D.rounds[ri], bs = bombState(Math.floor(cur));
        let secs, buy = false;
        if (cur < r.freeze) { secs = (r.freeze - cur) / D.fps; buy = true; }
        else if (bs) { secs = 40 - (cur - bs.f) / D.fps; }
        else { secs = ROUND_TIME - (cur - r.freeze) / D.fps; }
        secs = Math.max(0, Math.ceil(secs));
        elClock.textContent = Math.floor(secs / 60) + ':' + String(secs % 60).padStart(2, '0');
        elClock.classList.toggle('bomb', !!bs && !buy);
        elClock.classList.toggle('buy', buy);
        
        const prev = ri > 0 ? D.rounds[ri - 1] : null;
        const sA = prev ? (prev.sa || 0) : 0, sB = prev ? (prev.sb || 0) : 0;
        elScore.innerHTML = '<b class="' + (teamSide(D.teamA) === 1 ? 'ct' : 't') + '">' + sA + '</b>'
                          + '<i>:</i><b class="' + (teamSide(D.teamB) === 1 ? 'ct' : 't') + '">' + sB + '</b>';
        const pct = 100 * cur / (D.nFrames - 1);
        tlFill.style.width = pct + '%'; tlHead.style.left = pct + '%';
        if (elBombTag) elBombTag.style.display = 'none';     
        markPastKills(); markPastNades();
        updatePlayers(Math.floor(cur));
    }

    function bombState(frame) {
        const r = D.rounds[curRound]; if (!r) return null;
        let planted = null;
        for (const b of D.bomb) {
            if (b.f < r.start || b.f > r.end || b.f > frame) continue;
            if (b.k === 'plant') planted = b;
            else planted = null;     
        }
        return planted;
    }

    const lerp = (a, b, t) => a + (b - a) * t;
    function lerpAngle(a, b, t) { let d = ((b - a + 540) % 360) - 180; return a + d * t; }

    function draw(f) {
        if (!D) return;
        
        if (focusIdx !== null && view.zoom > 1) {
            const e = D.frames[Math.min(D.nFrames - 1, Math.max(0, Math.round(f)))][focusIdx];
            if (e) { view.ox = cssSize / 2 - e[0] * SC * view.zoom; view.oy = cssSize / 2 - e[1] * SC * view.zoom; clampView(); }
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssSize, cssSize);
        ctx.save();
        ctx.translate(view.ox, view.oy); ctx.scale(view.zoom, view.zoom);

        const img = (level === 1 && lowerRadar && lowerRadar.complete) ? lowerRadar : radar;
        if (img) ctx.drawImage(img, 0, 0, cssSize, cssSize);
        else { ctx.fillStyle = '#14130f'; ctx.fillRect(0, 0, cssSize, cssSize); }

        const f0 = Math.floor(f), f1 = Math.min(f0 + 1, D.nFrames - 1), tt = f - f0;

        const active = (arr) => arr && arr.some(g => f0 >= g.f && f0 <= g.end);
        if (active(D.smokes)) maskedLayer(c => drawSmokes(f0, c));
        if (active(D.molotovs)) maskedLayer(c => drawMolotovs(f0, c));
        drawGroundUtility(f); drawHits(f); drawShots(f); drawFlights(f); drawKills(f0);
        const bomb = bombState(f0); if (bomb) drawBomb(bomb);

        for (let i = 0; i < 10; i++) {
            const a = D.frames[f0][i], b = D.frames[f1][i];
            const e = a || b; if (!e) continue;
            let x = e[0], y = e[1], yaw = e[2];
            if (a && b && a[5] && b[5]) { x = lerp(a[0], b[0], tt); y = lerp(a[1], b[1], tt); yaw = lerpAngle(a[2], b[2], tt); }
            if (D.hasLower && e[6] !== level) {     
                ctx.beginPath(); ctx.arc(x * SC, y * SC, 3, 0, 7);
                ctx.fillStyle = e[4] === 1 ? 'rgba(91,155,213,0.28)' : 'rgba(255,106,31,0.28)';
                ctx.fill();
                continue;
            }
            drawPlayer(x * SC, y * SC, yaw, e[4], e[5], e[3], i);
            if (i === focusIdx && e[5]) {
                ctx.beginPath(); ctx.arc(x * SC, y * SC, 11, 0, 7);
                ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
            }
        }
        ctx.restore();
        drawVoiceList(f);              
        if (drawCv) redrawStrokes();   
    }

    function drawVoiceList(f) {
        if (!showVoiceList || !D.voice || !D.voice.length) return;
        const seen = new Set(), rows = [];
        for (const u of D.voice) {
            if (f >= u.f && f < u.f + u.dur * D.fps && !seen.has(u.idx)) {
                seen.add(u.idx); rows.push(u);
            }
        }
        if (!rows.length) return;
        ctx.save();
        ctx.font = '11px "IBM Plex Mono", monospace';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        let yy = 10;
        for (const u of rows) {
            const nm = (D.players[u.idx] && D.players[u.idx].name) || '?';
            const col = TEAM[u.side] || '#fff';
            const w = ctx.measureText(nm).width;
            ctx.fillStyle = 'rgba(8,8,6,0.62)';
            ctx.fillRect(6, yy, 26 + w, 16);
            
            if (micImg.complete && micImg.naturalWidth)
                ctx.drawImage(micImg, 9, yy + 2, 12, 12);
            ctx.fillStyle = col; ctx.fillText(nm, 25, yy + 9);
            yy += 18;
        }
        ctx.restore();
    }

    function drawKills(f0) {
        for (const k of D.kills) {
            const dt = f0 - k.f; if (dt < 0 || dt > D.fps * 1.5) continue;
            const v = k.v != null ? D.frames[k.f][k.v] : null; if (!v) continue;
            const px = v[0] * SC, py = v[1] * SC, a = 1 - dt / (D.fps * 1.5);
            ctx.strokeStyle = 'rgba(213,106,90,' + a + ')'; ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px - 4, py - 4); ctx.lineTo(px + 4, py + 4);
            ctx.moveTo(px + 4, py - 4); ctx.lineTo(px - 4, py + 4); ctx.stroke();
        }
    }

    function drawShots(f) {                         
        if (!showTracers) return;
        for (const s of D.shots || []) {
            const dt = f - s[0];
            if (dt < 0 || dt > 1.6) continue;
            const e = D.frames[Math.min(D.nFrames - 1, s[0])][s[1]];
            if (!e || !e[5]) continue;
            if (D.hasLower && e[6] !== level) continue;
            const px = e[0] * SC, py = e[1] * SC, ang = -e[2] * Math.PI / 180;
            const L = 260, ex = px + Math.cos(ang) * L, ey = py + Math.sin(ang) * L;
            const a = 0.55 * (1 - dt / 1.6);
            const grad = ctx.createLinearGradient(px, py, ex, ey);
            grad.addColorStop(0, 'rgba(255,238,150,' + a + ')');
            grad.addColorStop(1, 'rgba(255,238,150,0)');
            ctx.strokeStyle = grad; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
        }
    }
    function blindAt(idx, frame) {                  
        let rem = 0;
        for (const b of D.blinds || []) {
            if (b.i === idx && frame >= b.f && frame <= b.end) rem = Math.max(rem, (b.end - frame) / D.fps);
        }
        return rem;
    }

    function drawFlights(f0) {
        for (const fl of D.flights || []) {
            const p = fl.p, endF = p[p.length - 1][0];
            if (f0 < p[0][0] || f0 > endF + 2) continue;
            const side = fl.tm === 1 ? 'ct' : 't';
            const col = fl.tm == null ? (FLY_COL[fl.t] || '#fff') : TEAM[fl.tm];
            if (f0 <= endF) {                              
                let i = 0; while (i < p.length - 1 && p[i + 1][0] <= f0) i++;
                const a = p[i], b = p[Math.min(i + 1, p.length - 1)];
                const tt = b[0] > a[0] ? (f0 - a[0]) / (b[0] - a[0]) : 0;
                const x = (a[1] + (b[1] - a[1]) * tt) * SC, y = (a[2] + (b[2] - a[2]) * tt) * SC;
                const za = a[3] || 0, zb = b[3] || 0, z = za + (zb - za) * tt;
                
                ctx.save();
                ctx.setLineDash([4, 3]); ctx.strokeStyle = col + '99'; ctx.lineWidth = 1.4;
                ctx.beginPath(); ctx.moveTo(p[0][1] * SC, p[0][2] * SC);
                for (let k = 1; k <= i; k++) ctx.lineTo(p[k][1] * SC, p[k][2] * SC);
                ctx.lineTo(x, y); ctx.stroke();
                ctx.restore();
                
                const s = 12 + Math.max(0, Math.min(1, z / 250)) * 12;
                const ang = Math.atan2(b[2] - a[2], b[1] - a[1]);
                const img = GREN_IMG[fl.t + '_' + side];
                if (img && img.complete && img.naturalWidth) {
                    ctx.save(); ctx.translate(x, y); ctx.rotate(ang + Math.PI / 2);
                    ctx.drawImage(img, -s / 2, -s / 2, s, s); ctx.restore();
                } else {
                    ctx.beginPath(); ctx.arc(x, y, s * 0.2, 0, 7); ctx.fillStyle = col; ctx.fill();
                }
            } else {                                       
                const dt = f0 - endF, ex = p[p.length - 1][1] * SC, ey = p[p.length - 1][2] * SC;
                ctx.beginPath(); ctx.arc(ex, ey, 3 + dt * 5, 0, 7);
                ctx.strokeStyle = col + 'cc'; ctx.lineWidth = 2; ctx.stroke();
            }
        }
    }

    function gAlpha(f0, g, base, fade) {
        return base * Math.max(0, Math.min((f0 - g.f + 1) / fade, (g.end - f0) / fade, 1));
    }

    function gSeed(g) {
        return ((Math.round(g.x) * 73856093) ^ (Math.round(g.y) * 19349663) ^ ((g.f | 0) * 83492791)) >>> 0;
    }
    function gRand(s) {
        let x = s >>> 0;
        return function () {
            x = (x + 0x6D2B79F5) | 0;
            let t = Math.imul(x ^ (x >>> 15), 1 | x);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function maskedLayer(drawFn) {
        if (!scratch || scratch.width !== canvas.width || scratch.height !== canvas.height) {
            scratch = document.createElement('canvas');
            scratch.width = canvas.width; scratch.height = canvas.height;
            sctx = scratch.getContext('2d');
        }
        const mask = (level === 1 && lowerRadar && lowerRadar.complete) ? lowerRadar : radar;
        if (!mask || !mask.complete) { drawFn(ctx); return; }     
        sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        sctx.clearRect(0, 0, cssSize, cssSize);
        drawFn(sctx);
        sctx.globalCompositeOperation = 'destination-in';
        sctx.drawImage(mask, 0, 0, cssSize, cssSize);
        sctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(scratch, 0, 0, cssSize, cssSize);          
    }

    function drawSmokes(f0, c) {
        const baseR = (144 / D.scale) * SC;
        const t = performance.now() / 1000;
        for (const g of D.smokes) {
            if (f0 < g.f || f0 > g.end) continue;
            const grow = Math.min(1, (f0 - g.f) / D.fps / 0.45);     
            const fade = Math.min(1, (g.end - f0) / D.fps / 1.0);    
            const a = 0.62 * fade;
            const r = baseR * (0.55 + 0.45 * grow);
            const cx = g.x * SC, cy = g.y * SC;
            const rnd = gRand(gSeed(g));
            c.save();
            c.beginPath(); c.arc(cx, cy, r, 0, 7); c.clip();        
            let bg = c.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
            bg.addColorStop(0, 'rgba(220,216,208,' + a + ')');
            bg.addColorStop(0.72, 'rgba(206,201,192,' + (a * 0.9) + ')');
            bg.addColorStop(1, 'rgba(198,193,184,0)');
            c.fillStyle = bg; c.fillRect(cx - r, cy - r, r * 2, r * 2);
            for (let i = 0; i < 9; i++) {
                const ang = rnd() * 6.2832, dist = (0.12 + rnd() * 0.72) * r;
                const ph = rnd() * 6.2832, br = (0.30 + rnd() * 0.30) * r;
                const ox = Math.cos(ang + Math.sin(t * 0.5 + ph) * 0.22) * dist;
                const oy = Math.sin(ang + Math.cos(t * 0.45 + ph) * 0.22) * dist;
                const rr = br * (1 + 0.12 * Math.sin(t * 0.9 + ph)) * (0.4 + 0.6 * grow);
                const bx = cx + ox, by = cy + oy, ca = a * (0.45 + rnd() * 0.4);
                let cg = c.createRadialGradient(bx, by, 0, bx, by, rr);
                cg.addColorStop(0, 'rgba(226,222,214,' + ca + ')');
                cg.addColorStop(1, 'rgba(210,205,196,0)');
                c.fillStyle = cg; c.beginPath(); c.arc(bx, by, rr, 0, 7); c.fill();
            }
            c.restore();
        }
    }
    function drawMolotovs(f0, c) {
        const r = (140 / D.scale) * SC;
        const t = performance.now() / 1000;
        for (const g of D.molotovs) {
            if (f0 < g.f || f0 > g.end) continue;
            const grow = Math.min(1, (f0 - g.f) / D.fps / 0.3);      
            const fade = Math.min(1, (g.end - f0) / D.fps / 0.7);    
            const k = grow * fade;
            const cx = g.x * SC, cy = g.y * SC;
            const rnd = gRand(gSeed(g));
            c.save();
            c.beginPath(); c.arc(cx, cy, r, 0, 7); c.clip();
            let bg = c.createRadialGradient(cx, cy, r * 0.08, cx, cy, r);
            bg.addColorStop(0, 'rgba(255,120,40,' + (0.30 * k) + ')');
            bg.addColorStop(1, 'rgba(170,40,10,0)');
            c.fillStyle = bg; c.fillRect(cx - r, cy - r, r * 2, r * 2);
            c.globalCompositeOperation = 'lighter';                 
            for (let i = 0; i < 22; i++) {
                const ang = rnd() * 6.2832, dist = Math.sqrt(rnd()) * r * 0.9;
                const ph = rnd() * 6.2832, base = (0.10 + rnd() * 0.10) * r;
                const flick = 0.5 + 0.5 * Math.sin(t * 7 + ph) + 0.2 * Math.sin(t * 13 + ph * 2);
                const rr = base * (0.6 + 0.7 * Math.max(0, flick)) * k;
                if (rr <= 0.5) continue;
                const fx = cx + Math.cos(ang) * dist, fy = cy + Math.sin(ang) * dist;
                let cg = c.createRadialGradient(fx, fy, 0, fx, fy, rr);
                cg.addColorStop(0, 'rgba(255,232,150,' + (0.9 * k) + ')');
                cg.addColorStop(0.4, 'rgba(255,140,40,' + (0.65 * k) + ')');
                cg.addColorStop(1, 'rgba(190,40,10,0)');
                c.fillStyle = cg; c.beginPath(); c.arc(fx, fy, rr, 0, 7); c.fill();
            }
            c.restore();
        }
    }

    function drawGroundUtility(ff) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '4px "IBM Plex Mono", monospace';
        ctx.lineWidth = 0.6; ctx.strokeStyle = 'rgba(8,8,6,0.6)';
        const timer = (x, y, secs) => {
            if (secs <= 0) return;
            const txt = secs.toFixed(2), cx = x * SC, cy = y * SC;
            ctx.strokeText(txt, cx, cy);
            ctx.fillStyle = secs <= 2 ? '#ff5247' : '#ffffff';
            ctx.fillText(txt, cx, cy);
        };
        for (const g of D.smokes || [])   if (ff >= g.f && ff <= g.end) timer(g.x, g.y, (g.end - ff) / D.fps);
        for (const g of D.molotovs || []) if (ff >= g.f && ff <= g.end) timer(g.x, g.y, (g.end - ff) / D.fps);
        for (const g of D.decoys || []) {
            const e = g.end != null ? g.end : g.f + 15 * D.fps;
            if (ff >= g.f && ff <= e) timer(g.x, g.y, (e - ff) / D.fps);
        }
        ctx.textBaseline = 'alphabetic';
    }
    function drawHits(f) {
        for (const g of D.hes || []) {
            const s = (f - g.f) / D.fps; if (s < 0 || s > 0.55) continue;   
            const p = s / 0.55, cx = g.x * SC, cy = g.y * SC;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            const rr = 6 + p * 34;                                          
            ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7);
            ctx.lineWidth = 3 * (1 - p); ctx.strokeStyle = 'rgba(255,200,110,' + (0.9 * (1 - p)) + ')'; ctx.stroke();
            const cp = Math.max(0, 1 - s / 0.18);                           
            if (cp > 0) {
                let cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
                cg.addColorStop(0, 'rgba(255,240,190,' + (0.95 * cp) + ')');
                cg.addColorStop(0.5, 'rgba(255,150,50,' + (0.6 * cp) + ')');
                cg.addColorStop(1, 'rgba(255,90,20,0)');
                ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, 16, 0, 7); ctx.fill();
            }
            const rnd = gRand(gSeed(g));                                    
            for (let i = 0; i < 8; i++) {
                const ang = rnd() * 6.2832, len = (10 + rnd() * 20) * p;
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(ang) * len * 0.5, cy + Math.sin(ang) * len * 0.5);
                ctx.lineTo(cx + Math.cos(ang) * len, cy + Math.sin(ang) * len);
                ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(255,190,90,' + (0.8 * (1 - p)) + ')'; ctx.stroke();
            }
            ctx.restore();
        }
        for (const g of D.flashes || []) {
            const s = (f - g.f) / D.fps; if (s < 0 || s > 0.5) continue;
            const p = s / 0.5, a = 1 - p, cx = g.x * SC, cy = g.y * SC;
            const rr = 8 + p * 26;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            let cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);       
            cg.addColorStop(0, 'rgba(255,255,255,' + (0.95 * a) + ')');
            cg.addColorStop(0.5, 'rgba(225,235,255,' + (0.55 * a) + ')');
            cg.addColorStop(1, 'rgba(200,220,255,0)');
            ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.fill();
            const cp = Math.max(0, 1 - s / 0.14);                           
            if (cp > 0) {
                ctx.strokeStyle = 'rgba(255,255,255,' + (0.9 * cp) + ')'; ctx.lineWidth = 1.5;
                for (let i = 0; i < 4; i++) {
                    const ang = i * Math.PI / 4 + 0.2, L = rr * 1.4;
                    ctx.beginPath();
                    ctx.moveTo(cx - Math.cos(ang) * L, cy - Math.sin(ang) * L);
                    ctx.lineTo(cx + Math.cos(ang) * L, cy + Math.sin(ang) * L);
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
    }
    function drawBomb(b) {
        let x, y;
        if (b.by != null && D.frames[b.f][b.by]) { x = D.frames[b.f][b.by][0]; y = D.frames[b.f][b.by][1]; }
        else return;
        const px = x * SC, py = y * SC;
        const s = 14 * (1 + 0.16 * Math.sin(performance.now() / 180));   
        if (bombImg.complete && bombImg.naturalWidth) {
            ctx.drawImage(bombImg, px - s / 2, py - s / 2, s, s);
        } else {
            ctx.fillStyle = '#e65048'; ctx.fillRect(px - 4, py - 4, 8, 8);
        }
    }

    function drawPlayer(px, py, yaw, team, alive, hp, idx) {
        if (!alive) {
            ctx.strokeStyle = 'rgba(150,150,150,0.5)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(px - 3, py - 3); ctx.lineTo(px + 3, py + 3);
            ctx.moveTo(px + 3, py - 3); ctx.lineTo(px - 3, py + 3); ctx.stroke();
            return;
        }
        const col = TEAM[team];
        const ang = -yaw * Math.PI / 180;
        
        ctx.save();
        ctx.translate(px, py); ctx.rotate(ang + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -8);       
        ctx.lineTo(5.5, 5);      
        ctx.lineTo(0, 1);        
        ctx.lineTo(-5.5, 5);     
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        ctx.lineJoin = 'round'; ctx.lineWidth = 1.4; ctx.strokeStyle = '#14130f'; ctx.stroke();
        ctx.restore();
        
        const bl = blindAt(idx, cur);
        if (bl > 0.05) {
            ctx.beginPath(); ctx.arc(px, py, 8.5, 0, 7);
            ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.font = 'bold 8px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
            ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(10,10,8,0.85)';
            ctx.strokeText(bl.toFixed(1), px + 9, py - 6);
            ctx.fillStyle = '#fff'; ctx.fillText(bl.toFixed(1), px + 9, py - 6);
        }
        
        if (showNames) {
            const nm = nameOf(idx); const short = nm.length > 9 ? nm.slice(0, 9) : nm;
            ctx.font = '6.3px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
            ctx.lineWidth = 1.8; ctx.strokeStyle = 'rgba(10,10,8,0.85)'; ctx.strokeText(short, px, py - 10);
            ctx.fillStyle = '#f3efe6'; ctx.fillText(short, px, py - 10);
        }
        
        if (showHp) {
            const bw = 16, bh = 3, bx = px - bw / 2, by = py + 9;
            ctx.fillStyle = 'rgba(8,8,6,0.7)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
            ctx.fillStyle = '#46c24f'; ctx.fillRect(bx, by, bw * Math.max(0, hp) / 100, bh);
            ctx.font = '8px "IBM Plex Mono", monospace'; ctx.textAlign = 'left';
            ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(10,10,8,0.85)'; ctx.strokeText(hp, bx + bw + 3, by + bh);
            ctx.fillStyle = '#bfe6bf'; ctx.fillText(hp, bx + bw + 3, by + bh);
        }
    }

    document.addEventListener('keydown', e => {
        if (viewer.style.display === 'none' || !D) return;
        if (e.target.tagName === 'INPUT') return;
        switch (e.code) {
            case 'Space':        e.preventDefault(); playing ? pause() : play(); break;
            case 'ArrowRight':   seekToRound(Math.min(D.rounds.length - 1, roundAt(Math.floor(cur)) + 1)); break;
            case 'ArrowLeft':    seekToRound(Math.max(0, roundAt(Math.floor(cur)) - 1)); break;
            case 'BracketRight': jumpKill(1); break;
            case 'BracketLeft':  jumpKill(-1); break;
            case 'Period':       step(1); break;
            case 'Comma':        step(-1); break;
            case 'KeyF':         toggleFullscreen(); break;
            case 'KeyC':         if (pencilOn()) { e.preventDefault(); setDrawMode(!drawMode); } break;
            case 'KeyZ':         if (pencilOn()) { e.preventDefault(); clearDraw(); } break;
        }
    });
})();

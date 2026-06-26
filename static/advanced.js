(function () {
    'use strict';

    var root = null, inited = false;
    var upId = null, players = [], mapName = '', curSteam = null;
    var advDuels = [], radarMap = '', radarScale = 4.5, radarImg = null, radarImgMap = '', hoverIdx = -1;
    var RADAR = 1024;

    function el(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function shell() {
        root.innerHTML = '' +
            '<header class="stats-head">' +
                '<div class="stats-head-title">' +
                    '<span class="stats-kicker">DUEL LAB</span>' +
                    '<h2 class="stats-h2">Advanced</h2>' +
                '</div>' +
                '<div class="adv-loadwrap">' +
                    '<button class="adv-load" id="advLoadBtn" type="button">LOAD DEMO</button>' +
                    '<input type="file" id="advFile" accept=".dem,.gz,.zst" hidden>' +
                '</div>' +
            '</header>' +
            '<div class="adv-body" id="advBody">' +
                '<div class="adv-drop" id="advDrop">' +
                    '<div class="adv-drop-tick"></div>' +
                    '<div class="adv-drop-title">DROP A .DEM TO ANALYZE</div>' +
                    '<p class="adv-drop-sub">One player’s every duel, tick-accurate — reaction, crosshair ' +
                        'placement, first bullet. Drop a .dem / .dem.zst here, or click LOAD DEMO.</p>' +
                '</div>' +
            '</div>';
        el('advLoadBtn').addEventListener('click', function () { el('advFile').click(); });
        el('advFile').addEventListener('change', function (e) {
            if (e.target.files[0]) upload(e.target.files[0]);
        });
        var drop = el('advDrop');
        ['dragover', 'dragenter'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
        });
        ['dragleave', 'drop'].forEach(function (ev) {
            drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
        });
        drop.addEventListener('drop', function (e) {
            var f = e.dataTransfer.files[0]; if (f) upload(f);
        });
    }

    function backBtn() { return '<button class="adv-load adv-back" id="advBack" type="button">LOAD ANOTHER</button>'; }
    function wireBack() { var b = el('advBack'); if (b) b.addEventListener('click', shell); }

    function upload(file) {
        var body = el('advBody');
        body.innerHTML = '<div class="adv-loading">PARSING DEMO… <span>' + esc(file.name) + '</span></div>';
        fetch('/api/demo/advanced/upload?name=' + encodeURIComponent(file.name.toLowerCase()),
              { method: 'POST', body: file })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || !j.ok) {
                    body.innerHTML = '<div class="adv-err">' + esc((j && j.message) || 'Upload failed') + '</div>' + backBtn();
                    wireBack(); return;
                }
                upId = j.id; players = j.players || []; mapName = j.map || ''; curSteam = null;
                renderPickers();
            })
            .catch(function () {
                body.innerHTML = '<div class="adv-err">Network error while uploading.</div>' + backBtn(); wireBack();
            });
    }

    function renderPickers() {
        var byTeam = {};
        players.forEach(function (p) { (byTeam[p.team] = byTeam[p.team] || []).push(p); });
        var keys = Object.keys(byTeam).sort();
        var groups = keys.map(function (k, gi) {
            var ps = byTeam[k];
            var label = (ps[0] && ps[0].clan) ? ps[0].clan : ('TEAM ' + (gi === 0 ? 'A' : 'B'));
            var opts = ps.map(function (p) {
                return '<option value="' + esc(p.steamid) + '"' + (p.steamid === curSteam ? ' selected' : '') +
                    '>' + esc(p.name) + '</option>';
            }).join('');
            return '<optgroup label="' + esc(label) + '">' + opts + '</optgroup>';
        }).join('');
        el('advBody').innerHTML =
            '<div class="adv-pickbar">' +
                '<span class="adv-pick-map">' + esc((mapName || '').replace(/^de_/, '').toUpperCase()) + '</span>' +
                '<label class="adv-pick-label" for="advSel">PLAYER</label>' +
                '<div class="adv-selwrap">' +
                    '<select class="adv-select" id="advSel">' +
                        '<option value="" disabled' + (curSteam ? '' : ' selected') + '>Select a player…</option>' +
                        groups +
                    '</select>' +
                '</div>' +
                backBtn() +
            '</div>' +
            '<div class="adv-result" id="advResult">' +
                '<div class="adv-hint">Pick a player to see their in-depth duel statistics.</div>' +
            '</div>';
        el('advSel').addEventListener('change', function () { if (this.value) pick(this.value); });
        wireBack();
    }

    function pick(sid) {
        curSteam = sid;
        var res = el('advResult');
        res.innerHTML = '<div class="adv-loading">ANALYZING TICKS…</div>';
        fetch('/api/demo/advanced/analyze?id=' + encodeURIComponent(upId) + '&steamid=' + encodeURIComponent(sid))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (!j || !j.ok) { res.innerHTML = '<div class="adv-err">' + esc((j && j.message) || 'Analysis failed') + '</div>'; return; }
                renderResult(j);
            })
            .catch(function () { res.innerHTML = '<div class="adv-err">Network error.</div>'; });
    }

    function reactClass(ms) { return ms == null ? '' : (ms <= 250 ? 'good' : (ms >= 450 ? 'bad' : '')); }
    function crossClass(d) { return d == null ? '' : (d <= 8 ? 'good' : (d >= 30 ? 'bad' : '')); }

    function fMs(v) { return v != null ? (v + ' ms') : '—'; }
    function fDeg(v) { return v != null ? (v + '°') : '—'; }
    function fPc(v) { return v != null ? (v + '%') : '—'; }

    function renderResult(j) {
        var a = j.agg || {};
        if (!a.duels) {
            el('advResult').innerHTML = '<div class="adv-hint">No duels found for this player in the match.</div>';
            return;
        }
        function row(label, ov, won, lost, ovCls) {
            return '<tr>' +
                '<th class="adv-deep-m">' + esc(label) + '</th>' +
                '<td class="adv-deep-ov ' + (ovCls || '') + '">' + ov + '</td>' +
                '<td>' + (won != null ? won : '·') + '</td>' +
                '<td>' + (lost != null ? lost : '·') + '</td>' +
            '</tr>';
        }
        var body =
            row('Duels', a.duels, a.won + ' W', a.lost + ' L') +
            row('Win rate', (a.winPct || 0) + '%', null, null, (a.winPct >= 50 ? 'good' : 'bad')) +
            row('Reaction · to damage', fMs(a.reactMed), fMs(a.reactWon), fMs(a.reactLost), reactClass(a.reactMed)) +
            row('Crosshair placement', fDeg(a.crossMed), fDeg(a.crossWon), fDeg(a.crossLost), crossClass(a.crossMed)) +
            row('First bullet', fPc(a.firstBulletPct), fPc(a.fbWonPct), fPc(a.fbLostPct)) +
            row('Counter-strafe · stopped', fPc(a.csPct), fPc(a.csWon), fPc(a.csLost)) +
            row('Headshot kills', fPc(a.hsPct), null, null) +
            row('Avg engagement', a.avgDist != null ? (a.avgDist + ' m') : '—', null, null) +
            row('Flashed losses', a.flashedLost || 0, null, null);

        advDuels = j.duels || [];
        radarMap = j.map || '';
        radarScale = j.scale || 4.5;
        el('advResult').innerHTML =
            '<div class="adv-phead">' +
                '<span class="adv-pname">' + esc(j.name || '?') + '</span>' +
                '<span class="adv-psum">' + esc(a.duels) + ' duels · ' + esc(a.winPct || 0) + '% win</span>' +
            '</div>' +
            '<table class="adv-deep">' +
                '<thead><tr><th class="adv-deep-m">METRIC</th><th>OVERALL</th><th>IN WINS</th><th>IN LOSSES</th></tr></thead>' +
                '<tbody>' + body + '</tbody>' +
            '</table>' +
            duelsSection(advDuels);
        wireDuels();
        if (window.cs2reveal) window.cs2reveal(el('advResult'), '.adv-phead, .adv-deep tbody tr');
    }

    function duelsSection(duels) {
        var rows = duels.map(function (d, i) {
            return '<button class="adv-duel-row ' + (d.won ? 'is-win' : 'is-lose') + '" data-i="' + i + '" type="button">' +
                '<span class="adv-duel-c rt">R' + esc(d.round) + '</span>' +
                '<span class="adv-duel-c res">' + (d.won ? 'WON' : 'LOST') + '</span>' +
                '<span class="adv-duel-c opp">' + esc(d.opp) + '</span>' +
                '<span class="adv-duel-c wpn">' + esc(d.weapon || '') + '</span>' +
                '<span class="adv-duel-c num">' + (d.react != null ? (d.react + 'ms') : '—') + '</span>' +
                '<span class="adv-duel-c num">' + (d.cross != null ? (d.cross + '°') : '—') + '</span>' +
                '<span class="adv-duel-c num">' + (d.firstBullet != null ? (d.firstBullet ? '1B✓' : '1B✗') : '') + '</span>' +
                '</button>';
        }).join('');
        return '<details class="adv-duels" id="advDuelsDet"><summary class="adv-duels-sum">DUELS <b>' + duels.length + '</b><span class="adv-duels-caret">▾</span></summary>' +
            '<div class="adv-duels-body" id="advDuelsBody">' +
                '<div class="adv-duels-list" id="advDuelsList">' + rows + '</div>' +
                '<div class="adv-radar-pane">' +
                    '<canvas id="advRadarCv" width="600" height="600"></canvas>' +
                    '<div class="adv-radar-info" id="advRadarInfo"></div>' +
                '</div>' +
            '</div></details>';
    }

    function wireDuels() {
        var list = el('advDuelsList'), body = el('advDuelsBody'), det = el('advDuelsDet');
        if (!list) return;
        list.querySelectorAll('.adv-duel-row').forEach(function (r) {
            var i = +r.getAttribute('data-i');
            r.addEventListener('mouseenter', function () { showDuel(i); });
            r.addEventListener('click', function () { showDuel(i); });
            r.addEventListener('focus', function () { showDuel(i); });
        });
        if (body) body.addEventListener('mouseleave', clearRadar);   
        if (det) det.addEventListener('toggle', function () { if (det.open) { ensureRadarImg(radarMap); clearRadar(); } });
        ensureRadarImg(radarMap);
    }

    function showDuel(i) {
        hoverIdx = i;
        var d = advDuels[i]; if (!d) return;
        ensureRadarImg(radarMap);
        drawDuelRadar(d);
        var info = el('advRadarInfo');
        if (info) info.innerHTML =
            '<div class="adv-radar-h ' + (d.won ? 'win' : 'lose') + '">' + (d.won ? 'WON' : 'LOST') +
                ' vs ' + esc(d.opp) + '</div>' +
            '<dl class="adv-radar-dl">' +
                kv('Round', 'R' + esc(d.round) + ' · ' + esc(d.time) + 's') +
                kv('Weapon', esc(d.weapon || '—')) +
                kv('Your HP', d.hp != null ? esc(d.hp) : '—') +
                kv('Distance', d.dist != null ? (esc(d.dist) + ' m') : '—') +
                kv('Reaction', d.react != null ? (esc(d.react) + ' ms') : '—') +
                kv('Crosshair', d.cross != null ? (esc(d.cross) + '°') : '—') +
                kv('First bullet', d.firstBullet != null ? (d.firstBullet ? 'hit' : 'miss') : '—') +
                kv('Counter-strafe', d.cs != null ? (d.cs ? 'stopped' : 'moving') : '—') +
                (d.flashed ? kv('Flashed', 'yes') : '') +
            '</dl>';
    }
    function kv(k, v) { return '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>'; }

    function clearRadar() {
        hoverIdx = -1;
        drawCleanRadar();
        var info = el('advRadarInfo');
        if (info) info.innerHTML = '<div class="adv-radar-hint">Hover a duel — the radar shows only you, your opponent and the first-bullet line.</div>';
    }

    function ensureRadarImg(mapId) {
        if (radarImgMap === mapId && radarImg) return;
        radarImgMap = mapId;
        radarImg = new Image();
        radarImg.onload = function () { (hoverIdx >= 0 && advDuels[hoverIdx]) ? drawDuelRadar(advDuels[hoverIdx]) : drawCleanRadar(); };
        radarImg.onerror = function () { radarImg = null; };
        radarImg.src = '/static/radars/' + mapId + '.png';
    }

    function drawCleanRadar() {
        var cv = el('advRadarCv'); if (!cv) return;
        var ctx = cv.getContext('2d'), S = cv.width;
        var bg = getComputedStyle(document.documentElement).getPropertyValue('--radar-bg').trim() || '#14130f';
        ctx.clearRect(0, 0, S, S); ctx.fillStyle = bg; ctx.fillRect(0, 0, S, S);
        if (radarImg && radarImg.complete && radarImg.naturalWidth) ctx.drawImage(radarImg, 0, 0, S, S);
    }

    function drawDuelRadar(d) {
        var cv = el('advRadarCv'); if (!cv) return;
        drawCleanRadar();
        var ctx = cv.getContext('2d'), S = cv.width, sc = S / RADAR;
        var cs = getComputedStyle(document.documentElement);
        var ct = cs.getPropertyValue('--team-ct').trim() || '#84b4de';
        var tt = cs.getPropertyValue('--team-t').trim() || '#ff9a5c';
        var good = cs.getPropertyValue('--green').trim() || '#6fae5e';
        var bad = cs.getPropertyValue('--red').trim() || '#d8593f';
        
        if (d.rp && d.ro) {
            ctx.strokeStyle = d.firstBullet ? good : bad; ctx.lineWidth = Math.max(2, S * 0.005);
            ctx.beginPath(); ctx.moveTo(d.rp[0] * sc, d.rp[1] * sc); ctx.lineTo(d.ro[0] * sc, d.ro[1] * sc); ctx.stroke();
        }
        if (d.ro) dot(ctx, d.ro[0] * sc, d.ro[1] * sc, tt, S, true);    
        if (d.rp) dot(ctx, d.rp[0] * sc, d.rp[1] * sc, ct, S, false);   
    }
    function arc(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
    function ring(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); }
    function dot(ctx, x, y, col, S, ringed) {
        var r = S * 0.013;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = col; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = '#0e0d0b'; ctx.stroke();
        if (ringed) { ctx.beginPath(); ctx.arc(x, y, r * 1.7, 0, 7); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); }
    }

    window.initAdvanced = function () {
        root = el('advRoot'); if (!root) return;
        if (!inited) { inited = true; shell(); }
    };
})();

(function () {
    'use strict';

    var root = null;
    var inited = false;
    var library = [];          
    var currentKey = null;     
    var data = null;           
    var selPlayer = -1;        
    var avatarCache = {};      
    var loadToken = 0;         
    var sortKey = 'rating';    
    var sortDir = -1;          

    function el(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function mapShort(m) { return String(m || '').replace(/^de_/, ''); }
    function n1(v) { return (v == null || isNaN(v)) ? '0.0' : Number(v).toFixed(1); }
    function n2(v) { return (v == null || isNaN(v)) ? '0.00' : Number(v).toFixed(2); }
    function pct(v) { return (v == null || isNaN(v)) ? '0%' : Math.round(v) + '%'; }
    function sgn(v) { v = Math.round(v || 0); return (v > 0 ? '+' : '') + v; }
    function clamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

    function mapImgUrl(mapId) {
        if (!mapId) return '';
        var list = (typeof MAPS !== 'undefined' && Array.isArray(MAPS)) ? MAPS : [];
        for (var i = 0; i < list.length; i++) if (list[i].id === mapId) return '/maps/' + list[i].file;
        var base = mapId.replace(/^de_/, '');
        if (!base) return '';
        return '/maps/' + base.charAt(0).toUpperCase() + base.slice(1) + '.jpg';
    }

    function initials(name) {
        var parts = String(name || '?').trim().split(/[\s_\-|]+/).filter(Boolean);
        if (!parts.length) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return (parts[0][0] + parts[1][0]).toUpperCase();
    }

    function fallbackAvatar(node, name, isCt) {
        node.classList.add('stats-av--fallback');
        node.classList.toggle('is-ct', isCt);
        node.classList.toggle('is-t', !isCt);
        node.textContent = initials(name);
    }

    function loadAvatar(node, steamid, name, isCt) {
        function paintImg(url) {
            node.classList.remove('stats-av--fallback', 'is-ct', 'is-t');
            node.textContent = '';
            var img = document.createElement('img');
            img.alt = '';
            img.loading = 'lazy';
            img.onerror = function () { fallbackAvatar(node, name, isCt); };
            img.src = url;
            node.appendChild(img);
        }
        if (!steamid) { fallbackAvatar(node, name, isCt); return; }
        if (avatarCache[steamid] === false) { fallbackAvatar(node, name, isCt); return; }
        if (avatarCache[steamid]) { paintImg(avatarCache[steamid]); return; }
        
        fallbackAvatar(node, name, isCt);
        fetch('/api/faceit/avatar?steamid=' + encodeURIComponent(steamid))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (j && j.ok && j.url) { avatarCache[steamid] = j.url; paintImg(j.url); }
                else { avatarCache[steamid] = false; }
            })
            .catch(function () { avatarCache[steamid] = false; });
    }

    function isCtIndex(idx) {

        return data && data.teamA && data.teamA.indexOf(idx) !== -1;
    }

    function buildShell() {
        root.innerHTML = '' +
            '<header class="stats-head">' +
                '<div class="stats-head-title">' +
                    '<span class="stats-kicker">MATCH SHEET</span>' +
                    '<h2 class="stats-h2">Statistics</h2>' +
                '</div>' +
                '<div class="stats-picker" id="statsPicker"></div>' +
            '</header>' +
            '<div class="stats-summary" id="statsSummary"></div>' +
            '<div class="stats-board" id="statsBoard"></div>' +
            '<div class="stats-dossier" id="statsDossier"></div>';
    }

    function showEmptyLibrary() {
        root.innerHTML =
            '<div class="stats-empty">' +
                '<div class="stats-empty-tick"></div>' +
                '<div class="stats-empty-title">NO DEMOS PARSED</div>' +
                '<p class="stats-empty-body">Add and parse a demo in the <strong>Demo Viewer</strong> ' +
                'tab first. Once a match is parsed it shows up here as a full statistics sheet.</p>' +
            '</div>';
    }
    function showError(msg) {
        var d = el('statsDossier');
        if (d) d.innerHTML = '<div class="stats-empty stats-empty--inline">' +
            '<div class="stats-empty-title">COULD NOT LOAD</div>' +
            '<p class="stats-empty-body">' + esc(msg || 'The stats request failed.') + '</p></div>';
    }

    function renderPicker() {
        var box = el('statsPicker');
        if (!box) return;
        box.innerHTML = '';
        
        var lib = library.slice().sort(function (a, b) { return (b.added || 0) - (a.added || 0); });
        lib.forEach(function (d) {
            var b = document.createElement('button');
            b.className = 'stats-demo' + (d.key === currentKey ? ' is-on' : '');
            b.type = 'button';
            b.title = d.name || d.key;
            b.innerHTML =
                '<img class="stats-demo-thumb" alt="" loading="lazy">' +
                '<span class="stats-demo-text">' +
                    '<span class="stats-demo-map">' + esc(mapShort(d.map).toUpperCase()) + '</span>' +
                    '<span class="stats-demo-score"><b>' + esc(d.sa) + '</b>:<b>' + esc(d.sb) + '</b></span>' +
                '</span>';
            var img = b.querySelector('.stats-demo-thumb');
            img.onerror = function () { img.style.visibility = 'hidden'; };
            var u = mapImgUrl(d.map);
            if (u) img.src = u; else img.style.visibility = 'hidden';
            b.addEventListener('click', function () { selectDemo(d.key); });
            box.appendChild(b);
        });
    }

    function renderSummary() {
        var box = el('statsSummary');
        if (!box || !data) { if (box) box.innerHTML = ''; return; }
        var aWin = data.sa > data.sb, bWin = data.sb > data.sa;
        box.innerHTML =
            '<div class="stats-sum-map">' +
                '<img class="stats-sum-thumb" alt="">' +
                '<span class="stats-sum-name">' + esc(mapShort(data.map).toUpperCase()) + '</span>' +
            '</div>' +
            '<div class="stats-sum-score">' +
                '<span class="stats-sum-s ' + (aWin ? 'win' : '') + ' is-ct">' + esc(data.sa) + '</span>' +
                '<span class="stats-sum-sep">:</span>' +
                '<span class="stats-sum-s ' + (bWin ? 'win' : '') + ' is-t">' + esc(data.sb) + '</span>' +
            '</div>' +
            '<dl class="stats-sum-meta">' +
                '<div><dt>ROUNDS</dt><dd>' + esc(data.rounds) + '</dd></div>' +
                '<div><dt>PLAYERS</dt><dd>' + esc((data.players || []).length) + '</dd></div>' +
            '</dl>';
        var img = box.querySelector('.stats-sum-thumb');
        img.onerror = function () { img.style.visibility = 'hidden'; };
        var u = mapImgUrl(data.map);
        if (u) img.src = u; else img.style.visibility = 'hidden';
    }

    var COLS = [
        { key: 'rating', label: 'RATING', title: 'Rating (HLTV 2.0)', group: 'rate',
          val: function (s) { return s.rating || 0; } },
        { key: 'k',  label: 'K',   title: 'Kills',    group: 'frag', val: function (s) { return s.k || 0; },   fmt: function (s) { return esc(s.k); } },
        { key: 'd',  label: 'D',   title: 'Deaths',   group: 'frag', val: function (s) { return s.d || 0; },   fmt: function (s) { return esc(s.d); } },
        { key: 'a',  label: 'A',   title: 'Assists',  group: 'frag', val: function (s) { return s.a || 0; },   fmt: function (s) { return esc(s.a); } },
        { key: 'pm', label: '+/−', title: 'Plus-minus (kills − deaths)', group: 'frag',
          val: function (s) { return s.pm || 0; },
          fmt: function (s) { var v = s.pm || 0; return '<span class="' + (v >= 0 ? 'good' : 'bad') + '">' + sgn(v) + '</span>'; } },
        { key: 'adr',   label: 'ADR',  title: 'Average damage per round', group: 'impact',
          val: function (s) { return s.adr || 0; }, fmt: function (s) { return Math.round(s.adr || 0); } },
        { key: 'kast',  label: 'KAST', title: 'Kill / Assist / Survive / Trade %', group: 'impact',
          val: function (s) { return s.kast || 0; }, fmt: function (s) { return pct(s.kast); } },
        { key: 'hsPct', label: 'HS%',  title: 'Headshot %', group: 'impact',
          val: function (s) { return s.hsPct || 0; }, fmt: function (s) { return pct(s.hsPct); } }
    ];

    function sortIndices(indices) {
        var col = null;
        for (var i = 0; i < COLS.length; i++) if (COLS[i].key === sortKey) { col = COLS[i]; break; }
        if (!col) col = COLS[0];
        var arr = (indices || []).slice();
        arr.sort(function (a, b) {
            var va = col.val(data.stats[a] || {}), vb = col.val(data.stats[b] || {});
            if (va === vb) {  
                var ra = (data.stats[a] || {}).rating || 0, rb = (data.stats[b] || {}).rating || 0;
                return rb - ra;
            }
            return (va - vb) * sortDir;
        });
        return arr;
    }

    function boardHead() {
        var cells = COLS.map(function (c) {
            var on = c.key === sortKey;
            var caret = on ? (sortDir < 0 ? '▾' : '▴') : '';
            return '<button class="stats-th c-num g-' + c.group + (on ? ' is-sort' : '') + '" type="button" ' +
                'data-key="' + c.key + '" title="' + esc(c.title) + '" ' +
                'aria-sort="' + (on ? (sortDir < 0 ? 'descending' : 'ascending') : 'none') + '">' +
                esc(c.label) + '<i class="stats-th-caret">' + caret + '</i></button>';
        }).join('');
        return '<div class="stats-thead" role="row">' +
            '<span class="stats-th c-name" role="columnheader">PLAYER</span>' +
            cells + '</div>';
    }

    function dividerRow(name, isCt, score) {
        return '<div class="stats-div ' + (isCt ? 'is-ct' : 'is-t') + '" role="row">' +
            '<span class="stats-div-led"></span>' +
            '<span class="stats-div-name">' + esc(name) + '</span>' +
            '<span class="stats-div-score">' + esc(score) + '</span></div>';
    }

    function ratingClass(r) {
        if (r >= 1.0) return 'good';
        if (r < 0.85) return 'bad';
        return 'mid';
    }

    function playerRow(idx, ratMax) {
        var s = data.stats[idx], p = data.players[idx] || {};
        var sel = idx === selPlayer ? ' is-sel' : '';
        var r = s.rating || 0;
        var barW = Math.round(clamp01(ratMax ? r / ratMax : 0) * 100);

        var numCells = COLS.slice(1).map(function (c) {
            var v = c.fmt ? c.fmt(s) : '0';
            var active = c.key === sortKey ? ' is-sort' : '';
            return '<span class="c-num g-' + c.group + active + '">' + v + '</span>';
        }).join('');

        return '<button class="stats-row' + sel + '" type="button" data-idx="' + idx + '" role="row">' +
            '<span class="stats-row-name">' +
                '<span class="stats-av" data-av="' + idx + '"></span>' +
                '<span class="stats-row-nick">' + esc(s.name || p.name) + '</span>' +
            '</span>' +
            '<span class="stats-row-rat c-num g-rate' + (sortKey === 'rating' ? ' is-sort' : '') + '">' +
                '<span class="stats-rat-bar"><i class="' + ratingClass(r) + '" style="width:' + barW + '%"></i></span>' +
                '<b class="' + ratingClass(r) + '">' + n2(r) + '</b>' +
            '</span>' +
            numCells +
        '</button>';
    }

    function renderBoard() {
        var box = el('statsBoard');
        if (!box || !data) { if (box) box.innerHTML = ''; return; }

        var ratMax = 1;
        (data.stats || []).forEach(function (s) { if ((s.rating || 0) > ratMax) ratMax = s.rating; });

        function group(indices) {
            return sortIndices(indices).map(function (idx) { return playerRow(idx, ratMax); }).join('');
        }

        box.innerHTML =
            '<div class="stats-table" role="table">' +
                boardHead() +
                dividerRow(data.teamAName || 'TEAM A', true, data.sa) +
                group(data.teamA) +
                dividerRow(data.teamBName || 'TEAM B', false, data.sb) +
                group(data.teamB) +
            '</div>';

        box.querySelectorAll('.stats-av[data-av]').forEach(function (node) {
            var idx = +node.getAttribute('data-av');
            var p = data.players[idx] || {}, s = data.stats[idx] || {};
            loadAvatar(node, p.steamid, s.name || p.name, isCtIndex(idx));
        });
        
        box.querySelectorAll('.stats-row').forEach(function (b) {
            b.addEventListener('click', function () { selectPlayer(+b.getAttribute('data-idx')); });
        });
        
        box.querySelectorAll('.stats-th[data-key]').forEach(function (b) {
            b.addEventListener('click', function () {
                var k = b.getAttribute('data-key');
                if (k === sortKey) { sortDir = -sortDir; }
                else { sortKey = k; sortDir = -1; }
                renderBoard();
            });
        });
        if (window.cs2reveal) window.cs2reveal(box, '.stats-row');
    }

    function cell(label, value, klass) {
        return '<div class="stats-cell ' + (klass || '') + '">' +
            '<span class="stats-cell-v">' + value + '</span>' +
            '<span class="stats-cell-l">' + esc(label) + '</span></div>';
    }

    function meter(label, frac, readout, klass) {
        var w = Math.round(clamp01(frac) * 100);
        return '<div class="stats-meter ' + (klass || '') + '">' +
            '<span class="stats-meter-l">' + esc(label) + '</span>' +
            '<span class="stats-meter-track"><i style="width:' + w + '%"></i></span>' +
            '<span class="stats-meter-v">' + readout + '</span></div>';
    }

    function hitGroups(hg) {
        hg = hg || {};
        var segs = [
            ['head', hg.head || 0, 'HEAD'],
            ['chest', hg.chest || 0, 'CHEST'],
            ['stomach', hg.stomach || 0, 'STOM'],
            ['arm', hg.arm || 0, 'ARMS'],
            ['leg', hg.leg || 0, 'LEGS']
        ];
        var total = segs.reduce(function (a, s) { return a + s[1]; }, 0) || 1;
        var bar = segs.map(function (s) {
            var w = (s[1] / total) * 100;
            return '<i class="hg-' + s[0] + '" style="width:' + w.toFixed(2) + '%" title="' +
                s[2] + ' ' + s[1] + '"></i>';
        }).join('');
        var legend = segs.map(function (s) {
            return '<span class="stats-hg-key"><b class="hg-' + s[0] + '"></b>' +
                s[2] + ' <em>' + Math.round((s[1] / total) * 100) + '%</em></span>';
        }).join('');
        return '<div class="stats-hg"><div class="stats-hg-bar">' + bar + '</div>' +
            '<div class="stats-hg-legend">' + legend + '</div></div>';
    }

    function weaponBars(wk) {
        var arr = Object.keys(wk || {}).map(function (k) { return [k, wk[k]]; });
        arr.sort(function (a, b) { return b[1] - a[1]; });
        arr = arr.slice(0, 6);
        if (!arr.length) return '<div class="stats-faint">No weapon kills recorded.</div>';
        var max = arr[0][1] || 1;
        return '<div class="stats-wk">' + arr.map(function (w) {
            var pctw = Math.round((w[1] / max) * 100);
            return '<div class="stats-wk-row">' +
                '<span class="stats-wk-name">' + esc(w[0]) + '</span>' +
                '<span class="stats-wk-track"><i style="width:' + pctw + '%"></i></span>' +
                '<span class="stats-wk-v">' + w[1] + '</span></div>';
        }).join('') + '</div>';
    }

    function multiKills(multi) {
        multi = multi || [0, 0, 0, 0, 0];
        var labels = ['2K', '3K', '4K', 'ACE'];
        var vals = [multi[1] || 0, multi[2] || 0, multi[3] || 0, multi[4] || 0];
        return '<div class="stats-multi">' + labels.map(function (lb, i) {
            var on = vals[i] > 0 ? ' is-on' : '';
            return '<div class="stats-multi-col' + on + '">' +
                '<span class="stats-multi-v">' + vals[i] + '</span>' +
                '<span class="stats-multi-l">' + lb + '</span></div>';
        }).join('') + '</div>';
    }

    function clutches(w, l) {
        w = w || [0, 0, 0, 0, 0];
        l = l || [0, 0, 0, 0, 0];
        var out = '';
        for (var i = 0; i < 5; i++) {
            var won = w[i] || 0, lost = l[i] || 0, played = won + lost;
            var state = played === 0 ? 'none' : (won > 0 ? 'won' : 'lost');
            out += '<div class="stats-clutch is-' + state + '">' +
                '<span class="stats-clutch-l">1v' + (i + 1) + '</span>' +
                '<span class="stats-clutch-v">' + won + '<i>/</i>' + played + '</span></div>';
        }
        return '<div class="stats-clutches">' + out + '</div>';
    }

    function section(title, body) {
        return '<section class="stats-sec">' +
            '<h4 class="stats-sec-title">' + esc(title) + '</h4>' +
            '<div class="stats-sec-body">' + body + '</div></section>';
    }

    function renderDossier() {
        var box = el('statsDossier');
        if (!box || !data) { if (box) box.innerHTML = ''; return; }
        if (selPlayer < 0 || !data.stats[selPlayer]) {
            box.innerHTML = '<div class="stats-empty stats-empty--inline">' +
                '<p class="stats-empty-body">Select a player above to see their full breakdown.</p></div>';
            return;
        }
        var s = data.stats[selPlayer], p = data.players[selPlayer] || {};
        var ct = isCtIndex(selPlayer);

        var ratings = data.stats.map(function (x) { return x.rating || 0; });
        var maxR = Math.max.apply(null, ratings.concat([1.3]));
        var ratFrac = (s.rating || 0) / (maxR || 1);

        var accFrac = (s.acc || 0) / 100;
        var hsFrac = (s.hsPct || 0) / 100;
        var kastFrac = (s.kast || 0) / 100;

        var openTot = (s.openK || 0) + (s.openD || 0);
        var openFrac = openTot ? (s.openK / openTot) : 0;
        
        var tradeTot = (s.tradeK || 0) + (s.traded || 0);

        var core =
            cell('RATING', '<b class="' + (s.rating >= 1 ? 'good' : 'bad') + '">' + n2(s.rating) + '</b>') +
            cell('KAST', pct(s.kast)) +
            cell('ADR', Math.round(s.adr || 0)) +
            cell('KPR', n2(s.kpr)) +
            cell('K / D', '<b>' + esc(s.k) + '</b><i>/</i>' + esc(s.d), 'wide') +
            cell('ASSIST', esc(s.a)) +
            cell('+/−', '<b class="' + (s.pm >= 0 ? 'good' : 'bad') + '">' + sgn(s.pm) + '</b>') +
            cell('K/D', n2(s.kd));

        var coreMeters =
            meter('RATING', ratFrac, n2(s.rating), 'accent') +
            meter('KAST', kastFrac, pct(s.kast));

        var aim =
            '<div class="stats-cellgrid stats-cellgrid--3">' +
                cell('HS KILLS', esc(s.hs)) +
                cell('HS%', pct(s.hsPct)) +
                cell('ACCURACY', pct(s.acc)) +
            '</div>' +
            meter('HEADSHOT %', hsFrac, pct(s.hsPct), 'accent') +
            meter('ACCURACY', accFrac, pct(s.acc)) +
            '<h5 class="stats-subhead">HIT DISTRIBUTION</h5>' +
            hitGroups(s.hg) +
            '<h5 class="stats-subhead">TOP WEAPONS</h5>' +
            weaponBars(s.wk);

        var impact =
            '<h5 class="stats-subhead">OPENING DUELS</h5>' +
            '<div class="stats-duel">' +
                '<span class="stats-duel-w">' + esc(s.openK || 0) + ' won</span>' +
                '<span class="stats-duel-bar"><i style="width:' + Math.round(openFrac * 100) + '%"></i></span>' +
                '<span class="stats-duel-l">' + esc(s.openD || 0) + ' lost</span>' +
            '</div>' +
            '<h5 class="stats-subhead">MULTI-KILLS</h5>' +
            multiKills(s.multi) +
            '<h5 class="stats-subhead">TRADES</h5>' +
            '<div class="stats-cellgrid stats-cellgrid--2">' +
                cell('TRADE KILLS', esc(s.tradeK || 0)) +
                cell('TRADED', esc(s.traded || 0)) +
            '</div>' +
            '<h5 class="stats-subhead">CLUTCHES (WON / PLAYED)</h5>' +
            clutches(s.clutchW, s.clutchL);

        var util =
            '<div class="stats-cellgrid stats-cellgrid--2">' +
                cell('UTIL DMG', Math.round(s.utilDmg || 0)) +
                cell('FLASHES', esc(s.flThrown || 0)) +
                cell('ENEMIES BLINDED', esc(s.flEnemy || 0)) +
                cell('FLASH ASSISTS', esc(s.flAssist || 0)) +
            '</div>';

        var misc =
            '<div class="stats-cellgrid stats-cellgrid--3">' +
                cell('MVPs', esc(s.mvp || 0)) +
                cell('DMG DEALT', Math.round(s.dmg || 0)) +
                cell('DMG TAKEN', Math.round(s.dmgTaken || 0)) +
            '</div>' +
            '<div class="stats-cellgrid stats-cellgrid--1">' +
                cell('VOICE TALK-TIME', fmtTime(s.talk)) +
            '</div>';

        box.innerHTML =
            '<div class="stats-dossier-card ' + (ct ? 'is-ct' : 'is-t') + '">' +
                '<header class="stats-dossier-head">' +
                    '<span class="stats-av stats-av--lg" id="statsDossierAv"></span>' +
                    '<div class="stats-dossier-id">' +
                        '<span class="stats-dossier-side">' + esc(ct ? (data.teamAName || 'TEAM A') : (data.teamBName || 'TEAM B')) + '</span>' +
                        '<h3 class="stats-dossier-name">' + esc(s.name || p.name) + '</h3>' +
                        '<span class="stats-dossier-sub">' + esc(s.rounds || data.rounds) + ' rounds · ' +
                            n2(s.rating) + ' rating</span>' +
                    '</div>' +
                    '<div class="stats-dossier-rat">' +
                        '<span class="stats-dossier-rat-v">' + n2(s.rating) + '</span>' +
                        '<span class="stats-dossier-rat-l">HLTV 2.0</span>' +
                    '</div>' +
                '</header>' +
                '<div class="stats-dossier-grid">' +
                    section('CORE', '<div class="stats-cellgrid stats-cellgrid--4">' + core + '</div>' + coreMeters) +
                    section('AIM', aim) +
                    section('IMPACT', impact) +
                    section('UTILITY', util) +
                    section('MISC', misc) +
                    '<section class="stats-sec stats-corner">' +
                        '<div class="stats-corner-v"><b>' + esc(s.hits || 0) + '</b> hits / <b>' +
                            esc(s.shots || 0) + '</b> shots</div>' +
                    '</section>' +
                '</div>' +
            '</div>';

        if (window.cs2reveal) window.cs2reveal(box, '.stats-sec');
        var av = el('statsDossierAv');
        if (av) loadAvatar(av, p.steamid, s.name || p.name, ct);
    }

    function fmtTime(sec) {
        sec = Math.round(sec || 0);
        var m = Math.floor(sec / 60), r = sec % 60;
        return m + ':' + (r < 10 ? '0' : '') + r;
    }

    function selectPlayer(idx) {
        if (idx === selPlayer) return;
        selPlayer = idx;
        
        var box = el('statsBoard');
        if (box) box.querySelectorAll('.stats-row').forEach(function (b) {
            b.classList.toggle('is-sel', +b.getAttribute('data-idx') === idx);
        });
        renderDossier();
    }

    function defaultPlayer() {
        
        if (!data || !data.stats || !data.stats.length) return -1;
        var best = 0;
        for (var i = 1; i < data.stats.length; i++) {
            if ((data.stats[i].rating || 0) > (data.stats[best].rating || 0)) best = i;
        }
        return best;
    }

    function selectDemo(key) {
        if (!key) return;
        currentKey = key;
        renderPicker();
        var summary = el('statsSummary'), board = el('statsBoard'), dossier = el('statsDossier');
        if (summary) summary.innerHTML = '<div class="stats-loading">LOADING…</div>';
        if (board) board.innerHTML = '';
        if (dossier) dossier.innerHTML = '';

        var token = ++loadToken;
        fetch('/api/demo/stats/' + encodeURIComponent(key))
            .then(function (r) { return r.json(); })
            .then(function (j) {
                if (token !== loadToken) return;   
                if (!j || !j.ok) { showError(j && j.error); return; }
                data = j;
                selPlayer = defaultPlayer();
                renderSummary();
                renderBoard();
                renderDossier();
            })
            .catch(function () {
                if (token !== loadToken) return;
                showError('Network error while loading stats.');
            });
    }

    function load() {
        fetch('/api/demo/library')
            .then(function (r) { return r.json(); })
            .then(function (j) {
                library = (j && j.library) || [];
                if (!library.length) { showEmptyLibrary(); return; }
                buildShell();
                renderPicker();
                
                var recent = library.slice().sort(function (a, b) {
                    return (b.added || 0) - (a.added || 0);
                })[0];
                selectDemo(recent.key);
            })
            .catch(function () {
                root.innerHTML = '<div class="stats-empty"><div class="stats-empty-title">' +
                    'COULD NOT REACH SERVER</div><p class="stats-empty-body">' +
                    'The demo library request failed.</p></div>';
            });
    }

    window.initStatistics = function () {
        root = el('statsRoot');
        if (!root) return;
        if (!inited) {
            inited = true;
            load();
            return;
        }
        
        fetch('/api/demo/library')
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var lib = (j && j.library) || [];
                if (!lib.length) { showEmptyLibrary(); inited = false; return; }
                library = lib;
                if (!el('statsPicker')) { buildShell(); }
                renderPicker();
                var stillThere = currentKey && library.some(function (d) { return d.key === currentKey; });
                if (!stillThere) {
                    var recent = library.slice().sort(function (a, b) {
                        return (b.added || 0) - (a.added || 0);
                    })[0];
                    selectDemo(recent.key);
                }
            })
            .catch(function () {  });
    };
})();

'use strict';

(function () {
    const accordion = document.getElementById('bindsAccordion');
    const saveBtn   = document.getElementById('bindsSaveBtn');
    const clearBtn  = document.getElementById('bindsClearBtn');
    const countEl   = document.getElementById('bindsCount');
    const resultEl  = document.getElementById('bindsResult');
    if (!accordion) return;

    const LS_BINDS  = 'cs2prak_binds';
    const LS_CUSTOM = 'cs2prak_binds_custom';

    let catalog      = [];
    let binds        = {};            
    let customDefs   = [];            
    let catalogIndex = {};            
    const btnByUid   = {};            
    const openGroups = new Set();
    let capturing    = null;          
    let customSeq    = 0;

    function toast(msg, type) { if (typeof showToast === 'function') showToast(msg, type); }

    function persist() {
        localStorage.setItem(LS_BINDS,  JSON.stringify(binds));
        localStorage.setItem(LS_CUSTOM, JSON.stringify(customDefs));
    }
    function restore() {
        try { binds      = JSON.parse(localStorage.getItem(LS_BINDS)  || '{}'); } catch { binds = {}; }
        try { customDefs = JSON.parse(localStorage.getItem(LS_CUSTOM) || '[]'); } catch { customDefs = []; }
        customDefs.forEach(d => {
            const n = parseInt((d.uid.split('::')[1] || '0'), 10);
            if (n > customSeq) customSeq = n;
        });
    }

    const STATIC_MAP = {
        Space: 'space', Enter: 'enter', Tab: 'tab', Backspace: 'backspace',
        ShiftLeft: 'shift', ShiftRight: 'shift', ControlLeft: 'ctrl', ControlRight: 'ctrl',
        AltLeft: 'alt', AltRight: 'alt', CapsLock: 'capslock',
        ArrowUp: 'uparrow', ArrowDown: 'downarrow', ArrowLeft: 'leftarrow', ArrowRight: 'rightarrow',
        Insert: 'ins', Delete: 'del', Home: 'home', End: 'end', PageUp: 'pgup', PageDown: 'pgdn',
        Semicolon: 'semicolon', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
        BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
    };
    const NUMPAD_MAP = {
        Numpad0: 'kp_0', Numpad1: 'kp_1', Numpad2: 'kp_2', Numpad3: 'kp_3',
        Numpad4: 'kp_4', Numpad5: 'kp_5', Numpad6: 'kp_6', Numpad7: 'kp_7',
        Numpad8: 'kp_8', Numpad9: 'kp_9', NumpadEnter: 'kp_enter', NumpadAdd: 'kp_plus',
        NumpadSubtract: 'kp_minus', NumpadMultiply: 'kp_multiply', NumpadDivide: 'kp_slash',
        NumpadDecimal: 'kp_del',
    };
    function codeToBindKey(e) {
        const c = e.code || '';
        if (/^Key[A-Z]$/.test(c))     return c.slice(3).toLowerCase();
        if (/^Digit[0-9]$/.test(c))   return c.slice(5);
        const f = /^F([1-9]|1[0-2])$/.exec(c);
        if (f) return 'f' + f[1];
        if (NUMPAD_MAP[c]) return NUMPAD_MAP[c];
        if (STATIC_MAP[c]) return STATIC_MAP[c];
        if (e.key && e.key.length === 1) return e.key.toLowerCase();
        return null;
    }
    const MOUSE_MAP = { 0: 'mouse1', 1: 'mouse3', 2: 'mouse2', 3: 'mouse4', 4: 'mouse5' };

    function endCapture() {
        document.removeEventListener('keydown', onCaptureKey, true);
        document.removeEventListener('mousedown', onCaptureMouse, true);
        document.removeEventListener('wheel', onCaptureWheel, { capture: true });
        if (capturing && capturing.armTimer) clearTimeout(capturing.armTimer);
        capturing = null;
    }
    function applyBtnState(btn, uid) {
        const bd = binds[uid];
        btn.classList.remove('capturing');
        if (bd) { btn.textContent = bd.key.toUpperCase(); btn.classList.add('set'); }
        else    { btn.textContent = 'SET KEY';            btn.classList.remove('set'); }
    }
    function cancelCapture() {
        if (!capturing) return;
        const uid = capturing.uid;
        endCapture();
        const btn = btnByUid[uid];
        if (btn) applyBtnState(btn, uid);
    }
    function startCapture(uid) {
        cancelCapture();
        const btn = btnByUid[uid];
        if (!btn) return;
        capturing = { uid, armTimer: null };
        btn.classList.add('capturing');
        btn.classList.remove('set');
        btn.textContent = 'PRESS KEY…';
        document.addEventListener('keydown', onCaptureKey, true);
        
        capturing.armTimer = setTimeout(() => {
            document.addEventListener('mousedown', onCaptureMouse, true);
            document.addEventListener('wheel', onCaptureWheel, { capture: true, passive: false });
        }, 220);
    }
    function onCaptureKey(e) {
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { cancelCapture(); return; }
        const k = codeToBindKey(e);
        if (k) assignKey(capturing.uid, k);
    }
    function onCaptureMouse(e) {
        const k = MOUSE_MAP[e.button];
        if (!k) return;
        e.preventDefault(); e.stopPropagation();
        assignKey(capturing.uid, k);
    }
    function onCaptureWheel(e) {
        e.preventDefault(); e.stopPropagation();
        assignKey(capturing.uid, e.deltaY < 0 ? 'mwheelup' : 'mwheeldown');
    }

    function assignKey(uid, key) {
        endCapture();
        
        for (const k of Object.keys(binds)) {
            if (k !== uid && binds[k].key === key) delete binds[k];
        }
        const def = catalogIndex[uid];
        if (!def) return;
        binds[uid] = { key, cmd: def.cmd, label: def.label, plugin: def.plugin, custom: !!def.custom };
        persist();
        render();
        toast(`Bound ${def.cmd} → ${key.toUpperCase()}`, 'success');
    }
    function clearKey(uid) {
        delete binds[uid];
        persist();
        render();
    }

    function bindRow(def) {
        const uid = def.uid;
        catalogIndex[uid] = def;
        const row = document.createElement('div');
        row.className = 'bind-row';
        const bd = binds[uid];

        const info = document.createElement('div');
        info.className = 'bind-row-info';
        info.innerHTML =
            `<div class="bind-row-name">${def.label}<span class="bind-cmd">${def.cmd}</span></div>` +
            (def.desc ? `<div class="bind-row-desc">${def.desc}</div>` : '');

        const wrap = document.createElement('div');
        wrap.className = 'bind-key-wrap';

        const keyBtn = document.createElement('button');
        keyBtn.className = 'bind-key-btn' + (bd ? ' set' : '');
        keyBtn.textContent = bd ? bd.key.toUpperCase() : 'SET KEY';
        keyBtn.addEventListener('click', () => {
            if (capturing && capturing.uid === uid) cancelCapture();
            else startCapture(uid);
        });
        btnByUid[uid] = keyBtn;
        wrap.appendChild(keyBtn);

        if (bd) {
            const clr = document.createElement('button');
            clr.className = 'bind-key-clear';
            clr.title = 'Remove bind';
            clr.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            clr.addEventListener('click', () => clearKey(uid));
            wrap.appendChild(clr);
        }
        if (def.custom) {
            const del = document.createElement('button');
            del.className = 'bind-key-clear';
            del.title = 'Delete command';
            del.textContent = '🗑';
            del.style.fontSize = '11px';
            del.addEventListener('click', () => {
                delete binds[uid];
                customDefs = customDefs.filter(d => d.uid !== uid);
                persist(); render();
            });
            wrap.appendChild(del);
        }

        row.appendChild(info);
        row.appendChild(wrap);
        return row;
    }

    function group(title, id, defs, bodyExtra) {
        const setCount = defs.filter(d => binds[d.uid]).length;
        const g = document.createElement('div');
        g.className = 'binds-group' + (openGroups.has(id) ? ' open' : '');

        const head = document.createElement('div');
        head.className = 'binds-group-head';
        head.innerHTML =
            '<svg class="binds-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>' +
            `<span class="binds-group-title">${title}</span>` +
            `<span class="binds-group-count${setCount ? ' has' : ''}">${setCount ? setCount + ' bound' : defs.length + ' commands'}</span>`;
        head.addEventListener('click', () => {
            if (openGroups.has(id)) openGroups.delete(id); else openGroups.add(id);
            g.classList.toggle('open');
        });

        const body = document.createElement('div');
        body.className = 'binds-group-body';
        defs.forEach(d => body.appendChild(bindRow(d)));
        if (bodyExtra) body.appendChild(bodyExtra);

        g.appendChild(head);
        g.appendChild(body);
        return g;
    }

    function customAddRow() {
        const row = document.createElement('div');
        row.className = 'binds-custom-row';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'input-field';
        input.placeholder = 'Any command or chat trigger, e.g. !knife or .spawn';
        input.autocomplete = 'off';
        input.spellcheck = false;
        const add = document.createElement('button');
        add.className = 'btn-check-updates';
        add.textContent = 'ADD';
        const doAdd = () => {
            const cmd = input.value.trim();
            if (!cmd) { toast('Type a command first', 'error'); return; }
            const uid = 'custom::' + (++customSeq);
            customDefs.push({ uid, cmd, label: 'Custom' });
            persist();
            openGroups.add('custom');
            input.value = '';
            render();
        };
        add.addEventListener('click', doAdd);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
        row.appendChild(input);
        row.appendChild(add);
        return row;
    }

    function render() {
        accordion.innerHTML = '';
        for (const k of Object.keys(btnByUid)) delete btnByUid[k];

        catalog.forEach(pl => {
            const defs = pl.commands.map(c => ({
                uid: pl.id + '::' + c.cmd, cmd: c.cmd, label: c.label, desc: c.desc, plugin: pl.plugin,
            }));
            accordion.appendChild(group(pl.plugin, pl.id, defs));
        });

        const customRows = customDefs.map(d => ({
            uid: d.uid, cmd: d.cmd, label: d.label || 'Custom',
            desc: '', plugin: 'Custom', custom: true,
        }));
        accordion.appendChild(group('Custom command', 'custom', customRows, customAddRow()));

        const total = Object.keys(binds).length;
        countEl.textContent = total ? `${total} bind${total > 1 ? 's' : ''} set` : '0 binds set';
        countEl.classList.toggle('has', total > 0);
    }

    function downloadCfg(content) {
        const blob = new Blob([content], { type: 'text/plain' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'sBinds.cfg';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    saveBtn.addEventListener('click', async () => {
        const payload = Object.values(binds).map(b => ({ key: b.key, command: b.cmd }));
        if (!payload.length) { toast('Set at least one bind first', 'error'); return; }
        saveBtn.disabled = true;
        resultEl.className = 'binds-result';
        resultEl.textContent = 'Generating…';
        try {
            const data = await fetch('/api/binds/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ binds: payload }),
            }).then(r => r.json());

            if (data.written) {
                resultEl.className = 'binds-result ok';
                resultEl.innerHTML =
                    `✓ Saved ${data.count} bind${data.count > 1 ? 's' : ''} to <code>${data.path}</code><br>` +
                    'In the CS2 console run <code>exec sBinds</code> to apply. ' +
                    '<a id="bindsDl">Download a copy</a>';
                toast('sBinds.cfg saved', 'success');
            } else {
                resultEl.className = 'binds-result warn';
                resultEl.innerHTML =
                    'Could not find your CS2 cfg folder automatically. ' +
                    '<a id="bindsDl">Download sBinds.cfg</a> and drop it into ' +
                    '<code>…\\Counter-Strike Global Offensive\\game\\csgo\\cfg\\</code>, then run <code>exec sBinds</code>.';
                toast('Saved — download & place manually', 'success');
            }
            const dl = document.getElementById('bindsDl');
            if (dl) dl.addEventListener('click', () => downloadCfg(data.content));
        } catch {
            resultEl.className = 'binds-result warn';
            resultEl.textContent = 'Could not reach backend.';
            toast('Could not reach backend', 'error');
        }
        saveBtn.disabled = false;
    });

    clearBtn.addEventListener('click', () => {
        if (!Object.keys(binds).length) return;
        binds = {};
        persist();
        render();
        resultEl.className = 'binds-result';
        resultEl.textContent = '';
        toast('All binds cleared', 'success');
    });

    restore();
    fetch('/api/binds/catalog')
        .then(r => r.json())
        .then(data => { catalog = data || []; render(); })
        .catch(() => { accordion.innerHTML = '<div class="binds-loading">Could not load command catalogue.</div>'; });
})();

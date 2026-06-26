'use strict';

const WEAPON_DISPLAY = {
    weapon_ak47:'AK-47', weapon_aug:'AUG', weapon_famas:'FAMAS',
    weapon_galilar:'Galil AR', weapon_m4a1:'M4A4', weapon_m4a1_silencer:'M4A1-S',
    weapon_sg556:'SG 553',
    weapon_deagle:'Desert Eagle', weapon_elite:'Dual Berettas',
    weapon_fiveseven:'Five-SeveN', weapon_glock:'Glock-18',
    weapon_hkp2000:'P2000', weapon_p250:'P250', weapon_tec9:'Tec-9',
    weapon_usp_silencer:'USP-S', weapon_cz75a:'CZ75-Auto', weapon_revolver:'R8 Revolver',
    weapon_bizon:'PP-Bizon', weapon_mac10:'MAC-10', weapon_mp5sd:'MP5-SD',
    weapon_mp7:'MP7', weapon_mp9:'MP9', weapon_p90:'P90', weapon_ump45:'UMP-45',
    weapon_awp:'AWP', weapon_g3sg1:'G3SG1', weapon_scar20:'SCAR-20', weapon_ssg08:'SSG 08',
    weapon_m249:'M249', weapon_mag7:'MAG-7', weapon_negev:'Negev',
    weapon_nova:'Nova', weapon_sawedoff:'Sawed-Off', weapon_xm1014:'XM1014',
    weapon_bayonet:'Bayonet', weapon_knife_css:'Classic Knife',
    weapon_knife_flip:'Flip Knife', weapon_knife_gut:'Gut Knife',
    weapon_knife_karambit:'Karambit', weapon_knife_m9_bayonet:'M9 Bayonet',
    weapon_knife_tactical:'Huntsman Knife', weapon_knife_falchion:'Falchion Knife',
    weapon_knife_survival_bowie:'Bowie Knife', weapon_knife_butterfly:'Butterfly Knife',
    weapon_knife_push:'Shadow Daggers', weapon_knife_cord:'Paracord Knife',
    weapon_knife_canis:'Survival Knife', weapon_knife_ursus:'Ursus Knife',
    weapon_knife_gypsy_jackknife:'Navaja Knife', weapon_knife_outdoor:'Nomad Knife',
    weapon_knife_stiletto:'Stiletto Knife', weapon_knife_widowmaker:'Talon Knife',
    weapon_knife_skeleton:'Skeleton Knife', weapon_knife_kukri:'Kukri Knife',
};

const CATEGORIES = [
    { id:'rifles',  label:'RIFLES',
      weapons:['weapon_ak47','weapon_aug','weapon_famas','weapon_galilar',
               'weapon_m4a1','weapon_m4a1_silencer','weapon_sg556'] },
    { id:'pistols', label:'PISTOLS',
      weapons:['weapon_deagle','weapon_elite','weapon_fiveseven','weapon_glock',
               'weapon_hkp2000','weapon_p250','weapon_tec9','weapon_usp_silencer',
               'weapon_cz75a','weapon_revolver'] },
    { id:'smgs',    label:'SMGs',
      weapons:['weapon_bizon','weapon_mac10','weapon_mp5sd','weapon_mp7',
               'weapon_mp9','weapon_p90','weapon_ump45'] },
    { id:'snipers', label:'SNIPERS',
      weapons:['weapon_awp','weapon_g3sg1','weapon_scar20','weapon_ssg08'] },
    { id:'heavy',   label:'HEAVY',
      weapons:['weapon_m249','weapon_mag7','weapon_negev','weapon_nova',
               'weapon_sawedoff','weapon_xm1014'] },
    { id:'knives',  label:'KNIVES',  weapons:[] },
    { id:'gloves',  label:'GLOVES',  weapons:[] },
    { id:'agents',  label:'AGENTS',  weapons:[] },
];

const KNIFE_WEAPONS = [
    'weapon_bayonet','weapon_knife_css','weapon_knife_flip','weapon_knife_gut',
    'weapon_knife_karambit','weapon_knife_m9_bayonet','weapon_knife_tactical',
    'weapon_knife_falchion','weapon_knife_survival_bowie','weapon_knife_butterfly',
    'weapon_knife_push','weapon_knife_cord','weapon_knife_canis','weapon_knife_ursus',
    'weapon_knife_gypsy_jackknife','weapon_knife_outdoor','weapon_knife_stiletto',
    'weapon_knife_widowmaker','weapon_knife_skeleton','weapon_knife_kukri',
];

const SP = {
    steamid: null,
    team: 3,                  
    both: false,              
    catalogue: {},            
    glovesCat: [],
    agentsCat: [],
    stickersCat: [],          
    stickerMap: {},           
    currentCategory: 'rifles',
    currentWeapon: null,
    currentKnifeWeapon: null, 
    currentSkinEntry: null,   
    
    selections: { 2: {}, 3: {} },
    
    knife: { 2: null, 3: null },
    
    glove: { 2: null, 3: null },
    
    agent: { 2: null, 3: null },
    
    _activeStickerSlot: -1,
};

const backdrop       = document.getElementById('spBackdrop');
const spSteamIdEl    = document.getElementById('spSteamId');
const spCategoriesEl = document.getElementById('spCategories');
const spWeaponListEl = document.getElementById('spWeaponList');
const spGridHeaderEl = document.getElementById('spGridHeader');
const spGridEl       = document.getElementById('spGrid');
const spPreviewEmpty = document.getElementById('spPreviewEmpty');
const spPreviewContent = document.getElementById('spPreviewContent');
const spPreviewImg   = document.getElementById('spPreviewImg');
spPreviewImg.onerror = () => { spPreviewImg.style.display = 'none'; };
const spPreviewName  = document.getElementById('spPreviewName');
const spWearSlider   = document.getElementById('spWearSlider');
const spWearVal      = document.getElementById('spWearVal');
const spWearCond     = document.getElementById('spWearCond');
const spSeedInput    = document.getElementById('spSeedInput');
const spNametagInput = document.getElementById('spNametagInput');
const spStattrak     = document.getElementById('spStattrakToggle');
const spSaveBtn      = document.getElementById('spSaveBtn');
const spFooterHint   = document.getElementById('spFooterHint');
const spCloseBtn     = document.getElementById('spCloseBtn');

window.openSkinPicker = async function(steamid) {
    SP.steamid = steamid;
    spSteamIdEl.textContent = steamid;
    localStorage.setItem('cs2prak_steamid', steamid);
    backdrop.classList.add('open');

    if (Object.keys(SP.catalogue).length === 0) {
        await loadCatalogues();
    }
    await loadPlayerData(steamid);
    renderCategories();
    selectCategory('rifles');
};

async function loadCatalogues() {
    const [s, g, a, st] = await Promise.all([
        fetch('/api/catalogue/skins').then(r => r.json()),
        fetch('/api/catalogue/gloves').then(r => r.json()),
        fetch('/api/catalogue/agents').then(r => r.json()),
        fetch('/api/catalogue/stickers').then(r => r.json()),
    ]);
    SP.catalogue = s;
    SP.glovesCat = g;
    SP.agentsCat = a;
    SP.stickersCat = st;
    SP.stickerMap = {};
    for (const s of st) {
        
        s._lc = s.name.toLowerCase().replace(/^sticker \| /, '');
        SP.stickerMap[parseInt(s.id)] = s;
    }
}

async function loadPlayerData(steamid) {
    try {
        const data = await fetch(`/api/player/${steamid}`).then(r => r.json());

        SP.selections = { 2: {}, 3: {} };
        for (const row of (data.skins || [])) {
            const t = row.weapon_team;
            if (!SP.selections[t]) SP.selections[t] = {};
            SP.selections[t][row.weapon_defindex] = {
                paint_id: row.weapon_paint_id,
                wear: row.weapon_wear,
                seed: row.weapon_seed,
                nametag: row.weapon_nametag || '',
                stattrak: !!row.weapon_stattrak,
                stattrak_count: row.weapon_stattrak_count,
                stickers: [
                    parseStickerStr(row.weapon_sticker_0),
                    parseStickerStr(row.weapon_sticker_1),
                    parseStickerStr(row.weapon_sticker_2),
                    parseStickerStr(row.weapon_sticker_3),
                    parseStickerStr(row.weapon_sticker_4),
                ],
            };
        }

        SP.knife = { 2: null, 3: null };
        for (const row of (data.knives || [])) {
            SP.knife[row.weapon_team] = row.knife;
        }

        SP.glove = { 2: null, 3: null };
        for (const row of (data.gloves || [])) {
            SP.glove[row.weapon_team] = { defindex: row.weapon_defindex };
        }

        SP.agent = { 2: null, 3: null };
        if (data.agents && data.agents.agent_ct) SP.agent[3] = data.agents.agent_ct;
        if (data.agents && data.agents.agent_t)  SP.agent[2] = data.agents.agent_t;

    } catch(e) {
        console.error('Failed to load player data', e);
    }
}

function renderCategories() {
    spCategoriesEl.innerHTML = '';
    for (const cat of CATEGORIES) {
        const btn = document.createElement('button');
        btn.className = 'sp-cat-btn';
        btn.dataset.id = cat.id;
        btn.textContent = cat.label;
        btn.addEventListener('click', () => selectCategory(cat.id));
        spCategoriesEl.appendChild(btn);
    }
}

function selectCategory(catId) {
    SP.currentCategory = catId;
    SP.currentWeapon   = null;
    SP.currentSkinEntry = null;

    document.querySelectorAll('.sp-cat-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.id === catId);
    });

    renderWeaponList(catId);

    if (catId === 'knives') {
        
        const knifeWpn = SP.knife[SP.team] || KNIFE_WEAPONS[0];
        selectWeapon(knifeWpn);
    } else if (catId === 'gloves') {
        renderGlovesGrid();
    } else if (catId === 'agents') {
        renderAgentsGrid();
    } else {
        const cat = CATEGORIES.find(c => c.id === catId);
        if (cat && cat.weapons.length) selectWeapon(cat.weapons[0]);
    }
}

function renderWeaponList(catId) {
    spWeaponListEl.innerHTML = '';

    let weapons = [];
    if (catId === 'knives') {
        weapons = KNIFE_WEAPONS;
    } else {
        const cat = CATEGORIES.find(c => c.id === catId);
        weapons = cat ? cat.weapons : [];
    }

    if (catId === 'knives' || catId === 'gloves' || catId === 'agents') {
        spWeaponListEl.innerHTML = '';
        return;
    }

    for (const wn of weapons) {
        if (!SP.catalogue[wn]) continue;
        const btn = document.createElement('button');
        btn.className = 'sp-weapon-btn';
        btn.dataset.weapon = wn;
        btn.textContent = WEAPON_DISPLAY[wn] || wn;

        if (catId === 'knives') {
            if (SP.knife[SP.team] === wn) btn.classList.add('has-skin');
        } else {
            const def = SP.catalogue[wn]?.[0]?.weapon_defindex;
            if (def && SP.selections[SP.team]?.[def]) btn.classList.add('has-skin');
        }

        btn.addEventListener('click', () => selectWeapon(wn));
        spWeaponListEl.appendChild(btn);
    }
}

function selectWeapon(weaponName) {
    SP.currentWeapon = weaponName;

    document.querySelectorAll('.sp-weapon-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.weapon === weaponName);
    });

    if (SP.currentCategory === 'knives') {
        SP.currentKnifeWeapon = weaponName;
        renderSkinsGrid(weaponName, true);
    } else {
        renderSkinsGrid(weaponName, false);
    }
}

function renderSkinsGrid(weaponName, isKnife) {
    spGridEl.innerHTML = '';
    const skins = SP.catalogue[weaponName] || [];
    const displayName = WEAPON_DISPLAY[weaponName] || weaponName;
    spGridHeaderEl.textContent = displayName + ' — ' + skins.length + ' SKINS';

    let knifeSelector = document.getElementById('spKnifeSelector');
    if (knifeSelector) knifeSelector.remove();

    if (isKnife) {
        knifeSelector = document.createElement('div');
        knifeSelector.id = 'spKnifeSelector';
        knifeSelector.className = 'sp-knife-selector';
        knifeSelector.innerHTML = `
            <span class="sp-knife-selector-label">KNIFE TYPE (${SP.both ? 'BOTH' : (SP.team === 3 ? 'CT' : 'T')})</span>
            <select class="sp-knife-select" id="spKnifeTypeSelect">
                ${KNIFE_WEAPONS.filter(w => SP.catalogue[w]).map(w =>
                    `<option value="${w}" ${w === weaponName ? 'selected' : ''}>${WEAPON_DISPLAY[w] || w}</option>`
                ).join('')}
            </select>`;
        spGridEl.parentElement.insertBefore(knifeSelector, spGridHeaderEl.nextSibling);
        document.getElementById('spKnifeTypeSelect').addEventListener('change', e => {
            selectWeapon(e.target.value);
        });
    }

    const defindex = skins[0]?.weapon_defindex;
    const currentSel = defindex ? SP.selections[SP.team]?.[defindex] : null;

    for (const skin of skins) {
        const card = document.createElement('div');
        card.className = 'sp-skin-card';

        const isSelected = isKnife
            ? (SP.knife[SP.team] === weaponName && currentSel?.paint_id == skin.paint)
            : (currentSel?.paint_id == skin.paint);

        if (isSelected) card.classList.add('selected');

        const skinPart = skin.paint_name.includes('|')
            ? skin.paint_name.split('|').slice(1).join('|').trim()
            : skin.paint_name;

        card.appendChild(createImgWrap(skin.image));
        const nameEl = document.createElement('div');
        nameEl.className = 'sp-skin-name';
        nameEl.textContent = skinPart;
        card.appendChild(nameEl);

        card.addEventListener('click', () => selectSkin(skin, card, isKnife));
        spGridEl.appendChild(card);

        if (isSelected) showPreview(skin, currentSel);
    }

    if (!currentSel) hidePreview();
}

const IMG_PLACEHOLDER = `<svg class="sp-skin-img-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.25"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;

function removeKnifeSelector() {
    const ks = document.getElementById('spKnifeSelector');
    if (ks) ks.remove();
}

function createImgWrap(url) {
    const wrap = document.createElement('div');
    wrap.className = 'sp-skin-img-wrap';
    if (url) {
        const img = document.createElement('img');
        img.className = 'sp-skin-img';
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        img.onerror = () => { wrap.innerHTML = IMG_PLACEHOLDER; };
        wrap.appendChild(img);
    } else {
        wrap.innerHTML = IMG_PLACEHOLDER;
    }
    return wrap;
}

function renderGlovesGrid() {
    removeKnifeSelector();
    spWeaponListEl.innerHTML = '';
    spGridHeaderEl.textContent = 'GLOVES';
    spGridEl.innerHTML = '';

    const currentGlove = SP.glove[SP.team];

    for (const glove of SP.glovesCat) {
        if (!glove.paint_name || glove.paint_name === 'Gloves | Default') continue;
        const card = document.createElement('div');
        card.className = 'sp-skin-card';

        const isSelected = currentGlove &&
            currentGlove.defindex === glove.weapon_defindex &&
            currentGlove.paint_id == glove.paint;
        if (isSelected) card.classList.add('selected');

        const namePart = glove.paint_name.includes('|')
            ? glove.paint_name.split('|').slice(1).join('|').trim()
            : glove.paint_name;

        card.appendChild(createImgWrap(glove.image));
        const gloveNameEl = document.createElement('div');
        gloveNameEl.className = 'sp-skin-name';
        gloveNameEl.textContent = namePart;
        card.appendChild(gloveNameEl);

        card.addEventListener('click', () => {
            document.querySelectorAll('.sp-skin-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            SP.glove[SP.team] = { defindex: glove.weapon_defindex, paint_id: glove.paint };
            syncBoth();
            showPreviewBasic(glove.image, glove.paint_name);
        });

        spGridEl.appendChild(card);
        if (isSelected) showPreviewBasic(glove.image, glove.paint_name);
    }
}

function renderAgentsGrid() {
    removeKnifeSelector();
    spWeaponListEl.innerHTML = '';
    spGridHeaderEl.textContent = (SP.team === 3 ? 'AGENTS — CT' : 'AGENTS — T')
        + (SP.both ? ' (agents are set per side)' : '');
    spGridEl.innerHTML = '';

    const filtered = SP.agentsCat.filter(a => a.team === SP.team && a.model !== 'null');
    const currentModel = SP.agent[SP.team];

    for (const agent of filtered) {
        const card = document.createElement('div');
        card.className = 'sp-skin-card';
        if (agent.model === currentModel) card.classList.add('selected');

        const namePart = agent.agent_name.includes('|')
            ? agent.agent_name.split('|')[0].trim()
            : agent.agent_name;

        card.appendChild(createImgWrap(agent.image));
        const agentNameEl = document.createElement('div');
        agentNameEl.className = 'sp-skin-name';
        agentNameEl.textContent = namePart;
        card.appendChild(agentNameEl);

        card.addEventListener('click', () => {
            document.querySelectorAll('.sp-skin-card').forEach(c => c.classList.remove('selected'));
            card.classList.add('selected');
            SP.agent[SP.team] = agent.model;
            showPreviewBasic(agent.image, agent.agent_name);
        });

        spGridEl.appendChild(card);
        if (agent.model === currentModel) showPreviewBasic(agent.image, agent.agent_name);
    }
}

function selectSkin(skinEntry, card, isKnife) {
    document.querySelectorAll('.sp-skin-card').forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    SP.currentSkinEntry = skinEntry;

    const defindex = skinEntry.weapon_defindex;
    const team = SP.team;

    const existing = SP.selections[team]?.[defindex] || {};
    const cfg = {
        paint_id: Number(skinEntry.paint) || 0,
        wear:     existing.wear     ?? 0.01,
        seed:     existing.seed     ?? 0,
        nametag:  existing.nametag  ?? '',
        stattrak: existing.stattrak ?? false,
        stattrak_count: existing.stattrak_count ?? 0,
        stickers: existing.stickers ?? [0, 0, 0, 0, 0],
    };
    closeStickerPanel();

    if (!SP.selections[team]) SP.selections[team] = {};
    SP.selections[team][defindex] = cfg;

    if (isKnife) {
        SP.knife[team] = SP.currentKnifeWeapon;
        
        renderWeaponList('knives');
    } else {
        renderWeaponList(SP.currentCategory);
    }

    syncBoth();
    showPreview(skinEntry, cfg);
}

function showPreview(skinEntry, cfg) {
    spPreviewEmpty.style.display = 'none';
    spPreviewContent.style.display = 'flex';

    spPreviewImg.style.display = '';
    spPreviewImg.src = skinEntry.image || '';
    if (!skinEntry.image) spPreviewImg.style.display = 'none';
    spPreviewName.textContent = skinEntry.paint_name || '';

    spWearSlider.value = cfg.wear;
    updateWearDisplay(cfg.wear);
    spSeedInput.value     = cfg.seed || 0;
    spNametagInput.value  = cfg.nametag || '';
    spStattrak.checked    = !!cfg.stattrak;

    renderStickerSlots();
}

function showPreviewBasic(imageUrl, name) {
    spPreviewEmpty.style.display = 'none';
    spPreviewContent.style.display = 'flex';
    spPreviewImg.style.display = '';
    spPreviewImg.src = imageUrl;
    spPreviewName.textContent = name;
    spWearSlider.value = 0.01;
    spSeedInput.value = 0;
    spNametagInput.value = '';
    spStattrak.checked = false;
    updateWearDisplay(0.01);
    
    const rowEl = document.getElementById('spStickerRow');
    if (rowEl) rowEl.style.display = 'none';
}

function hidePreview() {
    closeStickerPanel();
    spPreviewEmpty.style.display = '';
    spPreviewContent.style.display = 'none';
    SP.currentSkinEntry = null;
}

function getCondition(w) {
    if (w < 0.07) return ['Factory New', 'fn'];
    if (w < 0.15) return ['Minimal Wear', 'mw'];
    if (w < 0.38) return ['Field-Tested', 'ft'];
    if (w < 0.45) return ['Well-Worn', 'ww'];
    return ['Battle-Scarred', 'bs'];
}

function updateWearDisplay(w) {
    const pct = (w / 1) * 100;
    spWearSlider.style.setProperty('--pct', pct + '%');
    spWearVal.textContent = Number(w).toFixed(4);
    const [label, cls] = getCondition(w);
    spWearCond.textContent = label;
    spWearCond.className = 'sp-wear-cond ' + cls;
}

spWearSlider.addEventListener('input', () => {
    const w = parseFloat(spWearSlider.value);
    updateWearDisplay(w);
    persistCurrentConfig();
});

spSeedInput.addEventListener('input', persistCurrentConfig);
spNametagInput.addEventListener('input', persistCurrentConfig);
spStattrak.addEventListener('change', persistCurrentConfig);

function persistCurrentConfig() {
    if (!SP.currentSkinEntry) return;
    const defindex = SP.currentSkinEntry.weapon_defindex;
    const team = SP.team;
    if (!SP.selections[team]?.[defindex]) return;
    SP.selections[team][defindex].wear         = parseFloat(spWearSlider.value);
    SP.selections[team][defindex].seed         = parseInt(spSeedInput.value) || 0;
    SP.selections[team][defindex].nametag      = spNametagInput.value.trim() || null;
    SP.selections[team][defindex].stattrak     = spStattrak.checked;
    syncBoth();
}

document.querySelectorAll('.sp-team-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.sp-team-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (btn.dataset.team === 'both') {

            SP.both = true;
            SP.team = 3;
            syncBoth();
        } else {
            SP.both = false;
            SP.team = parseInt(btn.dataset.team);
        }
        
        selectCategory(SP.currentCategory);
    });
});

function syncBoth() {
    if (!SP.both) return;
    const src = SP.selections[3] || {};
    const copy = {};
    for (const [defindex, cfg] of Object.entries(src)) {
        copy[defindex] = { ...cfg, stickers: (cfg.stickers || [0, 0, 0, 0, 0]).slice() };
    }
    SP.selections[2] = copy;
    SP.knife[2] = SP.knife[3];
    SP.glove[2] = SP.glove[3] ? { ...SP.glove[3] } : null;
}

spSaveBtn.addEventListener('click', async () => {
    spSaveBtn.disabled = true;
    spFooterHint.textContent = 'Saving…';

    const payload = buildPayload();
    try {
        const res = await fetch(`/api/player/${SP.steamid}/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (data.ok) {
            spFooterHint.textContent = SP.both ? 'Saved to both sides' : 'Saved successfully';
            setTimeout(() => { spFooterHint.textContent = ''; }, 3000);
        } else {
            spFooterHint.textContent = 'Error: ' + (data.message || 'unknown');
        }
    } catch {
        spFooterHint.textContent = 'Save failed — is MySQL running?';
    }
    spSaveBtn.disabled = false;
});

function buildPayload() {
    syncBoth();  

    const skins = [];
    const knives = [];
    const gloves = [];

    for (const team of [2, 3]) {
        for (const [defindex, cfg] of Object.entries(SP.selections[team] || {})) {
            skins.push({
                team, defindex: parseInt(defindex),
                paint_id: cfg.paint_id,
                wear: cfg.wear,
                seed: cfg.seed,
                nametag: cfg.nametag || null,
                stattrak: cfg.stattrak,
                stattrak_count: cfg.stattrak_count || 0,
                stickers: (cfg.stickers || [0,0,0,0,0]).map(buildStickerStr),
            });
        }

        if (SP.knife[team]) {
            knives.push({ team, knife: SP.knife[team] });
        }

        if (SP.glove[team]) {
            gloves.push({ team, defindex: SP.glove[team].defindex });
            
            if (SP.glove[team].paint_id) {
                skins.push({
                    team, defindex: SP.glove[team].defindex,
                    paint_id: SP.glove[team].paint_id,
                    wear: 0.01, seed: 0, nametag: null,
                    stattrak: false, stattrak_count: 0,
                });
            }
        }
    }

    return {
        skins,
        knives,
        gloves,
        agents: { ct: SP.agent[3], t: SP.agent[2] },
    };
}

spCloseBtn.addEventListener('click', closePicker);
backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closePicker();
});

function closePicker() {
    backdrop.classList.remove('open');
}

function parseStickerStr(str) {
    if (!str) return 0;
    return parseInt(str.split(';')[0]) || 0;
}

function buildStickerStr(id) {
    if (!id) return '0;0;0;0;0;0;0';
    return `${id};0;0;0;0;1;0`;
}

function currentSkinCfg() {
    if (!SP.currentSkinEntry) return null;
    const defindex = SP.currentSkinEntry.weapon_defindex;
    return SP.selections[SP.team]?.[defindex] || null;
}

function renderStickerSlots() {
    const slotsEl = document.getElementById('spStickerSlots');
    const rowEl   = document.getElementById('spStickerRow');
    if (!slotsEl || !rowEl) return;

    if (SP.currentCategory === 'knives' || SP.currentCategory === 'agents' || SP.currentCategory === 'gloves') {
        rowEl.style.display = 'none';
        slotsEl.innerHTML = '';
        return;
    }
    rowEl.style.display = '';

    const cfg = currentSkinCfg();
    slotsEl.innerHTML = '';
    if (!cfg) return;

    const stickers = cfg.stickers || [0, 0, 0, 0, 0];
    for (let i = 0; i < 5; i++) {
        const id = stickers[i] || 0;
        const entry = id ? SP.stickerMap[id] : null;
        const isActive = SP._activeStickerSlot === i;

        const slot = document.createElement('div');
        slot.className = 'sp-sticker-slot' +
            (id ? ' has-sticker' : '') +
            (isActive ? ' active' : '');
        slot.title = entry ? entry.name : `Slot ${i + 1}`;

        if (entry) {
            const img = document.createElement('img');
            img.src = entry.image;
            img.alt = '';
            img.className = 'sp-sticker-slot-img';
            img.loading = 'lazy';
            slot.appendChild(img);
        } else {
            const plus = document.createElement('span');
            plus.className = 'sp-sticker-slot-plus';
            plus.textContent = '+';
            slot.appendChild(plus);
        }

        const num = document.createElement('span');
        num.className = 'sp-sticker-slot-num';
        num.textContent = i + 1;
        slot.appendChild(num);

        slot.addEventListener('click', () => toggleStickerPanel(i));
        slotsEl.appendChild(slot);
    }
}

const stpBackdrop = document.getElementById('stpBackdrop');
const stpSearch   = document.getElementById('stpSearch');
const stpGrid     = document.getElementById('stpGrid');
const stpSlotNum  = document.getElementById('stpSlotNum');

function toggleStickerPanel(slot) {
    if (SP._activeStickerSlot === slot && stpBackdrop.style.display !== 'none') {
        closeStickerPanel();
    } else {
        SP._activeStickerSlot = slot;
        renderStickerSlots();
        openStickerPanel();
    }
}

function openStickerPanel() {
    stpSlotNum.textContent = SP._activeStickerSlot + 1;
    stpSearch.value = '';
    renderStickerGrid('');
    stpBackdrop.style.display = 'flex';
    stpSearch.focus();
}

function closeStickerPanel() {
    SP._activeStickerSlot = -1;
    stpBackdrop.style.display = 'none';
    renderStickerSlots();
}

const STICKER_MAX = 80;

function _stickerMsg(text) {
    const el = document.createElement('div');
    el.className = 'stp-empty';
    el.textContent = text;
    stpGrid.appendChild(el);
}

function renderStickerGrid(query) {
    stpGrid.innerHTML = '';
    const q = query.toLowerCase().trim();

    if (q.length < 2) {
        _stickerMsg(q.length === 0 ? 'Type to search stickers…' : 'Keep typing…');
        return;
    }

    const frag = document.createDocumentFragment();
    let shown = 0, total = 0;

    for (const s of SP.stickersCat) {
        if (!s._lc.includes(q)) continue;
        total++;
        if (shown < STICKER_MAX) {
            const card = document.createElement('div');
            card.className = 'sp-skin-card';
            card.title = s.name;
            card.appendChild(createImgWrap(s.image));
            const nameEl = document.createElement('div');
            nameEl.className = 'sp-skin-name';
            nameEl.textContent = s.name.includes('| ') ? s.name.slice(s.name.indexOf('| ') + 2) : s.name;
            card.appendChild(nameEl);
            card.addEventListener('click', () => pickSticker(parseInt(s.id)));
            frag.appendChild(card);
            shown++;
        }
    }

    if (total === 0) { _stickerMsg('No stickers found'); return; }

    stpGrid.appendChild(frag);

    if (total > STICKER_MAX) {
        _stickerMsg(`Showing ${STICKER_MAX} of ${total} — type more to narrow results`);
    }
}

function pickSticker(stickerId) {
    const slot = SP._activeStickerSlot;
    if (slot < 0) return;
    const cfg = currentSkinCfg();
    if (!cfg) return;
    if (!cfg.stickers) cfg.stickers = [0, 0, 0, 0, 0];
    cfg.stickers[slot] = stickerId;
    syncBoth();
    closeStickerPanel();
}

let _stickerTimer = null;
stpSearch.addEventListener('input', e => {
    clearTimeout(_stickerTimer);
    _stickerTimer = setTimeout(() => renderStickerGrid(e.target.value), 250);
});

document.getElementById('stpCloseBtn').addEventListener('click', closeStickerPanel);

stpBackdrop.addEventListener('click', e => {
    if (e.target === stpBackdrop) closeStickerPanel();
});

document.getElementById('stpClearBtn').addEventListener('click', () => {
    const slot = SP._activeStickerSlot;
    if (slot < 0) return;
    const cfg = currentSkinCfg();
    if (!cfg) return;
    if (!cfg.stickers) cfg.stickers = [0, 0, 0, 0, 0];
    cfg.stickers[slot] = 0;
    syncBoth();
    closeStickerPanel();
});

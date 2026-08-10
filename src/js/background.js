const STORAGE_KEY = 'fillit_values';
const CATEGORIES_KEY = 'fillit_categories';
const LEGACY_USAGE_COUNTS_KEY = 'fillit_usage_counts';
const LEGACY_ACCOUNT_STATUS_KEY = 'fillit_account_connected';

const DEBUG = false;
const flog = (...a) => { if (DEBUG) console.log(...a); };

function generateId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    else return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CATEGORIES_KEY])
        createContextMenu();
});

chrome.runtime.onInstalled.addListener(async details => {
    if (['install', 'update', 'chrome_update'].includes(details.reason)) {
        const result = await chrome.storage.local.get([STORAGE_KEY]);
        if (!result[STORAGE_KEY]) await initStorage();
        else await migrateStorage();
        logStorage();
    } else flog(details.reason);

    createContextMenu();
    chrome.storage.local.remove(LEGACY_ACCOUNT_STATUS_KEY);
    flog("Fillit extension enabled.");
});

async function logStorage() {
    if (!DEBUG) return;
    const storage = await chrome.storage.local.get([STORAGE_KEY, CATEGORIES_KEY]);
    console.log(storage);
}

function initStorage() {
    return chrome.storage.local.set({
        [CATEGORIES_KEY]: [],
        [STORAGE_KEY]: {}
    });
}

async function migrateStorage() {
    const result = await chrome.storage.local.get([STORAGE_KEY, CATEGORIES_KEY, LEGACY_USAGE_COUNTS_KEY]);
    const values = result[STORAGE_KEY] || {};
    let categories = result[CATEGORIES_KEY];
    const legacyCounts = result[LEGACY_USAGE_COUNTS_KEY] || {};
    let changed = false;

    if (!categories) {
        const legacyMap = {
            email: 'Email', phone: 'Telefone', name: 'Nome',
            cpf: 'CPF', cnpj: 'CNPJ', address: 'Endereço', zipcode: 'CEP'
        };

        categories = Object.keys(values).map(key => ({
            id: key,
            label: legacyMap[key] || key
        }));
        await chrome.storage.local.set({ [CATEGORIES_KEY]: categories });
    }

    Object.keys(values).forEach(category => {
        values[category] = (values[category] || []).map(item => {
            if (typeof item === 'string') {
                changed = true;
                return { id: generateId(), value: item, usageCount: legacyCounts[item] || 0, favorite: false };
            }

            let migrated = item;
            if (migrated.favorite === undefined) {
                changed = true;
                migrated = { ...migrated, favorite: false };
            }
            if (!migrated.id) {
                changed = true;
                migrated = { ...migrated, id: generateId() };
            }
            return migrated;
        });
    });

    if (changed) await chrome.storage.local.set({ [STORAGE_KEY]: values });
    if (result[LEGACY_USAGE_COUNTS_KEY]) await chrome.storage.local.remove(LEGACY_USAGE_COUNTS_KEY);
}

let menuQueue = Promise.resolve();

// [L3/L3b] Fila única de escrita do service worker.
let writeQueue = Promise.resolve();
const runExclusive = fn => (writeQueue = writeQueue.then(fn, fn).catch(() => { }));

function createContextMenu() {
    menuQueue = menuQueue.then(rebuildContextMenu).catch(() => { });
    return menuQueue;
}

async function rebuildContextMenu() {
    const result = await chrome.storage.local.get([CATEGORIES_KEY]);
    const categories = result[CATEGORIES_KEY] || [];

    await new Promise(resolve => chrome.contextMenus.removeAll(resolve));

    chrome.contextMenus.create({
        id: 'fillit-root',
        title: 'Adicionar ao Fillit',
        contexts: ['selection']
    });

    categories.forEach(cat => {
        chrome.contextMenus.create({
            id: `fillit-add-${cat.id}`,
            parentId: 'fillit-root',
            title: cat.label,
            contexts: ['selection']
        });
    });
}

function flashBadge(texto, cor) {
    chrome.action.setBadgeBackgroundColor({ color: cor });
    chrome.action.setBadgeText({ text: texto });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
}

function normalizeValue(text) {
    return String(text).trim().toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

const REV_KEY = 'fillit_rev';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'fillit:commit-values') {
        runExclusive(async () => {
            const cur = await chrome.storage.local.get([STORAGE_KEY, REV_KEY]);
            const revAtual = cur[REV_KEY] || 0;
            if (msg.rev !== revAtual) return sendResponse({ ok: false, conflict: true, rev: revAtual });

            await chrome.storage.local.set({ [STORAGE_KEY]: msg.values, [REV_KEY]: revAtual + 1 });
            sendResponse({ ok: true, rev: revAtual + 1 });
        });
        return true;
    }

    if (msg?.type !== 'fillit:increment-usage') return false;
    if (!sender.tab) { sendResponse({ ok: false }); return false; }

    runExclusive(async () => {
        const result = await chrome.storage.local.get([STORAGE_KEY]);
        const values = result[STORAGE_KEY] || {};
        const items = values[msg.category];
        if (!Array.isArray(items)) return sendResponse({ ok: false });

        const target = msg.id
            ? items.find(i => i.id === msg.id)
            : items.find(i => i.value === msg.value);
        if (!target) return sendResponse({ ok: false });

        target.usageCount = (target.usageCount || 0) + 1;
        const rev = (await chrome.storage.local.get([REV_KEY]))[REV_KEY] || 0;
        await chrome.storage.local.set({ [STORAGE_KEY]: values, [REV_KEY]: rev + 1 });
        sendResponse({ ok: true, usageCount: target.usageCount });
    });

    return true;
});

chrome.contextMenus.onClicked.addListener((info) => {
    if (!info.menuItemId.startsWith('fillit-add-')) return;

    runExclusive(async () => {
        const categoryId = info.menuItemId.replace('fillit-add-', '');
        const value = info.selectionText?.trim();
        if (!value) return;

        const result = await chrome.storage.local.get([STORAGE_KEY]);
        const values = result[STORAGE_KEY] || {};
        if (!values[categoryId]) values[categoryId] = [];

        const key = normalizeValue(value);
        if (values[categoryId].some(item => normalizeValue(item.value) === key))
            return flashBadge('=', '#8e8e93');

        values[categoryId].push({ id: generateId(), value, usageCount: 0, favorite: false });
        const rev = (await chrome.storage.local.get([REV_KEY]))[REV_KEY] || 0;
        await chrome.storage.local.set({ [STORAGE_KEY]: values, [REV_KEY]: rev + 1 });
        flashBadge('✓', '#248a3d');
    });
});
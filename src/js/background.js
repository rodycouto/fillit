const STORAGE_KEY = 'fillit_values';
const CATEGORIES_KEY = 'fillit_categories';
const LEGACY_USAGE_COUNTS_KEY = 'fillit_usage_counts';
const ACCOUNT_STATUS_KEY = 'fillit_account_connected';

const DEBUG = false;

function generateId() {
    if (crypto.randomUUID)
        return crypto.randomUUID();
    else return `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function updateAccountStatus() {
    try {
        const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
        await chrome.storage.local.set({ [ACCOUNT_STATUS_KEY]: !!userInfo.email });
    } catch (error) {
        await chrome.storage.local.set({ [ACCOUNT_STATUS_KEY]: false });
    }
}

updateAccountStatus();
chrome.runtime.onStartup.addListener(updateAccountStatus);
if (chrome.identity.onSignInChanged)
    chrome.identity.onSignInChanged.addListener(updateAccountStatus);

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[CATEGORIES_KEY]) {
        createContextMenu();
    }
});

chrome.runtime.onInstalled.addListener(async details => {
    if (['install', 'update', 'chrome_update'].includes(details.reason)) {
        const result = await chrome.storage.local.get([STORAGE_KEY]);
        if (!result[STORAGE_KEY]) await initStorage();
        else await migrateStorage();

        logStorage();
    } else console.log(details.reason);

    createContextMenu();
    updateAccountStatus();
    console.log("Fillit extension enabled.");
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

    if (changed)
        await chrome.storage.local.set({ [STORAGE_KEY]: values });

    if (result[LEGACY_USAGE_COUNTS_KEY])
        await chrome.storage.local.remove(LEGACY_USAGE_COUNTS_KEY);
}

function createContextMenu() {
    chrome.contextMenus.removeAll(async () => {
        chrome.contextMenus.create({
            id: 'fillit-root',
            title: 'Adicionar ao Fillit',
            contexts: ['selection']
        });

        const result = await chrome.storage.local.get([CATEGORIES_KEY]);
        const categories = result[CATEGORIES_KEY] || [];

        categories.forEach(cat => {
            chrome.contextMenus.create({
                id: `fillit-add-${cat.id}`,
                parentId: 'fillit-root',
                title: cat.label,
                contexts: ['selection']
            });
        });
    });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
    if (!info.menuItemId.startsWith('fillit-add-')) return;

    const categoryId = info.menuItemId.replace('fillit-add-', '');
    const value = info.selectionText?.trim();
    if (!value) return;

    const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }).catch(() => ({}));
    if (!userInfo.email) return;

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const values = result[STORAGE_KEY] || {};
    if (!values[categoryId]) values[categoryId] = [];

    const alreadyExists = values[categoryId].some(item => item.value === value);
    if (alreadyExists) return;

    values[categoryId].push({ id: generateId(), value, usageCount: 0, favorite: false });
    await chrome.storage.local.set({ [STORAGE_KEY]: values });
});
const STORAGE_KEY = 'fillit_values';
const LEGACY_USAGE_COUNTS_KEY = 'fillit_usage_counts';
const ACCOUNT_STATUS_KEY = 'fillit_account_connected';

const DEBUG = false;

function generateId() {
    if (crypto.randomUUID)
        return crypto.randomUUID();
    else `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const CATEGORIES = {
    email: 'Email',
    phone: 'Telefone',
    name: 'Nome',
    cpf: 'CPF',
    cnpj: 'CNPJ',
    address: 'Endereço',
    zipcode: 'CEP'
};

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
if (chrome.identity.onSignInChanged) {
    chrome.identity.onSignInChanged.addListener(updateAccountStatus);
}

chrome.runtime.onInstalled.addListener(async details => {
    if (['install', 'update', 'chrome_update'].includes(details.reason)) {

        const result = await chrome.storage.local.get([STORAGE_KEY]);
        if (!result[STORAGE_KEY]) {
            await initStorage();
        } else {
            await migrateStorage();
        }

        logStorage();
    } else {
        console.log(details.reason);
    }

    createContextMenu();
    updateAccountStatus();
    console.log("Fillit extension enabled.");
});

async function logStorage() {
    if (!DEBUG) return;
    const storage = await chrome.storage.local.get([STORAGE_KEY]);
    console.log(storage);
}

function initStorage() {
    return chrome.storage.local.set({
        [STORAGE_KEY]: {
            email: [],
            phone: [],
            name: [],
            cpf: [],
            cnpj: [],
            address: [],
            zipcode: []
        }
    });
}

async function migrateStorage() {
    const result = await chrome.storage.local.get([STORAGE_KEY, LEGACY_USAGE_COUNTS_KEY]);
    const values = result[STORAGE_KEY];
    if (!values) return;

    const legacyCounts = result[LEGACY_USAGE_COUNTS_KEY] || {};
    let changed = false;

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
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'fillit-root',
            title: 'Adicionar ao Fillit',
            contexts: ['selection']
        });

        Object.entries(CATEGORIES).forEach(([category, label]) => {
            chrome.contextMenus.create({
                id: `fillit-add-${category}`,
                parentId: 'fillit-root',
                title: label,
                contexts: ['selection']
            });
        });
    });
}

chrome.contextMenus.onClicked.addListener(async (info) => {
    if (!info.menuItemId.startsWith('fillit-add-')) return;

    const category = info.menuItemId.replace('fillit-add-', '');
    const value = info.selectionText?.trim();
    if (!value) return;

    const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }).catch(() => ({}));
    if (!userInfo.email) return;

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const values = result[STORAGE_KEY] || {};
    if (!values[category]) values[category] = [];

    const alreadyExists = values[category].some(item => item.value === value);
    if (alreadyExists) return;

    values[category].push({ id: generateId(), value, usageCount: 0, favorite: false });
    await chrome.storage.local.set({ [STORAGE_KEY]: values });
});
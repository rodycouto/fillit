const STORAGE_KEY = 'fillit_values';
const LEGACY_USAGE_COUNTS_KEY = 'fillit_usage_counts';
const ACCOUNT_STATUS_KEY = 'fillit_account_connected';

const CATEGORIES = {
  email: 'Email',
  phone: 'Telefone',
  name: 'Nome',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  address: 'Endereço',
  zipcode: 'CEP'
};

// chrome.identity is only available in extension contexts (background,
// popup) — content.js can't call it directly. So we resolve it here and
// mirror the result into storage as a plain boolean, which content.js and
// the popup can both read the same way they already read fillit_values.
async function updateAccountStatus() {
    try {
        const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
        await chrome.storage.local.set({ [ACCOUNT_STATUS_KEY]: !!userInfo.email });
    } catch (error) {
        await chrome.storage.local.set({ [ACCOUNT_STATUS_KEY]: false });
    }
}

// Keep the flag fresh: on every service worker wake-up, on browser start,
// and immediately whenever the person signs in/out of their Chrome profile.
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

// Upgrades items stored as plain strings (older versions of Fillit) into
// the current object shape { value, usageCount, favorite }. Also folds in
// any usage counts left over from the old separate "fillit_usage_counts"
// store, then deletes that store — usage counts now live on the item
// itself, so deleting an item also deletes its count. No orphaned data.
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
                return { value: item, usageCount: legacyCounts[item] || 0, favorite: false };
            }
            if (item.favorite === undefined) {
                changed = true;
                return { ...item, favorite: false };
            }
            return item;
        });
    });

    if (changed) {
        await chrome.storage.local.set({ [STORAGE_KEY]: values });
    }

    if (result[LEGACY_USAGE_COUNTS_KEY]) {
        await chrome.storage.local.remove(LEGACY_USAGE_COUNTS_KEY);
    }
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

    // Same account gate as the popup: no Google account connected to this
    // Chrome profile means Fillit doesn't store anything new, period.
    const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' }).catch(() => ({}));
    if (!userInfo.email) return;

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const values = result[STORAGE_KEY] || {};
    if (!values[category]) values[category] = [];

    const alreadyExists = values[category].some(item => item.value === value);
    if (alreadyExists) return;

    values[category].push({ value, usageCount: 0, favorite: false });
    await chrome.storage.local.set({ [STORAGE_KEY]: values });
});
const STORAGE_KEY = 'fillit_values';

const CATEGORIES = {
  email: 'Email',
  phone: 'Telefone',
  name: 'Nome',
  cpf: 'CPF',
  cnpj: 'CNPJ',
  address: 'Endereço',
  zipcode: 'CEP'
};

chrome.runtime.onInstalled.addListener(details => {
    if (['install', 'update', 'chrome_update'].includes(details.reason)) {

        chrome.storage.local.get([STORAGE_KEY], result => {
            if (!result[STORAGE_KEY]) initStorage();
        });
        logStorage();
    } else {
        console.log(details.reason);
    }

    createContextMenu();
    console.log("Fillit extension enabled.");
});

async function logStorage() {
    const storage = await chrome.storage.local.get([STORAGE_KEY]);
    console.log(storage);
}

function initStorage() {
    chrome.storage.local.set({
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

    const result = await chrome.storage.local.get([STORAGE_KEY]);
    const values = result[STORAGE_KEY] || {};
    if (!values[category]) values[category] = [];

    if (values[category].includes(value)) return;

    values[category].push(value);
    await chrome.storage.local.set({ [STORAGE_KEY]: values });
});
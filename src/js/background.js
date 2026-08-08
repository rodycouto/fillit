chrome.runtime.onInstalled.addListener(details => {
    if (['install', 'update', 'chrome_update'].includes(details.reason)) {

        chrome.storage.local.get(['fillit_values'], result => {
            if (!result.fillit_values) initStorage();
        });
        logStorage();
    } else {
        console.log(details.reason);
    }

    console.log("Fillit extension enabled.");
});

async function logStorage() {
    const storage = await chrome.storage.local.get(['fillit_values']);
    console.log(storage);
}

function initStorage() {
    chrome.storage.local.set({
        fillit_values: {
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
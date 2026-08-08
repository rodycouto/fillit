const STORAGE_KEY = 'fillit_values';
const DEFAULT_VALUES = { email: [], phone: [], name: [], cpf: [], cnpj: [], address: [], zipcode: [] };

const categorySelect = document.getElementById('category');
const valueInput = document.getElementById('value');
const addButton = document.getElementById('add-button');
const list = document.getElementById('list');
const emptyMessage = document.getElementById('empty-message');
const status = document.getElementById('status');
const profileInfo = document.getElementById('profile-info');

const getValues = () =>
  new Promise(resolve => {
    chrome.storage.local.get([STORAGE_KEY], result => {
      resolve(result[STORAGE_KEY] || DEFAULT_VALUES);
    });
  });

const saveValues = values =>
  new Promise(resolve => {
    chrome.storage.local.set({ [STORAGE_KEY]: values }, resolve);
  });

function showStatus(text, isError = false) {
  status.textContent = text;
  status.style.color = isError ? '#dc2626' : '#16a34a';
  setTimeout(() => status.textContent = '', 2000);
}

async function renderList() {
  const category = categorySelect.value;
  const values = await getValues();
  const items = values[category] || [];

  list.innerHTML = '';
  emptyMessage.style.display = items.length ? 'none' : 'block';

  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${item}</span><button title="Remove">✕</button>`;
    li.querySelector('button').addEventListener('click', () => removeValue(category, index));
    list.appendChild(li);
  });
}

async function addValue() {
  const category = categorySelect.value;
  const value = valueInput.value.trim();
  if (!value) return;

  const values = await getValues();
  if (!values[category]) values[category] = [];

  if (values[category].includes(value)) {
    showStatus('Esse valor já está salvo.', true);
    return;
  }

  values[category].push(value);
  await saveValues(values);
  valueInput.value = '';
  showStatus('Valor adicionado!');
  renderList();
}

async function removeValue(category, index) {
  const values = await getValues();
  values[category].splice(index, 1);
  await saveValues(values);
  showStatus('Valor removido.');
  renderList();
}

async function showProfileInfo() {
  try {
    const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    profileInfo.textContent = userInfo.email
      ? `Dados do perfil ${userInfo.email}`  
      : 'Nenhum dado será salvo, pois nenhuma conta Google está conectada a este perfil do Chrome.';
  } catch (error) {
    profileInfo.textContent = 'Conecte uma conta Google para salvar os dados neste perfil do Chrome.';
  }
}

addButton.addEventListener('click', addValue);
valueInput.addEventListener('keydown', e => e.key === 'Enter' && addValue());
categorySelect.addEventListener('change', renderList);

renderList();
showProfileInfo();
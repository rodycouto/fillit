const STORAGE_KEY = 'fillit_values';
const DEFAULT_VALUES = { email: [], phone: [], name: [], cpf: [], cnpj: [], address: [], zipcode: [] };

const categorySelect = document.getElementById('category');
const valueInput = document.getElementById('value');
const addButton = document.getElementById('add-button');
const list = document.getElementById('list');
const emptyMessage = document.getElementById('empty-message');
const status = document.getElementById('status');
const profileInfo = document.getElementById('profile-info');

let timeoutValue = undefined;

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
  status.style.color = isError ? 'var(--danger)' : 'var(--success)';
  
  status.classList.add('show');
  
  if (setTimeout) clearTimeout(timeoutValue);
  timeoutValue = setTimeout(() => {
    status.classList.remove('show');
    timeoutValue = undefined;
    setTimeout(() => status.textContent = '', 300);
  }, 4000); 
}

function toggleButtonState() {
  if (valueInput.value.trim() === '')
    addButton.disabled = true;
  else addButton.disabled = false;
}

async function renderList(animateLast = false) {
  const category = categorySelect.value;
  const values = await getValues();
  const items = values[category] || [];

  emptyMessage.style.display = items.length ? 'none' : 'block';
  list.innerHTML = '';

  items.forEach((item, index) => {
    const li = document.createElement('li');
    
    if (animateLast && index === items.length - 1)
      li.classList.add('adding');

    li.innerHTML = `<span>${item}</span><button title="Remove">✕</button>`;
    
    li.querySelector('button').addEventListener('click', () => removeValue(category, index, li));
    
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
  toggleButtonState(); 
  
  showStatus('Valor adicionado');
  renderList(true);
}

async function removeValue(category, index, liElement) {
  liElement.classList.add('removing');

  setTimeout(async () => {
    const values = await getValues();
    values[category].splice(index, 1);
    await saveValues(values);
    renderList();
  }, 300);
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

categorySelect.addEventListener('wheel', e => {
  e.preventDefault();
  const direction = e.deltaY > 0 ? 1 : -1;
  let newIndex = categorySelect.selectedIndex + direction;

  if (newIndex >= categorySelect.options.length)
    newIndex = 0;
  else if (newIndex < 0)
    newIndex = categorySelect.options.length - 1;


  categorySelect.selectedIndex = newIndex;
  categorySelect.dispatchEvent(new Event('change'));
}, { passive: false });


addButton.addEventListener('click', addValue);
valueInput.addEventListener('keydown', e => e.key === 'Enter' && addValue());
valueInput.addEventListener('input', toggleButtonState);
categorySelect.addEventListener('change', () => renderList()); 

renderList();
showProfileInfo();
toggleButtonState();
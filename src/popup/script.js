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
let accountConnected = false;

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
  if (!status) return;
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
  if (addButton && valueInput) {
    addButton.disabled = !accountConnected || valueInput.value.trim() === '';
  }
}

async function renderList() {
  const category = categorySelect.value;
  const values = await getValues();
  const items = values[category] || [];

  if (emptyMessage) {
    emptyMessage.style.display = items.length ? 'none' : 'block';
  }
  list.innerHTML = '';

  const sortedItems = items.map((item, originalIndex) => ({ ...item, originalIndex }));
  sortedItems.sort((a, b) => (b.favorite === true) - (a.favorite === true));

  sortedItems.forEach((item) => {
    const li = createItemElement(category, item.originalIndex, item);
    list.appendChild(li);
  });
}

function createItemElement(category, actualIndex, item) {
  const li = document.createElement('li');
  li.dataset.index = actualIndex;
  updateLiContent(li, category, actualIndex, item);
  return li;
}

function updateLiContent(li, category, actualIndex, item) {
  const isFavClass = item.favorite ? 'fav-btn active' : 'fav-btn';
  const favSymbol = item.favorite ? '★' : '☆';

  li.innerHTML = '';

  const span = document.createElement('span');
  span.textContent = item.value;

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'actions';

  const favBtn = document.createElement('button');
  favBtn.className = isFavClass;
  favBtn.title = 'Favoritar';
  favBtn.textContent = favSymbol;

  const editBtn = document.createElement('button');
  editBtn.className = 'edit-btn';
  editBtn.title = 'Editar';
  editBtn.textContent = '✎';

  const removeBtn = document.createElement('button');
  removeBtn.className = 'remove-btn';
  removeBtn.title = 'Remover';
  removeBtn.textContent = '✕';

  actionsDiv.appendChild(favBtn);
  actionsDiv.appendChild(editBtn);
  actionsDiv.appendChild(removeBtn);

  li.appendChild(span);
  li.appendChild(actionsDiv);

  favBtn.addEventListener('click', () => toggleFavorite(category, actualIndex));
  editBtn.addEventListener('click', () => enterEditMode(li, category, actualIndex, item.value));
  removeBtn.addEventListener('click', () => removeValue(category, actualIndex, li));
}

async function addValue() {
  if (!accountConnected) {
    showStatus('Conecte uma conta Google a este perfil do Chrome para adicionar itens.', true);
    return;
  }

  const category = categorySelect.value;
  const value = valueInput.value.trim();
  if (!value) return;

  const values = await getValues();
  if (!values[category]) values[category] = [];

  const alreadyExists = values[category].some(item => item.value === value);
  if (alreadyExists) {
    showStatus('Esse valor já está salvo.', true);
    return;
  }

  const newItem = { value, usageCount: 0, favorite: false };
  values[category].unshift(newItem);
  await saveValues(values);

  valueInput.value = '';
  toggleButtonState();
  showStatus('Valor adicionado');

  await renderList();

  const firstLi = list.firstElementChild;
  if (firstLi) {
    firstLi.classList.add('adding');
  }
}

async function removeValue(category, index, liElement) {
  liElement.classList.add('removing');

  setTimeout(async () => {
    const values = await getValues();
    values[category].splice(index, 1);
    await saveValues(values);
    renderList();
  }, 600);
}

async function showProfileInfo() {
  if (!profileInfo) return;
  try {
    const userInfo = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
    accountConnected = !!userInfo.email;

    profileInfo.textContent = accountConnected
      ? `Dados do perfil ${userInfo.email}`
      : 'Nenhum dado será salvo, pois nenhuma conta Google está conectada a este perfil do Chrome.';
  } catch (error) {
    accountConnected = false;
    profileInfo.textContent = 'Conecte uma conta Google para salvar os dados neste perfil do Chrome.';
  }

  applyAccountGate();
}

function applyAccountGate() {
  if (valueInput) {
    valueInput.disabled = !accountConnected;
    valueInput.placeholder = accountConnected
      ? 'Adicionar item...'
      : 'Conecte uma conta Google para adicionar';
  }

  if (profileInfo) {
    profileInfo.style.color = accountConnected ? '' : 'var(--danger)';
  }

  toggleButtonState();
}

async function toggleFavorite(category, index) {
  const values = await getValues();
  if (values[category] && values[category][index]) {
    values[category][index].favorite = !values[category][index].favorite;
    await saveValues(values);
    renderList();
  }
}

function enterEditMode(li, category, index, currentValue) {
  li.dataset.originalHTML = li.innerHTML;
  li.classList.add('editing');
  li.innerHTML = '';

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'edit-input';
  editInput.value = currentValue;
  editInput.autocomplete = 'off';

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-edit-btn';
  saveBtn.title = 'Salvar';
  saveBtn.textContent = '✓';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cancel-edit-btn';
  cancelBtn.title = 'Cancelar';
  cancelBtn.textContent = '✕';

  actionsDiv.appendChild(saveBtn);
  actionsDiv.appendChild(cancelBtn);

  li.appendChild(editInput);
  li.appendChild(actionsDiv);

  editInput.focus();
  editInput.setSelectionRange(editInput.value.length, editInput.value.length);

  const saveEdit = async () => {
    const newValue = editInput.value.trim();
    if (!newValue) return;

    const values = await getValues();
    if (values[category]) {
      const alreadyExists = values[category].some((item, idx) => idx !== index && item.value === newValue);
      if (alreadyExists)
        return showStatus('Esse valor já está salvo.', true);

      if (values[category][index]) {
        values[category][index].value = newValue;
        await saveValues(values);

        updateLiContent(li, category, index, values[category][index]);
        li.classList.remove('editing');
        showStatus('Item atualizado');
      }
    }
  };

  saveBtn.addEventListener('click', saveEdit);
  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') {
      li.innerHTML = li.dataset.originalHTML;
      li.classList.remove('editing');
    }
  });
  cancelBtn.addEventListener('click', () => {
    li.innerHTML = li.dataset.originalHTML;
    li.classList.remove('editing');
  });
}

if (categorySelect) {
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

  categorySelect.addEventListener('change', () => renderList());
}

if (addButton)
  addButton.addEventListener('click', addValue);


if (valueInput) {
  valueInput.addEventListener('keydown', e => e.key === 'Enter' && addValue());
  valueInput.addEventListener('input', toggleButtonState);
}

renderList();
showProfileInfo();
toggleButtonState();
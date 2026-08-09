const STORAGE_KEY = 'fillit_values';
const LAST_CATEGORY_KEY = 'fillit_last_category';
const DEFAULT_VALUES = { email: [], phone: [], name: [], cpf: [], cnpj: [], address: [], zipcode: [] };

function generateId() {
  return (crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function saveLastCategory(category) {
  chrome.storage.local.set({ [LAST_CATEGORY_KEY]: category });
}

const restoreLastCategory = () =>
  new Promise(resolve => {
    chrome.storage.local.get([LAST_CATEGORY_KEY], result => {
      if (!chrome.runtime.lastError) {
        const saved = result[LAST_CATEGORY_KEY];
        if (categorySelect && saved && [...categorySelect.options].some(opt => opt.value === saved))
          categorySelect.value = saved;
      }

      resolve();
    });
  });

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
  new Promise((resolve, reject) => {
    chrome.storage.local.get([STORAGE_KEY], result => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(result[STORAGE_KEY] || DEFAULT_VALUES);
    });
  });

const saveValues = values =>
  new Promise((resolve, reject) => {
    chrome.storage.local.set({ [STORAGE_KEY]: values }, () => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve();
    });
  });

let storageQueue = Promise.resolve();
function runExclusive(fn) {
  const run = storageQueue.then(fn, fn);
  storageQueue = run.catch(() => { });
  return run;
}

function sortedIds(items) {
  return [...items]
    .sort((a, b) => (b.favorite === true) - (a.favorite === true))
    .map(item => item.id);
}

function reorderListDom(idsInOrder) {
  let referenceEl = null;
  for (let i = idsInOrder.length - 1; i >= 0; i--) {
    const el = list.querySelector(`li[data-id="${CSS.escape(idsInOrder[i])}"]`);
    if (!el) continue;
    if (el.nextSibling !== referenceEl)
      list.insertBefore(el, referenceEl);

    referenceEl = el;
  }
}

function showStatus(text, isError = false) {
  if (!status) return;
  status.textContent = text;
  status.style.color = isError ? 'var(--danger)' : 'var(--success)';

  status.classList.add('show');

  clearTimeout(timeoutValue);
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
  try {
    const category = categorySelect.value;
    const values = await getValues();
    const items = values[category] || [];

    if (emptyMessage) {
      emptyMessage.style.display = items.length ? 'none' : 'block';
    }
    list.innerHTML = '';

    const sortedItems = [...items].sort((a, b) => (b.favorite === true) - (a.favorite === true));

    sortedItems.forEach((item) => {
      const li = createItemElement(category, item);
      list.appendChild(li);
    });
  } catch (error) {
    showStatus('Erro ao carregar dados.', true);
  }
}

function createItemElement(category, item) {
  const li = document.createElement('li');
  li.dataset.id = item.id;
  updateLiContent(li, category, item);
  return li;
}

function updateLiContent(li, category, item) {
  const isFavClass = item.favorite ? 'fav-btn active' : 'fav-btn';
  const favSymbol = item.favorite ? '★' : '☆';

  li.innerHTML = '';

  const span = document.createElement('span');
  span.textContent = item.value;

  span.addEventListener('dblclick', () => enterEditMode(li, category, item));

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

  favBtn.addEventListener('click', () => toggleFavorite(category, item.id));
  editBtn.addEventListener('click', () => enterEditMode(li, category, item));
  removeBtn.addEventListener('click', () => removeValue(category, item.id, li));
}

async function addValue() {
  if (!accountConnected)
    return showStatus('Conecte uma conta Google a este perfil do Chrome para adicionar itens.', true);

  const category = categorySelect.value;
  const value = valueInput.value.trim();
  if (!value) return;

  try {
    await runExclusive(async () => {
      const values = await getValues();
      if (!values[category]) values[category] = [];

      const alreadyExists = values[category].some(item => item.value === value);
      if (alreadyExists)
        return showStatus('Esse valor já está salvo.', true);

      const newItem = { id: generateId(), value, usageCount: 0, favorite: false };
      values[category].unshift(newItem);
      await saveValues(values);

      valueInput.value = '';
      toggleButtonState();
      showStatus('Valor adicionado');

      if (categorySelect.value !== category) return;
      if (emptyMessage) emptyMessage.style.display = 'none';

      const li = createItemElement(category, newItem);
      li.classList.add('adding');
      list.appendChild(li);
      reorderListDom(sortedIds(values[category]));
    });
  } catch (error) {
    showStatus('Erro ao salvar valor.', true);
  }
}

async function removeValue(category, id, liElement) {
  if (liElement.classList.contains('removing')) return;

  liElement.classList.add('removing');

  setTimeout(async () => {
    try {
      await runExclusive(async () => {
        const values = await getValues();
        if (values[category]) {
          values[category] = values[category].filter(item => item.id !== id);
          await saveValues(values);
        }
      });

      liElement.remove();

      if (list.children.length === 0 && emptyMessage) {
        emptyMessage.style.display = 'block';
      }
    } catch (error) {
      showStatus('Erro ao remover item.', true);
      liElement.classList.remove('removing');
    }
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

async function toggleFavorite(category, id) {
  try {
    await runExclusive(async () => {
      const values = await getValues();
      const item = values[category]?.find(i => i.id === id);
      if (!item) return;

      item.favorite = !item.favorite;
      await saveValues(values);

      const li = list.querySelector(`li[data-id="${CSS.escape(id)}"]`);
      if (li && !li.classList.contains('editing')) {
        updateLiContent(li, category, item);
      }

      if (categorySelect.value === category)
        reorderListDom(sortedIds(values[category]));
    });
  } catch (error) {
    showStatus('Erro ao atualizar favorito.', true);
  }
}

function enterEditMode(li, category, item) {
  li.classList.add('editing');
  li.innerHTML = '';

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'edit-input';
  editInput.value = item.value;
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

  let isSaving = false;
  let cancelled = false;

  const saveEdit = async () => {
    if (isSaving || cancelled) return;

    const newValue = editInput.value.trim();
    if (!newValue) return;

    isSaving = true;
    editInput.disabled = true;
    saveBtn.disabled = true;

    try {
      await runExclusive(async () => {
        if (cancelled) return;

        const values = await getValues();
        if (cancelled || !values[category]) return;

        const alreadyExists = values[category].some(i => i.id !== item.id && i.value === newValue);
        if (alreadyExists)
          return showStatus('Esse valor já está salvo.', true);

        const storedItem = values[category].find(i => i.id === item.id);
        if (!storedItem) return;

        storedItem.value = newValue;
        await saveValues(values);
        item.value = newValue;
        if (cancelled) return;

        updateLiContent(li, category, storedItem);
        li.classList.remove('editing');
        showStatus('Item atualizado');
      });
    } catch (error) {
      if (!cancelled) showStatus('Erro ao salvar item.', true);
    } finally {
      isSaving = false;
      if (!cancelled) {
        editInput.disabled = false;
        saveBtn.disabled = false;
        if (li.classList.contains('editing')) editInput.focus();
      }
    }
  };

  const cancelEdit = () => {
    cancelled = true;
    updateLiContent(li, category, item);
    li.classList.remove('editing');
  };

  saveBtn.addEventListener('click', saveEdit);
  cancelBtn.addEventListener('click', cancelEdit);

  editInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveEdit();
    if (e.key === 'Escape') cancelEdit();
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

  categorySelect.addEventListener('change', () => {
    saveLastCategory(categorySelect.value);
    renderList();
  });
}

if (addButton)
  addButton.addEventListener('click', addValue);

if (valueInput) {
  valueInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addValue();
  });
  valueInput.addEventListener('input', toggleButtonState);
}

async function init() {
  await restoreLastCategory();
  renderList();
  showProfileInfo();
  toggleButtonState();
}

init();
const STORAGE_KEY = 'fillit_values';
const CATEGORIES_KEY = 'fillit_categories';
const LAST_CATEGORY_KEY = 'fillit_last_category';

function generateId() {
  return (crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isForbiddenCategoryName(name) {
  if (!name) return false;

  const normalized = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const forbiddenRegex = /(senha|senhas|password|passwd|pwd|s3nha|pass|pin|credencial|credenciais|secret|segredo|segredos|token|tokens)/i;

  return forbiddenRegex.test(normalized);
}

function normalizeValue(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

const getCategories = () =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get([CATEGORIES_KEY], result => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve(result[CATEGORIES_KEY] || []);
    });
  });

const saveCategories = categories =>
  new Promise((resolve, reject) => {
    chrome.storage.local.set({ [CATEGORIES_KEY]: categories }, () => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      resolve();
    });
  });

const REV_KEY = 'fillit_rev';
let lastReadRev = 0;

const getValues = () =>
  new Promise((resolve, reject) => {
    chrome.storage.local.get([STORAGE_KEY, REV_KEY], result => {
      if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
      lastReadRev = result[REV_KEY] || 0;
      resolve(result[STORAGE_KEY] || {});
    });
  });

class ConflitoDeVersao extends Error { }

const saveValues = values =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'fillit:commit-values', values, rev: lastReadRev },
      (response) => {
        if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
        if (!response?.ok) {
          if (response?.conflict) return reject(new ConflitoDeVersao());
          return reject(new Error('Falha ao gravar'));
        }
        lastReadRev = response.rev;
        resolve();
      }
    );
  });

function saveLastCategory(categoryId) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [LAST_CATEGORY_KEY]: categoryId }, resolve);
  });
}

function getLastCategory() {
  return new Promise(resolve => {
    chrome.storage.local.get([LAST_CATEGORY_KEY], result => {
      resolve(result[LAST_CATEGORY_KEY] || null);
    });
  });
}

let storageQueue = Promise.resolve();

async function comRetry(fn, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    try { return await fn(); }
    catch (e) { if (!(e instanceof ConflitoDeVersao) || i === tentativas - 1) throw e; }
  }
}

function runExclusive(fn) {
  const tarefa = () => comRetry(fn);
  const run = storageQueue.then(tarefa, tarefa);
  storageQueue = run.catch(() => { });
  return run;
}

const categorySelectContainer = document.getElementById('category-select-container');
const categoryToggleBtn = document.getElementById('category-toggle-btn');
const categorySelectedLabel = document.getElementById('category-selected-label');
const categoryDropdown = document.getElementById('category-dropdown');
const categoryList = document.getElementById('category-list');
const newCategoryInput = document.getElementById('new-category-input');
const addCategoryBtn = document.getElementById('add-category-btn');
const noCategoriesMsg = document.getElementById('no-categories-msg');
const categoryErrorMsg = document.getElementById('category-error-message');

const valueInput = document.getElementById('value');
const addButton = document.getElementById('add-button');
const list = document.getElementById('list');
const emptyMessage = document.getElementById('empty-message');
const status = document.getElementById('status');

function setHidden(el, oculto) {
  if (!el) return;
  el.classList.toggle('hidden', oculto);
  el.hidden = oculto;
  el.style.display = '';
}

function showEmptyMessage(visivel, texto) {
  if (!emptyMessage) return;
  if (texto !== undefined) emptyMessage.textContent = texto;
  setHidden(emptyMessage, !visivel);
}

let timeoutValue = undefined;
let categoryErrorTimeout = undefined;
let currentCategoryId = null;

function showCategoryError(text) {
  if (!categoryErrorMsg) return;
  categoryErrorMsg.textContent = text;
  setHidden(categoryErrorMsg, false);

  clearTimeout(categoryErrorTimeout);
  categoryErrorTimeout = setTimeout(() => {
    setHidden(categoryErrorMsg, true);
    categoryErrorMsg.textContent = '';
    categoryErrorTimeout = undefined;
  }, 4000);
}

function syncDropdownAria() {
  const aberto = !categoryDropdown.classList.contains('hidden');
  if (categoryToggleBtn) categoryToggleBtn.setAttribute('aria-expanded', String(aberto));
  return aberto;
}

function toggleCategoryDropdown() {
  setHidden(categoryDropdown, !categoryDropdown.classList.contains('hidden'));
  if (syncDropdownAria()) newCategoryInput.focus();
  else setHidden(categoryErrorMsg, true);
}

function closeCategoryDropdown() {
  setHidden(categoryDropdown, true);
  syncDropdownAria();
  setHidden(categoryErrorMsg, true);
}

async function renderCategoriesUI() {
  const categories = await getCategories();
  let lastCat = await getLastCategory();

  if (!categories.some(c => c.id === lastCat)) {
    lastCat = categories.length > 0 ? categories[0].id : null;
    await saveLastCategory(lastCat);
  }

  currentCategoryId = lastCat;
  categoryList.innerHTML = '';

  if (categories.length === 0) {
    categorySelectedLabel.textContent = 'Criar Categoria';
    setHidden(noCategoriesMsg, false);
  } else {
    setHidden(noCategoriesMsg, true);
    const activeCat = categories.find(c => c.id === currentCategoryId);
    categorySelectedLabel.textContent = activeCat ? activeCat.label : 'Selecionar';
  }

  categories.forEach(cat => {
    const li = document.createElement('li');
    li.className = `category-item ${cat.id === currentCategoryId ? 'selected' : ''}`;
    li.dataset.id = cat.id;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(cat.id === currentCategoryId));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'cat-remove-btn';
    removeBtn.title = 'Excluir categoria e seus itens';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (e) => removeCategory(cat.id, e));

    const labelSpan = document.createElement('span');
    labelSpan.className = 'cat-label';
    labelSpan.textContent = cat.label;

    let clickTimer = null;
    labelSpan.addEventListener('click', (e) => {
      e.stopPropagation();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        enterCategoryEditMode(li, cat);
      } else {
        clickTimer = setTimeout(() => {
          clickTimer = null;
          selectCategory(cat.id, true);
        }, 220);
      }
    });

    const editBtn = document.createElement('button');
    editBtn.className = 'cat-edit-btn';
    editBtn.title = 'Editar nome';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
      enterCategoryEditMode(li, cat);
    });

    li.appendChild(removeBtn);
    li.appendChild(labelSpan);
    li.appendChild(editBtn);

    categoryList.appendChild(li);
  });

  toggleButtonState();
}

async function selectCategory(categoryId, closeDropdown = true) {
  currentCategoryId = categoryId;
  await saveLastCategory(categoryId);

  if (closeDropdown) closeCategoryDropdown();
  await renderCategoriesUI();
  await renderList();
  if (!closeDropdown && newCategoryInput) newCategoryInput.focus();
}

async function addCategory() {
  const label = newCategoryInput.value.trim();
  if (!label) return;

  if (isForbiddenCategoryName(label)) {
    return showCategoryError('O Fillit não salva senhas');
  }

  try {
    await runExclusive(async () => {
      const categories = await getCategories();

      const alreadyExists = categories.some(c => c.label.toLowerCase() === label.toLowerCase());
      if (alreadyExists) {
        return showCategoryError('Esta categoria já existe');
      }

      const newId = `cat_${generateId()}`;
      categories.push({ id: newId, label });

      await saveCategories(categories);

      const values = await getValues();
      values[newId] = [];
      await saveValues(values);

      newCategoryInput.value = '';
      setHidden(categoryErrorMsg, true);
      showStatus('Categoria criada!');

      await selectCategory(newId, false);
    });
  } catch (error) {
    showCategoryError('Erro ao criar categoria');
  }
}

async function removeCategory(categoryId, e) {
  if (e) e.stopPropagation();

  const categories = await getCategories();
  const alvo = categories.find(c => c.id === categoryId);
  const values = await getValues();
  const qtd = (values[categoryId] || []).length;

  const aviso = qtd > 0
    ? `Excluir a categoria "${alvo?.label ?? ''}" e os ${qtd} ${qtd === 1 ? 'item salvo' : 'itens salvos'} nela?\n\nEsta ação não pode ser desfeita.`
    : `Excluir a categoria "${alvo?.label ?? ''}"?`;

  if (!confirm(aviso)) return;

  try {
    await runExclusive(async () => {
      let categories = await getCategories();
      categories = categories.filter(c => c.id !== categoryId);
      await saveCategories(categories);

      const values = await getValues();
      if (values[categoryId]) {
        delete values[categoryId];
        await saveValues(values);
      }

      showStatus('Categoria excluída');

      if (currentCategoryId === categoryId) {
        const nextCat = categories.length > 0 ? categories[0].id : null;
        await saveLastCategory(nextCat);
      }

      await renderCategoriesUI();
      await renderList();
    });
  } catch (error) {
    showStatus('Erro ao excluir categoria', true);
  }
}

function enterCategoryEditMode(li, cat) {
  li.innerHTML = '';
  li.classList.add('editing');

  const editInput = document.createElement('input');
  editInput.type = 'text';
  editInput.className = 'cat-edit-input';
  editInput.value = cat.label;

  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'cat-edit-actions';

  const saveBtn = document.createElement('button');
  saveBtn.className = 'cat-save-btn';
  saveBtn.textContent = '✓';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cat-cancel-btn';
  cancelBtn.textContent = '✕';

  actionsDiv.appendChild(saveBtn);
  actionsDiv.appendChild(cancelBtn);

  li.appendChild(editInput);
  li.appendChild(actionsDiv);

  editInput.focus();
  editInput.setSelectionRange(editInput.value.length, editInput.value.length);

  const save = async () => {
    const newLabel = editInput.value.trim();
    if (!newLabel) return;

    if (isForbiddenCategoryName(newLabel))
      return showCategoryError('O Fillit não salva senhas');

    try {
      await runExclusive(async () => {
        const categories = await getCategories();
        const categoryToUpdate = categories.find(c => c.id === cat.id);
        if (categoryToUpdate) {
          categoryToUpdate.label = newLabel;
          await saveCategories(categories);
          showStatus('Categoria atualizada');
        }
      });
      await renderCategoriesUI();
    } catch (error) {
      showCategoryError('Erro ao editar categoria');
    }
  };

  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    save();
  });

  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    renderCategoriesUI();
  });

  editInput.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') renderCategoriesUI();
  });
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
  status.classList.toggle('is-error', isError);
  status.classList.toggle('is-success', !isError);
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
    const hasCategory = !!currentCategoryId;
    addButton.disabled = !hasCategory || valueInput.value.trim() === '';
    valueInput.disabled = !hasCategory;
    if (!hasCategory) valueInput.placeholder = 'Crie uma categoria primeiro...';
    else valueInput.placeholder = 'Adicionar item...';
  }
}

async function renderList() {
  try {
    if (!currentCategoryId) {
      list.innerHTML = '';
      showEmptyMessage(true, 'Crie uma categoria para começar');
      return;
    }

    const values = await getValues();
    const items = values[currentCategoryId] || [];

    showEmptyMessage(items.length === 0, 'Nenhum dado salvo');
    list.innerHTML = '';

    const sortedItems = [...items].sort((a, b) => (b.favorite === true) - (a.favorite === true));

    sortedItems.forEach((item) => {
      const li = createItemElement(currentCategoryId, item);
      list.appendChild(li);
    });
  } catch (error) {
    showStatus('Erro ao carregar dados', true);
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
  if (!currentCategoryId)
    return showStatus('Crie uma categoria primeiro', true);

  const value = valueInput.value.trim();
  if (!value) return;

  try {
    await runExclusive(async () => {
      const values = await getValues();
      if (!values[currentCategoryId]) values[currentCategoryId] = [];

      const key = normalizeValue(value);
      const alreadyExists = values[currentCategoryId].some(item => normalizeValue(item.value) === key);
      if (alreadyExists)
        return showStatus('Esse valor já está salvo', true);

      const newItem = { id: generateId(), value, usageCount: 0, favorite: false };
      values[currentCategoryId].unshift(newItem);
      await saveValues(values);

      valueInput.value = '';
      toggleButtonState();
      showStatus('Valor adicionado');

      showEmptyMessage(false);

      const li = createItemElement(currentCategoryId, newItem);
      li.classList.add('adding');
      list.appendChild(li);
      reorderListDom(sortedIds(values[currentCategoryId]));
    });
  } catch (error) {
    showStatus('Erro ao salvar valor', true);
  }
}

async function removeValue(category, id, liElement) {
  if (liElement.dataset.removing === '1') return;
  liElement.dataset.removing = '1';

  try {
    await runExclusive(async () => {
      const values = await getValues();
      if (values[category]) {
        values[category] = values[category].filter(item => item.id !== id);
        await saveValues(values);
      }
    });
  } catch (error) {
    delete liElement.dataset.removing;
    return showStatus('Erro ao remover item', true);
  }

  const finalizar = () => {
    if (!liElement.isConnected) return;
    liElement.remove();
    if (list.children.length === 0 && emptyMessage) showEmptyMessage(true);
  };

  liElement.classList.add('removing');
  liElement.addEventListener('animationend', finalizar, { once: true });
  setTimeout(finalizar, 1000);
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
      if (li && !li.classList.contains('editing'))
        updateLiContent(li, category, item);

      reorderListDom(sortedIds(values[category]));
    });
  } catch (error) {
    showStatus('Erro ao atualizar favorito', true);
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

        const keyEdit = normalizeValue(newValue);
        const alreadyExists = values[category].some(i => i.id !== item.id && normalizeValue(i.value) === keyEdit);
        if (alreadyExists)
          return showStatus('Esse valor já está salvo', true);

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
      if (!cancelled) showStatus('Erro ao salvar item', true);
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

if (categoryToggleBtn) {
  categoryToggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCategoryDropdown();
  });
}

if (addCategoryBtn)
  addCategoryBtn.addEventListener('click', addCategory);

if (newCategoryInput) {
  newCategoryInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addCategory();
  });
}

document.addEventListener('click', (e) => {
  if (categorySelectContainer && !categorySelectContainer.contains(e.target))
    closeCategoryDropdown();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (categoryDropdown.classList.contains('hidden')) return;
  closeCategoryDropdown();
  categoryToggleBtn?.focus();
});

if (addButton)
  addButton.addEventListener('click', addValue);

if (valueInput) {
  valueInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addValue();
  });
  valueInput.addEventListener('input', toggleButtonState);
}

async function init() {
  syncDropdownAria();
  await renderCategoriesUI();
  await renderList();
}

init();
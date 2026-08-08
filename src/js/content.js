let currentDropdown = null;
let currentDropdownInput = null;
let currentSelectedIndex = -1;
let currentAllSuggestions = [];
let currentOptionEls = [];
let dropdownSessionId = 0;

function setStyleImportant(el, prop, value) {
  el.style.setProperty(prop, value, 'important');
}

let lastUserGestureAt = 0;
const GESTURE_WINDOW_MS = 400;

function markUserGesture() {
  lastUserGestureAt = Date.now();
}

document.addEventListener('pointerdown', markUserGesture, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') markUserGesture();
}, true);

const typeRules = {
  email: ['email', 'e-mail', 'correio'],
  phone: ['telefone', 'phone', 'celular', 'whatsapp'],
  cpf: ['cpf'],
  cnpj: ['cnpj'],
  name: ['nome', 'name', 'fullname', 'nome-completo', 'username', 'apelido', 'sobrenome', 'first-name', 'last-name'],
  address: ['endereco', 'endereço', 'address', 'rua', 'logradouro'],
  zipcode: ['cep', 'zipcode', 'zip']
};

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); 
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsKeyword(haystack, keyword) {
  const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(keyword)}([^a-z0-9]|$)`);
  return pattern.test(haystack);
}

const MASK_CHAR = '[\\d0-9#xX_]';
const placeholderShapePatterns = {
  zipcode: new RegExp(`^${MASK_CHAR}{5}\\s?-?\\s?${MASK_CHAR}{3}$`),
  cpf: new RegExp(`^${MASK_CHAR}{3}\\.?${MASK_CHAR}{3}\\.?${MASK_CHAR}{3}\\s?-?\\s?${MASK_CHAR}{2}$`),
  cnpj: new RegExp(`^${MASK_CHAR}{2}\\.?${MASK_CHAR}{3}\\.?${MASK_CHAR}{3}\\/?${MASK_CHAR}{4}\\s?-?\\s?${MASK_CHAR}{2}$`),
  phone: new RegExp(`^\\(?${MASK_CHAR}{2}\\)?\\s?${MASK_CHAR}{4,5}\\s?-?\\s?${MASK_CHAR}{4}$`)
};

function matchPlaceholderShape(placeholder) {
  if (!placeholder) return [];
  const trimmed = placeholder.trim();
  if (!trimmed) return [];

  return Object.entries(placeholderShapePatterns)
    .filter(([, pattern]) => pattern.test(trimmed))
    .map(([type]) => type);
}

function identifyFieldTypes(input) {
  const matchedTypes = new Set();

  if (input.type === 'email') matchedTypes.add('email');
  if (input.type === 'tel') matchedTypes.add('phone');

  const autocomplete = (input.autocomplete || '').toLowerCase();
  const parts = normalizeText(
    [
      input.name,
      input.id,
      input.placeholder,
      autocomplete,
      findContextualText(input)
    ]
      .filter(Boolean)
      .join(' ')
  );

  for (const [fieldType, keywords] of Object.entries(typeRules))
    if (keywords.some(keyword => containsKeyword(parts, normalizeText(keyword))))
      matchedTypes.add(fieldType);

  matchPlaceholderShape(input.placeholder).forEach(fieldType => matchedTypes.add(fieldType));

  return Array.from(matchedTypes);
}

function findLabelAssociated(input) {
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) return label.textContent;
  }
  const labelFather = input.closest('label');
  return labelFather ? labelFather.textContent : '';
}

function findContextualText(input) {
  const text = [];

  const labelledBy = input.getAttribute('aria-labelledby');
  if (labelledBy)
    labelledBy.split(' ').forEach(id => {
      const el = document.getElementById(id);
      if (el) text.push(el.textContent);
    });

  const ariaLabel = input.getAttribute('aria-label');
  if (ariaLabel) text.push(ariaLabel);

  text.push(findLabelAssociated(input));

  let container = null;
  let el = input.parentElement;
  let level = 0;
  while (el && level < 6) {
    if (el.getAttribute && (el.getAttribute('role') === 'listitem' || el.getAttribute('role') === 'group')) {
      container = el;
      break;
    }
    el = el.parentElement;
    level++;
  }

  if (container) {
    const title = container.querySelector('[role="heading"], h1, h2, h3, h4, label');
    if (title) text.push(title.textContent);
  }

  return text.filter(Boolean).join(' ');
}

function incrementUsageCount(suggestion) {
  if (!chrome.runtime?.id || !suggestion?.category) return;

  chrome.storage.local.get(['fillit_values'], (result) => {
    const fillitValues = result.fillit_values || {};
    const items = fillitValues[suggestion.category];
    if (!items) return;

    const target = suggestion.id
      ? items.find(item => item.id === suggestion.id)
      : items.find(item => item.value === suggestion.value);
    if (!target) return;

    target.usageCount = (target.usageCount || 0) + 1;
    chrome.storage.local.set({ fillit_values: fillitValues });
  });
}

function showDropdown(input, suggestions) {
  if (!currentDropdown) {
    currentDropdown = document.createElement('div');
    currentDropdown.id = 'fillit-dropdown';
    currentDropdown.setAttribute('role', 'listbox');

    Object.assign(currentDropdown.style, {
      position: 'absolute',
      zIndex: '999999',
      borderRadius: '6px',
      boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      overflowX: 'hidden',
      overflowY: 'auto',
      maxHeight: '260px',
      minWidth: `${input.offsetWidth}px`
    });

    setStyleImportant(currentDropdown, 'background-color', '#ffffff');
    setStyleImportant(currentDropdown, 'color', '#1d1d1f');
    setStyleImportant(currentDropdown, 'border', '1px solid #ccc');

    document.body.appendChild(currentDropdown);
  }

  currentDropdown.innerHTML = '';
  currentSelectedIndex = -1;
  currentOptionEls = [];

  repositionDropdown();

  const MAX_ITEMS = 100;
  const itemsToRender = suggestions.slice(0, MAX_ITEMS);

  itemsToRender.forEach((suggestion, index) => {
    const item = document.createElement('div');
    item.textContent = suggestion.value;
    item.setAttribute('role', 'option');
    item._fillitSuggestion = suggestion;

    Object.assign(item.style, {
      padding: '8px 10px',
      cursor: 'pointer',
      borderBottom: '1px solid #f0f0f0'
    });
    setStyleImportant(item, 'color', '#1d1d1f');
    setStyleImportant(item, 'background-color', '#ffffff');

    if (suggestion.favorite) item.textContent = `★ ${suggestion.value}`;

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSuggestion(input, suggestion);
    });

    item.addEventListener('mouseenter', () => {
      currentSelectedIndex = index;
      updateDropdownHighlight();
    });

    item.addEventListener('mouseleave', () => {
      if (currentSelectedIndex === index) {
        setStyleImportant(item, 'background-color', '#ffffff');
        item.setAttribute('aria-selected', 'false');
        currentSelectedIndex = -1;
      }
    });

    currentDropdown.appendChild(item);
    currentOptionEls.push(item);
  });

  const remaining = suggestions.length - itemsToRender.length;
  if (remaining > 0) {
    const hint = document.createElement('div');
    hint.textContent = `+${remaining} resultado${remaining > 1 ? 's' : ''}. Continue digitando para refinar.`;
    Object.assign(hint.style, {
      padding: '6px 10px',
      fontSize: '11px'
    });
    setStyleImportant(hint, 'color', '#999999');
    setStyleImportant(hint, 'background-color', '#fafafa');
    currentDropdown.appendChild(hint);
  }
}

function hideDropdown() {
  if (currentDropdown) {
    currentDropdown.remove();
    currentDropdown = null;
  }
}

function closeDropdown() {
  hideDropdown();

  if (currentDropdownInput) {
    currentDropdownInput.removeEventListener('keydown', handleKeyboardNavigation);
    currentDropdownInput = null;
  }

  currentAllSuggestions = [];
  currentOptionEls = [];
  currentSelectedIndex = -1;
  dropdownSessionId++;
}

function selectSuggestion(input, suggestion) {
  fillField(input, suggestion.value);
  incrementUsageCount(suggestion);
  closeDropdown();
}

function updateDropdownHighlight() {
  const items = currentOptionEls;
  for (let i = 0; i < items.length; i++) {
    setStyleImportant(items[i], 'color', '#1d1d1f');

    if (i === currentSelectedIndex) {
      setStyleImportant(items[i], 'background-color', '#e6f7ff');
      items[i].setAttribute('aria-selected', 'true');

      const itemTop = items[i].offsetTop;
      const itemBottom = itemTop + items[i].offsetHeight;

      if (itemTop < currentDropdown.scrollTop)
        currentDropdown.scrollTop = itemTop;
      else if (itemBottom > currentDropdown.scrollTop + currentDropdown.offsetHeight)
        currentDropdown.scrollTop = itemBottom - currentDropdown.offsetHeight;

    } else {
      setStyleImportant(items[i], 'background-color', '#ffffff');
      items[i].setAttribute('aria-selected', 'false');
    }
  }
}

function handleKeyboardNavigation(e) {
  if (!currentDropdown) return;

  const items = currentOptionEls;
  if (items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    currentSelectedIndex = (currentSelectedIndex + 1) % items.length;
    updateDropdownHighlight();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    currentSelectedIndex = (currentSelectedIndex - 1 + items.length) % items.length;
    updateDropdownHighlight();
  } else if (e.key === 'Enter') {
    if (currentSelectedIndex >= 0) {
      e.preventDefault();
      const selected = items[currentSelectedIndex]._fillitSuggestion;
      if (selected) selectSuggestion(currentDropdownInput, selected);
    }
  } else if (e.key === 'Escape') {
    closeDropdown();
  }
}

function repositionDropdown() {
  if (!currentDropdown || !currentDropdownInput) return;

  const rect = currentDropdownInput.getBoundingClientRect();

  const isOffscreen = rect.bottom < 0 || rect.top > window.innerHeight;
  if (isOffscreen) return hideDropdown();

  currentDropdown.style.minWidth = `${currentDropdownInput.offsetWidth}px`;
  currentDropdown.style.top = `${window.scrollY + rect.bottom + 4}px`;
  currentDropdown.style.left = `${window.scrollX + rect.left}px`;
}

function fillField(input, value) {
  const prototype = input.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  Object
    .getOwnPropertyDescriptor(prototype, 'value')
    .set
    .call(input, value);

  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

function getDeepActiveElement(root = document) {
  const active = root.activeElement;
  if (active && active.shadowRoot)
    return getDeepActiveElement(active.shadowRoot);

  return active;
}

document.addEventListener('input', (e) => {
  if (!currentDropdownInput || e.target !== currentDropdownInput) return;

  const query = normalizeText(e.target.value.trim());
  const filtered = query
    ? currentAllSuggestions.filter(suggestion => normalizeText(suggestion.value).includes(query))
    : currentAllSuggestions;

  if (filtered.length > 0) {
    showDropdown(currentDropdownInput, filtered);
  } else hideDropdown();
});

document.addEventListener('focusin', async (e) => {
  const input = getDeepActiveElement() || e.target;

  if (!input || !['INPUT', 'TEXTAREA'].includes(input.tagName)) return;
  if (input.tagName === 'INPUT' && ['button', 'submit', 'checkbox', 'radio', 'file', 'hidden', 'password'].includes(input.type)) return;

  const isUserInitiated = (Date.now() - lastUserGestureAt) < GESTURE_WINDOW_MS;
  if (!isUserInitiated) return;

  const types = identifyFieldTypes(input);
  if (!types || types.length === 0) return;

  if (!chrome.runtime?.id)
    return console.log('Fillit: extension context invalidated. Refresh the page (F5) to reconnect.');

  try {
    chrome.storage.local.get(['fillit_values', 'fillit_account_connected'], (result) => {
      if (!result.fillit_account_connected) return;

      const fillitValues = result.fillit_values || {};
      let merged = [];

      types.forEach(type => {
        (fillitValues[type] || []).forEach(item => {
          merged.push({ ...item, category: type });
        });
      });

      const seenValues = new Set();
      const uniqueSuggestions = merged.filter(item => {
        if (seenValues.has(item.value)) return false;
        seenValues.add(item.value);
        return true;
      });

      uniqueSuggestions.sort((a, b) => {
        if (!!a.favorite !== !!b.favorite) return b.favorite ? 1 : -1;
        return (b.usageCount || 0) - (a.usageCount || 0);
      });

      currentAllSuggestions = uniqueSuggestions;

      if (currentAllSuggestions.length > 0) {
        dropdownSessionId++;
        currentDropdownInput = input;
        input.addEventListener('keydown', handleKeyboardNavigation);
        showDropdown(input, currentAllSuggestions);
      }
    });
  } catch (error) {
    console.log('Fillit: failed to read storage. Refresh the page (F5) to reconnect.', error);
  }
});

document.addEventListener('focusout', () => {
  const sessionAtBlur = dropdownSessionId;
  setTimeout(() => {
    if (dropdownSessionId === sessionAtBlur) closeDropdown();
  }, 50);
});

document.addEventListener('scroll', repositionDropdown, true);
const ehFrameUtil = () =>
  window.top === window.self || (window.innerWidth >= 60 && window.innerHeight >= 30);

const FILLIT_DEBUG = false;
const flog = (...a) => { if (FILLIT_DEBUG) console.log(...a); };

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

if (ehFrameUtil()) {                                    // [IFRAME]
  document.addEventListener('pointerdown', markUserGesture, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') markUserGesture();
  }, true);
}

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

function identifyFieldTypes(input, categories = []) {
  const matchedTypes = new Set();
  const autocomplete = (input.autocomplete || input.getAttribute?.('autocomplete') || '').toLowerCase();

  const parts = normalizeText(
    [
      input.name || input.getAttribute?.('name'),
      input.id,
      input.placeholder || input.getAttribute?.('placeholder'),
      autocomplete,
      findContextualText(input)
    ]
      .filter(Boolean)
      .join(' ')
  );

  categories.forEach(cat => {
    if (!cat.label) return;
    const normalizedLabel = normalizeText(cat.label);

    if (input.type && normalizeText(input.type) === normalizedLabel)
      matchedTypes.add(cat.id);

    if (normalizedLabel.length >= 2 && containsKeyword(parts, normalizedLabel))
      matchedTypes.add(cat.id);

  });

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

  try {
    chrome.runtime.sendMessage(
      { type: 'fillit:increment-usage', category: suggestion.category, id: suggestion.id, value: suggestion.value },
      () => { if (chrome.runtime.lastError) flog('Fillit:', chrome.runtime.lastError.message); }  // [L15]
    );
  } catch (error) {
    flog('Fillit: não foi possível registrar o uso.', error);
  }
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
      minWidth: `${input.offsetWidth}px`
    });

    setStyleImportant(currentDropdown, 'background-color', '#ffffff');
    setStyleImportant(currentDropdown, 'color', '#1d1d1f');
    setStyleImportant(currentDropdown, 'border', '1px solid #ccc');

    const host = document.body || document.documentElement;
    if (!host) { currentDropdown = null; return; }
    host.appendChild(currentDropdown);
  }

  currentDropdown.innerHTML = '';
  currentSelectedIndex = -1;
  currentOptionEls = [];

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
  repositionDropdown();
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
  } else if (e.key === 'Escape') closeDropdown();
}

const DROPDOWN_GAP = 4;
const DROPDOWN_ALTURA_MAX = 260;
const DROPDOWN_ALTURA_MIN = 56;

function repositionDropdown() {
  if (!currentDropdown || !currentDropdownInput) return;

  const rect = currentDropdownInput.getBoundingClientRect();

  const isOffscreen = rect.bottom < 0 || rect.top > window.innerHeight;
  if (isOffscreen) return hideDropdown();

  const abaixo = window.innerHeight - rect.bottom - DROPDOWN_GAP;
  const acima = rect.top - DROPDOWN_GAP;

  let direcao, maxAltura, topoViewport;

  if (abaixo >= DROPDOWN_ALTURA_MIN) {
    direcao = 'baixo';
    maxAltura = abaixo;
    topoViewport = rect.bottom + DROPDOWN_GAP;
  } else if (acima >= DROPDOWN_ALTURA_MIN) {
    direcao = 'cima';
    maxAltura = acima;
    topoViewport = null;
  } else {
    direcao = 'sobreposto';
    maxAltura = Math.max(24, window.innerHeight - 2 * DROPDOWN_GAP);
    topoViewport = DROPDOWN_GAP;
  }

  currentDropdown.style.minWidth = `${currentDropdownInput.offsetWidth}px`;
  currentDropdown.style.maxHeight = `${Math.min(DROPDOWN_ALTURA_MAX, maxAltura)}px`;
  currentDropdown.dataset.fillitDirecao = direcao;

  const largura = currentDropdown.offsetWidth || currentDropdownInput.offsetWidth;
  const maxLeft = Math.max(0, window.innerWidth - largura);
  const left = Math.min(Math.max(0, rect.left), maxLeft);
  currentDropdown.style.left = `${window.scrollX + left}px`;

  if (direcao === 'cima')
    topoViewport = rect.top - DROPDOWN_GAP - currentDropdown.offsetHeight;

  currentDropdown.style.top = `${window.scrollY + topoViewport}px`;
}

function fillField(input, value) {
  if (input.isContentEditable) {
    input.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    const range = document.createRange();
    range.selectNodeContents(input);
    sel.addRange(range);
    if (!document.execCommand('insertText', false, value)) {
      input.textContent = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return;
  }

  const prototype = input.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;

  const desc = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (desc?.set) desc.set.call(input, value);
  else input.value = value;

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

  if (filtered.length > 0)
    showDropdown(currentDropdownInput, filtered);
  else hideDropdown();
});

document.addEventListener('focusin', async (e) => {
  if (!ehFrameUtil()) return;                           // [IFRAME]

  const input = getDeepActiveElement() || e.target;

  const editavel = input && (['INPUT', 'TEXTAREA'].includes(input.tagName) || input.isContentEditable);
  if (!editavel) return;
  if (input.tagName === 'INPUT' && ['button', 'submit', 'checkbox', 'radio', 'file', 'hidden', 'password'].includes(input.type)) return;

  if ((input.getAttribute('autocomplete') || '').includes('password')) return;

  const isUserInitiated = (Date.now() - lastUserGestureAt) < GESTURE_WINDOW_MS;
  if (!isUserInitiated) return;

  if (!chrome.runtime?.id)
    return flog('Fillit: extension context invalidated. Refresh the page (F5) to reconnect.');

  try {
    chrome.storage.local.get(['fillit_values', 'fillit_categories'], (result) => {
      if (chrome.runtime.lastError) return flog('Fillit:', chrome.runtime.lastError);

      const categories = result.fillit_categories || [];
      const types = identifyFieldTypes(input, categories);

      if (!types || types.length === 0) return;

      const fillitValues = result.fillit_values || {};
      let merged = [];

      types.forEach(type => {
        (fillitValues[type] || []).forEach(item => merged.push({ ...item, category: type }));
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
    flog('Fillit: failed to read storage. Refresh the page (F5) to reconnect.', error);
  }
});

document.addEventListener('focusout', () => {
  const sessionAtBlur = dropdownSessionId;
  setTimeout(() => {
    if (dropdownSessionId === sessionAtBlur) closeDropdown();
  }, 50);
});

document.addEventListener('scroll', repositionDropdown, true);
window.addEventListener('resize', repositionDropdown);
window.addEventListener('blur', () => closeDropdown());
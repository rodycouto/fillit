let currentDropdown = null;
let currentDropdownInput = null;
let currentSelectedIndex = -1;
let currentAllSuggestions = [];

// Change 1 (privacy): the dropdown must only ever open in response to a
// real user gesture (a click, or Tab-key navigation) on the field — never
// on page load, never from a site auto-focusing a field via the
// "autofocus" attribute or a script calling .focus() programmatically.
// We track the timestamp of the last real gesture and require a recent
// one before treating a "focusin" event as legitimate.
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
  // 'tel' was removed on purpose: as a 3-letter fragment it matched
  // unrelated words like "hotel", "detail", "intel", producing false
  // positives. 'telefone', 'phone', 'celular', 'whatsapp' already cover
  // real phone fields, and input.type === 'tel' is handled separately.
  phone: ['telefone', 'phone', 'celular', 'whatsapp'],
  cpf: ['cpf'],
  cnpj: ['cnpj'],
  name: ['nome', 'name', 'fullname', 'nome-completo', 'username'],
  address: ['endereco', 'endereço', 'address', 'rua', 'logradouro'],
  zipcode: ['cep', 'zipcode', 'zip']
};

function normalizeText(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // strip accents, so "sao" matches "São"
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

  for (const [fieldType, keywords] of Object.entries(typeRules)) {
    if (keywords.some(keyword => parts.includes(normalizeText(keyword)))) {
      matchedTypes.add(fieldType);
    }
  }

  return Array.from(matchedTypes);
}

function findLabelAssociated(input) {
  if (input.id) {
    const label = document.querySelector(`label[for="${input.id}"]`);
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

// Change 3: usage count now lives inside the item itself (fillit_values),
// not in a separate store. We know which category the item belongs to
// because each suggestion object carries its own `category`, attached
// when the suggestions were merged in the focusin handler.
function incrementUsageCount(suggestion) {
  if (!chrome.runtime?.id || !suggestion?.category) return;

  chrome.storage.local.get(['fillit_values'], (result) => {
    const fillitValues = result.fillit_values || {};
    const items = fillitValues[suggestion.category];
    if (!items) return;

    const target = items.find(item => item.value === suggestion.value);
    if (!target) return;

    target.usageCount = (target.usageCount || 0) + 1;
    chrome.storage.local.set({ fillit_values: fillitValues });
  });
}

// Creates (or reuses) the dropdown's DOM element and positions it next to
// the field. Does NOT touch currentDropdownInput or the keydown listener
// lifecycle — those are managed separately so a temporary empty-results
// state doesn't tear down the ability to keep typing and filtering.
function showDropdown(input, suggestions) {
  if (!currentDropdown) {
    currentDropdown = document.createElement('div');
    currentDropdown.id = 'fillit-dropdown';
    currentDropdown.setAttribute('role', 'listbox');

    Object.assign(currentDropdown.style, {
      position: 'absolute',
      zIndex: '999999',
      background: '#fff',
      border: '1px solid #ccc',
      borderRadius: '6px',
      boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '13px',
      overflowX: 'hidden',
      overflowY: 'auto',
      maxHeight: '260px',
      minWidth: `${input.offsetWidth}px`
    });

    document.body.appendChild(currentDropdown);
  }

  currentDropdown.innerHTML = '';
  currentSelectedIndex = -1;

  repositionDropdown();

  const MAX_ITEMS = 100;
  const itemsToRender = suggestions.slice(0, MAX_ITEMS);

  itemsToRender.forEach((suggestion, index) => {
    const item = document.createElement('div');
    item.textContent = suggestion.value;
    item.setAttribute('role', 'option');
    // Store the full suggestion object (value + category + counts) directly
    // on the element, so click/keyboard selection doesn't need to re-derive
    // it from displayed text.
    item._fillitSuggestion = suggestion;

    Object.assign(item.style, {
      padding: '8px 10px',
      cursor: 'pointer',
      borderBottom: '1px solid #f0f0f0'
    });

    if (suggestion.favorite) item.textContent = `★ ${suggestion.value}`;

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSuggestion(input, suggestion);
    });

    item.addEventListener('mouseenter', () => {
      currentSelectedIndex = index;
      updateDropdownHighlight(currentDropdown);
    });

    item.addEventListener('mouseleave', () => {
      if (currentSelectedIndex === index) {
        item.style.background = '#fff';
        item.setAttribute('aria-selected', 'false');
        currentSelectedIndex = -1;
      }
    });

    currentDropdown.appendChild(item);
  });

  const remaining = suggestions.length - itemsToRender.length;
  if (remaining > 0) {
    const hint = document.createElement('div');
    hint.textContent = `+${remaining} resultado${remaining > 1 ? 's' : ''}. Continue digitando para refinar.`;
    Object.assign(hint.style, {
      padding: '6px 10px',
      fontSize: '11px',
      color: '#999',
      background: '#fafafa'
    });
    currentDropdown.appendChild(hint);
  }
}

// Hides the dropdown's visual element only. currentDropdownInput, the
// keydown listener, and currentAllSuggestions stay intact, so typing can
// keep filtering and bring the dropdown back once there's a match again.
// This is the fix for the bug where zero filtered results permanently
// broke further typing/filtering on the field.
function hideDropdown() {
  if (currentDropdown) {
    currentDropdown.remove();
    currentDropdown = null;
  }
}

// Fully tears down the dropdown session: hides it AND detaches the field
// (removes the keydown listener, clears the suggestion list). Used when
// the user is truly done with the field — blur, Escape, or picking a value.
function closeDropdown() {
  hideDropdown();

  if (currentDropdownInput) {
    currentDropdownInput.removeEventListener('keydown', handleKeyboardNavigation);
    currentDropdownInput = null;
  }

  currentAllSuggestions = [];
  currentSelectedIndex = -1;
}

function selectSuggestion(input, suggestion) {
  fillField(input, suggestion.value);
  incrementUsageCount(suggestion);
  closeDropdown();
}

function updateDropdownHighlight(dropdown) {
  const items = dropdown.children;
  for (let i = 0; i < items.length; i++) {
    if (i === currentSelectedIndex) {
      items[i].style.background = '#e6f7ff';
      items[i].setAttribute('aria-selected', 'true');

      const itemTop = items[i].offsetTop;
      const itemBottom = itemTop + items[i].offsetHeight;

      if (itemTop < dropdown.scrollTop)
        dropdown.scrollTop = itemTop;
      else if (itemBottom > dropdown.scrollTop + dropdown.offsetHeight)
        dropdown.scrollTop = itemBottom - dropdown.offsetHeight;

    } else {
      items[i].style.background = '#fff';
      items[i].setAttribute('aria-selected', 'false');
    }
  }
}

function handleKeyboardNavigation(e) {
  if (!currentDropdown) return;

  const items = currentDropdown.children;
  if (items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    currentSelectedIndex = (currentSelectedIndex + 1) % items.length;
    updateDropdownHighlight(currentDropdown);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    currentSelectedIndex = (currentSelectedIndex - 1 + items.length) % items.length;
    updateDropdownHighlight(currentDropdown);
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

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function getDeepActiveElement(root = document) {
  const active = root.activeElement;
  if (active && active.shadowRoot)
    return getDeepActiveElement(active.shadowRoot);

  return active;
}

// document.addEventListener('input', (e) => {
//   if (!currentDropdownInput || e.target !== currentDropdownInput) return;

//   const query = normalizeText(e.target.value.trim());
//   const filtered = query
//     ? currentAllSuggestions.filter(suggestion => normalizeText(suggestion.value).includes(query))
//     : currentAllSuggestions;

//   if (filtered.length > 0) {
//     showDropdown(currentDropdownInput, filtered);
//   } else {
//     hideDropdown();
//   }
// });

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
  if (input.tagName === 'INPUT' && ['button', 'submit', 'checkbox', 'radio', 'file', 'hidden'].includes(input.type)) return;

  // Change 1 (privacy): bail out unless this focus was caused by a recent,
  // real user gesture. This blocks auto-focused fields (the "autofocus"
  // HTML attribute, or a site calling .focus() on load) from ever
  // triggering a storage read — Fillit only looks at storage once the
  // user has actually clicked into (or tabbed into) a field themselves.
  const isUserInitiated = (Date.now() - lastUserGestureAt) < GESTURE_WINDOW_MS;
  if (!isUserInitiated) return;

  const types = identifyFieldTypes(input);
  if (!types || types.length === 0) return;

  if (!chrome.runtime?.id) {
    console.log('Fillit: extension context invalidated. Refresh the page (F5) to reconnect.');
    return;
  }

  try {
    chrome.storage.local.get(['fillit_values', 'fillit_account_connected'], (result) => {
      // Same account gate used everywhere else in Fillit: without a Google
      // account connected to this Chrome profile, nothing gets suggested —
      // consistent with the popup refusing to save anything in that state.
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

      // Favorites first, then by usage count — both descending
      uniqueSuggestions.sort((a, b) => {
        if (!!a.favorite !== !!b.favorite) return b.favorite ? 1 : -1;
        return (b.usageCount || 0) - (a.usageCount || 0);
      });

      currentAllSuggestions = uniqueSuggestions;

      if (currentAllSuggestions.length > 0) {
        currentDropdownInput = input;
        input.addEventListener('keydown', handleKeyboardNavigation);
        showDropdown(input, currentAllSuggestions);
      }
    });
  } catch (error) {
    console.log('Fillit: failed to read storage. Refresh the page (F5) to reconnect.', error);
  }
});

document.addEventListener('focusout', () => setTimeout(closeDropdown, 50));
document.addEventListener('scroll', repositionDropdown, true);
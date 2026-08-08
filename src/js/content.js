let currentDropdown = null;
let currentDropdownInput = null;
let currentSelectedIndex = -1;
let currentAllSuggestions = [];

const typeRules = {
  email: ['email', 'e-mail', 'correio'],
  phone: ['telefone', 'tel', 'phone', 'celular', 'whatsapp'],
  cpf: ['cpf'],
  cnpj: ['cnpj'],
  name: ['nome', 'name', 'fullname', 'nome-completo', 'username'],
  address: ['endereco', 'endereço', 'address', 'rua', 'logradouro'],
  zipcode: ['cep', 'zipcode', 'zip']
};

function identifyFieldTypes(input) {
  const matchedTypes = new Set();

  if (input.type === 'email') matchedTypes.add('email');

  const autocomplete = (input.autocomplete || '').toLowerCase();
  const parts = [
    input.name,
    input.id,
    input.placeholder,
    autocomplete,
    findContextualText(input)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  for (const [fieldType, keywords] of Object.entries(typeRules))
    if (keywords.some(keyword => parts.includes(keyword)))
      matchedTypes.add(fieldType);

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

function showDropdown(input, suggestions) {
  let dropdown = currentDropdown;

  if (!dropdown) {
    dropdown = document.createElement('div');
    dropdown.id = 'fillit-dropdown';
    dropdown.setAttribute('role', 'listbox');

    Object.assign(dropdown.style, {
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
      maxHeight: '250px',
      minWidth: `${input.offsetWidth}px`
    });

    document.body.appendChild(dropdown);
    currentDropdown = dropdown;
    currentDropdownInput = input;

    input.addEventListener('keydown', handleKeyboardNavigation);
  }

  dropdown.innerHTML = '';
  currentSelectedIndex = -1;

  repositionDropdown();

  const MAX_ITEMS = 100;
  const itemsToRender = suggestions.slice(0, MAX_ITEMS);

  itemsToRender.forEach((value, index) => {
    const item = document.createElement('div');
    item.textContent = value;
    item.setAttribute('role', 'option');
    item.dataset.index = index;

    Object.assign(item.style, {
      padding: '8px 10px',
      cursor: 'pointer',
      borderBottom: '1px solid #f0f0f0'
    });

    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      fillField(input, value);
      removeDropdown();
    });

    item.addEventListener('mouseenter', () => {
      currentSelectedIndex = index;
      updateDropdownHighlight(dropdown);
    });

    item.addEventListener('mouseleave', () => {
      if (currentSelectedIndex === index) {
        item.style.background = '#fff';
        item.setAttribute('aria-selected', 'false');
        currentSelectedIndex = -1;
      }
    });

    dropdown.appendChild(item);
  });
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
      fillField(currentDropdownInput, items[currentSelectedIndex].textContent);
      removeDropdown();
    }
  } else if (e.key === 'Escape')
    removeDropdown();

}

function removeDropdown() {
  if (currentDropdown) {
    currentDropdown.remove();
    currentDropdown = null;
  }
  if (currentDropdownInput) {
    currentDropdownInput.removeEventListener('keydown', handleKeyboardNavigation);
    currentDropdownInput = null;
  }
}

function repositionDropdown() {
  if (!currentDropdown || !currentDropdownInput) return;

  const rect = currentDropdownInput.getBoundingClientRect();

  const isOffscreen = rect.bottom < 0 || rect.top > window.innerHeight;
  if (isOffscreen) {
    removeDropdown();
    return;
  }

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

document.addEventListener('input', (e) => {
  if (currentDropdownInput && e.target === currentDropdownInput) {
    const query = e.target.value.toLowerCase();

    const filtered = currentAllSuggestions.filter(suggestion => suggestion.toLowerCase().includes(query));

    if (filtered.length > 0)
      showDropdown(currentDropdownInput, filtered);
    else removeDropdown();
  }
});

document.addEventListener('focusin', async (e) => {
  const input = getDeepActiveElement() || e.target;

  if (!input || !['INPUT', 'TEXTAREA'].includes(input.tagName)) return;
  if (input.tagName === 'INPUT' && ['button', 'submit', 'checkbox', 'radio', 'file', 'hidden'].includes(input.type)) return;

  const types = identifyFieldTypes(input);
  if (!types || types.length === 0) return;

  if (!chrome.runtime?.id) {
    console.log('Fillit: extension context invalidated. Refresh the page (F5) to reconnect.');
    return;
  }

  try {
    chrome.storage.local.get(['fillit_values'], (result) => {
      const fillitValues = result.fillit_values || {};
      let allSuggestions = [];

      types.forEach(type => {
        if (fillitValues[type] && fillitValues[type].length > 0) {
          allSuggestions = allSuggestions.concat(fillitValues[type]);
        }
      });

      currentAllSuggestions = [...new Set(allSuggestions)];

      if (currentAllSuggestions.length > 0) {
        const query = input.value.toLowerCase();
        const filtered = currentAllSuggestions.filter(val =>
          val.toLowerCase().includes(query)
        );

        if (filtered.length > 0)
          showDropdown(input, filtered);
      }
    });
  } catch (error) {
    console.log('Fillit: failed to read storage. Refresh the page (F5) to reconnect.', error);
  }
});

document.addEventListener('focusout', () => setTimeout(removeDropdown, 150));
document.addEventListener('scroll', repositionDropdown, true);
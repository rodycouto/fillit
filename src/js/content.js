let currentDropdown = null;
let currentDropdownInput = null;

const typeRules = {
  email: ['email', 'e-mail', 'correio'],
  phone: ['telefone', 'tel', 'phone', 'celular', 'whatsapp'],
  cpf: ['cpf'],
  cnpj: ['cnpj'],
  name: ['nome', 'name', 'fullname', 'nome-completo', 'username'],
  address: ['endereco', 'endereço', 'address', 'rua', 'logradouro'],
  zipcode: ['cep', 'zipcode', 'zip']
};

function identifyFieldType(input) {

  if (input.type === 'email') return 'email';

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
      return fieldType;

  return null;
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
  removeDropdown();

  const dropdown = document.createElement('div');
  dropdown.id = 'fillit-dropdown';
  Object.assign(dropdown.style, {
    position: 'absolute',
    zIndex: '999999',
    background: '#fff',
    border: '1px solid #ccc',
    borderRadius: '6px',
    boxShadow: '0 4px 10px rgba(0,0,0,0.15)',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '13px',
    overflow: 'hidden',
    minWidth: `${input.offsetWidth}px`
  });

  const rect = input.getBoundingClientRect();
  dropdown.style.top = `${window.scrollY + rect.bottom + 4}px`;
  dropdown.style.left = `${window.scrollX + rect.left}px`;

  suggestions.forEach(value => {
    const item = document.createElement('div');
    item.textContent = value;
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
    item.addEventListener('mouseenter', () => item.style.background = '#f5f5f5');
    item.addEventListener('mouseleave', () => item.style.background = '#fff');
    dropdown.appendChild(item);
  });

  document.body.appendChild(dropdown);
  currentDropdown = dropdown;
  currentDropdownInput = input;
}

function removeDropdown() {
  if (currentDropdown) {
    currentDropdown.remove();
    currentDropdown = null;
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

document.addEventListener('focusin', async (e) => {
  const input = e.target;
  if (!['INPUT', 'TEXTAREA'].includes(input.tagName)) return;
  if (input.tagName === 'INPUT' && ['button', 'submit', 'checkbox', 'radio', 'file', 'hidden'].includes(input.type)) return;

  const type = identifyFieldType(input);
  if (!type) return;

  if (!chrome.runtime?.id) {
    console.log('Fillit: extension context invalidated. Refresh the page (F5) to reconnect.');
    return;
  }

  try {
    chrome.storage.local.get(['fillit_values'], (result) => {
      const fillitValues = result.fillit_values || {};
      const suggestions = fillitValues[type];
      if (suggestions && suggestions.length > 0)
        showDropdown(input, suggestions);
    });
  } catch (error) {
    console.log('Fillit: failed to read storage. Refresh the page (F5) to reconnect.', error);
  }
});

document.addEventListener('focusout', () => setTimeout(removeDropdown, 150));
document.addEventListener('scroll', repositionDropdown, true);
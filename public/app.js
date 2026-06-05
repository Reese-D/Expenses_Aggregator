const statusEl = document.querySelector('#status');
const connectButton = document.querySelector('#connectButton');
const refreshItemsButton = document.querySelector('#refreshItemsButton');
const refreshTransactionsButton = document.querySelector('#refreshTransactionsButton');
const itemsEl = document.querySelector('#items');
const transactionsEl = document.querySelector('#transactions');

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Request failed: ${response.status}`);
  }

  return body;
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

function institutionLabel(item) {
  return item.institution?.name || item.institution?.institution_id || 'Unknown institution';
}

function accountLabel(account) {
  const name = account.name || account.official_name || 'Account';
  const mask = account.mask ? ` •••• ${account.mask}` : '';
  return `${name}${mask}`;
}

function transactionSourceLabel(transaction) {
  const source = transaction.source;

  if (!source) {
    return 'Source unknown';
  }

  const institution = source.institutionName || source.institutionId || 'Unknown institution';
  const account = source.accountName || source.accountSubtype || 'Account';
  const mask = source.accountMask ? ` •••• ${source.accountMask}` : '';

  return `${institution} · ${account}${mask}`;
}

async function loadHealth() {
  try {
    const health = await api('/api/health');
    statusEl.textContent = health.hasClientId && health.hasSecret
      ? `Plaid ${health.plaidEnv} configured for ${health.products.join(', ')}.`
      : 'Add PLAID_CLIENT_ID and PLAID_SECRET to .env before connecting accounts.';
  } catch (error) {
    statusEl.textContent = error.message;
  }
}

async function loadItems() {
  const { items } = await api('/api/items');

  if (!items.length) {
    itemsEl.innerHTML = '<p class="empty">No accounts linked yet.</p>';
    return;
  }

  itemsEl.innerHTML = items.map((item) => {
    const accounts = item.accounts?.length
      ? item.accounts.map((account) => `<li>${accountLabel(account)}</li>`).join('')
      : '<li>No selected account metadata returned.</li>';

    return `
      <article class="item">
        <div>
          <h3>${institutionLabel(item)}</h3>
          <p>Item ID: ${item.itemId}</p>
          <ul>${accounts}</ul>
        </div>
        <button type="button" data-sync="${item.itemId}">Sync</button>
      </article>
    `;
  }).join('');
}

async function loadTransactions() {
  const { transactions } = await api('/api/transactions?limit=100');

  if (!transactions.length) {
    transactionsEl.innerHTML = '<p class="empty">No synced transactions yet.</p>';
    return;
  }

  transactionsEl.innerHTML = transactions.map((transaction) => `
    <article class="transaction">
      <div>
        <strong>${transaction.merchant_name || transaction.name}</strong>
        <span>${transaction.date} · ${transactionSourceLabel(transaction)}</span>
      </div>
      <div class="amount">${formatCurrency(transaction.amount)}</div>
    </article>
  `).join('');
}

async function connectAccount() {
  connectButton.disabled = true;
  connectButton.textContent = 'Preparing...';

  try {
    const { link_token: linkToken } = await api('/api/create_link_token', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const handler = Plaid.create({
      token: linkToken,
      onSuccess: async (publicToken, metadata) => {
        await api('/api/exchange_public_token', {
          method: 'POST',
          body: JSON.stringify({
            public_token: publicToken,
            institution: metadata.institution,
            accounts: metadata.accounts,
          }),
        });
        await loadItems();
      },
      onExit: (error) => {
        if (error) {
          statusEl.textContent = error.error_message || 'Plaid Link exited with an error.';
        }
      },
    });

    handler.open();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    connectButton.disabled = false;
    connectButton.textContent = 'Connect account';
  }
}

itemsEl.addEventListener('click', async (event) => {
  const syncItemId = event.target.dataset.sync;

  if (!syncItemId) {
    return;
  }

  event.target.disabled = true;
  event.target.textContent = 'Syncing...';

  try {
    await api(`/api/items/${syncItemId}/sync`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await loadItems();
    await loadTransactions();
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    event.target.disabled = false;
    event.target.textContent = 'Sync';
  }
});

connectButton.addEventListener('click', connectAccount);
refreshItemsButton.addEventListener('click', loadItems);
refreshTransactionsButton.addEventListener('click', loadTransactions);

loadHealth();
loadItems();
loadTransactions();

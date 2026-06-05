const statusEl = document.querySelector('#status');
const connectButton = document.querySelector('#connectButton');
const refreshItemsButton = document.querySelector('#refreshItemsButton');
const refreshTransactionsButton = document.querySelector('#refreshTransactionsButton');
const itemsEl = document.querySelector('#items');
const transactionsEl = document.querySelector('#transactions');
const netBalanceEl = document.querySelector('#netBalance');
const cashBalanceEl = document.querySelector('#cashBalance');
const cardDebtEl = document.querySelector('#cardDebt');

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

function accountBalanceLabel(account) {
  const balances = account.balances;

  if (!balances) {
    return 'Balance not refreshed';
  }

  if (account.type === 'credit') {
    const owed = balances.current ?? 0;
    const available = balances.available;
    const limit = balances.limit;
    const details = [];

    if (available !== null && available !== undefined) {
      details.push(`available ${formatCurrency(available)}`);
    }

    if (limit !== null && limit !== undefined) {
      details.push(`limit ${formatCurrency(limit)}`);
    }

    return `Owed ${formatCurrency(owed)}${details.length ? ` (${details.join(', ')})` : ''}`;
  }

  const available = balances.available;
  const current = balances.current;

  if (available !== null && available !== undefined) {
    return `Available ${formatCurrency(available)}${current !== null && current !== undefined ? ` (current ${formatCurrency(current)})` : ''}`;
  }

  if (current !== null && current !== undefined) {
    return `Current ${formatCurrency(current)}`;
  }

  return 'Balance unavailable';
}

function accountNetValue(account) {
  const balances = account.balances;

  if (!balances) {
    return null;
  }

  if (account.type === 'credit') {
    if (balances.current === null || balances.current === undefined) {
      return null;
    }

    return -balances.current;
  }

  const value = balances.available ?? balances.current;

  if (value === null || value === undefined) {
    return null;
  }

  return value;
}

function balanceSummary(items) {
  return items.reduce((summary, item) => {
    for (const account of item.accounts || []) {
      const value = accountNetValue(account);

      if (value === null) {
        summary.missing += 1;
        continue;
      }

      if (account.type === 'credit') {
        summary.cardDebt -= value;
      } else {
        summary.cash += value;
      }
    }

    return summary;
  }, {
    cash: 0,
    cardDebt: 0,
    missing: 0,
  });
}

function renderBalanceSummary(items) {
  const summary = balanceSummary(items);
  const net = summary.cash - summary.cardDebt;

  netBalanceEl.textContent = formatCurrency(net);
  cashBalanceEl.textContent = formatCurrency(summary.cash);
  cardDebtEl.textContent = formatCurrency(summary.cardDebt);
  netBalanceEl.classList.toggle('negative', net < 0);

  if (summary.missing > 0) {
    statusEl.textContent = `${summary.missing} account balance${summary.missing === 1 ? '' : 's'} not refreshed yet.`;
  }
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
  renderBalanceSummary(items);

  if (!items.length) {
    itemsEl.innerHTML = '<p class="empty">No accounts linked yet.</p>';
    return;
  }

  itemsEl.innerHTML = items.map((item) => {
    const accounts = item.accounts?.length
      ? item.accounts.map((account) => `
        <li>
          <span>${accountLabel(account)}</span>
          <strong>${accountBalanceLabel(account)}</strong>
        </li>
      `).join('')
      : '<li>No selected account metadata returned.</li>';

    return `
      <article class="item">
        <div>
          <h3>${institutionLabel(item)}</h3>
          <p>Item ID: ${item.itemId}</p>
          <ul>${accounts}</ul>
        </div>
        <div class="item-actions">
          <button type="button" data-balance="${item.itemId}">Refresh balances</button>
          <button type="button" data-sync="${item.itemId}">Sync</button>
        </div>
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
  const balanceItemId = event.target.dataset.balance;

  if (!syncItemId && !balanceItemId) {
    return;
  }

  event.target.disabled = true;
  event.target.textContent = syncItemId ? 'Syncing...' : 'Refreshing...';

  try {
    const itemId = syncItemId || balanceItemId;
    const action = syncItemId ? 'sync' : 'balances';

    await api(`/api/items/${itemId}/${action}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await loadItems();
    if (syncItemId) {
      await loadTransactions();
    }
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    event.target.disabled = false;
    event.target.textContent = syncItemId ? 'Sync' : 'Refresh balances';
  }
});

connectButton.addEventListener('click', connectAccount);
refreshItemsButton.addEventListener('click', loadItems);
refreshTransactionsButton.addEventListener('click', loadTransactions);

loadHealth();
loadItems();
loadTransactions();

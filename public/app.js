const statusEl = document.querySelector('#status');
const connectButton = document.querySelector('#connectButton');
const refreshItemsButton = document.querySelector('#refreshItemsButton');
const refreshTransactionsButton = document.querySelector('#refreshTransactionsButton');
const refreshSubscriptionsButton = document.querySelector('#refreshSubscriptionsButton');
const itemsEl = document.querySelector('#items');
const transactionsEl = document.querySelector('#transactions');
const subscriptionsEl = document.querySelector('#subscriptions');
const netBalanceEl = document.querySelector('#netBalance');
const cashBalanceEl = document.querySelector('#cashBalance');
const cardDebtEl = document.querySelector('#cardDebt');
const monthlyExpensesEl = document.querySelector('#monthlyExpenses');
const monthlyExpensesMetaEl = document.querySelector('#monthlyExpensesMeta');
const monthlySubscriptionsEl = document.querySelector('#monthlySubscriptions');
const monthlySubscriptionsMetaEl = document.querySelector('#monthlySubscriptionsMeta');

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

async function loadMonthlyExpenses() {
  const summary = await api('/api/transactions/monthly-summary');
  monthlyExpensesEl.textContent = formatCurrency(summary.total);
  monthlyExpensesMetaEl.textContent = `${summary.count} expenses · ${summary.excludedCount} transfers excluded`;
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
  await loadMonthlyExpenses();

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

async function syncTransactions() {
  refreshTransactionsButton.disabled = true;
  refreshTransactionsButton.textContent = 'Syncing...';
  statusEl.textContent = 'Syncing transactions from Plaid...';

  try {
    const result = await api('/api/transactions/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    await loadTransactions();
    statusEl.textContent = `Synced ${result.items} linked item${result.items === 1 ? '' : 's'}: ${result.added} added, ${result.modified} modified, ${result.removed} removed.`;
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    refreshTransactionsButton.disabled = false;
    refreshTransactionsButton.textContent = 'Refresh';
  }
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

const FREQUENCY_LABELS = {
  WEEKLY: 'Weekly',
  BIWEEKLY: 'Biweekly',
  SEMI_MONTHLY: 'Twice/month',
  MONTHLY: 'Monthly',
  ANNUALLY: 'Annual',
  UNKNOWN: 'Recurring',
};

function streamMonthlyAmount(stream) {
  const amount = stream.average_amount?.amount ?? stream.last_amount?.amount ?? 0;
  switch (stream.frequency) {
    case 'WEEKLY': return amount * (52 / 12);
    case 'BIWEEKLY': return amount * (26 / 12);
    case 'SEMI_MONTHLY': return amount * 2;
    case 'MONTHLY': return amount;
    case 'ANNUALLY': return amount / 12;
    default: return amount;
  }
}

function streamSourceLabel(stream) {
  const source = stream.source;
  if (!source) return '';
  const institution = source.institutionName || source.institutionId || 'Unknown institution';
  const account = source.accountName || source.accountSubtype || 'Account';
  const mask = source.accountMask ? ` •••• ${source.accountMask}` : '';
  return `${institution} · ${account}${mask}`;
}

function renderSubscriptions(data) {
  const outflow = (data.outflow || []).filter((s) => s.is_active !== false);
  const sorted = [...outflow].sort((a, b) => streamMonthlyAmount(b) - streamMonthlyAmount(a));

  const totalMonthly = sorted.reduce((sum, s) => sum + streamMonthlyAmount(s), 0);
  monthlySubscriptionsEl.textContent = formatCurrency(totalMonthly);

  const lastRefreshed = data.lastRefreshedAt
    ? new Date(data.lastRefreshedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  monthlySubscriptionsMetaEl.textContent = lastRefreshed
    ? `${sorted.length} active · refreshed ${lastRefreshed}`
    : `${sorted.length} active`;

  if (!sorted.length) {
    subscriptionsEl.innerHTML = '<p class="empty">No recurring subscriptions found. Sync to detect them from your transaction history.</p>';
    return;
  }

  subscriptionsEl.innerHTML = sorted.map((stream) => {
    const name = stream.merchant_name || stream.description || 'Unknown';
    const lastAmount = stream.last_amount?.amount ?? stream.average_amount?.amount ?? 0;
    const freq = FREQUENCY_LABELS[stream.frequency] || 'Recurring';
    const monthly = streamMonthlyAmount(stream);
    const source = streamSourceLabel(stream);

    let statusBadge = '';
    if (stream.status === 'EARLY_DETECTION') {
      statusBadge = '<span class="badge early">New</span>';
    } else if (stream.status === 'TOMBSTONED') {
      statusBadge = '<span class="badge tombstoned">Inactive</span>';
    }

    return `
      <article class="transaction">
        <div>
          <strong>${name}</strong>
          <div class="subscription-meta">
            <span class="badge">${freq} · ${formatCurrency(lastAmount)}</span>
            ${statusBadge}
            <span style="color:#687887;font-size:14px">${source}</span>
          </div>
        </div>
        <div class="subscription-monthly">
          <strong>${formatCurrency(monthly)}</strong>
          <small>/mo est.</small>
        </div>
      </article>
    `;
  }).join('');
}

async function loadSubscriptions() {
  const data = await api('/api/subscriptions');
  renderSubscriptions(data);
}

async function syncSubscriptions() {
  refreshSubscriptionsButton.disabled = true;
  refreshSubscriptionsButton.textContent = 'Syncing...';
  statusEl.textContent = 'Fetching recurring transactions from Plaid...';

  try {
    const data = await api('/api/subscriptions/sync', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    renderSubscriptions(data);
    statusEl.textContent = `Found ${(data.outflow || []).length} recurring outflow stream${(data.outflow || []).length === 1 ? '' : 's'}.`;
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    refreshSubscriptionsButton.disabled = false;
    refreshSubscriptionsButton.textContent = 'Sync';
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
refreshTransactionsButton.addEventListener('click', syncTransactions);
refreshSubscriptionsButton.addEventListener('click', syncSubscriptions);

loadHealth();
loadItems();
loadTransactions();
loadMonthlyExpenses();
loadSubscriptions();

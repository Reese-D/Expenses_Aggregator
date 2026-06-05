const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'store.json');

function emptyStore() {
  return {
    items: [],
    transactions: {},
  };
}

function ensureStore() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (!fs.existsSync(storePath)) {
    fs.writeFileSync(storePath, JSON.stringify(emptyStore(), null, 2));
  }
}

function readStore() {
  ensureStore();
  return JSON.parse(fs.readFileSync(storePath, 'utf8'));
}

function writeStore(store) {
  ensureStore();
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function listItems() {
  return readStore().items.map(({ accessToken, ...safeItem }) => safeItem);
}

function addItem(item) {
  const store = readStore();
  const existingIndex = store.items.findIndex((stored) => stored.itemId === item.itemId);

  if (existingIndex >= 0) {
    store.items[existingIndex] = item;
  } else {
    store.items.push(item);
  }

  writeStore(store);
}

function getItem(itemId) {
  return readStore().items.find((item) => item.itemId === itemId);
}

function updateItemCursor(itemId, cursor) {
  const store = readStore();
  const item = store.items.find((stored) => stored.itemId === itemId);

  if (!item) {
    return;
  }

  item.cursor = cursor;
  item.lastSyncedAt = new Date().toISOString();
  writeStore(store);
}

function updateItemAccounts(itemId, accounts) {
  const store = readStore();
  const item = store.items.find((stored) => stored.itemId === itemId);

  if (!item) {
    return null;
  }

  item.accounts = accounts;
  item.lastBalanceRefreshAt = new Date().toISOString();
  writeStore(store);

  const { accessToken, ...safeItem } = item;
  return safeItem;
}

function enrichTransactionSource(transaction, item) {
  const account = item.accounts.find((storedAccount) => (
    storedAccount.id === transaction.account_id
    || storedAccount.account_id === transaction.account_id
  ));

  return {
    ...transaction,
    source: {
      itemId: item.itemId,
      institutionName: item.institution?.name || null,
      institutionId: item.institution?.institution_id || null,
      accountId: transaction.account_id,
      accountName: account?.name || account?.official_name || null,
      accountMask: account?.mask || null,
      accountSubtype: account?.subtype || null,
    },
  };
}

function upsertTransactions(transactions, item) {
  const store = readStore();

  for (const transaction of transactions) {
    store.transactions[transaction.transaction_id] = item
      ? enrichTransactionSource(transaction, item)
      : transaction;
  }

  writeStore(store);
}

function removeTransactions(removedTransactions) {
  const store = readStore();

  for (const transaction of removedTransactions) {
    delete store.transactions[transaction.transaction_id];
  }

  writeStore(store);
}

function backfillTransactionSources() {
  const store = readStore();
  let updated = 0;

  for (const transaction of Object.values(store.transactions)) {
    if (transaction.source) {
      continue;
    }

    const item = store.items.find((storedItem) => storedItem.accounts.some((account) => (
      account.id === transaction.account_id
      || account.account_id === transaction.account_id
    )));

    if (!item) {
      continue;
    }

    store.transactions[transaction.transaction_id] = enrichTransactionSource(transaction, item);
    updated += 1;
  }

  if (updated > 0) {
    writeStore(store);
  }

  return updated;
}

function listTransactions(limit = 100) {
  return Object.values(readStore().transactions)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

module.exports = {
  addItem,
  backfillTransactionSources,
  getItem,
  listItems,
  listTransactions,
  removeTransactions,
  updateItemAccounts,
  updateItemCursor,
  upsertTransactions,
};

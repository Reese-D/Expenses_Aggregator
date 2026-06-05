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

function upsertTransactions(transactions) {
  const store = readStore();

  for (const transaction of transactions) {
    store.transactions[transaction.transaction_id] = transaction;
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

function listTransactions(limit = 100) {
  return Object.values(readStore().transactions)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

module.exports = {
  addItem,
  getItem,
  listItems,
  listTransactions,
  removeTransactions,
  updateItemCursor,
  upsertTransactions,
};

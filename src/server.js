require('dotenv').config();

const express = require('express');
const {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
} = require('plaid');
const {
  addItem,
  backfillTransactionSources,
  getItem,
  getRecurringStreams,
  listItems,
  listStoredItems,
  listTransactions,
  monthlyExpenseSummary,
  removeTransactions,
  setRecurringStreams,
  updateItemAccounts,
  updateItemCursor,
  upsertTransactions,
} = require('./store');

const app = express();
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

const plaidEnv = process.env.PLAID_ENV || 'sandbox';
const plaidProducts = (process.env.PLAID_PRODUCTS || 'transactions')
  .split(',')
  .map((product) => product.trim())
  .filter(Boolean);
const plaidCountryCodes = (process.env.PLAID_COUNTRY_CODES || 'US')
  .split(',')
  .map((countryCode) => countryCode.trim())
  .filter(Boolean);

function requirePlaidConfig() {
  const missing = ['PLAID_CLIENT_ID', 'PLAID_SECRET'].filter((key) => !process.env[key]);

  if (missing.length) {
    const error = new Error(`Missing Plaid configuration: ${missing.join(', ')}`);
    error.status = 500;
    throw error;
  }
}

function createPlaidClient() {
  requirePlaidConfig();

  const basePath = PlaidEnvironments[plaidEnv];
  if (!basePath) {
    const error = new Error(`Unsupported PLAID_ENV "${plaidEnv}". Use sandbox, development, or production.`);
    error.status = 500;
    throw error;
  }

  const configuration = new Configuration({
    basePath,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  });

  return new PlaidApi(configuration);
}

async function refreshItemBalances(client, item) {
  const plaidResponse = await client.accountsBalanceGet({
    access_token: item.accessToken,
  });

  return updateItemAccounts(item.itemId, plaidResponse.data.accounts);
}

async function syncItemTransactions(client, item) {
  let cursor = item.cursor;
  let hasMore = true;
  const added = [];
  const modified = [];
  const removed = [];

  while (hasMore) {
    const plaidResponse = await client.transactionsSync({
      access_token: item.accessToken,
      cursor,
    });

    added.push(...plaidResponse.data.added);
    modified.push(...plaidResponse.data.modified);
    removed.push(...plaidResponse.data.removed);

    cursor = plaidResponse.data.next_cursor;
    hasMore = plaidResponse.data.has_more;
  }

  upsertTransactions([...added, ...modified], item);
  removeTransactions(removed);
  updateItemCursor(item.itemId, cursor);

  return {
    itemId: item.itemId,
    institutionName: item.institution?.name || item.institution?.institution_id || 'Unknown institution',
    added: added.length,
    modified: modified.length,
    removed: removed.length,
    nextCursor: cursor,
  };
}

app.use(express.json());
app.use(express.static('public'));

app.get('/api/health', (request, response) => {
  response.json({
    ok: true,
    plaidEnv,
    products: plaidProducts,
    countryCodes: plaidCountryCodes,
    hasClientId: Boolean(process.env.PLAID_CLIENT_ID),
    hasSecret: Boolean(process.env.PLAID_SECRET),
  });
});

app.post('/api/create_link_token', async (request, response, next) => {
  try {
    const client = createPlaidClient();
    const plaidResponse = await client.linkTokenCreate({
      user: {
        client_user_id: 'personal-user',
      },
      client_name: 'Personal Expenses Aggregator',
      products: plaidProducts,
      country_codes: plaidCountryCodes,
      language: 'en',
      account_filters: {
        credit: {
          account_subtypes: ['credit card'],
        },
        depository: {
          account_subtypes: ['checking', 'savings'],
        },
      },
    });

    response.json({ link_token: plaidResponse.data.link_token });
  } catch (error) {
    next(error);
  }
});

app.post('/api/exchange_public_token', async (request, response, next) => {
  try {
    const { public_token: publicToken, institution, accounts } = request.body;

    if (!publicToken) {
      response.status(400).json({ error: 'public_token is required' });
      return;
    }

    const client = createPlaidClient();
    const plaidResponse = await client.itemPublicTokenExchange({
      public_token: publicToken,
    });

    const item = {
      itemId: plaidResponse.data.item_id,
      accessToken: plaidResponse.data.access_token,
      institution: institution || null,
      accounts: accounts || [],
      cursor: null,
      createdAt: new Date().toISOString(),
      lastSyncedAt: null,
    };

    addItem(item);

    response.json({
      item: {
        itemId: item.itemId,
        institution: item.institution,
        accounts: item.accounts,
        createdAt: item.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/items', (request, response) => {
  response.json({ items: listItems() });
});

app.post('/api/items/:itemId/sync', async (request, response, next) => {
  try {
    const item = getItem(request.params.itemId);

    if (!item) {
      response.status(404).json({ error: 'Item not found' });
      return;
    }

    const client = createPlaidClient();
    response.json(await syncItemTransactions(client, item));
  } catch (error) {
    next(error);
  }
});

app.post('/api/transactions/sync', async (request, response, next) => {
  try {
    const client = createPlaidClient();
    const results = [];

    for (const item of listStoredItems()) {
      results.push(await syncItemTransactions(client, item));
    }

    response.json({
      items: results.length,
      added: results.reduce((total, result) => total + result.added, 0),
      modified: results.reduce((total, result) => total + result.modified, 0),
      removed: results.reduce((total, result) => total + result.removed, 0),
      results,
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/items/:itemId/balances', async (request, response, next) => {
  try {
    const item = getItem(request.params.itemId);

    if (!item) {
      response.status(404).json({ error: 'Item not found' });
      return;
    }

    const client = createPlaidClient();
    const updatedItem = await refreshItemBalances(client, item);

    response.json({ item: updatedItem });
  } catch (error) {
    next(error);
  }
});

app.get('/api/transactions', (request, response) => {
  const limit = Number(request.query.limit || 100);
  backfillTransactionSources();
  response.json({ transactions: listTransactions(limit) });
});

app.get('/api/transactions/monthly-summary', (request, response) => {
  response.json(monthlyExpenseSummary());
});

app.get('/api/subscriptions', (request, response) => {
  const cached = getRecurringStreams();
  response.json(cached || { outflow: [], inflow: [], lastRefreshedAt: null });
});

app.post('/api/subscriptions/sync', async (request, response, next) => {
  try {
    const client = createPlaidClient();
    const items = listStoredItems();
    const allOutflow = [];
    const allInflow = [];

    for (const item of items) {
      const plaidResponse = await client.transactionsRecurringGet({
        access_token: item.accessToken,
        options: { include_personal_finance_category: true },
      });

      const accountMap = Object.fromEntries(
        (item.accounts || []).map((a) => [a.account_id || a.id, a])
      );

      const enrichStream = (stream) => {
        const account = accountMap[stream.account_id] || {};
        return {
          ...stream,
          source: {
            itemId: item.itemId,
            institutionName: item.institution?.name || null,
            institutionId: item.institution?.institution_id || null,
            accountId: stream.account_id,
            accountName: account.name || account.official_name || null,
            accountMask: account.mask || null,
            accountSubtype: account.subtype || null,
          },
        };
      };

      allOutflow.push(...plaidResponse.data.outflow_streams.map(enrichStream));
      allInflow.push(...plaidResponse.data.inflow_streams.map(enrichStream));
    }

    const stored = setRecurringStreams(allOutflow, allInflow);
    response.json(stored);
  } catch (error) {
    next(error);
  }
});

app.use((error, request, response, next) => {
  const status = error.status || error.response?.status || 500;
  const plaidError = error.response?.data;

  response.status(status).json({
    error: plaidError?.error_message || error.message || 'Unexpected error',
    plaid: plaidError || undefined,
  });
});

app.listen(port, host, () => {
  console.log(`Expenses Aggregator running at http://${host}:${port}`);
});

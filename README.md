# Expenses Aggregator

Personal Plaid-based expense tracker.

## What This Version Does

- Creates a Plaid Link token from the backend.
- Opens Plaid Link in the browser so you can choose American Express, Chase, Citi, Fifth Third, etc.
- Exchanges the temporary `public_token` for a permanent Plaid `access_token`.
- Stores linked Items locally in `data/store.json`.
- Syncs transactions from Plaid using `/transactions/sync`.

## Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the environment file:

   ```sh
   cp .env.example .env
   ```

3. Fill in `.env` using your Plaid dashboard values:

   ```sh
   PLAID_CLIENT_ID=...
   PLAID_SECRET=...
   PLAID_ENV=sandbox
   ```

   Use `sandbox` first. Later, switch `PLAID_ENV` and `PLAID_SECRET` when you are ready for real accounts.

4. Start the app:

   ```sh
   npm run dev
   ```

5. Open:

   ```text
   http://localhost:3000
   ```

## Linking Specific Accounts

Click **Connect account**, then search for the institution in Plaid Link:

- American Express
- Chase
- Citi
- Fifth Third Bank

For institutions with multiple accounts, Plaid Link should show account selection during the consent flow. Choose only the card or bank accounts you want this app to track.

Each completed institution login becomes a Plaid Item. For example, Chase credit card and Chase bank access may be one Item if both are available under the same Chase login and selected in the same Link session.

## Security Note

The local `data/store.json` file contains Plaid access tokens. Do not commit it, publish it, or share it.

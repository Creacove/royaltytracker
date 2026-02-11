# OrderSounds

Forensic Royalty Platform for uploading CMO royalty reports, processing them, and exploring normalized royalty data.

## Getting Started

1. Install dependencies: `npm i`
2. Start the dev server: `npm run dev`

## Supabase

Project ref: `vdzuypxdueelmkrwvyet` (royaltytracker)

Local CLI setup (each developer machine):
1. `supabase login`
2. `supabase link --project-ref vdzuypxdueelmkrwvyet`

### Migrations

Apply schema to the remote database:
- `supabase db push -p <DB_PASSWORD>`

You can find/reset the DB password in the Supabase dashboard under Project Settings -> Database.

### Edge Function Secrets

The `process-report` edge function requires Google Document AI secrets.

1. Create `supabase/secrets.env` from `supabase/secrets.env.example`
2. Apply secrets to the project:
   - `supabase secrets set --env-file supabase/secrets.env --project-ref vdzuypxdueelmkrwvyet`
3. Deploy the function:
   - `supabase functions deploy process-report --project-ref vdzuypxdueelmkrwvyet`

Google requirements:
- Billing must be enabled for `GOOGLE_CLOUD_PROJECT`
- Document AI API must be enabled
- The service account in `GOOGLE_SERVICE_ACCOUNT_KEY` must have permission to call Document AI

Note: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically inside Supabase Edge Functions.
The CLI intentionally prevents setting secrets that start with `SUPABASE_` because those names are reserved.

### Auth (Email Signups)

If sign-up says "confirmation email sent" but no email arrives:

1. Supabase Dashboard -> Authentication -> Providers -> Email:
   - For development, consider disabling email confirmations so you can sign in immediately.
   - For production, configure a real SMTP provider for reliable delivery.
2. Supabase Dashboard -> Authentication -> URL Configuration:
   - Add your dev/prod URLs to the allowed redirect URLs (this app uses `window.location.origin` for `emailRedirectTo`).
3. Supabase Dashboard -> Authentication -> Users:
   - Check whether the user exists and is unconfirmed; you can manually confirm for testing.

## Backend

Primary backend for the web app is the Supabase edge function in `supabase/functions/process-report`.

`backend/ordersounds_mvp` is a separate Python pipeline that can run locally; it uses its own `.env` (ignored by git) and `DATABASE_URL`. It is not currently wired to the Supabase migrations used by the web app.

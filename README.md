# InternBid

[![CI/CD](https://github.com/NileshAm/entc-web/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/NileshAm/entc-web/actions/workflows/ci-cd.yml)

InternBid is a mobile-friendly internship company bidding and CV allocation system built with Next.js 16, Supabase, and Cloudflare Workers.

## Included

- Supabase email/password and Google OAuth authentication with SSR cookies.
- Student, administrator, and read-only committee roles.
- Responsive student portal with point balances, Stay or Withdraw bid responses, participant names, private notifications, and a point ledger.
- Administrator control room with live applicant demand, current-bid increases, response monitoring, finalization, company setup, student point adjustments, analytics, CSV exports, and an audit log.
- Admin-only company editing with audited changes to catalogue details, bid rules, and schedules.
- A public `/analytics` page with realtime current bids and aggregate demand. Its database function returns only company statistics and never exposes student, staff, contact, point-balance, or audit data.
- PostgreSQL row-level security and locked, transactional RPCs for every point-changing bidding action.
- Private Supabase Broadcast channels. Live events contain company metrics only; student identities are never broadcast to other students.
- Cloudflare Workers deployment through the official OpenNext adapter.

## 1. Create the Supabase project

1. Create a project in Supabase.
2. Open the SQL editor and run the files in `supabase/migrations` in filename order, or link the Supabase CLI and run `supabase db push`. Existing installations must apply every migration newer than the latest entry in their migration history, including `202608050003_admin_controlled_bidding.sql` for committee-controlled bid increases.
3. In **Authentication → URL Configuration**, add:
   - `http://localhost:3000/auth/callback`
   - `https://your-production-domain/auth/callback`
   Set **Site URL** to `https://your-production-domain` in production. The
   production callback must appear exactly in **Redirect URLs**, otherwise
   Supabase falls back to the Site URL.
4. Enable Google in **Authentication → Providers** if university Google login is required.
5. For production private Broadcast channels, disable public channel access in **Realtime → Settings**.

New Auth users automatically receive a student profile with 100 points. To make the first administrator, run this once after that person signs in:

```sql
update public.profiles
set role = 'admin'
where email = 'committee.admin@university.edu';
```

Committee viewers use `role = 'viewer'`.

## 2. Configure the app

Copy `.env.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The sign-up page accepts any syntactically valid email and collects the student’s name, index, and password confirmation. Supabase Auth securely manages the password; the public profile stores no password or password hash.

In the hosted Supabase project, open **Authentication → Providers → Email** and disable **Confirm email**. This accepts the supplied address without sending a verification message and lets the student sign in immediately. Local Supabase uses the matching `auth.email.enable_confirmations = false` setting in `supabase/config.toml`.

For Cloudflare-local development, also copy `.dev.vars.example` to `.dev.vars`. Keep secrets in `.dev.vars`; it is intentionally gitignored.

The publishable key is intentionally used in the browser. Data protection comes from Supabase Auth, RLS, and the database RPC authorization checks. Never add a Supabase secret/service-role key to a `NEXT_PUBLIC_` variable.

## 3. Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Microsoft Dev Tunnels are accepted as Server Action origins only while running
`next dev`. This supports shared development previews without weakening the
production same-origin check. Restart the development server after changing
`next.config.ts` if Next.js does not restart it automatically.

Validation commands:

```bash
npm run lint
npm test
npm run build
```

## 4. Administrator-controlled bidding rules

- Students apply at the company’s current bid and reserve that amount.
- When a company is oversubscribed, an administrator enters the increment for that round on the fly. The configured increment only prefills the control, and the new current bid is previewed immediately.
- Every participating student receives a private notification and must choose **Stay** or **Withdraw** before the response deadline.
- Staying reserves the additional points. Withdrawing during an increase permanently charges the initial/base bid plus `ceil((current bid − initial bid) × withdrawal percentage)` and releases the previous reservation.
- The percentage is configured per company and defaults to 10%. A charge is capped at the student’s usable points so the balance never becomes negative.
- A normal withdrawal when no increase response is pending releases the reservation without this charge.
- Authenticated students can see the names and response states of students currently in the session, plus applicant and available-slot counts. Emails, registration numbers, point balances, and administrator data are not exposed.

To automatically withdraw students who miss the response deadline, enable `pg_cron` and schedule:

```sql
select cron.schedule(
  'expire-bid-responses',
  '* * * * *',
  'select public.expire_bid_responses()'
);
```

## 5. Deploy to Cloudflare Workers

The repository includes `wrangler.jsonc` and `open-next.config.ts`.

1. Authenticate once with `npx wrangler login`.
2. `NEXT_PUBLIC_SITE_URL` is committed as the canonical HTTPS production origin in `wrangler.jsonc`. Update it if the production domain changes. Add the other two `NEXT_PUBLIC_...` values as runtime variables under the Worker's **Settings → Variables and Secrets**. `npm run deploy` preserves these dashboard bindings with Wrangler's `--keep-vars` option.
3. Ensure those same values are present in the environment that runs `next build` (`.env.local` for a manual deploy, or the GitHub production environment variables below). Next.js inlines public values into the browser bundle, and auth-aware routes must be identified correctly during the build.
4. Preview in the Workers runtime:

   ```bash
   npm run preview
   ```

5. Deploy:

   ```bash
   npm run deploy
   ```

Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS domain before the production build, then add the matching callback URL in Supabase Auth.

## 6. GitHub CI/CD

The workflow at `.github/workflows/ci-cd.yml` runs on pull requests and pushes to `main`:

- Installs dependencies with `npm ci`, then runs ESLint and all Vitest tests.
- Builds through the OpenNext Cloudflare adapter and validates the Worker bundle with a Wrangler dry-run.
- Creates a clean local Supabase database from the committed migrations and runs database linting.
- On `main`, optionally applies pending Supabase migrations and deploys the production Worker.

Create a GitHub environment named `production`. Restrict it to `main` and add an approval rule if production deployments should require confirmation.

Add these **environment secrets**:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
```

Create a Cloudflare API token scoped to the target account with **Edit Cloudflare Workers** permission. Generate the stable Next.js action encryption key once with `openssl rand -base64 32`; keep the same value across deployments.

Add these **environment variables**:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
NEXT_PUBLIC_SITE_URL
```

To enable automated database migration deployment, first ensure the hosted database migration history matches `supabase/migrations`. This is especially important if the initial schema was previously pasted into the SQL editor. Then add:

```text
Secret: SUPABASE_ACCESS_TOKEN
Secret: PRODUCTION_PROJECT_ID
Secret: PRODUCTION_DB_PASSWORD
Variable: RUN_SUPABASE_MIGRATIONS=true
```

Leave `RUN_SUPABASE_MIGRATIONS` unset until the history is aligned. Application deployment remains automatic while it is unset; when enabled, a migration failure safely stops the Worker deployment.

## Policy defaults

The unresolved committee decisions from the SRS use these conservative defaults:

- One company can be live at a time.
- Multiple applications are permitted only when the student has enough unreserved points.
- Points are spent at the committee-controlled current bid for every finalized applicant.
- Normal withdrawal releases reserved points; withdrawing from a bid increase applies the configured charge.
- Missed bid responses automatically use the same withdrawal-charge workflow when the expiry function is scheduled.
- Students see participant names and response states, but not emails, indexes, balances, or other private profile data.
- Notifications are portal-only.
- Supabase is the point-balance source of truth; Sheets should be treated as import/export only.

These defaults are stored in `system_settings` for visibility. Some policy changes, such as allowing multiple live companies, also require updating the relevant database RPC guard.

## Security notes

- Authenticated pages are dynamically rendered and must not be cached by a CDN.
- `middleware.ts` refreshes sessions using `getClaims()` and forwards Supabase’s private/no-store cache headers. Next.js 16 normally calls this boundary `proxy.ts`; the current OpenNext Cloudflare adapter still requires the legacy Edge Middleware filename because it does not yet support Node-runtime Proxy.
- Students have no direct `INSERT` or `UPDATE` policy on applications, balances, bid history, or audit logs.
- Anonymous users have no direct table access. Public analytics is served by a security-definer function with an explicit, minimal return shape, and its public realtime event contains only the changed company ID.
- The authenticated participant-list function exposes names and response state only; it does not relax profile RLS or publish identities over public realtime.
- Bid responses, withdrawal charges, and finalization lock affected rows and update balances in PostgreSQL transactions.
- Important mutations re-check authentication and role inside the database, even when the UI hides the control.

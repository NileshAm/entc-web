# InternBid

[![CI/CD](https://github.com/NileshAm/entc-web/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/NileshAm/entc-web/actions/workflows/ci-cd.yml)

InternBid is a mobile-friendly internship company bidding and CV allocation system built with Next.js 16, Supabase, and Cloudflare Workers.

## Included

- Supabase email/password authentication with SSR cookies.
- Student, administrator, and read-only committee roles.
- Responsive student portal with point balances, committee-round Stay or Withdraw responses, student-set automatic bids, live rankings, participant names, private notifications, and a point ledger.
- Administrator control room where the committee chooses a bidding method per company, controls committee bid increases, monitors automatic auctions, closes/finalizes sessions, manages companies and student points, exports data, and reviews the audit log.
- Admin-only company editing and transactional CSV creation with audited changes to catalogue details, bid rules, and schedules.
- A public `/analytics` page with realtime current bids, aggregate demand, and current applicant names with their bidding status. Emails, student indexes, points, and administrative data remain private.
- PostgreSQL row-level security and locked, transactional RPCs for every point-changing bidding action.
- Private Supabase Broadcast channels. Live events contain company metrics only; student identities are never broadcast to other students.
- Cloudflare Workers deployment through the official OpenNext adapter.

## 1. Create the Supabase project

1. Create a project in Supabase.
2. Open the SQL editor and run the files in `supabase/migrations` in filename order, or link the Supabase CLI and run `supabase db push`. Existing installations must apply every migration newer than the latest entry in their migration history, through `202608060016_uom_student_identity_constraints.sql`.
3. If Google sign-in is enabled, open **Authentication → URL Configuration** and add:
   - `http://localhost:3000/auth/callback`
   - `https://your-production-domain/auth/callback`
   Set **Site URL** to `https://your-production-domain` in production. The
   production callback must appear exactly in **Redirect URLs**, otherwise
   Supabase falls back to the Site URL. Password registration does not use this
   callback.
4. In **Authentication → Providers → Email**, turn off **Confirm email** so
   password registration creates an active session immediately and sends no
   signup-verification message.
5. For production private Broadcast channels, disable public channel access in **Realtime → Settings**.

New Auth users automatically receive a student profile with 80 points. Administrators can import exact IP allocations from CSV on the student management page; site students missing from an import receive the 80-point default, while unknown CSV indexes are ignored. To make the first administrator, run this once after that person signs in:

```sql
update public.profiles
set role = 'admin'
where email = 'committee.admin@uom.lk';
```

Committee viewers use `role = 'viewer'`.

## 2. Configure the app

Copy `.env.example` to `.env.local` and set:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

The sign-up page accepts only the exact `uom.lk` email domain and collects the student’s name, index, and password confirmation. Migration `202608060016_uom_student_identity_constraints.sql` applies the same restriction to direct Supabase Auth calls and stores student indexes in uppercase behind a case-insensitive unique index. It stops with a preflight error if an existing student email or index must be corrected first. Supabase Auth securely manages the password; the public profile stores no password or password hash.

Local Supabase already uses immediate password registration through
`auth.email.enable_confirmations = false` in `supabase/config.toml`.

Migration `202608050004_confirm_existing_email_users.sql` confirms accounts
that were created before confirmation was disabled. Apply it with the other
migrations or run its `UPDATE` statement once in the Supabase SQL Editor.

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

## 4. Per-company bidding methods

The committee selects the method while a company is still **Upcoming**. It is locked once bidding starts so an in-progress session cannot switch rule sets.

### Committee-controlled bidding

- Students apply at the company’s current bid and reserve that amount.
- When a company is oversubscribed, an administrator enters the increment for that round on the fly. The configured increment only prefills the control, and the new current bid is previewed immediately.
- Every participating student receives a private notification and must choose **Stay** or **Withdraw** before the response deadline.
- Staying reserves the additional points. Any manual self-withdrawal permanently charges the initial/base bid plus `ceil((current bid − initial bid) × withdrawal percentage)` and releases the previous reservation.
- The percentage is configured per company and defaults to 10%. A charge is capped at the student’s usable points so the balance never becomes negative.
- Authenticated students can see the names and response states of students currently in the session, plus applicant and available-slot counts. Emails, registration numbers, point balances, and administrator data are not exposed.

The Stay/Withdraw deadline is configurable per company. Migration `202608060013_finalize_manual_bidding_at_deadline.sql` makes the deadline terminal: it force-withdraws overdue responses with the same penalty, selects students up to the CV requirement, releases non-selected reservations, and finalizes the company. The admin dashboard also starts this settlement at zero and opens the result list. A 10-second `pg_cron` sweep provides the server-side fallback. If Cron is unavailable locally, schedule this function externally:

```sql
select public.process_expired_bid_responses();
```

### Automatic ranked bidding

- Students enter their own whole-number bid and may only increase it while the auction is open. The bid cannot exceed their usable points or the company maximum.
- Each bid reserves the additional points atomically and restarts the company inactivity timer.
- When the timer expires, the top bids up to the CV-slot target are selected. Equal bids favor the earlier submission. Winners spend their individual bid; all other reservations are released.
- A student who withdraws pays their first bid plus `ceil((latest bid − first bid) × withdrawal percentage)`, capped at their usable balance.
- The inactivity window is configured per company from 30 seconds to 24 hours and defaults to 120 seconds. Administrators can pause, resume, or close an auction immediately.
- The migration installs a `pg_cron` sweep every 10 seconds when the extension is available. On hosted Supabase, ensure the Cron integration/extension is enabled; the close function is `public.close_inactive_automatic_bidding()`.

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
- Committee-mode points are spent at the committee-controlled current bid; automatic-mode winners spend their individual bids.
- Normal committee withdrawal releases reserved points; committee increase withdrawals and automatic-mode withdrawals apply their configured charge.
- Missed bid responses automatically use the same withdrawal-charge workflow when the expiry function is scheduled.
- Students see participant names and response states, but not emails, indexes, balances, or other private profile data.
- Notifications are portal-only.
- Supabase is the point-balance source of truth; Sheets should be treated as import/export only.

These defaults are stored in `system_settings` for visibility. Some policy changes, such as allowing multiple live companies, also require updating the relevant database RPC guard.

## Security notes

- Authenticated pages are dynamically rendered and must not be cached by a CDN.
- `middleware.ts` refreshes sessions using `getClaims()` and forwards Supabase’s private/no-store cache headers. Next.js 16 normally calls this boundary `proxy.ts`; the current OpenNext Cloudflare adapter still requires the legacy Edge Middleware filename because it does not yet support Node-runtime Proxy.
- Students have no direct `INSERT` or `UPDATE` policy on applications, balances, bid history, or audit logs.
- Anonymous users have no direct table access. Public analytics is served by a security-definer function that returns company statistics plus current applicant names and response status; its public realtime event contains only the changed company ID.
- The authenticated participant-list function exposes names and response state only; it does not relax profile RLS or publish identities over public realtime.
- Bid responses, withdrawal charges, and finalization lock affected rows and update balances in PostgreSQL transactions.
- Important mutations re-check authentication and role inside the database, even when the UI hides the control.

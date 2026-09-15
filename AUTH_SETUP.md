# Authentication and private saved stories

The app uses email and password for registration and sign-in. Google sign-in is
not used. Registration includes password confirmation. Supabase Auth manages
accounts and password hashing; do not create a separate password table or insert
passwords with SQL. No additional SQL migration is needed to enable email login.
The migrations below provide private saved stories and collections after login.

## 1. Apply the SQL

Open the SQL Editor in your Supabase project and run:

[`backend/migrations/001_user_saved_stories.sql`](backend/migrations/001_user_saved_stories.sql)

It creates `upfeed_bookmarks` and `upfeed_collections`, ownership constraints,
duplicate protection, indexes, and row-level security policies. It is rerunnable.
Only the signed-in owner can access a row. Bookmarks cannot use someone else's
collection. Removing a collection keeps its stories in the general saved list.

Old `bookmarks` and `collections` tables are retained but their browser/API grants
are revoked. Old local JSON files are left untouched. They have no reliable
account ownership, so the app does not automatically expose or import them into
an account. The new private reading room starts empty. An administrator can
review and explicitly assign legacy stories separately.

## 2. Set environment variables

After migration 001, run
[`backend/migrations/002_saved_story_updates.sql`](backend/migrations/002_saved_story_updates.sql).
It adds automatic `updated_at` timestamps to stories and collections, including
when a story moves to another collection. Existing rows start with their creation
time because historical update times are unknown. Both migrations are rerunnable.

Then run [`backend/migrations/check_saved_stories.sql`](backend/migrations/check_saved_stories.sql).
Every returned `passed` value should be `true`. These read-only checks inspect
tables, RLS enablement, ownership links, timestamps, and triggers. They do not
replace testing with two real signed-in accounts. These files have not been
applied to your cloud database automatically.

In Saved, use the × beside a collection to delete it after confirmation. Its
stories remain under All. Removing a story reloads the saved list so subsequent
pages do not skip entries after their positions change.

In `frontend/.env`:

```dotenv
VITE_API_URL=http://127.0.0.1:8000
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

In `backend/.env`:

```dotenv
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

Both must use the same project. Legacy `SUPABASE_ANON_KEY` is also supported.
Keep any service-role key on the backend only; never place it in a `VITE_`
variable. A service-role key is not required for this implementation.

## 3. Configure Supabase Auth

Enable the Email provider. Keep email confirmation enabled for production.
Set the Site URL to your frontend deployment and allow your development URL
(`http://localhost:5173` and/or `http://127.0.0.1:5173`) in Redirect URLs.
Use the actual deployed frontend URL for production confirmation redirects.
Allow `http://localhost:5173/?welcome=1`, `http://127.0.0.1:5173/?welcome=1`,
and your deployed frontend URL with `/?welcome=1` in Supabase Redirect URLs.
New confirmation and resend links request this destination: the news feed opens
directly and shows a welcome banner after a session is established. Existing
emails keep their original redirect. Supabase's hosted email page and redirect
allowlist are cloud settings and are not changed by editing the frontend.
The app supports email/password registration, confirmation, sign-in, session
restoration, token refresh, and sign-out. Configure production email delivery
in Supabase before inviting users.

If login reports an unconfirmed email, open the signup link in your inbox or
spam folder. The sign-in dialog also offers **Resend confirmation email**, with
a one-minute cooldown after a successful request. Confirmation is required when
the project's Confirm email setting is enabled; successful signup alone does
not sign the account in. See [Supabase resend documentation](https://supabase.com/docs/reference/javascript/auth-resend).

Restart the frontend and backend after changing environment variables.
From `D:\news-aggregator\backend`:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

## Save behavior

Browsing and reading news remain public. Saving as a guest opens sign-in and
preserves the selected story. Once signed in, select the general list or a
collection. The dialog closes only after a successful save; errors stay visible
for retry. Saving the same URL again updates the saved story and its collection.
Saved stories retain their source, image, description, and publication date.
Checkmarked save buttons identify stories already in your reading room.

The backend verifies each bearer token against Supabase Auth and uses that same
token for database operations, preserving RLS. Signed-out/expired sessions get
401. Private endpoints never fall back to shared JSON storage. Account changes
cancel private loads and hide the previous account's reading room immediately.

## Verification

Run `python -m unittest discover -s tests -v` from `backend`, and `npm run lint`
and `npm run build` from `frontend`. `frontend/check-auth.cjs` tests the browser
flow with a mock auth provider and mocked API; it does not send signup emails.
Like `check-browser.cjs`, it accepts PLAYWRIGHT_MODULE and BROWSER_CHANNEL.
Real signup/email delivery and database behavior require applying the SQL and
configuring your Supabase project; the migration is supplied, not automatically
run against your cloud database.

References: [Supabase Auth events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange),
[Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security).

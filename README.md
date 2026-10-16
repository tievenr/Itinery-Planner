# Trip Planner

A reusable, shareable trip planner: day-by-day itinerary with a map, budget, bookings, and a bill splitter.
Static site (no build step) on GitHub Pages, with a free Supabase project as the shared backend.

- **Itinerary**: day tabs, ordered activities (time, category, cost, notes, link), and a map with pins.
- **Budget**: planned vs spent by category and by day.
- **Bookings**: flights, stays, reservations, with tap-to-copy confirmation numbers.
- **Splitter**: bills with items shared by different people. Tax, tip and fees are split in proportion to each person's items. Running balances and a short settle-up list across the whole trip.
- **Trip**: details, travelers, share link, duplicate as template, JSON export / import.
- Light and dark mode (follows your system, with a toggle). Works on phones.

## How sharing works

Creating a trip generates a trip id and an edit code. The share link looks like
`https://you.github.io/repo/#/t/<trip-id>/itinerary?k=<code>`. Anyone with the link can view and edit.
There are no accounts: each person enters a display name, which is stored in their browser and shown on edits.
The code is stored in the link's `#` fragment, so it is never sent to GitHub's servers.

The database tables are locked down. The browser can only call functions in `supabase/functions.sql`,
and every one of them checks the code before reading or writing. The anon key in `config.js` is meant
to be public.

## Setup (about 10 minutes)

### 1. Supabase

1. Create a free project at <https://supabase.com>.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
3. Paste and run `supabase/functions.sql`.
4. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Configure the app

Copy `config.example.js` to `config.js` and fill in the two values:

```js
export const SUPABASE_URL = 'https://abcd1234.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';
```

Never use the `service_role` key here. `config.js` is committed on purpose: GitHub Pages needs it.

### 3. Deploy on GitHub Pages

1. Create a GitHub repo (public; free accounts can only publish Pages from public repos) and push this folder.
2. **Settings → Pages → Build and deployment**: deploy from branch `main`, folder `/ (root)`.
3. After a minute the site is live at `https://<user>.github.io/<repo>/`.

Tip: the site is public, so use a non-obvious repo name if you'd rather it not be found. Trip data is protected by the trip code, not by hiding the site.

### 4. Keep the free Supabase project awake

Free Supabase projects pause after about a week of inactivity. While paused, nothing loads or saves
(your data is kept; restore the project from the Supabase dashboard). To reduce the chance of that:

1. In the GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**, add
   `SUPABASE_URL` and `SUPABASE_ANON_KEY` (same values as `config.js`).
2. Open the **Actions** tab, pick **Keep Supabase awake**, and click **Run workflow** once. It should finish green.
3. It then runs automatically every Monday and Thursday.

Notes: this is a mitigation, not a guarantee, so check that your project stays active. GitHub may disable
scheduled workflows in repos with no activity for 60 days; re-enable it from the Actions tab if so.
Also export trips to JSON now and then (**Trip → Backup**).

### 5. Use it

Open the site, **New trip**, add travelers on the **Trip** page, then copy the share link and send it.
You can also open a trip from a link with **Open with link** on the home screen.

## Using the pieces

- **Map pins**: edit an activity, then tap the map, or paste coordinates (`38.7139, -9.1394`) or a full Google / Apple / OpenStreetMap link. Short links (maps.app.goo.gl) don't contain coordinates and can't be read. There is no place search.
- **Splitter**: New bill, pick the payer, add items, and tap the people who shared each one ("Everyone" for shared dishes). Items nobody is assigned to are flagged and left out until assigned. Enter tax, tip and fees on the bill; they're split in proportion to each person's items.
- **Duplicate as template**: Trip → Share → Duplicate. Copies travelers, days, activities and budget lines (dates shifted if you pick a new start date); bookings and bills are not copied.
- **Export / import**: Trip → Backup exports a JSON file. **Import file** on the home screen always creates a new trip (new link and code); it never overwrites an existing one.

## Project layout

```
index.html              entry point
config.example.js       copy to config.js
css/                    base.css (tokens, shell), components.css
js/app.js               boot, routing, shell, re-rendering
js/api.js               Supabase calls and live-sync channel
js/store.js             client state, optimistic writes, selectors
js/pages/               home, setup, itinerary, budget, bookings, splitter
js/lib/                 split.js (bill maths), money.js, dates.js, mapLinks.js, map.js, dom.js, cats.js
supabase/               schema.sql, functions.sql
tests/split.test.mjs    unit tests for the splitting, money and map-link logic
.github/workflows/      keep-alive.yml
```

Run the tests with `node tests/split.test.mjs` (Node 18+).

## Things to know

- **Money** is stored as integer minor units (cents) and the split always adds up to the exact bill total. Each money column also has a currency field, so mixed currencies can be added later without a schema change. For now one currency applies to the whole trip.
- **Live updates** use Supabase Broadcast: after a save, other open copies refetch. There is also a 30-second refresh as a fallback. Edits are last-write-wins per field.
- **Anyone with the link can edit** and can type any display name. That's fine for friends and family; don't share the link publicly.
- **Anyone who finds your site can create trips** (and so use some of your free database space). Per-trip row limits are enforced in the database. If you ever see abuse, rotate the anon key in Supabase and update `config.js`.
- **Map tiles** come from OpenStreetMap's public tile server, which is fine for personal use.

## Troubleshooting

- *"Setup needed"*: `config.js` is missing or still has placeholder values.
- *"Can't reach the server"* or everything fails after a quiet spell: the free Supabase project is probably paused. Restore it from the Supabase dashboard.
- *"That trip code is not valid"*: the link was truncated; ask for the full link.
- *A function error mentioning `gen_random_bytes` or `crypt`*: `schema.sql` creates the `pgcrypto` extension; re-run it, or enable `pgcrypto` under **Database → Extensions**.

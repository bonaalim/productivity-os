# Productivity OS v13

Static frontend + Supabase sync version. You do not need to connect a framework in Supabase; run the SQL directly in SQL Editor after creating the Supabase project.

## Files

- `index.html` — GitHub Pages entry point
- `app.js` — app logic
- `styles.css` — UI styling
- `supabase-config.js` — public Supabase URL/key config
- `supabase-schema.sql` — one-row-per-user JSONB sync table + explicit API grants + RLS policies
- `seed-data.js` — intentionally empty for production; personal data should not be committed
- `assets/execution_algorithm.png` — execution algorithm reference image
- `.nojekyll` — disables Jekyll processing on GitHub Pages

## Supabase setup

1. Open Supabase SQL Editor.
2. Run all SQL in `supabase-schema.sql`.
3. Go to Project Settings → API.
4. Copy your Project URL and publishable/anon key.
5. Paste them into `supabase-config.js`.
6. Enable email/password auth in Authentication settings if needed.

The app stores the whole current MVP state in `public.app_states.data` as JSONB. This is intentional for v12: it keeps the already-stable local UI code mostly unchanged and avoids premature schema fragmentation. RLS restricts each row to its owner.

## GitHub Pages setup

1. Commit all files in this folder to a GitHub repository.
2. In the repository, go to Settings → Pages.
3. Set Source to Deploy from a branch.
4. Select your branch and root folder `/`.
5. Open the published GitHub Pages URL.

## Migration from local MVP

If you have data in an older local version:

1. Open the old local app.
2. Use JSON Export.
3. Open v12, sign in, then use Backup → JSON Import.
4. The imported state will be saved to Supabase.

Do not commit exported personal JSON backups to a public repository.

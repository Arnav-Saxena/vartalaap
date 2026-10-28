# Vartalaap

Vartalaap is a responsive, vintage-inspired messaging website built with React, Vite, TypeScript, Supabase, and Gemini. It includes email/password accounts, saved Lorelei avatars, private one-to-one conversations with realtime updates, and a per-user AI companion with saved settings, chat history, and editable long-term memories.

The interface uses the supplied palette: mint `#CAE4DB`, warm stone `#CDC7BE`, dusty blue `#87A7B3`, and mauve brown `#766161`. The desktop layout keeps conversations in a narrow left rail and the open conversation on the right; on phones, the list and active conversation become separate screens.

## Requirements

- Node.js 20 or newer and npm
- A Supabase project
- A Google Gemini API key for the AI companion
- Supabase CLI for database/function deployment (or use the Supabase Dashboard SQL Editor for the migration)

## Run locally

1. Install packages:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env.local` and set the project URL and **publishable/anon key** from Supabase → Project Settings → API.

   ```dotenv
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-public-anon-or-publishable-key
   ```

   These are browser-safe public values. **Never** put a Supabase service-role key or Gemini API key in a `VITE_` variable.

3. Apply the database migration:

   ```sh
   supabase link --project-ref your-project-id
   supabase db push
   ```

   Alternatively, paste and run [`supabase/migrations/20261028000000_initial_schema.sql`](./supabase/migrations/20261028000000_initial_schema.sql) in the Supabase Dashboard → SQL Editor. It creates the profile, direct-message, AI settings/history/memory tables, RLS policies, avatar bucket policies, helper RPCs, and the Realtime publication entry.

4. Start the website:

   ```sh
   npm run dev
   ```

   Without the two public Supabase values, the site intentionally displays a setup screen rather than pretending authentication or messaging works.

## Configure Supabase

### Authentication

- In Authentication → Providers, enable **Email**.
- Choose whether email confirmation is required. When enabled, Vartalaap tells new users to confirm their address before signing in; the selected avatar seed is saved in their account metadata and the SVG is uploaded after their first authenticated sign-in.
- In Authentication → URL Configuration, set the local site URL (for example `http://localhost:5173`) and add the Vercel production URL and any preview URLs to the allowed redirect URLs.

### Database, access control, and storage

- Apply the SQL migration above before using the app.
- The migration creates the public `avatars` bucket. Avatar SVGs are publicly readable; insert, replace, and delete policies restrict writes to the authenticated user's own `<user-id>/` folder.
- Profiles are owner-readable. The authenticated `search_profiles` RPC searches display names and email addresses without granting broad profile-table reads.
- Direct conversations are created through `get_or_create_direct_conversation`, which canonicalizes each user pair so only one exists. RLS restricts conversation/message access to its two participants.
- AI configuration, history, and memories each have owner-only RLS policies.
- The migration adds `public.messages` to `supabase_realtime`. Confirm that Realtime is enabled for the project if live messages do not arrive.

### Gemini Edge Function

1. Add the Gemini key to Supabase's server-side secret store:

   ```sh
   supabase secrets set GEMINI_API_KEY=your-gemini-api-key
   ```

2. Deploy the function from the repository root:

   ```sh
   supabase functions deploy ai-companion
   ```

   JWT verification is enabled in `supabase/config.toml`. The function verifies the user, reads their own saved profile/memories/history under RLS, calls Gemini server-side, and saves both sides of the AI conversation. It only sends a short recent history and a small set of relevant memories. Memory extraction is limited to concise, user-stated durable facts, and credential-like memories are rejected.

3. Confirm the Gemini API is enabled for the Google Cloud project behind the key and that the chosen Gemini model is available to it. Missing keys, rate limits, and provider failures are reported in the app.

## Deploy to Vercel

1. Import the repository into Vercel and select the **Vite** framework preset.
2. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as project environment variables for the environments you use.
3. Deploy. The default Vite build command is `npm run build`; the output directory is `dist`.
4. Add the Vercel production domain to Supabase Authentication's site URL and redirect allowlist.
5. Apply the migration and deploy the Edge Function to Supabase separately; Vercel hosts only the frontend.

## Useful commands

```sh
npm run dev       # Local development
npm run build     # Type-check and create the production bundle
npm run preview   # Serve the production bundle locally
```

## Project map

- `src/App.tsx` — authentication, responsive messaging UI, realtime subscriptions, and companion controls
- `src/styles.css` — vintage visual system and mobile/desktop layouts
- `src/lib/avatar.ts` — DiceBear Lorelei preview and one-time authenticated SVG upload
- `src/lib/database.types.ts` — app table and RPC types
- `supabase/migrations/` — database schema, RLS, RPCs, Storage, and Realtime setup
- `supabase/functions/ai-companion/` — authenticated Gemini and memory workflow
- `.env.example` — public frontend configuration only
- `MASTER_PROJECT_PROMPT.md` — concise product brief for future development

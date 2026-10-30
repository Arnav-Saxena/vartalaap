# Vartalaap

Vartalaap is a responsive, vintage-inspired messaging website built with React, Vite, TypeScript, Supabase, and Gemini. It includes email/password accounts, saved Lorelei avatars, private one-to-one conversations with realtime updates, Mandali text communities, and a per-user AI companion with saved settings, chat history, and editable long-term memories.

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

   Alternatively, paste and run the SQL migration files in `supabase/migrations/` in timestamp order in the Supabase Dashboard → SQL Editor. The migrations create the profile, direct-message, AI, and Mandali community tables, their access policies and RPCs, avatar bucket policies, and Realtime publication entries.

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
- Mandali members and discoverable communities are checked by database policies and authenticated RPCs. Private communities can only be joined through a seven-day invite link. Community messages are readable and writable only by current members; message and membership management is checked server-side.

### Mandali communities

The Mandali section supports private or discoverable communities, seven-day invite links, member rosters, admin actions, realtime General-channel text messages, LiveKit voice rooms, and realtime Tic-Tac-Toe matches. Apply the migrations in timestamp order before using it.

Voice access tokens are issued only by the authenticated `mandali-voice-token` Edge Function after it verifies current Mandali membership. LiveKit API credentials stay in Supabase Edge Function secrets; never put them in the frontend or Cloudflare variables.

To enable voice chat:

1. Create a LiveKit project and copy its WebSocket URL, API key, and API secret from the LiveKit project settings.
2. Add these secrets to Supabase without committing them or sharing them in chat:

   ```sh
   supabase secrets set LIVEKIT_URL=wss://your-project.livekit.cloud LIVEKIT_API_KEY=your-livekit-api-key LIVEKIT_API_SECRET=your-livekit-api-secret
   ```

3. Deploy the token issuer:

   ```sh
   supabase functions deploy mandali-voice-token
   ```

4. Sign in, open a Mandali's Voice Chat tab, and choose **Join voice**. The browser asks for microphone permission at that point. Voice sessions end when the user leaves the room or switches away from that community.

Krida currently offers member-only, real-time Tic-Tac-Toe rooms inside each Mandali. Game creation, joining, turn order, and win/draw validation are enforced by database RPCs; the current board is persisted for refreshes and synchronized over Supabase Realtime.

Direct-message authors can delete their own messages for both conversation participants. The delete policy is enforced by PostgreSQL RLS.

Direct conversations have a **Play a board game** picker for PaperGames Tic-Tac-Toe, Connect 4, Gomoku, Battleships, Chess, Checkers, and Backgammon. Vartalaap creates a private two-player session through PaperGames' documented API, posts its invite into the DM, and embeds the game for each participant. PaperGames API credentials are used only by the `papergames-game-session` Supabase Edge Function; never add them to frontend or Cloudflare variables. The Mandali Tic-Tac-Toe game remains separate.

To configure PaperGames integration:

1. Create an API key in the PaperGames developer tools.
2. Save it as a Supabase Edge Function secret and deploy the function:

   ```sh
   supabase secrets set PAPERGAMES_API_KEY=your-papergames-api-key
   supabase functions deploy papergames-game-session
   ```

3. Open a DM, choose the board-game icon, and select a game. The other participant can join by opening the invite in that DM.

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

3. Confirm the Gemini API is enabled for the Google Cloud project behind the key. The function defaults to `gemini-3.1-flash-lite`. If your API project uses a different supported text model, set the optional `GEMINI_MODEL` Supabase secret to that model ID. Missing keys, rate limits, and provider failures are reported in the app.

## Deploy to Cloudflare Workers

The included `worker.ts` supports Cloudflare Worker runtime variables. In Cloudflare → Workers & Pages → your Worker → Settings → Variables and Secrets, add:

- `SUPABASE_URL` - the project URL
- `SUPABASE_ANON_KEY` - the public anon/publishable key (or use `SUPABASE_PUBLISHABLE_KEY`)

The Worker injects only these public values into the HTML response at request time. Do not configure or expose a service-role key. After setting variables, redeploy the Worker. For a Git-connected deployment, use `npm run deploy` as the deploy command; it type-checks and builds the Vite app, then deploys the static assets and Worker entry point via Wrangler. The `SUPABASE_URL`/`SUPABASE_ANON_KEY` Worker runtime bindings are supported directly, as are `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`.

The Gemini API key stays exclusively in Supabase Edge Function secrets; it is not a Cloudflare frontend variable.

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

- `src/App.tsx` - authentication, responsive messaging UI, realtime subscriptions, and companion controls
- `src/components/MandaliSection.tsx` - community discovery, membership, moderation, and realtime General channel
- `src/components/DirectBoardGamePicker.tsx` - PaperGames game creation and embedded two-player session
- `src/styles.css` - vintage visual system and mobile/desktop layouts
- `src/lib/avatar.ts` - DiceBear Lorelei preview and one-time authenticated SVG upload
- `src/lib/database.types.ts` - app table and RPC types
- `supabase/migrations/` - database schema, RLS, RPCs, Storage, and Realtime setup
- `supabase/functions/ai-companion/` - authenticated Gemini and memory workflow
- `supabase/functions/mandali-voice-token/` - authenticated, membership-checked LiveKit token issuer
- `supabase/functions/papergames-game-session/` - authenticated PaperGames session creation
- `.env.example` - public frontend configuration only
- `MASTER_PROJECT_PROMPT.md` - concise product brief for future development

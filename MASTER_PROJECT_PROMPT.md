# Vartalaap — Master Project Prompt

Build and maintain **Vartalaap**, a deployable, mobile-first and desktop-friendly browser messaging product. It combines real person-to-person messaging with a private, personalized AI companion for every registered user. This is a working application, not a static prototype.

## Product and design

- Use React, Vite, and TypeScript for the frontend; Supabase Auth, PostgreSQL, Realtime, Storage, and Edge Functions for backend services; and Google Gemini for companion responses.
- Use a cohesive, vintage-inspired interface with raised, tactile buttons and warm, editorial typography. The supplied palette is mint `#CAE4DB`, warm stone `#CDC7BE`, dusty blue `#87A7B3`, and mauve brown `#766161`.
- On desktop, keep a narrower conversations rail at the left and the active conversation on the right. On mobile, let users move naturally between the people list, a direct conversation, and My AI. Avoid horizontal overflow, make text wrap, and keep controls touch-friendly.
- Use useful empty, loading, success, and actionable error states. Never show a control that implies a feature works when it does not.

## Accounts and discovery

- Use real Supabase email/password authentication.
- Registration collects display name, email, password, and a randomized DiceBear Lorelei avatar preview. Randomization must not upload previews. Save the selected seed/style with the account and upload its SVG to the user's own public avatar path once an authenticated session is available.
- Keep user profile and avatar details consistent across search results, conversation lists, headers, and account UI.
- Authenticated users can find other registered people by display name or email and start a direct conversation.

## Direct messaging

- Persist one-to-one conversations and messages in PostgreSQL.
- Ensure there can be only one conversation per user pair.
- Load conversation history after refresh and subscribe to new messages with Supabase Realtime.
- Use RLS to restrict reads to the two conversation participants and restrict sends to a participant acting as themselves.

## Private AI companion and memory

- Each user has independent saved companion name, personality, instructions, and preferences.
- Keep AI chat history in PostgreSQL and include a bounded recent portion in future requests.
- Use an authenticated Supabase Edge Function as the only Gemini caller. Keep the Gemini key in Supabase secrets; never expose it in browser code.
- Use saved user settings and a small relevant subset of the user's long-term memories in the system instructions.
- Extract only concise, durable facts the user stated; never store credentials or claim facts that were not saved. Show the memory list to its owner and let them add/remove entries.
- Keep AI messages and memory private and separate from direct conversations.
- Report missing configuration, provider failures, and rate limits clearly.

## Security and operations

- Use PostgreSQL RLS for all user-specific records and participant-based policies for direct chats.
- Restrict avatar writes to the authenticated user's own Storage folder.
- Frontend environment configuration may contain only the Supabase project URL and public anon/publishable key. Never ship service-role or Gemini secrets.
- Include a reproducible SQL migration, Edge Function source, `.env.example`, setup/deployment documentation, and Vercel instructions.
- Verify changes with the narrowest relevant build/tests and preserve real backend behavior rather than replacing it with mock data.

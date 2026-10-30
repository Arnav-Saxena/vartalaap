import { AccessToken } from "npm:livekit-server-sdk@2";
import { TrackSource } from "npm:@livekit/protocol@1.51.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  try {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Sign in to join voice chat." }, 401);
  }

  const livekitUrl = Deno.env.get("LIVEKIT_URL");
  const apiKey = Deno.env.get("LIVEKIT_API_KEY");
  const apiSecret = Deno.env.get("LIVEKIT_API_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!livekitUrl || !apiKey || !apiSecret) {
    return jsonResponse({ error: "LiveKit is not configured for this project yet." }, 503);
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "The voice function is missing its Supabase project configuration." }, 503);
  }

  const token = authorization.slice("Bearer ".length);
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return jsonResponse({ error: "Your session has expired. Please sign in again." }, 401);

  let mandaliId: unknown;
  try {
    const body = await request.json() as { mandaliId?: unknown };
    mandaliId = body.mandaliId;
  } catch {
    return jsonResponse({ error: "The request body must include a Mandali ID." }, 400);
  }
  if (typeof mandaliId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(mandaliId)) {
    return jsonResponse({ error: "The Mandali ID is invalid." }, 400);
  }

  const { data: membership, error: membershipError } = await client.from("mandali_members")
    .select("mandali_id")
    .eq("mandali_id", mandaliId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("Could not verify Mandali voice membership:", membershipError);
    return jsonResponse({ error: "Could not verify your Mandali membership." }, 500);
  }
  if (!membership) return jsonResponse({ error: "Only current Mandali members can join its voice room." }, 403);

  const room = `mandali-${mandaliId}`;
  const displayName = typeof user.user_metadata.display_name === "string"
    ? user.user_metadata.display_name.trim().slice(0, 80)
    : "Member";
  const accessToken = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: displayName || "Member",
    ttl: "1h",
  });
  accessToken.addGrant({
    roomJoin: true,
    room,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
  });

  return jsonResponse({ url: livekitUrl, token: await accessToken.toJwt() });
  } catch (error) {
    console.error("Mandali voice token request failed:", error);
    return jsonResponse({ error: "Could not prepare your voice connection. Please try again." }, 500);
  }
});

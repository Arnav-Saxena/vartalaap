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

const supportedGames = new Set([
  "TicTacToe",
  "Connect4",
  "Gomoku",
  "Battleships",
  "Chess",
  "Checkers",
  "Backgammon",
]);

type PaperGamesResponse = {
  uid?: unknown;
  playUrl?: unknown;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Sign in to create a game." }, 401);

  const apiKey = Deno.env.get("PAPERGAMES_API_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!apiKey) return jsonResponse({ error: "The PaperGames API key is not configured for this project." }, 503);
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "The Supabase Edge Function is missing its project configuration." }, 503);
  }

  const token = authorization.slice("Bearer ".length);
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return jsonResponse({ error: "Your session has expired. Please sign in again." }, 401);

  let gameType: unknown;
  let conversationId: unknown;
  try {
    const body = await request.json() as { gameType?: unknown; conversationId?: unknown };
    gameType = body.gameType;
    conversationId = body.conversationId;
  } catch {
    return jsonResponse({ error: "The request body must include a game and conversation." }, 400);
  }
  if (typeof gameType !== "string" || !supportedGames.has(gameType)) {
    return jsonResponse({ error: "That PaperGames game is not supported." }, 400);
  }
  if (typeof conversationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversationId)) {
    return jsonResponse({ error: "The conversation ID is invalid." }, 400);
  }

  const { data: conversation, error: conversationError } = await client.from("direct_conversations")
    .select("user_a,user_b")
    .eq("id", conversationId)
    .maybeSingle();
  if (conversationError) {
    console.error("Could not verify PaperGames conversation access:", conversationError);
    return jsonResponse({ error: "Could not verify your conversation access." }, 500);
  }
  if (!conversation || (conversation.user_a !== user.id && conversation.user_b !== user.id)) {
    return jsonResponse({ error: "Only conversation participants can create a game in this DM." }, 403);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response: Response;
  let responseBody: string;
  try {
    const sessionRequest: Record<string, string | number> = {
      gameType,
      language: "en",
      inactivityTimeout: 0,
      timerTimeout: 0,
      maxGames: 1,
    };
    if (gameType === "TicTacToe") sessionRequest.boardSize = "3x3";
    if (gameType === "Connect4") sessionRequest.boardSize = "7x6";
    response = await fetch("https://papergames.io/api/v2/game-session/player-vs-player", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": apiKey },
      body: JSON.stringify(sessionRequest),
      signal: controller.signal,
    });
    responseBody = await response.text();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return jsonResponse({ error: "PaperGames did not respond in time. Please try again." }, 504);
    }
    console.error("PaperGames session request failed:", error);
    return jsonResponse({ error: "Could not connect to PaperGames. Please try again." }, 502);
  } finally {
    clearTimeout(timeout);
  }

  let result: PaperGamesResponse = {};
  try {
    result = JSON.parse(responseBody) as PaperGamesResponse;
  } catch (error) {
    console.error("PaperGames returned a non-JSON session response:", error);
  }

  if (!response.ok) {
    console.error("PaperGames rejected the session request with status:", response.status, responseBody.slice(0, 1000));
    if (response.status === 401 || response.status === 403) {
      return jsonResponse({ error: `PaperGames denied API access (HTTP ${response.status}). Verify the key is copied correctly and API access is enabled for your account.` }, 502);
    }
    if (response.status === 400) {
      return jsonResponse({ error: "PaperGames rejected the session settings (HTTP 400). Check the selected game and API account access." }, 502);
    }
    if (response.status === 429) {
      return jsonResponse({ error: "PaperGames rate-limited game creation (HTTP 429). Please wait and try again." }, 502);
    }
    return jsonResponse({ error: `PaperGames could not create the game (HTTP ${response.status}). Please check the PaperGames API status and try again.` }, 502);
  }
  if (typeof result.uid !== "string" || typeof result.playUrl !== "string") {
    console.error("PaperGames returned a malformed game session response.");
    return jsonResponse({ error: "PaperGames returned an invalid game session." }, 502);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(result.uid)) {
    console.error("PaperGames returned a malformed game session ID.");
    return jsonResponse({ error: "PaperGames returned an invalid game session." }, 502);
  }
  let playUrl: URL;
  try {
    playUrl = new URL(result.playUrl);
  } catch {
    return jsonResponse({ error: "PaperGames returned an invalid game link." }, 502);
  }
  if (playUrl.origin !== "https://papergames.io" ||
    playUrl.pathname !== `/en/r/${result.uid}/embed/play`) {
    console.error("PaperGames returned a session URL outside its documented embed format.");
    return jsonResponse({ error: "PaperGames returned an invalid game link." }, 502);
  }

  return jsonResponse({ uid: result.uid, playUrl: playUrl.toString() });
});

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Settings = {
  companion_name: string;
  personality: string;
  instructions: string;
  preferences: string;
};

type HistoryMessage = { role: "user" | "assistant"; content: string };
type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  error?: { message?: string; status?: string };
};

class GeminiRequestError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly providerStatus?: string,
  ) {
    super(message);
    this.name = "GeminiRequestError";
  }
}

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function askGemini(
  apiKey: string,
  model: string,
  system: string,
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  timeoutMs = 25_000,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  let payload: GeminiResponse;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
        }),
        signal: controller.signal,
      },
    );
    payload = (await response.json()) as GeminiResponse;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new GeminiRequestError("Gemini did not respond before the request timed out.", 504, "TIMEOUT");
    }
    if (error instanceof SyntaxError) {
      throw new GeminiRequestError("Gemini returned an unreadable response.", 502, "INVALID_RESPONSE");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new GeminiRequestError(
      payload.error?.message ?? "The AI provider could not complete the request.",
      response.status,
      payload.error?.status,
    );
  }
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part) => part.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("The AI provider returned an empty response.");
  return text;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const authorization = request.headers.get("Authorization");
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-3.1-flash-lite";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!apiKey) return jsonResponse({ error: "The Gemini API key is not configured for this project." }, 503);
  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonResponse({ error: "The Supabase Edge Function is missing its project configuration." }, 503);
  }
  if (!authorization?.startsWith("Bearer ")) return jsonResponse({ error: "Sign in to use your companion." }, 401);

  const token = authorization.slice("Bearer ".length);
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await client.auth.getUser(token);
  const user = authData.user;
  if (authError || !user) return jsonResponse({ error: "Your session has expired. Please sign in again." }, 401);

  let message: string;
  try {
    const body = await request.json() as { message?: unknown };
    if (typeof body.message !== "string" || !body.message.trim() || body.message.length > 10000) {
      return jsonResponse({ error: "Write a message under 10,000 characters to continue." }, 400);
    }
    message = body.message.trim();
  } catch {
    return jsonResponse({ error: "The request body must contain a message." }, 400);
  }

  try {
    const [settingsResult, memoriesResult, historyResult] = await Promise.all([
      client.from("ai_profiles").select("companion_name,personality,instructions,preferences").eq("user_id", user.id).maybeSingle(),
      client.from("ai_memories").select("id,content,category,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false }).limit(50),
      client.from("ai_messages").select("role,content").eq("user_id", user.id).order("created_at", { ascending: false }).limit(16),
    ]);

    if (settingsResult.error) throw settingsResult.error;
    if (memoriesResult.error) throw memoriesResult.error;
    if (historyResult.error) throw historyResult.error;

    const settings: Settings = settingsResult.data ?? {
      companion_name: "Mitra",
      personality: "Warm, thoughtful, and easy to talk to.",
      instructions: "",
      preferences: "",
    };
    const words = new Set(message.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
    const memories = memoriesResult.data ?? [];
    const relevantMemories = memories
      .map((memory) => ({
        ...memory,
        score: [...words].reduce((score, word) => score + (memory.content.toLowerCase().includes(word) ? 1 : 0), 0),
      }))
      .sort((a, b) => b.score - a.score || Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .slice(0, 8)
      .filter((memory) => memory.score > 0 || memories.length <= 8);
    const priorMessages = (historyResult.data ?? []).reverse() as HistoryMessage[];

    const { data: savedUserMessage, error: saveUserError } = await client.from("ai_messages")
      .insert({
        user_id: user.id,
        role: "user",
        content: message,
      })
      .select("id")
      .single();
    if (saveUserError) throw saveUserError;

    const system = [
      `You are ${settings.companion_name}, this user's private AI companion in Vartalaap.`,
      `Personality and tone: ${settings.personality}`,
      settings.instructions ? `User's custom instructions: ${settings.instructions}` : "",
      settings.preferences ? `User preferences and context: ${settings.preferences}` : "",
      relevantMemories.length
        ? `Saved long-term memories (use only when relevant):\n${relevantMemories.map((memory) => `- [${memory.category}] ${memory.content}`).join("\n")}`
        : "There are no saved long-term memories. Do not claim to remember personal facts unless they appear in this conversation.",
      "Be honest about what is and is not in saved memory. Do not invent personal details. Keep responses natural and concise.",
    ].filter(Boolean).join("\n\n");
    const contents = [
      ...priorMessages.map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ];

    let reply: string;
    try {
      reply = await askGemini(apiKey, model, system, contents);
    } catch (error) {
      if (error instanceof GeminiRequestError) {
        console.error("Gemini request failed:", {
          httpStatus: error.httpStatus,
          providerStatus: error.providerStatus,
          message: error.message,
        });
      } else {
        console.error("Gemini request failed before receiving a provider response:", error);
      }
      const { error: cleanupError } = await client.from("ai_messages")
        .delete()
        .eq("id", savedUserMessage.id)
        .eq("user_id", user.id);
      if (cleanupError) console.error("Could not remove the failed request from AI history:", cleanupError);
      if (error instanceof GeminiRequestError) {
        if (error.httpStatus === 429) {
          return jsonResponse({ error: "Gemini is rate-limiting requests. Wait a minute and try again." }, 429);
        }
        if (error.httpStatus === 400 || error.httpStatus === 401 || error.httpStatus === 403) {
          return jsonResponse({
            error: "Gemini rejected its API key or request. Check that GEMINI_API_KEY in Supabase is current, the Generative Language API is enabled, and the key has permission to use Gemini.",
          }, 502);
        }
        if (error.httpStatus === 404) {
          return jsonResponse({
            error: `The configured Gemini model (${model}) is unavailable to this API key. Check that the model is supported by your Gemini API project or set the GEMINI_MODEL Supabase secret to a supported text model.`,
          }, 502);
        }
        if (error.providerStatus === "TIMEOUT") {
          return jsonResponse({ error: "Gemini took too long to respond. Please try again; if it keeps happening, check the Gemini API project and model access." }, 504);
        }
        if (error.httpStatus >= 500) {
          return jsonResponse({ error: "Gemini is temporarily unavailable. Please try again in a few minutes." }, 502);
        }
      }
      return jsonResponse({ error: "The AI request failed before Gemini returned a response. Check the Supabase Edge Function logs and try again." }, 502);
    }

    const { error: saveReplyError } = await client.from("ai_messages").insert({
      user_id: user.id,
      role: "assistant",
      content: reply,
    });
    if (saveReplyError) throw saveReplyError;

    EdgeRuntime.waitUntil((async () => {
      try {
        const extraction = await askGemini(apiKey, model,
        "Extract at most two concise, durable personal facts or preferences explicitly stated by the user. Return only a JSON array with objects shaped as {\"content\":\"...\",\"category\":\"...\"}. Never include temporary details, guesses, secrets, passwords, API keys, credentials, or sensitive financial/medical identifiers. Return [] if there is nothing useful.",
        [{ role: "user", parts: [{ text: `User message:\n${message}\n\nAssistant response:\n${reply}` }] }],
        10_000,
      );
      const parsed = JSON.parse(extraction.replace(/^```(?:json)?\s*|\s*```$/g, "")) as unknown;
      if (Array.isArray(parsed)) {
        const safeMemories = parsed
          .filter((item): item is { content: string; category?: string } =>
            typeof item === "object" && item !== null &&
            "content" in item && typeof item.content === "string")
          .map((item) => ({
            user_id: user.id,
            content: item.content.trim().slice(0, 500),
            category: typeof item.category === "string" ? item.category.trim().slice(0, 40) || "general" : "general",
          }))
          .filter((item) =>
            item.content.length > 0 &&
            !/\b(password|passcode|secret|api[\s_-]?key|credential|token)\b/i.test(item.content))
          .slice(0, 2);
        if (safeMemories.length) {
          const { error: memoryError } = await client.from("ai_memories")
            .upsert(safeMemories, { onConflict: "user_id,content", ignoreDuplicates: true });
          if (memoryError) console.error("AI reply saved, but memory extraction could not be stored:", memoryError);
        }
      }
    } catch (error) {
      console.error("AI reply saved, but memory extraction failed:", error);
    }
    })());

    return jsonResponse({ reply });
  } catch (error) {
    console.error("AI companion request failed:", error);
    return jsonResponse({ error: "Your companion could not complete that request. Please try again." }, 500);
  }
});

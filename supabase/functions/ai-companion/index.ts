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

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function askGemini(apiKey: string, system: string, contents: Array<{ role: string; parts: Array<{ text: string }> }>) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature: 0.7, maxOutputTokens: 1200 },
      }),
    },
  );
  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? "The AI provider could not complete the request.");
    Object.assign(error, { status: response.status });
    throw error;
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

    const { error: saveUserError } = await client.from("ai_messages").insert({
      user_id: user.id,
      role: "user",
      content: message,
    });
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
      reply = await askGemini(apiKey, system, contents);
    } catch (error) {
      console.error("Gemini request failed:", error);
      const providerStatus = (error as Error & { status?: number }).status;
      if (providerStatus === 429) return jsonResponse({ error: "The AI service is busy. Please wait a moment and try again." }, 429);
      return jsonResponse({ error: "Your message could not reach the AI service. Check the Gemini configuration and try again." }, 502);
    }

    const { error: saveReplyError } = await client.from("ai_messages").insert({
      user_id: user.id,
      role: "assistant",
      content: reply,
    });
    if (saveReplyError) throw saveReplyError;

    try {
      const extraction = await askGemini(apiKey,
        "Extract at most two concise, durable personal facts or preferences explicitly stated by the user. Return only a JSON array with objects shaped as {\"content\":\"...\",\"category\":\"...\"}. Never include temporary details, guesses, secrets, passwords, API keys, credentials, or sensitive financial/medical identifiers. Return [] if there is nothing useful.",
        [{ role: "user", parts: [{ text: `User message:\n${message}\n\nAssistant response:\n${reply}` }] }],
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

    return jsonResponse({ reply });
  } catch (error) {
    console.error("AI companion request failed:", error);
    return jsonResponse({ error: "Your companion could not complete that request. Please try again." }, 500);
  }
});

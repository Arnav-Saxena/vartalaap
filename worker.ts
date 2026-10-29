interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}

function escapeScriptValue(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return response;

    const runtimeConfig = {
      supabaseUrl: env.VITE_SUPABASE_URL || env.SUPABASE_URL || "",
      supabaseAnonKey:
        env.VITE_SUPABASE_ANON_KEY ||
        env.SUPABASE_ANON_KEY ||
        env.SUPABASE_PUBLISHABLE_KEY ||
        "",
    };

    const html = await response.text();
    const configScript = `<script>window.__VARTALAAP_CONFIG__=${escapeScriptValue(runtimeConfig)};</script>`;
    const configuredHtml = html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${configScript}`);
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("etag");
    headers.set("cache-control", "no-store");

    return new Response(configuredHtml, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

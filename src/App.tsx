import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowLeft, Check, ChevronRight, Clock3, Eye, EyeOff, Gamepad2, LoaderCircle, LogOut,
  MessageCircle, MessagesSquare, Palette, Plus, Search, Send, Settings2, Shuffle, ZoomIn,
  Sparkles, Trash2, UsersRound, X,
} from "lucide-react";
import { FunctionsHttpError, type Session } from "@supabase/supabase-js";
import type { AiMemory, AiMessage, AiProfile, DirectConversation, DirectMessage, Profile } from "./lib/database.types";
import { avatarUrl, randomAvatarSeed, uploadAvatar } from "./lib/avatar";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import { MandaliSection } from "./components/MandaliSection";
import { DirectBoardGamePicker, paperGamesPlayUrl, type BoardGame } from "./components/DirectBoardGamePicker";

type Notice = { kind: "success" | "error" | "info"; text: string };
type Section = "list" | "chat" | "ai" | "mandali";
type PaletteId = "vintage" | "lavender" | "ocean" | "forest";
const palettes: Array<{ id: PaletteId; label: string; colors: [string, string, string] }> = [
  { id: "vintage", label: "Vintage", colors: ["#292321", "#cae4db", "#87a7b3"] },
  { id: "lavender", label: "Lavender", colors: ["#25212d", "#d9c9f4", "#b8a2df"] },
  { id: "ocean", label: "Ocean", colors: ["#1e262b", "#b9deeb", "#78aec1"] },
  { id: "forest", label: "Forest", colors: ["#222923", "#c5e0c8", "#86b49a"] },
];
const readUiPreference = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const value = localStorage.getItem(key);
    return value && allowed.includes(value as T) ? value as T : fallback;
  } catch {
    return fallback;
  }
};
type ConversationSummary = {
  conversation: DirectConversation;
  other: Profile;
  lastMessage: DirectMessage | null;
};

function renderMessageContent(content: string, onOpenGame: (url: string, gameName: string) => void) {
  const gameUrlPattern = /^https:\/\/papergames\.io\/en\/r\/[A-Za-z0-9_-]+\/embed\/play$/i;
  const gameName = content.match(/🎮 ([^:]+) invite:/)?.[1] ?? "PaperGames game";
  return content.split(/(https?:\/\/[^\s]+)/gi).map((part, index) => {
    if (!/^https?:\/\//i.test(part)) return part;
    if (gameUrlPattern.test(part)) {
      const safeUrl = paperGamesPlayUrl(part);
      return safeUrl
        ? <button className="game-invite-link" key={`${index}-${safeUrl.href}`} onClick={() => onOpenGame(safeUrl.href, gameName)}>🎮 Join game</button>
        : part;
    }
    try {
      const url = new URL(part);
      return <a key={`${index}-${url.href}`} href={url.href} target="_blank" rel="noopener noreferrer">{part}</a>;
    } catch {
      return part;
    }
  });
}

const defaultAiProfile = (userId: string): AiProfile => ({
  user_id: userId,
  companion_name: "Mitra",
  personality: "Warm, thoughtful, and easy to talk to.",
  instructions: "",
  preferences: "",
  updated_at: new Date().toISOString(),
});

function Avatar({ profile, size = "normal" }: { profile: Pick<Profile, "avatar_seed" | "avatar_style" | "avatar_path">; size?: "small" | "normal" | "large" }) {
  const src = profile.avatar_path && supabase
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl
    : avatarUrl(profile.avatar_seed, profile.avatar_style);
  return <img className={`avatar avatar-${size}`} src={src} alt="" />;
}

function formatTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [section, setSection] = useState<Section>("list");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [boardGamePickerOpen, setBoardGamePickerOpen] = useState(false);
  const [paperGamesUrl, setPaperGamesUrl] = useState<string | null>(null);
  const [paperGamesName, setPaperGamesName] = useState<string | null>(null);
  const [creatingPaperGamesGame, setCreatingPaperGamesGame] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<Profile[]>([]);
  const [searching, setSearching] = useState(false);
  const [aiProfile, setAiProfile] = useState<AiProfile | null>(null);
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [aiMemories, setAiMemories] = useState<AiMemory[]>([]);
  const [aiDraft, setAiDraft] = useState("");
  const [aiSending, setAiSending] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [savingAiSettings, setSavingAiSettings] = useState(false);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [avatarSeed, setAvatarSeed] = useState(randomAvatarSeed);
  const [showPassword, setShowPassword] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [palette, setPalette] = useState<PaletteId>(() =>
    readUiPreference("vartalaap-palette", palettes.map((item) => item.id), "vintage"));
  const [uiZoom, setUiZoom] = useState<string>(() =>
    readUiPreference("vartalaap-zoom", ["80", "90", "100", "110", "120"], "100"));
  const bottomRef = useRef<HTMLDivElement>(null);
  const accountSettingsRef = useRef<HTMLDivElement>(null);
  const user = session?.user ?? null;

  useEffect(() => {
    if (!settingsOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!accountSettingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsOpen]);

  useEffect(() => {
    if (!supabase) {
      setAuthReady(true);
      return;
    }
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setNotice({ kind: "error", text: `Could not restore your sign-in: ${error.message}` });
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setNotice(null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!supabase || !user) {
      setProfile(null);
      setConversations([]);
      setAiMessages([]);
      setAiMemories([]);
      setAiProfile(null);
      setActiveConversationId(null);
      return;
    }
    const client = supabase;
    let cancelled = false;
    void client.from("profiles").select("*").eq("id", user.id).maybeSingle().then(async ({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setNotice({ kind: "error", text: `Could not load your profile: ${error.message}` });
        return;
      }
      if (!data) {
        setNotice({ kind: "error", text: "Your profile is missing. Apply the Supabase database migration, then sign in again." });
        return;
      }
      setProfile(data);
      if (!data.avatar_path) {
        try {
          await uploadAvatar(user.id, data.avatar_seed || "Vartalaap", data.avatar_style || "lorelei");
          const { data: refreshed, error: refreshError } = await client.from("profiles").select("*").eq("id", user.id).single();
          if (refreshError) throw refreshError;
          if (!cancelled) setProfile(refreshed);
        } catch (avatarError) {
          if (!cancelled) {
            setNotice({
              kind: "error",
              text: avatarError instanceof Error ? avatarError.message : "Your avatar could not be saved.",
            });
          }
        }
      }
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  const loadConversations = useCallback(async () => {
    if (!supabase || !user) return;
    const client = supabase;
    const { data: rows, error } = await client
      .from("direct_conversations")
      .select("*")
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
    if (error) {
      setNotice({ kind: "error", text: `Could not load conversations: ${error.message}` });
      return;
    }
    if (!rows?.length) {
      setConversations([]);
      return;
    }
    const otherIds = rows.map((row) => row.user_a === user.id ? row.user_b : row.user_a);
    const [{ data: people, error: peopleError }, { data: latestMessages, error: messagesError }] = await Promise.all([
      client.from("profiles").select("*").in("id", otherIds),
      client.from("messages").select("*").in("conversation_id", rows.map((row) => row.id))
        .order("created_at", { ascending: false }).limit(200),
    ]);
    if (peopleError || messagesError) {
      setNotice({ kind: "error", text: `Could not load conversation details: ${(peopleError ?? messagesError)?.message}` });
      return;
    }
    const byId = new Map((people ?? []).map((person) => [person.id, person]));
    const latestByConversation = new Map<string, DirectMessage>();
    for (const message of latestMessages ?? []) {
      if (!latestByConversation.has(message.conversation_id)) latestByConversation.set(message.conversation_id, message);
    }
    const summaries = rows.flatMap((conversation) => {
      const other = byId.get(conversation.user_a === user.id ? conversation.user_b : conversation.user_a);
      return other ? [{ conversation, other, lastMessage: latestByConversation.get(conversation.id) ?? null }] : [];
    }).sort((a, b) =>
      Date.parse(b.lastMessage?.created_at ?? b.conversation.created_at) -
      Date.parse(a.lastMessage?.created_at ?? a.conversation.created_at));
    setConversations(summaries);
  }, [user?.id]);

  useEffect(() => {
    if (!user || !supabase) return;
    void loadConversations();
  }, [user?.id, loadConversations]);

  useEffect(() => {
    if (!supabase || !user) return;
    const client = supabase;
    const channel = client.channel(`conversation-list-${user.id}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
      }, () => {
        void loadConversations();
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setNotice({ kind: "error", text: "Conversation list live updates are unavailable. Check that the messages table is enabled in Supabase Realtime." });
        }
      });
    return () => {
      void client.removeChannel(channel);
    };
  }, [user?.id, loadConversations]);

  useEffect(() => {
    if (!supabase || !user) return;
    const client = supabase;
    const query = searchText.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      const { data, error } = await client.rpc("search_profiles", { p_query: query });
      if (cancelled) return;
      setSearching(false);
      if (error) {
        setNotice({ kind: "error", text: `People search failed: ${error.message}` });
        return;
      }
      setSearchResults(data ?? []);
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchText, user?.id]);

  useEffect(() => {
    if (!supabase || !user) return;
    let cancelled = false;
    void Promise.all([
      supabase.from("ai_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("ai_messages").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
      supabase.from("ai_memories").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    ]).then(([settings, history, memories]) => {
      if (cancelled) return;
      const failed = settings.error ?? history.error ?? memories.error;
      if (failed) {
        setNotice({ kind: "error", text: `Could not load companion data: ${failed.message}` });
        return;
      }
      setAiProfile(settings.data ?? defaultAiProfile(user.id));
      setAiMessages([...(history.data ?? [])].reverse());
      setAiMemories(memories.data ?? []);
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    if (!supabase || !user || !activeConversationId) {
      setMessages([]);
      return;
    }
    const client = supabase;
    let cancelled = false;
    let historyLoaded = false;
    setMessages([]);
    const loadMessages = async () => {
      const { data, error } = await client.from("messages").select("*")
        .eq("conversation_id", activeConversationId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (cancelled) return;
      if (error) {
        setNotice({ kind: "error", text: `Could not load messages: ${error.message}` });
        return;
      }
      const history = [...(data ?? [])].reverse();
      setMessages((existing) => [...new Map(
        [...existing, ...history].map((message) => [message.id, message]),
      ).values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)));
    };
    const channel = client.channel(`conversation-${activeConversationId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${activeConversationId}`,
      }, (payload) => {
        const incoming = payload.new as DirectMessage;
        setMessages((existing) => [...new Map(
          [...existing, incoming].map((message) => [message.id, message]),
        ).values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)));
      })
      .on("postgres_changes", {
        event: "DELETE",
        schema: "public",
        table: "messages",
      }, (payload) => {
        const deletedId = payload.old.id;
        if (typeof deletedId === "string") {
          setMessages((existing) => existing.filter((message) => message.id !== deletedId));
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED" && !historyLoaded) {
          historyLoaded = true;
          void loadMessages();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setNotice({ kind: "error", text: "Live updates are unavailable. Check that the messages table is enabled in Supabase Realtime." });
        }
      });
    return () => {
      cancelled = true;
      void client.removeChannel(channel);
    };
  }, [activeConversationId, user?.id]);

  useEffect(() => {
    setBoardGamePickerOpen(false);
    setPaperGamesUrl(null);
    setPaperGamesName(null);
  }, [activeConversationId, section]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, aiMessages]);

  const activeConversation = useMemo(
    () => conversations.find((item) => item.conversation.id === activeConversationId) ?? null,
    [conversations, activeConversationId],
  );
  const signedInName = profile?.display_name || String(user?.user_metadata.display_name ?? "Your account");
  const signedInAvatar = profile ?? {
    avatar_seed: avatarSeed,
    avatar_style: "lorelei",
    avatar_path: null,
  };

  function saveUiPreference(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      setNotice({ kind: "error", text: "This setting is active, but your browser could not save it for your next visit." });
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setAuthBusy(true);
    setNotice(null);
    try {
      if (authMode === "signup") {
        if (!displayName.trim()) {
          setNotice({ kind: "error", text: "Please add the name you would like people to see." });
          return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { display_name: displayName.trim(), avatar_seed: avatarSeed, avatar_style: "lorelei" } },
        });
        if (error) throw error;
        if (data.session) {
          setSession(data.session);
          setNotice({ kind: "success", text: "Your account is ready. Welcome to Vartalaap." });
        } else {
          setNotice({ kind: "success", text: "Check your inbox to confirm your email, then sign in. Your avatar choice is saved and its image will upload after confirmation." });
          setAuthMode("signin");
        }
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        setSession(data.session);
        setNotice({ kind: "success", text: "Welcome back." });
      }
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "Authentication failed. Please try again." });
    } finally {
      setAuthBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setNotice({ kind: "error", text: `Could not sign out: ${error.message}` });
      return;
    }
    setSection("list");
    setNotice(null);
  }

  async function openConversation(person: Profile) {
    if (!supabase || !user) return;
    const { data, error } = await supabase.rpc("get_or_create_direct_conversation", { p_other_user_id: person.id });
    if (error) {
      setNotice({ kind: "error", text: `Could not start this conversation: ${error.message}` });
      return;
    }
    setActiveConversationId(data);
    setSection("chat");
    setSearchText("");
    setSearchResults([]);
    await loadConversations();
  }

  async function sendDirectMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = messageDraft.trim();
    if (!supabase || !user || !activeConversationId || !content || isSending) return;
    setIsSending(true);
    const { error } = await supabase.from("messages").insert({
      conversation_id: activeConversationId,
      sender_id: user.id,
      content,
    });
    setIsSending(false);
    if (error) {
      setNotice({ kind: "error", text: `Message could not be sent: ${error.message}` });
      return;
    }
    setMessageDraft("");
    void loadConversations();
  }

  async function deleteDirectMessage(message: DirectMessage) {
    if (!supabase || !user || deletingMessageId || !window.confirm("Delete this message for everyone in the conversation?")) return;
    setDeletingMessageId(message.id);
    const { data, error } = await supabase.from("messages")
      .delete()
      .eq("id", message.id)
      .eq("sender_id", user.id)
      .select("id")
      .single();
    setDeletingMessageId(null);
    if (error) {
      setNotice({ kind: "error", text: `Could not delete the message: ${error.message}` });
      return;
    }
    if (!data) {
      setNotice({ kind: "error", text: "The message was not found or you do not have permission to delete it." });
      return;
    }
    setMessages((existing) => existing.filter((item) => item.id !== data.id));
    setNotice({ kind: "success", text: "Message deleted for everyone in this conversation." });
    void loadConversations();
  }

  async function createPaperGamesSession(game: BoardGame) {
    if (!supabase || !user || !activeConversationId || creatingPaperGamesGame) return;
    setCreatingPaperGamesGame(game.gameType);
    try {
      const { data, error } = await supabase.functions.invoke<{ uid: string; playUrl: string }>("papergames-game-session", {
        body: { gameType: game.gameType, conversationId: activeConversationId },
      });
      if (error) throw error;
      const safeUrl = data && paperGamesPlayUrl(data.playUrl);
      if (!data || !safeUrl) throw new Error("PaperGames returned an invalid game link.");

      const url = safeUrl.toString();
      setPaperGamesUrl(url);
      setPaperGamesName(game.name);
      const { error: messageError } = await supabase.from("messages").insert({
        conversation_id: activeConversationId,
        sender_id: user.id,
        content: `🎮 ${game.name} invite: ${url}`,
      });
      if (messageError) {
        setNotice({ kind: "error", text: `The game was created, but its invite could not be sent in the DM: ${messageError.message}` });
        return;
      }
      void loadConversations();
    } catch (error) {
      let reason = error instanceof Error ? error.message : "Please try again.";
      if (error instanceof FunctionsHttpError) {
        try {
          const response = await error.context.clone().json() as { error?: unknown };
          if (typeof response.error === "string" && response.error) reason = response.error;
        } catch (responseError) {
          console.error("Could not read the PaperGames function error response:", responseError);
          reason = `Game session service returned HTTP ${error.context.status}.`;
        }
      }
      setNotice({ kind: "error", text: `Could not create the PaperGames session: ${reason}` });
    } finally {
      setCreatingPaperGamesGame(null);
    }
  }

  function openPaperGamesInvite(url: string, gameName: string) {
    const safeUrl = paperGamesPlayUrl(url);
    if (!safeUrl) {
      setNotice({ kind: "error", text: "This PaperGames invite link is invalid." });
      return;
    }
    setPaperGamesUrl(safeUrl.toString());
    setPaperGamesName(gameName);
    setBoardGamePickerOpen(true);
  }

  function onDirectMessageKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendDirectMessage();
    }
  }

  async function loadAiHistory() {
    if (!supabase || !user) return;
    const [{ data: history, error: historyError }, { data: memories, error: memoriesError }] = await Promise.all([
      supabase.from("ai_messages").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
      supabase.from("ai_memories").select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
    ]);
    if (historyError || memoriesError) {
      setNotice({ kind: "error", text: `Could not refresh companion data: ${(historyError ?? memoriesError)?.message}` });
      return;
    }
    setAiMessages([...(history ?? [])].reverse());
    setAiMemories(memories ?? []);
  }

  async function sendAiMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = aiDraft.trim();
    if (!supabase || !content || aiSending) return;
    const client = supabase;
    setAiSending(true);
    setAiDraft("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const invokeCompanion = () => client.functions.invoke<{ reply: string }>("ai-companion", {
        body: { message: content },
        signal: controller.signal,
      });
      let result = await invokeCompanion();
      if (result.error instanceof FunctionsHttpError && result.error.context.status === 401) {
        const { data: refreshed, error: refreshError } = await client.auth.refreshSession();
        if (refreshError || !refreshed.session) {
          await client.auth.signOut({ scope: "local" });
          setAiDraft(content);
          setNotice({ kind: "error", text: "Your sign-in expired. Please sign in again to talk with your companion." });
          return;
        }
        result = await invokeCompanion();
      }
      const { data, error } = result;
      if (error) {
        setAiDraft(content);
        let reason = error.message;
        if (error instanceof FunctionsHttpError) {
          try {
            const response = await error.context.json() as { error?: unknown };
            if (typeof response.error === "string" && response.error) reason = response.error;
          } catch (responseError) {
            console.error("Could not read the AI function error response:", responseError);
          }
        }
        setNotice({ kind: "error", text: `Your companion could not reply: ${reason}` });
      } else if (!data?.reply) {
        setAiDraft(content);
        setNotice({ kind: "error", text: "Your companion returned an empty reply. Please try again." });
      } else {
        setNotice(null);
      }
    } catch (error) {
      setAiDraft(content);
      const reason = controller.signal.aborted
        ? "The request timed out. Please try again; if it keeps happening, check the Gemini API project and model access."
        : error instanceof Error ? error.message : "The request could not reach the AI service.";
      console.error("AI companion request could not be completed:", error);
      setNotice({ kind: "error", text: `Your companion could not reply: ${reason}` });
    } finally {
      window.clearTimeout(timeout);
      setAiSending(false);
    }
    await loadAiHistory();
  }

  async function saveAiSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user || !aiProfile) return;
    setSavingAiSettings(true);
    const { error } = await supabase.from("ai_profiles").upsert({
      ...aiProfile,
      user_id: user.id,
      updated_at: new Date().toISOString(),
    });
    setSavingAiSettings(false);
    if (error) {
      setNotice({ kind: "error", text: `Companion settings were not saved: ${error.message}` });
      return;
    }
    setNotice({ kind: "success", text: "Companion settings saved." });
  }

  async function addMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !user || !memoryDraft.trim()) return;
    if (/\b(password|passcode|secret|api[\s_-]?key|credential|token)\b/i.test(memoryDraft)) {
      setNotice({ kind: "error", text: "Memories cannot contain passwords, API keys, or other credentials." });
      return;
    }
    const { error } = await supabase.from("ai_memories").insert({
      user_id: user.id,
      content: memoryDraft.trim(),
      category: "personal",
    });
    if (error) {
      setNotice({ kind: "error", text: `Memory could not be saved: ${error.message}` });
      return;
    }
    setMemoryDraft("");
    await loadAiHistory();
    setNotice({ kind: "success", text: "Memory saved for your companion." });
  }

  async function removeMemory(memoryId: string) {
    if (!supabase || !user) return;
    const { error } = await supabase.from("ai_memories").delete().eq("id", memoryId).eq("user_id", user.id);
    if (error) {
      setNotice({ kind: "error", text: `Memory could not be removed: ${error.message}` });
      return;
    }
    setAiMemories((current) => current.filter((memory) => memory.id !== memoryId));
  }

  if (!isSupabaseConfigured || !supabase) return <SetupScreen />;
  if (!authReady) return <div className="boot-screen"><LoaderCircle className="spin" size={22} /> Opening Vartalaap…</div>;
  if (!user) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        displayName={displayName}
        setDisplayName={setDisplayName}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        avatarSeed={avatarSeed}
        setAvatarSeed={setAvatarSeed}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        busy={authBusy}
        notice={notice}
        onSubmit={handleAuth}
        onClearNotice={() => setNotice(null)}
      />
    );
  }

  return (
    <div
      className={`app-shell ${section !== "list" ? "mobile-in-section" : ""}`}
      data-palette={palette}
      style={{
        transform: `scale(${Number(uiZoom) / 100})`,
        transformOrigin: "top left",
        width: `${10000 / Number(uiZoom)}%`,
        height: `${10000 / Number(uiZoom)}dvh`,
      }}
    >
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-seal"><MessageCircle size={20} strokeWidth={1.8} /></div>
          <div><div className="brand-name">vartalaap</div><div className="brand-note">a thoughtful place to talk</div></div>
          <span className="brand-rule" />
        </div>

        <label className="people-search">
          <Search size={16} />
          <input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Find someone…" aria-label="Search people by name or email" />
          {searchText && <button className="icon-button search-clear" onClick={() => setSearchText("")} aria-label="Clear search"><X size={15} /></button>}
        </label>

        <div className="sidebar-list-heading">
          <span>{searchText.trim().length >= 2 ? "PEOPLE" : "YOUR CONVERSATIONS"}</span>
          <span className="heading-rule" />
          {searchText.trim().length < 2 && <span className="conversation-count">{conversations.length.toString().padStart(2, "0")}</span>}
        </div>

        <div className="conversation-list">
          {searchText.trim().length >= 2 ? (
            searching ? <div className="list-hint"><LoaderCircle size={16} className="spin" /> Looking around…</div> :
              searchResults.length ? searchResults.map((person) => (
                <button className="person-result" key={person.id} onClick={() => void openConversation(person)}>
                  <Avatar profile={person} />
                  <span className="person-result-copy"><strong>{person.display_name}</strong><small>{person.email}</small></span>
                  <ChevronRight size={16} />
                </button>
              )) : <div className="list-hint">No people found. Try a name or email address.</div>
          ) : conversations.length ? conversations.map(({ conversation, other, lastMessage }) => (
            <button
              className={`conversation-row ${activeConversationId === conversation.id && section === "chat" ? "selected" : ""}`}
              key={conversation.id}
              onClick={() => { setActiveConversationId(conversation.id); setSection("chat"); }}
            >
              <Avatar profile={other} />
              <span className="conversation-copy">
                <span className="conversation-topline"><strong>{other.display_name}</strong><time>{lastMessage ? formatTime(lastMessage.created_at) : ""}</time></span>
                <span className="conversation-snippet">{lastMessage ? `${lastMessage.sender_id === user.id ? "You: " : ""}${lastMessage.content}` : "Your conversation starts here"}</span>
              </span>
            </button>
          )) : (
            <div className="empty-sidebar">
              <div className="empty-stamp"><MessagesSquare size={20} /></div>
              <strong>Your table is quiet.</strong>
              <span>Search for someone to begin a conversation.</span>
            </div>
          )}
        </div>

        <div className="sidebar-lower">
          <button className={`mandali-launch ${section === "mandali" ? "active" : ""}`} onClick={() => setSection("mandali")}>
            <span className="mandali-launch-icon"><UsersRound size={16} /></span>
            <span><strong>Mandali</strong><small>Gather with your people</small></span>
            <ChevronRight size={16} className="ai-chevron" />
          </button>
          <button className={`ai-launch ${section === "ai" ? "active" : ""}`} onClick={() => setSection("ai")}>
            <span className="ai-orb"><Sparkles size={17} /></span>
            <span><strong>My AI companion</strong><small>A little space just for you</small></span>
            <ChevronRight size={16} className="ai-chevron" />
          </button>
          <div className="account-card" ref={accountSettingsRef}>
            <button
              className="account-avatar-button"
              onClick={() => setSettingsOpen((open) => !open)}
              aria-label="Open appearance settings"
              aria-expanded={settingsOpen}
              aria-controls="appearance-settings"
              title="Appearance settings"
            >
              <Avatar profile={signedInAvatar} size="small" />
            </button>
            <span className="account-copy"><strong>{signedInName}</strong><small>Your private account</small></span>
            <button className="icon-button logout-button" onClick={() => void signOut()} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>
            {settingsOpen && (
              <section className="appearance-menu" id="appearance-settings" aria-label="Appearance settings">
                <div className="appearance-menu-heading"><Settings2 size={15} /><strong>Appearance</strong></div>
                <div className="appearance-setting">
                  <span className="appearance-setting-title"><Palette size={14} /> Color palette</span>
                  <div className="palette-options" role="group" aria-label="Color palette">
                    {palettes.map((option) => (
                      <button
                        key={option.id}
                        className={`palette-option ${palette === option.id ? "selected" : ""}`}
                        onClick={() => {
                          setPalette(option.id);
                          saveUiPreference("vartalaap-palette", option.id);
                        }}
                        aria-label={`${option.label} palette`}
                        aria-pressed={palette === option.id}
                        title={option.label}
                      >
                        <span className="palette-swatch" aria-hidden="true">
                          {option.colors.map((color) => <i key={color} style={{ backgroundColor: color }} />)}
                        </span>
                        <small>{option.label}</small>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="appearance-setting zoom-setting">
                  <span className="appearance-setting-title"><ZoomIn size={14} /> Interface size <strong>{uiZoom}%</strong></span>
                  <input
                    type="range"
                    min="80"
                    max="120"
                    step="10"
                    value={uiZoom}
                    onChange={(event) => {
                      setUiZoom(event.target.value);
                      saveUiPreference("vartalaap-zoom", event.target.value);
                    }}
                    aria-label="Interface zoom"
                  />
                  <span className="zoom-labels"><small>Smaller</small><small>Larger</small></span>
                </label>
              </section>
            )}
          </div>
        </div>
      </aside>

      <main className="workspace">
        {notice && <NoticeBanner notice={notice} onDismiss={() => setNotice(null)} />}
        {section === "mandali" ? (
          <MandaliSection client={supabase} user={user} onBack={() => setSection("list")} />
        ) : section === "chat" ? (
          <section className="chat-pane">
            {activeConversation ? (
              <>
                <header className="chat-header">
                  <button className="icon-button mobile-back" onClick={() => setSection("list")} aria-label="Back to conversations"><ArrowLeft size={19} /></button>
                  <Avatar profile={activeConversation.other} size="normal" />
                  <div className="chat-header-copy"><h1>{activeConversation.other.display_name}</h1><p>Private conversation</p></div>
                  <button className="icon-button board-game-trigger" onClick={() => {
                    setPaperGamesUrl(null);
                    setPaperGamesName(null);
                    setBoardGamePickerOpen(true);
                  }} aria-label={`Play a board game with ${activeConversation.other.display_name}`} title="Play a board game">
                    <Gamepad2 size={18} />
                  </button>
                  <div className="header-decoration"><span>V</span> VARTALAAP LETTERS</div>
                </header>
                <div className="messages-area">
                  {messages.length ? messages.map((message) => {
                    const mine = message.sender_id === user.id;
                    return (
                      <div className={`message-row ${mine ? "mine" : "theirs"}`} key={message.id}>
                        <article className={`message-bubble ${mine ? "bubble-mine" : "bubble-theirs"}`}>
                          <div className="message-byline">
                            <span>{mine ? "You" : activeConversation.other.display_name}</span>
                            <time>{formatTime(message.created_at)}</time>
                            {mine && <button className="message-delete-button" onClick={() => void deleteDirectMessage(message)} disabled={deletingMessageId === message.id} aria-label="Delete your message" title="Delete for everyone"><Trash2 size={13} /></button>}
                          </div>
                          <p>{renderMessageContent(message.content, openPaperGamesInvite)}</p>
                        </article>
                      </div>
                    );
                  }) : (
                    <div className="chat-empty">
                      <div className="empty-stamp large"><MessageCircle size={23} /></div>
                      <p className="eyebrow">A FRESH PAGE</p>
                      <h2>Every good conversation<br />begins somewhere.</h2>
                      <p>Send a note to {activeConversation.other.display_name} to get things started.</p>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
                <form className="composer" onSubmit={(event) => void sendDirectMessage(event)}>
                  <div className="composer-inner">
                    <textarea
                      value={messageDraft}
                      onChange={(event) => setMessageDraft(event.target.value)}
                      onKeyDown={onDirectMessageKeyDown}
                      placeholder="Write a message…"
                      rows={1}
                      maxLength={10000}
                      aria-label="Write a message"
                    />
                    <button className="send-button" type="submit" disabled={!messageDraft.trim() || isSending} aria-label="Send message">
                      {isSending ? <LoaderCircle size={18} className="spin" /> : <Send size={17} />}
                    </button>
                  </div>
                  <div className="composer-hint">ENTER TO SEND <span>·</span> SHIFT + ENTER FOR A NEW LINE</div>
                </form>
                {boardGamePickerOpen && <DirectBoardGamePicker
                  otherName={activeConversation.other.display_name}
                  username={profile?.display_name || String(user.user_metadata.display_name ?? "Vartalaap player")}
                  gameUrl={paperGamesUrl}
                  gameName={paperGamesName}
                  creatingGame={creatingPaperGamesGame}
                  onChoose={(game) => void createPaperGamesSession(game)}
                  onClose={() => setBoardGamePickerOpen(false)}
                />}
              </>
            ) : (
              <WelcomePane onFindPeople={() => document.querySelector<HTMLInputElement>(".people-search input")?.focus()} />
            )}
          </section>
        ) : section === "ai" ? (
          <section className={`ai-pane ${aiSettingsOpen ? "with-ai-settings" : ""}`}>
            <header className="chat-header ai-header">
              <button className="icon-button mobile-back" onClick={() => setSection("list")} aria-label="Back to conversations"><ArrowLeft size={19} /></button>
              <div className="ai-orb header-orb"><Sparkles size={19} /></div>
              <div className="chat-header-copy"><h1>{aiProfile?.companion_name || "Mitra"}</h1><p>Your private companion</p></div>
              <button className={`settings-toggle ${aiSettingsOpen ? "pressed" : ""}`} onClick={() => setAiSettingsOpen((open) => !open)}>
                <Settings2 size={16} /><span>Personalise</span>
              </button>
            </header>
            <div className="ai-content">
              <div className="ai-chat-column">
                <div className="messages-area ai-messages-area">
                  {aiMessages.length ? aiMessages.map((message) => (
                    <div className={`message-row ${message.role === "user" ? "mine" : "theirs"}`} key={message.id}>
                      {message.role === "assistant" && <div className="mini-ai-orb"><Sparkles size={13} /></div>}
                      <article className={`message-bubble ${message.role === "user" ? "bubble-mine" : "bubble-ai"}`}>
                        <div className="message-byline">{message.role === "user" ? "You" : aiProfile?.companion_name || "Mitra"}<time>{formatTime(message.created_at)}</time></div>
                        <p>{message.content}</p>
                      </article>
                    </div>
                  )) : (
                    <div className="chat-empty ai-empty">
                      <div className="empty-stamp large"><Sparkles size={22} /></div>
                      <p className="eyebrow">YOUR OWN LITTLE CORNER</p>
                      <h2>A familiar voice,<br />whenever you need one.</h2>
                      <p>Your chats and saved memories stay private to your account.</p>
                    </div>
                  )}
                  {aiSending && <div className="typing-indicator"><span /><span /><span /> {aiProfile?.companion_name || "Mitra"} is thinking</div>}
                  <div ref={bottomRef} />
                </div>
                <form className="composer" onSubmit={(event) => void sendAiMessage(event)}>
                  <div className="composer-inner">
                    <textarea
                      value={aiDraft}
                      onChange={(event) => setAiDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendAiMessage();
                        }
                      }}
                      placeholder={`Talk to ${aiProfile?.companion_name || "Mitra"}…`}
                      rows={1}
                      maxLength={10000}
                      aria-label="Message your AI companion"
                    />
                    <button className="send-button" type="submit" disabled={!aiDraft.trim() || aiSending} aria-label="Send message to AI">
                      {aiSending ? <LoaderCircle size={18} className="spin" /> : <Send size={17} />}
                    </button>
                  </div>
                  <div className="composer-hint">PRIVATE TO YOU <span>·</span> YOUR SAVED MEMORIES HELP {aiProfile?.companion_name?.toUpperCase() || "MITRA"} REMEMBER</div>
                </form>
              </div>
              {aiSettingsOpen && aiProfile && (
                <aside className="ai-settings-panel">
                  <div className="settings-title"><div><p className="eyebrow">MAKE IT YOURS</p><h2>Companion notes</h2></div><button className="icon-button" onClick={() => setAiSettingsOpen(false)} aria-label="Close settings"><X size={18} /></button></div>
                  <form className="settings-form" onSubmit={(event) => void saveAiSettings(event)}>
                    <label>Companion name<input value={aiProfile.companion_name} maxLength={60} onChange={(event) => setAiProfile({ ...aiProfile, companion_name: event.target.value })} required /></label>
                    <label>Personality & tone<textarea rows={3} maxLength={500} value={aiProfile.personality} onChange={(event) => setAiProfile({ ...aiProfile, personality: event.target.value })} /></label>
                    <label>How should they behave?<textarea rows={4} maxLength={4000} placeholder="Anything you'd like your companion to keep in mind…" value={aiProfile.instructions} onChange={(event) => setAiProfile({ ...aiProfile, instructions: event.target.value })} /></label>
                    <label>Your preferences & context<textarea rows={3} maxLength={2000} placeholder="Topics, interests, or ways you like to communicate…" value={aiProfile.preferences} onChange={(event) => setAiProfile({ ...aiProfile, preferences: event.target.value })} /></label>
                    <button className="vintage-button save-settings" type="submit" disabled={savingAiSettings}>
                      {savingAiSettings ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}
                      {savingAiSettings ? "Saving…" : "Save personalisation"}
                    </button>
                  </form>
                  <div className="memory-section">
                    <div className="memory-heading"><div><p className="eyebrow">KEPT CLOSE</p><h3>Saved memories <span>{aiMemories.length}</span></h3></div></div>
                    <p className="memory-caption">Your companion may save useful details from chats. You can always edit this collection.</p>
                    <form className="memory-form" onSubmit={(event) => void addMemory(event)}>
                      <input value={memoryDraft} onChange={(event) => setMemoryDraft(event.target.value)} maxLength={500} placeholder="Add a memory yourself…" aria-label="New memory" />
                      <button type="submit" disabled={!memoryDraft.trim()} aria-label="Save memory"><Plus size={17} /></button>
                    </form>
                    <div className="memory-list">
                      {aiMemories.length ? aiMemories.map((memory) => (
                        <div className="memory-item" key={memory.id}>
                          <span className="memory-pin" />
                          <p>{memory.content}</p>
                          <button className="icon-button" onClick={() => void removeMemory(memory.id)} title="Remove memory" aria-label={`Remove memory: ${memory.content}`}><Trash2 size={14} /></button>
                        </div>
                      )) : <div className="no-memories"><Clock3 size={15} /> Nothing saved just yet.</div>}
                    </div>
                  </div>
                </aside>
              )}
            </div>
          </section>
        ) : (
          <WelcomePane onFindPeople={() => document.querySelector<HTMLInputElement>(".people-search input")?.focus()} />
        )}
      </main>
    </div>
  );
}

function NoticeBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div className={`notice-banner notice-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
      <span>{notice.text}</span><button className="icon-button" onClick={onDismiss} aria-label="Dismiss message"><X size={15} /></button>
    </div>
  );
}

function WelcomePane({ onFindPeople }: { onFindPeople: () => void }) {
  return (
    <div className="welcome-pane">
      <div className="welcome-ornament"><span /><MessageCircle size={24} /><span /></div>
      <p className="eyebrow">A LITTLE MORE HUMAN</p>
      <h1>Make room<br />for a good talk.</h1>
      <p className="welcome-copy">Conversations feel better when there’s space to listen.<br className="desktop-break" /> Find someone, or spend a moment with your AI companion.</p>
      <button className="vintage-button welcome-button" onClick={onFindPeople}><Search size={16} /> Find someone to talk to</button>
      <div className="welcome-footnote"><span>✳</span> YOUR WORDS, YOUR PEOPLE, YOUR PLACE <span>✳</span></div>
    </div>
  );
}

function AuthScreen({
  mode, setMode, displayName, setDisplayName, email, setEmail, password, setPassword,
  avatarSeed, setAvatarSeed, showPassword, setShowPassword, busy, notice, onSubmit, onClearNotice,
}: {
  mode: "signin" | "signup";
  setMode: (mode: "signin" | "signup") => void;
  displayName: string;
  setDisplayName: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  avatarSeed: string;
  setAvatarSeed: (value: string) => void;
  showPassword: boolean;
  setShowPassword: (value: boolean) => void;
  busy: boolean;
  notice: Notice | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClearNotice: () => void;
}) {
  const signup = mode === "signup";
  return (
    <main className="auth-page">
      <div className="auth-card">
        <section className="auth-aside">
          <div className="brand-lockup auth-brand">
            <div className="brand-seal"><MessageCircle size={20} strokeWidth={1.8} /></div>
            <div><div className="brand-name">vartalaap</div><div className="brand-note">a thoughtful place to talk</div></div>
          </div>
          <div className="auth-illustration">
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="illustration-chat chat-left">a little hello</div>
            <div className="illustration-chat chat-right"><span /><span /><span /></div>
            <div className="illustration-center"><MessageCircle size={35} strokeWidth={1.4} /></div>
          </div>
          <div className="auth-aside-copy">
            <span className="eyebrow">A SMALL PAUSE IN A LOUD WORLD</span>
            <h1>Some things<br />are better shared.</h1>
            <p>Catch up with your people. Keep a little space for yourself, too.</p>
          </div>
          <div className="palette-note"><span /><span /><span /><span /> MADE WITH A LITTLE NOSTALGIA</div>
        </section>
        <section className="auth-form-side">
          <div className="auth-mobile-brand">
            <div className="brand-seal"><MessageCircle size={19} /></div><span className="brand-name">vartalaap</span>
          </div>
          <div className="auth-form-heading">
            <p className="eyebrow">{signup ? "COME ON IN" : "GOOD TO SEE YOU"}</p>
            <h2>{signup ? "Make yourself at home." : "Welcome back."}</h2>
            <p>{signup ? "Create your account and start a conversation." : "Sign in to pick up where you left off."}</p>
          </div>
          {notice && <NoticeBanner notice={notice} onDismiss={onClearNotice} />}
          <form className="auth-form" onSubmit={onSubmit}>
            {signup && (
              <>
                <label className="field-label">Display name
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="How should we call you?" autoComplete="name" maxLength={80} required />
                </label>
                <div className="avatar-picker">
                  <img src={avatarUrl(avatarSeed)} alt="Your randomly generated Lorelei avatar preview" />
                  <div><span className="picker-label">YOUR LITTLE PORTRAIT</span><p>A Lorelei illustration, saved with your account.</p></div>
                  <button className="vintage-button randomize-button" type="button" onClick={() => setAvatarSeed(randomAvatarSeed())}><Shuffle size={14} /> Randomize</button>
                </div>
              </>
            )}
            <label className="field-label">Email address
              <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" placeholder="you@example.com" autoComplete="email" required />
            </label>
            <label className="field-label">Password
              <span className="password-field">
                <input value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? "text" : "password"} placeholder={signup ? "At least 6 characters" : "Your password"} autoComplete={signup ? "new-password" : "current-password"} minLength={6} required />
                <button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </span>
            </label>
            <button className="vintage-button auth-submit" type="submit" disabled={busy}>
              {busy ? <LoaderCircle size={17} className="spin" /> : <>{signup ? "Create your account" : "Sign in"} <ChevronRight size={17} /></>}
            </button>
          </form>
          <p className="auth-switch">
            {signup ? "Already have a place here?" : "New to Vartalaap?"}{" "}
            <button onClick={() => setMode(signup ? "signin" : "signup")}>{signup ? "Sign in instead" : "Create an account"}</button>
          </p>
          <p className="auth-privacy">Your conversations are private to the people in them.</p>
        </section>
      </div>
    </main>
  );
}

function SetupScreen() {
  return (
    <main className="setup-page">
      <div className="setup-card">
        <div className="brand-seal"><MessageCircle size={22} /></div>
        <p className="eyebrow">ONE LAST THING</p>
        <h1>Set the table.</h1>
        <p>Vartalaap needs a Supabase project for real sign-in, saved conversations, and private companion memories. Add your public project values to the local environment to continue.</p>
        <div className="setup-code"><code>VITE_SUPABASE_URL</code><code>VITE_SUPABASE_ANON_KEY</code></div>
        <p className="setup-footnote">Copy <strong>.env.example</strong> to <strong>.env.local</strong>, fill in the values from your Supabase project, then restart the development server. Never put a service-role key here.</p>
      </div>
    </main>
  );
}

export default App;

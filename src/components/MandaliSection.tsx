import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  ArrowLeft, Check, Compass, Copy, Gamepad2, Hash, LoaderCircle, LogOut,
  Plus, Send, Settings2, Shield, Trash2, UsersRound, Volume2, X,
} from "lucide-react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database, Mandali, MandaliMember, MandaliMessage, Profile } from "../lib/database.types";
import { MandaliGames } from "./MandaliGames";
import { MandaliVoiceChannel } from "./MandaliVoiceChannel";
import { avatarUrl } from "../lib/avatar";
import { supabase } from "../lib/supabase";

type Channel = "general" | "voice" | "games";
type StatusMessage = { kind: "success" | "error"; text: string };
type CommunityRow = Mandali & { role: MandaliMember["role"] };
type RosterMember = MandaliMember & { profile: Profile | null };

const icons = ["✦", "🌿", "☕", "🌙", "🌼", "🎨", "📚", "🎵"] as const;

function CommunityAvatar({ community }: { community: Pick<Mandali, "icon"> }) {
  return <span className="mandali-icon" aria-hidden="true">{community.icon}</span>;
}

function MemberAvatar({ profile }: { profile: Profile | null }) {
  if (!profile) return <span className="mandali-member-avatar mandali-avatar-fallback">?</span>;
  const image = profile.avatar_path && supabase
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl
    : avatarUrl(profile.avatar_seed, profile.avatar_style);
  return <img className="mandali-member-avatar" src={image} alt="" />;
}

export function MandaliSection({
  client,
  user,
  onBack,
}: {
  client: SupabaseClient<Database>;
  user: User;
  onBack: () => void;
}) {
  const [joined, setJoined] = useState<CommunityRow[]>([]);
  const [discoverable, setDiscoverable] = useState<Mandali[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [channel, setChannel] = useState<Channel>("general");
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [messages, setMessages] = useState<MandaliMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [savingCommunity, setSavingCommunity] = useState(false);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [mode, setMode] = useState<"joined" | "discover">("joined");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState<string>(icons[0]);
  const [visibility, setVisibility] = useState<"private" | "discoverable">("private");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [ownerTarget, setOwnerTarget] = useState("");
  const messageListRef = useRef<HTMLDivElement>(null);
  const active = joined.find((item) => item.id === activeId) ?? null;
  const preview = mode === "discover" ? discoverable.find((item) => item.id === activeId) ?? null : null;
  const profileById = useMemo(() => new Map(members.map((member) => [member.user_id, member.profile])), [members]);
  const isAdmin = active?.role === "owner" || active?.role === "admin";

  const loadCommunities = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    const { data: membershipRows, error: membershipError } = await client
      .from("mandali_members").select("*").eq("user_id", user.id).order("joined_at", { ascending: false });
    if (membershipError) {
      setStatus({ kind: "error", text: `Could not load your Mandalis: ${membershipError.message}` });
      setLoading(false);
      return;
    }

    const memberships = membershipRows ?? [];
    const ids = memberships.map((member) => member.mandali_id);
    let communities: Mandali[] = [];
    if (ids.length) {
      const { data, error } = await client.from("mandalis").select("*").in("id", ids).order("updated_at", { ascending: false });
      if (error) {
        setStatus({ kind: "error", text: `Could not load community details: ${error.message}` });
        setLoading(false);
        return;
      }
      communities = data ?? [];
    }
    const roleById = new Map(memberships.map((member) => [member.mandali_id, member.role]));
    const rows = communities.map((community) => ({ ...community, role: roleById.get(community.id) ?? "member" as const }));
    setJoined(rows);

    const { data: publicRows, error: publicError } = await client.from("mandalis")
      .select("*").eq("visibility", "discoverable").order("created_at", { ascending: false }).limit(50);
    if (publicError) {
      setStatus({ kind: "error", text: `Could not browse discoverable Mandalis: ${publicError.message}` });
      setLoading(false);
      return;
    }
    setDiscoverable((publicRows ?? []).filter((community) => !ids.includes(community.id)));
    setActiveId((current) => {
      const desired = preferredId ?? current;
      return desired && rows.some((row) => row.id === desired) ? desired : rows[0]?.id ?? null;
    });
    setLoading(false);
  }, [client, user.id]);

  useEffect(() => {
    void loadCommunities();
  }, [loadCommunities]);

  useEffect(() => {
    if (active) setIcon(active.icon);
  }, [active?.id, active?.icon]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const inviteCode = params.get("mandali");
    if (!inviteCode) return;
    params.delete("mandali");
    const remaining = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${remaining ? `?${remaining}` : ""}${window.location.hash}`);
    let cancelled = false;
    void client.rpc("join_mandali_by_invite", { p_code: inviteCode }).then(async ({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setStatus({ kind: "error", text: `Could not join from this invite: ${error.message}` });
        return;
      }
      setStatus({ kind: "success", text: "You joined the Mandali." });
      await loadCommunities(data);
    });
    return () => { cancelled = true; };
  }, [client, loadCommunities]);

  useEffect(() => {
    if (!activeId) {
      setMembers([]);
      setMessages([]);
      return;
    }
    let cancelled = false;
    const loadActive = async () => {
      const [{ data: roster, error: rosterError }, { data: history, error: historyError }] = await Promise.all([
        client.from("mandali_members").select("*").eq("mandali_id", activeId).order("joined_at", { ascending: true }),
        client.from("mandali_messages").select("*").eq("mandali_id", activeId)
          .order("created_at", { ascending: false }).limit(150),
      ]);
      if (cancelled) return;
      const failure = rosterError ?? historyError;
      if (failure) {
        setStatus({ kind: "error", text: `Could not open this Mandali: ${failure.message}` });
        return;
      }
      const rosterRows = roster ?? [];
      const userIds = rosterRows.map((member) => member.user_id);
      const { data: profiles, error: profilesError } = userIds.length
        ? await client.from("profiles").select("*").in("id", userIds)
        : { data: [], error: null };
      if (cancelled) return;
      if (profilesError) {
        setStatus({ kind: "error", text: `Could not load member profiles: ${profilesError.message}` });
        return;
      }
      const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
      setMembers(rosterRows.map((member) => ({ ...member, profile: byId.get(member.user_id) ?? null })));
      setMessages([...(history ?? [])].reverse());
    };
    void loadActive();
    const subscription = client.channel(`mandali-messages-${activeId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "mandali_messages",
        filter: `mandali_id=eq.${activeId}`,
      }, (payload) => {
        if (payload.eventType === "DELETE") {
          const removed = payload.old as Partial<MandaliMessage>;
          if (removed.id) setMessages((current) => current.filter((message) => message.id !== removed.id));
          return;
        }
        const incoming = payload.new as MandaliMessage;
        setMessages((current) => {
          const existingIndex = current.findIndex((message) => message.id === incoming.id);
          if (payload.eventType === "UPDATE") {
            return existingIndex < 0 ? current : current.map((message) => message.id === incoming.id ? incoming : message);
          }
          return existingIndex >= 0 ? current : [...current, incoming];
        });
      })
      .subscribe((state) => {
        if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
          setStatus({ kind: "error", text: "Live community updates are unavailable. Check that Mandali messages are enabled in Supabase Realtime." });
        }
      });
    return () => {
      cancelled = true;
      void client.removeChannel(subscription);
    };
  }, [activeId, client, user.id]);

  useEffect(() => {
    messageListRef.current?.scrollTo({ top: messageListRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function createCommunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingCommunity(true);
    const { data, error } = await client.rpc("create_mandali", {
      p_name: name.trim(),
      p_description: description.trim(),
      p_icon: icon,
      p_visibility: visibility,
    });
    setSavingCommunity(false);
    if (error) {
      setStatus({ kind: "error", text: `Could not create the Mandali: ${error.message}` });
      return;
    }
    setCreating(false);
    setName("");
    setDescription("");
    setVisibility("private");
    setStatus({ kind: "success", text: "Your Mandali is ready." });
    await loadCommunities(data);
  }

  async function joinCommunity(mandaliId: string) {
    const { error } = await client.rpc("join_mandali", { p_mandali_id: mandaliId });
    if (error) {
      setStatus({ kind: "error", text: `Could not join this Mandali: ${error.message}` });
      return;
    }
    setMode("joined");
    setStatus({ kind: "success", text: "You joined the Mandali." });
    await loadCommunities(mandaliId);
  }

  async function leaveCommunity() {
    if (!active) return;
    const { error } = await client.rpc("leave_mandali", { p_mandali_id: active.id });
    if (error) {
      setStatus({ kind: "error", text: `Could not leave this Mandali: ${error.message}` });
      return;
    }
    setSettingsOpen(false);
    setStatus({ kind: "success", text: `You left ${active.name}.` });
    await loadCommunities();
  }

  async function createInvite() {
    if (!active) return;
    const { data, error } = await client.rpc("create_mandali_invite", { p_mandali_id: active.id });
    if (error) {
      setStatus({ kind: "error", text: `Could not create an invite: ${error.message}` });
      return;
    }
    const link = `${window.location.origin}${window.location.pathname}?mandali=${encodeURIComponent(data)}`;
    try {
      await navigator.clipboard.writeText(link);
      setStatus({ kind: "success", text: "A private invite link was copied. It expires in 7 days." });
    } catch (error) {
      console.error("Could not copy the community invite link:", error);
      setStatus({ kind: "error", text: `Invite created. Copy this link: ${link}` });
    }
  }

  async function saveCommunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active) return;
    setSavingCommunity(true);
    const form = new FormData(event.currentTarget);
    const { error } = await client.rpc("update_mandali", {
      p_mandali_id: active.id,
      p_name: String(form.get("community-name") ?? "").trim(),
      p_description: String(form.get("community-description") ?? "").trim(),
      p_icon: String(form.get("community-icon") ?? active.icon),
      p_visibility: String(form.get("community-visibility") ?? active.visibility) as Mandali["visibility"],
    });
    setSavingCommunity(false);
    if (error) {
      setStatus({ kind: "error", text: `Community settings were not saved: ${error.message}` });
      return;
    }
    setStatus({ kind: "success", text: "Community settings saved." });
    await loadCommunities(active.id);
  }

  async function transferOwnership(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || !ownerTarget) return;
    const { error } = await client.rpc("transfer_mandali_ownership", {
      p_mandali_id: active.id,
      p_user_id: ownerTarget,
    });
    if (error) {
      setStatus({ kind: "error", text: `Ownership was not transferred: ${error.message}` });
      return;
    }
    setOwnerTarget("");
    setStatus({ kind: "success", text: "Community ownership transferred." });
    await loadCommunities(active.id);
  }

  async function deleteCommunity() {
    if (!active || !window.confirm(`Delete "${active.name}" and its messages for everyone? This cannot be undone.`)) return;
    const { error } = await client.rpc("delete_mandali", { p_mandali_id: active.id });
    if (error) {
      setStatus({ kind: "error", text: `Could not delete the Mandali: ${error.message}` });
      return;
    }
    setSettingsOpen(false);
    setStatus({ kind: "success", text: "Mandali deleted." });
    await loadCommunities();
  }

  async function removeMember(member: RosterMember) {
    if (!active || !member.profile || !window.confirm(`Remove ${member.profile.display_name} from ${active.name}?`)) return;
    const { error } = await client.rpc("remove_mandali_member", { p_mandali_id: active.id, p_user_id: member.user_id });
    if (error) {
      setStatus({ kind: "error", text: `Could not remove this member: ${error.message}` });
      return;
    }
    setStatus({ kind: "success", text: `${member.profile.display_name} was removed.` });
    const { data, error: rosterError } = await client.from("mandali_members").select("*")
      .eq("mandali_id", active.id).order("joined_at", { ascending: true });
    if (rosterError) {
      setStatus({ kind: "error", text: `Member removed, but the roster did not refresh: ${rosterError.message}` });
      return;
    }
    const ids = (data ?? []).map((item) => item.user_id);
    const { data: profiles, error: profileError } = ids.length
      ? await client.from("profiles").select("*").in("id", ids)
      : { data: [], error: null };
    if (profileError) {
      setStatus({ kind: "error", text: `Member removed, but profiles did not refresh: ${profileError.message}` });
      return;
    }
    const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    setMembers((data ?? []).map((item) => ({ ...item, profile: byId.get(item.user_id) ?? null })));
  }

  async function sendMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const content = draft.trim();
    if (!active || !content || sending) return;
    setSending(true);
    const { data, error } = await client.from("mandali_messages")
      .insert({ mandali_id: active.id, sender_id: user.id, content })
      .select("*").single();
    setSending(false);
    if (error) {
      setStatus({ kind: "error", text: `Message could not be sent: ${error.message}` });
      return;
    }
    setMessages((current) => current.some((message) => message.id === data.id) ? current : [...current, data]);
    setDraft("");
    setStatus(null);
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  async function editMessage(messageId: string) {
    const content = editDraft.trim();
    if (!content) return;
    const { data, error } = await client.from("mandali_messages")
      .update({ content, updated_at: new Date().toISOString() }).eq("id", messageId).select("*").single();
    if (error) {
      setStatus({ kind: "error", text: `Message edit failed: ${error.message}` });
      return;
    }
    setMessages((current) => current.map((message) => message.id === messageId ? data : message));
    setEditingId(null);
    setEditDraft("");
  }

  async function deleteMessage(messageId: string) {
    const { error } = await client.from("mandali_messages").delete().eq("id", messageId);
    if (error) {
      setStatus({ kind: "error", text: `Message could not be deleted: ${error.message}` });
      return;
    }
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }

  return (
    <section className={`mandali-layout ${active || preview ? "has-active" : ""}`} aria-label="Mandali communities">
      <aside className="mandali-navigation">
        <header className="mandali-nav-header">
          <button className="icon-button mandali-back" onClick={onBack} aria-label="Back to conversations"><ArrowLeft size={18} /></button>
          <div><p className="eyebrow">GATHER TOGETHER</p><h1>Mandali</h1></div>
          <button className="icon-button" onClick={() => setCreating(true)} aria-label="Create a Mandali" title="Create a Mandali"><Plus size={18} /></button>
        </header>
        <div className="mandali-mode-switch" role="group" aria-label="Community list">
          <button className={mode === "joined" ? "selected" : ""} onClick={() => setMode("joined")}><UsersRound size={14} /> Yours</button>
          <button className={mode === "discover" ? "selected" : ""} onClick={() => setMode("discover")}><Compass size={14} /> Discover</button>
        </div>
        <div className="mandali-list">
          {loading ? <div className="mandali-empty-inline"><LoaderCircle className="spin" size={16} /> Loading Mandalis…</div> : (
            mode === "joined" ? joined.length ? joined.map((community) => (
              <button key={community.id} className={`mandali-row ${community.id === activeId ? "selected" : ""}`} onClick={() => { setActiveId(community.id); setChannel("general"); }}>
                <CommunityAvatar community={community} />
                <span><strong>{community.name}</strong><small>{community.visibility === "private" ? "Private" : "Discoverable"}</small></span>
              </button>
            )) : <div className="mandali-empty-inline">No Mandalis yet. Create one or explore communities.</div> :
              discoverable.length ? discoverable.map((community) => (
                <button key={community.id} className={`mandali-row ${community.id === activeId ? "selected" : ""}`} onClick={() => setActiveId(community.id)}>
                  <CommunityAvatar community={community} />
                  <span><strong>{community.name}</strong><small>{community.description || "A place to gather"}</small></span>
                </button>
              )) : <div className="mandali-empty-inline">No discoverable Mandalis yet.</div>
          )}
        </div>
        <button className="mandali-create-button" onClick={() => setCreating(true)}><Plus size={15} /> Create a Mandali</button>
      </aside>

      <div className="mandali-center">
        {status && <div className={`mandali-status ${status.kind}`} role={status.kind === "error" ? "alert" : "status"}>
          <span>{status.text}</span><button className="icon-button" onClick={() => setStatus(null)} aria-label="Dismiss message"><X size={14} /></button>
        </div>}
        {!active && preview ? (
          <div className="mandali-preview">
            <CommunityAvatar community={preview} />
            <p className="eyebrow">DISCOVERABLE MANDALI</p>
            <h2>{preview.name}</h2>
            <p>{preview.description || "A place to gather and talk."}</p>
            <small>Created {new Date(preview.created_at).toLocaleDateString()}</small>
            <button className="vintage-button" onClick={() => void joinCommunity(preview.id)}><UsersRound size={14} /> Join community</button>
          </div>
        ) : !active ? (
          <div className="mandali-welcome">
            <div className="mandali-welcome-mark"><UsersRound size={24} /></div>
            <p className="eyebrow">A PLACE TO GATHER</p>
            <h2>Find your people.</h2>
            <p>Create a Mandali for your circle, or discover a community to join.</p>
            <button className="vintage-button" onClick={() => setCreating(true)}><Plus size={16} /> Create a Mandali</button>
          </div>
        ) : (
          <>
            <header className="mandali-channel-header">
              <button className="icon-button mandali-inner-back" onClick={() => setActiveId(null)} aria-label="Back to Mandalis"><ArrowLeft size={18} /></button>
              <div className="mandali-channel-identity"><CommunityAvatar community={active} /><span><strong>{active.name}</strong><small>{active.description || "A place to gather and talk"}</small></span></div>
              <div className="mandali-header-actions">
                {isAdmin && <button className="icon-button" onClick={() => void createInvite()} aria-label="Copy invite link" title="Copy invite link"><Copy size={16} /></button>}
                {isAdmin && <button className={`icon-button ${settingsOpen ? "pressed" : ""}`} onClick={() => setSettingsOpen((open) => !open)} aria-label="Community settings" title="Community settings"><Settings2 size={17} /></button>}
              </div>
            </header>
            <nav className="mandali-channel-tabs" aria-label="Mandali channels">
              <button className={channel === "general" ? "selected" : ""} onClick={() => setChannel("general")}><Hash size={15} /> General</button>
              <button className={channel === "voice" ? "selected" : ""} onClick={() => setChannel("voice")}><Volume2 size={15} /> Voice Chat</button>
              <button className={channel === "games" ? "selected" : ""} onClick={() => setChannel("games")}><Gamepad2 size={15} /> Krida</button>
            </nav>
            {settingsOpen && isAdmin && <div className="mandali-settings">
              <div className="mandali-settings-heading"><div><p className="eyebrow">COMMUNITY SETTINGS</p><strong>Make it yours</strong></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={16} /></button></div>
              <form className="mandali-settings-form" onSubmit={(event) => void saveCommunity(event)}>
                <label>Name<input name="community-name" defaultValue={active.name} maxLength={80} required minLength={2} /></label>
                <label>Description<textarea name="community-description" defaultValue={active.description} maxLength={500} rows={2} /></label>
                <label>Visibility<select name="community-visibility" defaultValue={active.visibility}><option value="private">Private - invite link only</option><option value="discoverable">Discoverable - anyone can join</option></select></label>
                <label>Community icon<div className="mandali-icon-picker">{icons.map((choice) => <button key={choice} type="button" className={active.icon === choice ? "selected" : ""} onClick={() => {
                  setIcon(choice);
                }} aria-label={`Use ${choice} icon`}>{choice}</button>)}</div><input type="hidden" name="community-icon" value={icon} readOnly /></label>
                <button className="vintage-button" type="submit" disabled={savingCommunity}>{savingCommunity ? "Saving…" : "Save community"}</button>
              </form>
              {active.role === "owner" && <>
                <form className="mandali-transfer-form" onSubmit={(event) => void transferOwnership(event)}>
                  <label>Transfer ownership<select value={ownerTarget} onChange={(event) => setOwnerTarget(event.target.value)} required>
                    <option value="">Choose a member</option>
                    {members.filter((member) => member.user_id !== user.id).map((member) => <option key={member.user_id} value={member.user_id}>{member.profile?.display_name ?? "Member"}</option>)}
                  </select></label>
                  <button type="submit" disabled={!ownerTarget}>Transfer</button>
                </form>
                <button className="mandali-danger-button" onClick={() => void deleteCommunity()}><Trash2 size={14} /> Delete Mandali</button>
              </>}
              {active.role !== "owner" && <button className="mandali-danger-button" onClick={() => void leaveCommunity()}><LogOut size={14} /> Leave Mandali</button>}
            </div>}
            {channel === "general" ? (
              <div className="mandali-general">
                <div className="mandali-messages" ref={messageListRef}>
                  {messages.length ? messages.map((message) => {
                    const author = profileById.get(message.sender_id) ?? null;
                    const mine = message.sender_id === user.id;
                    const canModerate = isAdmin;
                    return <article className="mandali-message" key={message.id}>
                      <MemberAvatar profile={author} />
                      <div className="mandali-message-content">
                        <div className="mandali-message-byline"><strong>{mine ? "You" : author?.display_name ?? "Member"}</strong>{active.role === "owner" && author?.id === active.owner_id && <span className="mandali-owner-badge">OWNER</span>}<time>{new Date(message.created_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}{message.updated_at !== message.created_at ? " (edited)" : ""}</time></div>
                        {editingId === message.id ? <form className="mandali-edit-form" onSubmit={(event) => { event.preventDefault(); void editMessage(message.id); }}>
                          <textarea value={editDraft} onChange={(event) => setEditDraft(event.target.value)} maxLength={10000} autoFocus />
                          <button type="submit" className="icon-button" aria-label="Save edit"><Check size={15} /></button>
                          <button type="button" className="icon-button" onClick={() => setEditingId(null)} aria-label="Cancel edit"><X size={15} /></button>
                        </form> : <p>{message.content}</p>}
                      </div>
                      {(mine || canModerate) && editingId !== message.id && <div className="mandali-message-actions">
                        {mine && <button className="icon-button" onClick={() => { setEditingId(message.id); setEditDraft(message.content); }} aria-label="Edit your message" title="Edit"><Settings2 size={13} /></button>}
                        <button className="icon-button" onClick={() => void deleteMessage(message.id)} aria-label="Delete message" title="Delete"><Trash2 size={13} /></button>
                      </div>}
                    </article>;
                  }) : <div className="mandali-general-empty"><Hash size={24} /><p className="eyebrow">WELCOME TO #{active.name.toUpperCase()}</p><h2>The conversation starts here.</h2><p>Send the first message to your Mandali.</p></div>}
                </div>
                <form className="mandali-composer" onSubmit={(event) => void sendMessage(event)}>
                  <div className="mandali-composer-box"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={onComposerKeyDown} maxLength={10000} rows={1} placeholder={`Message #general in ${active.name}`} aria-label={`Message ${active.name} General channel`} /><button className="send-button" type="submit" disabled={!draft.trim() || sending} aria-label="Send community message">{sending ? <LoaderCircle size={17} className="spin" /> : <Send size={16} />}</button></div>
                  <small>ENTER TO SEND <span>·</span> SHIFT + ENTER FOR A NEW LINE</small>
                </form>
              </div>
            ) : channel === "voice" ? (
              <MandaliVoiceChannel client={client} user={user} mandaliId={active.id} mandaliName={active.name} />
            ) : (
              <MandaliGames client={client} user={user} mandaliId={active.id} members={members} />
            )}
          </>
        )}
      </div>

      <aside className="mandali-members-panel">
        {active ? <>
          <div className="mandali-members-heading"><UsersRound size={15} /><strong>Members</strong><span>{members.length}</span></div>
          <p className="mandali-member-group-label">HERE TOGETHER</p>
          <div className="mandali-member-list">
            {members.map((member) => <div className="mandali-member-row" key={member.user_id}>
              <MemberAvatar profile={member.profile} />
              <span><strong>{member.profile?.display_name ?? "Member"}</strong><small>{member.role === "owner" ? "Owner" : member.role === "admin" ? "Admin" : "Member"}</small></span>
              {(active.role === "owner" || (active.role === "admin" && member.role === "member")) && member.user_id !== user.id &&
                <button className="icon-button mandali-remove-member" onClick={() => void removeMember(member)} aria-label={`Remove ${member.profile?.display_name ?? "member"}`} title="Remove member"><X size={14} /></button>}
            </div>)}
          </div>
          <div className="mandali-community-card"><Shield size={14} /><span>{active.visibility === "private" ? "Private community" : "Discoverable community"}<small>Created {new Date(active.created_at).toLocaleDateString()}</small></span></div>
            </> : <div className="mandali-members-empty"><UsersRound size={18} /><p>Choose a Mandali to see its members.</p></div>}
      </aside>

      {creating && <div className="mandali-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
        <form className="mandali-create-modal" onSubmit={(event) => void createCommunity(event)}>
          <header><div><p className="eyebrow">A NEW CIRCLE</p><h2>Create a Mandali</h2></div><button type="button" className="icon-button" onClick={() => setCreating(false)} aria-label="Close"><X size={17} /></button></header>
          <label>Community name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={80} placeholder="What shall we call it?" /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} placeholder="Tell people what brings this circle together" /></label>
          <fieldset><legend>Choose an icon</legend><div className="mandali-icon-picker">{icons.map((choice) => <button type="button" key={choice} className={icon === choice ? "selected" : ""} onClick={() => setIcon(choice)} aria-label={`Use ${choice} icon`}>{choice}</button>)}</div></fieldset>
          <label>Who can join?<select value={visibility} onChange={(event) => setVisibility(event.target.value as "private" | "discoverable")}><option value="private">Private - invite link only</option><option value="discoverable">Discoverable - anyone can join</option></select></label>
          <p className="mandali-modal-note"><Shield size={14} /> You will be the owner and can manage the community.</p>
          <button className="vintage-button mandali-modal-submit" type="submit" disabled={savingCommunity}>{savingCommunity ? <><LoaderCircle size={15} className="spin" /> Creating…</> : <><Plus size={15} /> Create Mandali</>}</button>
        </form>
      </div>}
    </section>
  );
}

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, MicOff, PhoneOff, Volume2 } from "lucide-react";
import type { RemoteAudioTrack, Room, Track } from "livekit-client";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

type VoiceTokenResponse = { url: string; token: string };
type VoiceParticipant = {
  identity: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  audioTrack?: RemoteAudioTrack;
};

function RemoteAudio({ track }: { track: RemoteAudioTrack }) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const element = audioRef.current;
    if (!element) return;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [track]);

  return <audio ref={audioRef} autoPlay playsInline aria-hidden="true" />;
}

export function MandaliVoiceChannel({
  client,
  user,
  mandaliId,
  mandaliName,
}: {
  client: SupabaseClient<Database>;
  user: User;
  mandaliId: string;
  mandaliName: string;
}) {
  const roomRef = useRef<Room | null>(null);
  const joinAttemptRef = useRef(0);
  const microphoneSourceRef = useRef<Track.Source | null>(null);
  const [participants, setParticipants] = useState<VoiceParticipant[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => {
    joinAttemptRef.current += 1;
    const room = roomRef.current;
    roomRef.current = null;
    if (room) void room.disconnect();
  }, []);

  function refreshParticipants(room: Room, microphoneSource: Track.Source) {
    setParticipants([room.localParticipant, ...room.remoteParticipants.values()].map((participant) => {
      const microphone = participant.getTrackPublication(microphoneSource);
      return {
        identity: participant.identity,
        name: participant.name || "Member",
        isSpeaking: participant.isSpeaking,
        isMuted: microphone?.isMuted ?? true,
        audioTrack: participant === room.localParticipant
          ? undefined
          : microphone?.track as RemoteAudioTrack | undefined,
      };
    }));
  }

  async function joinVoice() {
    if (busy || connected) return;
    const attempt = ++joinAttemptRef.current;
    setBusy(true);
    setError(null);
    let data: VoiceTokenResponse | null = null;
    let tokenError: Error | null = null;
    try {
      const result = await client.functions.invoke<VoiceTokenResponse>(
        "mandali-voice-token",
        { body: { mandaliId } },
      );
      data = result.data;
      tokenError = result.error;
    } catch (requestError) {
      if (attempt === joinAttemptRef.current) {
        setError(`Could not request a voice token: ${requestError instanceof Error ? requestError.message : "The request failed."}`);
        setBusy(false);
      }
      return;
    }
    if (attempt !== joinAttemptRef.current) return;
    if (tokenError) {
      setError(`Could not request a voice token: ${tokenError.message}. Refresh and try again. If it persists, check the Edge Function logs.`);
      setBusy(false);
      return;
    }
    if (!data?.url || !data.token) {
      setError("The voice service returned an incomplete connection token.");
      setBusy(false);
      return;
    }

    let room: Room | null = null;
    try {
      const { Room: LiveKitRoom, RoomEvent, Track } = await import("livekit-client");
      microphoneSourceRef.current = Track.Source.Microphone;
      const newRoom = new LiveKitRoom({ adaptiveStream: true, dynacast: true });
      room = newRoom;
      roomRef.current = newRoom;
      const update = () => refreshParticipants(newRoom, Track.Source.Microphone);
      newRoom
        .on(RoomEvent.ParticipantConnected, update)
        .on(RoomEvent.ParticipantDisconnected, update)
        .on(RoomEvent.TrackSubscribed, update)
        .on(RoomEvent.TrackUnsubscribed, update)
        .on(RoomEvent.TrackMuted, update)
        .on(RoomEvent.TrackUnmuted, update)
        .on(RoomEvent.LocalTrackPublished, update)
        .on(RoomEvent.LocalTrackUnpublished, update)
        .on(RoomEvent.ActiveSpeakersChanged, update)
        .on(RoomEvent.Disconnected, () => {
          if (roomRef.current === newRoom) {
            roomRef.current = null;
            setConnected(false);
            setParticipants([]);
          }
        });

      await newRoom.connect(data.url, data.token);
      if (attempt !== joinAttemptRef.current || roomRef.current !== newRoom) return;
      setConnected(true);
      refreshParticipants(newRoom, Track.Source.Microphone);
      try {
        await newRoom.localParticipant.setMicrophoneEnabled(true);
        refreshParticipants(newRoom, Track.Source.Microphone);
      } catch {
        setError("You joined voice chat, but microphone access was denied. Allow microphone access in your browser, then try the microphone button.");
      }
    } catch (joinError) {
      if (room && roomRef.current === room) roomRef.current = null;
      if (room) await room.disconnect();
      if (attempt !== joinAttemptRef.current) return;
      setError(`Could not connect to voice chat: ${joinError instanceof Error ? joinError.message : "The connection failed."}`);
      setParticipants([]);
      setConnected(false);
    } finally {
      if (attempt === joinAttemptRef.current) setBusy(false);
    }
  }

  async function toggleMicrophone() {
    const room = roomRef.current;
    if (!room || busy) return;
    setBusy(true);
    setError(null);
    try {
      await room.localParticipant.setMicrophoneEnabled(!room.localParticipant.isMicrophoneEnabled);
      const microphoneSource = microphoneSourceRef.current;
      if (!microphoneSource) throw new Error("Microphone source is unavailable.");
      refreshParticipants(room, microphoneSource);
    } catch (toggleError) {
      setError(`Could not change microphone state: ${toggleError instanceof Error ? toggleError.message : "Check browser microphone permissions."}`);
    } finally {
      setBusy(false);
    }
  }

  async function leaveVoice() {
    joinAttemptRef.current += 1;
    const room = roomRef.current;
    roomRef.current = null;
    setConnected(false);
    setParticipants([]);
    setError(null);
    if (room) await room.disconnect();
  }

  const displayName = typeof user.user_metadata.display_name === "string"
    ? user.user_metadata.display_name
    : "You";
  const localParticipant = roomRef.current?.localParticipant;
  const microphoneEnabled = localParticipant?.isMicrophoneEnabled ?? false;

  return (
    <div className="mandali-voice-channel">
      <div className="mandali-voice-mark"><Volume2 size={24} /></div>
      <p className="eyebrow">VOICE CHAT</p>
      <h2>{connected ? `Together in ${mandaliName}` : "Make room for a voice."}</h2>
      <p className="mandali-voice-description">
        {connected
          ? `${participants.length} ${participants.length === 1 ? "person" : "people"} in this voice room.`
          : "Join your Mandali for a live voice conversation. Your microphone is only requested when you join."}
      </p>

      {error && <div className="mandali-voice-error" role="alert">{error}</div>}

      {connected && (
        <div className="mandali-voice-participants" aria-label="People in voice chat">
          {participants.map((participant) => {
            return (
              <div className="mandali-voice-participant" key={participant.identity}>
                <span className={`mandali-voice-speaking ${participant.isSpeaking ? "speaking" : ""}`} />
                <span>{participant.identity === user.id ? displayName : participant.name}{participant.identity === user.id ? " (you)" : ""}</span>
                {participant.isMuted ? <MicOff size={14} aria-label="Microphone muted" /> : <Mic size={14} aria-label="Microphone on" />}
                {participant.audioTrack && <RemoteAudio track={participant.audioTrack} />}
              </div>
            );
          })}
        </div>
      )}

      <div className="mandali-voice-controls">
        {!connected ? (
          <button className="vintage-button" onClick={() => void joinVoice()} disabled={busy}>
            {busy ? <><LoaderCircle size={15} className="spin" /> Connecting…</> : <><Mic size={15} /> Join voice</>}
          </button>
        ) : (
          <>
            <button className="mandali-voice-mic" onClick={() => void toggleMicrophone()} disabled={busy} aria-pressed={microphoneEnabled}>
              {busy ? <LoaderCircle size={15} className="spin" /> : microphoneEnabled ? <Mic size={15} /> : <MicOff size={15} />}
              {microphoneEnabled ? "Mute microphone" : "Enable microphone"}
            </button>
            <button className="mandali-voice-leave" onClick={() => void leaveVoice()} disabled={busy}>
              <PhoneOff size={15} /> Leave voice
            </button>
          </>
        )}
      </div>
      <div className="mandali-voice-note"><Mic size={14} /> Your browser will ask for microphone permission when you join.</div>
    </div>
  );
}

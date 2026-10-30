import { useCallback, useEffect, useMemo, useState } from "react";
import { Gamepad2, LoaderCircle, Plus, RotateCw, Trophy, UsersRound } from "lucide-react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database, MandaliGame, Profile } from "../lib/database.types";

type GameRow = Pick<MandaliGame, "id" | "mandali_id" | "created_by" | "player_x" | "player_o" | "board" | "status" | "next_turn" | "winner_id" | "created_at" | "updated_at">;

export function MandaliGames({
  client,
  user,
  mandaliId,
  members,
}: {
  client: SupabaseClient<Database>;
  user: User;
  mandaliId: string;
  members: Array<{ user_id: string; profile: Profile | null }>;
}) {
  const [games, setGames] = useState<GameRow[]>([]);
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = useMemo(() => new Map(members.map(({ user_id, profile }) => [user_id, profile?.display_name ?? "Member"])), [members]);
  const activeGame = games.find((game) => game.id === activeGameId) ?? null;

  const loadGames = useCallback(async () => {
    const { data, error: loadError } = await client.from("mandali_games")
      .select("*")
      .eq("mandali_id", mandaliId)
      .order("updated_at", { ascending: false })
      .limit(30);
    if (loadError) {
      setError(`Could not load Krida games: ${loadError.message}`);
      setLoading(false);
      return;
    }
    const rows = data ?? [];
    setGames(rows);
    setActiveGameId((current) => current && rows.some((game) => game.id === current) ? current : null);
    setLoading(false);
  }, [client, mandaliId]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void loadGames();
    const channel = client.channel(`mandali-games-${mandaliId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "mandali_games",
        filter: `mandali_id=eq.${mandaliId}`,
      }, () => void loadGames())
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Live game updates are disconnected. Refresh to sync the board.");
        }
      });
    return () => { void client.removeChannel(channel); };
  }, [client, mandaliId, loadGames]);

  async function createGame() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { data, error: createError } = await client.rpc("create_mandali_ttt_game", { p_mandali_id: mandaliId });
    if (createError) {
      setError(`Could not start a game: ${createError.message}`);
      setBusy(false);
      return;
    }
    setActiveGameId(data);
    await loadGames();
    setActiveGameId(data);
    setBusy(false);
  }

  async function joinGame(gameId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const { error: joinError } = await client.rpc("join_mandali_ttt_game", { p_game_id: gameId });
    if (joinError) {
      setError(`Could not join this game: ${joinError.message}`);
      setBusy(false);
      return;
    }
    await loadGames();
    setActiveGameId(gameId);
    setBusy(false);
  }

  async function playCell(cell: number) {
    if (!activeGame || busy) return;
    setBusy(true);
    setError(null);
    const { error: moveError } = await client.rpc("play_mandali_ttt_move", {
      p_game_id: activeGame.id,
      p_cell: cell,
    });
    if (moveError) setError(`Move not played: ${moveError.message}`);
    else await loadGames();
    setBusy(false);
  }

  function getGameStatus(game: GameRow) {
    if (game.status === "waiting") {
      return game.player_x === user.id ? "Waiting for a Mandali member" : `${names.get(game.player_x) ?? "Member"} is waiting`;
    }
    if (game.status === "draw") return "It's a draw!";
    if (game.status === "won") return `${names.get(game.winner_id ?? "") ?? "A player"} won`;
    return game.next_turn === user.id ? "Your turn" : `${names.get(game.next_turn ?? "") ?? "Opponent"}'s turn`;
  }

  function gameAction(game: GameRow) {
    if (game.status === "waiting" && game.player_x !== user.id) return "Join game";
    if (game.status === "waiting") return "Open room";
    if (game.player_x === user.id || game.player_o === user.id) return "Open game";
    return "Watch";
  }

  return (
    <section className="mandali-games">
      <header className="mandali-games-heading">
        <div className="mandali-voice-mark"><Gamepad2 size={24} /></div>
        <p className="eyebrow">KRIDA</p>
        <h2>Play together.</h2>
        <p className="mandali-voice-description">Quick games with your Mandali, live across devices.</p>
        <button className="vintage-button" onClick={() => void createGame()} disabled={busy}>
          {busy ? <><LoaderCircle size={15} className="spin" /> Please wait…</> : <><Plus size={15} /> New Tic-Tac-Toe</>}
        </button>
      </header>

      {error && <div className="mandali-voice-error" role="alert">{error}</div>}

      <div className="mandali-games-content">
        <section className="mandali-game-lobby" aria-label="Mandali game rooms">
          <div className="mandali-games-subheading"><UsersRound size={15} /><strong>Game rooms</strong><button className="icon-button" onClick={() => void loadGames()} aria-label="Refresh games"><RotateCw size={14} /></button></div>
          {loading ? <div className="mandali-game-empty"><LoaderCircle size={16} className="spin" /> Loading games…</div> : games.length ? (
            <div className="mandali-game-list">
              {games.map((game) => (
                <article className={`mandali-game-row ${game.id === activeGameId ? "selected" : ""}`} key={game.id}>
                  <button className="mandali-game-open" onClick={() => game.status === "waiting" && game.player_x !== user.id ? void joinGame(game.id) : setActiveGameId(game.id)}>
                    <span className="mandali-game-status-dot" data-status={game.status} />
                    <span><strong>Tic-Tac-Toe</strong><small>{getGameStatus(game)}</small></span>
                  </button>
                  <button className="mandali-game-join" onClick={() => game.status === "waiting" && game.player_x !== user.id ? void joinGame(game.id) : setActiveGameId(game.id)} disabled={busy}>
                    {gameAction(game)}
                  </button>
                </article>
              ))}
            </div>
          ) : <p className="mandali-game-empty">No games yet. Start one and invite someone in your Mandali.</p>}
        </section>

        <section className="mandali-game-board-panel" aria-label="Tic-Tac-Toe board">
          {activeGame ? (
            <>
              <div className="mandali-game-title">
                <div><p className="eyebrow">TIC-TAC-TOE</p><h3>{getGameStatus(activeGame)}</h3></div>
                {activeGame.status === "won" && <Trophy size={20} />}
              </div>
              <div className="mandali-game-players">
                <span className={activeGame.next_turn === activeGame.player_x && activeGame.status === "playing" ? "active" : ""}><i className="mark-x">X</i>{names.get(activeGame.player_x) ?? "Player X"}</span>
                <span className={activeGame.next_turn === activeGame.player_o && activeGame.status === "playing" ? "active" : ""}><i className="mark-o">O</i>{activeGame.player_o ? names.get(activeGame.player_o) ?? "Player O" : "Waiting for player"}</span>
              </div>
              <div className="mandali-ttt-board">
                {activeGame.board.map((mark, index) => (
                  <button
                    key={index}
                    className={`mandali-ttt-cell ${mark ? `mark-${mark}` : ""}`}
                    onClick={() => void playCell(index)}
                    disabled={busy || activeGame.status !== "playing" || activeGame.next_turn !== user.id || mark !== null || (activeGame.player_x !== user.id && activeGame.player_o !== user.id)}
                    aria-label={`Square ${index + 1}${mark ? `, ${mark.toUpperCase()}` : ", empty"}`}
                  >{mark?.toUpperCase() ?? ""}</button>
                ))}
              </div>
              <small className="mandali-game-footnote">Moves sync live for everyone in this Mandali.</small>
            </>
          ) : (
            <div className="mandali-game-placeholder"><Gamepad2 size={26} /><h3>Pick a game room</h3><p>Create a Tic-Tac-Toe room or join a Mandali member who is waiting.</p></div>
          )}
        </section>
      </div>
    </section>
  );
}

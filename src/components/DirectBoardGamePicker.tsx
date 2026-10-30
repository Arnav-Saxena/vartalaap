import { useEffect } from "react";
import { ArrowUpRight, Gamepad2, LoaderCircle, X } from "lucide-react";

export const boardGames = [
  { name: "Tic-Tac-Toe", gameType: "TicTacToe", description: "A quick classic for two" },
  { name: "Connect 4", gameType: "Connect4", description: "Drop pieces and connect four" },
  { name: "Gomoku", gameType: "Gomoku", description: "Five in a row on a larger board" },
  { name: "Battleship", gameType: "Battleships", description: "Find and sink your opponent's fleet" },
  { name: "Chess", gameType: "Chess", description: "A timeless strategy match" },
  { name: "Checkers", gameType: "Checkers", description: "Jump and capture your way to victory" },
  { name: "Backgammon", gameType: "Backgammon", description: "Race your pieces around the board" },
] as const;

export type BoardGame = (typeof boardGames)[number];

export function paperGamesPlayUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === "https://papergames.io" && /^\/en\/r\/[A-Za-z0-9_-]+\/embed\/play$/.test(url.pathname)
      ? url
      : null;
  } catch {
    return null;
  }
}

export function DirectBoardGamePicker({
  otherName,
  username,
  gameUrl,
  gameName,
  creatingGame,
  onChoose,
  onClose,
}: {
  otherName: string;
  username: string;
  gameUrl: string | null;
  gameName: string | null;
  creatingGame: string | null;
  onChoose: (game: BoardGame) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !gameUrl) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [gameUrl, onClose]);

  const parsedGameUrl = gameUrl ? paperGamesPlayUrl(gameUrl) : null;
  const iframeUrl = parsedGameUrl ? new URL(parsedGameUrl) : null;
  iframeUrl?.searchParams.set("username", username || "Vartalaap player");

  return (
    <div className="board-game-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !gameUrl) onClose();
    }}>
      <section className={`board-game-picker${gameUrl ? " board-game-playing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="board-game-title">
        <header className="board-game-picker-heading">
          <div className="board-game-picker-mark"><Gamepad2 size={19} /></div>
          <div><p className="eyebrow">A GAME FOR TWO</p><h2 id="board-game-title">{gameUrl ? gameName : "Choose a board game"}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close board games" autoFocus><X size={17} /></button>
        </header>
        {gameUrl && iframeUrl ? (
          <>
            <p className="board-game-picker-note">Playing with {otherName}. They can join from the game invite in this conversation.</p>
            <iframe
              className="board-game-frame"
              src={iframeUrl.toString()}
              title={`${gameName ?? "PaperGames"} with ${otherName}`}
              allow="fullscreen; gamepad"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
            <a className="board-game-external-link" href={iframeUrl.toString()} target="_blank" rel="noopener noreferrer">
              Open game in a new tab <ArrowUpRight size={13} />
            </a>
          </>
        ) : (
          <>
            <p className="board-game-picker-note">
              Choose a game to create a private PaperGames room and invite {otherName} in this DM.
            </p>
            <div className="board-game-options">
              {boardGames.map((game) => (
                <button key={game.gameType} type="button" disabled={creatingGame !== null} onClick={() => onChoose(game)}>
                  <span><strong>{game.name}</strong><small>{game.description}</small></span>
                  {creatingGame === game.gameType
                    ? <LoaderCircle size={16} className="spin" aria-label="Creating game" />
                    : <ArrowUpRight size={16} aria-hidden="true" />}
                </button>
              ))}
            </div>
            <small className="board-game-attribution">Powered by PaperGames. The API key remains on the server.</small>
          </>
        )}
      </section>
    </div>
  );
}

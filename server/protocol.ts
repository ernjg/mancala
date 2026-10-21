import type { Player, State } from "../rules/rules.ts";

/** Browser -> server. The game is chosen by the WebSocket URL: wss://<host>/<game id>. */
export type ClientMessage =
    | { type: "move"; pit: number }
    | { type: "swap" }  // take the first player's position instead of moving
    | { type: "new" };

/** Server -> browser. */
export type ServerMessage =
    | { type: "joined"; seat: Player | null }                                   // null = spectator
    | { type: "state"; state: State; wins: [number, number]; players: number }  // full snapshot
    | { type: "move"; pit: number }                                             // replay this move
    | { type: "swap" };                                                         // replay a pie-rule swap

// ---------- lobby ----------

/** Browser -> lobby, at wss://<host>/lobby. */
export type LobbyClientMessage =
    | { type: "find" };  // pair me with the next person who asks

/** Lobby -> browser. */
export type LobbyServerMessage =
    | { type: "online"; count: number }  // people on the front page right now
    | { type: "match"; game: string };   // go play in this room

/** Four characters, A-Z and 0-9. */
export function newRoomCode(): string {
    return Math.random().toString(36).slice(2, 6).toUpperCase();
}

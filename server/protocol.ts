import type { Player, State } from "../rules/rules.ts";

/** Browser -> server. */
export type ClientMessage =
    | { type: "join"; game: string }
    | { type: "move"; pit: number }
    | { type: "new" };

/** Server -> browser. */
export type ServerMessage =
    | { type: "joined"; seat: Player | null }                                   // null = spectator
    | { type: "state"; state: State; wins: [number, number]; players: number }  // full snapshot
    | { type: "move"; pit: number };                                            // replay this move

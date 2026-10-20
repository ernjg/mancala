import { WebSocketServer, type WebSocket } from "ws";
import { applyMove, initialState, isGameOver, legalMoves, winnerOf, type Player, type State } from "../rules/rules.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

type Game = {
    state: State;
    wins: [number, number];
    seats: [WebSocket | null, WebSocket | null];  // who is player 0 and 1
    sockets: Set<WebSocket>;                      // players plus spectators
};

const games = new Map<string, Game>();
const port = Number(process.env.PORT ?? 8765);
const wss = new WebSocketServer({ port });

function send(ws: WebSocket, msg: ServerMessage) {
    ws.send(JSON.stringify(msg));
}

function broadcast(game: Game, msg: ServerMessage) {
    for (const ws of game.sockets) send(ws, msg);
}

function broadcastState(game: Game) {
    const players = game.seats.filter(Boolean).length;
    broadcast(game, { type: "state", state: game.state, wins: game.wins, players });
}

wss.on("connection", ws => {
    let id: string | undefined;
    let game: Game | undefined;
    let seat: Player | null = null;

    ws.on("message", raw => {
        let msg: ClientMessage;
        try { msg = JSON.parse(String(raw)); } catch { return; }

        if (msg.type === "join" && !game) {
            id = msg.game;
            game = games.get(id) ?? { state: initialState(), wins: [0, 0], seats: [null, null], sockets: new Set() };
            games.set(id, game);
            game.sockets.add(ws);
            seat = game.seats[0] === null ? 0 : game.seats[1] === null ? 1 : null;
            if (seat !== null) game.seats[seat] = ws;
            send(ws, { type: "joined", seat });
            broadcastState(game);
            return;
        }
        if (!game || seat === null) return;  // not joined, or a spectator

        if (msg.type === "move") {
            if (game.state.turn !== seat || !legalMoves(game.state).includes(msg.pit)) return;
            game.state = applyMove(game.state, msg.pit).state;
            if (isGameOver(game.state)) {
                const winner = winnerOf(game.state);
                if (winner !== null) game.wins[winner]++;
            }
            broadcast(game, { type: "move", pit: msg.pit });
        }

        if (msg.type === "new" && isGameOver(game.state)) {
            game.state = initialState(game.state.starter);
            broadcastState(game);
        }
    });

    ws.on("close", () => {
        if (!game || !id) return;
        game.sockets.delete(ws);
        if (seat !== null) game.seats[seat] = null;
        if (game.sockets.size === 0) games.delete(id);
        else broadcastState(game);
    });
});

console.log(`listening on ws://localhost:${port}`);

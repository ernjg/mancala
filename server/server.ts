import { DurableObject } from "cloudflare:workers";
import { applyMove, initialState, isGameOver, legalMoves, winnerOf, type Player, type State } from "../rules/rules.ts";
import type { ClientMessage, ServerMessage } from "./protocol.ts";

export interface Env {
    GAMES: DurableObjectNamespace<Game>;
}

// Guards. Browsers always send Origin on a WebSocket handshake, so this keeps
// other sites from using the worker as a free backend. The rest bound memory
// and CPU per game so a bad actor can only hurt their own game.
const ALLOWED_ORIGINS = ["https://ejgomez.com", "http://localhost:5173"];
const GAME_ID = /^[a-z0-9]{1,32}$/i;
const MAX_SOCKETS = 8;
const MAX_MESSAGE = 100;
const IDLE_MS = 30 * 60 * 1000;  // close a game nobody has touched for this long

/** Entry point: hands each WebSocket to the Durable Object for its game id. */
export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (!ALLOWED_ORIGINS.includes(request.headers.get("Origin") ?? "")) {
            return new Response("forbidden", { status: 403 });
        }
        const id = new URL(request.url).pathname.slice(1);
        if (!GAME_ID.test(id)) return new Response("usage: wss://<host>/<game id>", { status: 400 });
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("expected a WebSocket", { status: 426 });
        }
        return env.GAMES.get(env.GAMES.idFromName(id)).fetch(request);
    },
};

/** One game: its state, the two seats, and everyone connected to it. */
export class Game extends DurableObject<Env> {
    state: State = initialState();
    wins: [number, number] = [0, 0];
    seats: [WebSocket | null, WebSocket | null] = [null, null];  // who is player 0 and 1
    sockets = new Set<WebSocket>();                              // players plus spectators

    override async fetch(_request: Request): Promise<Response> {
        if (this.sockets.size >= MAX_SOCKETS) return new Response("game is full", { status: 503 });
        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        server.accept();
        this.join(server);
        return new Response(null, { status: 101, webSocket: client });
    }

    /** Restart the idle timer. */
    touch() {
        void this.ctx.storage.setAlarm(Date.now() + IDLE_MS);
    }

    /** Idle timer fired: drop everyone so the object can be evicted. */
    override async alarm() {
        for (const ws of this.sockets) ws.close(1000, "closed for inactivity");
    }

    join(ws: WebSocket) {
        this.touch();
        this.sockets.add(ws);
        const seat: Player | null = this.seats[0] === null ? 0 : this.seats[1] === null ? 1 : null;
        if (seat !== null) this.seats[seat] = ws;
        ws.addEventListener("message", e => this.onMessage(seat, e.data));
        ws.addEventListener("close", () => this.leave(ws, seat));
        ws.addEventListener("error", () => this.leave(ws, seat));
        this.send(ws, { type: "joined", seat });
        this.broadcastState();
    }

    leave(ws: WebSocket, seat: Player | null) {
        if (!this.sockets.delete(ws)) return;
        if (seat !== null && this.seats[seat] === ws) this.seats[seat] = null;
        this.broadcastState();
    }

    onMessage(seat: Player | null, data: unknown) {
        if (seat === null) return;  // spectators can't act
        if (typeof data !== "string" || data.length > MAX_MESSAGE) return;
        this.touch();
        let msg: ClientMessage;
        try { msg = JSON.parse(String(data)); } catch { return; }

        if (msg.type === "move") {
            if (this.state.turn !== seat || !legalMoves(this.state).includes(msg.pit)) return;
            this.state = applyMove(this.state, msg.pit).state;
            if (isGameOver(this.state)) {
                const winner = winnerOf(this.state);
                if (winner !== null) this.wins[winner]++;
            }
            this.broadcast({ type: "move", pit: msg.pit });
        }

        if (msg.type === "new" && isGameOver(this.state)) {
            this.state = initialState(this.state.starter);
            this.broadcastState();
        }
    }

    send(ws: WebSocket, msg: ServerMessage) {
        ws.send(JSON.stringify(msg));
    }

    broadcast(msg: ServerMessage) {
        for (const ws of this.sockets) this.send(ws, msg);
    }

    broadcastState() {
        const players = this.seats.filter(Boolean).length;
        this.broadcast({ type: "state", state: this.state, wins: this.wins, players });
    }
}

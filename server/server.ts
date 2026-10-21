import { DurableObject } from "cloudflare:workers";
import { applyMove, canSwap, initialState, isGameOver, legalMoves, swapSides, winnerOf, type Player, type State } from "../rules/rules.ts";
import { newRoomCode, type ClientMessage, type LobbyClientMessage, type LobbyServerMessage, type ServerMessage } from "./protocol.ts";

export interface Env {
    GAMES: DurableObjectNamespace<Game>;
    LOBBY: DurableObjectNamespace<Lobby>;
}

// Guards. Browsers always send Origin on a WebSocket handshake, so this keeps
// other sites from using the worker as a free backend. The rest bound memory
// and CPU per game so a bad actor can only hurt their own game.
const ALLOWED_ORIGINS = ["https://ejgomez.com", "http://localhost:5173"];
const GAME_ID = /^[a-z0-9]{1,32}$/i;
const MAX_SOCKETS = 8;
const MAX_LOBBY = 200;
const MAX_MESSAGE = 100;
const IDLE_MS = 30 * 60 * 1000;  // close a game nobody has touched for this long
const GRACE_MS = 15 * 1000;      // a dropped player keeps their seat this long to reconnect

/** Entry point: hands each WebSocket to the lobby or to the Durable Object for its game id. */
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
        if (id === "lobby") return env.LOBBY.get(env.LOBBY.idFromName("lobby")).fetch(request);
        return env.GAMES.get(env.GAMES.idFromName(id)).fetch(request);
    },
};

/**
 * The single lobby: counts who is on the front page and pairs up anyone who
 * asks for a random opponent. It uses the hibernation API so holding many
 * idle sockets costs nothing; "waiting" is kept on the socket itself so it
 * survives the object sleeping.
 */
export class Lobby extends DurableObject<Env> {
    override async fetch(_request: Request): Promise<Response> {
        if (this.ctx.getWebSockets().length >= MAX_LOBBY) return new Response("lobby is full", { status: 503 });
        const pair = new WebSocketPair();
        this.ctx.acceptWebSocket(pair[1]);
        this.broadcastCount();
        return new Response(null, { status: 101, webSocket: pair[0] });
    }

    override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
        if (typeof data !== "string" || data.length > MAX_MESSAGE) return;
        let msg: LobbyClientMessage;
        try { msg = JSON.parse(data); } catch { return; }

        if (msg.type === "find") {
            const partner = this.waiting().find(w => w !== ws);
            if (!partner) {
                ws.serializeAttachment({ waiting: true });
                return;
            }
            const game = newRoomCode();
            for (const w of [partner, ws]) {
                w.serializeAttachment(null);
                this.send(w, { type: "match", game });
            }
        }
    }

    override async webSocketClose(ws: WebSocket) {
        this.broadcastCount(ws);
    }

    override async webSocketError(ws: WebSocket) {
        this.broadcastCount(ws);
    }

    waiting(): WebSocket[] {
        return this.ctx.getWebSockets().filter(w => w.deserializeAttachment()?.waiting === true);
    }

    send(ws: WebSocket, msg: LobbyServerMessage) {
        try { ws.send(JSON.stringify(msg)); } catch { /* already gone */ }
    }

    /** Tell everyone how many are here, leaving out a socket that is on its way out. */
    broadcastCount(leaving?: WebSocket) {
        const sockets = this.ctx.getWebSockets().filter(w => w !== leaving);
        for (const w of sockets) this.send(w, { type: "online", count: sockets.length });
    }
}

/** A player's seat: their socket (null while they are reconnecting), the token that reclaims it, and the grace timer. */
type Seat = { ws: WebSocket | null; token: string; timer?: ReturnType<typeof setTimeout> | undefined };

/** One game: its state, the two seats, and everyone connected to it. */
export class Game extends DurableObject<Env> {
    state: State = initialState();
    wins: [number, number] = [0, 0];
    seats: [Seat | null, Seat | null] = [null, null];  // who is player 0 and 1
    sockets = new Set<WebSocket>();                     // players plus spectators

    override async fetch(request: Request): Promise<Response> {
        if (this.sockets.size >= MAX_SOCKETS) return new Response("game is full", { status: 503 });
        const pair = new WebSocketPair();
        const [client, server] = [pair[0], pair[1]];
        server.accept();
        this.join(server, new URL(request.url).searchParams.get("token"));
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

    /** Seat a new socket: back in its old seat if its token matches one, else in a free seat, else as a spectator. */
    join(ws: WebSocket, token: string | null) {
        this.touch();
        this.sockets.add(ws);
        let seat: Player | null = null;
        const owned = token === null ? -1 : this.seats.findIndex(s => s !== null && s.token === token);
        if (owned !== -1) {
            seat = owned as Player;
            const old = this.seats[seat]!;
            if (old.timer !== undefined) clearTimeout(old.timer);
            if (old.ws !== null) {  // the same player again before their old socket closed: the new one wins
                this.sockets.delete(old.ws);
                old.ws.close(1000, "reconnected elsewhere");
            }
            old.ws = ws;
            old.timer = undefined;
        } else {
            seat = this.seats[0] === null ? 0 : this.seats[1] === null ? 1 : null;
            if (seat !== null) this.seats[seat] = { ws, token: crypto.randomUUID() };
        }
        ws.addEventListener("message", e => this.onMessage(ws, e.data));
        ws.addEventListener("close", () => this.dropped(ws));
        ws.addEventListener("error", () => this.dropped(ws));
        this.sendJoined(ws);
        this.broadcastState();
    }

    /** Which seat this socket holds right now, if any. */
    seatOf(ws: WebSocket): Player | null {
        const i = this.seats.findIndex(s => s !== null && s.ws === ws);
        return i === -1 ? null : (i as Player);
    }

    sendJoined(ws: WebSocket) {
        const seat = this.seatOf(ws);
        this.send(ws, seat === null ? { type: "joined", seat } : { type: "joined", seat, token: this.seats[seat]!.token });
    }

    /** A socket went away. A player keeps their seat for GRACE_MS in case they come back. */
    dropped(ws: WebSocket) {
        if (!this.sockets.delete(ws)) return;
        const seat = this.seatOf(ws);
        if (seat === null) return;  // a spectator, or a seat that already moved to a newer socket
        const s = this.seats[seat]!;
        s.ws = null;
        s.timer = setTimeout(() => this.vacate(seat), GRACE_MS);
    }

    /** Free a seat and start over; a spectator who was waiting takes the seat. */
    vacate(seat: Player) {
        const s = this.seats[seat];
        if (s === null) return;
        if (s.timer !== undefined) clearTimeout(s.timer);
        this.seats[seat] = null;
        this.state = initialState();  // a player left: start over
        const waiting = [...this.sockets].find(w => this.seatOf(w) === null);
        if (waiting) {
            this.seats[seat] = { ws: waiting, token: crypto.randomUUID() };
            this.sendJoined(waiting);
        }
        this.broadcastState();
    }

    onMessage(ws: WebSocket, data: unknown) {
        const seat = this.seatOf(ws);
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

        if (msg.type === "swap") {
            if (this.state.turn !== seat || !canSwap(this.state)) return;
            this.state = swapSides(this.state);
            this.broadcast({ type: "swap" });
        }

        if (msg.type === "new" && isGameOver(this.state)) {
            this.state = initialState(this.state.starter);
            this.broadcastState();
        }

        if (msg.type === "leave") {
            this.sockets.delete(ws);
            ws.close(1000, "left");
            this.vacate(seat);
        }
    }

    send(ws: WebSocket, msg: ServerMessage) {
        try { ws.send(JSON.stringify(msg)); } catch { /* already gone */ }
    }

    broadcast(msg: ServerMessage) {
        for (const ws of this.sockets) this.send(ws, msg);
    }

    broadcastState() {
        const players = this.seats.filter(Boolean).length;  // a seat held through the grace period still counts
        this.broadcast({ type: "state", state: this.state, wins: this.wins, players });
    }
}

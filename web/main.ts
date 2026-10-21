import { applyMove, initialState, isGameOver, legalMoves, other, pitsOf, storeOf, winnerOf, type Player, type State, type Step } from "../rules/rules.ts";
import { bestMove } from "../rules/ai.ts";
import { newRoomCode, type ClientMessage, type LobbyClientMessage, type LobbyServerMessage, type ServerMessage } from "../server/protocol.ts";

const STEP_MS = 350;
const WS_URL: string = import.meta.env.VITE_WS_URL ?? "ws://localhost:8787";  // wrangler dev
const gameId = new URLSearchParams(location.search).get("game");

const boardEl = document.querySelector<HTMLElement>("#board")!;
const messageEl = document.querySelector<HTMLElement>("#message")!;
const controlsEl = document.querySelector<HTMLElement>("#controls")!;
const winsEl = document.querySelector<HTMLElement>("#wins")!;
const menuEl = document.querySelector<HTMLElement>("#menu")!;
const modeEl = document.querySelector<HTMLSelectElement>("#mode")!;
const onlineEl = document.querySelector<HTMLElement>("#online")!;
const codeEl = document.querySelector<HTMLInputElement>("#code")!;
const summaryEl = document.querySelector<HTMLElement>("#summary")!;
const randomEl = document.querySelector<HTMLButtonElement>("#random")!;

let state: State = initialState();
let busy = false;
let wins: [number, number] = [0, 0];

// Online only (when the URL has ?game=...). Otherwise both players share this screen.
let socket: WebSocket | null = null;
let seat: Player | null = null;  // which player I am; null = spectator
let players = 0;                 // seats filled

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ---------- build the board ----------
// Seen from `me`: my pits run left-to-right along the bottom into my store
// on the right; the opponent's run right-to-left along the top into theirs.
// `cells[i]` is the button that displays pit i. Stores are buttons too so
// they match, but they are never playable so they stay disabled.

const cells: HTMLButtonElement[] = [];

function cell(index: number, rowSpan = 1) {
    const b = document.createElement("button");
    b.onclick = () => socket ? send({ type: "move", pit: index }) : play(index);
    cells[index] = b;
    const td = document.createElement("td");
    td.rowSpan = rowSpan;
    td.append(b);
    return td;
}

function buildBoard(me: Player) {
    const top = document.createElement("tr");
    top.append(cell(storeOf(other(me)), 2), ...pitsOf(other(me)).reverse().map(i => cell(i)), cell(storeOf(me), 2));
    const bottom = document.createElement("tr");
    bottom.append(...pitsOf(me).map(i => cell(i)));
    boardEl.replaceChildren(top, bottom);
}

// ---------- rendering ----------

/** Show seed counts; only pits in `playable` are clickable. */
function show(board: number[], playable: number[] = []) {
    board.forEach((seeds, i) => {
        const b = cells[i]!;
        b.textContent = String(seeds);
        b.disabled = !playable.includes(i);
        const t = Math.min(seeds, 12);
        b.style.color = `hsl(${240 + t * 15} 100% ${45 - t}%)`;
    });
}

/** Pits I may click right now. */
function playable(): number[] {
    if (busy) return [];
    if (socket && state.turn !== seat) return [];
    if (!socket && modeEl.value === "online") return [];  // picking an online option; the local board waits
    if (botsTurn()) return [];
    return legalMoves(state);
}

/** In bot mode the bot plays the top side. */
function botsTurn(): boolean {
    return !socket && modeEl.value === "bot" && state.turn === 1 && !isGameOver(state);
}

/** What to call a player from this screen's point of view. */
function name(p: Player): string {
    if (socket && seat !== null) return p === seat ? "you" : "opponent";
    if (!socket && modeEl.value === "bot") return p === 0 ? "you" : "bot";
    return p === 0 ? "bottom" : "top";
}

function turnText(p: Player): string {
    return name(p) === "you" ? "your turn" : `${name(p)}'s turn`;
}

/** Message for a step, or undefined to leave the previous message up. */
function describe(step: Step): string | undefined {
    switch (step.kind) {
        case "pickup":   return "";
        case "capture":  return `captured ${step.seeds}`;
        case "turn":     return step.extraTurn ? `extra turn for ${name(step.next)}` : turnText(step.next);
        case "gameOver": return step.winner === null ? "draw" : name(step.winner) === "you" ? "you win" : `${name(step.winner)} wins`;
        default:         return undefined;
    }
}

function scoreRow(label: string, value: string) {
    const tr = document.createElement("tr");
    for (const text of [label, value]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.append(td);
    }
    return tr;
}

function button(label: string, onClick: () => void) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = onClick;
    return b;
}

function refresh() {
    show(state.board, playable());
    const me: Player = seat ?? 0;
    winsEl.replaceChildren(scoreRow("wins", ""), scoreRow(name(me), String(wins[me])), scoreRow(name(other(me)), String(wins[other(me)])));
    controlsEl.replaceChildren();
    if (!socket || (seat !== null && isGameOver(state))) controlsEl.append(button("new game", newGame));
    if (socket && players < 2) {
        const copy = button("copy link", () => {
            navigator.clipboard.writeText(location.href).then(() => {
                copy.textContent = "copied";
                setTimeout(() => { copy.textContent = "copy link"; }, 1500);
            });
        });
        controlsEl.append(copy, " ");
    }
    if (socket) controlsEl.append(button("leave", () => { location.href = location.pathname; }));
}

// ---------- actions ----------

async function play(pit: number) {
    if (busy) return;
    busy = true;
    const result = applyMove(state, pit);
    for (const step of result.steps) {
        show(step.board);
        const text = describe(step);
        if (text !== undefined) messageEl.textContent = text;
        await sleep(STEP_MS);
    }
    state = result.state;
    busy = false;
    if (isGameOver(state)) {
        const winner = winnerOf(state);
        if (winner !== null) wins[winner]++;
    }
    refresh();
    if (botsTurn()) void play(bestMove(state));
}

function newGame() {
    if (socket) {
        send({ type: "new" });
        return;
    }
    state = initialState(state.starter);
    messageEl.textContent = turnText(state.turn);
    refresh();
    if (botsTurn()) void play(bestMove(state));
}

// ---------- online ----------

function joinRoom(code: string) {
    code = code.trim().toUpperCase();
    if (code) location.search = `?game=${code}`;
}

function send(msg: ClientMessage) {
    socket?.send(JSON.stringify(msg));
}

async function handle(msg: ServerMessage) {
    switch (msg.type) {
        case "joined":
            seat = msg.seat;
            buildBoard(seat ?? 0);
            break;
        case "state":
            state = msg.state;
            wins = msg.wins;
            players = msg.players;
            messageEl.textContent =
                players < 2 ? `room ${gameId}, waiting for an opponent`
                : isGameOver(state) ? "game over"
                : turnText(state.turn);
            refresh();
            break;
        case "move":
            await play(msg.pit);
            break;
    }
}

function connect(game: string) {
    menuEl.hidden = true;
    socket = new WebSocket(`${WS_URL}/${game}`);
    // Messages are handled one at a time so a snapshot never lands mid-animation.
    let queue = Promise.resolve();
    socket.onmessage = e => { queue = queue.then(() => handle(JSON.parse(e.data))); };
    socket.onclose = e => {
        messageEl.textContent = e.reason || "disconnected";
        busy = true;
        refresh();
    };
    messageEl.textContent = "connecting...";
    refresh();
}

document.querySelector<HTMLButtonElement>("#make")!.onclick = () => joinRoom(newRoomCode());
document.querySelector<HTMLButtonElement>("#join")!.onclick = () => joinRoom(codeEl.value);
codeEl.onkeydown = e => { if (e.key === "Enter") joinRoom(codeEl.value); };

/** On the front page: show how many people are here and let them find a random opponent. */
function connectLobby() {
    const lobby = new WebSocket(`${WS_URL}/lobby`);
    const send = (msg: LobbyClientMessage) => lobby.send(JSON.stringify(msg));
    randomEl.onclick = () => {
        send({ type: "find" });
        randomEl.textContent = "looking for an opponent...";
        randomEl.disabled = true;
    };
    lobby.onmessage = e => {
        const msg: LobbyServerMessage = JSON.parse(e.data);
        if (msg.type === "online") summaryEl.textContent = `random opponent (${msg.count} online)`;
        if (msg.type === "match") joinRoom(msg.game);
    };
    lobby.onclose = () => {
        summaryEl.textContent = "random opponent";
        randomEl.disabled = true;
    };
}

/** Show the online options only in online mode. Also run at startup, since Chrome may restore the last choice. */
function syncMode() {
    onlineEl.hidden = modeEl.value !== "online";
    boardEl.hidden = messageEl.hidden = winsEl.hidden = controlsEl.hidden = !onlineEl.hidden;  // nothing to play until in a room
    if (!socket && !busy && !isGameOver(state)) messageEl.textContent = turnText(state.turn);  // names depend on the mode
    refresh();
    if (botsTurn() && !busy) void play(bestMove(state));
}
modeEl.onchange = () => { if (!busy) state = initialState(); syncMode(); };  // a new mode starts a new game

buildBoard(0);
if (gameId) {
    connect(gameId);
} else {
    connectLobby();
    messageEl.textContent = turnText(state.turn);
    syncMode();
}

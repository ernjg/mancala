import { applyMove, describeStep, initialState, isGameOver, legalMoves, pitsOf, winnerOf, type Player, type State, type Step } from "../rules/rules.ts";
import type { ClientMessage, ServerMessage } from "../server/protocol.ts";

const STEP_MS = 350;
const WS_URL = `ws://${location.hostname}:8765`;
const gameId = new URLSearchParams(location.search).get("game");

const boardEl = document.querySelector("#board")!;
const messageEl = document.querySelector("#message")!;
const controlsEl = document.querySelector("#controls")!;
const winsEl = document.querySelector("#wins")!;

let state: State = initialState();
let busy = false;
let wins: [number, number] = [0, 0];

// Online only (when the URL has ?game=...). Otherwise both players share this screen.
let socket: WebSocket | null = null;
let seat: Player | null = null;  // which player I am; null = spectator
let players = 0;                 // seats filled

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ---------- build the board once ----------
// Player 1's pits run right-to-left along the top, player 0's left-to-right
// along the bottom, with each player's store at the end they sow into.
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

const top = document.createElement("tr");
top.append(cell(13, 2), ...pitsOf(1).reverse().map(i => cell(i)), cell(6, 2));
const bottom = document.createElement("tr");
bottom.append(...pitsOf(0).map(i => cell(i)));
boardEl.append(top, bottom);

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
    return legalMoves(state);
}

/** Message for a step, or undefined to leave the previous message up. */
function describe(step: Step): string | undefined {
    switch (step.kind) {
        case "pickup":   return "";
        case "capture":  return `captured ${step.seeds}`;
        case "turn":     return describeStep(step);
        case "gameOver": return describeStep(step);
        default:         return undefined;
    }
}

function button(label: string, onClick: () => void) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = onClick;
    return b;
}

function refresh() {
    show(state.board, playable());
    const you = (p: Player) => socket && p === seat ? " (you)" : "";
    winsEl.textContent = `wins: player 0${you(0)} ${wins[0]}, player 1${you(1)} ${wins[1]}`;
    controlsEl.replaceChildren();
    if (isGameOver(state) && (!socket || seat !== null)) controlsEl.append(button("new game", newGame));
    if (!socket) controlsEl.append(button("play online", () => {
        location.search = `?game=${Math.random().toString(36).slice(2, 8)}`;
    }));
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
}

function newGame() {
    if (socket) {
        send({ type: "new" });
        return;
    }
    state = initialState(state.starter);
    messageEl.textContent = `player ${state.turn} to move`;
    refresh();
}

// ---------- online ----------

function send(msg: ClientMessage) {
    socket?.send(JSON.stringify(msg));
}

async function handle(msg: ServerMessage) {
    switch (msg.type) {
        case "joined":
            seat = msg.seat;
            break;
        case "state":
            state = msg.state;
            wins = msg.wins;
            players = msg.players;
            messageEl.textContent =
                players < 2 ? `waiting for an opponent, send them this link: ${location.href}`
                : isGameOver(state) ? "game over"
                : `player ${state.turn} to move`;
            refresh();
            break;
        case "move":
            await play(msg.pit);
            break;
    }
}

function connect(game: string) {
    socket = new WebSocket(WS_URL);
    socket.onopen = () => send({ type: "join", game });
    // Messages are handled one at a time so a snapshot never lands mid-animation.
    let queue = Promise.resolve();
    socket.onmessage = e => { queue = queue.then(() => handle(JSON.parse(e.data))); };
    socket.onclose = () => {
        messageEl.textContent = "disconnected";
        busy = true;
        refresh();
    };
    messageEl.textContent = "connecting...";
    refresh();
}

if (gameId) {
    connect(gameId);
} else {
    messageEl.textContent = `player ${state.turn} to move`;
    refresh();
}

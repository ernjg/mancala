import { applyMove, initialState, isGameOver, legalMoves, other, ownerOf, pitsOf, storeOf, winnerOf, type Player, type State, type Step } from "../rules/rules.ts";
import { bestMove } from "../rules/ai.ts";
import { newRoomCode, type ClientMessage, type LobbyClientMessage, type LobbyServerMessage, type ServerMessage } from "../server/protocol.ts";

const STEP_MS = 350;
const WS_URL: string = import.meta.env.VITE_WS_URL ?? "ws://localhost:8787";  // wrangler dev
const gameId = new URLSearchParams(location.search).get("game");

type Mode = "local" | "bot" | "online";

const boardEl = document.querySelector<HTMLElement>("#board")!;
const messageEl = document.querySelector<HTMLElement>("#message")!;
const controlsEl = document.querySelector<HTMLElement>("#controls")!;
const winsEl = document.querySelector<HTMLElement>("#wins")!;
const menuEl = document.querySelector<HTMLElement>("#menu")!;
const modeEls = [...document.querySelectorAll<HTMLButtonElement>(".mode")];
const onlineEl = document.querySelector<HTMLElement>("#online")!;
const roomEl = document.querySelector<HTMLElement>("#room")!;
const codeEl = document.querySelector<HTMLInputElement>("#code")!;
const countEl = document.querySelector<HTMLElement>("#count")!;
const randomEl = document.querySelector<HTMLButtonElement>("#random")!;

let mode: Mode = "local";
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
const isStore = (i: number) => i === storeOf(0) || i === storeOf(1);

function cell(index: number) {
    const b = document.createElement("button");
    b.classList.toggle("store", isStore(index));
    b.onclick = () => socket ? send({ type: "move", pit: index }) : play(index);
    const count = document.createElement("span");
    count.className = "n";
    const dots = document.createElement("span");
    dots.className = "dots";
    b.append(count, dots);
    cells[index] = b;
    return b;
}

/** Grid order: opponent's store, opponent's pits right to left, my store, then my pits left to right. */
function buildBoard(me: Player) {
    boardEl.replaceChildren(
        cell(storeOf(other(me))), ...pitsOf(other(me)).reverse().map(i => cell(i)),
        cell(storeOf(me)), ...pitsOf(me).map(i => cell(i)),
    );
}

// ---------- rendering ----------

/** Show seed counts; only pits in `playable` are clickable; `active` is outlined. */
function show(board: number[], playable: number[] = [], active?: number) {
    board.forEach((seeds, i) => {
        const b = cells[i]!;
        const store = isStore(i);
        b.querySelector(".n")!.textContent = String(seeds);
        const dots = Array.from({ length: seeds }, () => document.createElement("i"));
        b.querySelector(".dots")!.replaceChildren(...dots);
        b.disabled = !playable.includes(i);
        b.classList.toggle("active", i === active);
        b.setAttribute("aria-label", store ? `${storeName(ownerOf(i))}: ${seeds}` : `pit: ${seeds}`);
    });
}

/** Pits I may click right now. */
function playable(): number[] {
    if (busy) return [];
    if (socket && state.turn !== seat) return [];
    if (!socket && mode === "online") return [];  // picking an online option; the local board waits
    if (botsTurn()) return [];
    return legalMoves(state);
}

/** In bot mode the bot plays the top side. */
function botsTurn(): boolean {
    return !socket && mode === "bot" && state.turn === 1 && !isGameOver(state);
}

/** What to call a player from this screen's point of view. */
function name(p: Player): string {
    if (socket && seat !== null) return p === seat ? "you" : "opponent";
    if (!socket && mode === "bot") return p === 0 ? "you" : "bot";
    return p === 0 ? "south" : "north";
}

function turnText(p: Player): string {
    return name(p) === "you" ? "your turn" : `${name(p)}'s turn`;
}

function storeName(p: Player): string {
    return name(p) === "you" ? "your store" : `${name(p)} store`;
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

/** The cell a step touches, for the outline. */
function touched(step: Step): number | undefined {
    switch (step.kind) {
        case "pickup": case "sow":     return step.pit;
        case "capture": case "sweep":  return step.to;
        default:                       return undefined;
    }
}

function button(label: string, onClick: () => void) {
    const b = document.createElement("button");
    b.className = "action";
    b.textContent = label;
    b.onclick = onClick;
    return b;
}

function small(text: string) {
    const s = document.createElement("span");
    s.className = "small";
    s.textContent = text;
    return s;
}

function refresh() {
    show(state.board, playable());
    const me: Player = seat ?? 0;
    winsEl.textContent = `${name(me)} ${wins[me]} · ${name(other(me))} ${wins[other(me)]}`;
    controlsEl.replaceChildren();
    if (!socket || (seat !== null && isGameOver(state))) controlsEl.append(button("new game", newGame));
    if (socket) {
        const label = document.createElement("span");
        label.append(small("room"), ` ${gameId}`);
        roomEl.replaceChildren(label);
        if (players < 2) {
            const copy = button("copy link", () => {
                navigator.clipboard.writeText(location.href).then(() => {
                    copy.textContent = "copied";
                    setTimeout(() => { copy.textContent = "copy link"; }, 1500);
                });
            });
            roomEl.append(copy);
        }
        roomEl.append(button("leave", () => { location.href = location.pathname; }));
    }
}

// ---------- actions ----------

async function play(pit: number) {
    if (busy) return;
    busy = true;
    const result = applyMove(state, pit);
    for (const step of result.steps) {
        show(step.board, [], touched(step));
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
                players < 2 ? "waiting for an opponent"
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
    roomEl.hidden = false;
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
document.querySelector<HTMLFormElement>("#joinForm")!.onsubmit = e => { e.preventDefault(); joinRoom(codeEl.value); };

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
        if (msg.type === "online") countEl.textContent = `${msg.count} online`;
        if (msg.type === "match") joinRoom(msg.game);
    };
    lobby.onclose = () => {
        countEl.textContent = "";
        randomEl.disabled = true;
    };
}

/** Mark the chosen mode and show the online options only in online mode. */
function syncMode() {
    for (const b of modeEls) b.setAttribute("aria-pressed", String(b.dataset["mode"] === mode));
    onlineEl.hidden = mode !== "online";
    boardEl.hidden = messageEl.hidden = winsEl.hidden = controlsEl.hidden = !onlineEl.hidden;  // nothing to play until in a room
    if (!socket && !busy && !isGameOver(state)) messageEl.textContent = turnText(state.turn);  // names depend on the mode
    refresh();
    if (botsTurn() && !busy) void play(bestMove(state));
}
for (const b of modeEls) {
    b.onclick = () => {  // a new mode starts a new game
        mode = b.dataset["mode"] as Mode;
        if (!busy) state = initialState();
        syncMode();
    };
}

buildBoard(0);
if (gameId) {
    connect(gameId);
} else {
    connectLobby();
    messageEl.textContent = turnText(state.turn);
    syncMode();
}

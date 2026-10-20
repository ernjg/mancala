import { applyMove, describeStep, initialState, isGameOver, legalMoves, pitsOf, winnerOf, type State, type Step } from "../rules/rules.ts";

const STEP_MS = 350;
const boardEl = document.querySelector("#board")!;
const messageEl = document.querySelector("#message")!;
const controlsEl = document.querySelector("#controls")!;
const winsEl = document.querySelector("#wins")!;

let state: State = initialState();
let busy = false;
const wins: [number, number] = [0, 0];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ---------- build the board once ----------
// Player 1's pits run right-to-left along the top, player 0's left-to-right
// along the bottom, with each player's store at the end they sow into.
// `cells[i]` is the button that displays pit i. Stores are buttons too so
// they match, but they are never playable so they stay disabled.

const cells: HTMLButtonElement[] = [];

function cell(index: number, rowSpan = 1) {
    const b = document.createElement("button");
    b.onclick = () => play(index);
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

function refresh() {
    show(state.board, legalMoves(state));
    winsEl.textContent = `wins: player 0 ${wins[0]}, player 1 ${wins[1]}`;
    controlsEl.replaceChildren();
    if (isGameOver(state)) {
        const b = document.createElement("button");
        b.textContent = "new game";
        b.onclick = newGame;
        controlsEl.append(b);
    }
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
    state = initialState(state.starter);
    messageEl.textContent = `player ${state.turn} to move`;
    refresh();
}

messageEl.textContent = `player ${state.turn} to move`;
refresh();

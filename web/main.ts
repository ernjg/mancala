import { applyMove, describeStep, initialState, isGameOver, legalMoves, pitsOf, type State, type Step } from "../rules/rules.ts";

const STEP_MS = 350;
const boardEl = document.querySelector("#board")!;
const messageEl = document.querySelector("#message")!;
const controlsEl = document.querySelector("#controls")!;

let state: State = initialState();
let busy = false;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ---------- build the board once ----------
// Player 1's pits run right-to-left along the top, player 0's left-to-right
// along the bottom, with each player's store at the end they sow into.
// `cells[i]` is the element that displays pit i.

const cells: HTMLElement[] = [];

function pitCell(index: number) {
    const b = document.createElement("button");
    b.onclick = () => play(index);
    cells[index] = b;
    const td = document.createElement("td");
    td.append(b);
    return td;
}

function storeCell(index: number) {
    const td = document.createElement("td");
    td.rowSpan = 2;
    cells[index] = td;
    return td;
}

const top = document.createElement("tr");
top.append(storeCell(13), ...pitsOf(1).reverse().map(pitCell), storeCell(6));
const bottom = document.createElement("tr");
bottom.append(...pitsOf(0).map(pitCell));
boardEl.append(top, bottom);

// ---------- rendering ----------

/** Pale when empty, darker as seeds pile up; saturates at FULL seeds. */
const FULL = 12;
function colorFor(seeds: number): { background: string; color: string } {
    const t = Math.min(seeds, FULL) / FULL;
    return {
        background: `hsl(30 70% ${95 - t * 55}%)`,
        color: t > 0.5 ? "white" : "black",
    };
}

/** Show seed counts; only pits in `playable` are clickable. */
function show(board: number[], playable: number[] = []) {
    board.forEach((seeds, i) => {
        const cell = cells[i]!;
        cell.textContent = String(seeds);
        if (cell instanceof HTMLButtonElement) {
            cell.disabled = !playable.includes(i);
            Object.assign(cell.style, colorFor(seeds));
        }
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
    refresh();
}

function newGame() {
    state = initialState(state.starter);
    messageEl.textContent = `player ${state.turn} to move`;
    refresh();
}

messageEl.textContent = `player ${state.turn} to move`;
refresh();

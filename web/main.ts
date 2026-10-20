import { applyMove, describeStep, initialState, isGameOver, legalMoves, render, type State } from "../rules/rules.ts";

const STEP_MS = 350;
const boardEl = document.querySelector("#board")!;
const messageEl = document.querySelector("#message")!;
const movesEl = document.querySelector("#moves")!;

let state: State = initialState();
let busy = false;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function show(board: number[], message: string) {
    boardEl.textContent = render(board, { labels: true });
    messageEl.textContent = message;
}

function button(label: string, onClick: () => void) {
    const b = document.createElement("button");
    b.textContent = label;
    b.onclick = onClick;
    return b;
}

function showMoves() {
    movesEl.replaceChildren();
    if (isGameOver(state)) {
        movesEl.append(button("new game", newGame));
        return;
    }
    movesEl.append(`player ${state.turn}, pick a pit: `);
    for (const pit of legalMoves(state)) {
        movesEl.append(button(String(pit), () => play(pit)), " ");
    }
}

async function play(pit: number) {
    if (busy) return;
    busy = true;
    movesEl.replaceChildren();
    const result = applyMove(state, pit);
    for (const step of result.steps) {
        show(step.board, describeStep(step));
        await sleep(STEP_MS);
    }
    state = result.state;
    busy = false;
    showMoves();
}

function newGame() {
    state = initialState(state.starter);
    start();
}

function start() {
    show(state.board, "");
    showMoves();
}

start();

import * as readline from "node:readline/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { applyMove, describeStep, initialState, legalMoves, render, type State } from "./rules.ts";

const STEP_MS = 350;
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
let state: State = initialState();

function show(board: number[], message: string) {
    console.clear();
    console.log(render(board, { labels: true }));
    console.log("\n" + message);
}

show(state.board, "");

while (legalMoves(state).length > 0) {
    const answer = await rl.question(`player ${state.turn}, pick a pit ${JSON.stringify(legalMoves(state))}: `);
    const pit = Number(answer);
    if (!legalMoves(state).includes(pit)) {
        show(state.board, "not a legal pit");
        continue;
    }
    const result = applyMove(state, pit);
    for (const step of result.steps) {
        show(step.board, describeStep(step));
        await sleep(STEP_MS);
    }
    state = result.state;
}

rl.close();

import { applyMove, canSwap, isGameOver, legalMoves, other, storeOf, swapSides, type Player, type State } from "./rules.ts";

const DEPTH = 4;

/** Pick a move for whoever is to play: minimax with alpha-beta on the store difference. */
export function bestMove(state: State, depth = DEPTH): number {
    return search(state, depth).pit;
}

/** Pie rule: swap only when the mirrored position scores higher than the best move. */
export function shouldSwap(state: State, depth = DEPTH): boolean {
    if (!canSwap(state)) return false;
    return value(swapSides(state), state.turn, depth - 1, -Infinity, Infinity) > search(state, depth).score;
}

function search(state: State, depth: number): { pit: number; score: number } {
    const me = state.turn;
    let best = -Infinity;
    let pick = legalMoves(state)[0]!;
    for (const pit of legalMoves(state)) {
        const score = value(applyMove(state, pit).state, me, depth - 1, best, Infinity);
        if (score > best) {
            best = score;
            pick = pit;
        }
    }
    return { pit: pick, score: best };
}

/** How good `state` is for `me`, looking `depth` moves ahead. Extra turns keep the same player maximizing. */
function value(state: State, me: Player, depth: number, alpha: number, beta: number): number {
    if (depth === 0 || isGameOver(state)) return state.board[storeOf(me)]! - state.board[storeOf(other(me))]!;
    const maximizing = state.turn === me;
    let best = maximizing ? -Infinity : Infinity;
    for (const pit of legalMoves(state)) {
        const score = value(applyMove(state, pit).state, me, depth - 1, alpha, beta);
        if (maximizing) {
            best = Math.max(best, score);
            alpha = Math.max(alpha, score);
        } else {
            best = Math.min(best, score);
            beta = Math.min(beta, score);
        }
        if (beta <= alpha) break;
    }
    return best;
}

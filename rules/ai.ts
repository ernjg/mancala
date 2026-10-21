import { applyMove, isGameOver, legalMoves, other, storeOf, type Player, type State } from "./rules.ts";

const DEPTH = 8;

/** Pick a move for whoever is to play: minimax with alpha-beta on the store difference. */
export function bestMove(state: State, depth = DEPTH): number {
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
    return pick;
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

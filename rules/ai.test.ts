import { describe, expect, it } from "vitest";
import { bestMove } from "./ai.ts";
import { applyMove, initialState, isGameOver, legalMoves, type State } from "./rules.ts";

describe("bestMove", () => {
    it("takes the opening extra turn", () => {
        expect(bestMove(initialState(), 1)).toBe(2);
    });

    it("takes a big capture over a plain move", () => {
        const state: State = { board: [1, 0, 0, 0, 0, 3, 0, 4, 4, 4, 10, 4, 4, 0], turn: 0, starter: 0 };
        expect(bestMove(state, 1)).toBe(0);  // lands in empty pit 1, captures the 10 across
    });

    it("plays a legal move all game long, quickly", () => {
        let state = initialState();
        const start = Date.now();
        while (!isGameOver(state)) {
            const pit = bestMove(state);
            expect(legalMoves(state)).toContain(pit);
            state = applyMove(state, pit).state;
        }
        expect(Date.now() - start).toBeLessThan(2000);
    });
});

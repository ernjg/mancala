import { describe, expect, it } from "vitest";
import { shouldSwap } from "./ai.ts";
import { applyMove, canSwap, initialState, swapSides, type State } from "./rules.ts";

describe("pie rule", () => {
    it("offers a swap only on the second player's first turn", () => {
        const start = initialState();
        expect(canSwap(start)).toBe(false);
        const afterOpening = applyMove(start, 0).state;
        expect(afterOpening.turn).toBe(1);
        expect(canSwap(afterOpening)).toBe(true);
        let s = applyMove(afterOpening, 7).state;
        expect(canSwap(s)).toBe(false);
        for (let i = 0; i < 6; i++) {
            const pit = s.turn === 0 ? [0, 1, 2, 3, 4, 5].find(p => s.board[p]! > 0)! : [7, 8, 9, 10, 11, 12].find(p => s.board[p]! > 0)!;
            s = applyMove(s, pit).state;
            expect(canSwap(s)).toBe(false);
        }
    });

    it("waits through the starter's extra turns", () => {
        const extra = applyMove(initialState(), 2).state;  // lands in the store, player 0 again
        expect(extra.turn).toBe(0);
        expect(canSwap(extra)).toBe(false);
        const passed = applyMove(extra, 0).state;
        expect(passed.turn).toBe(1);
        expect(canSwap(passed)).toBe(true);
    });

    it("mirrors the board and hands the turn back", () => {
        const state: State = { board: [0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0], turn: 1, starter: 0, pie: "offer" };
        const swapped = swapSides(state);
        expect(swapped.board).toEqual([4, 4, 4, 4, 4, 4, 0, 0, 5, 5, 5, 5, 4, 0]);
        expect(swapped.turn).toBe(0);
        expect(swapped.starter).toBe(0);
        expect(canSwap(swapped)).toBe(false);
        expect(swapped.board.reduce((a, b) => a + b)).toBe(48);
        expect(state.board).toEqual([0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);  // input untouched
    });

    it("refuses to swap when there is no offer", () => {
        expect(() => swapSides(initialState())).toThrow();
        const noPie: State = { board: initialState().board, turn: 1, starter: 0 };
        expect(() => swapSides(noPie)).toThrow();
    });

    it("bot swaps into a strong opening and declines a weak one", () => {
        const strong: State = { board: [0, 0, 6, 6, 6, 6, 8, 2, 2, 2, 2, 2, 2, 4], turn: 1, starter: 0, pie: "offer" };
        expect(shouldSwap(strong)).toBe(true);
        const weak: State = { board: [6, 6, 6, 6, 6, 0, 0, 5, 5, 4, 4, 0, 0, 0], turn: 1, starter: 0, pie: "offer" };
        expect(shouldSwap(weak)).toBe(false);
        expect(shouldSwap(initialState())).toBe(false);
    });
});

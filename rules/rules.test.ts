import { describe, expect, it } from "vitest";
import { applyMove, initialState, render, type State } from "./rules.ts";

const kinds = (r: ReturnType<typeof applyMove>) => r.steps.map(s => s.kind);

describe("applyMove", () => {
    it("emits one pickup, one sow per seed, then a turn change", () => {
        const r = applyMove(initialState(), 0);
        expect(kinds(r)).toEqual(["pickup", "sow", "sow", "sow", "sow", "turn"]);
        expect(r.steps[0]?.board).toEqual([0, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
        expect(r.state.board).toEqual([0, 5, 5, 5, 5, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
        expect(r.state.turn).toBe(1);
    });

    it("grants an extra turn when the last seed lands in my store", () => {
        const r = applyMove(initialState(), 2);
        const last = r.steps[r.steps.length - 1];
        expect(last).toMatchObject({ kind: "turn", next: 0, extraTurn: true });
        expect(r.state.board[6]).toBe(1);
    });

    it("skips the opponent's store while sowing", () => {
        const s: State = { board: [0, 0, 0, 0, 0, 10, 0, 1, 1, 1, 1, 1, 1, 0], turn: 0, starter: 0 };
        const r = applyMove(s, 5);
        const visited = r.steps.filter(x => x.kind === "sow").map(x => x.pit);
        expect(visited).not.toContain(13);
        expect(r.state.board[13]).toBe(0);
    });

    it("captures as a separate step after the last sow", () => {
        const s: State = { board: [0, 0, 0, 0, 2, 0, 0, 4, 4, 4, 4, 4, 4, 0], turn: 0, starter: 0 };
        // 2 seeds from pit 4 -> pits 5 and 6 (store) ... no capture. Use pit 3 instead.
        const t: State = { ...s, board: [0, 0, 0, 1, 0, 0, 0, 4, 4, 4, 4, 4, 4, 0] };
        const r = applyMove(t, 3);
        expect(kinds(r)).toEqual(["pickup", "sow", "capture", "sweep", "sweep", "sweep", "sweep", "sweep", "gameOver"]);
        expect(r.steps[2]).toMatchObject({ kind: "capture", from: [4, 8], to: 6, seeds: 5 });
        // Board right after the capture shows player 0's side fully empty, before the sweep.
        expect(r.steps[2]?.board.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it("renders the empty side before sweeping leftovers into stores", () => {
        const s: State = { board: [0, 0, 0, 0, 0, 1, 10, 4, 0, 0, 0, 0, 0, 2], turn: 0, starter: 0 };
        const r = applyMove(s, 5);
        expect(kinds(r)).toEqual(["pickup", "sow", "sweep", "gameOver"]);
        expect(r.steps[1]?.board).toEqual([0, 0, 0, 0, 0, 0, 11, 4, 0, 0, 0, 0, 0, 2]);
        expect(r.steps[2]).toMatchObject({ kind: "sweep", from: 7, to: 13, seeds: 4 });
        expect(r.steps[3]).toMatchObject({ kind: "gameOver", winner: 0 });
        expect(r.state.board).toEqual([0, 0, 0, 0, 0, 0, 11, 0, 0, 0, 0, 0, 0, 6]);
    });

    it("rejects bad moves", () => {
        expect(() => applyMove(initialState(), 7)).toThrow("Cannot play this pit!");
        expect(() => applyMove({ ...initialState(), board: [0, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0] }, 0))
            .toThrow("empty pit");
    });
});

describe("render", () => {
    it("draws the starting board", () => {
        expect(render(initialState().board)).toBe([
            "     [ 4] [ 4] [ 4] [ 4] [ 4] [ 4]",
            "( 0)                               ( 0)",
            "     [ 4] [ 4] [ 4] [ 4] [ 4] [ 4]",
        ].join("\n"));
    });

    it("puts player 1's pits on top in reverse order", () => {
        const board = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
        expect(render(board).split("\n")[0]).toBe("     [12] [11] [10] [ 9] [ 8] [ 7]");
        expect(render(board).split("\n")[2]).toBe("     [ 0] [ 1] [ 2] [ 3] [ 4] [ 5]");
    });
});

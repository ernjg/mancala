export type Player = 0 | 1;

/**
 * Pie rule progress. "opening": the starter's first turn is still going.
 * "offer": the other player's first turn; they may swap sides instead of moving.
 * "done" (or missing): no swap is possible.
 */
export type Pie = "opening" | "offer" | "done";

export type State = {
    board: number[];
    turn: Player;
    starter: Player;
    pie?: Pie;
};

/**
 * One renderable moment during a move. Every step carries the full board
 * as it looks *after* that step, so the UI can replay them one at a time
 * (with a delay between each) and never has to compute anything itself.
 */
export type Step =
    | { kind: "pickup";  board: number[]; pit: number; inHand: number }
    | { kind: "sow";     board: number[]; pit: number; inHand: number }
    | { kind: "capture"; board: number[]; from: number[]; to: number; seeds: number }
    | { kind: "sweep";   board: number[]; from: number; to: number; seeds: number }
    | { kind: "turn";    board: number[]; next: Player; extraTurn: boolean }
    | { kind: "gameOver"; board: number[]; winner: Player | null };

export type MoveResult = {
    steps: Step[];
    state: State;
};

// ---------- board helpers ----------

export function storeOf(player: Player): number {
    return player === 0 ? 6 : 13;
}

export function other(player: Player): Player {
    return player === 0 ? 1 : 0;
}

/** Pit indexes (excluding the store) that belong to `player`. */
export function pitsOf(player: Player): number[] {
    return player === 0 ? [0, 1, 2, 3, 4, 5] : [7, 8, 9, 10, 11, 12];
}

export function ownerOf(pit: number): Player {
    return pit <= 6 ? 0 : 1;
}

/** The pit directly across the board from `pit`. */
export function oppositeOf(pit: number): number {
    return 12 - pit;
}

function seedsIn(board: number[], pit: number): number {
    return board[pit] ?? 0;
}

function sideIsEmpty(board: number[], player: Player): boolean {
    return pitsOf(player).every(pit => seedsIn(board, pit) === 0);
}

// ---------- public API ----------

export function initialState(lastStarter: Player = 1): State {
    const starter = other(lastStarter);
    return {
        board: [
            4, 4, 4, 4, 4, 4, 0,
            4, 4, 4, 4, 4, 4, 0,
        ],
        turn: starter,
        starter,
        pie: "opening",
    };
}

/** The pie rule is live: the player to move may swap sides instead of moving. */
export function canSwap(state: State): boolean {
    return state.pie === "offer" && !isGameOver(state);
}

/** Take over the starter's position: mirror the board and hand the turn back. */
export function swapSides(state: State): State {
    if (!canSwap(state)) throw new Error("Cannot swap sides now");
    const b = state.board;
    return { board: [...b.slice(7, 14), ...b.slice(0, 7)], turn: other(state.turn), starter: state.starter, pie: "done" };
}

/** "opening" lasts until the starter's turn ends, then one "offer"; any move after that settles it. */
function nextPie(pie: Pie | undefined, turnPassed: boolean): Pie {
    if (pie === "opening") return turnPassed ? "offer" : "opening";
    return "done";
}

export function isGameOver(state: State): boolean {
    return sideIsEmpty(state.board, 0) || sideIsEmpty(state.board, 1);
}

export function legalMoves(state: State): number[] {
    if (isGameOver(state)) return [];
    return pitsOf(state.turn).filter(pit => seedsIn(state.board, pit) > 0);
}

export function winnerOf(state: State): Player | null {
    const a = seedsIn(state.board, storeOf(0));
    const b = seedsIn(state.board, storeOf(1));
    if (a === b) return null;
    return a > b ? 0 : 1;
}

/**
 * Apply a move and return every intermediate snapshot plus the final state.
 * Each phase below is a pure function that appends to `steps` and returns
 * the board it produced, so the phases can be read (and tested) in isolation.
 */
export function applyMove(state: State, pitIndex: number): MoveResult {
    validateMove(state, pitIndex);

    const steps: Step[] = [];
    const me = state.turn;

    const hand = pickUp(state.board, pitIndex, steps);
    const landed = sow(hand.board, pitIndex, hand.inHand, me, steps);
    let board = maybeCapture(landed.board, landed.lastPit, me, steps);

    if (sideIsEmpty(board, 0) || sideIsEmpty(board, 1)) {
        // The board is rendered with one side empty (previous step) before
        // the sweep moves the leftovers into the stores one pit at a time.
        board = sweep(board, steps);
        steps.push({ kind: "gameOver", board, winner: winnerOf({ ...state, board }) });
        return { steps, state: { ...state, board, pie: "done" } };
    }

    const extraTurn = landed.lastPit === storeOf(me);
    const next = extraTurn ? me : other(me);
    steps.push({ kind: "turn", board, next, extraTurn });

    return { steps, state: { board, turn: next, starter: state.starter, pie: nextPie(state.pie, next !== me) } };
}

// ---------- phases ----------

function validateMove(state: State, pitIndex: number): void {
    if (isGameOver(state)) {
        throw new Error("Game is over!");
    }
    if (!pitsOf(state.turn).includes(pitIndex)) {
        throw new Error("Cannot play this pit!");
    }
    if (seedsIn(state.board, pitIndex) === 0) {
        throw new Error("Cannot play from an empty pit");
    }
}

/** Empty the chosen pit into the player's hand. */
function pickUp(board: number[], pit: number, steps: Step[]): { board: number[]; inHand: number } {
    const next = [...board];
    const inHand = seedsIn(next, pit);
    next[pit] = 0;
    steps.push({ kind: "pickup", board: next, pit, inHand });
    return { board: next, inHand };
}

/** Drop one seed per pit counter-clockwise, skipping the opponent's store. */
function sow(
    board: number[],
    from: number,
    inHand: number,
    me: Player,
    steps: Step[],
): { board: number[]; lastPit: number } {
    let next = board;
    let pit = from;

    while (inHand > 0) {
        pit = (pit + 1) % 14;
        if (pit === storeOf(other(me))) continue;

        next = [...next];
        next[pit] = seedsIn(next, pit) + 1;
        inHand--;
        steps.push({ kind: "sow", board: next, pit, inHand });
    }

    return { board: next, lastPit: pit };
}

/**
 * If the last seed landed in one of my empty pits and the opposite pit
 * has seeds, both go into my store.
 */
function maybeCapture(board: number[], lastPit: number, me: Player, steps: Step[]): number[] {
    const isMyPit = pitsOf(me).includes(lastPit);
    const wasEmpty = seedsIn(board, lastPit) === 1;
    const across = oppositeOf(lastPit);
    const loot = seedsIn(board, across);

    if (!isMyPit || !wasEmpty || loot === 0) return board;

    const next = [...board];
    const store = storeOf(me);
    const seeds = loot + 1;
    next[lastPit] = 0;
    next[across] = 0;
    next[store] = seedsIn(next, store) + seeds;
    steps.push({ kind: "capture", board: next, from: [lastPit, across], to: store, seeds });
    return next;
}

/** End of game: each player's remaining seeds go into their own store, one pit at a time. */
function sweep(board: number[], steps: Step[]): number[] {
    let next = board;
    for (const player of [0, 1] as const) {
        const store = storeOf(player);
        for (const pit of pitsOf(player)) {
            const seeds = seedsIn(next, pit);
            if (seeds === 0) continue;
            next = [...next];
            next[pit] = 0;
            next[store] = seedsIn(next, store) + seeds;
            steps.push({ kind: "sweep", board: next, from: pit, to: store, seeds });
        }
    }
    return next;
}

// ---------- text rendering ----------

/**
 * Render the board as text. Seeds flow counter-clockwise: player 0 sows
 * left-to-right along the bottom into the right store, player 1 sows
 * right-to-left along the top into the left store.
 *
 *          12   11   10    9    8    7
 *        [ 4] [ 4] [ 4] [ 4] [ 4] [ 4]
 *   ( 0)                               ( 0)
 *        [ 4] [ 4] [ 4] [ 4] [ 4] [ 4]
 *           0    1    2    3    4    5
 */
export function render(board: number[], opts: { labels?: boolean } = {}): string {
    const cell = (pit: number) => `[${String(seedsIn(board, pit)).padStart(2)}]`;
    const store = (pit: number) => `(${String(seedsIn(board, pit)).padStart(2)})`;
    const label = (pit: number) => String(pit).padStart(4);

    const top = pitsOf(1).reverse();
    const bottom = pitsOf(0);
    const pad = " ".repeat(5);

    const lines = [
        pad + top.map(cell).join(" "),
        store(13) + " ".repeat(31) + store(6),
        pad + bottom.map(cell).join(" "),
    ];
    if (opts.labels) {
        lines.unshift(pad + top.map(label).join(" "));
        lines.push(pad + bottom.map(label).join(" "));
    }
    return lines.join("\n");
}

/** One line per step, for logs and tests. */
export function describeStep(step: Step): string {
    switch (step.kind) {
        case "pickup":   return `pick up ${step.inHand} from pit ${step.pit}`;
        case "sow":      return `drop 1 in pit ${step.pit} (${step.inHand} left)`;
        case "capture":  return `capture ${step.seeds} from pits ${step.from.join(" & ")} into store ${step.to}`;
        case "sweep":    return `sweep ${step.seeds} from pit ${step.from} into store ${step.to}`;
        case "turn":     return step.extraTurn ? `extra turn for player ${step.next}` : `player ${step.next} to move`;
        case "gameOver": return step.winner === null ? "game over: draw" : `game over: player ${step.winner} wins`;
    }
}

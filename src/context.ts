import { WriteStream } from "fs";
import { Chrome } from "./chrome.js";
import { Column, Card, Pull, ProjectService } from "./github.js";
import { Screen } from "./screen.js";

export interface CardRunDownState {
    card: Card;
    completed?: boolean;
    skipped?: boolean;
    deferred?: boolean;
}

export interface ColumnRunDownState {
    column: Column;
    cards: CardRunDownState[];
    offset: number;
    oldestFirst: boolean;
    completedCount: number;
    skippedCount: number;
    deferredCount: number;
    refresh?: boolean;
}

export interface WorkArea {
    readonly column: ColumnRunDownState;
    readonly card: CardRunDownState;
}

export interface Context {
    actionState: ColumnRunDownState | undefined;
    reviewState: ColumnRunDownState | undefined;
    currentState: ColumnRunDownState | undefined;
    workArea: WorkArea | undefined;
    currentPull: Pull | undefined;
    skipped: Map<number, number>;
    skipTimeout: number;
    screen: Screen;
    service: ProjectService<string>;
    chrome: Chrome;
    log: WriteStream;
}
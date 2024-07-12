/*!
   Copyright 2019 Microsoft Corporation

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
*/

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
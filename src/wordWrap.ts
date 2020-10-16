interface Token {
    kind: "escape" | "word" | "word-break" | "line-break";
    value: string;
}

const tokenizerRegExp = /(?<escape>(?:\u001b\[\d*(?:;\d*)+m)+)|(?<lineBreak>\r?\n)|(?<wordBreak>[\s\u200b]+)|(?<character>.)/yu;

function * tokenize(s: string): IterableIterator<Token> {
    let pos = 0;
    let wordStart = 0;
    while (pos < s.length) {
        tokenizerRegExp.lastIndex = pos;
        const match = tokenizerRegExp.exec(s);
        if (!match?.groups) throw new Error();
        const { escape, lineBreak, wordBreak, character } = match.groups;
        const nextPos = match.index + match[0].length;
        if (!character) {
            if (wordStart < pos) {
                yield { kind: "word", value: s.slice(wordStart, pos) };
            }
            if (escape) {
                yield { kind: "escape", value: escape };
            }
            else if (lineBreak) {
                yield { kind: "line-break", value: lineBreak };
            }
            else if (wordBreak) {
                yield { kind: "word-break", value: wordBreak };
            }
            wordStart = nextPos;
        }
        pos = nextPos;
    }
    if (wordStart < s.length) {
        yield { kind: "word", value: s.slice(wordStart) };
    }
}

export function wordWrap(s: string, width: number) {
    const lines: string[] = [];
    let lineSize = 0;
    let line = "";
    for (const token of tokenize(s)) {
        if (token.kind === "line-break") {
            lines.push(line);
            line = "";
            lineSize = 0;
            continue;
        }
        if (token.kind === "escape") {
            line += token.value;
            continue;
        }
        if (lineSize + token.value.length > width) {
            lines.push(line.replace(/\s+$/, ""));
            line = "";
            lineSize = 0;
            if (token.kind === "word-break" && token.value === " ") {
                continue;
            }
        }
        line += token.value;
        lineSize += token.value.length;
    }
    if (line) {
        lines.push(line);
    }
    return lines;
}

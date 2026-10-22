import { createInterface } from "node:readline/promises";
import { AgentError } from "./session.js";

export function askHidden(question: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY) {
    throw new AgentError("A terminal is needed to type the master password");
  }
  process.stderr.write(question);
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let typed = "";
    const done = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.off("data", onData);
      process.stderr.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(typed);
      }
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\r" || char === "\n") {
          return done();
        }
        if (char === "\u0003") {
          return done(new AgentError("Cancelled"));
        }
        if (char === "\u007f" || char === "\b") {
          typed = typed.slice(0, -1);
        } else if (char >= " ") {
          typed += char;
        }
      }
    };
    input.on("data", onData);
  });
}

export async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    return false;
  }
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await reader.question(question)).trim());
  } finally {
    reader.close();
  }
}

export async function ask(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new AgentError("A terminal is needed to answer: " + question);
  }
  const reader = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await reader.question(question)).trim();
  } finally {
    reader.close();
  }
}

export async function choose(title: string, options: string[]): Promise<number> {
  if (options.length === 1) {
    process.stderr.write(`${title}: ${options[0]}\n`);
    return 0;
  }
  if (!process.stdin.isTTY) {
    throw new AgentError(`Several choices for ${title.toLowerCase()}; pass it as a flag`);
  }
  process.stderr.write(`${title}\n`);
  options.forEach((option, index) => process.stderr.write(`  ${index + 1}) ${option}\n`));
  for (;;) {
    const answer = Number(await ask(`Choose 1-${options.length}: `));
    if (Number.isInteger(answer) && answer >= 1 && answer <= options.length) {
      return answer - 1;
    }
  }
}

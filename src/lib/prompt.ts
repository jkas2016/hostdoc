import { createInterface } from "node:readline/promises";

/** Ask a yes/no question on stdin; resolves true only for y/yes (case-insensitive). */
export async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(question);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

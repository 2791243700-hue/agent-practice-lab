export function quoteMatches(text: string, quote: string): number[] {
  if (!quote) return [];
  const source = Array.from(text),
    wanted = Array.from(quote);
  const result: number[] = [];
  for (let index = 0; index <= source.length - wanted.length; index++)
    if (wanted.every((letter, offset) => source[index + offset] === letter))
      result.push(index);
  return result;
}
export class DraftWriter<T> {
  private tail: Promise<void> = Promise.resolve();
  constructor(
    private revision: number,
    private write: (revision: number, value: T) => Promise<number>,
  ) {}
  save(value: T): Promise<void> {
    const task = this.tail.then(async () => {
      this.revision = await this.write(this.revision, value);
    });
    this.tail = task;
    // Observe failure even when the UI has not yet awaited its queued snapshot.
    void task.catch(() => {});
    return task;
  }
}

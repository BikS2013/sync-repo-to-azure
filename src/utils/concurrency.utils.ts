/**
 * Promise-based concurrency limiter.
 * Runs up to `concurrency` tasks in parallel, returning all results in order.
 * No external dependencies required.
 */
export async function parallelLimit<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  // Spawn `concurrency` workers (or fewer if we have fewer tasks)
  const workerCount = Math.min(concurrency, tasks.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}

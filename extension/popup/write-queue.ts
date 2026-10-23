const queues = new Map<string, Promise<void>>();

export function enqueue(id: string, task: () => Promise<void>): Promise<void> {
  const next = (queues.get(id) ?? Promise.resolve()).then(task);
  queues.set(id, next);
  void next.finally(() => {
    if (queues.get(id) === next) {
      queues.delete(id);
    }
  });
  return next;
}

export async function settled(): Promise<void> {
  while (queues.size > 0) {
    await Promise.allSettled([...queues.values()]);
  }
}

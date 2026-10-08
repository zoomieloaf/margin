export function createIdGenerator(prefix = 'b'): () => string {
  let n = 0;
  return () => `${prefix}${++n}`;
}

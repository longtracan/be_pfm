/**
 * D1 database binding wrapper.
 * env.DB is the D1 binding injected by CF Workers runtime.
 */
export function getDb(env) {
  if (!env || !env.DB) {
    throw new Error("D1 binding 'DB' not found in Workers env");
  }
  return env.DB;
}

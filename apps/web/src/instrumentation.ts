/** Runs once when the server starts: refuse to boot with an invalid environment. */
export async function register(): Promise<void> {
  const { getServerEnv } = await import('./config/env');
  getServerEnv();
}

import { execFileSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

let container: StartedPostgreSqlContainer | undefined;
let storage: StartedTestContainer | undefined;

export const TEST_BUCKET = 'remember-me-test';

/** Starts one real PostgreSQL for the whole run and applies the committed migrations to it. */
export async function setup(project: TestProject): Promise<void> {
  const [database, objectStorage] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    // S3-compatible storage; objects are readable without credentials, like a public R2 bucket.
    new GenericContainer('adobe/s3mock:5.2.3')
      .withEnvironment({ COM_ADOBE_TESTING_S3MOCK_STORE_INITIAL_BUCKETS: TEST_BUCKET })
      .withExposedPorts(9090)
      .withWaitStrategy(Wait.forHttp('/', 9090).forStatusCode(200))
      .start(),
  ]);
  container = database;
  storage = objectStorage;
  const databaseUrl = database.getConnectionUri();
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  });
  project.provide('databaseUrl', databaseUrl);
  project.provide(
    's3Endpoint',
    `http://${objectStorage.getHost()}:${objectStorage.getMappedPort(9090)}`,
  );
  project.provide('s3Bucket', TEST_BUCKET);
}

export async function teardown(): Promise<void> {
  await Promise.all([container?.stop(), storage?.stop()]);
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    s3Endpoint: string;
    s3Bucket: string;
  }
}

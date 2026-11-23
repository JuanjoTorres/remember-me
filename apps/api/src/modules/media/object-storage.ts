/** Where uploaded files live. The S3 implementation is the only one; tests use a real S3 API too. */
export abstract class ObjectStorage {
  abstract put(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract delete(keys: string[]): Promise<void>;
}

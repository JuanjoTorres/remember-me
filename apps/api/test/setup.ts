import 'reflect-metadata';
import { inject } from 'vitest';

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = inject('databaseUrl');
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['EVENT_BUS_DRIVER'] = 'memory';
process.env['GRANT_SIGNING_SECRET'] = 'test-signing-secret-0123456789abcdef';
process.env['S3_ENDPOINT'] = inject('s3Endpoint');
process.env['S3_BUCKET'] = inject('s3Bucket');
process.env['S3_ACCESS_KEY_ID'] = 'test';
process.env['S3_SECRET_ACCESS_KEY'] = 'test';
process.env['MEDIA_PUBLIC_URL'] = `${inject('s3Endpoint')}/${inject('s3Bucket')}`;

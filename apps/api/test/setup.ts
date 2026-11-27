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
process.env['STRIPE_SECRET_KEY'] = 'sk_test_integration';
process.env['STRIPE_WEBHOOK_SECRET'] = 'whsec_integration_test_secret';
process.env['STRIPE_PRICE_ID_PREMIUM'] = 'price_premium_test';
process.env['STRIPE_PRICE_ID_CUSTOM_SLUG'] = 'price_custom_slug_test';
// Tests hammer the API from one address; the limits get their own test file.
process.env['RATE_LIMIT_PER_MINUTE'] = '1000000';
process.env['GIFT_CREATION_LIMIT_PER_HOUR'] = '1000000';
process.env['LINK_LOOKUP_MISS_LIMIT'] = '1000000';
// The daily jobs are tested by calling their service; the real schedule must never fire mid-test.
process.env['SCHEDULED_JOBS'] = 'off';

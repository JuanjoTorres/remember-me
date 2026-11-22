import 'reflect-metadata';
import { inject } from 'vitest';

process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = inject('databaseUrl');
process.env['WEB_ORIGIN'] = 'http://localhost:3000';
process.env['EVENT_BUS_DRIVER'] = 'memory';

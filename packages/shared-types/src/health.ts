import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.enum(['up', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

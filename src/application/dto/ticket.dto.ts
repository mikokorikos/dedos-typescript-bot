// ============================================================================
// RUTA: src/application/dto/ticket.dto.ts
// ============================================================================

import { z } from 'zod';

export const CreateMiddlemanTicketSchema = z.object({
  userId: z.string().regex(/^\d+$/u, 'Invalid Discord ID'),
  guildId: z.string().regex(/^\d+$/u, 'Invalid guild ID'),
  type: z.literal('MM'),
  context: z.string().min(10).max(1000, 'Context must be 10-1000 chars'),
  partnerTag: z
    .string()
    .trim()
    .regex(/^(?:<@!?(\d{17,20})>|\d{17,20})$/u, 'Debe proporcionar la mención o ID del compañero'),
  categoryId: z.string().regex(/^\d+$/u, 'Invalid category ID'),
  robloxUsername: z.string().min(3).max(50).optional(),
});

export type CreateMiddlemanTicketDTO = z.infer<typeof CreateMiddlemanTicketSchema>;

export const ClaimTicketSchema = z.object({
  ticketId: z.number().int().positive(),
  middlemanId: z.string().regex(/^\d+$/u, 'Invalid Discord ID'),
});

export type ClaimTicketDTO = z.infer<typeof ClaimTicketSchema>;

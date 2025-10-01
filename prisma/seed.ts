/* eslint-disable no-console */
// =============================================================================
// RUTA: prisma/seed.ts
// =============================================================================

import { PrismaClient, TicketStatus, TicketType, WarnSeverity } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('🌱 Iniciando carga de datos de prueba...');

  const ownerId = BigInt('111111111111111111');
  const partnerId = BigInt('222222222222222222');
  const middlemanId = BigInt('333333333333333333');

  const owner = await prisma.user.upsert({
    where: { id: ownerId },
    update: {},
    create: {
      id: ownerId,
      robloxId: BigInt('900100200'),
    },
  });

  const partner = await prisma.user.upsert({
    where: { id: partnerId },
    update: {},
    create: {
      id: partnerId,
      robloxId: BigInt('900100201'),
    },
  });

  const middlemanUser = await prisma.user.upsert({
    where: { id: middlemanId },
    update: {},
    create: {
      id: middlemanId,
      robloxId: BigInt('900100202'),
    },
  });

  await prisma.middleman.upsert({
    where: { userId: middlemanId },
    update: {},
    create: {
      userId: middlemanId,
      robloxUsername: 'DedosMiddleman',
      robloxUserId: BigInt('900100202'),
    },
  });

  const ticket = await prisma.ticket.create({
    data: {
      guildId: BigInt('444444444444444444'),
      channelId: BigInt('555555555555555555'),
      ownerId: owner.id,
      type: TicketType.MM,
      status: TicketStatus.CLAIMED,
      participants: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          { userId: partner.id, role: 'PARTNER' },
        ],
      },
      middlemanClaim: {
        create: {
          middlemanId: middlemanUser.id,
        },
      },
    },
  });

  await prisma.warn.createMany({
    data: [
      {
        userId: partner.id,
        moderatorId: owner.id,
        severity: WarnSeverity.MINOR,
        reason: 'Spam en el servidor de soporte.',
      },
      {
        userId: partner.id,
        moderatorId: middlemanUser.id,
        severity: WarnSeverity.MAJOR,
        reason: 'Incumplimiento de reglas de middleman.',
      },
    ],
  });

  await prisma.memberTradeStats.upsert({
    where: { userId: middlemanId },
    update: { tradesCompleted: { increment: 5 }, lastTradeAt: new Date(), partnerTag: 'Trusted Partner' },
    create: {
      userId: middlemanId,
      tradesCompleted: 5,
      lastTradeAt: new Date(),
      robloxUsername: 'DedosMiddleman',
      robloxUserId: BigInt('900100202'),
      partnerTag: 'Trusted Partner',
    },
  });

  console.log('✅ Datos sembrados correctamente.');
  console.table({ owner: owner.id.toString(), partner: partner.id.toString(), middleman: middlemanUser.id.toString(), ticket: ticket.id });
}

main()
  .catch((error) => {
    console.error('❌ Error ejecutando seed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

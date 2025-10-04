import { AttachmentBuilder } from 'discord.js';
import { vi } from 'vitest';

process.env.DISCORD_TOKEN = process.env.DISCORD_TOKEN ?? 'test-token';
process.env.DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? '123456789012345678';
process.env.MYSQL_HOST = process.env.MYSQL_HOST ?? 'localhost';
process.env.MYSQL_PORT = process.env.MYSQL_PORT ?? '3306';
process.env.MYSQL_USER = process.env.MYSQL_USER ?? 'tester';
process.env.MYSQL_PASSWORD = process.env.MYSQL_PASSWORD ?? 'secret';
process.env.MYSQL_DATABASE = process.env.MYSQL_DATABASE ?? 'dedos_test';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'mysql://tester:secret@localhost:3306/dedos_test';

const createMockAttachment = (name: string): AttachmentBuilder =>
  new AttachmentBuilder(Buffer.from(name, 'utf8'), { name });

vi.mock('@napi-rs/canvas', () => {
  const createContext = () => ({
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    quadraticCurveTo: () => undefined,
    closePath: () => undefined,
    fill: () => undefined,
    stroke: () => undefined,
    fillRect: () => undefined,
    arc: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    clip: () => undefined,
    drawImage: () => undefined,
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createPattern: () => undefined,
    measureText: () => ({ width: 0 }),
    set font(_value: string) {},
    set fillStyle(_value: unknown) {},
    set strokeStyle(_value: unknown) {},
    set shadowColor(_value: string) {},
    set shadowBlur(_value: number) {},
  });

  return {
    createCanvas: (width: number, height: number) => ({
      width,
      height,
      getContext: (_type: '2d') => createContext(),
      toBuffer: () => Buffer.from('canvas'),
    }),
    loadImage: async () => ({ width: 1, height: 1 }),
  };
});

vi.mock('@/infrastructure/external/MiddlemanCardGenerator', () => {
  const renderTradeSummaryCard = vi
    .fn(async () => createMockAttachment('trade-card.png'))
    .mockName('renderTradeSummaryCard');
  const renderProfileCard = vi
    .fn(async () => createMockAttachment('profile-card.png'))
    .mockName('renderProfileCard');
  const renderStatsCard = vi
    .fn(async () => createMockAttachment('stats-card.png'))
    .mockName('renderStatsCard');

  return {
    middlemanCardGenerator: {
      renderTradeSummaryCard,
      renderProfileCard,
      renderStatsCard,
    },
  };
});

vi.mock('@/infrastructure/external/MemberCardGenerator', () => ({
  memberCardGenerator: {
    render: vi.fn(async () => createMockAttachment('member-card.png')).mockName('memberCardRender'),
  },
}));

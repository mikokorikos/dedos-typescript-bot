// ============================================================================
// RUTA: src/presentation/commands/index.ts
// ============================================================================

import {
  commandRegistry,
  getRegisteredCommands,
  prefixCommandRegistry,
  registerCommands,
  serializeCommands,
} from '@/presentation/commands/command-registry';
import { helpCommand } from '@/presentation/commands/general/help';
import { pingCommand } from '@/presentation/commands/general/ping';
import { middlemanCommand } from '@/presentation/commands/middleman/middleman';
import type { Command } from '@/presentation/commands/types';

const commands: Command[] = [pingCommand, helpCommand, middlemanCommand];

registerCommands(commands);

export { commandRegistry, getRegisteredCommands, prefixCommandRegistry, serializeCommands };

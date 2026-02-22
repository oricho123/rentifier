import type { CommandHandler } from './interface';
import type { TelegramMessage } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import { t } from '../i18n';

export class HelpCommand implements CommandHandler {
  constructor(private telegram: TelegramClient) {}

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);

    const helpText = `
${t('commands.help.title')}

${t('commands.help.cmd_start')}
${t('commands.help.cmd_filter')}
${t('commands.help.cmd_list')}
${t('commands.help.cmd_delete')}
${t('commands.help.cmd_pause')}
${t('commands.help.cmd_resume')}
${t('commands.help.cmd_help')}

${t('commands.help.footer')}
    `.trim();

    await this.telegram.sendMessage(chatId, helpText, 'HTML');
  }
}

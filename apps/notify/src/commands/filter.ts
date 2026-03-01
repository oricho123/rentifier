import type { StatefulCommandHandler } from './interface';
import type { TelegramMessage, InlineKeyboardMarkup } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';
import type { ConversationState, ConversationStateManager } from '../conversation-state';
import { t } from '../i18n';
import { KeyboardBuilder } from '../keyboards/builders';

export class FilterCommand implements StatefulCommandHandler {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService,
    private stateManager: ConversationStateManager
  ) {}

  /**
   * Send or edit message based on conversation state
   * If lastMessageId exists, edit that message. Otherwise send new message.
   */
  private async sendOrEditMessage(
    chatId: string,
    text: string,
    keyboard: InlineKeyboardMarkup,
    state: ConversationState
  ): Promise<number | undefined> {
    if (state.lastMessageId) {
      // Edit existing message
      const result = await this.telegram.editMessageText(
        chatId,
        state.lastMessageId,
        text,
        'HTML',
        keyboard
      );
      return state.lastMessageId; // Return same message ID
    } else {
      // Send new message
      const result = await this.telegram.sendInlineKeyboard(chatId, text, keyboard, 'HTML');
      return result.messageId;
    }
  }

  async execute(message: TelegramMessage): Promise<void> {
    const chatId = String(message.chat.id);

    // Initialize conversation state
    const state: ConversationState = {
      chatId,
      command: '/filter',
      step: 'name',
      data: {},
      createdAt: new Date().toISOString(),
    };

    const result = await this.telegram.sendInlineKeyboard(
      chatId,
      `${t('commands.filter.create_intro')}\n\n${t('commands.filter.step_name')}`,
      KeyboardBuilder.skipContinue('name'),
      'HTML'
    );

    state.lastMessageId = result.messageId;
    await this.stateManager.setState(chatId, state);
  }

  async handleStateReply(message: TelegramMessage, state: ConversationState): Promise<void> {
    const chatId = String(message.chat.id);
    const text = message.text?.trim() || '';

    switch (state.step) {
      case 'name':
        await this.handleNameStep(chatId, text, state);
        break;

      case 'cities':
        await this.handleCitiesStep(chatId, text, state);
        break;

      case 'price_min':
        await this.handlePriceMinStep(chatId, text, state);
        break;

      case 'price_max':
        await this.handlePriceMaxStep(chatId, text, state);
        break;

      case 'rooms_min':
        await this.handleRoomsMinStep(chatId, text, state);
        break;

      case 'rooms_max':
        await this.handleRoomsMaxStep(chatId, text, state);
        break;

      case 'keywords':
        await this.handleKeywordsStep(chatId, text, state);
        break;
    }
  }

  private async handleNameStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    state.data.name = text;
    state.step = 'cities';

    const progressText = t('commands.filter.progress', { current: '1', total: '6' });
    const messageId = await this.sendOrEditMessage(
      chatId,
      `${progressText}\n\n` +
        `${t('commands.filter.step_cities')}\n\n` +
        `${t('commands.filter.step_cities_examples')}\n` +
        `${t('commands.filter.step_cities_skip')}`,
      KeyboardBuilder.cities(),
      state
    );

    state.lastMessageId = messageId;
    await this.stateManager.setState(chatId, state);
  }

  private async handleCitiesStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'דלג') {
      state.data.cities = text.split(',').map((c) => c.trim()).filter(Boolean);
    }

    state.step = 'price_min';

    const progressText = t('commands.filter.progress', { current: '2', total: '6' });
    const messageId = await this.sendOrEditMessage(
      chatId,
      `${progressText}\n\n${t('commands.filter.step_price_min')}`,
      KeyboardBuilder.skipContinue('price_min'),
      state
    );

    state.lastMessageId = messageId;
    await this.stateManager.setState(chatId, state);
  }

  private async handlePriceMinStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'דלג') {
      const price = parseFloat(text);
      if (isNaN(price) || price < 0) {
        if (state.lastMessageId) {
          await this.telegram.editMessageText(
            chatId,
            state.lastMessageId,
            t('commands.filter.error_invalid_price'),
            'HTML',
            KeyboardBuilder.skipContinue('price_min')
          );
        } else {
          await this.telegram.sendMessage(
            chatId,
            t('commands.filter.error_invalid_price'),
            'HTML'
          );
        }
        return;
      }
      state.data.minPrice = price;
    }

    state.step = 'price_max';

    const progressText = t('commands.filter.progress', { current: '3', total: '6' });
    const messageId = await this.sendOrEditMessage(
      chatId,
      `${progressText}\n\n${t('commands.filter.step_price_max')}`,
      KeyboardBuilder.skipContinue('price_max'),
      state
    );

    state.lastMessageId = messageId;
    await this.stateManager.setState(chatId, state);
  }

  private async handlePriceMaxStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'דלג') {
      const price = parseFloat(text);
      if (isNaN(price) || price < 0) {
        if (state.lastMessageId) {
          await this.telegram.editMessageText(
            chatId,
            state.lastMessageId,
            t('commands.filter.error_invalid_price'),
            'HTML',
            KeyboardBuilder.skipContinue('price_max')
          );
        } else {
          await this.telegram.sendMessage(
            chatId,
            t('commands.filter.error_invalid_price'),
            'HTML'
          );
        }
        return;
      }
      state.data.maxPrice = price;
    }

    state.step = 'rooms_min';

    const progressText = t('commands.filter.progress', { current: '4', total: '6' });
    const messageId = await this.sendOrEditMessage(
      chatId,
      `${progressText}\n\n${t('commands.filter.step_rooms_min')}`,
      KeyboardBuilder.skipContinue('rooms_min'),
      state
    );

    state.lastMessageId = messageId;
    await this.stateManager.setState(chatId, state);
  }

  private async handleRoomsMinStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'דלג') {
      const rooms = parseFloat(text);
      if (isNaN(rooms) || rooms < 0 || rooms % 0.5 !== 0) {
        if (state.lastMessageId) {
          await this.telegram.editMessageText(
            chatId,
            state.lastMessageId,
            t('commands.filter.error_invalid_rooms'),
            'HTML',
            KeyboardBuilder.skipContinue('rooms_min')
          );
        } else {
          await this.telegram.sendMessage(
            chatId,
            t('commands.filter.error_invalid_rooms'),
            'HTML'
          );
        }
        return;
      }
      state.data.minBedrooms = rooms;
    }

    state.step = 'rooms_max';

    const progressText = t('commands.filter.progress', { current: '5', total: '6' });
    const messageId = await this.sendOrEditMessage(
      chatId,
      `${progressText}\n\n${t('commands.filter.step_rooms_max')}`,
      KeyboardBuilder.skipContinue('rooms_max'),
      state
    );

    state.lastMessageId = messageId;
    await this.stateManager.setState(chatId, state);
  }

  private async handleRoomsMaxStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'דלג') {
      const rooms = parseFloat(text);
      if (isNaN(rooms) || rooms < 0 || rooms % 0.5 !== 0) {
        if (state.lastMessageId) {
          await this.telegram.editMessageText(
            chatId,
            state.lastMessageId,
            t('commands.filter.error_invalid_rooms'),
            'HTML',
            KeyboardBuilder.skipContinue('rooms_max')
          );
        } else {
          await this.telegram.sendMessage(
            chatId,
            t('commands.filter.error_invalid_rooms'),
            'HTML'
          );
        }
        return;
      }
      state.data.maxBedrooms = rooms;
    }

    state.step = 'keywords';

    const progressText = t('commands.filter.progress', { current: '6', total: '6' });
    const messageId = await this.sendOrEditMessage(
      chatId,
      `${progressText}\n\n` +
        `${t('commands.filter.step_keywords')}\n\n` +
        `${t('commands.filter.step_keywords_examples')}`,
      KeyboardBuilder.skipContinue('keywords'),
      state
    );

    state.lastMessageId = messageId;
    await this.stateManager.setState(chatId, state);
  }

  private async handleKeywordsStep(chatId: string, text: string, state: ConversationState): Promise<void> {
    if (text.toLowerCase() !== 'skip' && text.toLowerCase() !== 'דלג') {
      state.data.keywords = text.split(',').map((k) => k.trim()).filter(Boolean);
    }

    // Save filter
    const user = await this.botService.getUserByChatId(chatId);
    if (!user) {
      await this.telegram.sendMessage(
        chatId,
        t('errors.user_not_found'),
        'HTML'
      );
      await this.stateManager.clearState(chatId);
      return;
    }

    await this.botService.createFilter(user.id, {
      name: state.data.name,
      minPrice: state.data.minPrice,
      maxPrice: state.data.maxPrice,
      minBedrooms: state.data.minBedrooms,
      maxBedrooms: state.data.maxBedrooms,
      cities: state.data.cities,
      keywords: state.data.keywords,
    });

    await this.stateManager.clearState(chatId);

    const summary = this.formatFilterSummary(state.data);
    await this.telegram.sendInlineKeyboard(
      chatId,
      `${t('commands.filter.created', { name: state.data.name })}\n\n${summary}\n\n${t('commands.filter.created_notify')}`,
      KeyboardBuilder.quickActions(),
      'HTML'
    );
  }

  private formatFilterSummary(data: any): string {
    const parts: string[] = [];

    if (data.cities && data.cities.length > 0) {
      parts.push(t('commands.filter.summary_cities', { cities: data.cities.join(', ') }));
    }

    if (data.minPrice || data.maxPrice) {
      const min = data.minPrice ? data.minPrice.toLocaleString('he-IL') : '—';
      const max = data.maxPrice ? data.maxPrice.toLocaleString('he-IL') : '—';
      parts.push(t('commands.filter.summary_price', { min, max }));
    }

    if (data.minBedrooms || data.maxBedrooms) {
      const min = data.minBedrooms ? String(data.minBedrooms) : '—';
      const max = data.maxBedrooms ? String(data.maxBedrooms) : '—';
      parts.push(t('commands.filter.summary_rooms', { min, max }));
    }

    if (data.keywords && data.keywords.length > 0) {
      parts.push(t('commands.filter.summary_keywords', { keywords: data.keywords.join(', ') }));
    }

    return parts.length > 0 ? parts.join('\n') : t('commands.filter.summary_none');
  }
}

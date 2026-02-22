import type { TelegramUpdate } from '../webhook/types';
import type { TelegramClient } from '../telegram-client';
import type { BotService } from '../bot-service';
import type { ConversationStateManager } from '../conversation-state';
import { t } from '../i18n';
import { FilterCommand } from '../commands/filter';
import { ListCommand } from '../commands/list';
import { KeyboardBuilder } from '../keyboards/builders';

export class CallbackQueryRouter {
  constructor(
    private telegram: TelegramClient,
    private botService: BotService,
    private stateManager: ConversationStateManager
  ) {}

  async route(update: TelegramUpdate): Promise<void> {
    const query = update.callback_query;
    if (!query?.data) return;

    // Get chat ID (query.message should always exist for inline keyboards in chats)
    if (!query.message?.chat?.id) {
      console.error('Callback query missing message.chat.id:', query);
      await this.answerCallbackQuery(query.id, 'Error: Missing chat context');
      return;
    }

    const chatId = String(query.message.chat.id);
    const data = query.data;

    console.log('Processing callback:', { action: data.split(':')[0], chatId });

    // Answer callback query immediately
    await this.answerCallbackQuery(query.id);

    // Parse callback data
    const [action, subaction, param] = data.split(':');

    // Route to handlers
    switch (action) {
      case 'quick':
        await this.handleQuickAction(chatId, subaction);
        break;
      case 'filter':
        await this.handleFilterAction(chatId, subaction, param);
        break;
      case 'city':
        await this.handleCitySelect(chatId, param);
        break;
      case 'confirm':
        await this.handleConfirm(chatId, subaction, param);
        break;
      case 'cancel':
        await this.handleCancel(chatId, subaction, param);
        break;
      default:
        console.warn('Unknown callback action:', action);
    }
  }

  private async answerCallbackQuery(queryId: string, text?: string): Promise<void> {
    await this.telegram.answerCallbackQuery(queryId, text);
  }

  /**
   * Handle quick action buttons from welcome screen
   * - 'filter': Start filter creation
   * - 'list': Show filter list
   */
  private async handleQuickAction(chatId: string, action: string): Promise<void> {
    const syntheticMessage = {
      chat: { id: parseInt(chatId, 10) },
      from: { first_name: '', last_name: '' },
      text: '',
    } as any;

    switch (action) {
      case 'filter':
        const filterCommand = new FilterCommand(this.telegram, this.botService, this.stateManager);
        await filterCommand.execute(syntheticMessage);
        break;

      case 'list':
        const listCommand = new ListCommand(this.telegram, this.botService);
        await listCommand.execute(syntheticMessage);
        break;

      default:
        console.warn('Unknown quick action:', action);
    }
  }

  /**
   * Handle filter-related actions
   * - 'skip:step': Skip current step in filter creation
   * - 'cancel': Cancel filter creation
   * - 'delete:id': Show delete confirmation
   * - 'edit:id': Show edit message
   */
  private async handleFilterAction(chatId: string, action: string, param: string): Promise<void> {
    switch (action) {
      case 'skip':
        await this.handleSkipStep(chatId, param);
        break;

      case 'cancel':
        await this.stateManager.clearState(chatId);
        await this.telegram.sendMessage(chatId, t('commands.filter.cancelled'), 'HTML');
        break;

      case 'delete':
        await this.handleDeleteRequest(chatId, param);
        break;

      case 'edit':
        await this.telegram.sendMessage(
          chatId,
          '✏️ Edit feature coming soon!',
          'HTML'
        );
        break;

      default:
        console.warn('Unknown filter action:', action);
    }
  }

  /**
   * Handle skip step action during filter creation
   */
  private async handleSkipStep(chatId: string, step: string): Promise<void> {
    const state = await this.stateManager.getState(chatId);
    if (!state || state.command !== '/filter') {
      return;
    }

    // Create synthetic message with "skip" text
    const syntheticMessage = {
      chat: { id: parseInt(chatId, 10) },
      from: { first_name: '', last_name: '' },
      text: 'skip',
    } as any;

    const filterCommand = new FilterCommand(this.telegram, this.botService, this.stateManager);
    await filterCommand.handleStateReply(syntheticMessage, state);
  }

  /**
   * Handle delete request - show confirmation dialog
   */
  private async handleDeleteRequest(chatId: string, filterIdStr: string): Promise<void> {
    const filterId = parseInt(filterIdStr, 10);
    if (isNaN(filterId)) {
      return;
    }

    const user = await this.botService.getUserByChatId(chatId);
    if (!user) {
      await this.telegram.sendMessage(chatId, t('errors.user_not_found'), 'HTML');
      return;
    }

    // Get filter to show name in confirmation
    const filters = await this.botService.getFilters(user.id);
    const filter = filters.find((f) => f.id === filterId);

    if (!filter) {
      await this.telegram.sendMessage(chatId, t('errors.filter_not_found'), 'HTML');
      return;
    }

    await this.telegram.sendInlineKeyboard(
      chatId,
      t('commands.filter.delete_confirm', { name: filter.name }),
      KeyboardBuilder.confirm('delete', filterId),
      'HTML'
    );
  }

  /**
   * Handle city quick-select
   * Updates conversation state with selected city and continues to next step
   */
  private async handleCitySelect(chatId: string, city: string): Promise<void> {
    const state = await this.stateManager.getState(chatId);
    if (!state || state.command !== '/filter' || state.step !== 'cities') {
      return;
    }

    // Map city codes to display names
    const cityMap: Record<string, string> = {
      tel_aviv: t('cities.tel_aviv'),
      jerusalem: t('cities.jerusalem'),
      haifa: t('cities.haifa'),
      beer_sheva: t('cities.beer_sheva'),
      rishon: t('cities.rishon_lezion'),
      petah: t('cities.petah_tikva'),
      ashdod: t('cities.ashdod'),
      netanya: t('cities.netanya'),
      ramat_gan: t('cities.ramat_gan'),
      herzliya: t('cities.herzliya'),
    };

    const cityName = cityMap[city] || city;

    // Create synthetic message with city name
    const syntheticMessage = {
      chat: { id: parseInt(chatId, 10) },
      from: { first_name: '', last_name: '' },
      text: cityName,
    } as any;

    const filterCommand = new FilterCommand(this.telegram, this.botService, this.stateManager);
    await filterCommand.handleStateReply(syntheticMessage, state);
  }

  /**
   * Handle confirmation dialogs
   * - 'delete:id': Actually delete the filter
   */
  private async handleConfirm(chatId: string, action: string, param: string): Promise<void> {
    switch (action) {
      case 'delete':
        await this.handleDeleteConfirm(chatId, param);
        break;

      default:
        console.warn('Unknown confirm action:', action);
    }
  }

  /**
   * Actually delete the filter after confirmation
   */
  private async handleDeleteConfirm(chatId: string, filterIdStr: string): Promise<void> {
    const filterId = parseInt(filterIdStr, 10);
    if (isNaN(filterId)) {
      return;
    }

    const user = await this.botService.getUserByChatId(chatId);
    if (!user) {
      await this.telegram.sendMessage(chatId, t('errors.user_not_found'), 'HTML');
      return;
    }

    // Validate user owns the filter and delete it
    const deleted = await this.botService.deleteFilter(user.id, filterId);

    if (deleted) {
      await this.telegram.sendMessage(chatId, t('commands.filter.deleted'), 'HTML');
    } else {
      await this.telegram.sendMessage(chatId, t('errors.filter_not_found'), 'HTML');
    }
  }

  /**
   * Handle cancel button
   * Clears any pending state and sends cancellation message
   */
  private async handleCancel(chatId: string, action: string, param: string): Promise<void> {
    // Clear any pending state
    await this.stateManager.clearState(chatId);

    // Send appropriate cancellation message based on context
    if (action === 'delete') {
      await this.telegram.sendMessage(chatId, t('common.cancel'), 'HTML');
    } else {
      await this.telegram.sendMessage(chatId, t('commands.filter.cancelled'), 'HTML');
    }
  }
}

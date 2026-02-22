/**
 * Keyboard builders for Telegram inline keyboards
 * All callback data follows format: "action:subaction:param" and must be < 64 bytes
 */

import { InlineKeyboardMarkup } from '../webhook/types';
import { t } from '../i18n';

/**
 * Keyboard builder class with static methods for creating inline keyboards
 */
export class KeyboardBuilder {
  /**
   * Welcome screen quick action buttons
   * @returns Inline keyboard with create filter and list filters buttons
   *
   * @example
   * const keyboard = KeyboardBuilder.quickActions();
   * // Returns: [[צור פילטר], [רשימת פילטרים]]
   */
  static quickActions(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: t('common.create_filter'),
            callback_data: 'quick:filter',
          },
        ],
        [
          {
            text: t('common.list_filters'),
            callback_data: 'quick:list',
          },
        ],
      ],
    };
  }

  /**
   * Skip/cancel buttons for filter creation steps
   * @param step - Current step identifier (e.g., 'cities', 'price_min', 'rooms_max')
   * @returns Inline keyboard with skip and cancel buttons
   *
   * @example
   * const keyboard = KeyboardBuilder.skipContinue('cities');
   * // Callback data: "filter:skip:cities" and "filter:cancel"
   */
  static skipContinue(step: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: t('common.skip'),
            callback_data: `filter:skip:${step}`,
          },
        ],
        [
          {
            text: t('common.cancel'),
            callback_data: 'filter:cancel',
          },
        ],
      ],
    };
  }

  /**
   * City quick-select keyboard with common Israeli cities
   * @returns Inline keyboard with city buttons and skip/cancel options
   *
   * @example
   * const keyboard = KeyboardBuilder.cities();
   * // Returns grid of city buttons plus skip/cancel
   */
  static cities(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: t('cities.tel_aviv'),
            callback_data: 'city:select:tel_aviv',
          },
          {
            text: t('cities.jerusalem'),
            callback_data: 'city:select:jerusalem',
          },
        ],
        [
          {
            text: t('cities.haifa'),
            callback_data: 'city:select:haifa',
          },
          {
            text: t('cities.beer_sheva'),
            callback_data: 'city:select:beer_sheva',
          },
        ],
        [
          {
            text: t('cities.rishon_lezion'),
            callback_data: 'city:select:rishon',
          },
          {
            text: t('cities.petah_tikva'),
            callback_data: 'city:select:petah',
          },
        ],
        [
          {
            text: t('cities.ashdod'),
            callback_data: 'city:select:ashdod',
          },
          {
            text: t('cities.netanya'),
            callback_data: 'city:select:netanya',
          },
        ],
        [
          {
            text: t('cities.ramat_gan'),
            callback_data: 'city:select:ramat_gan',
          },
          {
            text: t('cities.herzliya'),
            callback_data: 'city:select:herzliya',
          },
        ],
        [
          {
            text: t('common.skip'),
            callback_data: 'filter:skip:cities',
          },
        ],
        [
          {
            text: t('common.cancel'),
            callback_data: 'filter:cancel',
          },
        ],
      ],
    };
  }

  /**
   * Filter management actions (edit/delete) for filter list
   * @param filterId - The ID of the filter
   * @returns Inline keyboard with edit and delete buttons
   *
   * @example
   * const keyboard = KeyboardBuilder.filterActions(5);
   * // Callback data: "filter:edit:5" and "filter:delete:5"
   */
  static filterActions(filterId: number): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: t('common.edit'),
            callback_data: `filter:edit:${filterId}`,
          },
          {
            text: t('common.delete'),
            callback_data: `filter:delete:${filterId}`,
          },
        ],
      ],
    };
  }

  /**
   * Confirmation dialog with confirm/cancel buttons
   * @param action - Action to confirm (e.g., 'delete', 'pause')
   * @param id - ID of the item being confirmed
   * @returns Inline keyboard with confirm and cancel buttons
   *
   * @example
   * const keyboard = KeyboardBuilder.confirm('delete', 5);
   * // Callback data: "confirm:delete:5" and "cancel:delete:5"
   */
  static confirm(action: string, id: number): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          {
            text: t('common.confirm'),
            callback_data: `confirm:${action}:${id}`,
          },
          {
            text: t('common.cancel'),
            callback_data: `cancel:${action}:${id}`,
          },
        ],
      ],
    };
  }

  /**
   * Pagination controls for multi-page lists
   * @param page - Current page number (0-indexed)
   * @param totalPages - Total number of pages
   * @param prefix - Callback data prefix (e.g., 'filters', 'listings')
   * @returns Inline keyboard with previous/next navigation buttons
   *
   * @example
   * const keyboard = KeyboardBuilder.pagination(1, 5, 'filters');
   * // Callback data: "page:filters:0" and "page:filters:2"
   */
  static pagination(page: number, totalPages: number, prefix: string): InlineKeyboardMarkup {
    const buttons = [];

    if (page > 0) {
      buttons.push({
        text: t('common.previous'),
        callback_data: `page:${prefix}:${page - 1}`,
      });
    }

    if (page < totalPages - 1) {
      buttons.push({
        text: t('common.next'),
        callback_data: `page:${prefix}:${page + 1}`,
      });
    }

    return {
      inline_keyboard: buttons.length > 0 ? [buttons] : [],
    };
  }
}

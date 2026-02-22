/**
 * Hebrew localization strings for Rentifier bot
 */
export const he = {
  commands: {
    start: {
      welcome_new: 'ברוכים הבאים ל-Rentifier, {name}! 🏠',
      welcome_new_description: 'אני אעזור לך למצוא דירות להשכרה בישראל.',
      welcome_back: 'שלום שוב, {name}!',
      filter_count: 'יש לך {count} פילטר{plural} פעיל{plural}.',
      command_list: '<b>פקודות זמינות:</b>',
      description: 'הרשמה או הצגת חשבון',
    },
    filter: {
      description: 'יצירת פילטר חיפוש חדש',
      create_intro: 'בואו ניצור פילטר חדש! 📝',
      step_name: 'תן לפילטר שם (לדוגמה: "תל אביב 2 חדרים"):',
      step_cities: 'באילו עיירות לחפש?',
      step_cities_examples: 'דוגמאות: תל אביב, ירושלים, חיפה',
      step_cities_skip: 'או הקלד "דלג" כדי לחפש בכל הערים.',
      step_price_min: 'מחיר מינימלי (₪ לחודש)?',
      step_price_max: 'מחיר מקסימלי (₪ לחודש)?',
      step_rooms_min: 'מספר חדרים מינימלי?',
      step_rooms_max: 'מספר חדרים מקסימלי?',
      step_keywords: 'מילות מפתח לחיפוש? (מופרד בפסיקים)',
      step_keywords_examples: 'דוגמאות: מרפסת, חניה, מרוהט',
      created: '✅ <b>הפילטר "{name}" נוצר!</b>',
      created_notify: 'תקבל התראות כאשר דירות חדשות תואמות את הפילטר הזה.',
      cancelled: '❌ יצירת הפילטר בוטלה.',
      progress: 'שלב {current} מתוך {total}',
      summary_cities: '📍 ערים: {cities}',
      summary_price: '💰 מחיר: {min} - {max} ₪/חודש',
      summary_rooms: '🛏️ חדרים: {min} - {max}',
      summary_keywords: '🔍 מילות מפתח: {keywords}',
      summary_none: 'לא הוגדרו קריטריונים ספציפיים',
      error_invalid_price: '❌ מחיר לא תקין. אנא הזן מספר חיובי או הקלד "דלג".',
      error_invalid_rooms: '❌ מספר חדרים לא תקין. אנא הזן מספר שלם חיובי או הקלד "דלג".',
      delete_confirm: 'האם אתה בטוח שברצונך למחוק את הפילטר "{name}"?',
      deleted: '✅ הפילטר נמחק בהצלחה.',
    },
    list: {
      description: 'הצגת כל הפילטרים שלך',
      title: '<b>הפילטרים שלך:</b>',
      no_filters: 'אין לך פילטרים פעילים. השתמש ב-/filter כדי ליצור פילטר.',
      filter_header: '<b>פילטר #{id}: {name}</b>',
      filter_status_active: '✅ פעיל',
      filter_status_paused: '⏸️ מושהה',
    },
    pause: {
      description: 'השהיית התראות',
      success: '⏸️ כל ההתראות הושהו. השתמש ב-/resume כדי להמשיך.',
      already_paused: 'ההתראות כבר מושהות.',
    },
    resume: {
      description: 'המשך התראות',
      success: '▶️ ההתראות חודשו. תקבל התראות על דירות חדשות.',
      already_active: 'ההתראות כבר פעילות.',
    },
    delete: {
      description: 'מחיקת פילטר',
      usage: 'שימוש: /delete <id>',
      confirm: 'האם אתה בטוח?',
      success: '✅ הפילטר נמחק.',
      not_found: '❌ פילטר לא נמצא.',
    },
    help: {
      description: 'הצגת עזרה ופקודות',
      title: '<b>פקודות Rentifier Bot</b>',
      cmd_start: '<b>/start</b> - הרשמה או הצגת חשבון',
      cmd_filter: '<b>/filter</b> - יצירת פילטר חיפוש חדש',
      cmd_list: '<b>/list</b> - הצגת הפילטרים הפעילים שלך',
      cmd_delete: '<b>/delete &lt;id&gt;</b> - מחיקת פילטר',
      cmd_pause: '<b>/pause</b> - השהיית כל ההתראות',
      cmd_resume: '<b>/resume</b> - המשך כל ההתראות',
      cmd_help: '<b>/help</b> - הצגת הודעת עזרה זו',
      footer: 'השתמש ב-/filter כדי ליצור את הפילטר הראשון שלך ולהתחיל לקבל רישומים!',
    },
  },
  common: {
    skip: '⏭️ דלג',
    cancel: '❌ ביטול',
    confirm: '✅ אישור',
    next: 'הבא ➡️',
    previous: '⬅️ הקודם',
    edit: '✏️ ערוך',
    delete: '🗑️ מחק',
    create_filter: '➕ צור פילטר',
    list_filters: '📋 רשימת פילטרים',
    create_another: '➕ צור פילטר נוסף',
  },
  errors: {
    user_not_found: '❌ משתמש לא נמצא. אנא שלח /start תחילה.',
    filter_not_found: '❌ פילטר לא נמצא או שאינו שייך לך.',
    operation_failed: '⚠️ הפעולה נכשלה, אנא נסה שוב.',
    invalid_input: '❌ קלט לא תקין.',
    unknown_command: 'פקודה לא מוכרת: {command}',
    help_suggestion: 'שלח /help כדי לראות פקודות זמינות.',
  },
  cities: {
    tel_aviv: 'תל אביב',
    jerusalem: 'ירושלים',
    haifa: 'חיפה',
    beer_sheva: 'באר שבע',
    rishon_lezion: 'ראשון לציון',
    petah_tikva: 'פתח תקווה',
    ashdod: 'אשדוד',
    netanya: 'נתניה',
    ramat_gan: 'רמת גן',
    herzliya: 'הרצליה',
  },
};

/**
 * Type-safe string formatter with placeholder replacement
 * @param key - Dot-notation key path (e.g., "commands.start.welcome_new")
 * @param params - Object with placeholder values
 * @returns Formatted string with placeholders replaced
 *
 * @example
 * t('commands.start.welcome_new', { name: 'ישראל' })
 * // Returns: "ברוכים הבאים ל-Rentifier, ישראל! 🏠"
 */
export function t(key: string, params?: Record<string, string | number>): string {
  // Navigate nested object by key path
  const keys = key.split('.');
  let value: any = he;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      console.warn(`Translation key not found: ${key}`);
      return key;
    }
  }

  if (typeof value !== 'string') {
    console.warn(`Translation key does not point to a string: ${key}`);
    return key;
  }

  // Replace {placeholder} with actual values
  if (!params) {
    return value;
  }

  return value.replace(/\{(\w+)\}/g, (match, paramKey) => {
    if (paramKey in params) {
      return String(params[paramKey]);
    }
    return match;
  });
}

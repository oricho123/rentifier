export async function configureBotMenu(botToken: string): Promise<void> {
  const commands = [
    { command: 'start', description: 'הרשמה או הצגת חשבון' },
    { command: 'filter', description: 'יצירת פילטר חיפוש חדש' },
    { command: 'list', description: 'הצגת כל הפילטרים שלך' },
    { command: 'pause', description: 'השהיית התראות' },
    { command: 'resume', description: 'המשך התראות' },
    { command: 'delete', description: 'מחיקת פילטר' },
    { command: 'help', description: 'הצגת עזרה ופקודות' },
  ];

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });

    if (!response.ok) {
      console.error('Failed to set bot commands:', await response.text());
    }
  } catch (error) {
    console.error('Error configuring bot menu:', error);
  }
}

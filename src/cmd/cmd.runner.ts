import { MainMenu } from './main.menu.js';
import { Logger } from '../utils/logger.js';

async function main() {
  try {
    await MainMenu.start();
  } catch (err: any) {
    if (err.name === 'ExitPromptError') {
      console.log('\nExited.');
      process.exit(0);
    }
    Logger.error('Fatal error in Terminal UI runner:', err);
    process.exit(1);
  }
}

main();

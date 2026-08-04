import { pathToFileURL } from 'url';
import { SecureShutdown } from '../core/auth/secure-shutdown.js';
import { LoginScreen } from './login.screen.js';
import { PRDiscoveryService } from '../core/discovery/pr-discovery.service.js';
import { MainMenu } from './main.menu.js';

export async function runCMD(): Promise<void> {
  // Register signal handlers for SIGINT, SIGTERM, uncaught errors
  SecureShutdown.registerSignalHandlers();

  // Step 1: Execute login & realtime capability probes
  const session = await LoginScreen.executeLoginFlow();
  if (!session) {
    console.log('\nExit requested. Bye!');
    process.exit(0);
  }

  // Step 2: Initial PR discovery for authenticated user
  console.log('Discovering open pull requests...');
  await PRDiscoveryService.discoverOpenPRs(
    session.email,
    session.token,
    session.repository.workspace,
    session.repository.repoSlug,
    session.currentUserUuid
  );

  // Step 3: Enter main menu loop
  await MainMenu.displayMenu();
}

// Execute runner if executed directly
const isDirectExecution =
  process.argv[1] &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    process.argv[1].endsWith('cmd.runner.ts') ||
    process.argv[1].endsWith('cmd.runner.js'));

if (isDirectExecution) {
  runCMD().catch((err) => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}


import { ProgressEvent } from '../core/sync/sync.types.js';

export class ProgressRenderer {
  private events = new Map<string, ProgressEvent>();

  update(event: ProgressEvent): void {
    this.events.set(event.url, event);
    this.render();
  }

  render(): void {
    // Clear terminal screen line by line or render overview
    console.clear();
    console.log('================================================================');
    console.log('                 MCP PR Companion - Data Sync                  ');
    console.log('================================================================');

    let totalPercentSum = 0;
    const entries = Array.from(this.events.values());

    for (const ev of entries) {
      totalPercentSum += ev.percent;
      const statusTag = ev.percent === 100
        ? '[DONE]'
        : ev.stage === 'failed'
          ? '[ERR ]'
          : '[RUN ]';

      const label = ev.ticketId ? `${ev.ticketId} (${ev.workspace}/${ev.repoSlug}#${ev.prId})` : `${ev.workspace}/${ev.repoSlug}#${ev.prId}`;
      const percentStr = `${ev.percent}%`.padStart(4);
      console.log(`${statusTag} ${label.padEnd(40)} ${percentStr}  ${ev.message}`);
    }

    const overallPercent = entries.length > 0 ? Math.floor(totalPercentSum / entries.length) : 0;
    console.log('----------------------------------------------------------------');
    console.log(`Overall Progress: ${overallPercent}% (${entries.filter(e => e.percent === 100).length}/${entries.length} completed)`);
    console.log('================================================================\n');
  }
}

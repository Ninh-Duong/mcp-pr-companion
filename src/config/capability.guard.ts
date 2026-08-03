import { ReadProfile, WriteProfile } from './config.schema.js';

export type RequiredCapability = 'pr.read' | 'repository.read' | 'pr.comment' | 'pr.approve' | 'pr.decline' | 'pr.merge' | 'repository.push';

export class CapabilityGuard {
  static checkReadAccess(profile: ReadProfile, capability: RequiredCapability = 'pr.read'): boolean {
    return profile.capabilities.includes(capability);
  }

  static canExecuteWrite(profile: WriteProfile, action: RequiredCapability): { allowed: boolean; reason?: string } {
    if (!profile.enabled) {
      return { allowed: false, reason: 'Write profile is disabled in config/write.json.' };
    }

    if (profile.deny.includes(action)) {
      return { allowed: false, reason: `Action '${action}' is explicitly denied in write profile.` };
    }

    if (!profile.allow.includes(action)) {
      return { allowed: false, reason: `Action '${action}' is not listed in allowed capabilities.` };
    }

    return { allowed: true };
  }

  static assertWriteAccess(profile: WriteProfile, action: RequiredCapability): void {
    const result = this.canExecuteWrite(profile, action);
    if (!result.allowed) {
      throw new Error(`CapabilityGuard Security Check Failed: ${result.reason}`);
    }
  }
}

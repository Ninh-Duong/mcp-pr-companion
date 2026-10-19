import fs from 'fs';
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';
import { AtomicWriter } from './atomic.writer.js';
import { AccessGate } from '../auth/access-gate.js';

/**
 * Encrypted file format for everything under ai-context/ (see docs/ENCRYPTION.md):
 *
 *   "PRC1\n" + header JSON line (plaintext, authenticated as AAD) + iv(12) + AES-256-GCM ciphertext + tag(16)
 *
 * The header holds only what the path already shows plus a random salt. The key is
 * HKDF-SHA256(repository UUID, salt, INFO): Bitbucket returns the UUID only to accounts that can read
 * the repository, after AccessGate.unlock() has checked the credentials.
 *
 * FROZEN: MAGIC and INFO are part of every existing file. Changing them makes all data unreadable.
 */
const MAGIC = Buffer.from('PRC1\n');
const INFO = 'mcp-pr-companion/ai-context/v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface SecureScope {
  workspace: string;
  repoSlug: string;
  prId: number;
}

export interface SecureHeader {
  v: 1;
  workspace: string;
  repo: string;
  pr: number;
  salt: string;
}

/** Thrown for a file written before encryption existed (no PRC1 magic). */
export class PlaintextFileError extends Error {
  constructor() {
    super('Unencrypted ai-context file (written before encryption): re-sync the PR.');
    this.name = 'PlaintextFileError';
  }
}

const DECRYPT_FAILED = 'Cannot decrypt: no access to this repository or the file was modified.';

const deriveKey = (material: string, salt: Buffer) => Buffer.from(hkdfSync('sha256', material, salt, INFO, 32));

export function isEncrypted(buffer: Buffer): boolean {
  return buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

function split(buffer: Buffer): { headLine: Buffer; header: SecureHeader; body: Buffer } {
  if (!isEncrypted(buffer)) throw new PlaintextFileError();
  const end = buffer.indexOf(0x0a, MAGIC.length);
  if (end < 0) throw new Error(DECRYPT_FAILED);
  const headLine = buffer.subarray(MAGIC.length, end + 1);
  let header: SecureHeader;
  try {
    header = JSON.parse(headLine.toString('utf-8'));
  } catch {
    throw new Error(DECRYPT_FAILED);
  }
  if (header.v !== 1 || typeof header.salt !== 'string') throw new Error(DECRYPT_FAILED);
  return { headLine, header, body: buffer.subarray(end + 1) };
}

/** Encrypts text for one PR. The repository must be unlocked (AccessGate). */
export function encryptText(text: string, scope: SecureScope): Buffer {
  const salt = randomBytes(16);
  const header: SecureHeader = { v: 1, workspace: scope.workspace, repo: scope.repoSlug, pr: scope.prId, salt: salt.toString('base64') };
  const headLine = Buffer.from(JSON.stringify(header) + '\n', 'utf-8');
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(AccessGate.material(scope.workspace, scope.repoSlug), salt), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(headLine);
  const data = Buffer.concat([cipher.update(text, 'utf-8'), cipher.final()]);
  return Buffer.concat([MAGIC, headLine, iv, data, cipher.getAuthTag()]);
}

/** Decrypts a buffer written by encryptText. The header's repository must be unlocked. */
export function decryptBuffer(buffer: Buffer): string {
  const { headLine, header, body } = split(buffer);
  if (body.length < IV_BYTES + TAG_BYTES) throw new Error(DECRYPT_FAILED);
  const material = AccessGate.material(header.workspace, header.repo);
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(material, Buffer.from(header.salt, 'base64')), body.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
    decipher.setAAD(headLine);
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
    return Buffer.concat([decipher.update(body.subarray(IV_BYTES, body.length - TAG_BYTES)), decipher.final()]).toString('utf-8');
  } catch {
    throw new Error(DECRYPT_FAILED);
  }
}

export function writeSecure(file: string, text: string, scope: SecureScope): void {
  AtomicWriter.writeFileSync(file, encryptText(text, scope));
}

export function readSecure(file: string): string {
  return decryptBuffer(fs.readFileSync(file));
}

/** The plaintext header (no key needed). */
export function readHeader(file: string): SecureHeader {
  return split(fs.readFileSync(file)).header;
}

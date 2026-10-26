/**
 * Wire primitives shared by every Peer Link process.
 *
 * The protocol is deliberately small: an unauthenticated `hello` proves
 * knowledge of the cluster key without sending it, while every mutation is an
 * HMAC-signed, AES-GCM-encrypted POST. Nothing here depends on Cordis, so the
 * same module runs in the Host, in tests, and in the fake-peer harness.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export const PROTOCOL = 1;
export const VERSION = '1.0.0';
export const DEFAULT_UDP_PORT = 45872;
export const MULTICAST_GROUP = '239.255.77.77';
export const DEFAULT_MAX_TEXT = 8000;
export const MAX_BODY_BYTES = 256 * 1024;
export const CLOCK_SKEW_MS = 120_000;

export function randomId(bytes = 16) {
  return randomBytes(bytes).toString('hex');
}

export function randomNonce() {
  return randomBytes(16).toString('hex');
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function keyFingerprint(key) {
  return sha256(key).slice(0, 16);
}

/**
 * Derive the cluster key.
 *
 * Without a passphrase every local instance shares the owner-only key file.
 * With one, all paired machines derive the same key from the passphrase; the
 * salt is deliberately fixed so two machines never disagree about it.
 */
export function deriveKey(secret, sharedSecret = '') {
  const material = Buffer.isBuffer(secret) ? secret : Buffer.from(String(secret), 'utf8');
  if (typeof sharedSecret === 'string' && sharedSecret.length > 0) {
    return scryptSync(sharedSecret, 'dsh-peer-link-pairing-v1', 32);
  }
  return createHash('sha256').update(material).update('|dsh-peer-link-v1').digest();
}

export function canonicalRequest(method, path, timestamp, nonce, body) {
  const bodyHash = createHash('sha256').update(body).digest('hex');
  return `${PROTOCOL}\n${String(method).toUpperCase()}\n${path}\n${timestamp}\n${nonce}\n${bodyHash}`;
}

export function signRequest(key, method, path, timestamp, nonce, body) {
  return createHmac('sha256', key).update(canonicalRequest(method, path, timestamp, nonce, body)).digest('hex');
}

export function verifyRequest(key, method, path, timestamp, nonce, body, signature) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = signRequest(key, method, path, timestamp, nonce, body);
  return safeEqualHex(expected, signature);
}

export function encryptionAad(method, path, timestamp, nonce) {
  return `${PROTOCOL}|${String(method).toUpperCase()}|${path}|${timestamp}|${nonce}`;
}

export function encryptBody(key, value, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

export function decryptBody(key, envelope, aad) {
  if (!envelope || typeof envelope !== 'object') throw new Error('invalid encrypted envelope');
  const { iv, tag, data } = envelope;
  if (typeof iv !== 'string' || typeof tag !== 'string' || typeof data !== 'string') {
    throw new Error('invalid encrypted envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

export function helloProof(key, nonce, instanceId) {
  return createHmac('sha256', key)
    .update(`hello|${nonce}|${instanceId}`)
    .digest('hex');
}export function verifyHelloProof(key, nonce, instanceId, proof) {
  if (typeof proof !== 'string' || !/^[0-9a-f]{64}$/i.test(proof)) return false;
  return safeEqualHex(helloProof(key, nonce, instanceId), proof);
}

/** AAD for a relay-delivered encrypted payload. */
export function relayAad(id, from, to, timestamp, nonce) {
  return `relay|message|${id}|${from}|${to}|${timestamp}|${nonce}`;
}

/** Canonical HMAC input for one relay envelope. */
export function relayCanonical(id, from, to, timestamp, nonce, body) {
  return `relay|${id}|${from}|${to}|${timestamp}|${nonce}|${sha256(body)}`;
}

export function signRelayMessage(key, id, from, to, timestamp, nonce, body) {
  return createHmac('sha256', key)
    .update(relayCanonical(id, from, to, timestamp, nonce, body))
    .digest('hex');
}

export function verifyRelayMessage(key, id, from, to, timestamp, nonce, body, signature) {
  if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  return safeEqualHex(signRelayMessage(key, id, from, to, timestamp, nonce, body), signature);
}

export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length || left.length === 0) return false;
  return timingSafeEqual(left, right);
}

export function safeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function formatHost(host) {
  const value = String(host ?? '').replace(/^::ffff:/i, '');
  return value.includes(':') ? `[${value}]` : value;
}

export function httpOrigin(host, port) {
  return `http://${formatHost(host)}:${Number(port)}`;
}

export function normalizeRemoteAddress(value) {
  return String(value ?? '').replace(/^::ffff:/i, '');
}

export function isLoopback(host) {
  const value = normalizeRemoteAddress(host).toLowerCase();
  return value === '::1' || value === '127.0.0.1' || value === 'localhost';
}

export function clampText(value, max = DEFAULT_MAX_TEXT) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) throw new Error('message text must not be empty');
  if (text.length > max) throw new Error(`message text exceeds ${max} characters`);
  return text;
}

export function truncate(value, max = 300) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

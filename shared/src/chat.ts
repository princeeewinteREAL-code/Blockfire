/**
 * Chat filter: swaps rude words for stars and cleans up messages before anyone sees them.
 * It looks through common tricks (l33t letters, dots or spaces between letters, repeated letters).
 */
import { CHAT_MAX } from './net.js';

/** Rude words (English and Malay). Matched as whole words after the tricks are undone. */
const BAD = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'dick', 'dickhead',
  'cunt', 'pussy', 'cock', 'whore', 'slut', 'wanker', 'twat', 'prick', 'retard', 'retarded', 'nigger', 'nigga',
  'faggot', 'fag', 'kys', 'rape', 'rapist', 'nazi',
  'babi', 'bodoh', 'sial', 'pukimak', 'puki', 'lancau', 'pantat', 'celaka', 'keparat', 'bangsat', 'kimak', 'butoh',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's', '!': 'i', '|': 'i' };

function squash(word: string): string {
  let out = '';
  for (const ch of word.toLowerCase()) {
    const c = LEET[ch] ?? ch;
    if (!/[a-z]/.test(c)) continue;
    if (out.endsWith(c) && out.endsWith(c + c)) continue; // "fuuuuck" → "fuuck"
    out += c;
  }
  return out;
}

function isBad(word: string): boolean {
  const s = squash(word);
  if (!s) return false;
  const once = s.replace(/(.)\1+/g, '$1');
  return BAD.some((b) => s === b || once === b.replace(/(.)\1+/g, '$1') || s === b + 's' || once === b.replace(/(.)\1+/g, '$1') + 's');
}

/** Clean a chat message: trims it, caps its length, removes control characters and stars out rude words. */
export function filterChat(raw: unknown): string {
  let text = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX);
  if (!text) return '';
  // Words split with dots, dashes or spaces ("f.u.c.k", "f u c k").
  text = text.replace(/\b(?:[a-z0-9@$!|][\s.\-_*]){2,}[a-z0-9@$!|]\b/gi, (m) => (isBad(m.replace(/[\s.\-_*]/g, '')) ? '*'.repeat(m.length) : m));
  return text.replace(/[\p{L}\p{N}@$!|]+/gu, (w) => (isBad(w) ? '*'.repeat(w.length) : w));
}

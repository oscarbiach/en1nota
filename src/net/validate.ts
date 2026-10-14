// Validación de mensajes recibidos por la red. Lo que llega por WebSocket es
// dato externo: un `as PeerMsg` no lo valida. Estas funciones devuelven el
// mensaje tipado sólo si cumple el contrato; si no, null y se descarta.
import type { HostMsg, PeerMsg, SfxName } from './protocol.ts';
import type { Phase, PublicState } from '../game/types.ts';

const NAME_MAX = 24;
const TEXT_MAX = 4000;
const PHASES = new Set<Phase>(['lobby', 'ready', 'playing', 'open', 'buzzed', 'revealed', 'finished']);
const SFX = new Set<SfxName>(['buzz', 'correct', 'wrong', 'hum', 'reveal', 'start', 'tick', 'finish']);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const optStr = (v: unknown, max = 200) => v === undefined || isStr(v, max);
const strArr = (v: unknown, max = 64) => Array.isArray(v) && v.length <= max && v.every((x) => isStr(x, 64));

/** Mensaje de jugador o pantalla, ya relayado por el servidor. */
export function parsePeerMsg(d: unknown): PeerMsg | null {
  if (!isObj(d)) return null;
  switch (d.k) {
    case 'hello':
      if ((d.role !== 'player' && d.role !== 'screen') || !isStr(d.name)) return null;
      return { k: 'hello', role: d.role, name: d.name.trim().slice(0, NAME_MAX) };
    case 'rename':
      if (!isStr(d.name)) return null;
      return { k: 'rename', name: d.name.trim().slice(0, NAME_MAX) };
    case 'buzz':
      if (!isNum(d.at)) return null;
      return { k: 'buzz', at: d.at, localAt: isNum(d.localAt) ? d.localAt : d.at };
    default:
      return null;
  }
}

function isPublicState(s: unknown): s is PublicState {
  if (!isObj(s)) return false;
  if (!PHASES.has(s.phase as Phase)) return false;
  if (!Array.isArray(s.players) || s.players.length > 16) return false;
  for (const p of s.players) {
    if (!isObj(p) || !isStr(p.id, 64) || !isStr(p.name, 64) || !isStr(p.color, 32) || !isNum(p.score) || typeof p.connected !== 'boolean') return false;
  }
  for (const k of ['trackIndex', 'trackCount', 'step', 'stepMs', 'stepCount'] as const) if (!isNum(s[k])) return false;
  if (!strArr(s.lockedPlayerIds)) return false;
  if (s.queuedPlayerIds !== undefined && !strArr(s.queuedPlayerIds, 16)) return false;
  if (s.answersClosed !== undefined && typeof s.answersClosed !== 'boolean') return false;
  if (!optStr(s.buzzedPlayerId, 64) || !optStr(s.solvedBy, 64) || !optStr(s.notice, TEXT_MAX)) return false;
  if (typeof s.finished !== 'boolean') return false;
  if (s.revealed !== undefined) {
    // Títulos de Spotify pueden ser muy largos (obras clásicas): límites holgados,
    // sólo para frenar basura. Rechazar acá congelaría a todos los celulares.
    const r = s.revealed;
    if (!isObj(r) || !isStr(r.name, TEXT_MAX) || !isStr(r.artists, TEXT_MAX) || !isStr(r.album, TEXT_MAX) || !optStr(r.image, TEXT_MAX)) return false;
  }
  if (s.lastEvent !== undefined) {
    const e = s.lastEvent;
    if (!isObj(e) || !isStr(e.kind, 16) || (e.reactionMs !== undefined && !isNum(e.reactionMs))) return false;
  }
  if (s.awards !== undefined) {
    if (!Array.isArray(s.awards) || s.awards.length > 16) return false;
    if (!s.awards.every((a) => isObj(a) && isStr(a.k) && isStr(a.v) && isStr(a.sub))) return false;
  }
  if (s.final !== undefined) {
    const f = s.final;
    if (!isObj(f) || !strArr(f.winnerIds, 16) || !Array.isArray(f.ranking) || f.ranking.length > 16) return false;
    if (!f.ranking.every((r) => isObj(r) && isStr(r.id, 64) && isNum(r.position) && isNum(r.score) && isNum(r.correct))) return false;
  }
  return true;
}

/** Mensaje del juez hacia un jugador o pantalla. */
export function parseHostMsg(d: unknown): HostMsg | null {
  if (!isObj(d)) return null;
  switch (d.k) {
    case 'state':
      return isPublicState(d.state) && isNum(d.serverNow) ? (d as unknown as HostMsg) : null;
    case 'welcome':
      return isStr(d.playerId, 64) && isStr(d.name, 64) && isStr(d.color, 32)
        ? { k: 'welcome', playerId: d.playerId, name: d.name, color: d.color }
        : null;
    case 'rejected':
      return isStr(d.reason) ? { k: 'rejected', reason: d.reason } : null;
    case 'waiting':
      return isStr(d.reason) ? { k: 'waiting', reason: d.reason } : null;
    case 'sfx':
      return SFX.has(d.name as SfxName) && optStr(d.playerId, 64)
        ? { k: 'sfx', name: d.name as SfxName, playerId: d.playerId as string | undefined }
        : null;
    default:
      return null;
  }
}

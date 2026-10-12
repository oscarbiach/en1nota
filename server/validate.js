// Validación de mensajes WebSocket. Cada función devuelve una copia saneada
// con sólo los campos conocidos, o null si el mensaje no cumple el contrato.
// El servidor nunca reenvía lo que recibió tal cual.

export const NAME_MAX = 24;
const ID_RE = /^[a-f0-9]{8,32}$/;
const SECRET_RE = /^[a-f0-9]{16,64}$/;
const ROOM_RE = /^[A-Za-z]{4}$/;
const HOST_KINDS = new Set(['state', 'welcome', 'rejected', 'waiting', 'sfx']);

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Nombre visible: sólo texto, recortado. Cualquier otro tipo es ''. */
export function cleanName(v) {
  return typeof v === 'string' ? v.trim().slice(0, NAME_MAX) : '';
}

export function cleanRoom(v) {
  return typeof v === 'string' && ROOM_RE.test(v) ? v.toUpperCase() : null;
}

export const isId = (v) => typeof v === 'string' && ID_RE.test(v);
export const isSecret = (v) => typeof v === 'string' && SECRET_RE.test(v);
/** Clave de juez: nonce de 16 hex + firma de 32 hex. */
export const isKey = (v) => typeof v === 'string' && /^[a-f0-9]{48}$/.test(v);

/**
 * Mensaje de jugador/pantalla hacia el juez.
 * @param {unknown} data
 * @param {'player'|'screen'} role rol registrado de esa conexión
 */
export function peerData(data, role) {
  if (!isObj(data) || typeof data.k !== 'string') return null;
  switch (data.k) {
    case 'hello':
      if (data.role !== role) return null; // nadie se declara con otro rol
      if (typeof data.name !== 'string') return null;
      return { k: 'hello', role, name: cleanName(data.name) };
    case 'buzz':
      if (role !== 'player' || !isNum(data.at)) return null;
      return { k: 'buzz', at: data.at, localAt: isNum(data.localAt) ? data.localAt : data.at };
    case 'rename':
      if (role !== 'player' || typeof data.name !== 'string') return null;
      return { k: 'rename', name: cleanName(data.name) };
    default:
      return null;
  }
}

/**
 * Mensaje del juez hacia jugadores/pantallas. El juez está autenticado con la
 * clave de la sala; acá sólo se exige la forma básica y un tipo conocido. Los
 * clientes validan el contenido en detalle.
 */
export function hostData(data) {
  if (!isObj(data) || typeof data.k !== 'string' || !HOST_KINDS.has(data.k)) return null;
  return data;
}

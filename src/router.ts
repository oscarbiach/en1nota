// Rutas por hash (#/juez, #/jugar?sala=…). Aparte de App para que las
// pantallas puedan navegar sin importar App (que a su vez las importa).

export interface Route {
  path: string;
  params: URLSearchParams;
}

export function parseHash(): Route {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, q = ''] = h.split('?');
  return { path, params: new URLSearchParams(q) };
}

export function navigate(to: string) {
  location.hash = to;
}

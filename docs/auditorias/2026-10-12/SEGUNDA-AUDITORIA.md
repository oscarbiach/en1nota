# En 1 Nota — verificación de correcciones y pendientes

12 de octubre de 2026. Repositorio: https://github.com/oscarbiach/en1nota

**Resultado:** las correcciones A01–A12 superaron sus pruebas de regresión en esta revisión. También pasó una partida completa en el sitio publicado. Al avanzar sobre los pendientes se confirmaron **9 hallazgos adicionales**, con distintos niveles de prueba: navegador, componentes reales con simulaciones y análisis automático. No se afirma que sean regresiones introducidas por Claude; varios ya estaban señalados como riesgos.

**Decisión previa a ampliar el producto:** la integración de Spotify tiene una incompatibilidad con el uso como juego. Esta limitación faltaba en la primera auditoría y debe tenerse en cuenta antes de invertir en un acceso público con cuentas individuales.

## 1. Versión y despliegue verificados

- Rama: `claude/music-recognition-game-5vz0p8`.
- Commit: `08bd7263f2d25eddb231d109c1670615ae212e91`.
- [Código auditado](https://github.com/oscarbiach/en1nota/tree/08bd7263f2d25eddb231d109c1670615ae212e91).
- Sitio encontrado y probado: [En 1 Nota](https://en1nota.onrender.com).
- El despliegue de GitHub `6973453678` apunta al mismo commit y registra éxito el 9 de octubre a las 21:00:34 de Argentina (10 de octubre, 00:00:34 UTC).
- La página publicada respondió HTTP 200 y cargó su aplicación. Se completó la prueba normal con juez, jugador y TV en modo manual.
- La rama predeterminada sigue siendo `claude/mobile-streamer-game-ui03ko`; R01 continúa pendiente. El despliegue comprobado sí apunta a la rama que contiene la app.
- Entorno local: Windows, Node 24.16.0, npm 11.13.0, Edge automatizado mediante Playwright. Accesibilidad automática: axe-core 4.14.0.

Se descargó el código actualizado y se revisaron los cambios pertinentes. No se modificaron archivos versionados, no se hicieron commits ni cambios en GitHub o Render. Las pruebas de seguridad y fallos se ejecutaron exclusivamente en servidores locales. En producción se usó una sala de prueba para un recorrido normal, sin Spotify ni datos reales de participantes.

## 2. Qué se verificó de las correcciones

| Comprobación | Resultado observado |
|---|---|
| Pruebas sin navegador | 47 aprobadas, 0 fallidas |
| TypeScript y compilación de producción | Aprobados |
| Regresiones E2E de la auditoría | 16 aprobadas, 0 fallidas |
| Partida completa original en local | `E2E OK` |
| Partida completa en Render | `E2E OK`; Beto 0, Ana −1; historial correcto |
| `npm audit` completo | 0 alertas en la consulta de esta fecha |
| `npm audit --omit=dev` | 0 alertas en la consulta de esta fecha |
| Actualización real del service worker local | Aviso visible; recarga conservó partida y puntaje |
| Fallo simulado de Spotify Connect | Mensaje de error, fase `open`, botón Sonar habilitado |

Esto verifica los síntomas y escenarios cubiertos. No prueba audio real de Spotify, todos los dispositivos ni todas las condiciones de red.

| ID anterior | Verificación independiente de esta revisión |
|---|---|
| A01 | Cancelar, pulsar y fallar, repetir y evitar timer residual: aprobados en modo manual; contrato Runner aprobado por pruebas |
| A02 | Restauración tras recarga: aprobada; además actualización PWA durante `playing` → `open` |
| A03 | Mensajes malformados y límite de tamaño: pruebas de servidor y navegador aprobadas |
| A04 | Suplantación por ID público rechazada; reconexión legítima aprobada |
| A05 | Reemplazo de juez/jugador y revocación: aprobados |
| A06 | Final anticipado y no duplicación: aprobados |
| A07 | Próximos ocultos en modo mesa: aprobado |
| A08 | Empates consistentes entre juez, TV e historial: aprobado |
| A09 | Enter, Espacio y puntero: aprobados |
| A10 | Reinicio de partida con celulares conectados: aprobado |
| A11 | Selector de reproductor tras recarga: aprobado |
| A12 | Cancelación de reintentos y callbacks viejos: aprobada |
| D01 | Sin alertas en las consultas actuales |
| R01 | Documentado, sin resolver; no bloquea el despliegue actual comprobado |

No se repitió la ejecución de todas las pruebas nuevas contra el commit viejo; esa parte del informe de Claude no se presenta como verificación independiente propia.

## 3. Spotify con la cuenta de cada organizador

### Lo que permite la arquitectura

El código ya implementa autorización OAuth con PKCE: cada persona puede autorizar su propia cuenta y el navegador guarda sus tokens. No hace falta compartir la cuenta de Oscar. Para una experiencia de producto normal, el organizador vería “Conectar con Spotify”; el Client ID sería configuración de la aplicación, no un dato que cada usuario deba buscar. Los demás participantes del juego presencial sólo usarían los pulsadores.

### El límite que cambia la decisión

La política vigente de Spotify, sección III.2, prohíbe crear juegos, incluidos trivias, mediante su plataforma. Usar cuentas Premium individuales no elimina esa restricción. Por tanto, OAuth no resuelve la viabilidad de esta integración para En 1 Nota. [Política oficial](https://developer.spotify.com/policy#iii-some-prohibited-applications).

El acceso de desarrollo tampoco equivale a acceso público sin restricciones; existe un proceso separado de ampliación y revisión. No se verificó la modalidad de la app registrada por el usuario. [Modos de cuota](https://developer.spotify.com/documentation/web-api/concepts/quota-modes).

**Recomendación de producto:** priorizar pulsadores/marcador en modo manual, y evaluar reproducción automática de audio propio o con una licencia que permita ese uso. Cambiar a otra API requiere comprobar sus condiciones y capacidades; no se ha validado un proveedor alternativo. No se retiró ni alteró la integración existente durante esta auditoría.

## 4. Hallazgos adicionales

P1 = alta prioridad para continuidad o integridad de la partida. P2 = corregir en la próxima iteración. Las pruebas simuladas se identifican expresamente.

| ID | Prioridad | Hallazgo | Evidencia |
|---|---|---|---|
| B01 | P1 si se conserva Spotify | El SDK acepta un evento de otra canción | Método real con evento simulado |
| B02 | P1 | Timestamp manipulado puede ganar una pulsación | Servidor local + UI real |
| B03 | P2 | Tiempo de reacción mezcla relojes distintos | Motor real con desfase controlado |
| B04 | P2 | Guardado fallido por cuota queda silenciado | Storage real con excepción simulada |
| B05 | P2 si se conserva Spotify | Importación de un episodio falla por asumir artistas | Cliente API real con respuesta simulada |
| B06 | P2 | Esquema guardado inválido produce un bucle de error | Navegador, JSON sintético |
| B07 | P2 | La página solicita desactivar el zoom móvil | axe-core + HTML |
| B08 | P2 si se conserva Spotify | Fallo transitorio de refresh borra la sesión | Auth real con red simulada |
| B09 | P1 | Reiniciar el servidor rompe el reingreso a la partida | Reinicio real de servidor local aislado |

### B01 — Un evento de otra canción completa la espera del SDK

**Ubicación:** [player.ts:104](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/spotify/player.ts#L104).

Se llamó a `waitPlaying('spotify:track:expected')` y se entregó un estado no pausado de `spotify:track:old`, con posición 90000 ms. La promesa se resolvió aunque el URI no coincidía. La condición usa `URI correcto || !paused`; como los waiters se ejecutan con estados activos, el segundo término deja pasar la canción equivocada.

**Impacto:** puede calcular el tiempo restante del fragmento con la posición de otro tema y pausarlo antes de lo debido. No se midió ese efecto con audio real.

**Tarea:** exigir coincidencia del URI y estado activo, asociar la espera a la operación vigente y retirar waiters al cancelar/expirar. Para repeticiones del mismo tema, comprobar también que el evento corresponde a la nueva reproducción/posición solicitada.

**Aceptación:** eventos ajenos no completan la espera; cancelar y timeout liberan listeners; una reproducción nueva no reutiliza el estado viejo. Evidencia: `runtime.json`, caso B01.

### B02 — El cliente puede adelantar artificialmente su pulsación

**Ubicación:** [host.ts:61](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/net/host.ts#L61), [engine.ts:141](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/game/engine.ts#L141).

**Reproducción local:** dos jugadores registrados; “Primero” envió un buzz con hora actual. Unos 30 ms después, “Segundo” envió otro con una hora adelantada artificialmente hacia el pasado en 1000 ms. La ventana de decisión seguía abierta.

**Observado:** ganó Segundo y apareció una reacción de 0 ms. Ambos mensajes cumplieron la validación nueva porque el tipo era correcto y el desfase admitido es de casi 2 segundos.

**Tarea:** no usar el tiempo libremente declarado por el cliente como autoridad del resultado. Definir un orden confiable en servidor o un mecanismo de compensación acotado y verificado. El timestamp del cliente puede conservarse como diagnóstico.

**Aceptación:** una marca de tiempo manipulada no adelanta al jugador respecto del criterio oficial; probar límites y mensajes repetidos. Esto no exige quitar la protección de identidad implementada en A04. Evidencia: `browser-casos.json`, `timestamp-manipulado.png`.

### B03 — Tiempo de reacción calculado entre relojes diferentes

**Ubicación:** [HostPlay.tsx:36](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/views/HostPlay.tsx#L36), [engine.ts:142](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/game/engine.ts#L142).

`playStartedAt` se guarda con `Date.now()` del juez; el buzz llega en la base temporal del servidor. En el ejemplo controlado, inicio local 10000, servidor adelantado 5000 y reacción real 300: el motor informó **5300 ms**.

**Tarea:** usar una sola base temporal para ambos eventos. Diferenciar reacción desde la orden de reproducción de reacción desde audio realmente audible, que necesita una medición adicional.

**Aceptación:** un desfase de ±5 segundos entre juez y servidor no cambia la reacción calculada del mismo escenario de 300 ms. Evidencia: `runtime.json`, B03.

### B04 — El almacenamiento lleno descarta datos sin informar

**Ubicación:** [store.ts:22](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/storage/store.ts#L22).

Se hizo que `localStorage.setItem` lanzara `QuotaExceededError`. `savePlaylist()` volvió normalmente y la lista no quedó guardada. El catch vacío también afecta a otros guardados realizados por `write()`.

**Tarea:** devolver un resultado o error de guardado; conservar la edición en memoria y mostrar un aviso con una acción útil. No asegurar que partida y puntajes se guardaron si no hay confirmación.

**Aceptación:** con cuota agotada se informa el fallo; el usuario puede exportar o liberar espacio sin perder silenciosamente lo que acaba de preparar. Evidencia: `runtime.json`, B04. No se llenó el almacenamiento real del usuario.

### B05 — Importación de playlist no distingue episodio de canción

**Ubicación:** [api.ts:54](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/spotify/api.ts#L54), [api.ts:157](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/spotify/api.ts#L157).

La respuesta simulada contenía un item `type: 'episode'`, con ID, URI y nombre, sin `artists`. `playlistTracks()` lo pasó a `toTrack()`, que falló al invocar `artists.map`. La API documenta episodios como uno de los tipos posibles; no se consultó una playlist real del usuario. [Referencia oficial](https://developer.spotify.com/documentation/web-api/reference/get-playlists-items).

**Tarea:** comprobar tipo y campos antes de convertir; omitir elementos no musicales con un conteo visible; incluir `type` en la selección de campos si es necesario. Añadir casos de nulos, duplicados y retirados.

**Aceptación:** una playlist mixta importa las canciones válidas sin abortar toda la operación; informa qué omitió. Evidencia: `runtime.json`, B05.

### B06 — El mensaje de recuperación no recupera datos con esquema inválido

**Ubicación:** [store.ts:14](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/storage/store.ts#L14), [Host.tsx:40](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/views/Host.tsx#L40), [ErrorBoundary.tsx](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/components/ErrorBoundary.tsx).

**Reproducir:** guardar `{}` como JSON de `en1nota.game` en un contexto de prueba y abrir el juez. Aparece “Algo falló en esta pantalla”. Tocar Recargar vuelve al mismo error.

**Alcance:** JSON sintácticamente válido pero con esquema inválido. No se comprobó una migración concreta que produzca ese JSON; sí la falta de recuperación ante esa condición.

**Tarea:** validar/versionar datos, migrar los reconocidos y aislar lo inválido. Ofrecer exportar diagnóstico/restablecer sólo la partida afectada, sin borrar automáticamente todas las listas e historial.

**Aceptación:** una entrada incompleta o antigua no bloquea indefinidamente la app y se informa qué se recuperó. Evidencia: `persistencia-invalida.png`, `browser-casos.json`.

### B07 — Zoom móvil deshabilitado en el HTML

**Ubicación:** [index.html:5](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/index.html#L5).

El meta viewport contiene `user-scalable=no`. axe-core señaló `meta-viewport` en inicio y panel Spotify. Algunos navegadores pueden ignorar esa instrucción, por lo que no se afirma que todos los dispositivos bloqueen el gesto.

**Tarea:** permitir zoom y verificar que los controles sigan siendo utilizables con ampliación. La prueba automática dejó contraste como revisión incompleta; no se certifica conformidad WCAG.

**Aceptación:** sin restricción explícita de zoom, controles operables al ampliar y revisión manual de foco, nombres accesibles y contraste. Evidencia: `accesibilidad.json`.

### B08 — Una caída de red durante refresh borra credenciales válidas

**Ubicación:** [auth.ts:130](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/spotify/auth.ts#L130).

Con access token vencido y refresh token de prueba presente, se simuló una excepción de red en `fetch`. `getAccessToken()` borró todo el token almacenado. La sesión se pierde aunque el servidor no haya rechazado las credenciales.

**Tarea:** distinguir fallos transitorios de rechazo permanente de autorización; conservar el refresh token ante offline/5xx y permitir reintento controlado. No confundirlo con aceptar credenciales revocadas.

**Aceptación:** una desconexión temporal no obliga a reconectar la cuenta; un rechazo definitivo sí actualiza la UI y elimina la sesión según corresponda. Evidencia: `auth.json`. Sólo se usaron tokens ficticios y fetch simulado.

### B09 — Reiniciar el servidor deja los jugadores fuera de la partida restaurada

**Ubicación:** [server/index.js](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/server/index.js), [Host.tsx:80](https://github.com/oscarbiach/en1nota/blob/08bd7263f2d25eddb231d109c1670615ae212e91/src/views/Host.tsx#L80).

**Reproducir:** iniciar juez y celular en un servidor local aislado, comenzar la partida y reiniciar ese proceso. No se reinició Render.

**Observado:** el juez mantuvo su partida en fase `ready`, pero recibió otro código de sala. El celular mostró “Esa sala no existe”. Al abrir el nuevo código, recibió “La partida ya empezó”. Las identidades y secretos originales desaparecieron con el mapa de salas en memoria.

**Tarea:** definir recuperación ante reinicio del backend. Opciones: persistir de forma segura sala/identidades, o implementar una reincorporación explícita aprobada por el juez que conserve los puntajes. No resolverlo permitiendo retomar un ID sin secreto, porque reabriría A04.

**Aceptación:** tras reiniciar backend, los participantes pueden retomar sus puestos mediante un flujo seguro y comprensible; el juez no queda con jugadores irrecuperables. Evidencia: `reinicio.json`, `reinicio-servidor.png`.

## 5. Pendientes anteriores: avance concreto

| Pendiente original | Estado nuevo |
|---|---|
| Riesgo 1, verificación del tema SDK | Reproducido en componente: B01 |
| Riesgo 2, error al reproducir | Recuperación aprobada con HTTP 500 simulado; audio real pendiente |
| Riesgo 3, relojes/manipulación | Reproducidos B02 y B03 |
| Riesgo 4, recursos del servidor | Hay límite nuevo de 64 KB y manejo de errores; límites de cantidad/frecuencia siguen pendientes |
| Riesgo 5, almacenamiento/esquemas | Reproducidos B04 y B06 |
| Riesgo 6, respuestas de Spotify | Reproducido B05 con respuesta simulada; cobertura de API real pendiente |
| Riesgo 7, accesibilidad | B07 confirmado; revisión completa pendiente |
| URL publicada | Encontrada y partida normal aprobada |
| Actualización service worker | Probada instalación/aviso/activación local durante partida |
| Reinicio del backend | Probado; B09 confirmado |
| Spotify real y dispositivos físicos | Sin sesión real disponible en el entorno de pruebas; no ejecutado |

### Detalle de la prueba PWA

Se modificaron sólo los bytes del service worker compilado local con un comentario de prueba, sin cambiar código funcional. Se esperó a que el navegador instalara la nueva versión y mostrara el aviso de actualización. Con la partida en `playing` y Ana con 1 punto, se pulsó Recargar. Conservó el ID y el puntaje, pasó a `open` y habilitó Sonar. El archivo original se restauró al terminar. Esto prueba el ciclo del navegador con la versión actual, no una migración de esquema entre versiones diferentes ni la política de caché de un futuro despliegue real.

### Recursos y carga

Se inspeccionó el servidor: hay límite de tamaño por mensaje, pero no se encontró un límite aplicativo de salas, registros de participantes ni frecuencia de mensajes. No se realizó saturación ni se cuantificó capacidad. Antes de abrirlo a muchos usuarios, definir límites, limpieza de participantes rechazados/desconectados y métricas operativas. Un máximo de ocho jugadores en la UI no equivale a un límite de conexiones del servidor.

## 6. Siguiente trabajo recomendado

1. **Definir la fuente de audio del producto.** Resolver primero la dependencia de Spotify para el uso como trivia. La arquitectura de cuentas individuales por sí sola no elimina el bloqueo de plataforma.
2. **Corregir continuidad e integridad:** B09 y B02; luego B03, B04 y B06.
3. **Mejorar accesibilidad:** B07 y revisión manual de los controles.
4. **Si se conserva código de Spotify para un uso permitido,** corregir B01, B05 y B08 con simulaciones reproducibles antes de invertir en pruebas de audio reales.
5. **Rama canónica, límites y operación:** resolver R01 con el dueño del repo; documentar despliegue, recuperación, límites y migraciones.

El usuario confirmó que tiene Premium y cree haber conectado la cuenta. Eso no implica que esta auditoría haya accedido a su sesión. No se solicitaron contraseñas ni se usaron credenciales reales.

## 7. Evidencias y límites del paquete

`evidencias/` contiene resultados JSON, capturas y el registro de la partida en producción. `pruebas/` contiene los scripts de investigación y cómo ejecutarlos. Los scripts registran observaciones; no todos fallan automáticamente cuando encuentran un defecto. Claude debe convertirlos en regresiones con aserciones del comportamiento esperado.

Esta revisión amplía la auditoría; no garantiza ausencia de otros errores. No se ejecutaron carga masiva, pruebas físicas de iOS/Android, mediciones reales de audio ni una evaluación completa de accesibilidad. No se implementaron los cambios nuevos: el entregable está preparado para continuar con Claude.

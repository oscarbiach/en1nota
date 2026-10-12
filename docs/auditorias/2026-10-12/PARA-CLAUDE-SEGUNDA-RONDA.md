# Segunda ronda para Claude

Partí de `claude/music-recognition-game-5vz0p8`, commit auditado `08bd7263f2d25eddb231d109c1670615ae212e91`. Contrastá cualquier cambio posterior. Leé `SEGUNDA-AUDITORIA.md`, `evidencias/` y `pruebas/`.

Las 47 pruebas sin navegador, 16 E2E, compilación, partida completa local y partida completa publicada fueron verificadas. A01–A12 quedan validados dentro de esos escenarios; no rehagas esas correcciones. También se probó actualizar realmente el service worker local durante un fragmento, conservando partida y puntaje.

Hay una decisión de producto previa: Spotify prohíbe juegos/trivias en su Developer Policy III.2. El dueño preguntó si cada organizador puede conectar su propia cuenta. OAuth permite cuentas individuales, pero no elimina esa restricción. No presentes esa función como solución lista para publicar ni pidas a cada usuario crear un Client ID. Planteá modo manual independiente y audio propio/licenciado; cambiar a otro proveedor requiere verificarlo. No retires funcionalidades existentes ni cambies de proveedor sin una decisión del dueño.

Orden sugerido de correcciones independientes de Spotify:

1. B09: recuperación segura tras reinicio del servidor. Hoy el juez obtiene sala nueva, el celular pierde la vieja y al entrar en la nueva lo rechazan por partida empezada. No reabrir la suplantación de A04.
2. B02/B03: autoridad del orden de pulsación y única base temporal. Se reprodujo que un segundo jugador gana enviando un timestamp 1 segundo anterior; el cálculo de reacción mezcla reloj local y servidor.
3. B04/B06: informar fallos de almacenamiento, validar/versionar datos y ofrecer recuperación útil. No borrar todas las listas e historial automáticamente.
4. B07: permitir zoom y completar revisión de accesibilidad.
5. Riesgo de recursos: límites de salas/conexiones/frecuencia, limpieza y observabilidad. No hacer pruebas de carga sobre producción.

Si se decide conservar los componentes de Spotify para un uso permitido, quedan B01 (evento de otro tema aceptado), B05 (episodios en playlist) y B08 (offline al refrescar borra sesión). Las reproducciones son controladas; no se usó Spotify real. El manejo del HTTP 500 de reproducción en HostPlay sí pasó la prueba simulada.

Convertí las observaciones de los scripts en pruebas de regresión con aserciones. Por cada bloque indicá ID, cambio, prueba, resultado y lo que sigue pendiente. Conservá las 47 pruebas y 16 E2E existentes y verificá el flujo completo al cerrar. No marques dispositivos reales, carga, audio real ni migraciones PWA entre versiones como comprobados si no se ejecutaron.

R01 sigue pendiente: la rama predeterminada sólo tiene investigación. El despliegue comprobado en https://en1nota.onrender.com sí apunta a la rama de la app. Documentá la propuesta de rama canónica sin cambiar remotos ni despliegue por tu cuenta.

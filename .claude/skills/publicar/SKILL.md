---
name: publicar
description: Publica En 1 Nota en producción (Render) subiendo la rama que despliega. Solo se usa cuando el usuario pide publicar o subir y lo confirma para ese cambio.
disable-model-invocation: true
argument-hint: "[qué se publica]"
---

<reglas>
- Se publica solo con la aprobación explícita del usuario para este cambio; una aprobación anterior no cubre la de hoy.
- Publicar = `git push` a `claude/music-recognition-game-5vz0p8`: es la rama predeterminada en GitHub y Render despliega solo cada push (autoDeploy). No existe un paso de publicación aparte.
- Nunca push forzado ni cambios de remotos, rama predeterminada o configuración de Render: eso lo decide y lo hace el dueño.
- Contra producción solo se consulta `GET /healthz`; nada de pruebas de carga ni maliciosas.
</reglas>

<pasos>
1. Validación y pruebas al día (skill pruebas-app) y commit hecho.
2. Respaldo: anotá en status.md el commit que está publicado ahora (`git rev-parse origin/claude/music-recognition-game-5vz0p8`), para poder volver atrás.
3. Publicar: `git push -u origin claude/music-recognition-game-5vz0p8`. Si falla por red, reintentá hasta 4 veces esperando 2, 4, 8 y 16 segundos.
4. Confirmar: el despliegue tarda unos 5 minutos. Consultá `curl -s https://en1nota.onrender.com/healthz` y verificá `"ok":true`. Si la red de la sesión rechaza la conexión, pedile al usuario que abra esa dirección en su navegador y te pegue lo que ve, o que mire el estado "Live" en el panel de Render.
5. Anotar en status.md qué se publicó, el commit anterior y cómo volver atrás (en Render: Events → Rollback al despliegue anterior; o `git revert` del commit y push). Avisar al usuario que recargue la página y toque "Actualizar" en el aviso "Hay una versión nueva".
</pasos>

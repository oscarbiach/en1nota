# Controles, subagentes y skills para agentes

- Objetivo: aplicar la guía «Guía para replicar: skills, subagentes y controles de Claude Code» a En 1 Nota.
- Rama: `claude/music-recognition-game-5vz0p8`.
- Cambios: `AGENTS.md`, `CLAUDE.md`, `status.md`, `.claude/settings.json`, `.claude/hooks/*.cjs`, `.claude/scripts/validate.mjs`, `.claude/agents/*.md`, `.claude/skills/{pruebas-app,publicar}`; el navegador de las pruebas E2E queda sin salida a internet (`test/e2e/helpers.mjs`).
- Pruebas: cada hook con un caso que bloquea y uno que pasa; validación, unitarias y E2E completas.
- No aplicado: hook de base de datos (no hay base) y skills de terceros del catálogo (ver el resumen al dueño).
- Hallazgo: los hooks se activaron en la misma sesión apenas se guardó `.claude/settings.json`. El guard de Bash frenó un mensaje de commit que nombraba `pkill -f`; ahora solo mira comandos en posición de ejecución.
- Siguiente paso: que el dueño confirme el push.

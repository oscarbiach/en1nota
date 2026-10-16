@AGENTS.md

## Subagentes y costo
- `Explore` (Haiku, solo lectura): ubicar archivos, funciones y líneas, o resumir logs y salidas de pruebas. Pedidos acotados: qué buscar y en qué carpeta.
- `sonnet-coder` (Sonnet): cambios de varios archivos con una especificación concreta ya decidida; deja el cambio validado, sin commit ni push.
- La sesión principal decide, depura, revisa, hace los commits y todo lo que pide confirmación. Los cambios chicos los hace ella: delegar también cuesta.
- Subagentes en esfuerzo low o medium. Archivos de más de 1500 líneas, por partes (lo controla un hook).
- Escrituras en GitHub dosificadas: nada de decenas de commits, comentarios o issues seguidos.

## Skills propias
- `pruebas-app`: correr validación y pruebas y resumir. `/publicar`: push a la rama que despliega Render, solo con confirmación del usuario.

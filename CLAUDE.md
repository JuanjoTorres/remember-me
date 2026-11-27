# Arquitectura y Reglas del Proyecto: remember.me

## 1. Visión del Producto y Dominio
- **Nombre de marca:** `kardoo.me` (definido una sola vez en `apps/web/src/features/shared/brand.ts`). El proyecto nació como `remember.me`; ese nombre se conserva solo en identificadores internos: repositorio, scope `@remember-me/*`, base de datos y bucket local.
- **Concepto:** Plataforma mobile-first de regalos digitales interactivos mediante código QR. El creador diseña una experiencia inmersiva tipo *Instagram Stories* con fotos, mensajes, notas de voz y una pregunta trivia opcional, culminando en una revelación sorpresa interactiva (efecto *rasca y gana*, billete de viaje o caja regalo).
- **Estructura de URLs del QR:** Rutas humanas y confiables bajo `/for/[slug]` (ej. `kardoo.me/for/sarah-x9k2bd7m`). Todo slug termina en un sufijo alfanumérico: 8 caracteres aleatorios en los generados y al menos 4 en los personalizados (extra de pago). Los enlaces no deben poder descubrirse probando combinaciones: la API limita por cliente los enlaces inexistentes que se abren y las comprobaciones de disponibilidad (decisión del propietario, 2026-11-24). Las páginas de regalo nunca se indexan.
- **Reglas de negocio (decisión del propietario, 2026-11-24):**
  - **Edición libre, pago único al publicar:** un borrador puede usar cualquier función (tarjetas ilimitadas, notas de voz, trivia, plantillas premium) sin bloqueos ni redirecciones a Stripe; las opciones de pago se marcan con la insignia `PRO`. El único muro de pago está al publicar desde la vista previa (`/create/[giftId]/preview`): sin funciones `PRO` se publica gratis con marca de agua; con ellas se abre `PremiumUpgradeSheet` (pago único, con el enlace personalizado como order bump opcional) y el pago publica el regalo.
  - **Anti-reutilización:** al publicar queda fijado el nombre del destinatario; el resto se puede corregir durante 48 horas. Lo que caduca a las 48 horas es el enlace de edición (decisión del propietario, 2026-11-27): quien lo abre después encuentra el regalo bloqueado y sus ediciones devuelven `GIFT_LOCKED`, pero quien lo abrió dentro del plazo y sigue editando conserva sus guardados mientras su sesión siga activa. Cómo termina esa sesión lo eligió la implementación y está pendiente de decisión del propietario: se renueva con cada respuesta, termina tras 30 minutos sin peticiones y no sobrevive a recargar la página. El borrado irreversible (con doble confirmación `DELETE` / `BORRAR`) siempre está disponible y elimina también los archivos en R2.
  - **Caducidad:** borradores, 7 días desde su creación; regalos gratuitos, 3 meses desde su publicación (decisión del propietario, 2026-11-27; antes 1 año); regalos de pago, nunca. Un cron diario en `apps/api` elimina los vencidos con sus archivos. Staging puede perder regalos antiguos al desplegar un cambio de caducidad: mientras no haya producción es indiferente (decisión del propietario, 2026-11-27).
  - **Email de aniversario (desactivado, deuda técnica; decisión del propietario, 2026-11-27):** la idea es enviar un único email al comprador un año después de publicar un regalo de pago (el email llega en `PaymentSucceededEvent`). El código existe pero el trabajo no está programado; lo que falta para activarlo está en `.claude/skills/backend/references/gifts.md`.
  - Los plazos y límites viven solo en `packages/shared-types` (`plans.ts`, `lifecycle.ts`, `slug.ts`); el detalle está en `.claude/skills/backend/references/gifts.md`.

## 2. Stack y Estructura del Monorepo
- **Monorepo:** `pnpm workspaces` + `Turborepo` bajo la carpeta raíz `remember-me/`.
- **Frontend (`apps/web`):** Next.js (App Router), TypeScript estricto, Tailwind CSS, Framer Motion, TanStack Query, `canvas-confetti`.
- **Backend (`apps/api`):** NestJS, TypeScript estricto, Prisma ORM sobre PostgreSQL.
- **Contratos (`packages/shared-types`):** Zod para esquemas de validación y generación de tipos (`z.infer`) compartidos entre front y back.
- **Infraestructura:** Preparado para desplegar `apps/web` y `apps/api` en pods Docker independientes (Kubernetes / Cloud).

## 3. Reglas de Arquitectura del Backend (`apps/api`)
- **Monolito Modular estricto:** Módulos independientes: `gifts`, `media`, `qr` y `payments`.
- **Prohibido el acoplamiento directo entre módulos:** Ningún módulo puede importar servicios ni repositorios internos de otro módulo.
- **Aislamiento del módulo `payments` (preparado para futura extracción a microservicio/pod independiente):**
  1. Sin `FOREIGN KEY` en Prisma/PostgreSQL entre `payment_orders` y `gifts` (solo campo `giftId: String` sin relación `@relation`).
  2. Comunicación exclusivamente por eventos usando una interfaz `EventBus` abstraída (implementación local con `@nestjs/event-emitter` seleccionada vía variable de entorno `EVENT_BUS_DRIVER=memory|redis`).
  3. El webhook de Stripe en `payments` emite `PaymentSucceededEvent` (con el `customerEmail` del comprador); el módulo `gifts` se suscribe para activar `isPremium = true`, quitar la caducidad y publicar el regalo.
  4. Idempotencia obligatoria en webhooks guardando `eventId` en la tabla `payment_webhook_logs`.
- **Multimedia y QR:** Optimización de imágenes a WebP con `sharp`, subida de imágenes y audios (M4A/MP3) a almacenamiento compatible S3 (**Cloudflare R2**), y generación de códigos QR dinámicos apuntando a `<WEB_ORIGIN>/for/[slug]` (en producción `https://kardoo.me/for/[slug]`).

## 4. Reglas de Arquitectura del Frontend (`apps/web`)
- **Feature-Sliced / Feature-Based (`src/features/`):** `gift-creator`, `gift-experience`, `gift-reveal`, `checkout` y `shared/`.
- **Ruta crítica del QR (`app/for/[slug]`):**
  - Layout aislado a pantalla completa (`100dvh`), ultra ligero; prohibido importar componentes del editor (`gift-creator`) o librerías de Stripe aquí.
  - Precarga en segundo plano (`usePreloadMedia`) de imágenes y audios de las tarjetas siguientes mientras el usuario visualiza la actual.
  - Compresión de imágenes en cliente antes de subirlas desde `gift-creator`.
  - Flujo de creación sin registro obligatorio inicial (se captura el email en Stripe Checkout).
  - El token de edición viaja en el fragmento de la URL o en el almacenamiento del navegador y se envía en la cabecera `x-edit-token`; nunca forma parte de la ruta de una página ni de un endpoint.
- **Entornos:** Diferenciar `NEXT_PUBLIC_API_URL` (navegador móvil) e `INTERNAL_API_URL` (comunicación interna SSR entre pods).

## 5. Convenciones de Código y Calidad
- Todas las variables de entorno (`development`, `staging`, `production`) deben validarse estrictamente al arrancar con Zod en `src/config/env.ts` de cada app.
- Usar siempre `pnpm` como gestor de paquetes (`pnpm --filter api ...`, `pnpm --filter web ...`).
- Antes de dar por finalizada cualquier tarea, ejecutar y verificar que `pnpm typecheck` y `pnpm build` pasan sin errores, y pasar la revisión obligatoria de la sección 7.

## 6. Skills por área y documentación viva
El conocimiento detallado del repo vive en `.claude/skills/<área>/`: un `SKILL.md` corto con las reglas del área y una tabla que dirige a **una** referencia por tipo de cambio (`references/*.md`). Este archivo solo contiene las reglas globales.

| Si vas a tocar… | Skill | Ejemplos de referencias |
| --- | --- | --- |
| `apps/api/**`, `packages/shared-types/**` | `backend` | `endpoints.md`, `payments.md`, `events.md`, `database.md`, `contracts.md`, `config-env.md` |
| `apps/web/**` | `frontend` | `routes.md`, `gift-creator.md`, `checkout.md`, `gift-experience.md`, `i18n-and-brand.md`, `ui-system.md` |
| `deploy/**`, `.github/**`, `scripts/**`, `compose.yaml`, Dockerfiles, `docs/deploy.md`, o cualquier operación en un servidor | `ops` | `environments.md`, `pipeline.md`, `stack.md`, `operations.md`, `local.md` |

- **Cargar antes de editar:** antes de modificar un archivo de un área hay que cargar su skill y abrir solo la referencia que corresponde al cambio. El hook `.claude/hooks/skill-gate.mjs` (configurado en `.claude/settings.json`) rechaza la edición si la skill no se ha cargado en la sesión. Un cambio que cruza áreas (p. ej. un endpoint nuevo y su pantalla) carga las dos.
- **Contexto mínimo:** no leer todas las referencias "por si acaso". Para explorar, usar la tabla del `SKILL.md`; para un cambio, la referencia indicada y los archivos que esta señala.
- **Son documentos vivos:** las referencias forman parte del código. Si un cambio añade, elimina, renombra o altera algo que una referencia describe (endpoint, evento, tabla, variable de entorno, código de error, contrato, ruta, componente compartido, mensaje, job del pipeline, servicio, tarea programada…), se actualiza esa referencia **en el mismo commit**.
- **Decisiones del propietario:** cuando el propietario diga "esto se hace así", se anota en la referencia correspondiente bajo `## Decisions` con la fecha, y si es una regla global, también aquí.
- **Si la referencia y el código discrepan, manda el código:** se corrige la referencia y se avisa.
- **Parte nueva del sistema:** si aparece un módulo, feature o pieza de infraestructura que ninguna referencia cubre, se crea su referencia y se añade a la tabla del `SKILL.md`; si aparece un área nueva, se crea su skill y se añade su ruta al hook.
- **Verificación:** `pnpm check:docs` falla si una skill o una definición de agente (`.claude/skills`, `.claude/agents`) nombra un archivo que ya no existe. Se ejecuta en CI y forma parte de las comprobaciones finales junto con `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` y `pnpm test`.
- Las skills y referencias se escriben en inglés, como el resto del repositorio.

## 7. Revisión obligatoria tras cada cambio
Ningún cambio se da por terminado, ni se abre su pull request, sin la comprobación que le corresponde según lo que toca (decisión del propietario, 2026-11-24):

- **Cambio solo de documentación** (únicamente Markdown: `docs/**`, `README.md`, `CLAUDE.md`, `.claude/skills/**`, `.claude/agents/**`): basta con `pnpm format:check` y `pnpm check:docs`. No requiere `pnpm verify` ni agente `reviewer`.
- **Cambio de código** (cualquier otra cosa: `apps/`, `packages/`, `scripts/`, `deploy/`, `.github/`, Dockerfiles, archivos compose y configuración como `package.json`, `turbo.json`, el lockfile, `.claude/hooks` o `.claude/settings.json`): revisión completa, sea del tamaño que sea. Un cambio que mezcla código y documentación es un cambio de código.

La revisión completa:

- **La hace el agente `reviewer`** (`.claude/agents/reviewer.md`): un agente nuevo, sin el contexto de quien escribió el cambio. Se le da la rama base y una frase con lo que el cambio pretende, no las conclusiones propias.
- **Revisa la aplicación entera, no solo el diff:** ejecuta `pnpm verify` (`scripts/verify.sh`), que pasa formato, documentación, lint, typecheck, build, **todos** los tests unitarios y de integración tres veces seguidas y los flujos de navegador. Se ejecuta completo aunque el cambio sea de una línea.
- **Cambios de infraestructura:** `pnpm verify` no construye las imágenes Docker. Si el cambio toca un Dockerfile, `.dockerignore`, un archivo compose, `deploy/Caddyfile` o cualquier otra cosa que acabe dentro de las imágenes o que use el propio script (un paquete nuevo del workspace, dependencias o el lockfile, migraciones de Prisma, la salida de Next.js, `scripts/smoke.sh`, `scripts/verify-infra.sh`, `deploy/.env.example`), el revisor ejecuta además `pnpm verify:infra` (`scripts/verify-infra.sh`): comprueba la sintaxis del Caddyfile y del compose de producción, construye las tres imágenes, arranca el stack local desde ellas y pasa la prueba de humo. No detecta una variable que falte en el `.env` del servidor, ni demuestra los certificados y el enrutado real de Caddy, ni un workflow de GitHub: eso solo se demuestra en su primera ejecución real; se dice así en el informe y se vigila.
- **Un fallo intermitente es un fallo.** Un test que falla una vez y pasa al repetirlo ha fallado: prohibido relanzar hasta que salga verde, y prohibido darlo por "inestable" sin más. Se investiga hasta encontrar la causa y se arregla el código o el test. Subir un tiempo de espera solo es aceptable si se demuestra que la operación es legítimamente lenta.
- **El CI cuenta igual que la máquina local:** si `pnpm verify` pasa en local pero el CI falla en el mismo commit, hay un defecto que depende de los tiempos o del entorno; se investiga antes de fusionar. Tras fusionar se comprueba también el CI de `main`.
- **Los hallazgos se corrigen y se vuelve a revisar** con un agente `reviewer` nuevo, hasta que el veredicto sea `pass`. Si un hallazgo se decide no corregir, se le explica al propietario y decide él.
- **En el informe final se dice qué revisó el agente y con qué resultado**, incluido cuántas veces corrieron los tests y cualquier cosa que no se pudo comprobar.

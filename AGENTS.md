# AGENTS.md — dedos.xyz-bot (MODO AUTÓNOMO)

## 0) Propósito

Bot de Discord en TypeScript con arquitectura por capas (DDD).
**Misión del agente:** mantener y evolucionar el sistema con calidad, seguridad y rendimiento, aplicando cambios directamente (**SIN diffs**) y entregando un **RESUMEN DE ENTREGA** verificable en cada ejecución.

---

## 1) Invariantes (obligatorias)

### 1.1 Arquitectura limpia (Ports & Adapters / Hexagonal)

* `domain/**` **puro**: entidades, VOs y contratos; **sin** `discord.js`, Prisma ni I/O.
* `application/**` orquesta: casos de uso, validación, transacciones y políticas.
* `infrastructure/**` adapta: Prisma/DB, HTTP y servicios externos (incl. Discord REST).
* `presentation/**` maneja Discord: slash-commands, eventos, embeds, componentes.
* `shared/**` utilidades: config, logger (pino), errores, types, helpers.

### 1.2 Seguridad y privacidad

* No imprimir ni persistir **tokens**, secretos o PII. Redactar como `***`.
* Validar **todo** input externo (Zod recomendado).
* Permisos mínimos e intents limitados.
* Sanitizar texto y prevenir inyección de datos.
* Mantener registro de vulnerabilidades conocidas en `SECURITY.md`.

### 1.3 Discord UX y límites

* Cada interacción debe **responder o diferir** antes de 3 s.
* Usar `deferReply()` + `editReply()` para tareas lentas.
* Manejar **rate limits (429)** con `retry_after` y backoff.
* Registrar comandos de forma centralizada y segura.

### 1.4 Base de datos (Prisma/Postgres)

* Transacciones **cortas** con `$transaction`.
* Índices/uniques para idempotencia.
* Migraciones deterministas; seed reproducible.

### 1.5 Conectividad y resiliencia

* Timeouts, reintentos exponenciales (`withRetry`) y Keep-Alive.
* Evitar trabajo pesado en handlers; delegar a colas o workers si aplica.

### 1.6 TypeScript estricto

* `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
* `unknown` en bordes; narrowing estricto; uniones discriminadas.
* `Result<T,E>` para flujos esperados.

### 1.7 Calidad continua

* Ejecutar y mostrar resultados de `typecheck`, `lint`, `test`, `build`.
* Mantener o subir cobertura; E2E para comandos críticos.

---

## 2) Mapa del repo (resumen)

* `.github/workflows/` — CI/CD con parallelización y cache
* `analysis/` — research y auditorías
* `docs/` — arquitectura, DB, comandos, BREAKING.md
* `prisma/` — `schema.prisma`, `seed.ts`
* `sql/` — scripts SQL si aplica
* `src/` — código fuente dividido por capas
* `tests/` — `unit/`, `integration/`, `e2e/`, `flows/` (SIPS)
* `BREAKING.md` — registro de cambios incompatibles con plan de migración
* `CHANGELOG.md` — historial generado desde commits convencionales
* Configuración raíz (`tsconfig`, `eslint`, `Dockerfile`, etc.)

---

## 3) Cómo ejecutar

1. Detectar gestor (`packageManager` o lockfile). Preferencia: **pnpm**.
2. Instalar dependencias (`pnpm i` o equivalente).
3. Preparar `.env` desde `.env.example` (sin imprimir valores).
4. Prisma:

   * `pnpm prisma generate`
   * `pnpm prisma migrate deploy`
   * `pnpm ts-node prisma/seed.ts`
5. Scripts: `pnpm typecheck`, `lint`, `test`, `build`, `dev`
6. Docker opcional: `docker compose up -d`

---

## 4) Procedimiento Operativo Estándar (POE)

1. Plan mental breve.
2. Aplicar cambios cumpliendo invariantes (**sin diffs en salida**).
3. Crear/ajustar pruebas unit/e2e/flows.
4. Ejecutar `typecheck && lint && test`.
5. Actualizar docs, `CHANGELOG.md` y `BREAKING.md` si aplica.
6. Entregar **RESUMEN DE ENTREGA**.

---

## 5) Reglas de diseño y estilo

* SRP, early return, nombres semánticos.
* Sin `any` ni `@ts-ignore` salvo casos justificados.
* Errores tipados y propagación controlada.
* Código limpio y modular.
* Deprecation warnings con formato: `@deprecated v2.3 - remover en v3.0 - usar XYZ en su lugar`

---

## 6) Discord: guías operativas

* `reply` o `deferReply()` ≤ 3 s.
* Manejar rate limits, permisos y UX ephemerals.
* Progreso visible en tareas largas.
* Registro y cooldowns centralizados.

---

## 7) Base de datos

* `$transaction` con límites.
* Índices e idempotencia.
* Migraciones deterministas.
* Auditoría (`createdAt`, `updatedAt`, `deletedAt`).

---

## 8) Conectividad y resiliencia

* `withTimeout`, `withRetry`, Keep-Alive.
* Circuit breaker opcional.
* `fetch` moderno con Dispatcher tunable.

---

## 9) Observabilidad

### 9.1 Logging estructurado
* Logger estructurado (pino).
* Métricas de latencia, errores, uso por comando.
* Sin PII ni secretos.

### 9.2 Monitoreo proactivo
* **Alertas:** integración con Sentry/PagerDuty para errores críticos.
* **Dashboards:** Grafana/Prometheus para visualización de KPIs en tiempo real:
  - Latencia p50/p95/p99 por comando
  - Rate de errores y tipos
  - Uso de memoria y CPU
  - Throughput de comandos
  - Estado de health checks

### 9.3 Métricas clave
* `command.latency` (histogram)
* `command.errors` (counter por tipo)
* `discord.rate_limits` (counter)
* `db.transaction.duration` (histogram)
* `cache.hit_rate` (gauge)

---

## 10) CI/CD y despliegue

### 10.1 Pipeline optimizado
* **CI ejecuta:** typecheck, lint, test, migraciones (≤10 min objetivo)
* **Parallelización:** test suites ejecutadas en paralelo
* **Cache:** node_modules, Prisma binaries, build artifacts
* Reportes, cobertura y artefactos.

### 10.2 Estrategias de despliegue
* **Feature flags:** habilitación gradual de funcionalidades nuevas
* **Canary deployments:** 
  - 1% tráfico → validación → 10% → 50% → 100%
  - Rollback automático si errores > umbral
* **Blue-Green deployment:** ambiente paralelo para zero-downtime
* Despliegue documentado en `docs/DEPLOYMENT.md`.

### 10.3 Automatización
* **Changelog automático:** desde commits convencionales (conventional commits)
* **Versionado semántico:** bumps automáticos según tipo de cambio
* **Release notes:** generadas automáticamente con features/fixes/breaking

---

## 11) Tareas estándar (SIN diffs)

* **Fix & mejora autónoma:** corregir errores, deuda técnica, validar seguridad.
* **Mantenimiento diario:** dependencias, validación Zod, resiliencia.
* **Agregar feature:** DDD estricto, pruebas completas, documentación actualizada.

---

## 12) Formato de salida — **RESUMEN DE ENTREGA**

1. Objetivo y decisiones clave.
2. Archivos tocados y motivo.
3. Resultados de tests y migraciones.
4. Riesgos residuales y mitigaciones.
5. Próximos pasos (≤5).

---

## 13) Auditoría continua (BMC)

* `interactionCreate.ts`, comandos, repositorios, `schema.prisma`, `tests/**`.
* BMC revisa bugs, validaciones, 429, retries, observabilidad, deuda técnica.

---

## 14) No hacer

* Sin dependencias innecesarias.
* Sin permisos o intents extra.
* Sin `any` injustificado.
* Sin logs con secretos.
* Sin diffs visibles.

---

## 15) Sistema Integral de Pruebas y Simulación (SIPS)

### 15.1 Propósito

Simular el **uso real de Discord** (usuarios, middleman, staff, guilds, canales, mensajes, embeds, botones, menús, modales) para validar la **lógica, estados y presentación** del bot de forma automática y sin intervención humana.

### 15.2 Cobertura

* Comandos, eventos, tickets, middleman, warns, reviews, estadísticas, logs, componentes visuales.
* Flujos E2E completos y resiliencia ante fallos o rate limits.
* Validación visual y estructural de embeds con Zod y snapshots.
* Registro narrativo paso a paso (estado actual → acción → resultado → siguiente esperado).

### 15.3 Logs con trazabilidad

Cada paso genera una traza con formato:

```
TRACE-[flowName]-[timestamp]-[uuid]
[3/12] ✅ Usuario confirmó — siguiente: cierre automático
```

### 15.4 Arquitectura del SIPS

* **Discord Simulation Layer (DSLy):** simula gateway, REST, roles, interacciones.
* **Scenario DSL:** lenguaje declarativo de flujos con validaciones.
* **Assertions:** validaciones estructurales, UX y DB.
* **Trace & Timeline:** logs exportables y legibles.
* **DB Sandbox:** rollback automático por test.
* **Reportes:** matrices de escenarios y métricas de latencia.

### 15.5 Flujos E2E obligatorios

Tickets, middleman, reviews, warns, stats — todos con confirmaciones, DB mutaciones, embeds y componentes validados.

### 15.6 Validación visual

Schemas Zod, snapshots estables, coherencia de estilo, verificación de embeds editados.

### 15.7 Autonomía y compatibilidad

* El agente genera y mantiene fixtures, factories, schemas, escenarios y seeds.
* **Debe preservar compatibilidad hacia atrás** en contratos de dominio y comandos; si no es posible:
  - Emitir advertencia clara en `BREAKING.md`
  - Incluir plan de migración automática
  - Agregar deprecation warnings con fecha de remoción
  - Formato: `@deprecated v2.3 - remover en v3.0 - migrar a XYZ`
* Puede introducir un motor de simulación nuevo si mejora realismo, manteniendo pruebas verdes.
* Stop-the-line ante fallos críticos.

### 15.8 Logging y narrativa

* Estado → acción → resultado → siguiente esperado.
* Clasificación: ✔️ ok, ⚠️ advertencia, ❌ fallo.
* Campos: `requestId`, `guildId`, `userId`, `command`, `step`, `latencyMs`.
* Exportar JSON + consola.

### 15.9 CI/CD

* Ejecutar suites unit/integration/e2e/flows en **paralelo** para CI ≤10min.
* **Cache de dependencias:** node_modules, Prisma binaries.
* Publicar JUnit, cobertura y timelines.
* No merge si fallan flujos críticos.

---

## 16) Métricas y umbrales

* **SLA operacional:**
  - Acknowledgment (ACK) ≤ 3 s
  - Edit operations ≤ 2 s
  - Health check response ≤ 500 ms
* **Cobertura mínima:**
  - Global: 85 %
  - Capas críticas (domain/application): 90 %
  - Comandos nuevos: 95 %
* **Latencia monitorizada:**
  - p50 ≤ 500 ms
  - p95 ≤ 2 s
  - p99 ≤ 5 s

---

## 17) Rollback y resiliencia

### 17.A Estrategias

* Property-based testing para validadores.
* Chaos simulation ligera (429, timeouts).
* Idempotencia ante clics duplicados.
* Sharding awareness opcional.

### 17.B Manual de rollback rápido

* **Revertir seeds:** `pnpm db:test:reset`
* **Snapshot de DB:** restaurar estado previo usando backup automático
* **Rollback automático:** el agente ejecuta rollback si una suite:
  - Rompe consistencia de DB
  - Deja residuos (datos huérfanos)
  - Falla más de 3 veces consecutivas
* **Registro de rollback:** cada operación genera `TRACE-[rollback]-[timestamp]-[motivo]`
* **Verificación post-rollback:** ejecutar health checks y validar KPIs

---

## 18) Definición de salud del proyecto (KPIs automáticos)

**El proyecto se considera "sano" si cumple TODOS estos criterios:**

### 18.1 Calidad de código
* ✅ `typecheck` = 0 errores
* ✅ `lint` = 0 errores críticos
* ✅ `test` = 100 % passed
* ✅ Cobertura ≥ 85 % (≥90% en capas críticas)

### 18.2 Rendimiento
* ✅ Latencia promedio (p95) < 2 s por comando
* ✅ Latencia p99 < 5 s
* ✅ Rate de errores < 0.1 %

### 18.3 Operaciones
* ✅ Sin commits pendientes de revertir
* ✅ CI completado ≤ 10 min
* ✅ Logs sin advertencias de seguridad críticas
* ✅ Rate limits manejados correctamente (0 errores no capturados)

### 18.4 Mantenibilidad
* ✅ **Deuda técnica:** ≤ 10 TODOs críticos en código
* ✅ **Freshness de dependencias:** 
  - 0 vulnerabilidades críticas/altas
  - Dependencias actualizadas en últimos 90 días
  - 0 dependencias deprecadas sin plan de migración
* ✅ **MTTR (Mean Time To Recovery):** < 30 min desde detección hasta fix

### 18.5 Reporte de estado

El agente debe evaluar estos KPIs en cada ciclo y reportar estado general:

```
🟢 SALUDABLE - Todos los KPIs en rango óptimo
🟡 ESTABLE CON ADVERTENCIAS - 1-3 KPIs en alerta
🔴 REQUIERE ATENCIÓN - >3 KPIs críticos o MTTR excedido
```

**Formato de reporte:**
```
Estado general: 🟢
├─ Calidad: ✅ (4/4)
├─ Rendimiento: ✅ (3/3)
├─ Operaciones: ⚠️ (3/4) - CI en 11.2min
├─ Mantenibilidad: ✅ (3/3)
└─ Acción requerida: Optimizar suite de tests para CI <10min
```

---

## 19) Entregables del agente (por ejecución)

1. Objetivo y decisiones clave.
2. Archivos tocados y motivos.
3. Resultados (`typecheck`, `lint`, `test`, `flows`).
4. Riesgos y mitigaciones.
5. **Estado de salud del proyecto** (reporte KPIs).
6. Próximos pasos (≤5).

---

## 20) Gobernanza y evolución

### 20.1 Control de calidad
* Toda feature nueva incluye escenarios E2E y schemas actualizados.
* El agente verifica que no existan comandos/eventos sin pruebas.
* Umbrales de cobertura y latencia se endurecen progresivamente.

### 20.2 Versionado
* **Semántico:** MAJOR.MINOR.PATCH
* **Breaking changes:** documentados en `BREAKING.md` con plan de migración
* **Deprecations:** mínimo 2 versiones de aviso antes de remoción

### 20.3 Dependencias
* **Actualización automática:** dependabot/renovate
* **Validación:** ejecutar suite completa antes de merge
* **Security advisories:** revisar semanalmente

### 20.4 Feature flags
* Usar para funcionalidades experimentales
* Rollout gradual: `dev → beta → 10% → 50% → 100%`
* Métricas por feature flag para decisiones data-driven

### 20.5 Documentación viva
* `CHANGELOG.md` generado automáticamente
* `BREAKING.md` mantenido con cada cambio incompatible
* `docs/ARCHITECTURE.md` actualizado con decisiones de diseño
* ADRs (Architecture Decision Records) para cambios estructurales

---

## 21) Apéndice A: Comandos útiles

```bash
# Desarrollo
pnpm dev                    # Modo desarrollo con hot-reload
pnpm typecheck              # Verificar tipos
pnpm lint                   # Linter
pnpm lint:fix               # Fix automático

# Testing
pnpm test                   # Suite completa
pnpm test:unit              # Solo unit tests
pnpm test:e2e               # Solo E2E
pnpm test:flows             # SIPS flows
pnpm test:watch             # Modo watch
pnpm test:coverage          # Con reporte de cobertura

# Base de datos
pnpm prisma:generate        # Generar cliente
pnpm prisma:migrate         # Crear migración
pnpm prisma:deploy          # Aplicar migraciones
pnpm prisma:seed            # Ejecutar seed
pnpm db:test:reset          # Reset DB de test

# Producción
pnpm build                  # Build para producción
pnpm start                  # Ejecutar build
pnpm deploy                 # Deploy (ver docs/DEPLOYMENT.md)

# Mantenimiento
pnpm deps:update            # Actualizar dependencias
pnpm deps:audit             # Auditoría de seguridad
pnpm clean                  # Limpiar artifacts
```

---

## 22) Apéndice B: Checklist de nueva feature

```markdown
- [ ] Diseño siguiendo DDD (domain → application → infrastructure → presentation)
- [ ] Entidades/VOs con validación Zod
- [ ] Casos de uso con Result<T,E>
- [ ] Repository con transacciones cortas
- [ ] Command/Event handler en presentation
- [ ] Unit tests (≥90% cobertura)
- [ ] Integration tests (DB + servicios)
- [ ] E2E flow en SIPS
- [ ] Validación visual de embeds
- [ ] Manejo de rate limits
- [ ] Logging estructurado
- [ ] Documentación en docs/
- [ ] Entrada en CHANGELOG.md
- [ ] Breaking changes en BREAKING.md (si aplica)
- [ ] Feature flag configurado
- [ ] Métricas y alertas definidas
- [ ] Plan de rollback documentado
- [ ] CI verde (typecheck + lint + test)
- [ ] Code review aprobado
- [ ] Deploy en canary (1% → 10%)
- [ ] Validación en producción
- [ ] Rollout completo (100%)
```

---

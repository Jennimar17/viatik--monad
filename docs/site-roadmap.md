# Roadmap de páginas del sitio

La landing enlaza en el footer a páginas que todavía no existen. Aparecen marcadas **"Soon"**, sin enlace, y están definidas en `footerNav`, en `src/components/site/content/site.ts`. Este documento describe cada una para construirla en etapas futuras: su objetivo, sus secciones y qué contenido de la landing ya sirve.

## Cómo activar una página

1. Crear la ruta dentro de `src/app/(site)/`.
2. En `footerNav`, cambiar `{ label, planned: '/ruta' }` por `{ label, href: '/ruta' }`. Con `typedRoutes: true`, `pnpm typecheck` falla si la ruta no existe, así que no se pueden publicar enlaces rotos.
3. Si la página reemplaza a un enlace del demo (por ejemplo, las tarjetas de casos de uso), actualizar también su `href` en `landing-content.ts`.

## Requisito técnico común

`SiteHeader` usa anchors `#…` que solo funcionan en la home. Antes de la primera subpágina hay que:

- hacer que los anchors de `primaryNav` apunten a `/#…`, o
- dar a las subpáginas su propio header, como hace `chrome/legal-page.tsx`.

Recomendado: un `SitePage` que componga `SiteHeader` (con nav `/#…`) + contenido + `SiteFooter`.

## Piezas reutilizables

- **Previews de producto** (`src/components/site/previews/`): `InvestorPreview`, `AgencyAdminPreview`, `MemberPreview`, `FundingAgreementPreview`, `BudgetPolicyPreview` (se adapta al ancho de su contenedor), `ReconciliationPreview`, `VerifiedDetailsPreview`, `CapitalChart` y `SpendingChart`. Las tres previews de rol ya no se usan en la landing y quedan listas para `/product/*`.
- **Ilustraciones** (`src/components/site/illustrations/`): escenas isométricas que se componen con datos (`IsoScene` + `IsoBoxSpec`). Requieren `<IsoDefs />` una vez por página.
- **Contenido retirado de la landing** (recuperable del commit `b1fec12`):
  - FAQ: "What is a Funding Agreement?", "Payout vs spending allowance", "Can Viatik manage team payments?".
  - La preview de la política de automatización (`AutomationPolicyPreview`, en `sections/automation-section.tsx`).
  - Las listas de 5 puntos de acuerdos y de reconciliación.
  - La sección de principios ("Purpose before payment", "Rules before approval", "Evidence after settlement").

## Fases sugeridas

| Fase   | Páginas                                                                                 | Por qué primero                                                                                                             |
| ------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **F1** | `/monad`, `/learn/settlement`, `/docs`                                                  | Responden a la objeción técnica más común ("¿necesito cripto?") y son el material que pide un jurado o un inversor técnico. |
| **F2** | `/product/funding-agreements`, `/product/budgets`, `/product/ai-agents`, `/use-cases/*` | Profundizan lo que la landing resume y ya tienen previews listas.                                                           |
| **F3** | `/learn/verification`, `/glossary`, `/about`, `/roadmap`, `/brand`, `/contact`          | Soporte y empresa; no bloquean la conversión.                                                                               |

## Fichas

### Product

**`/product/funding-agreements` · Funding agreements** (F2)

- **Objetivo:** que un Investor entienda qué puede programar en un acuerdo.
- **Secciones:**
  - hero con `FundingAgreementPreview`;
  - tipos de liberación (por calendario o por milestone);
  - evidencia y revisión de milestones;
  - pausa de emergencia y devolución de capital;
  - qué ve cada lado.
- **Migra:** los 5 puntos originales de acuerdos y la FAQ "What is a Funding Agreement?".

**`/product/budgets` · Budgets & policies** (F2)

- **Objetivo:** que un Agency Admin vea cómo convierte capital liberado en operación.
- **Secciones:**
  - estructura de cuentas → presupuestos → destinos (`BudgetPolicyPreview` a ancho completo);
  - límites;
  - categorías y destinos aprobados;
  - flujo de excepciones;
  - reconciliación (`ReconciliationPreview`).
- **Migra:** la FAQ sobre pagos al equipo y la de payout vs allowance.

**`/product/ai-agents` · AI Agents** (F2)

- **Objetivo:** mostrar que la automatización tiene presupuesto y freno.
- **Secciones:**
  - política de un agente (recuperar `AutomationPolicyPreview`);
  - proveedores aprobados;
  - límites por operación y diarios;
  - expiración y pausa;
  - registro de decisiones.

### Use cases

Una sola plantilla para las cinco páginas, con contenido en datos (como `useCases` en `landing-content.ts`). Cada página tiene:

- hero con su escena isométrica, en grande;
- el problema de ese tipo de financiador;
- cómo encaja el flujo Commit → Verify;
- el rol de entrada al demo;
- preguntas propias.

| Ruta                           | Rol de entrada | Ángulo                                                |
| ------------------------------ | -------------- | ----------------------------------------------------- |
| `/use-cases/venture-studios`   | Investor       | Varios equipos, tramos por milestone                  |
| `/use-cases/grant-programs`    | Investor       | Pagos contra evidencia de entregables                 |
| `/use-cases/ecosystem-funds`   | Investor       | Liquidación en Monad, transparencia para la comunidad |
| `/use-cases/agencies`          | Agency Admin   | Presupuestos de cliente, proveedores y facturas       |
| `/use-cases/distributed-teams` | Member         | Asignaciones de gasto sin wallets compartidas         |

Al publicarlas, las tarjetas del bento de la landing pasan a enlazar aquí en lugar de al demo.

### Learn

**`/monad` · About Monad** (F1)

- **Objetivo:** explicar en lenguaje de producto qué es Monad y por qué Viatik lo usa.
- **Secciones:**
  - qué es Monad (red EVM de alto rendimiento; mainnet 143, testnet 10143);
  - por qué importa para pagos (finalidad rápida, costo bajo);
  - qué queda en la cadena y qué no;
  - la escena de capas (`MonadLayersScene`) y `LayerGrid`.
- **Nota:** verificar cada dato técnico de Monad contra su documentación oficial antes de publicar.

**`/learn/settlement` · Settlement** (F1)

- **Objetivo:** cómo se mueve el dinero.
- **Secciones:**
  - USDC como unidad de liquidación y USD como unidad que ve el usuario;
  - cuentas embebidas;
  - operaciones patrocinadas (sin gas para el usuario);
  - qué pasa en cada etapa del flujo.

**`/learn/verification` · Verified receipts** (F3)

- **Objetivo:** qué significa "Verified on Monad".
- **Secciones:**
  - qué se registra (hashes de evidencia, eventos);
  - qué no se expone (documentos privados);
  - cómo verificar un recibo (`VerifiedDetailsPreview`, enlace al explorador cuando `siteConfig.explorerUrl` exista).

**`/docs` · Documentation** (F1)

- **Objetivo:** punto de entrada técnico.
- **Secciones:**
  - conceptos (Portfolio, Agency, Funding Agreement, Tranche, Budget, Member, AI Agent);
  - guías por rol;
  - API (`src/data/api-contract.ts` como base);
  - contrato `ViatikLedger`.

**`/glossary` · Glossary** (F3)

- **Objetivo:** definiciones cortas y enlazables.
- **Migra:** las definiciones que salieron de la FAQ.

### Company

| Ruta       | Contenido                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `/about`   | Qué es Viatik, por qué existe, el equipo y su origen en Monad Metropolis.                                                            |
| `/roadmap` | Qué está en el demo, qué viene. Vaults y yield, marcados como opcionales y futuros, como en la FAQ.                                  |
| `/brand`   | Logos de `public/brand/`, paleta (`tokens.css` + paleta iridiscente de `illustrations.css`), tipografías (Archivo, Inter) y escenas. |
| `/contact` | Un formulario que **sí** persista. Necesita el backend en Supabase, porque el waitlist anterior se quitó por no guardar nada.        |

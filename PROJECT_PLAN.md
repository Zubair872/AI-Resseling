# AI Reselling SaaS - Project Plan

## 1. Objective and operating rules

The product will help a tenant discover or import products, prepare listings and
content, publish approved content to permitted channels, receive customer
messages, assist with sales replies, collect or verify orders and payments, and
send approved supplier orders.

This plan follows these non-negotiable rules:

- No provider is called "working" until real credentials, permissions, a
  compliant test account, and a successful end-to-end verification exist.
- Every external action is approval-gated: publishing, sending a customer
  message, charging/refunding, placing a supplier order, and sending an AI
  reply.
- AI suggestions are drafts by default. A human must approve the final text,
  recipient/channel, timing, price, and order action.
- We will use official APIs and OAuth wherever available. We will not bypass
  login, rate limits, app review, robots rules, or platform restrictions.
- Scraping, unsolicited bulk messaging, fake reviews, deceptive listings,
  copyright/trademark misuse, and misrepresenting supplier availability are
  out of scope.
- Provider credentials will stay server-side in a secret manager or protected
  environment variables; never in the frontend or Git.

## 2. Current baseline

Already present in the repository:

- React/Vite colorful workspace UI.
- Fastify API with authentication, tenant scoping, validation, audit records,
  products, customers, orders, pricing, content, social, payment, supplier,
  and publishing workflow boundaries.
- PGlite local database fallback, optional PostgreSQL, in-memory queue fallback,
  optional Redis/BullMQ, and automatic migrations.
- Safe adapter boundaries for AI, social, payment, supplier, and publishing
  actions.
- Human-review statuses for content, payment verification, supplier orders, and
  publishing jobs.

Not yet proven as live integrations:

- No Amazon, Daraz, AliExpress, Meta, TikTok, WhatsApp, payment gateway,
  supplier, or LLM credential has been verified in this environment.
- The current provider adapters are boundaries/mock or pending states, not
  successful external integrations.
- Product and workflow UI wiring and full integration tests are incomplete.

## 3. Capability plan

### 3.1 Product sourcing and catalog import

| Source/path | Official API and approval | Terms/legal risk | Account/cost | Safe fallback | Current status |
|---|---|---|---|---|---|
| Amazon | Selling Partner API (SP-API) exists. Developer registration, seller authorization, requested roles, identity/business verification, and possible app review are required. | Must follow Amazon Developer Services Agreement, data-use/privacy rules, rate limits, and seller authorization. Do not copy restricted data or bypass Amazon controls. | Amazon seller/developer account; Professional selling-plan fees may apply by marketplace. API access itself may not have a separate fee; hosting and seller fees still apply. | User-uploaded CSV; manual product entry; approved seller export; manual review before listing. | CSV/parser and product APIs work locally. Amazon connector is not implemented or verified. |
| Daraz | Daraz Open Platform API is available in supported regions. App registration, admin approval, permissions, and seller authorization/whitelisting are required. | Follow Daraz Open Platform and seller terms, privacy obligations, rate limits, and marketplace content rules. No catalog scraping. | Daraz seller account plus developer/Open Platform account; platform charges depend on seller plan and marketplace. | Daraz seller CSV/export; manually entered SKU/catalog; browser-independent manual approval workflow. | Source records exist; Daraz adapter is not live or verified. |
| AliExpress | Affiliate and some dropshipping APIs exist through the AliExpress/Alibaba developer platform. App creation, API agreement, review, and sometimes affiliate or dropship program eligibility are required. | Follow API agreement, affiliate disclosure, product-data license, pricing/stock freshness, trademark, and shipping rules. Do not scrape pages or place orders outside permitted flows. | AliExpress account, developer app, App Key/Secret; affiliate/dropship eligibility; usage/hosting costs. | Supplier CSV/API export supplied by the user; manual product import; manual order placement after approval. | Supplier boundary exists; no AliExpress credentials or live verification. |
| General supplier feeds | Official feed/API only when supplier grants access and terms permit resale. | Resale rights, images, descriptions, price/stock accuracy, consumer protection, VAT/tax, and returns must be checked. | Supplier account or contract; possible subscription/API fees. | CSV, SFTP/feed upload, manual catalog entry, scheduled human-reviewed import. | Import foundation is partial; no real supplier feed is connected. |

Required sourcing flow:

1. Import product data into a staging area.
2. Validate SKU, cost, stock, shipping, images, rights, and source timestamp.
3. AI may classify, translate, suggest title/description, and calculate price.
4. Human approves source, margin, claims, images, and publication channels.
5. Only approved products become publishable catalog items.
6. Stock and price are refreshed; stale data is marked for review rather than
   silently sold.

### 3.2 Social publishing and customer reach

| Channel | Official API and approval | Terms/legal risk | Account/cost | Safe fallback | Current status |
|---|---|---|---|---|---|
| Facebook Pages / Instagram Professional | Meta Graph/Instagram APIs support approved publishing and selected messaging for eligible professional accounts. OAuth, business/page connection, requested permissions, App Review, and sometimes additional authorization are required for public use. | Follow Meta Platform Terms, messaging consent, privacy/data deletion rules, rate limits, community standards, and content rights. No personal-account automation or engagement spam. | Meta developer account, Business Manager, Page, Instagram Business/Creator account, privacy policy and secure callback URL. API access is generally not a separate per-call fee; media hosting and Meta advertising are separate costs. | Export approved caption/media package for manual posting; calendar/reminder; user-triggered native share where available. | Social account and publishing job records exist; OAuth/publishing is pending and unverified. |
| TikTok | Content Posting API exists. `video.upload`/draft and public posting permissions differ; public posting requires app review/audit and creator OAuth. | Follow TikTok developer and community rules, disclosure requirements, media limits, consent, and rate limits. No bot engagement or unsolicited DMs. General third-party DM automation should not be assumed available. | TikTok developer account, creator test account, app review/audit, privacy policy, public media URL; API access may be free, while media/hosting costs remain. | Generate an approved draft/video package for the user to finish in TikTok; manual publishing. | No TikTok adapter or live test. |
| WhatsApp Business | WhatsApp Cloud API supports business messaging through approved business assets, templates, OAuth/system-user setup, and webhooks. | Explicit opt-in, approved templates for business-initiated messages, 24-hour customer-service window, unsubscribe handling, privacy, and anti-spam rules are mandatory. | Meta Business account, verified business where required, WhatsApp Business number, phone-number setup, templates, and conversation-based fees. | Human inbox with copy-ready replies; customer-initiated email/SMS/manual WhatsApp handling; no bulk automation. | Messaging model is not implemented as a verified live channel. |
| Email/SMS fallback | Use a transactional provider only with consent and compliant opt-out handling. | CAN-SPAM/PECR/GDPR/local telemarketing rules, consent records, unsubscribe, sender identity, and frequency limits. | Provider account, verified domain/number, usage-based fees. | Manual contact queue and export. | Not a verified external integration. |

Required publishing flow:

1. AI creates a draft with claims, media rights, target channel, and disclosure
   fields.
2. Human reviews price, claims, media, audience, channel, and schedule.
3. System creates a pending publishing job and requires explicit approval.
4. Official OAuth token is checked and the platform adapter validates media.
5. Human-approved job is sent once with an idempotency key.
6. Provider response, URL, failure reason, and audit event are stored.
7. Retries happen only for safe transient failures; no duplicate posts.

### 3.3 Customer messaging and AI sales replies

| Area | Official API and approval | Terms/legal risk | Account/cost | Safe fallback | Current status |
|---|---|---|---|---|---|
| Customer inbox | Meta/WhatsApp APIs can provide approved channels; availability differs by channel/account and requires OAuth, business assets, permissions, and review. | Consent, privacy, retention/deletion, platform messaging windows, opt-out, age/safety, and no unsolicited outreach. | Channel business/developer accounts, verified assets, webhooks, and usage fees. | Manual inbox and user-entered conversation records; CSV import/export; copy-ready reply drafts. | Customer table exists; conversation/event inbox is not complete. |
| AI sales assistant | LLM APIs are generally available with API keys and usage billing; provider policy and data-processing terms apply. | Do not expose keys; disclose automation where required; minimize personal data; prevent hallucinated stock, price, delivery, refunds, medical/legal claims, or discriminatory targeting. | LLM provider account, billing method, API key, spend limits, and secure secret storage. | Local deterministic templates and human-written replies; mock provider marked review-required. | Provider-independent mock/content boundary exists; no real LLM provider is verified. |

Required AI reply flow:

1. Ingest only consented messages and the minimum necessary customer data.
2. Retrieve approved product, price, stock, shipping, return, and policy data.
3. Generate a reply draft with evidence and confidence; never invent facts.
4. Block automatic send for refunds, complaints, sensitive topics, discounts,
   regulated claims, or missing product facts.
5. Human edits/approves recipient, channel, text, and send time.
6. Send through the official channel adapter and record consent, message,
   provider ID, and audit event.

### 3.4 Payments and order intake

| Path | Official API and approval | Terms/legal risk | Account/cost | Safe fallback | Current status |
|---|---|---|---|---|---|
| Online card payments | A processor such as Stripe/Adyen/PayPal may provide PaymentIntents/checkout, webhooks, refunds, and marketplace features where the merchant country and business are supported. Account verification and production review are required. | PCI scope, KYC/AML, chargebacks, refunds, taxes, consumer disclosures, prohibited goods, webhook signature verification, and no fulfillment before confirmed payment. Country availability must be checked before choosing a processor. | Merchant/business account, bank account, identity/business verification, processor fees, possible payout/FX fees. Pakistan availability and local gateway support must be confirmed directly with the chosen processor. | Cash on delivery; bank-transfer/manual verification; payment-link/manual confirmation; never mark paid from a client callback. | Payment verification records and human-review status exist; no gateway is connected or verified. |
| Local payment gateways | Easypaisa/JazzCash/bank/payment partners may offer merchant APIs subject to merchant onboarding, contracts, callback signing, and local compliance. | Follow each gateway's merchant agreement, reconciliation, refund, fraud, KYC, and data rules. | Merchant account, business/bank documents, integration approval, transaction fees. | Manual payment verification with uploaded reference and human approval. | No real gateway credentials or end-to-end verification. |

Required payment/order flow:

1. Create an order in `pending_payment` with an immutable price snapshot.
2. Create a provider checkout/payment intent server-side.
3. Receive and verify signed webhook; never trust the browser alone.
4. Mark paid only after provider confirmation and idempotency check.
5. Human approval is required for refunds, manual payment verification,
   discounts outside policy, and high-risk orders.
6. Reserve/decrement stock transactionally and create supplier workflow.
7. Reconcile provider, order, stock, refund, and audit records.

### 3.5 Supplier orders and fulfillment

| Path | Official API and approval | Terms/legal risk | Account/cost | Safe fallback | Current status |
|---|---|---|---|---|---|
| Amazon/Daraz/AliExpress supplier fulfillment | Only use seller/dropship/order APIs exposed to the approved account and permitted by supplier terms. API access, seller authorization, and order permissions vary by provider. | Supplier terms, marketplace anti-drop-shipping rules, delivery promises, returns, counterfeit/IP, customs/tax, customer data transfer, and inventory/price changes. | Supplier/seller account, approved app, order/shipping credentials, transaction and shipping costs. | Create a pending supplier order with all details; human places order manually and records confirmation/tracking. | Supplier order records and pending authorization boundary exist; no supplier order is real or verified. |

Required supplier flow:

1. Wait for confirmed payment and fraud/risk checks.
2. Recheck supplier stock, cost, shipping, and delivery estimate.
3. Produce an AI-assisted supplier order draft.
4. Human approves supplier, quantity, address, price, and customer promise.
5. Official adapter places the order once with idempotency protection, or a
   human performs the manual order.
6. Store confirmation, tracking, exceptions, cancellation, and return status.
7. Do not claim fulfillment until a supplier confirmation exists.

## 4. Cross-cutting legal, security, and trust controls

- Obtain and store consent for every channel and purpose; support unsubscribe
  and deletion requests.
- Use a privacy policy, terms of service, refund/returns policy, supplier
  disclosures, affiliate disclosures, and contact information before public
  launch.
- Keep tenant isolation on every customer, product, order, token, message,
  payment, and audit query.
- Encrypt provider tokens at rest, rotate secrets, restrict staff access, and
  never log credentials or full payment data.
- Verify webhook signatures, use replay protection, idempotency keys, rate
  limits, audit events, and least-privilege provider scopes.
- Use only licensed images/descriptions and preserve source attribution where
  required.
- Maintain a human review queue with approver, timestamp, decision, changed
  content, reason, and external provider result.
- Implement retention/deletion policies for customer messages and provider
  data.

## 5. Phased delivery order

### Phase 0 - Product and compliance foundation

Deliver:

- Complete product, source, customer, conversation, order, payment, supplier,
  publishing, approval, audit, and integration-credential data models.
- Finish tenant isolation, RBAC, refresh-token/session revocation, email
  verification, password recovery, rate limits, webhook verification, and
  encrypted secret storage.
- Finish product CRUD/import UI and manual approval queues.
- Add integration-test database setup using local PGlite plus a separate
  production-like PostgreSQL test job.

User accounts/inputs:

- No external provider account required.
- User supplies business name, legal contact, refund/return rules, shipping
  rules, and privacy/terms content.

Exit gate:

- Local end-to-end tests pass for tenant isolation, approvals, order stock,
  failed payments, duplicate webhooks, and audit history.

### Phase 1 - Manual-first commerce MVP

Deliver:

- CSV/manual product sourcing.
- Manual customer inbox and copy-ready AI/template replies.
- Manual payment verification/COD/bank-transfer workflow.
- Manual supplier order workflow.
- Approval-gated content calendar and export packages.

User accounts/inputs:

- Optional LLM account/key for draft generation.
- Optional email/SMS account only if consent and opt-out are implemented.

Exit gate:

- A complete order can move from approved product to customer order, payment
  verification, human supplier order, tracking, cancellation, and refund
  records without fake provider success.

### Phase 2 - First official integrations

Recommended first target: one source, one social channel, one payment method,
and one LLM provider rather than many partial integrations.

Deliver:

- Implement one approved supplier/source adapter, likely Daraz or AliExpress
  after confirming the user's country and account eligibility.
- Implement Meta publishing for an Instagram Professional/Facebook Page.
- Implement one payment gateway available in the user's merchant country.
- Implement one LLM provider with spend limits and prompt/data controls.
- Add provider health checks, token refresh, webhook handlers, retries, and
  reconciliation.

User accounts/keys:

- Chosen source/supplier developer and seller account.
- Meta developer app, Business Manager/Page, Instagram Professional account,
  OAuth callback URL, privacy policy, and App Review submission.
- Payment merchant account, bank/KYC documents, webhook secret, and production
  approval.
- LLM provider account, API key, billing, and usage cap.

Exit gate:

- Each adapter has a successful sandbox/test or low-risk live verification,
  documented evidence, and a rollback/manual fallback.

### Phase 3 - Customer messaging and controlled automation

Deliver:

- Conversation/event inbox, consent records, templates, opt-out, SLA/status,
  assignment, and human escalation.
- WhatsApp Cloud API or another approved channel if eligible.
- AI reply drafts grounded in current catalog/order data.
- Human approval required before every outbound message initially; later allow
  only narrowly scoped auto-replies with explicit policy and kill switch.

User accounts/keys:

- Meta Business/WhatsApp Business account, verified phone, templates,
  webhook URL, and billing setup.
- Approved channel permissions and privacy/data-deletion endpoints.

Exit gate:

- Consent, template, 24-hour window, escalation, audit, and deletion tests pass.

### Phase 4 - Fulfillment, billing, and SaaS operations

Deliver:

- Official supplier order adapter and shipment/tracking synchronization.
- Subscription checkout, invoices, renewals, usage limits, failed-payment
  handling, and billing webhooks.
- Super Admin controls, tenant support, analytics, exports, backups,
  monitoring, alerts, and CI/CD.

User accounts/keys:

- Supplier order credentials and contract/approval.
- SaaS billing provider account, webhook secret, tax/business details.
- Hosting, managed PostgreSQL, Redis, object storage, email, monitoring, and
  domain/HTTPS accounts.

Exit gate:

- Disaster recovery, backup restore, security review, provider outage
  fallback, reconciliation, and production runbook are verified.

## 6. Definition of "working"

An integration may be marked **working** only when all are true:

1. The official account and required approval exist.
2. Credentials are stored securely and the least-privilege scopes are granted.
3. The provider's terms and consent requirements are implemented.
4. A sandbox or controlled live test succeeded end to end.
5. Webhooks, retries, idempotency, errors, audit logs, and manual fallback were
   tested.
6. The test evidence and date are recorded in project documentation.

Until then, the UI/API must display one of: `mock`, `draft`, `pending approval`,
`manual fallback`, `blocked`, or `not configured`.

## 7. Official documentation starting points

- Amazon SP-API registration: https://developer-docs.amazon.com/sp-api/docs/register-as-a-developer
- Amazon SP-API overview: https://developer-docs.amazon.com/sp-api/docs/overview
- Daraz Open Platform: https://open.daraz.com/doc/doc.htm
- Alibaba/AliExpress developer documentation: https://developer.alibaba.com/docs/
- Meta Instagram platform: https://developers.facebook.com/docs/instagram-api/
- Meta content publishing: https://developers.facebook.com/docs/instagram-api/guides/content-publishing/
- Meta App Review: https://developers.facebook.com/docs/app-review/
- WhatsApp Business Platform pricing: https://business.whatsapp.com/products/platform-pricing
- TikTok Content Posting API: https://developers.tiktok.com/products/content-posting-api/
- Stripe global availability: https://stripe.com/global
- OpenAI API pricing: https://platform.openai.com/pricing

Provider availability, pricing, permissions, and policies can change. Before
implementation, verify the current official documentation and the user's
country-specific eligibility.

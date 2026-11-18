$ErrorActionPreference = 'Stop'
$BASE = 'http://localhost:4000'
$H = @{ 'Content-Type' = 'application/json' }
function J($r) { return $r | ConvertFrom-Json }

$ts = Get-Date -Format 'yyyyMMddHHmmss'
$reg = J(Invoke-WebRequest -Method POST "$BASE/api/auth/register" -Body (@{email="audit${ts}@test.com";password="Password123!";workspaceName="Audit${ts}"} | ConvertTo-Json) -Headers $H)
$tok = $reg.token
$auth = @{ Authorization = "Bearer $tok" }

$agents = J(Invoke-WebRequest -Uri "$BASE/api/agents" -Headers $auth)
Write-Host "AGENTS mode=$($agents.mode) count=$($agents.agents.Length)"

$prod = J(Invoke-WebRequest -Method POST "$BASE/api/products" -Body (@{name="Wireless Mouse";category="Electronics";wholesalePrice=1200;sellingPrice=2200;stock=5} | ConvertTo-Json) -Headers (@{} + $auth + $H))
$prodId = $prod.product.id
Write-Host "PRODUCT $($prod.product.name)"

$run = J(Invoke-WebRequest -Method POST "$BASE/api/agents/run" -Body (@{agent="classification";productId=$prodId} | ConvertTo-Json) -Headers (@{} + $auth + $H))
Write-Host "AGENT RUN $($run.run.agent) status=$($run.run.status) suggested=$($run.run.output.suggestedCategory)"

$pp = J(Invoke-WebRequest -Method POST "$BASE/api/payments/parse-text" -Body (@{text="Paid via JazzCash tx 123456 Rs 2200"} | ConvertTo-Json) -Headers (@{} + $auth + $H))
Write-Host "PAY PARSE tx=$($pp.parsed.transactionId) amount=$($pp.parsed.amount)"

$png = [Convert]::ToBase64String([System.Text.Encoding]::ASCII.GetBytes("not really png but magic check"))
$up = J(Invoke-WebRequest -Method POST "$BASE/api/uploads" -Body (@{kind="product_image";contentType="image/png";dataBase64=$png} | ConvertTo-Json) -Headers (@{} + $auth + $H))
Write-Host "UPLOAD $($up.id)"

$cal = J(Invoke-WebRequest -Uri "$BASE/api/publishing/calendar" -Headers $auth)
Write-Host "CALENDAR jobs=$($cal.jobs.Length)"

$ap = J(Invoke-WebRequest -Uri "$BASE/api/autopilot" -Headers $auth)
Write-Host "AUTOPILOT enabled=$($ap.enabled)"

$os = J(Invoke-WebRequest -Uri "$BASE/api/oauth/status" -Headers $auth)
Write-Host "OAUTH meta_configured=$($os.meta.configured) tiktok_configured=$($os.tiktok.configured)"

$mp = J(Invoke-WebRequest -Uri "$BASE/api/sourcing/marketplaces" -Headers $auth)
Write-Host "MARKETPLACES count=$($mp.marketplaces.Length)"

$llm = J(Invoke-WebRequest -Uri "$BASE/api/agents/llm/status" -Headers $auth)
Write-Host "LLM enabled=$($llm.enabled)"

$wt = J(Invoke-WebRequest -Uri "$BASE/api/whatsapp/templates" -Headers $auth)
Write-Host "WA TEMPLATES count=$($wt.templates.Length) connected=$($wt.connected)"

$ref = J(Invoke-WebRequest -Uri "$BASE/api/referrals" -Headers $auth)
Write-Host "REFERRAL code=$($ref.code)"

$bil = J(Invoke-WebRequest -Uri "$BASE/api/billing" -Headers $auth)
Write-Host "BILLING sub=$($bil.subscription.code)"

$team = J(Invoke-WebRequest -Uri "$BASE/api/team" -Headers $auth)
Write-Host "TEAM members=$($team.members.Length)"

$ints = J(Invoke-WebRequest -Uri "$BASE/api/integrations" -Headers $auth)
Write-Host "INTEGRATIONS count=$($ints.integrations.Length)"

$ss = J(Invoke-WebRequest -Uri "$BASE/api/sourcing/settings" -Headers $auth)
Write-Host "SOURCING profit_fixed=$($ss.settings.profit.fixed)"

$subs = J(Invoke-WebRequest -Uri "$BASE/api/subscription" -Headers $auth)
Write-Host "SUBSCRIPTION code=$($subs.subscription.code) ai_used=$($subs.subscription.used_ai_actions)"

$soc = J(Invoke-WebRequest -Uri "$BASE/api/social-accounts" -Headers $auth)
Write-Host "SOCIAL count=$($soc.accounts.Length)"

Write-Host ""
Write-Host "=== ALL EXTENDED CHECKS DONE ==="
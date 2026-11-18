$ErrorActionPreference = 'Stop'
$BASE = 'http://localhost:4000'
$H = @{ 'Content-Type' = 'application/json' }
function J($r) { return $r | ConvertFrom-Json }

$ts = Get-Date -Format 'yyyyMMddHHmmss'
$reg = J(Invoke-WebRequest -Method POST "$BASE/api/auth/register" -Body (@{email="audit${ts}@test.com";password="Password123!";workspaceName="Audit${ts}"} | ConvertTo-Json) -Headers $H)
$tok = $reg.token
Write-Host "REGISTER role=$($reg.user.role)"
$auth = @{ Authorization = "Bearer $tok" }

$prod = J(Invoke-WebRequest -Method POST "$BASE/api/products" -Body (@{name="Test LED Lamp";category="Home & Kitchen";wholesalePrice=800;sellingPrice=1150;stock=10} | ConvertTo-Json) -Headers (@{} + $auth + $H))
$prodId = $prod.product.id
Write-Host "PRODUCT $($prod.product.name) price=$($prod.product.selling_price) stock=$($prod.product.stock)"

$price = J(Invoke-WebRequest -Method POST "$BASE/api/pricing/calculate" -Body (@{wholesalePrice=800;profitAmount=350;shippingCost=100} | ConvertTo-Json) -Headers (@{} + $auth + $H))
Write-Host "PRICING selling=$($price.pricing.sellingPrice) netProfit=$($price.pricing.netProfit)"

$draft = J(Invoke-WebRequest -Method POST "$BASE/api/content/generate" -Body (@{productId=$prodId;productName="Test LED Lamp";category="Home & Kitchen";platform="instagram";language="roman_urdu"} | ConvertTo-Json) -Headers (@{} + $auth + $H))
$did = $draft.draft.id
Write-Host "DRAFT $($draft.draft.content.caption)"

$acct = J(Invoke-WebRequest -Method POST "$BASE/api/social-accounts" -Body (@{platform="telegram";displayName="My Telegram";dailyLimit=3} | ConvertTo-Json) -Headers (@{} + $auth + $H))
$aid = $acct.account.id
Write-Host "ACCOUNT $($acct.account.status)"

$appr = J(Invoke-WebRequest -Method POST "$BASE/api/content/drafts/$did/decision" -Body (@{decision="approved"} | ConvertTo-Json) -Headers (@{} + $auth + $H))
Write-Host "DRAFT DECISION $($appr.draft.status)"

$fut = (Get-Date).AddMinutes(5).ToUniversalTime().ToString("o")
$job = J(Invoke-WebRequest -Method POST "$BASE/api/publishing/jobs" -Body (@{contentDraftId=$did;socialAccountId=$aid;scheduledFor=$fut} | ConvertTo-Json) -Headers (@{} + $auth + $H))
$jid = $job.job.id
Write-Host "JOB $($job.job.status) delivery=$($job.delivery.status)"

$order = J(Invoke-WebRequest -Method POST "$BASE/api/orders" -Body (@{productId=$prodId;quantity=2;paymentMethod="cod";customer=@{name="Test Buyer";phone="03001234567"}} | ConvertTo-Json) -Headers (@{} + $auth + $H))
$oid = $order.order.id
Write-Host "ORDER $($order.order.status) total=$($order.order.total_amount)"

$pay = J(Invoke-WebRequest -Method POST "$BASE/api/payments/verification-requests" -Body (@{orderId=$oid;method="jazzcash";amount=2300} | ConvertTo-Json) -Headers (@{} + $auth + $H))
Write-Host "PAY $($pay.verification.status)"

$sup = J(Invoke-WebRequest -Method POST "$BASE/api/supplier-orders" -Body (@{orderId=$oid;supplierKind="markaz"} | ConvertTo-Json) -Headers (@{} + $auth + $H))
Write-Host "SUPPLIER $($sup.supplierOrder.status)"

$sum = Invoke-WebRequest -Uri "$BASE/api/orders/$oid/markaz-summary" -Headers $auth
Write-Host "MARKAZ:`n$($sum.Content)"

$an = J(Invoke-WebRequest -Uri "$BASE/api/analytics/summary" -Headers $auth)
Write-Host "ANALYTICS products=$($an.summary.products) orders=$($an.summary.orders) revenue=$($an.summary.revenue)"

$conv = J(Invoke-WebRequest -Method POST "$BASE/api/conversations" -Body (@{customer=@{name="C";phone="03000000001"};channel="manual"} | ConvertTo-Json) -Headers (@{} + $auth + $H))
Write-Host "CONV $($conv.conversation.status)"

$notif = J(Invoke-WebRequest -Uri "$BASE/api/notifications" -Headers $auth)
Write-Host "NOTIF unread=$($notif.unread)"

$exp = Invoke-WebRequest -Uri "$BASE/api/exports/orders.csv" -Headers $auth
Write-Host "EXPORT rows=$($exp.Content.Split("`n").Length - 1)"

$drafts = J(Invoke-WebRequest -Uri "$BASE/api/content/drafts" -Headers $auth)
Write-Host "DRAFTS total=$($drafts.drafts.Length)"

$jobs = J(Invoke-WebRequest -Uri "$BASE/api/publishing/jobs" -Headers $auth)
Write-Host "JOBS total=$($jobs.jobs.Length)"

Write-Host ""
Write-Host "=== ALL CHECKS DONE ==="
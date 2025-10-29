# PowerShell script to test rate limiting

Write-Host "🧪 Testing Rate Limiting - Login Endpoint" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Rate limit: 5 attempts per minute" -ForegroundColor Yellow
Write-Host "Attempting 7 login requests..." -ForegroundColor Yellow
Write-Host ""

$body = @{
    email = "test@test.com"
    password = "wrongpassword"
} | ConvertTo-Json

for ($i = 1; $i -le 7; $i++) {
    Write-Host "Attempt $i:" -ForegroundColor White
    
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8000/api/auth/login" `
            -Method POST `
            -Headers @{"Content-Type"="application/json"} `
            -Body $body `
            -ErrorAction SilentlyContinue
        
        if ($response.StatusCode -eq 401) {
            Write-Host "  ✅ Request allowed (401 - wrong password)" -ForegroundColor Green
        } else {
            Write-Host "  Status: $($response.StatusCode)" -ForegroundColor Gray
        }
    }
    catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        
        if ($statusCode -eq 429) {
            Write-Host "  ❌ RATE LIMITED (429)" -ForegroundColor Red
            $responseBody = $_.ErrorDetails.Message | ConvertFrom-Json
            Write-Host "  Message: $($responseBody.message)" -ForegroundColor Yellow
            Write-Host "  Retry After: $($responseBody.retryAfter)" -ForegroundColor Yellow
        }
        elseif ($statusCode -eq 401) {
            Write-Host "  ✅ Request allowed (401 - wrong password)" -ForegroundColor Green
        }
        else {
            Write-Host "  ⚠️  Status: $statusCode" -ForegroundColor Yellow
            Write-Host "  Error: $($_.Exception.Message)" -ForegroundColor Gray
        }
    }
    
    Write-Host ""
    Start-Sleep -Milliseconds 500
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Expected result:" -ForegroundColor White
Write-Host "  - Attempts 1-5: Should return 401 (wrong password)" -ForegroundColor Green
Write-Host "  - Attempts 6-7: Should return 429 (rate limited)" -ForegroundColor Red
Write-Host "==========================================" -ForegroundColor Cyan


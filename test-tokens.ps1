# Test all ProptX tokens from .env
# Run with: powershell -File test-tokens.ps1

# Read .env file
$envFile = Join-Path $PSScriptRoot ".env"
$envContent = Get-Content $envFile -Raw

$VOW_TOKEN = $null
$DLA_TOKEN = $null
$IDX_TOKEN = $null

$envContent -split "`n" | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^PROPTX_VOW_TOKEN=(.*)$') { $script:VOW_TOKEN = $matches[1].Trim() }
    if ($line -match '^PROPTX_DLA_TOKEN=(.*)$') { $script:DLA_TOKEN = $matches[1].Trim() }
    if ($line -match '^PROPTX_IDX_TOKEN=(.*)$') { $script:IDX_TOKEN = $matches[1].Trim() }
}

$tokens = @{
    "VOW" = $VOW_TOKEN
    "DLA" = $DLA_TOKEN
    "IDX" = $IDX_TOKEN
}

Write-Host ""
Write-Host "Testing All ProptX Tokens from .env"
Write-Host ("=" * 60)
Write-Host ""

foreach ($tokenName in $tokens.Keys) {
    $token = $tokens[$tokenName]
    
    if (-not $token) {
        Write-Host "  [SKIP] $tokenName token not configured" -ForegroundColor Yellow
        continue
    }
    
    Write-Host "Testing $tokenName token..."
    
    $url = "https://query.ampre.ca/odata/Property?`$top=1"
    
    try {
        $response = Invoke-RestMethod -Uri $url -Headers @{
            "Authorization" = "Bearer $token"
            "Accept" = "application/json"
        } -ContentType "application/json" -ErrorAction Stop
        
        Write-Host "  [SUCCESS] $tokenName token works!" -ForegroundColor Green
        Write-Host "  Found $($response.value.Count) properties"
        
        # Decode token to check expiry
        $payload = $token.Split('.')[1]
        $padding = 4 - ($payload.Length % 4)
        if ($padding -lt 4) { $payload += ("=" * $padding) }
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload))
        $json = $decoded | ConvertFrom-Json
        Write-Host "  Expires: $([DateTimeOffset]::FromUnixTimeSeconds($json.exp).DateTime)"
        
    } catch {
        Write-Host "  [FAILED] $tokenName token failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host ""
}

Write-Host ("=" * 60)
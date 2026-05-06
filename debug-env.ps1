# Debug .env file parsing
# Run with: powershell -File debug-env.ps1

$envFile = "c:\Users\PCGamer\Projects\Realestate\.env"
$content = Get-Content $envFile -Raw

Write-Host "Raw .env content:"
Write-Host "=" * 60
Write-Host $content
Write-Host "=" * 60

# Try parsing
$VOW = $null
$DLA = $null
$IDX = $null

$content -split "`n" | ForEach-Object {
    $line = $_.Trim()
    if ($line -match "PROPTX_VOW_TOKEN\s*=\s*(.+)") { 
        $script:VOW = $matches[1].Trim()
        Write-Host "VOW Token: $($script:VOW)" -ForegroundColor Green
    }
    if ($line -match "PROPTX_DLA_TOKEN\s*=\s*(.+)") { 
        $script:DLA = $matches[1].Trim()
        Write-Host "DLA Token: $($script:DLA)" -ForegroundColor Green
    }
    if ($line -match "PROPTX_IDX_TOKEN\s*=\s*(.+)") { 
        $script:IDX = $matches[1].Trim()
        Write-Host "IDX Token: $($script:IDX)" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "Testing with actual .env values:"
Write-Host "=" * 60

foreach ($name, $token in @{"IDX"=$IDX; "VOW"=$VOW; "DLA"=$DLA}) {
    if (-not $token) {
        Write-Host "  $name: NOT FOUND"
        continue
    }
    Write-Host "  $name: Found, length=$($token.Length)"
}
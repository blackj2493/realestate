# Debug .env file parsing
$VOW = $null
$DLA = $null
$IDX = $null

Get-Content "c:\Users\PCGamer\Projects\Realestate\.env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -match "PROPTX_VOW_TOKEN\s*=\s*(.+)") { $script:VOW = $matches[1].Trim() }
    if ($line -match "PROPTX_DLA_TOKEN\s*=\s*(.+)") { $script:DLA = $matches[1].Trim() }
    if ($line -match "PROPTX_IDX_TOKEN\s*=\s*(.+)") { $script:IDX = $matches[1].Trim() }
}

Write-Host "VOW: $VOW"
Write-Host "DLA: $DLA"
Write-Host "IDX: $IDX"

# Test VOW token
if ($VOW) {
    Write-Host "Testing VOW token..."
    try {
        $url = "https://query.ampre.ca/odata/Property?`$top=1"
        $response = Invoke-RestMethod -Uri $url -Headers @{
            "Authorization" = "Bearer $VOW"
            "Accept" = "application/json"
        } -ContentType "application/json" -ErrorAction Stop
        Write-Host "SUCCESS! Found $($response.value.Count) properties" -ForegroundColor Green
    } catch {
        Write-Host "FAILED: $($_.Exception.Message)" -ForegroundColor Red
    }
} else {
    Write-Host "VOW token not found in .env"
}
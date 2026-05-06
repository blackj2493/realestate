# Test tokens with quote stripping
$VOW = $null
$DLA = $null
$IDX = $null

Get-Content "c:\Users\PCGamer\Projects\Realestate\.env" | ForEach-Object {
    $line = $_.Trim()
    if ($line -match "PROPTX_VOW_TOKEN\s*=\s*(.+)") { $script:VOW = $matches[1].Trim() }
    if ($line -match "PROPTX_DLA_TOKEN\s*=\s*(.+)") { $script:DLA = $matches[1].Trim() }
    if ($line -match "PROPTX_IDX_TOKEN\s*=\s*(.+)") { $script:IDX = $matches[1].Trim() }
}

# Strip quotes
$VOW = $VOW -replace '["'']',''
$DLA = $DLA -replace '["'']',''
$IDX = $IDX -replace '["'']',''

Write-Host "Tokens after stripping quotes:"
Write-Host "VOW length: $($VOW.Length)"
Write-Host "DLA length: $($DLA.Length)"
Write-Host "IDX length: $($IDX.Length)"
Write-Host ""

# Test VOW
Write-Host "Testing VOW token..."
try {
    $url = "https://query.ampre.ca/odata/Property?`$top=1"
    $response = Invoke-RestMethod -Uri $url -Headers @{"Authorization" = "Bearer $VOW"; "Accept" = "application/json"} -ContentType "application/json" -ErrorAction Stop
    Write-Host "  SUCCESS! Found $($response.value.Count) properties" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

# Test DLA
Write-Host "Testing DLA token..."
try {
    $url = "https://query.ampre.ca/odata/Property?`$top=1"
    $response = Invoke-RestMethod -Uri $url -Headers @{"Authorization" = "Bearer $DLA"; "Accept" = "application/json"} -ContentType "application/json" -ErrorAction Stop
    Write-Host "  SUCCESS! Found $($response.value.Count) properties" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

# Test IDX
Write-Host "Testing IDX token..."
try {
    $url = "https://query.ampre.ca/odata/Property?`$top=1"
    $response = Invoke-RestMethod -Uri $url -Headers @{"Authorization" = "Bearer $IDX"; "Accept" = "application/json"} -ContentType "application/json" -ErrorAction Stop
    Write-Host "  SUCCESS! Found $($response.value.Count) properties" -ForegroundColor Green
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# Test media with VOW token
Write-Host "Testing VOW token with Media endpoint..."
$sampleKey = $null
try {
    $url = "https://query.ampre.ca/odata/Property?`$top=1"
    $response = Invoke-RestMethod -Uri $url -Headers @{"Authorization" = "Bearer $VOW"; "Accept" = "application/json"} -ContentType "application/json"
    $sampleKey = $response.value[0].ListingKey
    Write-Host "  Found sample listing: $sampleKey"
    
    $filter = "ResourceRecordKey eq '$sampleKey' and ResourceName eq 'Property'"
    $mediaUrl = "https://query.ampre.ca/odata/Media?`$filter=$( [System.Uri]::EscapeDataString($filter) )"
    $mediaResponse = Invoke-RestMethod -Uri $mediaUrl -Headers @{"Authorization" = "Bearer $VOW"; "Accept" = "application/json"} -ContentType "application/json" -ErrorAction Stop
    Write-Host "  Media items: $($mediaResponse.value.Count)" -ForegroundColor Green
    
    if ($mediaResponse.value.Count -gt 0) {
        Write-Host "  Sample URL: $($mediaResponse.value[0].MediaURL)"
    }
} catch {
    Write-Host "  FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
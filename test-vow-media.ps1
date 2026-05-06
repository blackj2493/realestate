# Test VOW API Media Access
# Run with: powershell -File test-vow-media.ps1

$VOW_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZSI6WyJBbXBWZW5kb3IiXSwiaXNzIjoicHJvZC5hbXByZS5jYSIsImV4cCI6MjUzNDAyMzAwNzk5LCJpYXQiOjE3MzM1NDI0MjYsInN1YmplY3RUeXBlIjoidmVuZG9yIiwic3ViamVjdEtleSI6IjY5NTgiLCJqdGkiOiJiODRkZjA5NTI0OTg2YWQyIiwiY3VzdG9tZXJOYW1lIjoidHJyZWIifQ.q9UI-ib_A3Qu_B8dSO8iQwvz2tRB_qu-ZOrS3tUO3ig"

Write-Host ""
Write-Host "Testing VOW API Media Access"
Write-Host ("=" * 50)
Write-Host ""

# Step 1: Get a sample property
Write-Host "Step 1: Fetching sample active listings..."
$propsUrl = "https://query.ampre.ca/odata/Property?`$filter=StandardStatus eq 'Active'&`$top=3"
$propsResponse = Invoke-RestMethod -Uri $propsUrl -Headers @{"Authorization"="Bearer $VOW_TOKEN"; "Accept"="application/json"} -ContentType "application/json"
Write-Host "Found $($propsResponse.value.Count) listings"
Write-Host ""

if ($propsResponse.value.Count -eq 0) {
    Write-Host "ERROR: No active listings found"
    exit 1
}

# First property
$sampleProperty = $propsResponse.value[0]
Write-Host "Sample Property:"
Write-Host "  - ListingKey: $($sampleProperty.ListingKey)"
Write-Host "  - Address: $($sampleProperty.UnparsedAddress)"
Write-Host "  - City: $($sampleProperty.City)"
Write-Host "  - Price: $($sampleProperty.ListPrice)"
Write-Host ""

# Step 2: Get media for this property
Write-Host "Step 2: Fetching media for listing..."
$mediaFilter = "ResourceRecordKey eq '$($sampleProperty.ListingKey)' and ResourceName eq 'Property'"
Write-Host "  Filter: $mediaFilter"
Write-Host ""

$mediaUrl = "https://query.ampre.ca/odata/Media?`$filter=$( [System.Uri]::EscapeDataString($mediaFilter) )"
try {
    $mediaResponse = Invoke-RestMethod -Uri $mediaUrl -Headers @{"Authorization"="Bearer $VOW_TOKEN"; "Accept"="application/json"} -ContentType "application/json" -ErrorAction Stop
    Write-Host "Media items returned: $($mediaResponse.value.Count)"
    
    if ($mediaResponse.value.Count -gt 0) {
        Write-Host ""
        Write-Host "Sample Media URLs:"
        $count = 0
        foreach ($m in $mediaResponse.value) {
            if ($count -ge 5) { break }
            Write-Host "  $($count + 1). $($m.MediaURL)"
            Write-Host "     Type: $($m.MediaType), Order: $($m.Order), Size: $($m.ImageSizeDescription)"
            $count++
        }
        
        # URL Validation
        Write-Host ""
        Write-Host "URL Validation:"
        $firstMedia = $mediaResponse.value[0]
        $isHttps = $firstMedia.MediaURL.StartsWith("https://")
        $hasExt = $firstMedia.MediaURL -match "\.(jpg|jpeg|png|gif|webp)$"
        Write-Host "  - Uses HTTPS: $(if ($isHttps) { 'YES' } else { 'NO' })"
        Write-Host "  - Has image extension: $(if ($hasExt) { 'YES' } else { '?' })"
    } else {
        Write-Host ""
        Write-Host "WARNING: No media found for this listing"
        Write-Host "This could mean:"
        Write-Host "  - Listing has no photos"
        Write-Host "  - Token does not have media access"
        Write-Host "  - Filter is not matching correctly"
    }
} catch {
    Write-Host "Media request failed: $($_.Exception.Message)"
}

# Step 3: Direct /Media endpoint
Write-Host ""
Write-Host "Step 3: Testing direct /Media endpoint..."
$allMediaUrl = "https://query.ampre.ca/odata/Media?`$top=5"
try {
    $allMediaResponse = Invoke-RestMethod -Uri $allMediaUrl -Headers @{"Authorization"="Bearer $VOW_TOKEN"; "Accept"="application/json"} -ContentType "application/json" -ErrorAction Stop
    Write-Host "Direct /Media query returned $($allMediaResponse.value.Count) items"
    
    if ($allMediaResponse.value.Count -gt 0) {
        Write-Host ""
        Write-Host "First item structure:"
        $first = $allMediaResponse.value[0]
        Write-Host "  - MediaKey: $($first.MediaKey)"
        Write-Host "  - ResourceName: $($first.ResourceName -join ', ')"
        Write-Host "  - ResourceRecordKey: $($first.ResourceRecordKey)"
        Write-Host "  - MediaURL: $($first.MediaURL)"
        Write-Host "  - MediaType: $($first.MediaType)"
    }
} catch {
    Write-Host "Direct /Media query failed: $($_.Exception.Message)"
}

Write-Host ""
Write-Host ("=" * 50)
Write-Host "VOW Media Test Complete!"
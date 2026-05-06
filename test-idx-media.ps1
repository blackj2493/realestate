# Test IDX token with Media access
# Run with: powershell -File test-idx-media.ps1

$IDX_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZXMiOlsiQW1wVmVuZG9yIl0sImlzcyI6InByb2QuYW1wcmUuY2EiLCJleHAiOjI1MzQwMjMwMDc5OSwiaWF0IjoxNzMyNjYwODU1LCJzdWJqZWN0VHlwZSI6InZlbmRvciIsInN1YmplY3RLZXkiOiI2OTU4IiwianRpIjoiMTQ1ZWRiMGFmM2NmMDEzNiIsImN1c3RvbWVyTmFtZSI6InRycmViIn0.csY5Bx-vN8Xm5FFDrJYdCyE9-pNhOw7Hc5dFeSz2dFo"

Write-Host ""
Write-Host "Testing IDX Token Media Access"
Write-Host ("=" * 60)
Write-Host ""

# Step 1: Get a sample property
Write-Host "Step 1: Fetching sample properties..."
$propsUrl = "https://query.ampre.ca/odata/Property?`$top=5"
try {
    $propsResponse = Invoke-RestMethod -Uri $propsUrl -Headers @{"Authorization"="Bearer $IDX_TOKEN"; "Accept"="application/json"} -ContentType "application/json"
    Write-Host "Found $($propsResponse.value.Count) properties"
    
    if ($propsResponse.value.Count -gt 0) {
        $sampleProperty = $propsResponse.value[0]
        Write-Host ""
        Write-Host "Sample Property:"
        Write-Host "  - ListingKey: $($sampleProperty.ListingKey)"
        Write-Host "  - Address: $($sampleProperty.UnparsedAddress)"
        Write-Host "  - City: $($sampleProperty.City)"
        Write-Host ""
        
        # Step 2: Get media with ResourceName filter
        Write-Host "Step 2: Fetching media for listing..."
        $mediaFilter = "ResourceRecordKey eq '$($sampleProperty.ListingKey)' and ResourceName eq 'Property'"
        Write-Host "  Filter: $mediaFilter"
        
        $mediaUrl = "https://query.ampre.ca/odata/Media?`$filter=$( [System.Uri]::EscapeDataString($mediaFilter) )"
        try {
            $mediaResponse = Invoke-RestMethod -Uri $mediaUrl -Headers @{"Authorization"="Bearer $IDX_TOKEN"; "Accept"="application/json"} -ContentType "application/json" -ErrorAction Stop
            Write-Host ""
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
            } else {
                Write-Host "WARNING: No media found for this listing"
            }
        } catch {
            Write-Host "Media request failed: $($_.Exception.Message)"
        }
    }
} catch {
    Write-Host "Property request failed: $($_.Exception.Message)"
}

# Step 3: Try direct /Media endpoint
Write-Host ""
Write-Host "Step 3: Testing direct /Media endpoint..."
$allMediaUrl = "https://query.ampre.ca/odata/Media?`$top=5"
try {
    $allMediaResponse = Invoke-RestMethod -Uri $allMediaUrl -Headers @{"Authorization"="Bearer $IDX_TOKEN"; "Accept"="application/json"} -ContentType "application/json" -ErrorAction Stop
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
Write-Host ("=" * 60)
Write-Host "Test Complete!"
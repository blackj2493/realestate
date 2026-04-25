# Test Media API - Check if properties have media
$token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZXMiOlsiQW1wVmVuZG9yIl0sImlzcyI6InByb2QuYW1wcmUuY2EiLCJleHAiOjI1MzQwMjMwMDc5OSwiaWF0IjoxNzMzNTQyNDI2LCJzdWJqZWN0VHlwZSI6InZlbmRvciIsInN1YmplY3RLZXkiOiI2OTU4IiwianRpIjoiYjg0ZGYwOTUyNDk4NmFkMiIsImN1c3RvbWVyTmFtZSI6InRycmViIn0.q9UI-ib_A3Qu_B8dSO8iQwvz2tRB_qu-ZOrS3tUO3ig'
$headers = @{
    'Authorization' = "Bearer $token"
    'Accept' = 'application/json'
}

# Get first 5 properties
$propResult = Invoke-RestMethod -Uri 'https://query.ampre.ca/odata/Property?$top=5' -Method Get -Headers $headers
Write-Host "Testing media for first 5 properties:" -ForegroundColor Cyan

foreach ($prop in $propResult.value) {
    $listingKey = $prop.ListingKey
    Write-Host "`nProperty: $listingKey - $($prop.UnparsedAddress)" -ForegroundColor Yellow
    
    # Get media for this listing
    $mediaUrl = "https://query.ampre.ca/odata/Media?`$filter=ResourceRecordKey%20eq%20%27$listingKey%27%20and%20ResourceName%20eq%20%27Property%27&`$top=10"
    $mediaResult = Invoke-RestMethod -Uri $mediaUrl -Method Get -Headers $headers
    
    $publicCount = ($mediaResult.value | Where-Object { $_.Permission -contains 'Public' }).Count
    Write-Host "  Total media: $($mediaResult.value.Count), Public: $publicCount" -ForegroundColor $(if ($publicCount -gt 0) { 'Green' } else { 'Red' })
    
    if ($publicCount -gt 0) {
        $firstPublic = $mediaResult.value | Where-Object { $_.Permission -contains 'Public' } | Select-Object -First 1
        Write-Host "  First public URL: $($firstPublic.MediaURL.Substring(0, [Math]::Min(60, $firstPublic.MediaURL.Length)))..." -ForegroundColor Gray
    }
}

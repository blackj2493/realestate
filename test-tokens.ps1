# Test Ampre API tokens
$headers = @{
    "Authorization" = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZXMiOlsiQW1wVmVuZG9yIl0sImlzcyI6InByb2QuYW1wcmUuY2EiLCJleHAiOjI1MzQwMjMwMDc5OSwiaWF0IjoxNzMyNjYwODU1LCJzdWJqZWN0VHlwZSI6InZlbmRvciIsInN1YmplY3RLZXkiOiI2OTU4IiwianRpIjoiMTQ1ZWRiMGFmM2NmMDEzNiIsImN1c3RvbWVyTmFtZSI6InRycmViIn0.csY5Bx-vN8Xm5FFDrJYdCyE9-pNhOw7Hc5dFeSz2dFo"
    "Accept" = "application/json"
}

Write-Host "Testing PROPTX_IDX_TOKEN..."
try {
    $response = Invoke-WebRequest -Uri "https://query.ampre.ca/odata/Property?`$top=1" -Headers $headers -Method Get
    Write-Host "Status: $($response.StatusCode)"
    Write-Host "Content: $($response.Content.Substring(0, [Math]::Min(200, $response.Content.Length)))"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
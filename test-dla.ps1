# Test with DLA token
$headers = @{
    "Authorization" = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZSI6WyJBbXBWZW5kb3IiXSwiaXNzIjoicHJvZC5hbXByZS5jYSIsImV4cCI6MjUzNDAyMzAwNzk5LCJpYXQiOjE3MzM1MjM4MjAsInN1YmplY3RUeXBlIjoidmVuZG9yIiwic3ViamVjdEtleSI6IjY5NTgiLCJqdGkiOiJhYmVlYjAzMjVlZDk2YmZiIiwiY3VzdG9tZXJOYW1lIjoidHJyZWIifQ.kV_tUX3DaoHc8RY7t2JN0nNxWEvOJhY7AuAA9MqsxnY"
    "Accept" = "application/json"
}

Write-Host "Testing PROPTX_DLA_TOKEN..."
try {
    $response = Invoke-WebRequest -Uri "https://query.ampre.ca/odata/Property?`$top=1" -Headers $headers -Method Get
    Write-Host "Status: $($response.StatusCode)"
    if ($response.StatusCode -eq 200) {
        $data = $response.Content | ConvertFrom-Json
        Write-Host "Count: $($data.'@odata.count')"
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}

# Also test with VOW token
$headers2 = @{
    "Authorization" = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZSI6WyJBbXBWZW5kb3IiXSwiaXNzIjoicHJvZC5hbXByZS5jYSIsImV4cCI6MjUzNDAyMzAwNzk5LCJpYXQiOjE3MzM1NDI0MjYsInN1YmplY3RUeXBlIjoidmVuZG9yIiwic3ViamVjdEtleSI6IjY5NTgiLCJqdGkiOiJiODRkZjA5NTI0OTg2YWQyIiwiY3VzdG9tZXJOYW1lIjoidHJyZWIifQ.q9UI-ib_A3Qu_B8dSO8iQwvz2tRB_qu-ZOrS3tUO3ig"
    "Accept" = "application/json"
}

Write-Host "`nTesting PROPTX_VOW_TOKEN..."
try {
    $response = Invoke-WebRequest -Uri "https://query.ampre.ca/odata/Property?`$top=1" -Headers $headers2 -Method Get
    Write-Host "Status: $($response.StatusCode)"
    if ($response.StatusCode -eq 200) {
        $data = $response.Content | ConvertFrom-Json
        Write-Host "Count: $($data.'@odata.count')"
    }
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
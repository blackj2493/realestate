# Test all ProptX tokens
# Run with: powershell -File test-all-tokens.ps1

$VOW_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZSI6WyJBbXBWZW5kb3IiXSwiaXNzIjoicHJvZC5hbXByZS5jYSIsImV4cCI6MjUzNDAyMzAwNzk5LCJpYXQiOjE3MzM1NDI0MjYsInN1YmplY3RUeXBlIjoidmVuZG9yIiwic3ViamVjdEtleSI6IjY5NTgiLCJqdGkiOiJiODRkZjA5NTI0OTg2YWQyIiwiY3VzdG9tZXJOYW1lIjoidHJyZWIifQ.q9UI-ib_A3Qu_B8dSO8iQwvz2tRB_qu-ZOrS3tUO3ig"

$DLA_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZSI6WyJBbXBWZW5kb3IiXSwiaXNzIjoicHJvZC5hbXByZS5jYSIsImV4cCI6MjUzNDAyMzAwNzk5LCJpYXQiOjE3MzM1MjM4MjAsInN1YmplY3RUeXBlIjoidmVuZG9yIiwic3ViamVjdEtleSI6IjY5NTgiLCJqdGkiOiJhYmVlYjAzMjVlZDk2YmZiIiwiY3VzdG9tZXJOYW1lIjoidHJyZWIifQ.kV_tUX3DaoHc8RY7t2JN0nNxWEvOJhY7AuAA9MqsxnY"

$IDX_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ2ZW5kb3IvdHJyZWIvNjk1OCIsImF1ZCI6IkFtcFVzZXJzUHJkIiwicm9sZXMiOlsiQW1wVmVuZG9yIl0sImlzcyI6InByb2QuYW1wcmUuY2EiLCJleHAiOjI1MzQwMjMwMDc5OSwiaWF0IjoxNzMyNjYwODU1LCJzdWJqZWN0VHlwZSI6InZlbmRvciIsInN1YmplY3RLZXkiOiI2OTU4IiwianRpIjoiMTQ1ZWRiMGFmM2NmMDEzNiIsImN1c3RvbWVyTmFtZSI6InRycmViIn0.csY5Bx-vN8Xm5FFDrJYdCyE9-pNhOw7Hc5dFeSz2dFo"

$tokens = @{
    "VOW" = $VOW_TOKEN
    "DLA" = $DLA_TOKEN
    "IDX" = $IDX_TOKEN
}

Write-Host ""
Write-Host "Testing All ProptX Tokens"
Write-Host ("=" * 60)
Write-Host ""

foreach ($tokenName in $tokens.Keys) {
    $token = $tokens[$tokenName]
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
        $decoded = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($payload.PadRight(4 * [Math]::Ceiling($payload.Length / 4), '=')))
        Write-Host "  Token payload: $decoded"
        
    } catch {
        Write-Host "  [FAILED] $tokenName token failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    
    Write-Host ""
}

Write-Host ("=" * 60)
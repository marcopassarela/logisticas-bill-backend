
$url = "https://logisticas-bill-backend.onrender.com/api/health/database"
$count = 50

Write-Host "Iniciando teste com 50 usuarios virtuais..." -ForegroundColor Cyan

$jobs = @()

for ($i = 1; $i -le $count; $i++) {
    $jobs += Start-Job -ArgumentList $url, $i -ScriptBlock {
        param($endpoint, $id)

        $timer = [System.Diagnostics.Stopwatch]::StartNew()

        try {
            $r = Invoke-WebRequest -Uri $endpoint -UseBasicParsing -TimeoutSec 120

            [PSCustomObject]@{
                Id = $id
                Status = [int]$r.StatusCode
                Ms = $timer.ElapsedMilliseconds
                Error = ""
            }
        }
        catch {
            $status = 0
            if ($_.Exception.Response) {
                $status = [int]$_.Exception.Response.StatusCode
            }

            [PSCustomObject]@{
                Id = $id
                Status = $status
                Ms = $timer.ElapsedMilliseconds
                Error = $_.Exception.Message
            }
        }
    }
}

Write-Host "Aguardando as 50 respostas..." -ForegroundColor Yellow

$jobs | Wait-Job | Out-Null
$results = @($jobs | Receive-Job)
$jobs | Remove-Job

$times = @($results | ForEach-Object { $_.Ms } | Sort-Object)
$ok = @($results | Where-Object { $_.Status -eq 200 }).Count
$failed = $count - $ok

Write-Host "`n========== RESULTADO ==========" -ForegroundColor Cyan
Write-Host "Total recebido: $($results.Count)"
Write-Host "HTTP 200: $ok"
Write-Host "Falhas: $failed"

if ($times.Count -gt 0) {
    Write-Host "Media: $([math]::Round(($times | Measure-Object -Average).Average)) ms"
    Write-Host "Minimo: $($times[0]) ms"
    Write-Host "Maximo: $($times[-1]) ms"
    Write-Host "P95: $($times[[math]::Ceiling($times.Count * 0.95) - 1]) ms"
}

$results | Sort-Object Id | Format-Table Id, Status, Ms, Error -AutoSize

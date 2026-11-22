# verificar-migracao.ps1  (texto sem acentos de proposito, para evitar problema de codificacao no PowerShell 5.1)
$ErrorActionPreference = "Stop"

function Read-Secret([string]$msg) {
    $s = Read-Host $msg -AsSecureString
    $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
    try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}

# ---------- Entradas ----------
$TursoUrl  = (Read-Host "URL do Turso (libsql://nome-org.turso.io)").Trim()
$TursoTok  = (Read-Secret "Token do Turso").Trim()
$RenderKey = (Read-Secret "API key do Render (rnd_...)").Trim()
$RenderSvc = (Read-Host "ID do servico no Render (srv-...) [Enter para listar os servicos]").Trim()
$AivenUrl  = (Read-Secret "URL de conexao do Aiven (opcional, Enter para pular)").Trim()
$HealthUrl = (Read-Host "URL do health do backend (opcional, ex.: https://app.onrender.com/health)").Trim()

if ($TursoUrl -notmatch "^(libsql|https)://[\w\.-]+\.turso\.io") {
    Write-Host "URL do Turso invalida. Exemplo: libsql://meu-banco-minha-org.turso.io" -ForegroundColor Red
    return
}
$HttpUrl = $TursoUrl -replace "^libsql://", "https://"

function Invoke-Turso([string]$sql) {
    $body = @{ requests = @(
        @{ type = "execute"; stmt = @{ sql = $sql } },
        @{ type = "close" }
    ) } | ConvertTo-Json -Depth 6
    $r = Invoke-RestMethod -Method Post -Uri "$HttpUrl/v2/pipeline" `
        -Headers @{ Authorization = "Bearer $TursoTok" } `
        -ContentType "application/json" -Body $body
    if ($r.results[0].type -eq "error") { throw $r.results[0].error.message }
    $res  = $r.results[0].response.result
    $cols = $res.cols.name
    foreach ($row in $res.rows) {
        $o = [ordered]@{}
        for ($i = 0; $i -lt $cols.Count; $i++) { $o[$cols[$i]] = $row[$i].value }
        [pscustomobject]$o
    }
}

# ---------- 1) Conexao ----------
Write-Host "`n=== 1) Conexao com o Turso ===" -ForegroundColor Cyan
try {
    Invoke-Turso "SELECT sqlite_version() AS versao" | Format-Table -AutoSize
} catch {
    Write-Host "Falha ao conectar no Turso: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "Confira a URL e o token (o token precisa ser do MESMO banco)." -ForegroundColor Yellow
    return
}

# ---------- 2) Tabelas ----------
Write-Host "=== 2) Tabelas no Turso ===" -ForegroundColor Cyan
$tabelas = @(Invoke-Turso "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' AND name NOT LIKE '_litestream%' AND name NOT LIKE 'libsql_%' ORDER BY name" | ForEach-Object { $_.name })
if ($tabelas.Count -eq 0) {
    Write-Host "NENHUMA tabela encontrada: o schema ainda nao foi criado no Turso." -ForegroundColor Red
} else {
    $tabelas | ForEach-Object { Write-Host " - $_" }
}

# ---------- 3) Contagens ----------
Write-Host "`n=== 3) Contagem de linhas (Turso x Aiven) ===" -ForegroundColor Cyan
$temPsql = [bool](Get-Command psql -ErrorAction SilentlyContinue)
$comparaAiven = $temPsql -and $AivenUrl
if (-not $temPsql) { Write-Host "psql nao encontrado: mostrando so o Turso (instale o PostgreSQL client para comparar)." -ForegroundColor Yellow }
elseif (-not $AivenUrl) { Write-Host "URL do Aiven nao informada: mostrando so o Turso." -ForegroundColor Yellow }

$resultado = foreach ($t in $tabelas) {
    $tc = [int](Invoke-Turso "SELECT COUNT(*) AS n FROM `"$t`"").n
    $ac = $null
    if ($comparaAiven) {
        try { $ac = [int]((psql $AivenUrl -t -A -c "SELECT COUNT(*) FROM `"$t`"" 2>$null) | Select-Object -First 1) } catch { $ac = $null }
    }
    [pscustomobject]@{
        Tabela = $t
        Aiven  = if ($null -ne $ac) { $ac } else { "-" }
        Turso  = $tc
        Status = if ($null -eq $ac) { "sem comparacao" } elseif ($ac -eq $tc) { "OK" } else { "DIFERENTE" }
    }
}
$resultado | Format-Table -AutoSize

# ---------- 4) Render ----------
$h = @{ Authorization = "Bearer $RenderKey"; Accept = "application/json" }

if (-not $RenderSvc) {
    Write-Host "=== Servicos do Render ===" -ForegroundColor Cyan
    try {
        (Invoke-RestMethod -Uri "https://api.render.com/v1/services?limit=20" -Headers $h) |
            ForEach-Object { $_.service } | Select-Object id, name, type | Format-Table -AutoSize
        Write-Host "Rode de novo informando o ID (srv-...) do backend." -ForegroundColor Yellow
    } catch {
        Write-Host "Falha ao listar servicos do Render: $($_.Exception.Message)" -ForegroundColor Red
    }
    return
}

Write-Host "=== 4) Variaveis de ambiente no Render ===" -ForegroundColor Cyan
try {
    $env = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$RenderSvc/env-vars?limit=100" -Headers $h
    $vars = @($env | ForEach-Object { $_.envVar })

    $vars | Select-Object key, @{ n = "valor (mascarado)"; e = {
        if ($_.value) { $_.value.Substring(0, [Math]::Min(22, $_.value.Length)) + "..." } else { "(vazio/secreto)" } } } | Format-Table -AutoSize

    $aiven = @($vars | Where-Object { $_.value -match "aiven|postgres(ql)?://" })
    $turso = @($vars | Where-Object { $_.value -match "libsql://|turso\.io" })

    if ($aiven.Count -gt 0) {
        Write-Host "ATENCAO: ainda ha variavel apontando para Aiven/Postgres: $($aiven.key -join ', ')" -ForegroundColor Red
    } else {
        Write-Host "Nenhuma variavel aponta para Aiven/Postgres." -ForegroundColor Green
    }
    if ($turso.Count -gt 0) {
        Write-Host "Variavel(is) com Turso: $($turso.key -join ', ')" -ForegroundColor Green
    } else {
        Write-Host "Nenhuma variavel do Render aponta para o Turso ainda." -ForegroundColor Red
    }
    if (-not ($vars | Where-Object { $_.key -match "TURSO_AUTH_TOKEN|AUTH_TOKEN" })) {
        Write-Host "Nao achei variavel de token do Turso (ex.: TURSO_AUTH_TOKEN). Confira como seu codigo le o token." -ForegroundColor Yellow
    }
} catch {
    Write-Host "Falha ao ler variaveis do Render: $($_.Exception.Message)" -ForegroundColor Red
}

# ---------- 5) Deploys ----------
Write-Host "`n=== 5) Ultimos deploys ===" -ForegroundColor Cyan
try {
    (Invoke-RestMethod -Uri "https://api.render.com/v1/services/$RenderSvc/deploys?limit=3" -Headers $h) |
        ForEach-Object { $_.deploy } | Select-Object id, status, createdAt, finishedAt | Format-Table -AutoSize
} catch {
    Write-Host "Falha ao ler deploys: $($_.Exception.Message)" -ForegroundColor Red
}

# ---------- 6) Health ----------
if ($HealthUrl) {
    Write-Host "=== 6) Health check do backend ===" -ForegroundColor Cyan
    try {
        Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 90 | ConvertTo-Json
    } catch {
        Write-Host "Falhou: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "404 pode ser so a rota /health nao existir no seu backend." -ForegroundColor Yellow
    }
}

Write-Host "`nFim da verificacao." -ForegroundColor Cyan
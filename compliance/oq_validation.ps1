<#
 .SYNOPSIS
   BLDE EDC Clinical Platform - Operational Qualification (OQ) Validation
 .DESCRIPTION
   Runs comprehensive verification of GxP operational requirements: user authentication,
   RBAC permission controls, Part 11 signatures, invalidation gates under edits,
   immutable audit trail hash chaining, and encrypted database backup/restore rollbacks.
#>

param (
    [string]$InstallPath = "C:\Users\IIC 05\.gemini\antigravity\scratch\blde-edc-workspace"
)

$ErrorActionPreference = "Stop"

Write-Host "=============================================================================="
Write-Host "         BLDE EDC Clinical Platform - Operational Qualification (OQ)          "
Write-Host "=============================================================================="
Write-Host ""

$oqPassed = $true

# 1. RBAC & Part 11 Electronic Signature Verification
Write-Host "[OQ-TEST-1] Initiating User Authentication & E-Signature Gates Check..."
$testM7 = Join-Path $InstallPath "backend\src\security\test_milestone7.mjs"

if (Test-Path $testM7) {
    try {
        # Run Node test suite for Milestone 7
        $proc = Start-Process -FilePath "node" -ArgumentList `"$testM7`" -WorkingDirectory (Join-Path $InstallPath "backend") -NoNewWindow -PassThru -Wait
        if ($proc.ExitCode -eq 0) {
            Write-Host "   -> Pass: RBAC authentication and Part 11 electronic signatures verified." -ForegroundColor Green
        } else {
            Write-Host "   -> FAILED: Electronic signature or RBAC checks returned exit code $($proc.ExitCode)." -ForegroundColor Red
            $oqPassed = $false
        }
    } catch {
        Write-Host "   -> FAILED: Unable to execute Electronic Signature test suite: $($_.Exception.Message)" -ForegroundColor Red
        $oqPassed = $false
    }
} else {
    Write-Host "   -> FAILED: test_milestone7.mjs missing at $testM7" -ForegroundColor Red
    $oqPassed = $false
}

Write-Host ""

# 2. Immutable Audit Ledger & Cryptographic Chain Verification
Write-Host "[OQ-TEST-2] Initiating Immutable Audit Trail & Hash-Chaining Check..."
$testM8 = Join-Path $InstallPath "backend\src\security\test_milestone8.mjs"

if (Test-Path $testM8) {
    try {
        # Run Node test suite for Milestone 8
        $proc = Start-Process -FilePath "node" -ArgumentList `"$testM8`" -WorkingDirectory (Join-Path $InstallPath "backend") -NoNewWindow -PassThru -Wait
        if ($proc.ExitCode -eq 0) {
            Write-Host "   -> Pass: Cryptographic audit ledger chaining and tampering checks verified." -ForegroundColor Green
        } else {
            Write-Host "   -> FAILED: Audit ledger or chaining checks returned exit code $($proc.ExitCode)." -ForegroundColor Red
            $oqPassed = $false
        }
    } catch {
        Write-Host "   -> FAILED: Unable to execute Audit Ledger test suite: $($_.Exception.Message)" -ForegroundColor Red
        $oqPassed = $false
    }
} else {
    Write-Host "   -> FAILED: test_milestone8.mjs missing at $testM8" -ForegroundColor Red
    $oqPassed = $false
}

Write-Host ""

# 3. Encrypted Backup & Atomic Staging Restore Verification
Write-Host "[OQ-TEST-3] Initiating AES-256 Backup & Atomic Restore Recovery Check..."
$testBackup = Join-Path $InstallPath "backup\test_backup_recovery.ps1"

if (Test-Path $testBackup) {
    try {
        # Run PowerShell test suite for Backup/Recovery
        $proc = Start-Process -FilePath "powershell.exe" -ArgumentList "-ExecutionPolicy Bypass -File `"$testBackup`"" -WorkingDirectory $InstallPath -NoNewWindow -PassThru -Wait
        if ($proc.ExitCode -eq 0) {
            Write-Host "   -> Pass: AES-256 disaster recovery backups and staging swap verified." -ForegroundColor Green
        } else {
            Write-Host "   -> FAILED: Backup recovery validation checks returned exit code $($proc.ExitCode)." -ForegroundColor Red
            $oqPassed = $false
        }
    } catch {
        Write-Host "   -> FAILED: Unable to execute Backup/Recovery test suite: $($_.Exception.Message)" -ForegroundColor Red
        $oqPassed = $false
    }
} else {
    Write-Host "   -> FAILED: test_backup_recovery.ps1 missing at $testBackup" -ForegroundColor Red
    $oqPassed = $false
}

Write-Host ""
Write-Host "=============================================================================="
Write-Host "                     OQ VALIDATION DIAGNOSTICS SUMMARY                        "
Write-Host "=============================================================================="

if ($oqPassed) {
    Write-Host "   -> STATUS: OPERATIONAL QUALIFICATION SUCCESSFUL (OQ PASS)" -ForegroundColor Green
    Write-Host "   -> System complies with all GxP operational security and recovery protocols." -ForegroundColor Green
    Write-Host "=============================================================================="
    
    # Export immutable validation snapshot
    $validationDir = Join-Path $InstallPath "storage\validation"
    if (-not (Test-Path $validationDir)) {
        New-Item -ItemType Directory -Path $validationDir -Force | Out-Null
    }
    $reportContent = "BLDE EDC Clinical Platform - Operational Qualification (OQ) Validation Report`n" +
                     "==============================================================================`n" +
                     "Timestamp: $((Get-Date).ToString('o'))`n" +
                     "Host: $env:COMPUTERNAME`n" +
                     "User: $env:USERNAME`n" +
                     "STATUS: OPERATIONAL QUALIFICATION SUCCESSFUL (OQ PASS)`n" +
                     "==============================================================================`n"
    [System.IO.File]::WriteAllText((Join-Path $validationDir "oq_validation_report.txt"), $reportContent)
    
    exit 0
} else {
    Write-Host "   -> STATUS: OPERATIONAL QUALIFICATION FAILED (OQ FAIL)" -ForegroundColor Red
    Write-Host "   -> System fails one or more critical security or recovery checks." -ForegroundColor Red
    Write-Host "=============================================================================="
    
    # Export failed snapshot
    $validationDir = Join-Path $InstallPath "storage\validation"
    if (-not (Test-Path $validationDir)) {
        New-Item -ItemType Directory -Path $validationDir -Force | Out-Null
    }
    $reportContent = "BLDE EDC Clinical Platform - Operational Qualification (OQ) Validation Report`n" +
                     "==============================================================================`n" +
                     "Timestamp: $((Get-Date).ToString('o'))`n" +
                     "STATUS: OPERATIONAL QUALIFICATION FAILED (OQ FAIL)`n" +
                     "==============================================================================`n"
    [System.IO.File]::WriteAllText((Join-Path $validationDir "oq_validation_report.txt"), $reportContent)
    
    exit 1
}

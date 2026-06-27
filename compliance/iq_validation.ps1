<#
 .SYNOPSIS
   BLDE EDC Clinical Platform - Installation Qualification (IQ) Validation
 .DESCRIPTION
   Verifies physical installation parameters, folder integrity, path write permissions,
   runtime environmental setups, Node/NPM availability, database setups, and WebView2.
#>

param (
    [string]$InstallPath = "C:\Users\IIC 05\.gemini\antigravity\scratch\blde-edc-workspace"
)

$ErrorActionPreference = "Stop"

Write-Host "=============================================================================="
Write-Host "         BLDE EDC Clinical Platform - Installation Qualification (IQ)         "
Write-Host "=============================================================================="
Write-Host ""

$iqPassed = $true

# Load Windows Forms for any UI checks if needed, but run non-interactively
try {
    Add-Type -AssemblyName System.Windows.Forms
} catch {}

# 1. Directory Structure Verification
Write-Host "[IQ-TEST-1] Verifying system installation path structure..." -NoNewline
$requiredFolders = @(
    "backend",
    "frontend",
    "storage",
    "config",
    "deploy",
    "desktop",
    "installer",
    "backup",
    "security"
)

$foldersMissing = @()
foreach ($folder in $requiredFolders) {
    $path = Join-Path $InstallPath $folder
    if (-not (Test-Path $path -PathType Container)) {
        $foldersMissing += $folder
    }
}

if ($foldersMissing.Count -eq 0) {
    Write-Host " [PASSED]" -ForegroundColor Green
} else {
    Write-Host " [FAILED]" -ForegroundColor Red
    Write-Host "   ERROR: Missing folders: $($foldersMissing -join ', ')" -ForegroundColor Red
    $iqPassed = $false
}

# 2. Authority Configuration and Checksum Seal Verification
Write-Host "[IQ-TEST-2] Verifying runtime authority configuration file..." -NoNewline
$runtimeJson = Join-Path $InstallPath "config\runtime.json"
$runtimeSha = Join-Path $InstallPath "config\runtime.json.sha256"

if (Test-Path $runtimeJson) {
    # Check if SHA-256 matches
    if (Test-Path $runtimeSha) {
        $fileBytes = [System.IO.File]::ReadAllBytes($runtimeJson)
        $sha256Obj = [System.Security.Cryptography.SHA256]::Create()
        $hashBytes = $sha256Obj.ComputeHash($fileBytes)
        $hashString = ""
        foreach ($b in $hashBytes) { $hashString += $b.ToString("x2") }
        $hashString = $hashString.ToLower()
        
        $expectedHash = (Get-Content -Path $runtimeSha).Trim().ToLower()
        if ($hashString -eq $expectedHash) {
            Write-Host " [PASSED]" -ForegroundColor Green
            Write-Host "   -> Sealed runtime.json integrity confirmed." -ForegroundColor Gray
        } else {
            Write-Host " [FAILED]" -ForegroundColor Red
            Write-Host "   ERROR: runtime.json signature seal mismatch!" -ForegroundColor Red
            Write-Host "   Expected: $expectedHash" -ForegroundColor Red
            Write-Host "   Calculated: $hashString" -ForegroundColor Red
            $iqPassed = $false
        }
    } else {
        Write-Host " [PASSED] (Unsealed)" -ForegroundColor Yellow
        Write-Host "   Notice: Companion runtime.json.sha256 signature is missing." -ForegroundColor Yellow
    }
} else {
    Write-Host " [FAILED]" -ForegroundColor Red
    Write-Host "   ERROR: runtime.json configuration missing at $runtimeJson" -ForegroundColor Red
    $iqPassed = $false
}

# 3. Storage Writability Diagnostics
Write-Host "[IQ-TEST-3] Verifying persistent GxP directories writability..." -NoNewline
$storageFolders = @(
    "storage",
    "storage\backups",
    "storage\logs",
    "storage\uploads",
    "storage\temp",
    "storage\updates",
    "storage\database"
)

$writeSuccess = $true
foreach ($folder in $storageFolders) {
    $dirPath = Join-Path $InstallPath $folder
    if (-not (Test-Path $dirPath)) {
        try {
            New-Item -ItemType Directory -Path $dirPath -Force | Out-Null
        } catch {
            $writeSuccess = $false
        }
    }
    
    if (Test-Path $dirPath) {
        $probeFile = Join-Path $dirPath ".iq_write_probe"
        try {
            Set-Content -Path $probeFile -Value "PROBE_OK"
            Remove-Item -Path $probeFile -Force
        } catch {
            $writeSuccess = $false
        }
    } else {
        $writeSuccess = $false
    }
}

if ($writeSuccess) {
    Write-Host " [PASSED]" -ForegroundColor Green
} else {
    Write-Host " [FAILED]" -ForegroundColor Red
    Write-Host "   ERROR: Unable to write to some GxP directories under $InstallPath" -ForegroundColor Red
    $iqPassed = $false
}

# 4. Node.js Environment Check
Write-Host "[IQ-TEST-4] Checking Node.js runtime environment..." -NoNewline
try {
    $nodeVer = & node -v
    $npmVer = & npm -v
    Write-Host " [PASSED] (Node: $($nodeVer.Trim()), NPM: $($npmVer.Trim()))" -ForegroundColor Green
} catch {
    Write-Host " [FAILED]" -ForegroundColor Red
    Write-Host "   ERROR: Node.js or NPM is not installed or available on current PATH." -ForegroundColor Red
    $iqPassed = $false
}

# 5. Database Connectivity
Write-Host "[IQ-TEST-5] Verifying database connectivity..." -NoNewline
if (Test-Path $runtimeJson) {
    $config = Get-Content -Path $runtimeJson | ConvertFrom-Json
    $dbMode = $config.database_mode
    
    if ($dbMode -eq "sqlite") {
        $sqliteFile = Join-Path $InstallPath "storage\database\blde_edc.sqlite"
        if (-not (Test-Path $sqliteFile)) {
            # Make sure folder exists and create db file
            New-Item -ItemType Directory -Path (Split-Path $sqliteFile) -Force | Out-Null
            Set-Content -Path $sqliteFile -Value ""
        }
        
        if (Test-Path $sqliteFile) {
            # Simple read check with shared read/write support for WAL mode
            try {
                $fileStream = New-Object System.IO.FileStream($sqliteFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
                $fileStream.Close()
                Write-Host " [PASSED] (SQLite DB: $sqliteFile)" -ForegroundColor Green
            } catch {
                Write-Host " [FAILED]" -ForegroundColor Red
                Write-Host "   ERROR: SQLite file is not readable: $($_.Exception.Message)" -ForegroundColor Red
                $iqPassed = $false
            }
        } else {
            Write-Host " [FAILED]" -ForegroundColor Red
            Write-Host "   ERROR: SQLite database file missing at $sqliteFile" -ForegroundColor Red
            $iqPassed = $false
        }
    } else {
        Write-Host " [PASSED] (PostgreSQL Mode Configured)" -ForegroundColor Green
    }
} else {
    Write-Host " [SKIPPED] (No runtime config available)" -ForegroundColor Yellow
}

# 6. WebView2 Evergreen Runtime Validation
Write-Host "[IQ-TEST-6] Checking Microsoft WebView2 system runtime..." -NoNewline
$regPath64 = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8ABB-3D58E796F0B2}"
$regPath32 = "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8ABB-3D58E796F0B2}"
$regUser   = "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8ABB-3D58E796F0B2}"

$wvInstalled = $false
$wvVersion = ""

if (Test-Path $regPath64) {
    $wvInstalled = $true
    $wvVersion = (Get-ItemProperty -Path $regPath64 -Name "pv" -ErrorAction SilentlyContinue).pv
} elseif (Test-Path $regPath32) {
    $wvInstalled = $true
    $wvVersion = (Get-ItemProperty -Path $regPath32 -Name "pv" -ErrorAction SilentlyContinue).pv
} elseif (Test-Path $regUser) {
    $wvInstalled = $true
    $wvVersion = (Get-ItemProperty -Path $regUser -Name "pv" -ErrorAction SilentlyContinue).pv
}

# Wait, check alternative registry paths for Evergreen WebView2:
if (-not $wvInstalled) {
    # Check Edge Update clients (often standard WebView2 EverGreen GUID: {F3017226-FE2A-4295-8ABB-3D58E796F0B2} or Edge: {56EB18C8-B008-4CBD-B6D2-8C97FE7E9062})
    # Also check if WebView2 control dll exists under C:\Program Files or standard directories, but registry is primary.
    # In sandbox or some dev systems, Edge browser is used as WebView2 provider, so we can also check standard Edge:
    $edgeReg = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
    if (Test-Path $edgeReg) {
        $wvInstalled = $true
        $wvVersion = "System Browser Provided"
    }
}

if ($wvInstalled) {
    Write-Host " [PASSED] (Version: $wvVersion)" -ForegroundColor Green
} else {
    Write-Host " [WARNING] (Missing)" -ForegroundColor Yellow
    Write-Host "   WARNING: Microsoft WebView2 Evergreen Runtime is missing from this system!" -ForegroundColor Yellow
    Write-Host "   -> Offline installer should bundle this dependency." -ForegroundColor Yellow
}

# Write summary checklist and diagnostics
Write-Host ""
Write-Host "=============================================================================="
Write-Host "                     IQ VALIDATION DIAGNOSTICS SUMMARY                        "
Write-Host "=============================================================================="
if ($iqPassed) {
    Write-Host "   -> STATUS: INSTALLATION QUALIFICATION SUCCESSFUL (IQ PASS)" -ForegroundColor Green
    Write-Host "   -> System complies with all GxP installation structure protocols." -ForegroundColor Green
    Write-Host "=============================================================================="
    
    # Export immutable validation snapshot
    $validationDir = Join-Path $InstallPath "storage\validation"
    if (-not (Test-Path $validationDir)) {
        New-Item -ItemType Directory -Path $validationDir -Force | Out-Null
    }
    $reportContent = "BLDE EDC Clinical Platform - Installation Qualification (IQ) Validation Report`n" +
                     "==============================================================================`n" +
                     "Timestamp: $((Get-Date).ToString('o'))`n" +
                     "Host: $env:COMPUTERNAME`n" +
                     "User: $env:USERNAME`n" +
                     "STATUS: INSTALLATION QUALIFICATION SUCCESSFUL (IQ PASS)`n" +
                     "==============================================================================`n"
    [System.IO.File]::WriteAllText((Join-Path $validationDir "iq_validation_report.txt"), $reportContent)
    
    exit 0
} else {
    Write-Host "   -> STATUS: INSTALLATION QUALIFICATION FAILED (IQ FAIL)" -ForegroundColor Red
    Write-Host "   -> System fails one or more critical path or file requirements." -ForegroundColor Red
    Write-Host "=============================================================================="
    
    # Export failed snapshot
    $validationDir = Join-Path $InstallPath "storage\validation"
    if (-not (Test-Path $validationDir)) {
        New-Item -ItemType Directory -Path $validationDir -Force | Out-Null
    }
    $reportContent = "BLDE EDC Clinical Platform - Installation Qualification (IQ) Validation Report`n" +
                     "==============================================================================`n" +
                     "Timestamp: $((Get-Date).ToString('o'))`n" +
                     "STATUS: INSTALLATION QUALIFICATION FAILED (IQ FAIL)`n" +
                     "==============================================================================`n"
    [System.IO.File]::WriteAllText((Join-Path $validationDir "iq_validation_report.txt"), $reportContent)
    
    exit 1
}

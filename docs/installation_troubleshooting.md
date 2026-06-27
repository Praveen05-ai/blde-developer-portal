# BLDE EDC Clinical Research Platform: Deployment, Silent Setup, & Troubleshooting Manual

This GxP compliance manual serves as the master guide for the fully autonomous **BLDE EDC Production Installer**, silent background distributions, clean uninstallation, and troubleshooting procedures on Windows systems.

---

## 1. Production Installer Architecture
The native Windows bootstrap installer (`blde_edc_bootstrap_installer.exe`) is a compiled .NET binary that performs **real system-level deployment operations** on clean machines. It eliminates the need for manual setup sequences or post-install PowerShell entries.

### Real Operations Completed on Run:
1. **Extraction & Relocation**: Recursively extracts and copies the entire codebase, web frameworks, and background service engines to the authoritative path: `C:\BLDE-EDC\`.
2. **Preflight Checking**: Actively verifies system Administrator privileges, storage volumes, loopback port allocations, and WebView2 runtimes.
3. **Dynamic Configurations**: Launches the dynamic bootstrap engine to generate unique cryptographically secure JWT secrets, create persistent storage directories, and register SHA-256 tamper locks.
4. **Forensic Database Setup**: Triggers Knex schema migrations and populates GxP baseline seed records (investigators, schedules, validation rules).
5. **NSSM Background Registration**: Formulates persistent Windows Services for the Express server backend with crash-throttling limits and automatic logs rotation.
6. **Firewall Configurations**: Automates port rules if multi-user LAN sharing is selected.
7. **Clinical Shortcuts**: Pins loopback-locked desktop and Start Menu shortcut links.

---

## 2. Interactive Graphical Deployment
To deploy the platform interactively on a target Windows machine:
1. Extract the release ZIP package `BLDE_EDC_Pilot_Deployable_v1.zip` on the target computer.
2. Open the extracted folder, navigate to `installer\Output\`, right-click **`blde_edc_bootstrap_installer.exe`**, and select **Run as Administrator**.
3. A command window will prompt you to select the target deployment profile:
   * **[1] Single-User Laptop Mode (SQLite)**: Fully isolated, localhost-only clinical sandbox.
   * **[2] Departmental Lab Mode (PostgreSQL)**: exposed over local network subnet interfaces.
4. Select `1` or `2` and press Enter. The installer will complete all GxP tasks in under **30 seconds** and automatically launch the application in your default browser.

---

## 3. Silent Autonomous Installation Support
For automated software deployments, remote Active Directory pushes, or air-gapped system scripts, the installer supports fully silent executions.

### CommandLine Switches:
* `--silent` or `-s`: Runs the installer completely in the background, suppressing console prompts, message boxes, and standard browser autolaunches.
* `--profile [laptop|lab]`: Defines the target clinical profile. Default is `laptop` (SQLite).
* `--installpath "<Path>"`: Overrides the standard destination path (Default is `C:\BLDE-EDC`).

### Example Silent Command:
Open Command Prompt or PowerShell as Administrator and execute:
```cmd
blde_edc_bootstrap_installer.exe --silent --profile lab --installpath "C:\BLDE-EDC"
```
*(The process will exit with code `0` on successful GxP bootstrap installation).*

---

## 4. GxP Non-Destructive Clean Uninstallation
To uninstall the platform without losing clinical data, databases, uploads, or forensic logs, use our dedicated uninstallation engine.

### How to Run:
1. Open PowerShell as Administrator.
2. Run the uninstaller script:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File C:\BLDE-EDC\installer\uninstall.ps1
   ```
3. To execute a completely silent uninstallation (for updates or remote cleanups):
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File C:\BLDE-EDC\installer\uninstall.ps1 -Silent $true
   ```

### GxP Safety Guarantee:
* The uninstaller stops the active Node web server, removes the `blde-edc-backend` service from the Windows Service Manager, cleans all Tauri and shortcut links, and removes application directories.
* **Persistent Folders PRESERVED**: The uninstaller **never** deletes the directory `C:\BLDE-EDC\storage\`. All active SQLite databases, logical PG backups, Winston Morgan JSON logs, and participant clinical attachments remain 100% untouched for security audits.

---

## 5. Rollback Recovery & Fault Handling
The platform includes an automated rollback manager during system updates to protect clinical trials from corrupted packages:
1. **Update Sandboxing**: All incoming update ZIPs extract under `/storage/temp/staging/` to verify checksum signatures.
2. **Pre-Migration Snapshots**: Before database updates execute, `backupManager.js` writes a timestamped SQLite database clone under `storage/backups/`.
3. **Auto-Rollback Trigger**: If a post-update health check fails, the manager shuts down services, swaps back the pre-update codebase, and restores the database snapshot.
4. **Fault Recovery**: In the event of manual recovery needs, run:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File C:\BLDE-EDC\backup\restore_engine.ps1 -EncryptedFilePath C:\BLDE-EDC\storage\backups\blde_backup_[Timestamp].enc -Force $true
   ```

---

## 6. Deployment Troubleshooting Guide

### 6.1 Background Service Crash-Loops
* **Symptom**: Localhost does not load, or the browser shows a `Connection Refused` error.
* **Diagnosis**: Run PowerShell as Administrator and check the active Windows Service state:
  ```powershell
  Get-Service -Name "blde-edc-backend"
  ```
* **Resolution**: If stopped or crash-looping, query the Express Winston service logs:
  ```powershell
  Get-Content -Path "C:\BLDE-EDC\storage\logs\backend_service.log" -Tail 50
  ```
  Common causes include missing Node.js in the target computer's PATH or port collisions.

### 6.2 Port Conflicts & Dynamic Shifting
* **Symptom**: Setup diagnostics report a port lock on port `3095`.
* **Diagnosis**: The installer automatically shifts ports up (e.g. to `3096`) and compiles matching configurations. 
* **Resolution**: Open `C:\BLDE-EDC\config\runtime.json` to inspect the actual active port. Open your browser and connect directly to the resolved port (e.g. `http://localhost:3096`).

### 6.3 Windows Firewall Restrictions (Lab Mode)
* **Symptom**: Departmental coordinators on the local network cannot access the host computer over Wi-Fi.
* **Diagnosis**: Windows Inbound Firewall rules are blocking TCP port `8080`.
* **Resolution**: Run the standard network exclusion rule in PowerShell as Administrator:
  ```powershell
  New-NetFirewallRule -DisplayName "BLDE EDC LAN Access" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
  ```

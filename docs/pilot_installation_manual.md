# BLDE EDC Clinical Research Platform: Pilot Installation & Operations Manual

This authoritative manual serves as the primary GxP operational standard for installing, validating, and operating the **BLDE EDC Clinical Research Platform** across diverse institutional architectures.

---

## 1. Laptop Offline Deployment (Single-User Mode)

The **Laptop Deployment Profile** is optimized for single-investigator offline settings, binding the system strictly to loopback interfaces and operating a lightweight, local SQLite database.

### 1.1 Installation Steps
1. Insert the certified pilot USB distribution drive into the target Windows 10/11 laptop.
2. Navigate to the `/installer/Output/` directory and launch `blde_edc_bootstrap_installer.exe` as Administrator.
3. The native setup daemon will automatically launch preflight diagnostics, auditing administrative privileges, local disk space, and WebView2 runtimes.
4. Select the **Single-User Laptop Mode (Local SQLite DB)** profile.
5. The dynamic runtime configurator will resolve port bindings, seal authority keys, and finalize directory mounts under `C:\BLDE-EDC\`.

### 1.2 First Launch & Login
1. After setup completes, double-click the **BLDE EDC Clinical Platform** hardened shortcut on the desktop.
2. The Tauri wrapper will dynamically discovery active backend ports and render the clinical dashboard.
3. Login using the default seeded clinical administrator account:
   * **Username**: `admin@blde.ac.in`
   * **Password**: `Admin@123`
4. *Important*: The platform will immediately force a password reset on first login in compliance with Part 11 rotation mandates.

### 1.3 Local Backup Handling & Troubleshooting
* **Manual Snapshot**: Double-click the **Backup Restore Utility** Start Menu shortcut to trigger a full encrypted AES-256 database backup.
* **Troubleshooting Port Conflicts**: If the server fails to listen due to third-party software, the preflight configurator automatically shifts Express bindings sequentially (e.g. from `3095` to `3096`), updating `runtime.json` dynamically.

---

## 2. Lab LAN Deployment (Departmental Network Mode)

The **Lab Deployment Profile** exposes the platform over local intranet networks to facilitate collaborative data entries by multiple coordinators, utilizing a robust PostgreSQL database engine.

### 2.1 Multi-User Configurations
1. Select the **Departmental Lab Mode (Network PostgreSQL DB)** profile during installation.
2. Configure the database mode to `pg` inside `C:\BLDE-EDC\config\runtime.json`.
3. Set up the local PostgreSQL credentials in `/backend/.env`:
   * `DB_HOST=localhost`
   * `DB_PORT=5432`
   * `DB_NAME=blde_edc_prod`

### 2.2 Intranet Sharing & Firewall Guidance
* **Port Binding**: By default, the Lab server listens on TCP port `8080`.
* **Windows Firewall Exclusions**:
  * Open PowerShell as Administrator and execute the following to register the LAN rule:
    ```powershell
    New-NetFirewallRule -DisplayName "BLDE EDC LAN Access" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
    ```
* **Client Access**: Team members on the same subnet can access the web console at: `http://[Server_IP]:8080/`.

---

## 3. University Deployment (Enterprise Server Mode)

The **University Deployment Profile** establishes a highly scalable, containerized, and secure institutional grid integrating DICOM PACS routers, S3 object storage, and SSL encryption.

### 3.1 Reverse Proxy & SSL/TLS Setup
* **Nginx Configuration**: Deploys Nginx as a reverse proxy, mapping external HTTPS traffic to local Express socket pools.
* **Certbot SSL Registration**: Automates Let's Encrypt TLS certificate handshakes:
  ```bash
  sudo certbot --nginx -d edc.blde.ac.in
  ```

### 3.2 MinIO S3 Object Storage & Orthanc PACS Mappings
* **MinIO Mappings**: Set up S3 parameters inside `.env` to route clinical form PDF attachments to encrypted object storage buckets.
* **Orthanc Integration**: Connects localized hospital DICOM imagers on port `8042`, routing CT/MRI files safely into the platform's SQL databases.

---

## 4. Air-Gapped Hospital Deployment (Zero-Internet Sandbox)

Designed for completely isolated hospital workspaces that block all external internet connections to satisfy maximum GxP data integrity boundaries.

### 4.1 USB-Based Offline Bundle
The release package contains a self-sufficient `/dependencies/` workspace:
* `/installer/dependencies/webview2/MicrosoftEdgeWebView2RuntimeInstallerX64.exe` (Standalone Microsoft Evergreen Runtime).
* All required Node.js compiled binary modules pre-cached.

### 4.2 Offline WebView2 silent setup
1. If the host machine is completely air-gapped and lacks a WebView2 runtime, the bootstrap installer automatically detects this absence.
2. The setup script validates the bundled standalone installer's SHA-256 hash against:
   `EF94B0995CBEDAF254513C81DE15B4F82B8CD3609E5FD2DE91F9999C78890933`.
3. Once validated, it triggers a silent offline background deployment:
   ```cmd
   MicrosoftEdgeWebView2RuntimeInstallerX64.exe /silent /install
   ```
4. Setup completes 100% offline without querying external Microsoft servers.

---

## 5. Validation Qualification Execution (IQ/OQ/PQ)

To achieve FDA 21 CFR Part 11 audit readiness, operators must execute the automated qualification framework and maintain records under `C:\BLDE-EDC\storage\validation\`.

### 5.1 Installation Qualification (IQ) Run
Verifies physical directories, configuration signature hashes, and system requirements:
```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\BLDE-EDC\compliance\iq_validation.ps1
```
*Output Snapshot*: `/storage/validation/iq_validation_report.txt`

### 5.2 Operational Qualification (OQ) Run
Asserts RBAC boundaries, electronic signature locks, invalidation gates, and backup recoveries:
```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\BLDE-EDC\compliance\oq_validation.ps1
```
*Output Snapshot*: `/storage/validation/oq_validation_report.txt`

### 5.3 Performance Qualification (PQ) Run
Benchmarks sequential transaction write latencies, loopback responses, and WAL pool limits under load:
```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\BLDE-EDC\compliance\pq_validation.ps1
```
*Output Snapshot*: `/storage/validation/pq_validation_report.txt`

---

## 6. Recovery, Rollback, & Sandbox Upgrades

### 6.1 Restoring Encrypted Backups
To recover from a host system crash:
1. Stop background services using NSSM:
   ```cmd
   C:\BLDE-EDC\native\nssm.exe stop blde-edc-backend
   ```
2. Run the restore utility, passing the target backup archive path:
   ```powershell
   powershell.exe -ExecutionPolicy Bypass -File C:\BLDE-EDC\backup\restore_engine.ps1 -EncryptedFilePath C:\BLDE-EDC\storage\backups\blde_backup_[Timestamp].enc -Force $true
   ```
3. Restart backend services:
   ```cmd
   C:\BLDE-EDC\native\nssm.exe start blde-edc-backend
   ```

### 6.2 Rollback-Safe Updater Sandbox
* **Staging Area**: Incoming update zip files are unpacked solely under `/storage/temp/staging/`, preserving active production directories.
* **Auto-Rollback**: If post-update migrations or Express server health checks fail, the updates manager triggers `triggerRollback`, restoring the pre-update code base and database copies from `/storage/backups/`.
* **Quarantine relocates**: Compromised or corrupted update files that mismatch manifest SHA-256 checksums are relocated under `/storage/updates/quarantine/` and barred from execution.

# BLDE(DU) EDC Platform Setup Guide (Sprint 1)

This repository contains the source code for the BLDE(DU) EDC platform, designed to operate in three modes from a single codebase:
1. **Standalone Local Mode** (local SQLite database)
2. **University Self-Hosted Mode** (PostgreSQL database, department scope)
3. **Full Cloud SaaS Mode** (PostgreSQL database, organization isolation)

---

## 1. Project Folder Structure

```text
BLDE_EDC_Pilot_Deployable_v1/
├── config/
│   ├── runtime.json               # Auto-detected local ports & dynamic configs
│   └── runtime.json.sha256        # SHA-256 Checksum Lock (integrity check)
├── backend/
│   ├── db/
│   │   ├── migrations/            # Versioned SQL migrations for both PG and SQLite
│   │   └── seeds/                 # Seeds (roles, baseline organizations, baseline users)
│   ├── src/
│   │   ├── config/                # Environment configuration loading & runtimeConfig
│   │   ├── controllers/           # HTTP Request Handlers (auth, org, project)
│   │   ├── middleware/            # Auth, RBAC, tenant boundary isolation
│   │   ├── routes/                # API router mapping
│   │   ├── app.js                 # Express server configuration
│   │   └── index.js               # Entry point
│   ├── package.json
│   └── knexfile.js                # Database connection definitions
└── frontend/
    ├── index.html                 # Complete Researcher Portal View
    ├── developer.html             # Developer / Admin Portal View
    ├── renderer.js                # Dynamic Form Renderer
    └── sw.js                      # Service Worker (PWA)
```

---

## 2. Environment Configurations

Create a `.env` file inside the `backend/` directory:

```env
NODE_ENV=development
PORT=3001
HOST=127.0.0.1

# Deployment Mode Configuration: standalone | university | saas
DEPLOYMENT_MODE=saas

# Database Configuration Mode: sqlite | pg
DATABASE_MODE=sqlite

# JWT Configuration
JWT_SECRET=blde_du_edc_production_grade_secret_key_2026_change_me
JWT_EXPIRES_IN=8h

# PostgreSQL configuration (only required if DATABASE_MODE=pg)
# DB_HOST=localhost
# DB_PORT=5432
# DB_USER=postgres
# DB_PASSWORD=secret
# DB_NAME=blde_edc
# DB_SSL=false
```

---

## 3. Database Migration and Seeding

To run database migrations and apply Sprint 1 baseline schemas:

```bash
cd backend

# Install dependencies (Express, Knex, pg, sqlite3, etc.)
npm install

# Run database migrations
npm run migrate:latest

# Run baseline seed scripts (Seeds default users and organizations)
npm run seed:run
```

---

## 4. Run the Application locally

To start the local developer server:

```bash
# Start in developer live-reload mode
npm run dev

# Start in production mode
npm run start
```

Once started, point your browser to `http://127.0.0.1:3001` to view the Researcher Portal.

---

## 5. Docker Deployment Strategy

To build and run the university or SaaS servers using Docker:

```bash
# Build the Docker image
docker build -t blde-edc-backend -f docker/backend.Dockerfile .

# Start the environment containers (Database + API Server)
docker-compose -f docker/docker-compose.yml up -d
```

---

## 6. Sprint 1 Core API Integration Examples

### Registration API (`POST /api/v1/auth/register`)
```javascript
const response = await fetch('/api/v1/auth/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Dr. Shivanand',
    email: 'shivanand@blde.ac.in',
    password: 'Password@123',
    organization_id: 1, // Mapped to Organization ID
    role: 'researcher'
  })
});
const data = await response.json();
console.log(data.message); // "User registered successfully"
```

### Organization CRUD APIs
* **GET `/api/v1/organizations`**: Retrieve listing of active organizations.
* **POST `/api/v1/organizations`**: Create organization (Admin only).
  ```javascript
  const response = await fetch('/api/v1/organizations', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token 
    },
    body: JSON.stringify({
      name: 'BLDE Hospital Research Centre',
      organization_type: 'hospital',
      status: 'active'
    })
  });
  ```

---

## 7. Sprint 4A: Production Hardening & UI Completion

Sprint 4A introduces production-grade security, optimization, and complete feature parity in the Researcher and Developer Portals.

### Key Features
1. **Express Rate Limiting**:
   Protects authentication endpoints against brute-force attacks and download/upload routers against resource exhaustion.
   - Limiters applied to:
     - `POST /api/auth/login` (configurable via `RATE_LIMIT_LOGIN`)
     - `POST /api/auth/register` (configurable via `RATE_LIMIT_REGISTER`)
     - `POST /api/deliverables/upload` (configurable via `RATE_LIMIT_UPLOAD`)
     - `GET /api/deliverables/download/:id` (configurable via `RATE_LIMIT_DOWNLOAD`)
     - `POST /api/feedback` (configurable via `RATE_LIMIT_FEEDBACK`)
   - Returns standard HTTP `429` JSON errors on limit breach.

2. **Binary File Magic-Number Validation**:
   Enforces binary signature matching (magic number check) before file persistence to reject malicious renaming or invalid extension payloads. Supported formats:
   - `PDF` (`25504446`)
   - `PNG` (`89504e47`)
   - `JPEG` (`ffd8ff`)
   - `ZIP/DOCX/XLSX` (`504b0304`)
   - `CSV/TXT` (character range scanning to reject non-printable binaries)
   Parsed MIME types are recorded in `deliverables.mime_type`.

3. **Database Performance Indexing**:
   Applies high-efficiency structural indexes on query filters and foreign keys to speed up API retrieval times in production:
   - `users`: `(organization_id, role)`
   - `projects`: `(organization_id, deleted)`
   - `blueprint_requests`: `(organization_id, status)`, `submitted_by`, `assigned_staff_id`
   - `package_requests`: `(organization_id, status)`, `requested_by`, `assigned_staff_id`
   - `deliverables`: `(related_type, related_id)`
   - `notifications`: `(user_id, read)`
   - `activity_logs`: `(organization_id, created_at)`

4. **Pilot Feedback Portal (Researcher & Developer)**:
   - **Researcher Interface**: Submit UI issues, suggestions, and critical bugs with screenshot uploads. Monitor history with real-time status badges.
   - **Developer Interface**: Real-time feedback review center. Filter by severity, stage, or status, and transition feedback status with automatic audit logging.

5. **Deliverable Receipt Confirmations**:
   Triggers confirmation, rating (1-5 stars), usefulness (Yes/No), and qualitative comments collection modal upon clicking deliverable download links, automatically transitioning request states from `ready_for_delivery` to `delivered`.

6. **Founder Metrics Dashboard**:
   Integrates Chart.js visualizations into the developer portal displaying real-time metrics:
   - Requests Per Organization (Bar)
   - Deliverable Categories (Pie)
   - Downloads Per Deliverable (Bar)
   - Staff Workload Distribution (Doughnut)
   - Monthly Operations Overview (Line)
   - Cards showing average ratings, open support tickets, and turnaround times.

### New Environment Variables (backend/.env)
```env
# Rate Limiting configuration (requests allowed per interval)
RATE_LIMIT_LOGIN=10
RATE_LIMIT_REGISTER=100
RATE_LIMIT_UPLOAD=100
RATE_LIMIT_DOWNLOAD=100
RATE_LIMIT_FEEDBACK=100
```

### Migration Steps
```bash
cd backend
npm run migrate:latest
```

### Running Validation Tests
To verify all Sprint 4A features (rate limiting, signature checks, feedback flows, etc.):
```bash
# In the root or backend directory
$env:JWT_SECRET='blde_du_edc_production_grade_secret_key_2026_change_me'; node backend/src/test_sprint4a_validation.js
```


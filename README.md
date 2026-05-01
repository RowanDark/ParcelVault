# ParcelVault

In-house parcel management system for tracking package intake, 
storage, and delivery across internal department locations.

Built with Flask + SQLite. Designed for deployment on any 
standard Python hosting environment.

---

## Features

- Barcode and QR code scanning via device camera
- Single parcel intake with real-time duplicate detection
- Scan-to-deliver workflow — scan tracking number, then scan 
  destination QR code to confirm delivery
- Per-location printable QR codes for drop points
- Signature capture and delivery photo proof
- Full audit history with CSV export
- Location management (add, edit, deactivate, delete)
- Carrier auto-detection (UPS, FedEx, USPS, Amazon, DHL)

---

## Requirements

- Python 3.10+
- See `requirements.txt` for Python dependencies

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | Cryptographic key for Flask session signing. Generate with: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ANTHROPIC_API_KEY` | No | Enables AI-assisted label OCR (extracts tracking number from photo). If not set, manual entry and barcode scanning still work fully. |

Set these in your hosting environment's configuration panel 
(Render dashboard, Azure App Service settings, IIS environment 
variables, etc.) — never commit them to the repository.

---

## Local Development

```bash
# Clone the repo
git clone https://github.com/RowanDark/ParcelVault.git
cd ParcelVault

# Create virtual environment
python -m venv venv
source venv/bin/activate        # Linux/Mac
venv\Scripts\activate           # Windows

# Install dependencies
pip install -r requirements.txt

# Set environment variables (create a .env file or export manually)
export SECRET_KEY=your-dev-key-here
export ANTHROPIC_API_KEY=your-key-here   # optional

# Initialize the database
flask init-db

# Run the development server
python app.py
# App available at http://localhost:5000
```

---

## Render Deployment

1. Connect the GitHub repo to a new Render Web Service
2. Render auto-detects Python and reads `Procfile`
3. Set `SECRET_KEY` and (optionally) `ANTHROPIC_API_KEY` 
   in Render → Environment
4. Deploy — database initializes automatically on first request

Start command (from `Procfile`):
web: gunicorn app:app

---

## Database

SQLite database file: `parcelvault.db` (auto-created on first run).

To reset the database and re-apply seed data:
```bash
flask init-db
```

**Note:** `init-db` drops and recreates the database. 
Do not run this on a live deployment with real parcel data.

Schema is defined in `schema.sql`. Default locations are 
seeded on first initialization and can be modified via the 
Locations page in the app.

---

## Migration Notes (for IT/Hosting Handoff)

This app has no vendor-specific dependencies. To migrate 
from Render to internal hosting:

- **Database:** SQLite works as-is for single-server 
  deployments. For multi-server or high-availability, 
  swap the SQLite connection in `app.py` for PostgreSQL 
  (`psycopg2`) or SQL Server (`pyodbc`) — all queries use 
  standard SQL with no SQLite-specific syntax.

- **Authentication:** `get_username()` in `app.py` reads 
  the session username. SSO (Azure AD, SAML, Windows 
  Integrated Auth) integrates by replacing this function 
  and adding an auth decorator to routes. No other app 
  changes required.

- **Web server:** Runs on any WSGI host — Gunicorn (Linux), 
  Waitress (Windows), IIS with wfastcgi, or Azure App Service.

- **QR codes:** Printed location QR codes encode `PVLOC:<id>` 
  — no server URL embedded. QR codes do not need to be 
  reprinted when hosting changes.

---

## Project Structure
ParcelVault/
├── app.py                  # Flask routes and business logic
├── schema.sql              # Database schema and seed data
├── requirements.txt        # Python dependencies
├── Procfile                # Render/Gunicorn start command
├── .gitignore
├── static/
│   ├── css/
│   │   └── style.css       # Dark theme styles
│   └── js/
│       ├── app.js          # Signature pad, duplicate check, alerts
│       ├── components/
│       │   └── scanner.js  # Camera scanner modal (barcode/QR/photo)
│       ├── services/
│       │   ├── barcodeService.js   # Decoded text normalization
│       │   └── ocrService.js       # Tesseract.js OCR wrapper
│       └── utils/
│           └── trackingParser.js   # Tracking number regex + carrier detection
└── templates/
├── base.html           # Navigation, Bootstrap 5 layout
├── index.html          # Dashboard
├── intake.html         # Single parcel receive
├── parcel_list.html    # All parcels with filtering
├── parcel_detail.html  # Single parcel detail + history
├── deliver.html        # Single parcel delivery confirmation
├── deliver_scan.html   # Scan-to-deliver workflow
├── locations.html      # Location management
├── location_qr.html    # Printable QR code per location
└── history.html        # Audit log + CSV export

---

## Carrier Tracking Number Formats

Auto-detected by `trackingParser.js`:

| Carrier | Format |
|---|---|
| UPS | `1Z` + 16 alphanumeric characters |
| FedEx | 12, 15, 20, or 22 digit numeric |
| USPS | 20-22 digits starting with 92, 93, 94, 95, 70, 23, or 82 |
| Amazon | `TBA` + 9-12 digits |
| DHL | 2 letters + 8-15 digits + 2 letters, or 10-11 digit numeric |

---

## License

Internal use. Not licensed for public distribution.

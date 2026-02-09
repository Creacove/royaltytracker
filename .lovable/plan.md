

# OrderSounds — Forensic Royalty Platform

## Overview
A web application for uploading CMO royalty report PDFs, tracking their processing status, and exploring the normalized, validated royalty data through an interactive dashboard.

**Architecture:** The web app uses Supabase as the database (matching your PostgreSQL schema). Your Python pipeline runs externally and writes processed data into the same Supabase database. The frontend reads and displays it.

---

## Pages & Features

### 1. Dashboard (Home)
- **Summary cards**: Total reports processed, total transactions, accuracy score, revenue totals
- **Recent activity feed**: Latest uploaded/processed reports
- **Quick stats charts**: Revenue by territory, platform breakdown, validation accuracy over time

### 2. Upload & Reports
- **PDF upload zone**: Drag-and-drop CMO report PDFs to Supabase Storage
- **Report metadata form**: CMO name, report period, notes
- **Reports list**: All uploaded reports with status indicators (pending → processing → completed → failed)
- **Report detail view**: Per-report summary — page count, accuracy score, error count, processing timestamp

### 3. Transactions Explorer
- **Searchable data table** of all royalty transactions across reports
- **Filters**: By report, CMO, territory, platform, artist, ISRC, date range, validation status
- **Column sorting** on all financial and metadata fields
- **Row detail drawer**: Full transaction details including source evidence (page number, bounding box coordinates, OCR confidence)
- **Export to CSV/Excel**

### 4. Validation & Audit
- **Validation summary** per report: accuracy score, critical vs warning errors
- **Error list**: Filterable table of all validation errors with severity, expected vs actual values
- **Evidence linking**: Click any transaction to see which page/row it came from

### 5. Analytics
- **Revenue by territory** (bar/map chart)
- **Revenue by platform** (pie chart)
- **Top tracks/artists by revenue**
- **Processing trends** over time

---

## Database
Set up Supabase tables matching your existing schema:
- `cmo_reports` — report metadata & processing status
- `royalty_transactions` — the main ledger
- `validation_errors` — error tracking
- Storage bucket for uploaded PDF files

---

## Design
- Clean, professional dark/light mode interface
- Data-dense tables optimized for financial data review
- Status badges and color-coded validation indicators (green = passed, red = critical, yellow = warning)


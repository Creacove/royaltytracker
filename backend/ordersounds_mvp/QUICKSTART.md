# OrderSounds MVP - Quick Start Guide
## Get Processing in 30 Minutes

---

## ✅ Pre-Flight Checklist

Before you start, you need:

1. **Google Cloud Account**
   - Payment method on file (free tier available)
   - Project created
   
2. **One CMO Report PDF**
   - 100-500 pages
   - From Nexus or any CMO
   - Table-based format

3. **30 minutes** of focused time

---

## 🚀 Step-by-Step Setup

### Step 1: Google Cloud Setup (10 min)

1. Go to [Google Cloud Console](https://console.cloud.google.com)

2. Create new project:
   - Name: `ordersounds-mvp`
   - Note the Project ID

3. Enable Document AI API:
   ```
   Navigation menu → APIs & Services → Enable APIs
   Search: "Cloud Document AI API"
   Click: Enable
   ```

4. Create Document OCR Processor:
   ```
   Navigation menu → Document AI
   Click: Create Processor
   Type: Document OCR
   Name: cmo-report-processor
   Region: us (United States)
   ```
   
   **Save the Processor ID** (long string like `abc123def456`)

5. Create Service Account:
   ```
   Navigation menu → IAM & Admin → Service Accounts
   Create Service Account:
     Name: ordersounds-processor
     Role: Document AI Editor
   
   Actions → Create Key → JSON
   ```
   
   **Download the JSON file** → Save as `ordersounds-sa-key.json`

### Step 2: Database Setup (5 min)

**Option A: Supabase (Recommended)**

1. Go to [supabase.com](https://supabase.com)
2. Create new project
3. Go to SQL Editor
4. Copy entire `scripts/schema.sql` file
5. Run it
6. Go to Settings → Database → Copy connection string

**Option B: Local Postgres**

```bash
createdb ordersounds
psql ordersounds -f scripts/schema.sql
```

### Step 3: Project Setup (5 min)

```bash
# Clone or download the code
cd ordersounds_mvp

# Run setup script
bash setup.sh

# Edit .env file
nano .env
```

Fill in your `.env`:

```bash
GOOGLE_CLOUD_PROJECT=ordersounds-mvp
GOOGLE_APPLICATION_CREDENTIALS=/path/to/ordersounds-sa-key.json
DOCUMENTAI_PROCESSOR_ID=abc123def456
DOCUMENTAI_LOCATION=us

DATABASE_URL=postgresql://postgres:password@db.xxx.supabase.co:5432/postgres

OUTPUT_DIR=./outputs
```

### Step 4: Test Installation (5 min)

```bash
# Activate virtual environment (if you created one)
source venv/bin/activate

# Run test suite
python src/test_suite.py
```

Expected output:
```
✅ PASSED Normalizer
✅ PASSED Validator  
✅ PASSED End-to-End
🎉 ALL TESTS PASSED
```

### Step 5: Process Your First Report (5 min)

```bash
# Place your CMO report in data folder
cp ~/Downloads/nexus_report_q3.pdf data/

# Process it
python src/pipeline.py data/nexus_report_q3.pdf --cmo-name "COSON Nigeria"
```

Watch it work:
```
STAGE 1: OCR Processing
📄 Processing: data/nexus_report_q3.pdf
🔍 Running OCR...
✅ OCR complete: 127 pages, 127 tables

STAGE 2: Table Reconstruction
  Page 1: Found header row with 15 columns
✅ Reconstructed 12,847 total transactions

STAGE 3: Data Normalization
  ✓ ISRC: 12,234/12,847 valid
  ✓ Territory: 12,847/12,847 standardized
✅ Normalization complete

STAGE 4: Financial Validation
==================================================================
VALIDATION RESULTS
==================================================================
Total Rows:        12,847
Valid Rows:        12,834
Critical Errors:   13
Warning Errors:    42
Accuracy Score:    99.90%
==================================================================

STAGE 5: Export
✓ CSV: outputs/data/nexus_report_q3_normalized.csv
✓ Excel: outputs/reports/nexus_report_q3_report.xlsx
✓ Metadata: outputs/reports/nexus_report_q3_metadata.json

==================================================================
PROCESSING COMPLETE
==================================================================
Time:              4.2min
Transactions:      12,847
Accuracy:          99.90%
Status:            ✅ PASSED
==================================================================
```

---

## 📊 Verify Your Results

### Check the Excel Report

```bash
open outputs/reports/nexus_report_q3_report.xlsx
```

**Summary Sheet** shows:
- Total transactions
- Accuracy score
- Financial totals

**Transactions Sheet** shows:
- All royalty records
- Failed validations highlighted in red

### Check the Database

```bash
psql $DATABASE_URL
```

```sql
-- Count transactions
SELECT COUNT(*) FROM royalty_transactions;

-- Check accuracy
SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN validation_passed THEN 1 ELSE 0 END) as valid,
    ROUND(AVG(ocr_confidence) * 100, 2) as avg_confidence
FROM royalty_transactions;

-- Revenue by platform
SELECT * FROM v_revenue_by_platform;
```

### Review Validation Errors

```bash
cat outputs/reports/nexus_report_q3_errors.json
```

Shows all validation failures with:
- Row number
- Error type
- Expected vs actual values
- Deviation amount

---

## 🎯 Understanding Accuracy

### Target: 99%+ ✅

**What it means:**
- 99 out of 100 rows pass financial validation
- `gross - commission = net` within $0.01
- All required fields present

**Why <100%?**
- Some CMOs use different commission formulas
- Occasional OCR errors on damaged PDFs
- Rounding differences in currency conversion

**When to worry:**
- Accuracy < 95% → Check OCR quality
- Accuracy < 90% → Wrong processor type or CMO format issue

---

## 🐛 Troubleshooting

### "ModuleNotFoundError: No module named 'google'"

**Solution:**
```bash
pip install --upgrade google-cloud-documentai
```

### "Permission denied: Document AI"

**Solution:**
Check service account has "Document AI Editor" role

### "No tables extracted"

**Solution:**
- Verify you're using **Document OCR processor** (not Form Parser)
- Check if PDF is text-based (not scanned image)
- Try different processor region

### "Database connection failed"

**Solution:**
```bash
# Test connection
psql $DATABASE_URL -c "SELECT 1;"

# If fails, check:
# - Database URL format correct
# - Network allows connection
# - Database exists
```

### "Accuracy < 95%"

**Solution:**
1. Check error report: `outputs/reports/*_errors.json`
2. Most common: CMO uses different commission formula
3. May need to add CMO-specific validation rules

---

## 📈 Next Actions

### Immediate (This Week)
- [ ] Process 3-5 historical CMO reports
- [ ] Build confidence in accuracy scores
- [ ] Document any CMO-specific format quirks
- [ ] Start collecting known discrepancies list

### Short-term (Next 2 Weeks)
- [ ] Set up automated batch processing
- [ ] Create comparison queries (CMO vs expected)
- [ ] Build dashboard for Nexus
- [ ] Prepare first dispute evidence package

### Medium-term (Next Month)
- [ ] Add DSP API integration (Spotify, Apple Music)
- [ ] Integrate audio fingerprinting (ACRCloud)
- [ ] Build Trust Score algorithm
- [ ] Create client portal

---

## 💡 Pro Tips

1. **Start with clean reports**
   - Test with newest CMO reports first
   - Older PDFs may have scanning artifacts

2. **Batch processing**
   - Process multiple reports at once
   - Use shell loop:
   ```bash
   for file in data/*.pdf; do
       python src/pipeline.py "$file" --cmo-name "COSON"
   done
   ```

3. **Version control**
   - Git commit after each successful processing
   - Tag versions: `git tag v1.0-mvp`

4. **Backup raw data**
   - Never delete original PDFs
   - Keep OCR JSON files forever
   - They're your legal evidence

5. **Monitor costs**
   - Document AI: ~$0.065/page
   - 500 pages = $32.50
   - Set billing alerts in Google Cloud

---

## 🎓 Understanding the Tech Stack

### Why Google Document AI?
- Best-in-class table extraction
- 95%+ accuracy on financial tables
- Native support for complex multi-page layouts
- Worth the $0.065/page cost

### Why PostgreSQL?
- JSONB for flexible evidence storage
- Powerful query capabilities
- Industry standard for audit trails
- Free tier available (Supabase)

### Why Not Use ChatGPT/Claude API?
- Document AI is specialized for OCR
- Better accuracy on tables
- More reliable than vision models
- But could add LLM for anomaly detection later

---

## 📞 Get Help

**If stuck:**
1. Check `outputs/` folder for error details
2. Run test suite: `python src/test_suite.py`
3. Enable debug logging in `.env`: `LOG_LEVEL=DEBUG`
4. Email: ordersoundsapp@gmail.com

---

## 🏁 Success Criteria

You know it's working when:
- ✅ Test suite passes 100%
- ✅ First CMO report processes successfully
- ✅ Accuracy score >= 99%
- ✅ Excel report looks correct
- ✅ Database has transactions

**Estimated total setup time: 30 minutes**

---

Ready to process royalties at scale 🚀

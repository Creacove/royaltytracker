# OrderSounds Phase 1 MVP - Technical Architecture
## CTO Blueprint for 99%+ Accuracy Royalty Extraction

---

## 🎯 PHASE 1 SCOPE (MVP Definition)

**What We're Building:**
Single-publisher forensic audit pipeline that processes CMO PDF reports and outputs normalized royalty ledger with evidence trails.

**Success Metrics:**
- ✅ 99%+ financial accuracy (gross → net revenue calculation validation)
- ✅ 95%+ OCR accuracy on table extraction
- ✅ Complete evidence linking (every row traceable to source page/coordinates)
- ✅ Process 100-500 page CMO reports in < 5 minutes
- ✅ Output: Clean, queryable Postgres database + Excel export

**What We're NOT Building Yet:**
- ❌ Multi-CMO format adapters (single format first)
- ❌ DSP cross-verification
- ❌ Audio fingerprinting integration
- ❌ Trust scoring engine
- ❌ Automated dispute generation
- ❌ Web UI dashboard (CLI + Excel outputs only)

---

## 🏗️ SYSTEM ARCHITECTURE OVERVIEW

```
┌─────────────────┐
│   PDF Report    │
│   (100-500 pg)  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│  STAGE 1: Document Processing   │
│  - Page splitting               │
│  - Layout-aware OCR             │
│  - Table structure detection    │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  STAGE 2: Table Reconstruction  │
│  - Column header detection      │
│  - Row boundary identification  │
│  - Multi-page table merging     │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  STAGE 3: Data Normalization    │
│  - ISRC/ISWC cleaning           │
│  - Territory standardization    │
│  - Platform name unification    │
│  - Currency normalization       │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  STAGE 4: Financial Validation  │
│  - Row-level math checks        │
│  - Page total reconciliation    │
│  - Report summary validation    │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  STAGE 5: Evidence Linking      │
│  - Bounding box storage         │
│  - Page reference mapping       │
│  - Confidence score tracking    │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│   OUTPUT LAYER                  │
│   - Postgres DB (normalized)    │
│   - Excel ledger (auditable)    │
│   - JSON metadata (traceability)│
└─────────────────────────────────┘
```

---

## 📋 DETAILED STAGE BREAKDOWN

### STAGE 1: Document Processing

**Technology Stack:**
- **Primary:** Google Cloud Document AI (Document OCR API)
- **Fallback:** Tesseract 5.0+ with table detection
- **Storage:** Original PDF + OCR JSON in cloud storage

**Implementation:**

```python
import google.cloud.documentai as documentai
from pathlib import Path
import json

def process_cmo_report(pdf_path: str, output_dir: Path) -> dict:
    """
    Process CMO PDF through Google Document AI
    Returns: {pages: [], tables: [], confidence_scores: {}}
    """
    
    # Initialize Document AI client
    client = documentai.DocumentProcessorServiceClient()
    
    # For Phase 1: Use table-specific processor
    processor_name = "projects/PROJECT/locations/us/processors/TABLE_PROCESSOR_ID"
    
    # Read PDF
    with open(pdf_path, 'rb') as f:
        pdf_bytes = f.read()
    
    # Configure request for table extraction
    document = {"content": pdf_bytes, "mime_type": "application/pdf"}
    request = {
        "name": processor_name,
        "raw_document": document,
        "field_mask": "text,pages,tables,entities",
    }
    
    # Process document
    result = client.process_document(request=request)
    
    # Extract structured data
    ocr_output = {
        'full_text': result.document.text,
        'pages': [],
        'tables': [],
        'metadata': {
            'confidence': result.document.confidence,
            'pages_count': len(result.document.pages)
        }
    }
    
    # Parse tables with layout preservation
    for page_num, page in enumerate(result.document.pages):
        page_data = {
            'page_number': page_num + 1,
            'tables': [],
            'dimensions': {
                'width': page.dimension.width,
                'height': page.dimension.height
            }
        }
        
        # Extract tables from page
        for table in page.tables:
            table_data = extract_table_structure(table, result.document.text)
            page_data['tables'].append(table_data)
        
        ocr_output['pages'].append(page_data)
    
    # Save raw OCR JSON (CRITICAL FOR AUDIT TRAIL)
    output_path = output_dir / f"{Path(pdf_path).stem}_ocr.json"
    with open(output_path, 'w') as f:
        json.dump(ocr_output, f, indent=2)
    
    return ocr_output

def extract_table_structure(table, document_text) -> dict:
    """
    Convert Document AI table to normalized structure
    Preserves bounding boxes for evidence linking
    """
    rows = []
    headers = []
    
    # First row is typically headers
    first_row_cells = [cell for cell in table.header_rows[0].cells] if table.header_rows else []
    
    for cell in first_row_cells:
        header_text = get_text_from_layout(cell.layout, document_text)
        headers.append({
            'text': header_text.strip(),
            'bbox': get_bbox(cell.layout.bounding_poly)
        })
    
    # Extract data rows
    for row in table.body_rows:
        row_data = {}
        for idx, cell in enumerate(row.cells):
            cell_text = get_text_from_layout(cell.layout, document_text)
            column_name = headers[idx]['text'] if idx < len(headers) else f'col_{idx}'
            
            row_data[column_name] = {
                'value': cell_text.strip(),
                'bbox': get_bbox(cell.layout.bounding_poly),
                'confidence': cell.layout.confidence
            }
        
        rows.append(row_data)
    
    return {
        'headers': headers,
        'rows': rows,
        'row_count': len(rows),
        'confidence': table.confidence if hasattr(table, 'confidence') else None
    }

def get_bbox(bounding_poly) -> dict:
    """Extract bounding box coordinates for evidence linking"""
    vertices = bounding_poly.normalized_vertices
    return {
        'x_min': min(v.x for v in vertices),
        'y_min': min(v.y for v in vertices),
        'x_max': max(v.x for v in vertices),
        'y_max': max(v.y for v in vertices)
    }
```

**Key Design Decisions:**

1. **Why Google Document AI over Tesseract?**
   - Native table structure understanding (rows/columns preserved)
   - 95%+ accuracy on dense financial tables
   - Handles multi-column layouts without manual tuning
   - Returns bounding boxes automatically (evidence linking)

2. **Storage Strategy:**
   - Store FULL OCR JSON, not just extracted values
   - Enables re-processing without re-OCR (saves $$ and time)
   - Becomes training data for future model improvements

3. **Page Chunking:**
   - Process 50 pages at a time (Document AI limit: 200 pages)
   - Prevents timeout failures on 500-page reports
   - Allows parallel processing later

---

### STAGE 2: Table Reconstruction

**Challenge:** CMO reports often have:
- Headers only on page 1
- Tables spanning 50+ pages
- Inconsistent row heights
- Merged cells in totals rows

**Solution: Header Memory System**

```python
from typing import List, Dict, Optional
import pandas as pd

class TableReconstructor:
    def __init__(self):
        self.header_memory = None  # Stores last known header schema
        self.current_table_rows = []
        
    def reconstruct_multi_page_table(self, ocr_output: dict) -> pd.DataFrame:
        """
        Merge tables across pages using header memory
        Handles: missing headers, page breaks, total rows
        """
        all_rows = []
        
        for page in ocr_output['pages']:
            for table in page['tables']:
                # Detect if this is a continuation (no headers) or new table
                if self._has_headers(table):
                    # New table starts - save headers
                    self.header_memory = self._extract_header_schema(table)
                    rows = self._parse_table_rows(table, self.header_memory)
                else:
                    # Continuation - use previous headers
                    if self.header_memory is None:
                        raise ValueError(f"Page {page['page_number']}: No header memory available")
                    rows = self._parse_table_rows(table, self.header_memory)
                
                # Filter out total rows (heuristic: all-caps or "TOTAL" keyword)
                data_rows = [r for r in rows if not self._is_total_row(r)]
                all_rows.extend(data_rows)
        
        # Convert to DataFrame with standardized columns
        df = pd.DataFrame(all_rows)
        return self._normalize_column_names(df)
    
    def _has_headers(self, table: dict) -> bool:
        """Detect if table has header row"""
        if not table['headers']:
            return False
        
        # Heuristic: Headers contain keywords like "ISRC", "Revenue", "Territory"
        header_text = ' '.join([h['text'].upper() for h in table['headers']])
        header_keywords = ['ISRC', 'REVENUE', 'TERRITORY', 'PLATFORM', 'TRACK', 'ARTIST']
        return any(kw in header_text for kw in header_keywords)
    
    def _extract_header_schema(self, table: dict) -> List[str]:
        """Extract and normalize header names"""
        headers = []
        for h in table['headers']:
            # Clean header text
            clean_name = h['text'].strip().replace('\n', ' ')
            # Map to standard schema
            standard_name = self._map_to_standard_column(clean_name)
            headers.append(standard_name)
        return headers
    
    def _parse_table_rows(self, table: dict, headers: List[str]) -> List[dict]:
        """Convert table rows to dict records using header schema"""
        rows = []
        for row in table['rows']:
            record = {}
            for idx, col_name in enumerate(headers):
                # Get cell value (handle missing columns)
                cell_key = list(row.keys())[idx] if idx < len(row) else None
                if cell_key:
                    cell_data = row[cell_key]
                    record[col_name] = {
                        'value': cell_data['value'],
                        'bbox': cell_data['bbox'],
                        'confidence': cell_data.get('confidence', 1.0)
                    }
                else:
                    record[col_name] = {'value': None, 'bbox': None, 'confidence': 0}
            
            rows.append(record)
        return rows
    
    def _map_to_standard_column(self, raw_name: str) -> str:
        """
        Map CMO-specific column names to OrderSounds standard schema
        This is where format-specific knowledge lives
        """
        mapping = {
            'ISRC': 'isrc',
            'ISWC': 'iswc',
            'UPC': 'upc',
            'Track Title': 'track_title',
            'Track Artist': 'track_artist',
            'Album': 'release_title',
            'Territory': 'territory',
            'Country': 'territory',
            'Platform': 'platform',
            'DSP': 'platform',
            'Channel': 'platform',
            'Units': 'usage_count',
            'Plays': 'usage_count',
            'Streams': 'usage_count',
            'Gross Revenue': 'gross_revenue',
            'Net Revenue': 'net_revenue',
            'Total Royalty': 'gross_revenue',
            'Commission': 'commission',
            'Your Share': 'publisher_share',
            'Publisher Share': 'publisher_share',
            'Start Date': 'sales_start',
            'End Date': 'sales_end',
        }
        
        # Fuzzy matching for variations
        for key, standard in mapping.items():
            if key.upper() in raw_name.upper():
                return standard
        
        # Return sanitized original if no match
        return raw_name.lower().replace(' ', '_')
    
    def _is_total_row(self, row: dict) -> bool:
        """Detect and filter out summary/total rows"""
        # Check if any column contains "TOTAL" or "SUBTOTAL"
        for col, cell in row.items():
            if cell['value'] and 'TOTAL' in str(cell['value']).upper():
                return True
        return False
    
    def _normalize_column_names(self, df: pd.DataFrame) -> pd.DataFrame:
        """Final column name cleanup"""
        # Ensure all required columns exist
        required_cols = [
            'isrc', 'track_title', 'track_artist', 'territory',
            'platform', 'gross_revenue', 'net_revenue', 'publisher_share'
        ]
        
        for col in required_cols:
            if col not in df.columns:
                df[col] = None
        
        return df[required_cols + [c for c in df.columns if c not in required_cols]]
```

**Critical Feature: Table Fingerprinting**

```python
import hashlib

def generate_table_fingerprint(headers: List[str]) -> str:
    """
    Create hash of column sequence to detect table format
    Enables automatic CMO format detection later
    """
    column_sequence = '|'.join(sorted(headers))
    fingerprint = hashlib.sha256(column_sequence.encode()).hexdigest()[:12]
    return fingerprint

# Store fingerprints in database
# Future: "This is a COSON Nigeria format" auto-detection
```

---

### STAGE 3: Data Normalization

**The Chaos Layer - Where 80% of bugs hide**

```python
import re
from typing import Optional
import pycountry

class RoyaltyNormalizer:
    def __init__(self):
        # Load normalization lookup tables
        self.territory_map = self._load_territory_mappings()
        self.platform_map = self._load_platform_mappings()
        
    def normalize_row(self, row: dict) -> dict:
        """Apply all normalization rules to a single royalty record"""
        normalized = row.copy()
        
        # 1. ISRC Normalization
        normalized['isrc'] = self.normalize_isrc(row.get('isrc', {}).get('value'))
        
        # 2. Territory Standardization
        normalized['territory'] = self.normalize_territory(row.get('territory', {}).get('value'))
        
        # 3. Platform Name Unification
        normalized['platform'] = self.normalize_platform(row.get('platform', {}).get('value'))
        
        # 4. Financial Value Cleaning
        normalized['gross_revenue'] = self.parse_currency(row.get('gross_revenue', {}).get('value'))
        normalized['net_revenue'] = self.parse_currency(row.get('net_revenue', {}).get('value'))
        normalized['commission'] = self.parse_currency(row.get('commission', {}).get('value'))
        normalized['publisher_share'] = self.parse_currency(row.get('publisher_share', {}).get('value'))
        
        # 5. String Cleaning
        normalized['track_title'] = self.clean_string(row.get('track_title', {}).get('value'))
        normalized['track_artist'] = self.clean_string(row.get('track_artist', {}).get('value'))
        
        return normalized
    
    def normalize_isrc(self, isrc: Optional[str]) -> Optional[str]:
        """
        ISRC format: CC-XXX-YY-NNNNN
        Common issues:
        - Missing hyphens: CCXXXYYNNNNN
        - Extra spaces: CC - XXX - YY - NNNNN
        - Wrong case: cc-xxx-yy-nnnnn
        """
        if not isrc:
            return None
        
        # Remove all non-alphanumeric
        clean = re.sub(r'[^A-Z0-9]', '', isrc.upper())
        
        # Validate length
        if len(clean) != 12:
            return None  # Invalid ISRC
        
        # Reformat: CC-XXX-YY-NNNNN
        formatted = f"{clean[0:2]}-{clean[2:5]}-{clean[5:7]}-{clean[7:12]}"
        
        # Validate country code
        if not self._is_valid_country_code(clean[0:2]):
            return None
        
        return formatted
    
    def normalize_territory(self, territory: Optional[str]) -> Optional[str]:
        """
        Standardize to ISO 3166-1 alpha-2 codes
        Handles: UK → GB, USA → US, United Kingdom → GB
        """
        if not territory:
            return None
        
        clean = territory.strip().upper()
        
        # Check lookup table first
        if clean in self.territory_map:
            return self.territory_map[clean]
        
        # Try pycountry fuzzy match
        try:
            country = pycountry.countries.search_fuzzy(clean)[0]
            return country.alpha_2
        except LookupError:
            return clean  # Store as-is if can't resolve
    
    def normalize_platform(self, platform: Optional[str]) -> Optional[str]:
        """
        Unify platform naming variations
        Spotify Premium → Spotify
        Apple Music Streaming → Apple Music
        """
        if not platform:
            return None
        
        clean = platform.strip()
        
        # Check exact match first
        if clean in self.platform_map:
            return self.platform_map[clean]
        
        # Fuzzy matching for common patterns
        lower = clean.lower()
        if 'spotify' in lower:
            return 'Spotify'
        elif 'apple' in lower and 'music' in lower:
            return 'Apple Music'
        elif 'youtube' in lower:
            return 'YouTube'
        elif 'deezer' in lower:
            return 'Deezer'
        elif 'tidal' in lower:
            return 'Tidal'
        
        return clean  # Store original if unknown
    
    def parse_currency(self, value: Optional[str]) -> Optional[float]:
        """
        Extract numeric value from currency strings
        Handles: $1,234.56, 1234.56, (1234.56), €1.234,56
        """
        if not value:
            return None
        
        # Handle parentheses (negative)
        is_negative = '(' in value and ')' in value
        
        # Remove currency symbols and whitespace
        clean = re.sub(r'[^\d.,\-]', '', value)
        
        # Handle European format (comma as decimal)
        if ',' in clean and '.' in clean:
            # Determine which is decimal separator
            if clean.rindex(',') > clean.rindex('.'):
                # European: 1.234,56
                clean = clean.replace('.', '').replace(',', '.')
            else:
                # US: 1,234.56
                clean = clean.replace(',', '')
        elif ',' in clean:
            # Could be European decimal or US thousands separator
            # Heuristic: if more than 3 digits after comma, it's decimal
            parts = clean.split(',')
            if len(parts[-1]) > 2:
                clean = clean.replace(',', '.')
            else:
                clean = clean.replace(',', '')
        
        try:
            amount = float(clean)
            return -amount if is_negative else amount
        except ValueError:
            return None
    
    def clean_string(self, value: Optional[str]) -> Optional[str]:
        """Remove extra whitespace, fix encoding issues"""
        if not value:
            return None
        
        # Collapse multiple spaces
        clean = re.sub(r'\s+', ' ', value.strip())
        
        # Fix common encoding issues
        clean = clean.replace('\u2019', "'")  # Right single quote
        clean = clean.replace('\u2013', "-")  # En dash
        
        return clean
    
    def _load_territory_mappings(self) -> dict:
        """Load territory aliases from configuration"""
        return {
            'UK': 'GB',
            'USA': 'US',
            'UNITED STATES': 'US',
            'UNITED KINGDOM': 'GB',
            'ENGLAND': 'GB',
            'SCOTLAND': 'GB',
            'WALES': 'GB',
            'NORTHERN IRELAND': 'GB',
            'SOUTH KOREA': 'KR',
            'KOREA': 'KR',
            # Add more as discovered during processing
        }
    
    def _load_platform_mappings(self) -> dict:
        """Load platform name variations from configuration"""
        return {
            'Spotify Premium': 'Spotify',
            'Spotify Free': 'Spotify',
            'Spotify Streaming': 'Spotify',
            'Apple Music Streaming': 'Apple Music',
            'YouTube Music': 'YouTube',
            'YouTube Content ID': 'YouTube',
            # Add more as discovered
        }
```

---

### STAGE 4: Financial Validation

**This is what gets you to 99% accuracy**

```python
from dataclasses import dataclass
from typing import List, Dict
import pandas as pd

@dataclass
class ValidationError:
    row_id: int
    error_type: str
    expected: float
    actual: float
    deviation: float
    severity: str  # 'critical', 'warning', 'info'

class FinancialValidator:
    def __init__(self, tolerance: float = 0.01):
        """
        tolerance: Acceptable deviation due to rounding (default 1 cent)
        """
        self.tolerance = tolerance
        self.errors: List[ValidationError] = []
    
    def validate_report(self, df: pd.DataFrame) -> Dict:
        """
        Run all validation checks
        Returns: {
            'passed': bool,
            'error_count': int,
            'errors': List[ValidationError],
            'accuracy_score': float
        }
        """
        self.errors = []
        
        # Row-level validations
        self._validate_row_math(df)
        
        # Page-level validations (if page totals available)
        # self._validate_page_totals(df)
        
        # Report-level validations
        self._validate_report_totals(df)
        
        # Calculate accuracy score
        total_rows = len(df)
        critical_errors = len([e for e in self.errors if e.severity == 'critical'])
        accuracy = ((total_rows - critical_errors) / total_rows) * 100
        
        return {
            'passed': critical_errors == 0,
            'accuracy_score': accuracy,
            'error_count': len(self.errors),
            'errors': self.errors
        }
    
    def _validate_row_math(self, df: pd.DataFrame):
        """
        Validate: gross_revenue - commission = net_revenue
        AND: net_revenue * split_percentage = publisher_share
        """
        for idx, row in df.iterrows():
            gross = row.get('gross_revenue')
            commission = row.get('commission')
            net = row.get('net_revenue')
            share = row.get('publisher_share')
            
            # Check: gross - commission = net
            if all(pd.notna([gross, commission, net])):
                expected_net = gross - commission
                deviation = abs(expected_net - net)
                
                if deviation > self.tolerance:
                    self.errors.append(ValidationError(
                        row_id=idx,
                        error_type='net_revenue_mismatch',
                        expected=expected_net,
                        actual=net,
                        deviation=deviation,
                        severity='critical' if deviation > 1.0 else 'warning'
                    ))
            
            # Check: net = publisher_share (if 100% ownership)
            # Or validate split percentage if available
            if all(pd.notna([net, share])):
                if 'split_percentage' in row and pd.notna(row['split_percentage']):
                    expected_share = net * row['split_percentage']
                else:
                    expected_share = net  # Assume 100%
                
                deviation = abs(expected_share - share)
                if deviation > self.tolerance:
                    self.errors.append(ValidationError(
                        row_id=idx,
                        error_type='publisher_share_mismatch',
                        expected=expected_share,
                        actual=share,
                        deviation=deviation,
                        severity='warning'
                    ))
    
    def _validate_report_totals(self, df: pd.DataFrame):
        """
        Validate sum of all rows matches report summary (if available)
        This requires extracting total from PDF separately
        """
        # Placeholder for when summary extraction is added
        pass
    
    def generate_validation_report(self) -> str:
        """Generate human-readable validation report"""
        if not self.errors:
            return "✅ All financial validations passed"
        
        report = f"⚠️  {len(self.errors)} validation errors found:\n\n"
        
        # Group by error type
        by_type = {}
        for error in self.errors:
            by_type.setdefault(error.error_type, []).append(error)
        
        for error_type, errors in by_type.items():
            report += f"{error_type}: {len(errors)} occurrences\n"
            # Show first 3 examples
            for err in errors[:3]:
                report += f"  Row {err.row_id}: Expected {err.expected:.2f}, got {err.actual:.2f} (Δ {err.deviation:.2f})\n"
        
        return report
```

---

### STAGE 5: Evidence Linking

**Legal-grade traceability**

```python
import uuid
from datetime import datetime

class EvidenceLinker:
    def __init__(self, ocr_json_path: str, pdf_path: str):
        self.ocr_json_path = ocr_json_path
        self.pdf_path = pdf_path
        self.document_id = str(uuid.uuid4())
        
    def create_evidence_record(self, row_data: dict, row_index: int, page_num: int) -> dict:
        """
        Create comprehensive evidence record for single royalty transaction
        """
        evidence = {
            # Unique identifiers
            'transaction_id': str(uuid.uuid4()),
            'document_id': self.document_id,
            
            # Source references
            'source_pdf': self.pdf_path,
            'source_ocr_json': self.ocr_json_path,
            'page_number': page_num,
            'row_position': row_index,
            
            # Bounding box coordinates (for visual highlighting)
            'bounding_boxes': self._extract_bounding_boxes(row_data),
            
            # Confidence scores
            'ocr_confidence': self._calculate_row_confidence(row_data),
            
            # Timestamps
            'extracted_at': datetime.utcnow().isoformat(),
            
            # Financial data snapshot (immutable)
            'financial_snapshot': {
                'gross_revenue': row_data.get('gross_revenue'),
                'net_revenue': row_data.get('net_revenue'),
                'commission': row_data.get('commission'),
                'publisher_share': row_data.get('publisher_share')
            },
            
            # Metadata snapshot
            'metadata_snapshot': {
                'isrc': row_data.get('isrc'),
                'track_title': row_data.get('track_title'),
                'platform': row_data.get('platform'),
                'territory': row_data.get('territory')
            }
        }
        
        return evidence
    
    def _extract_bounding_boxes(self, row_data: dict) -> dict:
        """Extract bounding box for each cell in row"""
        boxes = {}
        for col_name, cell_data in row_data.items():
            if isinstance(cell_data, dict) and 'bbox' in cell_data:
                boxes[col_name] = cell_data['bbox']
        return boxes
    
    def _calculate_row_confidence(self, row_data: dict) -> float:
        """Average confidence score across all cells"""
        confidences = []
        for col_name, cell_data in row_data.items():
            if isinstance(cell_data, dict) and 'confidence' in cell_data:
                confidences.append(cell_data['confidence'])
        
        return sum(confidences) / len(confidences) if confidences else 0.0
```

---

## 💾 DATABASE SCHEMA

```sql
-- Document metadata table
CREATE TABLE cmo_reports (
    document_id UUID PRIMARY KEY,
    original_filename VARCHAR(255) NOT NULL,
    cmo_name VARCHAR(100),  -- e.g., "COSON Nigeria"
    report_period_start DATE,
    report_period_end DATE,
    total_pages INTEGER,
    processing_status VARCHAR(50),
    uploaded_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    table_fingerprint VARCHAR(12),  -- For format detection
    
    -- File storage references
    pdf_storage_path VARCHAR(500),
    ocr_json_path VARCHAR(500),
    
    -- Processing metadata
    ocr_confidence_avg DECIMAL(5,4),
    validation_errors_count INTEGER,
    accuracy_score DECIMAL(5,2)
);

-- Royalty transactions table (THE CORE LEDGER)
CREATE TABLE royalty_transactions (
    transaction_id UUID PRIMARY KEY,
    document_id UUID REFERENCES cmo_reports(document_id),
    
    -- Source evidence
    page_number INTEGER NOT NULL,
    row_position INTEGER NOT NULL,
    bounding_boxes JSONB,  -- Store all cell coordinates
    ocr_confidence DECIMAL(5,4),
    
    -- Normalized identifiers
    isrc VARCHAR(15),
    iswc VARCHAR(15),
    upc VARCHAR(20),
    
    -- Track metadata
    track_title VARCHAR(500),
    track_artist VARCHAR(500),
    release_title VARCHAR(500),
    
    -- Usage context
    platform VARCHAR(100),
    territory CHAR(2),  -- ISO 3166-1 alpha-2
    usage_count INTEGER,
    sales_start DATE,
    sales_end DATE,
    
    -- Financial data
    gross_revenue DECIMAL(12,4),
    commission DECIMAL(12,4),
    net_revenue DECIMAL(12,4),
    publisher_share DECIMAL(12,4),
    currency CHAR(3) DEFAULT 'USD',
    
    -- Validation status
    validation_passed BOOLEAN,
    validation_errors JSONB,
    
    -- Timestamps
    extracted_at TIMESTAMP DEFAULT NOW(),
    
    -- Indexes for fast querying
    INDEX idx_isrc (isrc),
    INDEX idx_document (document_id),
    INDEX idx_platform (platform),
    INDEX idx_territory (territory),
    INDEX idx_period (sales_start, sales_end)
);

-- Validation errors table (for detailed error tracking)
CREATE TABLE validation_errors (
    error_id UUID PRIMARY KEY,
    transaction_id UUID REFERENCES royalty_transactions(transaction_id),
    error_type VARCHAR(50),
    expected_value DECIMAL(12,4),
    actual_value DECIMAL(12,4),
    deviation DECIMAL(12,4),
    severity VARCHAR(20),
    detected_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🚀 MVP IMPLEMENTATION PLAN

### Week 1: Foundation
- [ ] Set up Google Cloud Document AI project
- [ ] Create Postgres database schema
- [ ] Build PDF → OCR → JSON pipeline
- [ ] Test on 10-page sample CMO report

### Week 2: Table Reconstruction
- [ ] Implement header memory system
- [ ] Build multi-page table merger
- [ ] Test on 50-page report
- [ ] Validate table structure accuracy

### Week 3: Normalization Engine
- [ ] Build ISRC/territory/platform normalizers
- [ ] Create lookup tables for common variations
- [ ] Test on messy real-world data
- [ ] Achieve 95%+ normalization accuracy

### Week 4: Validation & Evidence
- [ ] Implement financial validation rules
- [ ] Build evidence linking system
- [ ] Create Excel export with audit trail
- [ ] Run end-to-end test on full 100-page report

### Week 5: Polish & Testing
- [ ] Edge case handling (missing data, malformed tables)
- [ ] Error recovery mechanisms
- [ ] Performance optimization (target: <5 min for 500 pages)
- [ ] Documentation

---

## 🎯 SUCCESS METRICS (Phase 1 Exit Criteria)

1. **Accuracy:**
   - ✅ 99%+ financial validation pass rate
   - ✅ 95%+ OCR accuracy on table extraction
   - ✅ <1% row-level math errors

2. **Performance:**
   - ✅ Process 100-page report in <2 minutes
   - ✅ Process 500-page report in <5 minutes

3. **Traceability:**
   - ✅ Every transaction links to source page/coordinates
   - ✅ Bounding boxes stored for visual verification
   - ✅ Confidence scores available for every extraction

4. **Deliverables:**
   - ✅ Postgres database with normalized ledger
   - ✅ Excel export with evidence trail
   - ✅ JSON metadata for each report
   - ✅ Validation report showing accuracy metrics

---

## 💰 ESTIMATED COSTS (Phase 1)

**Google Cloud Document AI:**
- $0.065 per page (table extraction)
- 500-page report = $32.50
- Budget: $500/month = ~15 reports

**Postgres Database:**
- Supabase free tier: 500MB (sufficient for MVP)
- Upgrade: $25/month for 8GB

**Development:**
- 0-code approach using Python scripts
- No UI development needed (CLI + Excel)

**Total Monthly: ~$525**

---

## 🔧 TECH STACK SUMMARY

| Component | Technology | Why |
|-----------|-----------|-----|
| OCR | Google Document AI | Best-in-class table extraction |
| Data Processing | Python + pandas | Fast, battle-tested |
| Database | PostgreSQL (Supabase) | JSONB support for evidence |
| File Storage | Google Cloud Storage | Integrated with Document AI |
| Validation | Custom Python logic | Domain-specific rules |
| Output | openpyxl (Excel) + JSON | Auditor-friendly |
| Orchestration | Python scripts (CLI) | Simple, debuggable |

---

## 🚨 CRITICAL SUCCESS FACTORS

1. **Test on REAL data immediately**
   - Don't build in theory
   - Get actual CMO report from Nexus today
   - Iterate on real edge cases

2. **Store everything**
   - Raw PDF ✅
   - OCR JSON ✅
   - Normalized data ✅
   - Validation errors ✅
   - Never throw away data

3. **Build for auditability first**
   - Humans will verify your work
   - Make it EASY to trace any number back to source
   - Bounding boxes are non-negotiable

4. **Start narrow, then expand**
   - Single CMO format first
   - Single publisher first
   - Don't generalize until you've solved one case perfectly

---

## NEXT IMMEDIATE STEPS

1. **Get sample CMO report from Nexus** (100-500 pages)
2. **Set up Google Cloud account** + enable Document AI API
3. **Create Supabase project** + run schema SQL
4. **Run first OCR test** on 10 pages
5. **Build table reconstruction** on those 10 pages
6. **Measure accuracy** against manual audit

**Timeline: 4 weeks to working MVP**

Ready to start building?

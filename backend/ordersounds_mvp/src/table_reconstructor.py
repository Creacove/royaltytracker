"""
OrderSounds Table Reconstructor
Merges multi-page tables and normalizes column schemas
"""

import pandas as pd
from typing import List, Dict, Optional
import re

class TableReconstructor:
    """
    Reconstructs complete tables from multi-page OCR output
    Handles: header memory, page breaks, schema normalization
    """
    
    # Standard OrderSounds schema mapping
    COLUMN_MAPPINGS = {
        'ISRC': 'isrc',
        'ISWC': 'iswc',
        'UPC': 'upc',
        'TRACK TITLE': 'track_title',
        'TRACK': 'track_title',
        'SONG': 'track_title',
        'TITLE': 'track_title',
        'TRACK ARTIST': 'track_artist',
        'ARTIST': 'track_artist',
        'ALBUM': 'release_title',
        'RELEASE': 'release_title',
        'TERRITORY': 'territory',
        'COUNTRY': 'territory',
        'PLATFORM': 'platform',
        'DSP': 'platform',
        'SERVICE': 'platform',
        'CHANNEL': 'platform',
        'UNITS': 'usage_count',
        'PLAYS': 'usage_count',
        'STREAMS': 'usage_count',
        'QUANTITY': 'usage_count',
        'GROSS REVENUE': 'gross_revenue',
        'GROSS': 'gross_revenue',
        'TOTAL REVENUE': 'gross_revenue',
        'NET REVENUE': 'net_revenue',
        'NET': 'net_revenue',
        'COMMISSION': 'commission',
        'FEE': 'commission',
        'YOUR SHARE': 'publisher_share',
        'PUBLISHER SHARE': 'publisher_share',
        'SHARE': 'publisher_share',
        'START DATE': 'sales_start',
        'SALES START': 'sales_start',
        'END DATE': 'sales_end',
        'SALES END': 'sales_end',
        'REPORT DATE': 'report_date',
        'LABEL': 'label_name',
        'PUBLISHER': 'publisher_name',
    }
    
    # Keywords that indicate header rows
    HEADER_KEYWORDS = [
        'ISRC', 'REVENUE', 'TERRITORY', 'PLATFORM', 'TRACK', 
        'ARTIST', 'TITLE', 'STREAM', 'PLAY', 'USAGE'
    ]
    
    def __init__(self):
        self.header_memory: Optional[List[str]] = None
        self.current_page = 0
    
    def reconstruct_from_ocr(self, ocr_output: Dict) -> pd.DataFrame:
        """
        Main entry point: convert OCR JSON to normalized DataFrame
        
        Args:
            ocr_output: Dictionary from OCR processor
            
        Returns:
            Pandas DataFrame with normalized royalty transactions
        """
        all_rows = []
        
        for page in ocr_output['pages']:
            self.current_page = page['page_number']
            
            for table in page['tables']:
                # Determine if this table has headers or is a continuation
                has_headers = self._detect_headers(table)
                
                if has_headers:
                    # New table - update header memory
                    self.header_memory = self._extract_header_schema(table)
                    print(f"  Page {self.current_page}: Found header row with {len(self.header_memory)} columns")
                elif self.header_memory is None:
                    print(f"  ⚠️  Page {self.current_page}: No header memory, skipping table")
                    continue
                
                # Parse rows using current header schema
                rows = self._parse_table_rows(table, self.header_memory, self.current_page)
                
                # Filter out total/summary rows
                data_rows = [r for r in rows if not self._is_summary_row(r)]
                
                all_rows.extend(data_rows)
        
        # Convert to DataFrame
        if not all_rows:
            print("⚠️  No data rows extracted")
            return pd.DataFrame()
        
        df = pd.DataFrame(all_rows)
        
        print(f"\n✅ Reconstructed {len(df)} total transactions")
        return df
    
    def _detect_headers(self, table: Dict) -> bool:
        """Detect if table contains header row"""
        if not table.get('headers'):
            return False
        
        # Check if headers contain expected keywords
        header_text = ' '.join([h['text'].upper() for h in table['headers']])
        
        keyword_count = sum(1 for kw in self.HEADER_KEYWORDS if kw in header_text)
        
        # Require at least 3 header keywords to consider it a real header row
        return keyword_count >= 3
    
    def _extract_header_schema(self, table: Dict) -> List[str]:
        """Extract and normalize header names from table"""
        headers = []
        
        for header_cell in table['headers']:
            raw_name = header_cell['text'].strip()
            
            # Map to standard column name
            standard_name = self._map_column_name(raw_name)
            headers.append(standard_name)
        
        return headers
    
    def _map_column_name(self, raw_name: str) -> str:
        """Map CMO-specific column names to OrderSounds standard schema"""
        # Clean the name
        clean = raw_name.upper().strip()
        
        # Try exact match first
        if clean in self.COLUMN_MAPPINGS:
            return self.COLUMN_MAPPINGS[clean]
        
        # Try fuzzy matching (contains)
        for pattern, standard in self.COLUMN_MAPPINGS.items():
            if pattern in clean:
                return standard
        
        # If no match, sanitize and return original
        sanitized = raw_name.lower().strip()
        sanitized = re.sub(r'[^a-z0-9_]', '_', sanitized)
        sanitized = re.sub(r'_+', '_', sanitized)  # Collapse multiple underscores
        
        return sanitized
    
    def _parse_table_rows(self, table: Dict, headers: List[str], page_num: int) -> List[Dict]:
        """Convert table rows to dictionary records"""
        rows = []
        
        for row_idx, row_data in enumerate(table['rows']):
            record = {
                '_page_number': page_num,
                '_row_position': row_idx,
            }
            
            # Map each cell to its header
            for col_idx, header_name in enumerate(headers):
                # Get cell from row (handle column count mismatches)
                row_keys = list(row_data.keys())
                
                if col_idx < len(row_keys):
                    cell_key = row_keys[col_idx]
                    cell_data = row_data[cell_key]
                    
                    record[header_name] = cell_data['value']
                    record[f'{header_name}_bbox'] = cell_data['bbox']
                    record[f'{header_name}_confidence'] = cell_data.get('confidence', 1.0)
                else:
                    # Column missing in this row
                    record[header_name] = None
                    record[f'{header_name}_bbox'] = None
                    record[f'{header_name}_confidence'] = 0.0
            
            rows.append(record)
        
        return rows
    
    def _is_summary_row(self, row: Dict) -> bool:
        """
        Detect if row is a summary/total row (should be filtered out)
        
        Heuristics:
        - Contains "TOTAL", "SUBTOTAL", "SUM" in any field
        - All-caps text
        - Missing key identifiers (ISRC, track title)
        """
        # Check for total keywords
        for key, value in row.items():
            if isinstance(value, str) and value:
                upper_val = value.upper()
                if any(kw in upper_val for kw in ['TOTAL', 'SUBTOTAL', 'SUM', 'GRAND']):
                    return True
        
        # Check if missing critical identifiers
        has_isrc = row.get('isrc') and row.get('isrc') not in ['', None, 'None']
        has_track = row.get('track_title') and row.get('track_title') not in ['', None, 'None']
        
        # If missing both ISRC and track title, likely a summary row
        if not has_isrc and not has_track:
            return True
        
        return False


def merge_bounding_boxes(df: pd.DataFrame) -> pd.DataFrame:
    """
    Collect all bounding boxes for a row into a single JSONB field
    This is critical for evidence linking
    """
    bbox_cols = [col for col in df.columns if col.endswith('_bbox')]
    
    def collect_boxes(row):
        boxes = {}
        for col in bbox_cols:
            field_name = col.replace('_bbox', '')
            if row[col] is not None:
                boxes[field_name] = row[col]
        return boxes
    
    df['bounding_boxes'] = df.apply(collect_boxes, axis=1)
    
    # Drop individual bbox columns (keep in bounding_boxes JSON)
    df = df.drop(columns=bbox_cols)
    
    return df


def calculate_row_confidence(df: pd.DataFrame) -> pd.DataFrame:
    """Calculate average OCR confidence across all fields in each row"""
    confidence_cols = [col for col in df.columns if col.endswith('_confidence')]
    
    def avg_confidence(row):
        confidences = [row[col] for col in confidence_cols if row[col] is not None and row[col] > 0]
        return sum(confidences) / len(confidences) if confidences else 0.0
    
    df['ocr_confidence'] = df.apply(avg_confidence, axis=1)
    
    # Drop individual confidence columns
    df = df.drop(columns=confidence_cols)
    
    return df


if __name__ == '__main__':
    # Example usage
    import json
    from pathlib import Path
    
    # Load OCR output
    ocr_file = Path('outputs/ocr/sample_report_ocr.json')
    with open(ocr_file) as f:
        ocr_output = json.load(f)
    
    # Reconstruct tables
    reconstructor = TableReconstructor()
    df = reconstructor.reconstruct_from_ocr(ocr_output)
    
    # Add evidence linking
    df = merge_bounding_boxes(df)
    df = calculate_row_confidence(df)
    
    print(f"\n📊 DataFrame shape: {df.shape}")
    print(f"Columns: {list(df.columns)}")
    print(f"\nFirst row:\n{df.iloc[0]}")

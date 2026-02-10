"""
OrderSounds OCR Processor
Handles PDF → Google Document AI → Structured JSON
"""

import os
import json
from pathlib import Path
from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
from google.cloud import documentai_v1 as documentai
import hashlib
from pypdf import PdfReader, PdfWriter

@dataclass
class BoundingBox:
    x_min: float
    y_min: float
    x_max: float
    y_max: float

@dataclass
class TableCell:
    value: str
    bbox: BoundingBox
    confidence: float

@dataclass
class TableRow:
    cells: Dict[str, TableCell]
    row_index: int

@dataclass
class TableStructure:
    headers: List[str]
    rows: List[TableRow]
    page_number: int
    confidence: float

class OCRProcessor:
    def __init__(
        self,
        project_id: str,
        location: str,
        processor_id: str,
        credentials_path: Optional[str] = None
    ):
        """
        Initialize Google Document AI client
        
        Args:
            project_id: GCP project ID
            location: Processor location (us or eu)
            processor_id: Document AI processor ID
            credentials_path: Path to service account JSON (or set GOOGLE_APPLICATION_CREDENTIALS env var)
        """
        if credentials_path:
            os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credentials_path
        
        self.project_id = project_id
        self.location = location
        self.processor_id = processor_id
        self.client = documentai.DocumentProcessorServiceClient()
        self.processor_name = f"projects/{project_id}/locations/{location}/processors/{processor_id}"
    
    def process_pdf(self, pdf_path: str, output_dir: Path) -> Dict:
        """
        Process PDF through Document AI and save structured output.

        Automatically chunks large PDFs to respect Document AI page limits.
        """
        print(f"📄 Processing: {pdf_path}")

        output_dir.mkdir(parents=True, exist_ok=True)
        max_pages = int(os.getenv('OCR_MAX_PAGES', '200'))
        total_pages = self._count_pages(pdf_path)

        if total_pages <= max_pages:
            ocr_output = self._process_pdf_file(pdf_path, page_offset=0)
        else:
            print(f"⚠️  Large PDF detected ({total_pages} pages). Chunking into {max_pages}-page segments.")
            chunk_dir = output_dir / "chunks"
            chunk_dir.mkdir(parents=True, exist_ok=True)
            chunk_paths = self._split_pdf(pdf_path, chunk_dir, max_pages)

            ocr_output = self._init_aggregate_output()
            for idx, chunk_path in enumerate(chunk_paths):
                page_offset = idx * max_pages
                chunk_output = self._process_pdf_file(chunk_path, page_offset=page_offset)
                self._merge_outputs(
                    ocr_output,
                    chunk_output,
                    {
                        "chunk_index": idx,
                        "chunk_path": str(chunk_path),
                        "start_page": page_offset + 1,
                        "end_page": min(page_offset + max_pages, total_pages),
                    },
                )

            # Finalize confidence average
            confidence_sum = ocr_output["metadata"].pop("confidence_sum", 0.0)
            confidence_pages = ocr_output["metadata"].pop("confidence_pages", 0)
            ocr_output["metadata"]["confidence"] = (
                confidence_sum / confidence_pages if confidence_pages else 0.0
            )

        # Save OCR JSON
        output_path = output_dir / f"{Path(pdf_path).stem}_ocr.json"
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(ocr_output, f, indent=2, ensure_ascii=False)

        print(f"✅ OCR complete: {len(ocr_output['pages'])} pages, {len(ocr_output['all_tables'])} tables")
        print(f"📁 Saved to: {output_path}")

        return ocr_output
    
    def _process_pdf_file(self, pdf_path: str, page_offset: int = 0) -> Dict:
        """Process a single PDF file (or chunk)."""
        with open(pdf_path, 'rb') as f:
            pdf_bytes = f.read()

        raw_document = documentai.RawDocument(
            content=pdf_bytes,
            mime_type='application/pdf'
        )

        request = documentai.ProcessRequest(
            name=self.processor_name,
            raw_document=raw_document
        )

        print("🔍 Running OCR...")
        result = self.client.process_document(request=request)
        document = result.document
        return self._extract_structure(document, page_offset=page_offset)

    def _init_aggregate_output(self) -> Dict:
        return {
            'full_text': '',
            'pages': [],
            'all_tables': [],
            'metadata': {
                'total_pages': 0,
                'confidence': 0.0,
                'chunks': [],
                'confidence_sum': 0.0,
                'confidence_pages': 0,
            }
        }

    def _merge_outputs(self, aggregate: Dict, chunk_output: Dict, chunk_info: Dict):
        if chunk_output.get('full_text'):
            aggregate['full_text'] += chunk_output['full_text'] + "\n"
        aggregate['pages'].extend(chunk_output.get('pages', []))
        aggregate['all_tables'].extend(chunk_output.get('all_tables', []))

        aggregate['metadata']['total_pages'] += chunk_output['metadata'].get('total_pages', 0)
        aggregate['metadata']['chunks'].append(chunk_info)

        # Weighted confidence average
        pages = chunk_output['metadata'].get('total_pages', 0)
        confidence = chunk_output['metadata'].get('confidence', 0.0)
        aggregate['metadata']['confidence_sum'] += confidence * pages
        aggregate['metadata']['confidence_pages'] += pages

    def _count_pages(self, pdf_path: str) -> int:
        reader = PdfReader(pdf_path)
        return len(reader.pages)

    def _split_pdf(self, pdf_path: str, output_dir: Path, max_pages: int) -> List[Path]:
        reader = PdfReader(pdf_path)
        total_pages = len(reader.pages)

        chunk_paths: List[Path] = []
        for start in range(0, total_pages, max_pages):
            writer = PdfWriter()
            end = min(start + max_pages, total_pages)
            for page_index in range(start, end):
                writer.add_page(reader.pages[page_index])

            chunk_path = output_dir / f"{Path(pdf_path).stem}_chunk_{start+1}-{end}.pdf"
            with open(chunk_path, 'wb') as f:
                writer.write(f)
            chunk_paths.append(chunk_path)

        return chunk_paths

    def _extract_structure(self, document: documentai.Document, page_offset: int = 0) -> Dict:
        """Extract tables and text from Document AI response"""

        page_confidences = [
            page.layout.confidence
            for page in document.pages
            if getattr(page, "layout", None) is not None
        ]
        avg_confidence = sum(page_confidences) / len(page_confidences) if page_confidences else 0.0

        ocr_output = {
            'full_text': document.text,
            'pages': [],
            'all_tables': [],
            'metadata': {
                'total_pages': len(document.pages),
                'confidence': avg_confidence
            }
        }

        for page_index, page in enumerate(document.pages, start=1):
            page_num = page_offset + page_index
            page_data = {
                'page_number': page_num,
                'dimensions': {
                    'width': page.dimension.width,
                    'height': page.dimension.height
                },
                'tables': []
            }

            # Extract tables from page
            for table in page.tables:
                table_structure = self._parse_table(table, document.text, page_num)
                page_data['tables'].append(table_structure)
                ocr_output['all_tables'].append(table_structure)

            ocr_output['pages'].append(page_data)

        return ocr_output
    
    def _parse_table(self, table, document_text: str, page_num: int) -> Dict:
        """Parse Document AI table into structured format"""
        
        # Extract headers (first row)
        headers = []
        if table.header_rows:
            for cell in table.header_rows[0].cells:
                header_text = self._get_text_from_layout(cell.layout, document_text)
                bbox = self._get_bbox(cell.layout.bounding_poly)
                headers.append({
                    'text': header_text.strip(),
                    'bbox': asdict(bbox)
                })
        
        # Extract data rows
        rows = []
        for row_idx, row in enumerate(table.body_rows):
            row_data = {}
            for col_idx, cell in enumerate(row.cells):
                cell_text = self._get_text_from_layout(cell.layout, document_text)
                bbox = self._get_bbox(cell.layout.bounding_poly)
                
                # Use header name if available, otherwise col_N
                column_name = headers[col_idx]['text'] if col_idx < len(headers) else f'col_{col_idx}'
                
                row_data[column_name] = {
                    'value': cell_text.strip(),
                    'bbox': asdict(bbox),
                    'confidence': cell.layout.confidence
                }
            
            rows.append(row_data)
        
        return {
            'page_number': page_num,
            'headers': headers,
            'rows': rows,
            'row_count': len(rows),
            'confidence': table.body_rows[0].cells[0].layout.confidence if table.body_rows else 0
        }
    
    def _get_text_from_layout(self, layout, document_text: str) -> str:
        """Extract text from layout using text anchors"""
        if not layout.text_anchor.text_segments:
            return ""
        
        text = ""
        for segment in layout.text_anchor.text_segments:
            start_index = int(segment.start_index) if segment.start_index else 0
            end_index = int(segment.end_index)
            text += document_text[start_index:end_index]
        
        return text
    
    def _get_bbox(self, bounding_poly) -> BoundingBox:
        """Extract bounding box from polygon"""
        vertices = bounding_poly.normalized_vertices
        
        return BoundingBox(
            x_min=min(v.x for v in vertices),
            y_min=min(v.y for v in vertices),
            x_max=max(v.x for v in vertices),
            y_max=max(v.y for v in vertices)
        )

def generate_table_fingerprint(headers: List[str]) -> str:
    """
    Generate unique fingerprint for table format
    Used for automatic CMO format detection
    """
    # Sort headers to make fingerprint order-independent
    sorted_headers = sorted([h.lower().strip() for h in headers])
    header_string = '|'.join(sorted_headers)
    
    # Generate short hash
    fingerprint = hashlib.sha256(header_string.encode()).hexdigest()[:12]
    return fingerprint


if __name__ == '__main__':
    # Example usage
    from dotenv import load_dotenv
    load_dotenv()
    
    processor = OCRProcessor(
        project_id=os.getenv('GOOGLE_CLOUD_PROJECT'),
        location=os.getenv('DOCUMENTAI_LOCATION', 'us'),
        processor_id=os.getenv('DOCUMENTAI_PROCESSOR_ID')
    )
    
    # Process test PDF
    pdf_path = 'data/sample_cmo_report.pdf'
    output_dir = Path('outputs/ocr')
    output_dir.mkdir(parents=True, exist_ok=True)
    
    result = processor.process_pdf(pdf_path, output_dir)
    print(f"\n📊 Extracted {len(result['all_tables'])} tables")

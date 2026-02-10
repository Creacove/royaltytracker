"""
OrderSounds Database Writer
Persists processed reports and transactions into PostgreSQL.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Dict, Iterable, List, Optional

import pandas as pd
from sqlalchemy import create_engine, text


DEFAULT_CHUNK_SIZE = 5000


class DatabaseWriter:
    def __init__(self, database_url: str):
        if not database_url:
            raise ValueError("DATABASE_URL is required for database ingestion")
        self.database_url = database_url
        self.engine = create_engine(database_url)

    def write_report(
        self,
        df: pd.DataFrame,
        *,
        document_id: str,
        pdf_path: str,
        ocr_json_path: str,
        cmo_name: Optional[str],
        table_fingerprint: Optional[str],
        table_headers: Optional[List[str]],
        validation_result: Dict,
        processing_time_seconds: float,
        report_metadata: Optional[Dict] = None,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
    ) -> Dict:
        """
        Persist report metadata, transactions, and validation errors.

        Returns:
            {
                'status': 'ok' | 'failed',
                'transactions_inserted': int,
                'errors_inserted': int
            }
        """
        report_metadata = report_metadata or {}

        # Replace NaN with None for DB compatibility
        df_clean = df.where(pd.notna(df), None).copy()

        transactions = list(self._iter_transactions(df_clean))
        errors = self._build_validation_errors(df_clean, validation_result, document_id)

        with self.engine.begin() as conn:
            # Insert report metadata
            conn.execute(
                text(
                    """
                    INSERT INTO cmo_reports (
                        document_id,
                        original_filename,
                        cmo_name,
                        report_period_start,
                        report_period_end,
                        total_pages,
                        processing_status,
                        processed_at,
                        table_fingerprint,
                        pdf_storage_path,
                        ocr_json_path,
                        ocr_confidence_avg,
                        validation_errors_count,
                        accuracy_score
                    ) VALUES (
                        :document_id,
                        :original_filename,
                        :cmo_name,
                        :report_period_start,
                        :report_period_end,
                        :total_pages,
                        :processing_status,
                        :processed_at,
                        :table_fingerprint,
                        :pdf_storage_path,
                        :ocr_json_path,
                        :ocr_confidence_avg,
                        :validation_errors_count,
                        :accuracy_score
                    )
                    """
                ),
                {
                    "document_id": document_id,
                    "original_filename": report_metadata.get("original_filename")
                    or _safe_filename(pdf_path),
                    "cmo_name": cmo_name,
                    "report_period_start": report_metadata.get("report_period_start"),
                    "report_period_end": report_metadata.get("report_period_end"),
                    "total_pages": report_metadata.get("total_pages"),
                    "processing_status": "completed",
                    "processed_at": datetime.utcnow(),
                    "table_fingerprint": table_fingerprint,
                    "pdf_storage_path": report_metadata.get("pdf_storage_path")
                    or pdf_path,
                    "ocr_json_path": ocr_json_path,
                    "ocr_confidence_avg": report_metadata.get("ocr_confidence_avg"),
                    "validation_errors_count": validation_result.get("critical_errors", 0)
                    + validation_result.get("warning_errors", 0),
                    "accuracy_score": validation_result.get("accuracy_score"),
                },
            )

            # Insert table fingerprint registry
            if table_fingerprint and table_headers:
                conn.execute(
                    text(
                        """
                        INSERT INTO table_formats (
                            fingerprint,
                            cmo_name,
                            column_schema,
                            sample_document_id,
                            occurrence_count,
                            last_seen
                        ) VALUES (
                            :fingerprint,
                            :cmo_name,
                            :column_schema,
                            :sample_document_id,
                            1,
                            NOW()
                        )
                        ON CONFLICT (fingerprint) DO UPDATE
                        SET
                            occurrence_count = table_formats.occurrence_count + 1,
                            last_seen = NOW(),
                            cmo_name = COALESCE(EXCLUDED.cmo_name, table_formats.cmo_name),
                            column_schema = EXCLUDED.column_schema,
                            sample_document_id = EXCLUDED.sample_document_id
                        """
                    ),
                    {
                        "fingerprint": table_fingerprint,
                        "cmo_name": cmo_name,
                        "column_schema": json.dumps(table_headers),
                        "sample_document_id": document_id,
                    },
                )

            # Insert transactions in chunks
            if transactions:
                for chunk in _chunked(transactions, chunk_size):
                    conn.execute(
                        text(
                            """
                            INSERT INTO royalty_transactions (
                                transaction_id,
                                document_id,
                                page_number,
                                row_position,
                                bounding_boxes,
                                ocr_confidence,
                                isrc,
                                iswc,
                                upc,
                                track_title,
                                track_artist,
                                release_title,
                                label_name,
                                publisher_name,
                                platform,
                                territory,
                                usage_count,
                                sales_start,
                                sales_end,
                                report_date,
                                gross_revenue,
                                commission,
                                net_revenue,
                                publisher_share,
                                currency,
                                validation_passed,
                                validation_errors
                            ) VALUES (
                                :transaction_id,
                                :document_id,
                                :page_number,
                                :row_position,
                                :bounding_boxes,
                                :ocr_confidence,
                                :isrc,
                                :iswc,
                                :upc,
                                :track_title,
                                :track_artist,
                                :release_title,
                                :label_name,
                                :publisher_name,
                                :platform,
                                :territory,
                                :usage_count,
                                :sales_start,
                                :sales_end,
                                :report_date,
                                :gross_revenue,
                                :commission,
                                :net_revenue,
                                :publisher_share,
                                :currency,
                                :validation_passed,
                                :validation_errors
                            )
                            """
                        ),
                        chunk,
                    )

            # Insert validation errors in chunks
            if errors:
                for chunk in _chunked(errors, chunk_size):
                    conn.execute(
                        text(
                            """
                            INSERT INTO validation_errors (
                                transaction_id,
                                document_id,
                                error_type,
                                expected_value,
                                actual_value,
                                deviation,
                                severity,
                                error_details
                            ) VALUES (
                                :transaction_id,
                                :document_id,
                                :error_type,
                                :expected_value,
                                :actual_value,
                                :deviation,
                                :severity,
                                :error_details
                            )
                            """
                        ),
                        chunk,
                    )

        return {
            "status": "ok",
            "transactions_inserted": len(transactions),
            "errors_inserted": len(errors),
            "processing_time_seconds": processing_time_seconds,
        }

    def _iter_transactions(self, df: pd.DataFrame) -> Iterable[Dict]:
        required = ["page_number", "row_position"]
        missing = [col for col in required if col not in df.columns]
        if missing:
            raise ValueError(f"Missing required columns for DB insert: {missing}")

        for row in df.itertuples(index=False):
            row_dict = row._asdict()
            yield {
                "transaction_id": row_dict.get("transaction_id"),
                "document_id": row_dict.get("document_id"),
                "page_number": row_dict.get("page_number"),
                "row_position": row_dict.get("row_position"),
                "bounding_boxes": _json_or_none(row_dict.get("bounding_boxes")),
                "ocr_confidence": row_dict.get("ocr_confidence"),
                "isrc": row_dict.get("isrc"),
                "iswc": row_dict.get("iswc"),
                "upc": row_dict.get("upc"),
                "track_title": row_dict.get("track_title"),
                "track_artist": row_dict.get("track_artist"),
                "release_title": row_dict.get("release_title"),
                "label_name": row_dict.get("label_name"),
                "publisher_name": row_dict.get("publisher_name"),
                "platform": row_dict.get("platform"),
                "territory": row_dict.get("territory"),
                "usage_count": row_dict.get("usage_count"),
                "sales_start": row_dict.get("sales_start"),
                "sales_end": row_dict.get("sales_end"),
                "report_date": row_dict.get("report_date"),
                "gross_revenue": row_dict.get("gross_revenue"),
                "commission": row_dict.get("commission"),
                "net_revenue": row_dict.get("net_revenue"),
                "publisher_share": row_dict.get("publisher_share"),
                "currency": row_dict.get("currency") or "USD",
                "validation_passed": row_dict.get("validation_passed"),
                "validation_errors": _json_or_none(row_dict.get("validation_errors")),
            }

    def _build_validation_errors(
        self, df: pd.DataFrame, validation_result: Dict, document_id: str
    ) -> List[Dict]:
        errors = validation_result.get("errors") or []
        if not errors:
            return []

        # Map row index to transaction_id
        if "transaction_id" not in df.columns:
            return []

        tx_map = df["transaction_id"].to_dict()
        output = []

        for err in errors:
            row_index = err.get("row_index")
            output.append(
                {
                    "transaction_id": tx_map.get(row_index),
                    "document_id": document_id,
                    "error_type": err.get("error_type"),
                    "expected_value": err.get("expected"),
                    "actual_value": err.get("actual"),
                    "deviation": err.get("deviation"),
                    "severity": err.get("severity"),
                    "error_details": json.dumps(err),
                }
            )

        return output


def _chunked(items: List[Dict], size: int) -> Iterable[List[Dict]]:
    chunk: List[Dict] = []
    for item in items:
        chunk.append(item)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def _json_or_none(value):
    if value is None:
        return None
    return json.dumps(value)


def _safe_filename(path: str) -> str:
    try:
        return str(path).split("\\")[-1].split("/")[-1]
    except Exception:
        return str(path)


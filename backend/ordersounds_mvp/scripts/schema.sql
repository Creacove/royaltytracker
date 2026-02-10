-- OrderSounds Phase 1 Database Schema
-- PostgreSQL 14+

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- CMO Reports metadata table
CREATE TABLE cmo_reports (
    document_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    original_filename VARCHAR(255) NOT NULL,
    cmo_name VARCHAR(100),
    report_period_start DATE,
    report_period_end DATE,
    total_pages INTEGER,
    processing_status VARCHAR(50) DEFAULT 'pending',
    uploaded_at TIMESTAMP DEFAULT NOW(),
    processed_at TIMESTAMP,
    table_fingerprint VARCHAR(12),
    
    -- Storage references
    pdf_storage_path VARCHAR(500),
    ocr_json_path VARCHAR(500),
    
    -- Quality metrics
    ocr_confidence_avg DECIMAL(5,4),
    validation_errors_count INTEGER DEFAULT 0,
    accuracy_score DECIMAL(5,2),
    
    CONSTRAINT status_check CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed'))
);

-- Main royalty transactions ledger
CREATE TABLE royalty_transactions (
    transaction_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    document_id UUID REFERENCES cmo_reports(document_id) ON DELETE CASCADE,
    
    -- Source evidence (legal traceability)
    page_number INTEGER NOT NULL,
    row_position INTEGER NOT NULL,
    bounding_boxes JSONB,
    ocr_confidence DECIMAL(5,4),
    
    -- Normalized identifiers
    isrc VARCHAR(15),
    iswc VARCHAR(15),
    upc VARCHAR(20),
    
    -- Track metadata
    track_title VARCHAR(500),
    track_artist VARCHAR(500),
    release_title VARCHAR(500),
    label_name VARCHAR(255),
    publisher_name VARCHAR(255),
    
    -- Usage context
    platform VARCHAR(100),
    territory CHAR(2),  -- ISO 3166-1 alpha-2
    usage_count INTEGER,
    sales_start DATE,
    sales_end DATE,
    report_date DATE,
    
    -- Financial data (4 decimal precision for accuracy)
    gross_revenue DECIMAL(12,4),
    commission DECIMAL(12,4),
    net_revenue DECIMAL(12,4),
    publisher_share DECIMAL(12,4),
    currency CHAR(3) DEFAULT 'USD',
    
    -- Validation
    validation_passed BOOLEAN DEFAULT FALSE,
    validation_errors JSONB,
    
    -- Timestamps
    extracted_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Validation errors table
CREATE TABLE validation_errors (
    error_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID REFERENCES royalty_transactions(transaction_id) ON DELETE CASCADE,
    document_id UUID REFERENCES cmo_reports(document_id) ON DELETE CASCADE,
    error_type VARCHAR(50) NOT NULL,
    expected_value DECIMAL(12,4),
    actual_value DECIMAL(12,4),
    deviation DECIMAL(12,4),
    severity VARCHAR(20),
    error_details JSONB,
    detected_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT severity_check CHECK (severity IN ('critical', 'warning', 'info'))
);

-- Normalization lookup tables
CREATE TABLE territory_mappings (
    raw_value VARCHAR(100) PRIMARY KEY,
    normalized_code CHAR(2) NOT NULL,
    confidence DECIMAL(3,2) DEFAULT 1.0,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE platform_mappings (
    raw_value VARCHAR(100) PRIMARY KEY,
    normalized_name VARCHAR(100) NOT NULL,
    platform_category VARCHAR(50),
    confidence DECIMAL(3,2) DEFAULT 1.0,
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Table format fingerprints (for CMO format detection)
CREATE TABLE table_formats (
    fingerprint VARCHAR(12) PRIMARY KEY,
    cmo_name VARCHAR(100),
    column_schema JSONB NOT NULL,
    sample_document_id UUID REFERENCES cmo_reports(document_id),
    occurrence_count INTEGER DEFAULT 1,
    last_seen TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_transactions_document ON royalty_transactions(document_id);
CREATE INDEX idx_transactions_isrc ON royalty_transactions(isrc) WHERE isrc IS NOT NULL;
CREATE INDEX idx_transactions_platform ON royalty_transactions(platform);
CREATE INDEX idx_transactions_territory ON royalty_transactions(territory);
CREATE INDEX idx_transactions_period ON royalty_transactions(sales_start, sales_end);
CREATE INDEX idx_transactions_financial ON royalty_transactions(gross_revenue, net_revenue);
CREATE INDEX idx_transactions_validation ON royalty_transactions(validation_passed);

CREATE INDEX idx_errors_transaction ON validation_errors(transaction_id);
CREATE INDEX idx_errors_severity ON validation_errors(severity);
CREATE INDEX idx_errors_type ON validation_errors(error_type);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_royalty_transactions_updated_at 
    BEFORE UPDATE ON royalty_transactions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Views for common queries
CREATE VIEW v_validation_summary AS
SELECT 
    d.document_id,
    d.original_filename,
    d.cmo_name,
    COUNT(t.transaction_id) as total_transactions,
    SUM(CASE WHEN t.validation_passed THEN 1 ELSE 0 END) as validated_count,
    ROUND(AVG(t.ocr_confidence::numeric) * 100, 2) as avg_confidence_pct,
    SUM(t.gross_revenue) as total_gross_revenue,
    SUM(t.net_revenue) as total_net_revenue,
    COUNT(DISTINCT e.error_id) as total_errors,
    COUNT(DISTINCT CASE WHEN e.severity = 'critical' THEN e.error_id END) as critical_errors
FROM cmo_reports d
LEFT JOIN royalty_transactions t ON d.document_id = t.document_id
LEFT JOIN validation_errors e ON d.document_id = e.document_id
GROUP BY d.document_id, d.original_filename, d.cmo_name;

CREATE VIEW v_revenue_by_platform AS
SELECT 
    t.platform,
    COUNT(*) as transaction_count,
    SUM(t.usage_count) as total_usage,
    SUM(t.gross_revenue) as total_gross,
    SUM(t.net_revenue) as total_net,
    SUM(t.publisher_share) as total_publisher_share,
    ROUND(AVG(t.ocr_confidence::numeric) * 100, 2) as avg_confidence_pct
FROM royalty_transactions t
WHERE t.validation_passed = TRUE
GROUP BY t.platform
ORDER BY total_gross DESC;

CREATE VIEW v_revenue_by_territory AS
SELECT 
    t.territory,
    COUNT(*) as transaction_count,
    SUM(t.usage_count) as total_usage,
    SUM(t.gross_revenue) as total_gross,
    SUM(t.net_revenue) as total_net,
    SUM(t.publisher_share) as total_publisher_share,
    ROUND(AVG(t.ocr_confidence::numeric) * 100, 2) as avg_confidence_pct
FROM royalty_transactions t
WHERE t.validation_passed = TRUE
GROUP BY t.territory
ORDER BY total_gross DESC;

-- Initial seed data for territory mappings
INSERT INTO territory_mappings (raw_value, normalized_code, verified) VALUES
('UK', 'GB', true),
('USA', 'US', true),
('UNITED STATES', 'US', true),
('UNITED KINGDOM', 'GB', true),
('ENGLAND', 'GB', true),
('SCOTLAND', 'GB', true),
('WALES', 'GB', true),
('NORTHERN IRELAND', 'GB', true),
('SOUTH KOREA', 'KR', true),
('KOREA', 'KR', true),
('HOLLAND', 'NL', true),
('NETHERLANDS', 'NL', true)
ON CONFLICT (raw_value) DO NOTHING;

-- Initial seed data for platform mappings
INSERT INTO platform_mappings (raw_value, normalized_name, platform_category, verified) VALUES
('Spotify Premium', 'Spotify', 'streaming', true),
('Spotify Free', 'Spotify', 'streaming', true),
('Spotify Streaming', 'Spotify', 'streaming', true),
('Apple Music Streaming', 'Apple Music', 'streaming', true),
('Apple Music', 'Apple Music', 'streaming', true),
('YouTube Music', 'YouTube', 'streaming', true),
('YouTube Content ID', 'YouTube', 'ugc', true),
('YouTube', 'YouTube', 'streaming', true),
('Deezer', 'Deezer', 'streaming', true),
('Tidal', 'Tidal', 'streaming', true),
('Amazon Music', 'Amazon Music', 'streaming', true),
('Pandora', 'Pandora', 'streaming', true)
ON CONFLICT (raw_value) DO NOTHING;

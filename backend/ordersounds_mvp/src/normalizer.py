"""
OrderSounds Data Normalizer
Cleans and standardizes ISRC, territories, platforms, financial values
"""

import re
import pandas as pd
from typing import Optional, Dict
import pycountry

class RoyaltyNormalizer:
    """
    Normalizes messy CMO data into clean, standardized format
    Handles: ISRC formatting, territory codes, platform names, currency parsing
    """
    
    def __init__(self):
        # Load lookup tables
        self.territory_map = self._load_territory_mappings()
        self.platform_map = self._load_platform_mappings()
    
    def normalize_dataframe(self, df: pd.DataFrame) -> pd.DataFrame:
        """Apply all normalization rules to DataFrame"""
        print("\n🧹 Normalizing data...")
        
        df_clean = df.copy()
        
        # 1. ISRC normalization
        if 'isrc' in df_clean.columns:
            df_clean['isrc'] = df_clean['isrc'].apply(self.normalize_isrc)
            valid_isrc = df_clean['isrc'].notna().sum()
            print(f"  ✓ ISRC: {valid_isrc}/{len(df_clean)} valid")
        
        # 2. Territory standardization
        if 'territory' in df_clean.columns:
            df_clean['territory'] = df_clean['territory'].apply(self.normalize_territory)
            valid_territory = df_clean['territory'].notna().sum()
            print(f"  ✓ Territory: {valid_territory}/{len(df_clean)} standardized")
        
        # 3. Platform unification
        if 'platform' in df_clean.columns:
            df_clean['platform'] = df_clean['platform'].apply(self.normalize_platform)
        
        # 4. Financial value cleaning
        for col in ['gross_revenue', 'net_revenue', 'commission', 'publisher_share']:
            if col in df_clean.columns:
                df_clean[col] = df_clean[col].apply(self.parse_currency)
        
        # 5. String field cleaning
        string_cols = ['track_title', 'track_artist', 'release_title', 'label_name', 'publisher_name']
        for col in string_cols:
            if col in df_clean.columns:
                df_clean[col] = df_clean[col].apply(self.clean_string)
        
        # 6. Usage count to integer
        if 'usage_count' in df_clean.columns:
            df_clean['usage_count'] = pd.to_numeric(df_clean['usage_count'], errors='coerce').fillna(0).astype(int)
        
        print("✅ Normalization complete\n")
        return df_clean
    
    def normalize_isrc(self, isrc: Optional[str]) -> Optional[str]:
        """
        Normalize ISRC to standard format: CC-XXX-YY-NNNNN
        
        Handles:
        - Missing hyphens: CCXXXYYNNNNN
        - Extra spaces: CC - XXX - YY - NNNNN  
        - Wrong case: cc-xxx-yy-nnnnn
        """
        if pd.isna(isrc) or not isrc:
            return None
        
        # Remove all non-alphanumeric characters
        clean = re.sub(r'[^A-Z0-9]', '', str(isrc).upper())
        
        # Validate length (should be exactly 12 characters)
        if len(clean) != 12:
            return None
        
        # Reformat with hyphens: CC-XXX-YY-NNNNN
        formatted = f"{clean[0:2]}-{clean[2:5]}-{clean[5:7]}-{clean[7:12]}"
        
        # Validate country code (first 2 chars)
        country_code = clean[0:2]
        if not self._is_valid_country_code(country_code):
            return None
        
        return formatted
    
    def _is_valid_country_code(self, code: str) -> bool:
        """Check if country code is valid ISO 3166-1 alpha-2"""
        try:
            pycountry.countries.get(alpha_2=code)
            return True
        except (KeyError, AttributeError):
            return False
    
    def normalize_territory(self, territory: Optional[str]) -> Optional[str]:
        """
        Standardize territory to ISO 3166-1 alpha-2 code
        
        Handles:
        - UK → GB
        - USA → US
        - United Kingdom → GB
        """
        if pd.isna(territory) or not territory:
            return None
        
        clean = str(territory).strip().upper()
        
        # Check direct mapping first
        if clean in self.territory_map:
            return self.territory_map[clean]
        
        # If already a 2-letter code, validate it
        if len(clean) == 2:
            if self._is_valid_country_code(clean):
                return clean
        
        # Try fuzzy matching with pycountry
        try:
            matches = pycountry.countries.search_fuzzy(territory)
            if matches:
                return matches[0].alpha_2
        except LookupError:
            pass
        
        # Return original if can't resolve (will be flagged in validation)
        return clean
    
    def normalize_platform(self, platform: Optional[str]) -> Optional[str]:
        """
        Unify platform naming variations
        
        Handles:
        - Spotify Premium → Spotify
        - Apple Music Streaming → Apple Music
        """
        if pd.isna(platform) or not platform:
            return None
        
        clean = str(platform).strip()
        
        # Check exact match
        if clean in self.platform_map:
            return self.platform_map[clean]
        
        # Fuzzy matching
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
        elif 'amazon' in lower and 'music' in lower:
            return 'Amazon Music'
        elif 'pandora' in lower:
            return 'Pandora'
        
        return clean
    
    def parse_currency(self, value) -> Optional[float]:
        """
        Extract numeric value from currency strings
        
        Handles:
        - $1,234.56
        - 1234.56
        - (1234.56) → -1234.56
        - €1.234,56 (European format)
        """
        if pd.isna(value):
            return None
        
        value_str = str(value).strip()
        
        if not value_str or value_str == '':
            return None
        
        # Detect negative (parentheses)
        is_negative = '(' in value_str and ')' in value_str
        
        # Remove currency symbols and whitespace
        clean = re.sub(r'[^\d.,\-]', '', value_str)
        
        if not clean:
            return None
        
        # Handle European vs US number format
        if ',' in clean and '.' in clean:
            # Determine decimal separator by position
            last_comma = clean.rfind(',')
            last_dot = clean.rfind('.')
            
            if last_comma > last_dot:
                # European format: 1.234,56
                clean = clean.replace('.', '').replace(',', '.')
            else:
                # US format: 1,234.56
                clean = clean.replace(',', '')
        elif ',' in clean:
            # Ambiguous: could be decimal or thousands separator
            # Heuristic: if 3 or fewer digits after comma, it's thousands separator
            parts = clean.split(',')
            if len(parts[-1]) <= 3 and len(parts[-1]) > 0:
                # Likely thousands: 1,234
                clean = clean.replace(',', '')
            else:
                # Likely decimal: 1234,56
                clean = clean.replace(',', '.')
        
        # Convert to float
        try:
            amount = float(clean)
            return -amount if is_negative else amount
        except ValueError:
            return None
    
    def clean_string(self, value: Optional[str]) -> Optional[str]:
        """
        Clean string fields
        - Remove extra whitespace
        - Fix common encoding issues
        """
        if pd.isna(value) or not value:
            return None
        
        clean = str(value).strip()
        
        # Collapse multiple spaces
        clean = re.sub(r'\s+', ' ', clean)
        
        # Fix common Unicode issues
        clean = clean.replace('\u2019', "'")  # Right single quote
        clean = clean.replace('\u2018', "'")  # Left single quote
        clean = clean.replace('\u201c', '"')  # Left double quote
        clean = clean.replace('\u201d', '"')  # Right double quote
        clean = clean.replace('\u2013', '-')  # En dash
        clean = clean.replace('\u2014', '-')  # Em dash
        
        return clean if clean else None
    
    def _load_territory_mappings(self) -> Dict[str, str]:
        """Load common territory aliases"""
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
            'HOLLAND': 'NL',
            'NETHERLANDS': 'NL',
            'CZECH REPUBLIC': 'CZ',
            'RUSSIA': 'RU',
            'RUSSIAN FEDERATION': 'RU',
        }
    
    def _load_platform_mappings(self) -> Dict[str, str]:
        """Load platform name variations"""
        return {
            'Spotify Premium': 'Spotify',
            'Spotify Free': 'Spotify',
            'Spotify Streaming': 'Spotify',
            'Apple Music Streaming': 'Apple Music',
            'YouTube Music': 'YouTube',
            'YouTube Content ID': 'YouTube',
            'Amazon Prime Music': 'Amazon Music',
            'Amazon Unlimited': 'Amazon Music',
        }


if __name__ == '__main__':
    # Test normalizer
    normalizer = RoyaltyNormalizer()
    
    # Test ISRC
    test_isrcs = [
        'USRC17607839',
        'US-RC1-76-07839',
        'us rc1 76 07839',
        'INVALID123',
    ]
    
    print("ISRC Normalization:")
    for isrc in test_isrcs:
        print(f"  {isrc:20} → {normalizer.normalize_isrc(isrc)}")
    
    # Test currency
    test_currencies = [
        '$1,234.56',
        '(1234.56)',
        '€1.234,56',
        '1234.56',
        '1,234',
    ]
    
    print("\nCurrency Parsing:")
    for curr in test_currencies:
        print(f"  {curr:15} → {normalizer.parse_currency(curr)}")

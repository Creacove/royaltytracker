"""
OrderSounds Test Suite
Validates pipeline components with sample data
"""

import pandas as pd
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from normalizer import RoyaltyNormalizer
from validator import FinancialValidator


def test_normalizer():
    """Test data normalization functions"""
    print("\n" + "="*70)
    print("TEST 1: Data Normalizer")
    print("="*70 + "\n")
    
    normalizer = RoyaltyNormalizer()
    
    # Test ISRC normalization
    test_isrcs = [
        ('USRC17607839', 'US-RC1-76-07839'),
        ('US-RC1-76-07839', 'US-RC1-76-07839'),
        ('us rc1 76 07839', 'US-RC1-76-07839'),
        ('GBUM71504729', 'GB-UM7-15-04729'),
        ('INVALID123', None),
        ('', None),
    ]
    
    print("ISRC Normalization:")
    all_passed = True
    for input_val, expected in test_isrcs:
        result = normalizer.normalize_isrc(input_val)
        status = "✓" if result == expected else "✗"
        if result != expected:
            all_passed = False
        print(f"  {status} {input_val:20} → {result or 'None':20} (expected: {expected or 'None'})")
    
    print()
    
    # Test territory normalization
    test_territories = [
        ('UK', 'GB'),
        ('USA', 'US'),
        ('United Kingdom', 'GB'),
        ('Nigeria', 'NG'),
        ('US', 'US'),
    ]
    
    print("Territory Normalization:")
    for input_val, expected in test_territories:
        result = normalizer.normalize_territory(input_val)
        status = "✓" if result == expected else "✗"
        if result != expected:
            all_passed = False
        print(f"  {status} {input_val:20} → {result:5} (expected: {expected})")
    
    print()
    
    # Test currency parsing
    test_currencies = [
        ('$1,234.56', 1234.56),
        ('(1234.56)', -1234.56),
        ('1234.56', 1234.56),
        ('€1.234,56', 1234.56),
        ('$0.01', 0.01),
    ]
    
    print("Currency Parsing:")
    for input_val, expected in test_currencies:
        result = normalizer.parse_currency(input_val)
        status = "✓" if abs((result or 0) - expected) < 0.01 else "✗"
        if abs((result or 0) - expected) >= 0.01:
            all_passed = False
        print(f"  {status} {input_val:15} → {result:10.2f} (expected: {expected:.2f})")
    
    print(f"\n{'✅ PASSED' if all_passed else '❌ FAILED'}\n")
    return all_passed


def test_validator():
    """Test financial validation logic"""
    print("\n" + "="*70)
    print("TEST 2: Financial Validator")
    print("="*70 + "\n")
    
    # Create test DataFrame with known good and bad data
    test_data = {
        'transaction_id': ['t1', 't2', 't3', 't4'],
        'track_title': ['Song A', 'Song B', 'Song C', None],  # t4 missing title
        'platform': ['Spotify', 'Apple Music', 'YouTube', 'Deezer'],
        'territory': ['US', 'GB', 'NG', 'FR'],
        'gross_revenue': [100.00, 50.00, 75.00, 200.00],
        'commission': [15.00, 7.50, 10.00, 30.00],
        'net_revenue': [85.00, 42.50, 66.00, 170.00],  # t3 is wrong (should be 65.00)
        'publisher_share': [85.00, 42.50, 66.00, 170.00],
    }
    
    df = pd.DataFrame(test_data)
    
    print("Test Data:")
    print(df[['transaction_id', 'gross_revenue', 'commission', 'net_revenue']])
    print()
    
    # Run validation
    validator = FinancialValidator(tolerance=0.01)
    result = validator.validate_dataframe(df)
    
    # Expected: t3 should fail (65.00 expected, got 66.00)
    expected_critical_errors = 1
    expected_warnings = 1  # t4 missing track_title
    
    passed = (
        result['critical_errors'] == expected_critical_errors and
        result['warning_errors'] == expected_warnings
    )
    
    print(f"\nExpected: {expected_critical_errors} critical, {expected_warnings} warnings")
    print(f"Got:      {result['critical_errors']} critical, {result['warning_errors']} warnings")
    print(f"Accuracy: {result['accuracy_score']:.2f}%")
    
    print(f"\n{'✅ PASSED' if passed else '❌ FAILED'}\n")
    return passed


def test_end_to_end_sample():
    """Test complete pipeline with sample data based on uploaded screenshot"""
    print("\n" + "="*70)
    print("TEST 3: End-to-End Sample (Based on CMO Screenshot)")
    print("="*70 + "\n")
    
    # Simulated data extracted from the CMO report screenshot
    sample_data = {
        'label': ['Labelcaster Records'] * 5,
        'report_date': ['2023-01-01'] * 5,
        'sales_start': ['2023-01-01'] * 5,
        'sales_end': ['2023-01-01'] * 5,
        'upc': ['759011445101', '759011445101', '759011445101', '975001452148', '975001452148'],
        'release_title': ['In the Sunshine', 'In the Sunshine', 'In the Sunshine', 'We are Golden', 'We are Golden'],
        'track_artist': ['Nikki West feat. Ire & Ginger', 'Nikki West feat. Ire & Ginger', 'Nikki West feat. Ire & Ginger', 'We are Golden', 'We are Golden'],
        'isrc': ['SE7V21548801', 'SE7V21548801', 'SE7V21548801', 'SE7V21571001', 'SE7V21571001'],
        'track_title': ['Nikki West feat. Ire & Ginger', 'Nikki West feat. Ire & Ginger', 'Nikki West feat. Ire & Ginger', 'We are Golden', 'We are Golden'],
        'platform': ['Amazon Unlimited', 'Amazon Unlimited', 'Amazon Unlimited', 'Never Ending Project', 'Never Ending Project'],
        'territory': ['US', 'US', 'US', 'AR', 'DE'],
        'usage_count': [1, 2, 3, 5, 1],
        'gross_revenue': [0.00044035, 0.00088070, 0.00132105, 0.00431, 0.001127],
        'commission': [0.00004403, 0.00008807, 0.00013210, 0.00043, 0.000113],
        'net_revenue': [0.00039632, 0.00079263, 0.00118895, 0.00388, 0.001014],
        'publisher_share': [0.00039632, 0.00079263, 0.00118895, 0.00388, 0.001014],
    }
    
    df = pd.DataFrame(sample_data)
    
    print("Sample Data (5 rows from CMO report):")
    print(df[['isrc', 'track_title', 'platform', 'territory', 'gross_revenue', 'net_revenue']].head())
    print()
    
    # Test normalization
    normalizer = RoyaltyNormalizer()
    df_normalized = normalizer.normalize_dataframe(df)
    
    print("After Normalization:")
    print(f"  ISRC format: {df_normalized['isrc'].iloc[0]}")
    print(f"  Territory:   {df_normalized['territory'].iloc[0]}")
    print()
    
    # Test validation
    df_normalized['transaction_id'] = [f"t{i}" for i in range(len(df_normalized))]
    
    validator = FinancialValidator(tolerance=0.0001)  # Very tight tolerance for small amounts
    result = validator.validate_dataframe(df_normalized)
    
    print(f"Validation Results:")
    print(f"  Accuracy: {result['accuracy_score']:.2f}%")
    print(f"  Errors:   {result['critical_errors']} critical, {result['warning_errors']} warnings")
    
    passed = result['accuracy_score'] >= 99.0
    
    print(f"\n{'✅ PASSED' if passed else '❌ FAILED'}\n")
    return passed


def run_all_tests():
    """Run all tests"""
    print("\n" + "="*70)
    print("OrderSounds MVP Test Suite")
    print("="*70)
    
    results = []
    
    results.append(('Normalizer', test_normalizer()))
    results.append(('Validator', test_validator()))
    results.append(('End-to-End', test_end_to_end_sample()))
    
    # Summary
    print("\n" + "="*70)
    print("TEST SUMMARY")
    print("="*70 + "\n")
    
    for test_name, passed in results:
        status = "✅ PASSED" if passed else "❌ FAILED"
        print(f"  {test_name:20} {status}")
    
    all_passed = all(result[1] for result in results)
    
    print("\n" + "="*70)
    if all_passed:
        print("🎉 ALL TESTS PASSED")
    else:
        print("⚠️  SOME TESTS FAILED")
    print("="*70 + "\n")
    
    return 0 if all_passed else 1


if __name__ == '__main__':
    sys.exit(run_all_tests())

"""FDA Drug Labeling tool for retrieving official drug information from openFDA API."""

import os
import json
import requests
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv
from strands import tool

# Load environment variables
load_dotenv()
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))

class FDADrugLabelingTool:
    """Tool for retrieving FDA drug labeling information."""
    
    def __init__(self):
        self.base_url = "https://api.fda.gov/drug/label.json"
        self.api_key = os.getenv("FDA_API_KEY", "")
        
    def search_drug_label(self, drug_name: str, limit: int = 5) -> Dict[str, Any]:
        """
        Search for FDA drug labeling information.
        
        Args:
            drug_name: Name of the drug to search for
            limit: Maximum number of results to return
            
        Returns:
            Dictionary containing drug labeling information
        """
        try:
            # Build search query
            search_query = f'openfda.brand_name:"{drug_name}" OR openfda.generic_name:"{drug_name}"'
            
            params = {
                'search': search_query,
                'limit': limit
            }
            
            # Add API key if available
            if self.api_key:
                params['api_key'] = self.api_key
            
            # Make request to FDA API
            response = requests.get(self.base_url, params=params, timeout=API_TOOL_TIMEOUT_SECONDS)
            response.raise_for_status()
            
            data = response.json()
            
            if 'results' not in data or not data['results']:
                return {
                    'found': False,
                    'drug_name': drug_name,
                    'message': f"No FDA labeling information found for {drug_name}"
                }
            
            # Process results
            results = []
            for item in data['results']:
                result = self._extract_drug_info(item)
                results.append(result)
            
            return {
                'found': True,
                'drug_name': drug_name,
                'results': results,
                'total_results': len(results)
            }
            
        except requests.exceptions.RequestException as e:
            return {
                'found': False,
                'drug_name': drug_name,
                'error': f"FDA API request failed: {str(e)}"
            }
        except Exception as e:
            return {
                'found': False,
                'drug_name': drug_name,
                'error': f"Error processing FDA data: {str(e)}"
            }
    
    def _extract_drug_info(self, item: Dict[str, Any]) -> Dict[str, Any]:
        """Extract relevant drug information from FDA API response."""
        info = {
            'brand_names': [],
            'generic_name': '',
            'manufacturer': '',
            'purpose': '',
            'indications_and_usage': '',
            'warnings': '',
            'dosage_and_administration': '',
            'contraindications': '',
            'adverse_reactions': '',
            'drug_interactions': '',
            'pregnancy_category': '',
            'storage_and_handling': ''
        }
        
        # Extract OpenFDA data
        if 'openfda' in item:
            openfda = item['openfda']
            info['brand_names'] = openfda.get('brand_name', [])
            info['generic_name'] = ', '.join(openfda.get('generic_name', []))
            info['manufacturer'] = ', '.join(openfda.get('manufacturer_name', []))
            
        # Extract label sections
        info['purpose'] = self._clean_text(item.get('purpose', [''])[0])
        info['indications_and_usage'] = self._clean_text(item.get('indications_and_usage', [''])[0])
        info['warnings'] = self._clean_text(item.get('warnings', [''])[0])
        info['dosage_and_administration'] = self._clean_text(item.get('dosage_and_administration', [''])[0])
        info['contraindications'] = self._clean_text(item.get('contraindications', [''])[0])
        info['adverse_reactions'] = self._clean_text(item.get('adverse_reactions', [''])[0])
        info['drug_interactions'] = self._clean_text(item.get('drug_interactions', [''])[0])
        info['pregnancy'] = self._clean_text(item.get('pregnancy', [''])[0])
        info['storage_and_handling'] = self._clean_text(item.get('storage_and_handling', [''])[0])
        
        # Get important warnings box if available
        if 'boxed_warning' in item:
            info['boxed_warning'] = self._clean_text(item['boxed_warning'][0])
        
        return info
    
    def _clean_text(self, text: str) -> str:
        """Clean and format text from FDA labels."""
        if not text:
            return ""
        
        # Remove excessive whitespace and newlines
        text = ' '.join(text.split())
        
        # Truncate very long sections
        if len(text) > 2000:
            text = text[:2000] + "... [truncated]"
        
        return text
    
    def get_drug_summary(self, drug_name: str) -> str:
        """
        Get a formatted summary of drug information suitable for research reports.
        
        Args:
            drug_name: Name of the drug
            
        Returns:
            Formatted string with drug information
        """
        result = self.search_drug_label(drug_name, limit=1)
        
        if not result['found']:
            return f"No FDA information available for {drug_name}. {result.get('message', '')}"
        
        if not result['results']:
            return f"No FDA labeling data found for {drug_name}."
        
        drug_info = result['results'][0]
        
        summary = f"""## FDA Drug Information: {drug_name}

**Generic Name:** {drug_info['generic_name'] or 'Not specified'}
**Brand Names:** {', '.join(drug_info['brand_names']) if drug_info['brand_names'] else 'Not specified'}
**Manufacturer:** {drug_info['manufacturer'] or 'Not specified'}

### Purpose/Indications
{drug_info['indications_and_usage'] or 'No indication information available.'}

### Important Warnings
{drug_info.get('boxed_warning', drug_info['warnings']) or 'No specific warnings listed.'}

### Dosage and Administration
{drug_info['dosage_and_administration'] or 'Consult prescribing information for dosage details.'}

### Contraindications
{drug_info['contraindications'] or 'No specific contraindications listed.'}

### Common Adverse Reactions
{drug_info['adverse_reactions'] or 'No adverse reaction information available.'}

### Drug Interactions
{drug_info['drug_interactions'] or 'No drug interaction information available.'}

*Note: This is a summary of FDA labeling information. Always consult with a healthcare provider for medical advice.*
"""
        
        return summary

def extract_medications_from_text(text: str) -> List[str]:
    """
    Extract potential medication names from text.
    
    This is a simple implementation that looks for common patterns.
    In production, you might want to use NLP or a medical entity recognition model.
    """
    import re
    
    # Common medication name patterns
    # This is simplified - real implementation would be more sophisticated
    medications = []
    
    # Look for capitalized words that might be drug names
    # Common drug name endings
    drug_endings = [
        'pril', 'sartan', 'statin', 'azole', 'cycline', 'mycin',
        'cillin', 'floxacin', 'prazole', 'tidine', 'olol', 'pine',
        'pam', 'zepam', 'barbital', 'vir', 'mab', 'nib'
    ]
    
    # Common drug names (partial list for demonstration)
    common_drugs = [
        'aspirin', 'ibuprofen', 'acetaminophen', 'metformin', 'lisinopril',
        'atorvastatin', 'metoprolol', 'omeprazole', 'losartan', 'gabapentin',
        'plavix', 'clopidogrel', 'warfarin', 'insulin', 'prednisone',
        'amoxicillin', 'levothyroxine', 'amlodipine', 'simvastatin'
    ]
    
    # Convert text to lowercase for searching
    text_lower = text.lower()
    
    # Find common drugs
    for drug in common_drugs:
        if drug in text_lower:
            medications.append(drug.capitalize())
    
    # Find words ending with common drug suffixes
    words = re.findall(r'\b[A-Za-z]+\b', text)
    for word in words:
        for ending in drug_endings:
            if word.lower().endswith(ending) and len(word) > len(ending) + 2:
                medications.append(word.capitalize())
                break
    
    # Remove duplicates and return
    return list(set(medications))

# Create a singleton instance
fda_tool = FDADrugLabelingTool()

@tool
def check_fda_drug_info(drug_name: str) -> Dict[str, Any]:
    """Check FDA drug information for a specific medication.

    Args:
        drug_name: Name of the drug to look up

    Returns:
        Dictionary with drug information including brand names, generic name, warnings, and usage
    """
    return fda_tool.search_drug_label(drug_name)

@tool
def get_fda_drug_summary(drug_name: str) -> str:
    """Get a formatted summary of FDA drug information.

    Args:
        drug_name: Name of the drug

    Returns:
        Formatted drug information summary including indications, warnings, and interactions
    """
    return fda_tool.get_drug_summary(drug_name)

@tool
def analyze_text_for_medications(text: str) -> List[Dict[str, Any]]:
    """Analyze text for medication mentions and retrieve FDA information.

    Args:
        text: Text to analyze for medication names

    Returns:
        List of dictionaries with medication information and FDA summaries
    """
    medications = extract_medications_from_text(text)

    if not medications:
        return []

    results = []
    for med in medications:
        info = fda_tool.search_drug_label(med)
        if info['found']:
            results.append({
                'medication': med,
                'fda_info': info,
                'summary': fda_tool.get_drug_summary(med)
            })

    return results
"""
Comprehensive FDA Drug Tools for Claude
Provides individual functions for each FDA drug label section
"""

import os
import json
import requests
import logging
from typing import Dict, Any, List, Optional
from dotenv import load_dotenv
from strands import tool

# Load environment variables
load_dotenv()

logger = logging.getLogger(__name__)
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))

class FDADrugTools:
    """Comprehensive FDA drug information tools."""
    
    def __init__(self):
        self.base_url = "https://api.fda.gov/drug/label.json"
        self.adverse_url = "https://api.fda.gov/drug/event.json"
        self.api_key = os.getenv("FDA_API_KEY", "")
        
    def _make_request(self, url: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """Make request to FDA API with error handling."""
        try:
            if self.api_key:
                params['api_key'] = self.api_key
                
            response = requests.get(url, params=params, timeout=API_TOOL_TIMEOUT_SECONDS)
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"FDA API request failed: {str(e)}")
            raise
    
    def _search_drug(self, drug_name: str, fields: Optional[List[str]] = None) -> Dict[str, Any]:
        """Base search function for drug information."""
        search_query = f'openfda.brand_name:"{drug_name}" OR openfda.generic_name:"{drug_name}"'
        params = {
            'search': search_query,
            'limit': 1
        }
        
        # FDA API doesn't support field filtering with _fields parameter
        # We'll get all data and extract what we need
            
        data = self._make_request(self.base_url, params)
        
        if 'results' not in data or not data['results']:
            return None
            
        return data['results'][0]
    
    def _clean_text(self, text: Any) -> str:
        """Clean and format text from FDA labels."""
        if not text:
            return "No information available."
        
        if isinstance(text, list):
            text = ' '.join(text)
        
        # Remove excessive whitespace
        text = ' '.join(str(text).split())
        
        # Truncate very long sections
        if len(text) > 3000:
            text = text[:3000] + "... [truncated]"
        
        return text

# Create singleton instance
fda_tools = FDADrugTools()

# Individual tool functions for each FDA section

@tool
def searchDrugLabel(drugName: str, fields: Optional[List[str]] = None) -> Dict[str, Any]:
    """Search for a drug by name and get its detailed label information.

    Returns all available fields from the FDA drug label database.

    Args:
        drugName: Name of the drug to search for
        fields: Optional list of specific fields to retrieve

    Returns:
        Dictionary with drug label information including brand names, generic name, and manufacturer
    """
    try:
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No FDA label information found for {drugName}"
            }
        
        # Extract key information
        openfda = result.get('openfda', {})
        
        return {
            "success": True,
            "drugName": drugName,
            "brandNames": openfda.get('brand_name', []),
            "genericName": ', '.join(openfda.get('generic_name', [])),
            "manufacturer": ', '.join(openfda.get('manufacturer_name', [])),
            "data": result
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def searchAdverseEffects(drugName: str, limit: int = 10) -> Dict[str, Any]:
    """Search for reported adverse effects of a drug in the FDA database.

    Returns a list of adverse reactions with their seriousness and outcomes.

    Args:
        drugName: Name of the drug to search for
        limit: Maximum number of adverse effect reports to return

    Returns:
        Dictionary with adverse effects including reactions, seriousness, and outcomes
    """
    try:
        search_query = f'patient.drug.openfda.brand_name:"{drugName}" OR patient.drug.openfda.generic_name:"{drugName}"'
        params = {
            'search': search_query,
            'limit': limit
        }
        
        data = fda_tools._make_request(fda_tools.adverse_url, params)
        
        if 'results' not in data:
            return {
                "success": False,
                "drugName": drugName,
                "message": "No adverse event data found"
            }
        
        adverse_effects = []
        for event in data['results']:
            reactions = []
            for reaction in event.get('patient', {}).get('reaction', []):
                reactions.append(reaction.get('reactionmeddrapt', 'Unknown'))
            
            adverse_effects.append({
                "reactions": reactions,
                "serious": event.get('serious', 0),
                "outcome": event.get('patient', {}).get('patientoutcome', 'Unknown')
            })
        
        return {
            "success": True,
            "drugName": drugName,
            "adverseEffects": adverse_effects,
            "totalReported": len(adverse_effects)
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getSpecialPopulations(drugName: str) -> Dict[str, Any]:
    """Get comprehensive information about drug use in special populations.

    Returns pregnancy warnings, geriatric use, pediatric use, and nursing mothers advisories.

    Args:
        drugName: Name of the drug to search for

    Returns:
        Dictionary with special population information including pregnancy, pediatric, and geriatric use
    """
    try:
        fields = ['pregnancy', 'pregnancy_or_breast_feeding', 'nursing_mothers', 
                  'pediatric_use', 'geriatric_use']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No special populations data found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "pregnancy": fda_tools._clean_text(result.get('pregnancy', [''])[0]),
            "nursingMothers": fda_tools._clean_text(result.get('nursing_mothers', [''])[0]),
            "pediatricUse": fda_tools._clean_text(result.get('pediatric_use', [''])[0]),
            "geriatricUse": fda_tools._clean_text(result.get('geriatric_use', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getBoxedWarning(drugName: str) -> Dict[str, Any]:
    """
    Get serious warnings (black box warnings) for a drug.
    These are the most serious warnings that may appear on a drug label.
    """
    try:
        fields = ['boxed_warning']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No boxed warning data found for {drugName}"
            }
        
        warning = result.get('boxed_warning', ['No boxed warning available'])[0]
        
        return {
            "success": True,
            "drugName": drugName,
            "boxedWarning": fda_tools._clean_text(warning),
            "hasBoxedWarning": bool(warning and warning != 'No boxed warning available')
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getDrugInteractions(drugName: str) -> Dict[str, Any]:
    """
    Get detailed information about drug interactions.
    """
    try:
        fields = ['drug_interactions']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No drug interaction data found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "drugInteractions": fda_tools._clean_text(result.get('drug_interactions', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getAbuse(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about the types of abuse that can occur with the drug.
    """
    try:
        fields = ['abuse']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No abuse information found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "abuse": fda_tools._clean_text(result.get('abuse', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getAbuseTable(drugName: str) -> Dict[str, Any]:
    """
    Retrieves tabular information about drug abuse.
    """
    try:
        fields = ['abuse_table']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No abuse table found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "abuseTable": fda_tools._clean_text(result.get('abuse_table', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getActiveIngredient(drugName: str) -> Dict[str, Any]:
    """
    Retrieves a list of the active, medicinal ingredients in the drug product.
    """
    try:
        fields = ['active_ingredient']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No active ingredient data found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "activeIngredient": fda_tools._clean_text(result.get('active_ingredient', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getAdverseReactions(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about undesirable effects associated with use of the drug.
    """
    try:
        fields = ['adverse_reactions']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No adverse reactions data found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "adverseReactions": fda_tools._clean_text(result.get('adverse_reactions', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getClinicalPharmacology(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about the clinical pharmacology and actions of the drug in humans.
    """
    try:
        fields = ['clinical_pharmacology']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No clinical pharmacology data found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "clinicalPharmacology": fda_tools._clean_text(result.get('clinical_pharmacology', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getContraindications(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about situations in which the drug product should not be used.
    """
    try:
        fields = ['contraindications']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No contraindications data found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "contraindications": fda_tools._clean_text(result.get('contraindications', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getDescription(drugName: str) -> Dict[str, Any]:
    """
    Retrieves general information about the drug product.
    """
    try:
        fields = ['description']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No description found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "description": fda_tools._clean_text(result.get('description', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getDosageAndAdministration(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about the drug product's dosage and administration recommendations.
    """
    try:
        fields = ['dosage_and_administration']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No dosage information found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "dosageAndAdministration": fda_tools._clean_text(result.get('dosage_and_administration', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getWarnings(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about serious adverse reactions and potential safety hazards.
    """
    try:
        fields = ['warnings']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No warnings found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "warnings": fda_tools._clean_text(result.get('warnings', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getPregnancy(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about effects the drug may have on pregnant women or on a fetus.
    """
    try:
        fields = ['pregnancy']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No pregnancy information found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "pregnancy": fda_tools._clean_text(result.get('pregnancy', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getPediatricUse(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about any limitations on pediatric indications and hazards.
    """
    try:
        fields = ['pediatric_use']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No pediatric use information found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "pediatricUse": fda_tools._clean_text(result.get('pediatric_use', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getGeriatricUse(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about any limitations on geriatric indications and hazards.
    """
    try:
        fields = ['geriatric_use']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No geriatric use information found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "geriatricUse": fda_tools._clean_text(result.get('geriatric_use', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getIndicationsAndUsage(drugName: str) -> Dict[str, Any]:
    """
    Retrieves a statement of each of the drug product's indications for use.
    """
    try:
        fields = ['indications_and_usage']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No indications found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "indicationsAndUsage": fda_tools._clean_text(result.get('indications_and_usage', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getMechanismOfAction(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about the established mechanism(s) of the drug's action in humans.
    """
    try:
        fields = ['mechanism_of_action']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No mechanism of action found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "mechanismOfAction": fda_tools._clean_text(result.get('mechanism_of_action', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getOverdosage(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about signs, symptoms, and laboratory findings of acute overdosage.
    """
    try:
        fields = ['overdosage']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No overdosage information found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "overdosage": fda_tools._clean_text(result.get('overdosage', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getPharmacokinetics(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about the clinically significant pharmacokinetics of a drug.
    """
    try:
        fields = ['pharmacokinetics']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No pharmacokinetics data found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "pharmacokinetics": fda_tools._clean_text(result.get('pharmacokinetics', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getControlledSubstance(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about the schedule in which the drug is controlled by the DEA.
    """
    try:
        fields = ['controlled_substance']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No controlled substance information found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "controlledSubstance": fda_tools._clean_text(result.get('controlled_substance', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }

@tool
def getNursingMothers(drugName: str) -> Dict[str, Any]:
    """
    Retrieves information about excretion of the drug in human milk and effects on nursing infant.
    """
    try:
        fields = ['nursing_mothers']
        result = fda_tools._search_drug(drugName, fields)
        
        if not result:
            return {
                "success": False,
                "drugName": drugName,
                "message": f"No nursing mothers information found for {drugName}"
            }
        
        return {
            "success": True,
            "drugName": drugName,
            "nursingMothers": fda_tools._clean_text(result.get('nursing_mothers', [''])[0])
        }
        
    except Exception as e:
        return {
            "success": False,
            "drugName": drugName,
            "error": str(e)
        }
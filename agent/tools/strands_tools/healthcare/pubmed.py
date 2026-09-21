"""
PubMed E-utilities API tools for Claude
Provides access to NCBI's E-utilities for searching and retrieving biomedical literature
"""

import os
import logging
import aiohttp
import asyncio
from typing import Dict, Any, List, Optional
from urllib.parse import urlencode
import xml.etree.ElementTree as ET
import json
from strands import tool

logger = logging.getLogger(__name__)
API_TOOL_TIMEOUT_SECONDS = int(os.getenv("API_TOOL_TIMEOUT_SECONDS", "7"))

# Base URL for E-utilities
EUTILS_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"

# Default parameters
DEFAULT_DB = "pubmed"
DEFAULT_RETMODE = "xml"
DEFAULT_RETMAX = 20
MAX_RETMAX = 10000  # Maximum allowed by NCBI

async def _make_eutils_request(endpoint: str, params: Dict[str, Any]) -> str:
    """Make a request to E-utilities API"""
    # Add API key if available
    api_key = os.getenv('NCBI_API_KEY')
    if api_key:
        params['api_key'] = api_key
        logger.info("Using NCBI API key for enhanced rate limits")
    
    # Add tool and email for proper identification
    params['tool'] = 'ron-ai-claude'
    params['email'] = os.getenv('NCBI_EMAIL', 'your-email@example.com')
    
    url = f"{EUTILS_BASE_URL}/{endpoint}.fcgi"
    
    try:
        timeout = aiohttp.ClientTimeout(total=API_TOOL_TIMEOUT_SECONDS)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url, params=params, timeout=timeout) as response:
                if response.status == 200:
                    return await response.text()
                else:
                    error_text = await response.text()
                    logger.error(f"E-utilities API error {response.status}: {error_text}")
                    raise Exception(f"API error {response.status}: {error_text}")
    except Exception as e:
        logger.error(f"E-utilities request failed: {str(e)}")
        raise


@tool
@tool
async def pubmed_search(
    query: str,
    max_results: int = 20,
    sort_order: str = "relevance",
    date_filter: Optional[Dict[str, str]] = None
) -> Dict[str, Any]:
    """Search PubMed for articles matching the query.

    Returns a list of PMIDs (PubMed IDs) that can be used with other functions.

    Args:
        query: Search query string for PubMed
        max_results: Maximum number of results to return (default: 20)
        sort_order: Sort order - relevance, pub_date, Author, JournalName (default: relevance)
        date_filter: Optional date filter dictionary with mindate, maxdate, datetype keys

    Returns:
        Dictionary with search results including PMIDs, count, and query metadata
    """
    try:
        params = {
            'db': DEFAULT_DB,
            'term': query,
            'retmax': min(max_results, MAX_RETMAX),
            'retmode': 'json',
            'sort': sort_order  # relevance, pub_date, Author, JournalName
        }
        
        # Add date filters if provided
        if date_filter:
            if 'mindate' in date_filter:
                params['mindate'] = date_filter['mindate']
            if 'maxdate' in date_filter:
                params['maxdate'] = date_filter['maxdate']
            if 'datetype' in date_filter:
                params['datetype'] = date_filter['datetype']  # pdat, edat, crdt
        
        # Use history server for large result sets
        params['usehistory'] = 'y'
        
        response_text = await _make_eutils_request('esearch', params)
        data = json.loads(response_text)
        
        result = data.get('esearchresult', {})
        
        return {
            "success": True,
            "count": int(result.get('count', 0)),
            "pmids": result.get('idlist', []),
            "webenv": result.get('webenv'),
            "query_key": result.get('querykey'),
            "query": query,
            "message": f"Found {result.get('count', 0)} articles matching '{query}'"
        }
        
    except Exception as e:
        logger.error(f"PubMed search error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "query": query
        }


@tool
@tool
async def pubmed_fetch_abstracts(
    pmids: List[str],
    include_full_text: bool = False
) -> Dict[str, Any]:
    """Fetch abstracts and metadata for a list of PMIDs.

    Returns structured article information including title, authors, abstract, etc.

    Args:
        pmids: List of PubMed IDs to fetch abstracts for
        include_full_text: Whether to include full text if available (default: False)

    Returns:
        Dictionary with articles containing abstracts, titles, authors, and metadata
    """
    try:
        if not pmids:
            return {
                "success": False,
                "error": "No PMIDs provided"
            }
        
        # Limit to reasonable number
        pmids = pmids[:100]
        
        params = {
            'db': DEFAULT_DB,
            'id': ','.join(pmids),
            'retmode': DEFAULT_RETMODE,
            'rettype': 'abstract'
        }
        
        response_text = await _make_eutils_request('efetch', params)
        
        # Parse XML response
        root = ET.fromstring(response_text)
        articles = []
        
        for article in root.findall('.//PubmedArticle'):
            article_data = _parse_pubmed_article(article)
            articles.append(article_data)
        
        return {
            "success": True,
            "articles": articles,
            "count": len(articles),
            "pmids": pmids
        }
        
    except Exception as e:
        logger.error(f"PubMed fetch error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "pmids": pmids
        }


@tool
async def pubmed_fetch_summaries(
    pmids: List[str]
) -> Dict[str, Any]:
    """
    Fetch document summaries for a list of PMIDs.
    Returns concise information about each article.
    """
    try:
        if not pmids:
            return {
                "success": False,
                "error": "No PMIDs provided"
            }
        
        # Limit to reasonable number
        pmids = pmids[:500]
        
        params = {
            'db': DEFAULT_DB,
            'id': ','.join(pmids),
            'retmode': 'json'
        }
        
        response_text = await _make_eutils_request('esummary', params)
        data = json.loads(response_text)
        
        summaries = []
        result = data.get('result', {})
        
        for pmid in pmids:
            if pmid in result:
                summary = result[pmid]
                # Extract author names properly
                author_list = []
                authors = summary.get('authors', [])
                if isinstance(authors, list):
                    for author in authors:
                        if isinstance(author, dict) and 'name' in author:
                            author_list.append(author['name'])
                        elif isinstance(author, str):
                            author_list.append(author)
                
                summaries.append({
                    'pmid': pmid,
                    'title': summary.get('title', ''),
                    'authors': author_list,
                    'source': summary.get('source', ''),
                    'pubdate': summary.get('pubdate', ''),
                    'volume': summary.get('volume', ''),
                    'issue': summary.get('issue', ''),
                    'pages': summary.get('pages', ''),
                    'doi': summary.get('elocationid', ''),
                    'pmcid': summary.get('pmcid', ''),
                    'pubtype': summary.get('pubtype', []),
                    'recordstatus': summary.get('recordstatus', '')
                })
        
        return {
            "success": True,
            "summaries": summaries,
            "count": len(summaries),
            "pmids": pmids
        }
        
    except Exception as e:
        logger.error(f"PubMed summary fetch error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "pmids": pmids
        }


@tool
async def pubmed_fetch_related(
    pmid: str,
    max_results: int = 20
) -> Dict[str, Any]:
    """
    Find articles related to a given PMID.
    Uses NCBI's similarity algorithms to find related research.
    """
    try:
        params = {
            'dbfrom': DEFAULT_DB,
            'db': DEFAULT_DB,
            'id': pmid,
            'cmd': 'neighbor_score',
            'retmode': 'json'
        }
        
        response_text = await _make_eutils_request('elink', params)
        data = json.loads(response_text)
        
        related_pmids = []
        linksets = data.get('linksets', [])
        
        if linksets:
            linkset = linksets[0]
            linksetdbs = linkset.get('linksetdbs', [])
            if linksetdbs:
                links = linksetdbs[0].get('links', [])
                related_pmids = links[:max_results]
        
        # Fetch summaries for related articles
        if related_pmids:
            summaries_result = await pubmed_fetch_summaries(related_pmids)
            if summaries_result['success']:
                return {
                    "success": True,
                    "source_pmid": pmid,
                    "related_articles": summaries_result['summaries'],
                    "count": len(summaries_result['summaries'])
                }
        
        return {
            "success": True,
            "source_pmid": pmid,
            "related_articles": [],
            "count": 0,
            "message": "No related articles found"
        }
        
    except Exception as e:
        logger.error(f"PubMed related articles error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "source_pmid": pmid
        }


@tool
async def pubmed_fetch_citations(
    pmid: str,
    citation_type: str = "both"
) -> Dict[str, Any]:
    """
    Fetch citations for a given article.
    citation_type can be: 'references' (cited by this article), 'citations' (citing this article), or 'both'
    """
    try:
        results = {
            "success": True,
            "pmid": pmid,
            "references": [],
            "citations": []
        }
        
        # Get references (articles cited by this paper)
        if citation_type in ['references', 'both']:
            params = {
                'dbfrom': DEFAULT_DB,
                'db': DEFAULT_DB,
                'id': pmid,
                'linkname': 'pubmed_pubmed_refs',
                'retmode': 'json'
            }
            
            response_text = await _make_eutils_request('elink', params)
            data = json.loads(response_text)
            
            ref_pmids = []
            linksets = data.get('linksets', [])
            if linksets:
                for linkset in linksets:
                    linksetdbs = linkset.get('linksetdbs', [])
                    for linksetdb in linksetdbs:
                        if linksetdb.get('linkname') == 'pubmed_pubmed_refs':
                            ref_pmids = linksetdb.get('links', [])[:50]  # Limit to 50
                            break
            
            if ref_pmids:
                summaries_result = await pubmed_fetch_summaries(ref_pmids)
                if summaries_result['success']:
                    results['references'] = summaries_result['summaries']
        
        # Get citations (articles citing this paper)
        if citation_type in ['citations', 'both']:
            params = {
                'dbfrom': DEFAULT_DB,
                'db': DEFAULT_DB,
                'id': pmid,
                'linkname': 'pubmed_pubmed_citedin',
                'retmode': 'json'
            }
            
            response_text = await _make_eutils_request('elink', params)
            data = json.loads(response_text)
            
            cite_pmids = []
            linksets = data.get('linksets', [])
            if linksets:
                for linkset in linksets:
                    linksetdbs = linkset.get('linksetdbs', [])
                    for linksetdb in linksetdbs:
                        if linksetdb.get('linkname') == 'pubmed_pubmed_citedin':
                            cite_pmids = linksetdb.get('links', [])[:50]  # Limit to 50
                            break
            
            if cite_pmids:
                summaries_result = await pubmed_fetch_summaries(cite_pmids)
                if summaries_result['success']:
                    results['citations'] = summaries_result['summaries']
        
        results['reference_count'] = len(results['references'])
        results['citation_count'] = len(results['citations'])
        
        return results
        
    except Exception as e:
        logger.error(f"PubMed citations error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "pmid": pmid
        }


@tool
async def pubmed_search_clinical_trials(
    condition: str,
    intervention: Optional[str] = None,
    status: Optional[str] = None,
    max_results: int = 20
) -> Dict[str, Any]:
    """
    Search for clinical trials related to a condition or intervention.
    Links PubMed with ClinicalTrials.gov data.
    """
    try:
        # Build query for clinical trials
        query_parts = [f'({condition}[Condition])', 'clinical trial[Publication Type]']
        
        if intervention:
            query_parts.append(f'({intervention}[Intervention])')
        
        if status:
            query_parts.append(f'({status}[Status])')
        
        query = ' AND '.join(query_parts)
        
        # Search PubMed for clinical trial publications
        search_result = await pubmed_search(query, max_results=max_results)
        
        if not search_result['success']:
            return search_result
        
        # Fetch detailed information for the trials
        if search_result['pmids']:
            fetch_result = await pubmed_fetch_summaries(search_result['pmids'])
            
            if fetch_result['success']:
                return {
                    "success": True,
                    "condition": condition,
                    "intervention": intervention,
                    "trials": fetch_result['summaries'],
                    "count": len(fetch_result['summaries']),
                    "total_found": search_result['count']
                }
        
        return {
            "success": True,
            "condition": condition,
            "intervention": intervention,
            "trials": [],
            "count": 0,
            "message": "No clinical trials found"
        }
        
    except Exception as e:
        logger.error(f"Clinical trials search error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "condition": condition
        }


@tool
async def pubmed_mesh_search(
    mesh_terms: List[str],
    combine_with: str = "AND",
    max_results: int = 20
) -> Dict[str, Any]:
    """
    Search PubMed using MeSH (Medical Subject Headings) terms.
    Provides more precise medical literature searches.
    """
    try:
        # Build MeSH query
        mesh_queries = [f'"{term}"[MeSH Terms]' for term in mesh_terms]
        query = f' {combine_with} '.join(mesh_queries)
        
        # Perform search
        search_result = await pubmed_search(query, max_results=max_results)
        
        if search_result['success'] and search_result['pmids']:
            # Fetch abstracts for results
            fetch_result = await pubmed_fetch_abstracts(search_result['pmids'])
            
            if fetch_result['success']:
                return {
                    "success": True,
                    "mesh_terms": mesh_terms,
                    "combine_method": combine_with,
                    "articles": fetch_result['articles'],
                    "count": len(fetch_result['articles']),
                    "total_found": search_result['count']
                }
        
        return {
            "success": True,
            "mesh_terms": mesh_terms,
            "articles": [],
            "count": 0,
            "message": "No articles found with specified MeSH terms"
        }
        
    except Exception as e:
        logger.error(f"MeSH search error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "mesh_terms": mesh_terms
        }


def _parse_pubmed_article(article_element):
    """Parse a PubMed article XML element into a dictionary"""
    article_data = {}
    
    # Get PMID
    pmid_elem = article_element.find('.//PMID')
    if pmid_elem is not None:
        article_data['pmid'] = pmid_elem.text
    
    # Get article title
    title_elem = article_element.find('.//ArticleTitle')
    if title_elem is not None:
        article_data['title'] = title_elem.text
    
    # Get abstract
    abstract_elem = article_element.find('.//Abstract/AbstractText')
    if abstract_elem is not None:
        article_data['abstract'] = abstract_elem.text
    
    # Get authors
    authors = []
    for author in article_element.findall('.//Author'):
        author_name = {}
        lastname = author.find('LastName')
        forename = author.find('ForeName')
        if lastname is not None:
            author_name['lastname'] = lastname.text
        if forename is not None:
            author_name['forename'] = forename.text
        if author_name:
            authors.append(f"{author_name.get('forename', '')} {author_name.get('lastname', '')}".strip())
    article_data['authors'] = authors
    
    # Get journal info
    journal_elem = article_element.find('.//Journal/Title')
    if journal_elem is not None:
        article_data['journal'] = journal_elem.text
    
    # Get publication date
    pubdate_elem = article_element.find('.//PubDate')
    if pubdate_elem is not None:
        year = pubdate_elem.find('Year')
        month = pubdate_elem.find('Month')
        day = pubdate_elem.find('Day')
        date_parts = []
        if year is not None:
            date_parts.append(year.text)
        if month is not None:
            date_parts.append(month.text)
        if day is not None:
            date_parts.append(day.text)
        article_data['pubdate'] = ' '.join(date_parts)
    
    # Get DOI
    doi_elem = article_element.find('.//ELocationID[@EIdType="doi"]')
    if doi_elem is not None:
        article_data['doi'] = doi_elem.text
    
    # Get keywords
    keywords = []
    for keyword in article_element.findall('.//Keyword'):
        if keyword.text:
            keywords.append(keyword.text)
    article_data['keywords'] = keywords
    
    # Get MeSH terms
    mesh_terms = []
    for mesh in article_element.findall('.//MeshHeading/DescriptorName'):
        if mesh.text:
            mesh_terms.append(mesh.text)
    article_data['mesh_terms'] = mesh_terms
    
    return article_data


# Test function
async def test_pubmed_tools():
    """Test PubMed tools functionality"""
    print("Testing PubMed E-utilities tools...")
    
    # Test search
    print("\n1. Testing search...")
    search_result = await pubmed_search("COVID-19 vaccine efficacy", max_results=5)
    print(f"Search result: {json.dumps(search_result, indent=2)}")
    
    if search_result['success'] and search_result['pmids']:
        # Test fetch abstracts
        print("\n2. Testing fetch abstracts...")
        pmids = search_result['pmids'][:2]
        abstracts_result = await pubmed_fetch_abstracts(pmids)
        print(f"Abstracts result: {json.dumps(abstracts_result, indent=2)}")
        
        # Test fetch summaries
        print("\n3. Testing fetch summaries...")
        summaries_result = await pubmed_fetch_summaries(pmids)
        print(f"Summaries result: {json.dumps(summaries_result, indent=2)}")
        
        # Test related articles
        print("\n4. Testing related articles...")
        related_result = await pubmed_fetch_related(pmids[0], max_results=3)
        print(f"Related articles result: {json.dumps(related_result, indent=2)}")
    
    print("\nAll tests completed!")


if __name__ == "__main__":
    # Run tests
    asyncio.run(test_pubmed_tools())
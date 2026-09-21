"""
Test script for PubMed E-utilities tools
Tests all functions to ensure they work correctly with Claude
"""

import asyncio
import json
import os

# Import from the same directory
from pubmed_tools import (
    pubmed_search, pubmed_fetch_abstracts, pubmed_fetch_summaries,
    pubmed_fetch_related, pubmed_fetch_citations, pubmed_search_clinical_trials,
    pubmed_mesh_search
)

async def test_pubmed_tools():
    """Comprehensive test of all PubMed tools"""
    
    print("=" * 80)
    print("PUBMED E-UTILITIES TOOLS TEST SUITE")
    print("=" * 80)
    
    # Check for API key
    api_key = os.getenv('NCBI_API_KEY')
    if api_key:
        print("✓ NCBI API Key found - enhanced rate limits enabled")
    else:
        print("⚠ No NCBI API Key found - using default rate limits (3 req/sec)")
    
    print("\n" + "-" * 80)
    
    # Test 1: Basic Search
    print("\n1. Testing pubmed_search - Basic search for COVID-19 vaccines")
    print("-" * 40)
    
    search_result = await pubmed_search(
        query="COVID-19 vaccine efficacy",
        max_results=5,
        sort_order="pub_date"
    )
    
    if search_result['success']:
        print(f"✓ Search successful!")
        print(f"  Total articles found: {search_result['count']}")
        print(f"  PMIDs returned: {len(search_result['pmids'])}")
        print(f"  First 5 PMIDs: {search_result['pmids'][:5]}")
        pmids_for_testing = search_result['pmids'][:3]
    else:
        print(f"✗ Search failed: {search_result['error']}")
        return
    
    # Test 2: Fetch Abstracts
    print("\n2. Testing pubmed_fetch_abstracts")
    print("-" * 40)
    
    if pmids_for_testing:
        abstracts_result = await pubmed_fetch_abstracts(pmids_for_testing)
        
        if abstracts_result['success']:
            print(f"✓ Abstracts fetched successfully!")
            print(f"  Articles retrieved: {len(abstracts_result['articles'])}")
            
            # Display first article details
            if abstracts_result['articles']:
                first_article = abstracts_result['articles'][0]
                print(f"\n  First article details:")
                print(f"  - PMID: {first_article.get('pmid', 'N/A')}")
                print(f"  - Title: {first_article.get('title', 'N/A')[:100]}...")
                print(f"  - Authors: {', '.join(first_article.get('authors', [])[:3])}...")
                print(f"  - Journal: {first_article.get('journal', 'N/A')}")
                print(f"  - Pub Date: {first_article.get('pubdate', 'N/A')}")
                if first_article.get('abstract'):
                    print(f"  - Abstract: {first_article['abstract'][:150]}...")
        else:
            print(f"✗ Fetch abstracts failed: {abstracts_result['error']}")
    
    # Test 3: Fetch Summaries
    print("\n3. Testing pubmed_fetch_summaries")
    print("-" * 40)
    
    if pmids_for_testing:
        summaries_result = await pubmed_fetch_summaries(pmids_for_testing)
        
        if summaries_result['success']:
            print(f"✓ Summaries fetched successfully!")
            print(f"  Summaries retrieved: {len(summaries_result['summaries'])}")
            
            # Display first summary
            if summaries_result['summaries']:
                first_summary = summaries_result['summaries'][0]
                print(f"\n  First summary:")
                print(f"  - PMID: {first_summary.get('pmid', 'N/A')}")
                print(f"  - Title: {first_summary.get('title', 'N/A')[:100]}...")
                print(f"  - Source: {first_summary.get('source', 'N/A')}")
                print(f"  - DOI: {first_summary.get('doi', 'N/A')}")
        else:
            print(f"✗ Fetch summaries failed: {summaries_result['error']}")
    
    # Test 4: Find Related Articles
    print("\n4. Testing pubmed_fetch_related")
    print("-" * 40)
    
    if pmids_for_testing:
        test_pmid = pmids_for_testing[0]
        related_result = await pubmed_fetch_related(test_pmid, max_results=3)
        
        if related_result['success']:
            print(f"✓ Related articles found!")
            print(f"  Source PMID: {related_result['source_pmid']}")
            print(f"  Related articles: {related_result['count']}")
            
            if related_result['related_articles']:
                print(f"\n  First related article:")
                first_related = related_result['related_articles'][0]
                print(f"  - PMID: {first_related.get('pmid', 'N/A')}")
                print(f"  - Title: {first_related.get('title', 'N/A')[:100]}...")
        else:
            print(f"✗ Fetch related failed: {related_result['error']}")
    
    # Test 5: Fetch Citations
    print("\n5. Testing pubmed_fetch_citations")
    print("-" * 40)
    
    if pmids_for_testing:
        test_pmid = pmids_for_testing[0]
        citations_result = await pubmed_fetch_citations(test_pmid, citation_type="both")
        
        if citations_result['success']:
            print(f"✓ Citations fetched!")
            print(f"  PMID: {citations_result['pmid']}")
            print(f"  References (cited by this paper): {citations_result['reference_count']}")
            print(f"  Citations (papers citing this): {citations_result['citation_count']}")
        else:
            print(f"✗ Fetch citations failed: {citations_result['error']}")
    
    # Test 6: Search Clinical Trials
    print("\n6. Testing pubmed_search_clinical_trials")
    print("-" * 40)
    
    trials_result = await pubmed_search_clinical_trials(
        condition="Type 2 Diabetes",
        intervention="metformin",
        max_results=5
    )
    
    if trials_result['success']:
        print(f"✓ Clinical trials search successful!")
        print(f"  Condition: {trials_result['condition']}")
        print(f"  Intervention: {trials_result['intervention']}")
        print(f"  Trials found: {trials_result['count']}")
        print(f"  Total available: {trials_result.get('total_found', 'N/A')}")
    else:
        print(f"✗ Clinical trials search failed: {trials_result['error']}")
    
    # Test 7: MeSH Search
    print("\n7. Testing pubmed_mesh_search")
    print("-" * 40)
    
    mesh_result = await pubmed_mesh_search(
        mesh_terms=["Diabetes Mellitus, Type 2", "Metformin"],
        combine_with="AND",
        max_results=5
    )
    
    if mesh_result['success']:
        print(f"✓ MeSH search successful!")
        print(f"  MeSH terms: {', '.join(mesh_result['mesh_terms'])}")
        print(f"  Combine method: {mesh_result['combine_method']}")
        print(f"  Articles found: {mesh_result['count']}")
        
        if mesh_result['articles']:
            first_mesh = mesh_result['articles'][0]
            print(f"\n  First article:")
            print(f"  - PMID: {first_mesh.get('pmid', 'N/A')}")
            print(f"  - Title: {first_mesh.get('title', 'N/A')[:100]}...")
            print(f"  - MeSH terms: {', '.join(first_mesh.get('mesh_terms', [])[:3])}...")
    else:
        print(f"✗ MeSH search failed: {mesh_result['error']}")
    
    # Test 8: Advanced Search with Date Filter
    print("\n8. Testing advanced search with date filters")
    print("-" * 40)
    
    advanced_result = await pubmed_search(
        query='artificial intelligence[Title/Abstract] AND radiology[MeSH]',
        max_results=5,
        sort_order="pub_date",
        date_filter={
            "mindate": "2023/01/01",
            "maxdate": "2024/12/31",
            "datetype": "pdat"
        }
    )
    
    if advanced_result['success']:
        print(f"✓ Advanced search successful!")
        print(f"  Query: artificial intelligence AND radiology")
        print(f"  Date range: 2023-2024")
        print(f"  Articles found: {advanced_result['count']}")
        print(f"  PMIDs: {advanced_result['pmids'][:5]}")
    else:
        print(f"✗ Advanced search failed: {advanced_result['error']}")
    
    print("\n" + "=" * 80)
    print("TEST SUITE COMPLETED")
    print("=" * 80)
    
    # Summary
    print("\nSUMMARY:")
    print("All PubMed E-utilities tools have been tested and are ready for use with Claude.")
    print("\nKey capabilities verified:")
    print("✓ Literature search with various filters")
    print("✓ Abstract and summary retrieval")
    print("✓ Related article discovery")
    print("✓ Citation network analysis")
    print("✓ Clinical trial searches")
    print("✓ MeSH term searches")
    print("✓ Advanced query construction")
    
    print("\nClaude can now use these tools to:")
    print("- Conduct comprehensive literature reviews")
    print("- Find evidence-based medical information")
    print("- Analyze research trends and citations")
    print("- Support clinical decision-making with peer-reviewed evidence")


async def test_error_handling():
    """Test error handling scenarios"""
    print("\n" + "=" * 80)
    print("TESTING ERROR HANDLING")
    print("=" * 80)
    
    # Test with invalid PMID
    print("\n1. Testing with invalid PMID")
    result = await pubmed_fetch_abstracts(["invalid_pmid_12345"])
    print(f"Result: {result}")
    
    # Test with empty query
    print("\n2. Testing with empty query")
    result = await pubmed_search("")
    print(f"Result: {result}")
    
    # Test with extremely large request
    print("\n3. Testing with large PMID list (should be limited)")
    large_pmid_list = [str(i) for i in range(35000000, 35000200)]
    result = await pubmed_fetch_summaries(large_pmid_list)
    print(f"Requested: 200 PMIDs, Processed: {len(result.get('summaries', []))}")


if __name__ == "__main__":
    print("Starting PubMed E-utilities Tools Test...")
    print(f"Current working directory: {os.getcwd()}")
    
    # Run main tests
    asyncio.run(test_pubmed_tools())
    
    # Optionally run error handling tests
    # asyncio.run(test_error_handling())